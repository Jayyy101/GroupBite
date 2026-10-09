// Receives three independent clients from a disposable local PostgreSQL harness.
// No hosted configuration, environment reads, imports, or credentials.
export async function runPersonalPlacesConcurrency({ admin, a, b, owner, member }) {
    const assert = (ok, label) => { if (!ok) throw new Error(label); };
    assert((await admin.query("select current_setting('groupbite.local_validation',true) as enabled")).rows[0].enabled === 'personal-places',
        'Requires explicit disposable local validation setup');
    const insert = "insert into public.personal_places(name,address,notes,client_request_id) values('Personal race cafe','Private race address','Original memory',$1) returning *";
    const edit = 'update public.personal_places set notes=$3 where id=$1 and revision=$2 returning *';
    const remove = 'delete from public.personal_places where id=$1 and revision=$2 returning id';
    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    async function beginAs(client, user = owner) {
        await client.query('begin; set local role authenticated');
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    }
    async function seed(label) {
        await beginAs(admin);
        const row = (await admin.query(insert, ['personal-race-' + label])).rows[0];
        await admin.query('commit');
        return row;
    }
    async function overlap(firstSql, firstArgs, secondSql, secondArgs, options = {}) {
        await beginAs(a); await beginAs(b);
        const first = await a.query(firstSql, firstArgs);
        const pending = b.query(secondSql, secondArgs).then(value => ({ value }), error => ({ error }));
        let waiting = false;
        for (let attempt = 0; attempt < 40; attempt++) {
            if ((await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [bPid])).rows[0]?.wait_event_type === 'Lock') { waiting = true; break; }
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert(waiting, 'Personal writer must actually overlap and wait on a lock');
        await a.query(options.rollback ? 'rollback' : 'commit');
        const second = await pending;
        if (options.error) {
            assert(second.error?.code === options.error, 'Expected conflict ' + options.error);
            await b.query('rollback');
        } else {
            if (second.error) throw second.error;
            await b.query('commit');
        }
        return { first, second: second.value };
    }
    let result = await overlap(insert, ['personal-race-retry'], insert, ['personal-race-retry'], { error: '23505' });
    let saved = result.first.rows[0];
    assert((await admin.query('select count(*)::int as total from public.personal_places where owner_user_id=$1 and client_request_id=$2', [owner, saved.client_request_id])).rows[0].total === 1,
        'Concurrent same-account request inserts only one memory');

    saved = await seed('edit-edit');
    result = await overlap(edit, [saved.id, 1, 'Winning edit'], edit, [saved.id, 1, 'Stale edit']);
    assert(result.first.rowCount === 1 && result.second.rowCount === 0, 'Waiting stale edit must affect zero rows');
    let current = (await admin.query('select * from public.personal_places where id=$1', [saved.id])).rows[0];
    assert(current.notes === 'Winning edit' && current.revision === 2, 'Stale edit never overwrites or increments revision');

    saved = await seed('edit-delete');
    result = await overlap(edit, [saved.id, 1, 'Winning edit'], remove, [saved.id, 1]);
    assert(result.second.rowCount === 0 && (await admin.query('select revision from public.personal_places where id=$1', [saved.id])).rows[0].revision === 2,
        'Waiting stale deletion cannot remove edited memory');

    saved = await seed('delete-edit');
    result = await overlap(remove, [saved.id, 1], edit, [saved.id, 1, 'Resurrect']);
    assert(result.second.rowCount === 0 && (await admin.query('select id from public.personal_places where id=$1', [saved.id])).rowCount === 0,
        'Waiting edit never resurrects deleted Place');

    saved = await seed('delete-delete');
    result = await overlap(remove, [saved.id, 1], remove, [saved.id, 1]);
    assert(result.first.rowCount === 1 && result.second.rowCount === 0, 'Only one overlapping delete succeeds');

    saved = await seed('rollback-edit');
    result = await overlap(edit, [saved.id, 1, 'Rolled-back edit'], edit, [saved.id, 1, 'Committed edit'], { rollback: true });
    assert(result.second.rowCount === 1 && result.second.rows[0].revision === 2 && result.second.rows[0].notes === 'Committed edit',
        'Rollback restores revision before waiting edit');

    saved = await seed('rollback-delete');
    result = await overlap(remove, [saved.id, 1], edit, [saved.id, 1, 'Survives rollback'], { rollback: true });
    assert(result.second.rowCount === 1 && result.second.rows[0].revision === 2, 'Rollback restores row before waiting edit');

    // Independent accounts can concurrently use the same request identifier.
    await beginAs(a, owner); await beginAs(b, member);
    const [own, other] = await Promise.all([a.query(insert, ['personal-race-independent']), b.query(insert, ['personal-race-independent'])]);
    await a.query('commit'); await b.query('commit');
    assert(own.rows[0].id !== other.rows[0].id && own.rows[0].owner_user_id === owner && other.rows[0].owner_user_id === member,
        'Account-scoped retry identity and personal data remain independent');
    return 8;
}
