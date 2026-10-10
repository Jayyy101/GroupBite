// Disposable local database only; never run against hosted data.
import assert from 'node:assert/strict';

export async function runAdmissionConfirmationTests({ admin, a, b, userA, userB }) {
    assert.equal((await admin.query("select current_setting('groupbite.local_validation',true) as enabled")).rows[0].enabled,
        'address-autocomplete-groundwork');
    const signature = 'public.confirm_geoapify_request(uuid,uuid,timestamp with time zone)';
    const metadata = (await admin.query(`select provolatile,prosecdef,proconfig,proacl::text
        from pg_proc where oid=$1::regprocedure`, [signature])).rows[0];
    assert.equal(metadata.provolatile, 's'); assert.equal(metadata.prosecdef, true);
    assert.deepEqual(metadata.proconfig, ['search_path=""']);
    assert(!/[{,]=X\//.test(metadata.proacl), 'No PUBLIC execution grant');
    for (const role of ['anon', 'authenticated', 'service_role']) {
        const permissions = (await admin.query(`select has_function_privilege($1,$2,'EXECUTE') as execute,
            has_table_privilege($1,'public.geoapify_request_admissions','SELECT') as read,
            has_table_privilege($1,'public.geoapify_request_admissions','INSERT,UPDATE,DELETE,TRUNCATE') as write`, [role, signature])).rows[0];
        assert.deepEqual(permissions, { execute: role === 'service_role', read: false, write: false });
    }
    const reserve = 'select admitted,admission_id,permit_expires_at::text from public.reserve_geoapify_request($1)';
    const confirm = 'select public.confirm_geoapify_request($1,$2,$3) as confirmed';
    async function begin(client, role = 'service_role', readOnly = false) {
        assert(['anon', 'authenticated', 'service_role'].includes(role));
        await client.query('begin isolation level read committed' + (readOnly ? ' read only' : ''));
        await client.query('set local role ' + role);
    }
    async function read(permit, actor = userA, expiry = permit.permit_expires_at) {
        await begin(b, 'service_role', true);
        try { return (await b.query(confirm, [permit.admission_id, actor, expiry])).rows[0].confirmed; }
        finally { await b.query('rollback'); }
    }
    await admin.query('truncate public.geoapify_request_admissions');
    for (const role of ['anon', 'authenticated']) {
        await begin(b, role);
        await assert.rejects(b.query(confirm, [userA, userA, new Date().toISOString()]), { code: '42501' });
        await b.query('rollback');
    }
    await begin(b);
    await assert.rejects(b.query('select * from public.geoapify_request_admissions'), { code: '42501' });
    await b.query('rollback');
    console.log('PASS confirmation metadata, service-only execution and unchanged table permissions');

    await begin(a);
    const permit = (await a.query(reserve, [userA])).rows[0]; assert(permit.admitted);
    assert.equal(await read(permit), false, 'Separate transaction must not see uncommitted admission');
    await a.query('commit');
    assert.equal(await read(permit), true, 'A new read-only transaction sees the committed admission');
    assert.equal(await read(permit), true, 'Readback does not mutate or consume reservations');
    assert.equal(await read(permit, userB), false, 'Wrong account');
    assert.equal(await read({ ...permit, admission_id: userB }), false, 'Unknown admission ID');
    assert.equal(await read(permit, null), false, 'Null account');
    assert.equal(await read({ ...permit, admission_id: null }), false, 'Null ID');
    assert.equal(await read(permit, userA, null), false, 'Null expiry');
    const altered = (await admin.query("select ($1::timestamptz+interval '1 microsecond')::text as expiry", [permit.permit_expires_at])).rows[0].expiry;
    assert.equal(await read(permit, userA, altered), false, 'Expiry comparison preserves microseconds');
    assert.equal((await admin.query('select count(*)::int as n from public.geoapify_request_admissions')).rows[0].n, 1);
    console.log('PASS uncommitted invisibility, committed visibility, identity/expiry matching and read-only behavior');

    await admin.query('truncate public.geoapify_request_admissions');
    await begin(a);
    const rolledBack = (await a.query(reserve, [userA])).rows[0];
    assert.equal(await read(rolledBack), false);
    await a.query('rollback');
    assert.equal(await read(rolledBack), false, 'Rolled-back reservation cannot be confirmed');
    const expired = (await admin.query(`insert into public.geoapify_request_admissions(user_id,admitted_at,permit_expires_at)
        values($1,statement_timestamp()-interval '1 second',statement_timestamp())
        returning id as admission_id,permit_expires_at::text`, [userA])).rows[0];
    assert.equal(await read(expired), false, 'Expired reservation cannot be confirmed');
    await admin.query('truncate public.geoapify_request_admissions');
    console.log('PASS rolled-back and expired admissions fail confirmation');
}
