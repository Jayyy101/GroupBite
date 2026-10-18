import assert from 'node:assert/strict';

export async function runMapkitLocationConcurrency({admin,a,b,owner}) {
    assert.equal((await admin.query("select current_setting('groupbite.local_validation',true) marker")).rows[0].marker,'m18-mapkit-locations');
    async function begin(c){await c.query('begin; set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);}
    async function blocked(c){for(let i=0;i<150;i++){
        if((await admin.query('select cardinality(pg_blocking_pids($1))>0 waiting',[c.processID])).rows[0].waiting)return;
        await new Promise(r=>setTimeout(r,20));
    }assert.fail('Expected a real lock wait');}
    const save=(c,request,latitude=37.55)=>c.query(`select public.save_personal_visit_with_mapkit_point(
        $1,'Native race','Native race address',null,null,null,null,null,null,null,$2,-122.12) id`,[request,latitude]);
    await begin(a);await begin(b);
    const id=(await save(a,'mapkit-race-same')).rows[0].id;
    const retry=save(b,'mapkit-race-same');await blocked(b);await a.query('commit');
    assert.equal((await retry).rows[0].id,id);await b.query('commit');
    const counts=async()=>(await admin.query(`select
        (select count(*)::int from public.personal_visits where personal_place_id=$1) visits,
        (select count(*)::int from public.personal_mapkit_locations where personal_place_id=$1) points,
        (select count(*)::int from public.personal_mapkit_save_requests where request_id like 'mapkit-race-%') proofs`,[id])).rows[0];
    assert.deepEqual(await counts(),{visits:1,points:1,proofs:1});
    console.log('PASS MapKit race: concurrent same request commits one card, visit, point and coordinate proof');

    await begin(a);await begin(b);await save(a,'mapkit-race-different-point');
    const collision=save(b,'mapkit-race-different-point',38).then(()=>assert.fail('Changed coordinates accepted'),e=>assert.equal(e.code,'22023'));
    await blocked(b);await a.query('commit');await collision;await b.query('rollback');
    assert.deepEqual(await counts(),{visits:2,points:1,proofs:2});
    console.log('PASS MapKit race: changed coordinates cannot reuse a concurrent request');

    await begin(a);await begin(b);await save(a,'mapkit-race-repeat-a',38);
    const repeat=save(b,'mapkit-race-repeat-b',39);await blocked(b);await a.query('commit');
    assert.equal((await repeat).rows[0].id,id);await b.query('commit');
    assert.deepEqual(await counts(),{visits:4,points:1,proofs:4});
    assert.equal((await admin.query('select latitude from public.personal_mapkit_locations where personal_place_id=$1',[id])).rows[0].latitude,37.55);
    console.log('PASS MapKit race: intentional visits share the card without moving its first point');

    await begin(a);await begin(b);
    const revision=(await a.query('select revision from public.personal_places where id=$1',[id])).rows[0].revision;
    await a.query("select public.update_personal_place($1,$2,'Native race','Changed native race address')",[id,revision]);
    const stale=b.query("select public.set_personal_mapkit_location($1,$2,'Native race address',37,-122)",[id,revision])
        .then(()=>assert.fail('Stale repair accepted'),e=>assert.equal(e.code,'40001'));
    await blocked(b);await a.query('commit');await stale;await b.query('rollback');
    assert.equal((await admin.query('select count(*)::int n from public.personal_mapkit_locations where personal_place_id=$1',[id])).rows[0].n,0);
    console.log('PASS MapKit race: stale repair cannot attach coordinates after an address edit');

    await begin(a);await begin(b);
    const current=(await a.query('select revision from public.personal_places where id=$1',[id])).rows[0].revision;
    assert.equal((await a.query("select public.set_personal_mapkit_location($1,$2,'Changed native race address',37,-122) added",[id,current])).rows[0].added,true);
    const repair=b.query("select public.set_personal_mapkit_location($1,$2,'Changed native race address',38,-121) added",[id,current]);
    await blocked(b);await a.query('commit');assert.equal((await repair).rows[0].added,false);await b.query('commit');
    assert.deepEqual(await counts(),{visits:4,points:1,proofs:4});
    assert.equal((await admin.query('select revision from public.personal_places where id=$1',[id])).rows[0].revision,current);
    console.log('PASS MapKit race: concurrent location-only repair preserves IDs, visits and revision; first resolution wins');
}
