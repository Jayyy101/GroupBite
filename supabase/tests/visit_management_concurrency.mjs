// SQL integration tests for an isolated, disposable PostgreSQL database only.
// The hardened local validator supplies three independent pg clients and synthetic
// users after applying migrations 1–5. Fixtures commit to allow real overlap.
// No environment, credentials, filesystem, network configuration, or imports here.
export async function runVisitManagementConcurrency({ admin, a, b, owner, member }) {
    const assert = (ok, label) => { if (!ok) throw new Error(label); };
    const local = await admin.query("select current_setting('groupbite.local_validation',true) as enabled");
    assert(local.rows[0].enabled === 'visit-management', 'Requires explicit disposable local validation setup');
    const save = 'select public.save_restaurant_visit($1,$2::uuid[],$3,$4,visit_rating => 4,visit_notes => $5) as id';
    const remove = 'select public.delete_group_visit($1,$2,$3) as removed';
    const edit = "select public.update_group_visit($1,$2,$3,'2026-10-06',2,false,'Concurrent edit')";
    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;

    async function beginAs(client, user) {
        await client.query('begin; set local role authenticated;');
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    }
    async function overlap(firstSql, firstArgs, secondSql, secondArgs, options = {}) {
        await beginAs(a, options.firstUser ?? owner);
        await beginAs(b, options.secondUser ?? member);
        const first = await a.query(firstSql, firstArgs);
        const pending = b.query(secondSql, secondArgs).then(value => ({ value }), error => ({ error }));
        let waiting = false;
        for (let attempt = 0; attempt < 40; attempt++) {
            const status = await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [bPid]);
            if (status.rows[0]?.wait_event_type === 'Lock') { waiting = true; break; }
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert(waiting, 'Second writer must actually overlap and wait on a lock');
        await a.query(options.rollback ? 'rollback' : 'commit');
        const second = await pending;
        if (options.errorState) {
            assert(second.error?.code === options.errorState, 'Waiting writer must fail with ' + options.errorState);
            await b.query('rollback');
        } else {
            if (second.error) throw second.error;
            await b.query('commit');
        }
        return { first, second: second.value };
    }
    await beginAs(admin, owner);
    const groups = (await admin.query("select (public.create_group('Management race A')).id as a, (public.create_group('Management race B')).id as b")).rows[0];
    await admin.query('commit');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)', [groups.a, member]);

    async function seed(label) {
        const name = 'Management race ' + label;
        const request = 'management-race-' + label;
        await beginAs(admin, owner);
        const restaurant = (await admin.query(save, [request, [groups.a, groups.b], name, 'Concurrency address', 'Seed visit'])).rows[0].id;
        await admin.query('commit');
        const rows = (await admin.query(`select gr.group_id, gr.id as entry, v.id as visit, to_jsonb(v) as snapshot
            from public.group_restaurants gr join public.visits v on v.group_restaurant_id=gr.id
            where gr.restaurant_id=$1`, [restaurant])).rows;
        return { name, request, restaurant, a: rows.find(row => row.group_id === groups.a), b: rows.find(row => row.group_id === groups.b),
            facts: (await admin.query('select to_jsonb(r) as facts from public.restaurants r where id=$1', [restaurant])).rows[0].facts };
    }
    async function check(fixture, count, sameEntry) {
        const result = (await admin.query(`select count(distinct gr.id)::int as entries, count(v.id)::int as visits,
            min(gr.id::text) as entry from public.group_restaurants gr left join public.visits v on v.group_restaurant_id=gr.id
            where gr.group_id=$1 and gr.restaurant_id=$2`, [groups.a, fixture.restaurant])).rows[0];
        assert(result.entries === (count ? 1 : 0) && result.visits === count, 'Expected clean group entry and ' + count + ' visits');
        if (sameEntry !== undefined && count) assert((result.entry === fixture.a.entry) === sameEntry, 'Expected correct entry reuse/recreation');
        const isolated = (await admin.query(`select to_jsonb(v)=$2::jsonb as intact from public.visits v where v.id=$1`,
            [fixture.b.visit, JSON.stringify(fixture.b.snapshot)])).rows[0];
        assert(isolated?.intact, 'Other group visit must be unchanged');
        const facts = (await admin.query('select to_jsonb(r)=$2::jsonb as intact from public.restaurants r where id=$1',
            [fixture.restaurant, JSON.stringify(fixture.facts)])).rows[0];
        assert(facts?.intact, 'Global restaurant facts and timestamps must be unchanged');
    }

    // Delete wins first: a new submission recreates the entry and survives cleanup.
    let fixture = await seed('delete-first');
    let result = await overlap(remove, [groups.a, fixture.a.entry, fixture.a.visit], save,
        ['management-add-after-delete', [groups.a], fixture.name, 'Concurrency address', 'New visit']);
    assert(result.first.rows[0].removed && result.second.rows[0].id === fixture.restaurant, 'Delete-first removes old entry and reuses global location');
    await check(fixture, 1, false);

    // Add wins first: deleting the old visit sees the new one and keeps its entry.
    fixture = await seed('add-first');
    result = await overlap(save, ['management-add-before-delete', [groups.a], fixture.name, 'Concurrency address', 'New visit'], remove,
        [groups.a, fixture.a.entry, fixture.a.visit], { firstUser: member, secondUser: owner });
    assert(!result.second.rows[0].removed, 'Add-first must prevent final-entry cleanup');
    await check(fixture, 1, true);

    // Different visits are deleted concurrently; exactly the final deletion cleans up.
    fixture = await seed('two-deletes');
    await beginAs(admin, member);
    await admin.query(save, ['management-second-delete', [groups.a], fixture.name, 'Concurrency address', 'Member visit']);
    await admin.query('commit');
    const memberVisit = (await admin.query('select id from public.visits where group_restaurant_id=$1 and created_by=$2', [fixture.a.entry, member])).rows[0].id;
    result = await overlap(remove, [groups.a, fixture.a.entry, fixture.a.visit], remove, [groups.a, fixture.a.entry, memberVisit]);
    assert(!result.first.rows[0].removed && result.second.rows[0].removed, 'Only the final of two concurrent deletes removes the entry');
    await check(fixture, 0);

    // Two deletions of one visit: recheck after the wait and deny the stale request.
    fixture = await seed('same-delete');
    await overlap(remove, [groups.a, fixture.a.entry, fixture.a.visit], remove, [groups.a, fixture.a.entry, fixture.a.visit],
        { secondUser: owner, errorState: '42501' });
    await check(fixture, 0);

    // Rollback must restore the entry before the waiting save resumes.
    fixture = await seed('rollback-delete');
    await overlap(remove, [groups.a, fixture.a.entry, fixture.a.visit], save,
        ['management-add-after-rollback', [groups.a], fixture.name, 'Concurrency address', 'New visit'], { rollback: true });
    await check(fixture, 2, true);
    assert((await admin.query('select 1 from public.visits where id=$1', [fixture.a.visit])).rowCount === 1, 'Rolled-back deletion restores the original visit');

    // Edits and deletions serialize in both orders without resurrecting a visit.
    fixture = await seed('edit-first');
    await overlap(edit, [groups.a, fixture.a.entry, fixture.a.visit], remove, [groups.a, fixture.a.entry, fixture.a.visit], { secondUser: owner });
    await check(fixture, 0);
    fixture = await seed('delete-before-edit');
    await overlap(remove, [groups.a, fixture.a.entry, fixture.a.visit], edit, [groups.a, fixture.a.entry, fixture.a.visit],
        { secondUser: owner, errorState: '42501' });
    await check(fixture, 0);

    // A waiting retry of the ORIGINAL multi-group save must never undo deletion.
    fixture = await seed('delete-before-retry');
    result = await overlap(remove, [groups.a, fixture.a.entry, fixture.a.visit], save,
        [fixture.request, [groups.b, groups.a], fixture.name, 'Concurrency address', 'Seed visit'], { secondUser: owner });
    assert(result.second.rows[0].id === fixture.restaurant, 'Concurrent receipt retry returns its original restaurant');
    await check(fixture, 0);

    // Membership is checked again after waiting, even for the original creator.
    fixture = await seed('membership-check');
    await beginAs(admin, member);
    await admin.query(save, ['management-membership-visit', [groups.a], fixture.name, 'Concurrency address', 'Member visit']);
    await admin.query('commit');
    const ownVisit = (await admin.query('select id from public.visits where group_restaurant_id=$1 and created_by=$2', [fixture.a.entry, member])).rows[0].id;
    await admin.query('begin');
    await admin.query('select id from public.groups where id=$1 for update', [groups.a]);
    await admin.query('delete from public.group_memberships where group_id=$1 and user_id=$2', [groups.a, member]);
    await beginAs(b, member);
    const pending = b.query(edit, [groups.a, fixture.a.entry, ownVisit]).then(value => ({ value }), error => ({ error }));
    let waiting = false;
    for (let attempt = 0; attempt < 40; attempt++) {
        const status = await a.query('select wait_event_type from pg_stat_activity where pid=$1', [bPid]);
        if (status.rows[0]?.wait_event_type === 'Lock') { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(waiting, 'Membership test must actually wait on the group lock');
    await admin.query('commit');
    assert((await pending).error?.code === '42501', 'Membership revocation while waiting denies an own-visit edit');
    await b.query('rollback');
    await check(fixture, 2, true);
    assert((await admin.query('select notes from public.visits where id=$1', [ownVisit])).rows[0].notes === 'Member visit', 'Denied edit leaves the visit unchanged');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)', [groups.a, member]);
    return 9;
}
