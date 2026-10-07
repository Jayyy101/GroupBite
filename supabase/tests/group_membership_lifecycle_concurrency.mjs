// SQL integration tests for a disposable local PostgreSQL harness only.
// Requires migrations 1–6, three independent pg clients and three synthetic users.
// Fixtures commit to permit real overlap. No imports, configuration or credentials.
export async function runGroupMembershipLifecycleConcurrency({ admin, a, b, owner, member, other }) {
    const assert = (ok, label) => { if (!ok) throw new Error(label); };
    assert((await admin.query("select current_setting('groupbite.local_validation',true) as enabled")).rows[0].enabled === 'group-membership-lifecycle',
        'Requires explicit disposable local validation setup');
    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    const leaveSql = 'select public.leave_group($1,$2)';
    const removeSql = 'select public.remove_group_member($1,$2,$3)';
    const transferSql = 'select public.transfer_group_ownership($1,$2,$3)';
    const saveSql = 'select public.save_restaurant_visit($1,$2::uuid[],$3,$4,visit_rating => 4,visit_notes => $5) as id';
    const editSql = "select public.update_group_visit($1,$2,$3,'2026-10-06',2,false,'Lifecycle concurrent edit')";
    const deleteSql = 'select public.delete_group_visit($1,$2,$3)';
    const approveSql = "select public.decide_join_request($1,'approved')";
    async function asUser(client, user) { await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user]); }
    async function beginAs(client, user) {
        await client.query('begin; set local role authenticated;');
        await asUser(client, user);
    }
    async function waitForLock() {
        for (let attempt = 0; attempt < 40; attempt++) {
            if ((await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [bPid])).rows[0]?.wait_event_type === 'Lock') return;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Second connection must actually overlap and wait on a lock');
    }
    async function overlap(firstUser, secondUser, first, second, expectedState, rollback = false) {
        await beginAs(a, firstUser);
        await beginAs(b, secondUser);
        await first(a);
        const pending = second(b).then(value => ({ value }), error => ({ error }));
        await waitForLock();
        await a.query(rollback ? 'rollback' : 'commit');
        const result = await pending;
        if (expectedState) {
            assert(result.error?.code === expectedState, 'Waiting operation must fail with ' + expectedState);
            await b.query('rollback');
        } else {
            if (result.error) throw result.error;
            await b.query('commit');
        }
        assert((await admin.query(`select not exists(select 1 from public.groups g where not exists(
            select 1 from public.group_memberships m where m.group_id=g.id and m.user_id=g.owner_user_id)) as ok`)).rows[0].ok,
            'Every committed group must retain its Owner membership');
    }
    const historySql = `select jsonb_build_object(
        'facts',(select to_jsonb(r) from public.restaurants r where id=$1),
        'entries',(select jsonb_agg(to_jsonb(gr) order by gr.id) from public.group_restaurants gr where restaurant_id=$1),
        'visits',(select jsonb_agg(to_jsonb(v) order by v.id) from public.visits v join public.group_restaurants gr on gr.id=v.group_restaurant_id where gr.restaurant_id=$1),
        'receipts',(select jsonb_agg(to_jsonb(s) order by s.user_id,s.request_id) from public.visit_save_requests s where restaurant_id=$1)
    ) as snapshot`;
    async function seed(label, { thirdMember = false, pending = true } = {}) {
        const name = 'Lifecycle race ' + label;
        await beginAs(admin, owner);
        const group = (await admin.query("select (public.create_group('Lifecycle race')).id as id")).rows[0].id;
        const code = (await admin.query('select public.generate_group_invite($1) as code', [group])).rows[0].code;
        const restaurant = (await admin.query(saveSql, [label + '-owner', [group], name, 'Lifecycle race address', 'Owner history'])).rows[0].id;
        await asUser(admin, member);
        const memberRequest = (await admin.query('select public.request_group_access($1) as id', [code])).rows[0].id;
        await asUser(admin, owner);
        await admin.query(approveSql, [memberRequest]);
        await asUser(admin, member);
        await admin.query(saveSql, [label + '-member', [group], name, 'Lifecycle race address', 'Member history']);
        await asUser(admin, other);
        let pendingRequest;
        if (pending || thirdMember) pendingRequest = (await admin.query('select public.request_group_access($1) as id', [code])).rows[0].id;
        const otherGroup = (await admin.query("select (public.create_group('Lifecycle isolated race')).id as id")).rows[0].id;
        await admin.query(saveSql, [label + '-other', [otherGroup], name, 'Lifecycle race address', 'Other history']);
        if (thirdMember) { await asUser(admin, owner); await admin.query(approveSql, [pendingRequest]); }
        await admin.query('commit');
        const memberships = (await admin.query('select user_id,membership_id from public.group_memberships where group_id=$1', [group])).rows;
        const visits = (await admin.query(`select v.id,v.created_by,gr.id as entry,to_jsonb(v) as snapshot
            from public.visits v join public.group_restaurants gr on gr.id=v.group_restaurant_id where gr.group_id=$1`, [group])).rows;
        return { group, otherGroup, code, restaurant, name, memberRequest, pendingRequest,
            token: memberships.find(row => row.user_id === member).membership_id,
            otherToken: memberships.find(row => row.user_id === other)?.membership_id,
            ownerToken: memberships.find(row => row.user_id === owner).membership_id,
            memberVisit: visits.find(row => row.created_by === member), ownerVisit: visits.find(row => row.created_by === owner),
            history: (await admin.query(historySql, [restaurant])).rows[0].snapshot };
    }
    async function checkHistory(fixture) {
        assert((await admin.query('select (' + historySql.replace(/^select /, '').replace(/ as snapshot$/, '') + ')=$2::jsonb as ok',
            [fixture.restaurant, JSON.stringify(fixture.history)])).rows[0].ok, 'Lifecycle changes must preserve all restaurant, entry, Visit and receipt history');
    }
    async function checkIsolation(fixture) {
        assert((await admin.query('select to_jsonb(r)=$2::jsonb as ok from public.restaurants r where id=$1',
            [fixture.restaurant, JSON.stringify(fixture.history.facts)])).rows[0].ok, 'Global restaurant facts must be unchanged');
        const expected = fixture.history.visits.find(visit => visit.created_by === other);
        assert((await admin.query('select to_jsonb(v)=$2::jsonb as ok from public.visits v where id=$1', [expected.id, JSON.stringify(expected)])).rows[0].ok,
            'Other group Visit must be unchanged');
    }
    async function membership(fixture, user = member) {
        return (await admin.query('select membership_id from public.group_memberships where group_id=$1 and user_id=$2', [fixture.group, user])).rows[0]?.membership_id;
    }
    async function ownership(fixture) {
        return (await admin.query('select owner_user_id from public.groups where id=$1', [fixture.group])).rows[0].owner_user_id;
    }
    const remove = (client, f) => client.query(removeSql, [f.group, member, f.token]);
    const leave = (client, f) => client.query(leaveSql, [f.group, f.token]);
    const transfer = (client, f) => client.query(transferSql, [f.group, member, f.token]);
    const save = (client, f) => client.query(saveSql, ['concurrent-' + f.group, [f.group], f.name, 'Lifecycle race address', 'New memory']);
    const edit = (client, f) => client.query(editSql, [f.group, f.memberVisit.entry, f.memberVisit.id]);
    const dropVisit = (client, f) => client.query(deleteSql, [f.group, f.memberVisit.entry, f.memberVisit.id]);
    const cases = [
        { label: 'remove-before-save', first: remove, second: save, state: '42501' },
        { label: 'leave-before-edit', firstUser: member, first: leave, second: edit, state: '42501' },
        { label: 'remove-before-delete', first: remove, second: dropVisit, state: '42501' },
        { label: 'remove-before-transfer', first: remove, secondUser: owner, second: transfer, state: '22023' },
        { label: 'leave-before-transfer', firstUser: member, first: leave, secondUser: owner, second: transfer, state: '22023' },
        { label: 'transfer-before-remove', first: transfer, secondUser: owner, second: remove, state: '42501' },
        { label: 'transfer-before-leave', first: transfer, second: leave, state: '22023' },
        { label: 'competing-transfers', thirdMember: true, first: transfer, secondUser: owner,
            second: (client, f) => client.query(transferSql, [f.group, other, f.otherToken]), state: '42501' },
        { label: 'transfer-before-old-owner-approval', first: transfer, secondUser: owner,
            second: (client, f) => client.query(approveSql, [f.pendingRequest]), state: '42501' },
        { label: 'transfer-before-old-code-request', first: transfer, secondUser: other,
            second: (client, f) => client.query('select public.request_group_access($1)', [f.code]), state: '22023' },
        { label: 'transfer-before-old-owner-visit-edit', first: transfer, secondUser: owner, second: edit, state: '42501' },
        { label: 'leave-before-remove', firstUser: member, first: leave, secondUser: owner, second: remove, state: '22023' },
        { label: 'remove-before-leave', first: remove, second: leave, state: '42501' },
        { label: 'remove-before-old-approval-replay', first: remove, secondUser: owner,
            second: (client, f) => client.query(approveSql, [f.memberRequest]) },
        { label: 'rolled-back-transfer-before-remove', first: transfer, secondUser: owner, second: remove, rollback: true },
    ];
    for (const test of cases) {
        const f = await seed(test.label, { thirdMember: test.thirdMember });
        await overlap(test.firstUser ?? owner, test.secondUser ?? member, client => test.first(client, f),
            client => test.second(client, f), test.state, test.rollback);
        await checkHistory(f);
        if (test.first === transfer && !test.rollback) {
            assert(await ownership(f) === member && await membership(f) === f.token && await membership(f, owner) === f.ownerToken,
                'Transfer changes only ownership, preserving both admissions');
            assert((await admin.query('select count(*)::int as n from public.group_invites where group_id=$1 and revoked_at is null', [f.group])).rows[0].n === 0,
                'Committed transfer must revoke active invites');
            if (!test.thirdMember) assert((await admin.query('select status from public.join_requests where id=$1', [f.pendingRequest])).rows[0].status === 'pending',
                'Transfer preserves pending requests');
        } else {
            assert(await ownership(f) === owner && !await membership(f), 'Committed departure must remove only the member and retain the Owner');
        }
    }
    let races = cases.length;

    // Writers that commit before departure preserve their effects; a rolled-back
    // departure cannot revoke permission from a waiting writer.
    for (const kind of ['save-first', 'edit-first', 'delete-first', 'rollback-removal']) {
        const f = await seed(kind);
        const operation = kind === 'edit-first' ? edit : kind === 'delete-first' ? dropVisit : save;
        if (kind === 'rollback-removal') {
            await overlap(owner, member, client => remove(client, f), client => save(client, f), undefined, true);
            assert(await membership(f) === f.token, 'Rolled-back removal retains the original admission');
        } else {
            await overlap(member, owner, client => operation(client, f), client => remove(client, f));
            assert(!await membership(f), 'Waiting Owner removal commits after the writer');
        }
        await checkIsolation(f);
        const rows = (await admin.query('select v.* from public.visits v where group_restaurant_id=$1', [f.memberVisit.entry])).rows;
        assert(rows.length === (kind === 'delete-first' ? 1 : kind === 'edit-first' ? 2 : 3), 'Departure must not alter Visit counts');
        if (kind === 'edit-first') {
            const edited = rows.find(row => row.id === f.memberVisit.id);
            assert(edited.notes === 'Lifecycle concurrent edit' && edited.created_by === member, 'Edit before removal persists with creator attribution');
        }
        races++;
    }

    // Rejoin with real request/approval RPCs inside the first transaction. Each
    // waiting stale operation must compare the NEW admission after the group wait.
    for (const kind of ['stale-remove', 'stale-leave', 'stale-transfer']) {
        const f = await seed(kind);
        async function rejoin(client) {
            await remove(client, f);
            await asUser(client, member);
            const request = (await client.query('select public.request_group_access($1) as id', [f.code])).rows[0].id;
            await asUser(client, owner);
            await client.query(approveSql, [request]);
        }
        const operation = kind === 'stale-leave' ? leave : kind === 'stale-transfer' ? transfer : remove;
        await overlap(owner, kind === 'stale-leave' ? member : owner, rejoin, client => operation(client, f), '22023');
        assert(await membership(f) && await membership(f) !== f.token, 'Stale operation must preserve the newly admitted member');
        await checkHistory(f);
        races++;
    }

    // A request that wins the lock before transfer is preserved for the new Owner.
    let f = await seed('request-before-transfer', { pending: false });
    let requestId;
    await overlap(other, owner, async client => {
        requestId = (await client.query('select public.request_group_access($1) as id', [f.code])).rows[0].id;
    }, client => transfer(client, f));
    assert((await admin.query('select status from public.join_requests where id=$1', [requestId])).rows[0].status === 'pending', 'Concurrent pending request survives transfer');
    await checkHistory(f);
    races++;

    // Approval that wins before transfer keeps its newly created membership.
    f = await seed('approval-before-transfer');
    await overlap(owner, owner, client => client.query(approveSql, [f.pendingRequest]), client => transfer(client, f));
    assert(await membership(f, other) && await ownership(f) === member, 'Approval before transfer retains the newly admitted member');
    await checkHistory(f);
    races++;

    // Losing membership in one selected group aborts an entire multi-group save.
    f = await seed('remove-before-multigroup-save');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)', [f.otherGroup, member]);
    await overlap(owner, member, client => remove(client, f), client => client.query(saveSql,
        ['failed-multigroup-' + f.group, [f.otherGroup, f.group], f.name, 'Lifecycle race address', 'Must roll back']), '42501');
    await checkHistory(f);
    assert((await admin.query('select count(*)::int as n from public.visit_save_requests where request_id=$1', ['failed-multigroup-' + f.group])).rows[0].n === 0,
        'Failed multi-group save creates no receipt or private records');
    races++;
    return races;
}
