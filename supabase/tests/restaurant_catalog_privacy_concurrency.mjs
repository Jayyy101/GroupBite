import assert from 'node:assert/strict';

export async function runCatalogPrivacyConcurrency({ admin, a, b, owner, other }) {
    assert.equal((await admin.query("select current_setting('groupbite.local_validation',true) as marker")).rows[0].marker, 'restaurant-catalog-privacy');
    async function begin(client, actor) {
        await client.query('begin; set local role authenticated');
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    }
    async function waitBlocked(client) {
        const pid = client.processID;
        for (let i=0;i<100;i++) {
            const row = (await admin.query('select cardinality(pg_blocking_pids($1))>0 as waiting',[pid])).rows[0];
            if (row.waiting) return;
            await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.fail('Expected an actual group lock wait');
    }
    const save = "select public.save_restaurant_visit($1,$2,$3,'Race address',$4) as id";
    await begin(admin, owner);
    const ga = (await admin.query("select (public.create_group('Race A')).id as id")).rows[0].id;
    await admin.query('commit');
    await begin(admin, other);
    const gb = (await admin.query("select (public.create_group('Race B')).id as id")).rows[0].id;
    await admin.query('commit');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[ga,other]);

    await begin(a,owner); await begin(b,other);
    const first=(await a.query(save,['same-a',[ga],'Same group race','First cuisine'])).rows[0].id;
    const pending=b.query(save,['same-b',[ga],'Same group race','Second cuisine']);
    await waitBlocked(b); await a.query('commit');
    assert.equal((await pending).rows[0].id,first); await b.query('commit');
    const shared=(await admin.query('select count(*)::int as entries,(select count(*)::int from public.visits where group_restaurant_id in (select id from public.group_restaurants where restaurant_id=$1)) as visits from public.group_restaurants where restaurant_id=$1',[first])).rows[0];
    assert.deepEqual(shared,{entries:1,visits:2});
    console.log('PASS race: concurrent same-group saves reuse one entry after a real lock wait');

    await begin(a,owner); await begin(b,other);
    const hidden=(await a.query(save,['separate-a',[ga],'Unrelated group race','Hidden cuisine'])).rows[0].id;
    // A remains uncommitted. B must neither wait on its matching name/address nor
    // inherit its UUID/facts. query_timeout bounds any accidental global conflict.
    await b.query('set local statement_timeout=2000');
    const independent=(await b.query(save,['separate-b',[gb],'Unrelated group race','Own cuisine'])).rows[0].id;
    assert.notEqual(independent,hidden);
    assert.equal((await b.query('select cuisine from public.restaurants where id=$1',[independent])).rows[0].cuisine,'Own cuisine');
    assert.equal((await b.query('select count(*)::int as count from public.restaurants where id=$1',[hidden])).rows[0].count,0);
    await b.query('commit'); await a.query('commit');
    console.log('PASS race: unrelated matching saves stay independent without global uniqueness waits');

    await begin(admin,owner);
    const gc=(await admin.query("select (public.create_group('Race C')).id as id")).rows[0].id;
    await admin.query('commit');
    const wrapper="select * from public.save_restaurant_visit_with_location_bindings('multi-race',$1,'Multi race','Race address')";
    await begin(a,owner); await begin(b,owner);
    const bound=(await a.query(wrapper,[[ga,gc]])).rows[0];
    const retry=b.query(wrapper,[[gc,ga]]); await waitBlocked(b); await a.query('commit');
    assert.deepEqual((await retry).rows[0],bound); await b.query('commit');
    await begin(admin,owner);
    const targets=(await admin.query("select * from public.get_visit_save_location_targets('multi-race')")).rows;
    assert.equal(targets.length,2); assert.equal(new Set(targets.map(t=>t.restaurant_id)).size,2);
    assert.equal((await admin.query("select count(*)::int as n from public.visits v join public.group_restaurants gr on gr.id=v.group_restaurant_id join public.restaurants r on r.id=gr.restaurant_id where r.name='Multi race'")).rows[0].n,2);
    await admin.query('rollback');
    console.log('PASS race: overlapping multi-group retries preserve exactly two Visits and scoped bindings');

    await begin(a,owner); await begin(b,other);
    const membership=(await a.query('select membership_id from public.get_group_membership_targets($1) where user_id=$2',[ga,other])).rows[0].membership_id;
    await a.query('select public.remove_group_member($1,$2,$3)',[ga,other,membership]);
    const revoked=b.query(save,['revoked',[ga],'Revoked race','Denied']).then(()=>assert.fail('Revoked Member saved'),error=>assert.equal(error.code,'42501'));
    await waitBlocked(b); await a.query('commit'); await revoked; await b.query('rollback');
    assert.equal((await admin.query("select count(*)::int as n from public.restaurants where name='Revoked race'")).rows[0].n,0);
    console.log('PASS race: membership revocation wins before a waiting save; no facts are created');
}
