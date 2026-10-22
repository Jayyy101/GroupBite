import assert from 'node:assert/strict';

export async function runStructuredMapkitConcurrency({admin,a,b,owner,member}) {
    assert.equal((await admin.query("select current_setting('groupbite.local_validation',true) marker")).rows[0].marker,'structured-mapkit');
    async function begin(c,user=owner){await c.query('begin; set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);}
    async function blocked(c){for(let i=0;i<150;i++){
        if((await admin.query('select cardinality(pg_blocking_pids($1))>0 waiting',[c.processID])).rows[0].waiting)return;
        await new Promise(r=>setTimeout(r,20));
    }assert.fail('Expected a real database lock wait');}
    await begin(a);
    const group=(await a.query("select (public.create_group('Structured concurrency')).id id")).rows[0].id;
    const membership=(await a.query('select membership_id from public.group_memberships where group_id=$1 and user_id=$2',[group,owner])).rows[0].membership_id;
    await a.query('commit');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[group,member]);
    const memberAdmission=(await admin.query('select membership_id from public.group_memberships where group_id=$1 and user_id=$2',[group,member])).rows[0].membership_id;
    const personal=(c,request,city='Native City',latitude=37.55)=>c.query(`select public.save_personal_visit_with_mapkit_location(
        $1,'Structured race','Structured display',null,null,null,null,null,null,null,$2,-122.12,jsonb_build_object('city',$3::text)) id`,[request,latitude,city]);
    const save=(c,request,city='Native City',admission=membership)=>c.query(`select public.save_group_visit_with_mapkit_location(
        $1,$2,'Structured group race','Structured group display',null,null,null,null,null,null,null,$3,37.55,-122.12,jsonb_build_object('city',$4::text)) id`,[request,group,admission,city]);
    for(const [label,write] of [['personal',personal],['group',save]]) {
        await begin(a);await begin(b);
        const request='sm-race-'+label,id=(await write(a,request)).rows[0].id;
        const replay=write(b,request);await blocked(b);await a.query('commit');
        assert.equal((await replay).rows[0].id,id);await b.query('commit');
        const table=label==='personal'?'personal_visits':'visits',column=label==='personal'?'personal_place_id':'group_restaurant_id';
        assert.equal((await admin.query(`select count(*)::int n from public.${table} where ${column}=$1`,[id])).rows[0].n,1);
        console.log(`PASS structured ${label} race: same request stores one visit and one immutable location proof`);
        await begin(a);await begin(b);await write(a,request+'-changed');
        const mismatch=write(b,request+'-changed','Different City').then(()=>assert.fail('Changed metadata replayed'),e=>assert.equal(e.code,'22023'));
        await blocked(b);await a.query('commit');await mismatch;await b.query('rollback');
        console.log(`PASS structured ${label} race: metadata mismatch cannot reuse a concurrent request`);
    }
    await begin(a);await begin(b);
    await save(a,'sm-race-conflict-a');
    const conflict=save(b,'sm-race-conflict-b','Other City').then(()=>assert.fail('Replaced saved metadata'),e=>assert.equal(e.code,'GB001'));
    await blocked(b);await a.query('commit');await conflict;await b.query('rollback');
    assert.equal((await admin.query("select count(*)::int n from public.add_destination_requests where request_id='sm-race-conflict-b'")).rows[0].n,0);
    console.log('PASS structured group race: conflict rolls back the new visit and all receipts');

    const entry=(await admin.query('select gr.id,gr.restaurant_id from public.group_restaurants gr where gr.group_id=$1',[group])).rows[0];
    await admin.query('begin');await admin.query("update public.restaurants set address='Changed structured display' where id=$1",[entry.restaurant_id]);
    await begin(b);
    const stale=b.query(`select public.save_group_visit_with_mapkit_location(
        'sm-race-stale',$1,'Structured group race','Structured group display',null,null,null,null,null,null,$2,$3,37.55,-122.12,null)`,[group,entry.id,membership])
        .then(()=>assert.fail('Stale snapshot saved'),e=>assert.equal(e.code,'40001'));
    await blocked(b);await admin.query('commit');await stale;await b.query('rollback');
    assert.equal((await admin.query('select count(*)::int n from public.group_mapkit_locations where group_restaurant_id=$1',[entry.id])).rows[0].n,0);
    console.log('PASS structured group race: address edit invalidates location and rejects a waiting stale selection');

    await admin.query('begin');await admin.query('select id from public.groups where id=$1 for update',[group]);
    await admin.query('delete from public.group_memberships where group_id=$1 and user_id=$2',[group,member]);
    await begin(b,member);
    const revoked=save(b,'sm-race-revoked','Native City',memberAdmission).then(()=>assert.fail('Revoked member saved'),e=>assert.equal(e.code,'42501'));
    await blocked(b);await admin.query('commit');await revoked;await b.query('rollback');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[group,member]);
    await begin(b,member);await assert.rejects(save(b,'sm-race-rejoined','Native City',memberAdmission),{code:'42501'});await b.query('rollback');
    console.log('PASS structured group race: removed/rejoined member cannot save with an old admission');
}
