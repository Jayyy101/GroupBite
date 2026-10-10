// Real overlapping writers in an explicitly disposable local harness only.
// No imports, environment reads, provider calls or connection configuration.
export async function runSavedLocationsConcurrency({ admin, a, b, owner, member }) {
    const assert = (ok, label) => { if (!ok) throw new Error(label); };
    assert((await admin.query("select current_setting('groupbite.local_validation',true) as enabled")).rows[0].enabled === 'saved-locations',
        'Requires explicit disposable local validation setup');
    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    const attach = "select public.attach_verified_restaurant_location($1,$2,$3,$4,'Race saved address',$5,$6,'synthetic-local',$7,'Standardized race address','building') as attached";
    const personalAttach = "select public.attach_verified_personal_place_location($1,$2,$3,'Race private address',0,0,'synthetic-local','personal-result','Standardized private address','address') as attached";
    const save = "select public.save_restaurant_visit($1,$2::uuid[],$3,'Race saved address',visit_rating=>4) as id";

    async function begin(client, role, user = owner) {
        assert(['authenticated', 'service_role'].includes(role), 'Explicit test role');
        await client.query('begin; set local role ' + role);
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    }
    let raceCount = 0;
    async function overlap(first, second, { firstRole = 'service_role', secondRole = 'service_role',
        firstUser = owner, secondUser = owner, errorState, rollback = false } = {}) {
        await begin(a, firstRole, firstUser);
        await begin(b, secondRole, secondUser);
        const initial = await first(a);
        const pending = second(b).then(value => ({ value }), error => ({ error }));
        let waited = false;
        for (let attempt = 0; attempt < 60; attempt++) {
            if ((await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [bPid])).rows[0]?.wait_event_type === 'Lock') {
                waited = true; break;
            }
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert(waited, 'Second operation must actually wait on a database lock');
        await a.query(rollback ? 'rollback' : 'commit');
        const result = await pending;
        if (errorState) {
            assert(result.error?.code === errorState, 'Waiting operation must fail with ' + errorState + ': ' + result.error?.message);
            await b.query('rollback');
        } else {
            if (result.error) throw result.error;
            await b.query('commit');
        }
        raceCount++;
        return { initial, next: result.value };
    }
    async function restaurant(label, twoGroups = false) {
        await begin(admin, 'authenticated');
        const group = (await admin.query("select (public.create_group('Location race ' || $1)).id as id", [label])).rows[0].id;
        const groups = [group];
        if (twoGroups) groups.push((await admin.query("select (public.create_group('Location race second')).id as id")).rows[0].id);
        const name = 'Location race ' + label;
        const id = (await admin.query(save, ['location-race-' + label, groups, name])).rows[0].id;
        await admin.query('commit');
        const entry = (await admin.query('select gr.id,v.id as visit from public.group_restaurants gr join public.visits v on v.group_restaurant_id=gr.id where gr.group_id=$1 and gr.restaurant_id=$2', [group, id])).rows[0];
        const entries = (await admin.query('select group_id,id from public.group_restaurants where restaurant_id=$1', [id])).rows;
        return { id, group, groups, name, entry: entry.id, visit: entry.visit,
            entries: Object.fromEntries(entries.map(row => [row.group_id, row.id])) };
    }
    async function personal(label) {
        await begin(admin, 'authenticated');
        const row = (await admin.query("insert into public.personal_places(name,address,client_request_id) values('Location race personal','Race private address',$1) returning id,revision", ['location-race-personal-' + label])).rows[0];
        await admin.query('commit');
        return row;
    }
    const args = (f, lat = 0, lon = 0, group = f.group) => [owner, group, f.id, f.entries[group], lat, lon, 'result-' + lat];
    const dropVisit = (client, f) => client.query('select public.delete_group_visit($1,$2,$3)', [f.group, f.entry, f.visit]);

    async function attachCommitted(f, lat = 0, lon = 0, group = f.group) {
        await begin(admin, 'service_role');
        const result = await admin.query(attach, args(f, lat, lon, group));
        await admin.query('commit');
        return result;
    }
    async function admitBoth(f) {
        await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$3),($2,$3)', [f.group, f.groups[1], member]);
        return (await admin.query('select membership_id from public.group_memberships where group_id=$1 and user_id=$2', [f.group, member])).rows[0].membership_id;
    }
    async function assertMemberOnlyOtherGroup(f) {
        await begin(admin, 'authenticated', member);
        assert((await admin.query('select * from public.group_restaurant_locations where group_restaurant_id=$1', [f.entry])).rowCount === 0,
            'Revoked member cannot read first group location/provenance despite shared Restaurant');
        const rows = (await admin.query('select * from public.get_saved_locations() where restaurant_id=$1', [f.id])).rows;
        assert(rows.length === 1 && rows[0].saved_id === f.entries[f.groups[1]] && rows[0].latitude === 1,
            'Remaining membership exposes only independently resolved other entry');
        assert((await admin.query('select * from public.get_saved_locations(center_latitude=>0,center_longitude=>0,radius_meters=>1000) where restaurant_id=$1', [f.id])).rowCount === 0,
            'Revocation also removes first group radius/distance access');
        await admin.query('commit');
    }

    let f = await restaurant('competing-groups', true);
    let result = await overlap(c => c.query(attach, args(f)), c => c.query(attach, args(f, 1, 1, f.groups[1])));
    assert(result.initial.rows[0].attached && result.next.rows[0].attached, 'Different groups both resolve independently despite sharing Restaurant');
    const independent = (await admin.query('select group_restaurant_id,latitude,longitude,provider_location_id from public.group_restaurant_locations where group_restaurant_id=any($1::uuid[])', [Object.values(f.entries)])).rows;
    assert(independent.length === 2 && independent.some(row => row.group_restaurant_id === f.entry && row.latitude === 0 && row.longitude === 0 && row.provider_location_id === 'result-0')
        && independent.some(row => row.group_restaurant_id === f.entries[f.groups[1]] && row.latitude === 1 && row.longitude === 1 && row.provider_location_id === 'result-1'),
        'Cross-group attachment preserves separate coordinates and provenance');

    f = await restaurant('competing-entry');
    result = await overlap(c => c.query(attach, args(f)), c => c.query(attach, args(f, 1, 1)));
    assert(result.initial.rows[0].attached && !result.next.rows[0].attached, 'Only first trusted resolution wins within one entry');
    assert((await admin.query('select latitude=0 and longitude=0 as ok from public.group_restaurant_locations where group_restaurant_id=$1', [f.entry])).rows[0].ok,
        'Same-entry competing attachment does not overwrite');

    f = await restaurant('leave-before-attach', true);
    let admission = await admitBoth(f);
    await attachCommitted(f, 1, 1, f.groups[1]);
    await overlap(c => c.query('select public.leave_group($1,$2)', [f.group, admission]),
        c => c.query(attach, [member, f.group, f.id, f.entry, 0, 0, 'after-leave']),
        { firstRole: 'authenticated', firstUser: member, errorState: '42501' });
    assert((await admin.query('select * from public.group_restaurant_locations where group_restaurant_id=$1', [f.entry])).rowCount === 0,
        'Revoked member cannot attach after waiting');
    await assertMemberOnlyOtherGroup(f);

    f = await restaurant('attach-before-leave', true);
    admission = await admitBoth(f);
    await attachCommitted(f, 1, 1, f.groups[1]);
    await overlap(c => c.query(attach, [member, f.group, f.id, f.entry, 0, 0, 'before-leave']),
        c => c.query('select public.leave_group($1,$2)', [f.group, admission]),
        { secondRole: 'authenticated', secondUser: member });
    assert((await admin.query('select * from public.group_restaurant_locations where group_restaurant_id=$1', [f.entry])).rowCount === 1,
        'Attachment before departure remains stored for current members');
    await assertMemberOnlyOtherGroup(f);

    f = await restaurant('remove-before-attach', true);
    admission = await admitBoth(f);
    await attachCommitted(f, 1, 1, f.groups[1]);
    await overlap(c => c.query('select public.remove_group_member($1,$2,$3)', [f.group, member, admission]),
        c => c.query(attach, [member, f.group, f.id, f.entry, 0, 0, 'after-remove']),
        { firstRole: 'authenticated', errorState: '42501' });
    await assertMemberOnlyOtherGroup(f);

    f = await restaurant('delete-before-attach');
    await overlap(c => dropVisit(c, f), c => c.query(attach, args(f)), { firstRole: 'authenticated', errorState: '42501' });
    assert((await admin.query('select * from public.group_restaurant_locations where group_restaurant_id=$1', [f.entry])).rowCount === 0,
        'Deleted group entry cannot authorize a waiting attachment');

    f = await restaurant('attach-before-delete', true);
    await attachCommitted(f, 1, 1, f.groups[1]);
    await overlap(c => c.query(attach, args(f)), c => dropVisit(c, f), { secondRole: 'authenticated' });
    assert((await admin.query('select * from public.group_restaurant_locations where group_restaurant_id=$1', [f.entry])).rowCount === 0,
        'Final-Visit deletion physically cascades attached coordinates');
    await begin(admin, 'authenticated');
    const remaining = (await admin.query('select * from public.get_saved_locations() where restaurant_id=$1', [f.id])).rows;
    assert(remaining.length === 1 && remaining[0].saved_id === f.entries[f.groups[1]] && remaining[0].latitude === 1,
        'Deleting first entry preserves only other group independently resolved entry');
    await admin.query('commit');
    assert((await admin.query('select * from public.restaurants where id=$1', [f.id])).rowCount === 1,
        'Final deletion preserves global Restaurant');

    f = await restaurant('new-save-reuses', true);
    await attachCommitted(f);
    await attachCommitted(f, 1, 1, f.groups[1]);
    await begin(admin, 'authenticated');
    await dropVisit(admin, f);
    await admin.query('commit');
    result = await overlap(c => c.query(save, ['location-recreate', [f.group], f.name]), c => c.query(attach, args(f)),
        { firstRole: 'authenticated', errorState: '42501' });
    assert(result.initial.rows[0].id === f.id, 'New save reuses retained Restaurant');
    const recreated = (await admin.query('select id from public.group_restaurants where group_id=$1 and restaurant_id=$2', [f.group, f.id])).rows[0].id;
    assert(recreated !== f.entry && (await admin.query('select * from public.group_restaurant_locations where group_restaurant_id=any($1::uuid[])', [[f.entry, recreated]])).rowCount === 0,
        'Recreation starts unresolved and rejects stale attachment to prior entry');
    await begin(admin, 'authenticated');
    assert((await admin.query('select * from public.get_saved_locations() where saved_id=$1', [recreated])).rows[0].latitude === null,
        'Recreated entry never inherits other group location');
    await admin.query('commit');
    f.entries[f.group] = recreated;
    assert((await attachCommitted(f, 2, 2)).rows[0].attached, 'Fresh verified result attaches only to recreated entry');
    assert((await admin.query('select address from public.restaurants where id=$1', [f.id])).rows[0].address === 'Race saved address', 'Reuse preserves entered facts');

    f = await restaurant('rollback-delete');
    result = await overlap(c => dropVisit(c, f), c => c.query(attach, args(f)), { firstRole: 'authenticated', rollback: true });
    assert(result.next.rows[0].attached, 'Rollback restores same entry before waiting attachment');

    f = await restaurant('address-edit-before-attach', true);
    await attachCommitted(f, 1, 1, f.groups[1]);
    await overlap(async c => { await c.query('reset role'); return c.query("update public.restaurants set address='Changed race address' where id=$1", [f.id]); },
        c => c.query(attach, args(f)), { errorState: '40001' });
    assert((await admin.query('select * from public.group_restaurant_locations where group_restaurant_id=any($1::uuid[])', [Object.values(f.entries)])).rowCount === 0,
        'Address edit invalidates other group and rejects stale waiting resolution');

    f = await restaurant('attach-before-address-edit', true);
    await attachCommitted(f, 1, 1, f.groups[1]);
    await overlap(c => c.query(attach, args(f)),
        async c => { await c.query('reset role'); return c.query("update public.restaurants set address='Changed race address' where id=$1", [f.id]); });
    assert((await admin.query('select * from public.group_restaurant_locations where group_restaurant_id=any($1::uuid[])', [Object.values(f.entries)])).rowCount === 0,
        'Address edit after attachment invalidates every entry resolution');

    let p = await personal('attach-before-edit');
    result = await overlap(c => c.query(personalAttach, [owner, p.id, 1]),
        c => c.query("update public.personal_places set notes='Stale draft' where id=$1 and revision=1 returning id", [p.id]), { secondRole: 'authenticated' });
    assert(result.next.rowCount === 0, 'Attachment invalidates stale personal edits through existing revision');

    p = await personal('edit-before-attach');
    await overlap(c => c.query("update public.personal_places set address='New private address' where id=$1 and revision=1", [p.id]),
        c => c.query(personalAttach, [owner, p.id, 1]), { firstRole: 'authenticated', errorState: '40001' });
    assert((await admin.query('select * from public.personal_place_locations where personal_place_id=$1', [p.id])).rowCount === 0,
        'Delayed resolution never attaches to changed address');

    p = await personal('delete-before-attach');
    await overlap(c => c.query('delete from public.personal_places where id=$1 and revision=1', [p.id]),
        c => c.query(personalAttach, [owner, p.id, 1]), { firstRole: 'authenticated', errorState: '42501' });
    assert((await admin.query('select * from public.personal_place_locations where personal_place_id=$1', [p.id])).rowCount === 0,
        'Delayed resolution never resurrects deleted private data');

    f = await restaurant('rollback-resolution');
    result = await overlap(c => c.query(attach, args(f)), c => c.query(attach, args(f, 1, 1)), { rollback: true });
    assert(result.next.rows[0].attached && (await admin.query('select latitude from public.group_restaurant_locations where group_restaurant_id=$1', [f.entry])).rows[0].latitude === 1,
        'Rolled-back attachment does not suppress later resolution');

    p = await personal('rollback-edit');
    result = await overlap(c => c.query("update public.personal_places set address='Rolled back' where id=$1", [p.id]),
        c => c.query(personalAttach, [owner, p.id, 1]), { firstRole: 'authenticated', rollback: true });
    assert(result.next.rows[0].attached && (await admin.query('select revision from public.personal_places where id=$1', [p.id])).rows[0].revision === 2,
        'Rollback restores address/revision before waiting attachment');

    p = await personal('competing-resolutions');
    await overlap(c => c.query(personalAttach, [owner, p.id, 1]), c => c.query(personalAttach, [owner, p.id, 1]), { errorState: '40001' });
    assert((await admin.query('select revision from public.personal_places where id=$1', [p.id])).rows[0].revision === 2,
        'Competing personal attachment preserves one revision increment');
    return raceCount;
}
