// Real SQL/lock tests; callable only by the explicitly disposable local runner.
import assert from 'node:assert/strict';

export async function runPersonalGeoapifyAttachmentTests({ admin, a, b, owner, other }) {
    assert.equal((await admin.query("select current_setting('groupbite.local_validation',true) as enabled")).rows[0].enabled,
        'personal-geoapify-attachment');
    const signature = 'public.attach_geoapify_personal_place_location(uuid,uuid,integer,text,double precision,double precision,text,timestamp with time zone)';
    const rpc = 'select public.attach_geoapify_personal_place_location($1,$2,$3,$4,$5,$6,$7,$8) as attached';
    const address = '100 Public Building, Test City, US';
    let sequence = 0, checks = 0, races = 0;
    async function begin(client, role = 'service_role', actor = owner) {
        assert(['service_role', 'authenticated', 'anon'].includes(role));
        await client.query('begin; set local role ' + role);
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    }
    async function fixture() {
        await begin(admin, 'authenticated');
        const row = (await admin.query("insert into public.personal_places(name,address,notes,client_request_id) values('Original memory',$1,'Original notes',$2) returning id,revision",
            [address, 'attachment-fixture-' + ++sequence])).rows[0];
        await admin.query('commit'); return row;
    }
    const args = (place, overrides = {}) => {
        const value = { actor: owner, id: place.id, revision: place.revision, address, latitude: 37.7749,
            longitude: -122.4194, result: 'synthetic-building', expiry: new Date(Date.now() + 60000).toISOString(), ...overrides };
        return [value.actor, value.id, value.revision, value.address, value.latitude, value.longitude, value.result, value.expiry];
    };
    async function saved(place) { return (await admin.query('select * from public.personal_places where id=$1', [place.id])).rows[0]; }
    async function locations(place) { return (await admin.query('select * from public.personal_place_locations where personal_place_id=$1', [place.id])).rows; }
    async function reject(place, values, code, role = 'service_role') {
        const before = await saved(place);
        await begin(admin, role);
        try { await admin.query(rpc, values); assert.fail('Invalid attachment succeeded'); }
        catch (error) { assert.equal(error.code, code); }
        finally { await admin.query('rollback'); }
        assert.deepEqual(await saved(place), before); assert.equal((await locations(place)).length, 0); checks++;
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
        const granted = (await admin.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature])).rows[0].allowed;
        assert.equal(granted, role === 'service_role'); checks++;
    }
    const definition = (await admin.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [signature])).rows[0];
    assert.equal(definition.prosecdef, true); assert(definition.proconfig.some(value => /^search_path=(?:""|)$/.test(value)));
    assert.equal((await admin.query("select count(*)::int as n from pg_proc p,aclexplode(p.proacl) a where p.oid=$1::regprocedure and a.grantee=0", [signature])).rows[0].n, 0); checks++;

    let place = await fixture();
    await reject(place, args(place), '42501', 'anon'); await reject(place, args(place), '42501', 'authenticated');
    await reject(place, args(place, { actor: other }), '42501');
    await reject(place, args(place, { revision: 2 }), '40001');
    await reject(place, args(place, { address: address.toLowerCase() }), '40001');
    for (const expiry of [null, 'infinity', '-infinity', new Date(Date.now() - 1).toISOString()]) await reject(place, args(place, { expiry }), '22023');
    for (const values of [{ latitude: null }, { longitude: null }, { latitude: 'NaN' }, { latitude: 'Infinity' },
        { latitude: 91 }, { longitude: -181 }, { latitude: 0, longitude: 0 }, { result: '' }, { result: ' padded ' }]) {
        await reject(place, args(place, values), '22023');
    }
    await begin(admin); assert.equal((await admin.query(rpc, args(place))).rows[0].attached, true); await admin.query('commit');
    const first = (await locations(place))[0], original = await saved(place);
    assert.equal(first.resolution_provider, 'geoapify'); assert.equal(first.resolution_accuracy, 'building');
    assert.equal(first.standardized_address, address); assert.equal(original.revision, 2);
    assert.equal(original.name, 'Original memory'); assert.equal(original.notes, 'Original notes'); checks++;
    await begin(admin); assert.equal((await admin.query(rpc, args({ ...place, revision: 2 }, { latitude: 1, longitude: 2, result: 'second' }))).rows[0].attached, false);
    await admin.query('commit'); assert.deepEqual((await locations(place))[0], first); assert.deepEqual(await saved(place), original); checks++;
    for (const actor of [owner, other]) {
        await begin(admin, 'authenticated', actor);
        assert.equal((await admin.query('select * from public.personal_place_locations where personal_place_id=$1', [place.id])).rowCount, actor === owner ? 1 : 0);
        await admin.query('commit'); checks++;
    }
    await begin(admin, 'authenticated');
    await admin.query("update public.personal_places set address='Changed manual address' where id=$1 and revision=2", [place.id]);
    await admin.query('commit'); assert.equal((await locations(place)).length, 0); assert.equal((await saved(place)).address, 'Changed manual address'); checks++;

    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    async function waiting() {
        for (let i = 0; i < 120; i++) {
            if ((await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [bPid])).rows[0]?.wait_event_type === 'Lock') return;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.fail('Second attachment did not actually wait on a target lock');
    }
    async function overlap(place, firstOperation, overrides = {}, { code, rollback = false, waitForExpiry = false } = {}) {
        await begin(a); await begin(b);
        await firstOperation(a);
        const values = args(place, overrides);
        const pending = b.query(rpc, values).then(result => ({ result }), error => ({ error }));
        await waiting();
        if (waitForExpiry) {
            let expired = false;
            for (let i = 0; i < 200; i++) {
                expired = (await admin.query('select clock_timestamp() >= $1::timestamptz as expired', [values[7]])).rows[0].expired;
                if (expired) break;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            assert(expired, 'Receipt must expire while RPC is blocked');
        }
        await a.query(rollback ? 'rollback' : 'commit');
        const result = await pending;
        if (code) { assert.equal(result.error?.code, code); await b.query('rollback'); }
        else { if (result.error) throw result.error; assert.equal(result.result.rows[0].attached, true); await b.query('commit'); }
        races++;
    }
    place = await fixture();
    await overlap(place, c => c.query(rpc, args(place)), {}, { code: '40001' });
    assert.equal((await saved(place)).revision, 2); assert.equal((await locations(place)).length, 1);
    place = await fixture();
    await overlap(place, c => c.query(rpc, args(place)), { latitude: 1, longitude: 2, result: 'after-rollback' }, { rollback: true });
    assert.equal((await saved(place)).revision, 2); assert.equal((await locations(place))[0].latitude, 1);
    place = await fixture();
    await overlap(place, c => c.query("update public.personal_places set notes='Concurrent notes' where id=$1", [place.id]), {}, { code: '40001' });
    assert.equal((await locations(place)).length, 0); assert.equal((await saved(place)).notes, 'Concurrent notes');
    place = await fixture();
    await overlap(place, c => c.query('delete from public.personal_places where id=$1', [place.id]), {}, { code: '42501' });
    assert.equal(await saved(place), undefined); assert.equal((await locations(place)).length, 0);
    place = await fixture();
    const expiry = (await admin.query("select clock_timestamp() + interval '800 milliseconds' as expiry")).rows[0].expiry;
    await overlap(place, c => c.query('select id from public.personal_places where id=$1 for update', [place.id]), { expiry }, { code: '22023', waitForExpiry: true });
    assert.equal((await locations(place)).length, 0); assert.equal((await saved(place)).revision, 1);
    // Failed/rolled-back enrichment never creates a group location or admission.
    assert.equal((await admin.query('select count(*)::int as n from public.group_restaurant_locations')).rows[0].n, 0);
    assert.equal((await admin.query('select count(*)::int as n from public.geoapify_request_admissions')).rows[0].n, 0);
    return { checks, races };
}
