import assert from 'node:assert/strict';

export async function runVisitEventConcurrency({admin,a,b,owner,member,other}) {
    assert.equal((await admin.query("select current_setting('groupbite.local_validation',true) marker")).rows[0].marker,'visit-events');
    async function begin(c,user=owner){await c.query('begin; set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);}
    async function blocked(c){for(let i=0;i<150;i++){
        if((await admin.query('select cardinality(pg_blocking_pids($1))>0 waiting',[c.processID])).rows[0].waiting)return;
        await new Promise(r=>setTimeout(r,20));
    }assert.fail('Expected a real lock wait');}
    const save=(c,event,request)=>c.query("select public.save_visit_event_destination($1,$2,'personal','Event race','Race address',visit_date=>'2026-10-22') id",[event,request]);
    await begin(a);await begin(b);
    const id=(await save(a,'ve-race-event','ve-race-request')).rows[0].id;
    const replay=save(b,'ve-race-event','ve-race-request');await blocked(b);await a.query('commit');
    assert.equal((await replay).rows[0].id,id);await b.query('commit');
    assert.equal((await admin.query('select count(*)::int n from public.personal_visits where personal_place_id=$1',[id])).rows[0].n,1);
    console.log('PASS event race: identical request/event commits one visit and link');

    await begin(a);await begin(b);await save(a,'ve-race-scope','ve-race-scope-a');
    const duplicate=save(b,'ve-race-scope','ve-race-scope-b').then(()=>assert.fail('Duplicate destination accepted'),e=>assert.equal(e.code,'22023'));
    await blocked(b);await a.query('commit');await duplicate;await b.query('rollback');
    assert.equal((await admin.query("select count(*)::int n from public.add_destination_requests where request_id='ve-race-scope-b'")).rows[0].n,0);
    console.log('PASS event race: new request cannot add a second copy to one destination');

    await begin(a);await begin(b);await save(a,'ve-race-claim-a','ve-race-claim');
    const relink=save(b,'ve-race-claim-b','ve-race-claim').then(()=>assert.fail('Concurrent request relinked'),e=>assert.equal(e.code,'22023'));
    await blocked(b);await a.query('commit');await relink;await b.query('rollback');
    assert.equal((await admin.query("select event_id from public.visit_event_destinations where user_id=$1 and request_id='ve-race-claim'",[owner])).rows[0].event_id,'ve-race-claim-a');
    assert.equal((await admin.query("select count(*)::int n from public.visit_events where user_id=$1 and event_id='ve-race-claim-b'",[owner])).rows[0].n,0);
    console.log('PASS event race: competing event cannot steal an immutable destination receipt');

    await begin(a);
    const group=(await a.query("select (public.create_group('Event race group')).id id")).rows[0].id;
    const ownerAdmission=(await a.query('select membership_id from public.group_memberships where group_id=$1 and user_id=$2',[group,owner])).rows[0].membership_id;
    await a.query('commit');
    await begin(a);await begin(b);await save(a,'ve-race-shared','ve-race-shared-personal');
    const differentDestination=b.query("select public.save_visit_event_destination('ve-race-shared','ve-race-shared-group','group','Event race','Race address',visit_date=>'2026-10-22',target_group_id=>$1,expected_membership_id=>$2)",[group,ownerAdmission]);
    await blocked(b);await a.query('commit');await differentDestination;await b.query('commit');
    assert.equal((await admin.query("select count(*)::int n from public.visit_event_destinations where user_id=$1 and event_id='ve-race-shared'",[owner])).rows[0].n,2);
    await begin(a);const summary=(await a.query('select * from public.get_my_visit_event_summary()')).rows[0];await a.query('commit');
    assert.equal(Number(summary.linked_events),4);assert.equal(Number(summary.linked_records),5);
    console.log('PASS event race: concurrent destinations retain two receipts and one shared occasion');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[group,member]);
    const admission=(await admin.query('select membership_id from public.group_memberships where group_id=$1 and user_id=$2',[group,member])).rows[0].membership_id;
    const groupSave=(c,request)=>c.query("select public.save_visit_event_destination('ve-race-member',$1,'group','Member event','Member address',target_group_id=>$2,expected_membership_id=>$3)",[request,group,admission]);
    await admin.query('begin');await admin.query('select id from public.groups where id=$1 for update',[group]);
    await admin.query('delete from public.group_memberships where group_id=$1 and user_id=$2',[group,member]);
    await begin(b,member);
    const revoked=groupSave(b,'ve-race-revoked').then(()=>assert.fail('Revoked member saved'),e=>assert.equal(e.code,'42501'));
    await blocked(b);await admin.query('commit');await revoked;await b.query('rollback');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[group,member]);
    await begin(b,member);await assert.rejects(groupSave(b,'ve-race-rejoined'),{code:'42501'});await b.query('rollback');
    assert.equal((await admin.query("select count(*)::int n from public.visit_events where user_id=$1 and event_id='ve-race-member'",[member])).rows[0].n,0);
    console.log('PASS event race: removal/rejoin rejects stale admission and rolls back supplemental proof');
    // Mixed-version writers share destination locks, not event locks. Exercise
    // both winners, plus either transaction aborting, for every legacy entry point.
    for (const mode of ['personal','personal-point','personal-structured','group','group-structured']) {
        const kind=mode.startsWith('personal')?'personal':'group',mapped=mode.includes('-');
        const column=kind==='personal'?'personal_place_id':'group_restaurant_id',table=kind==='personal'?'personal_visits':'visits';
        for (const order of ['legacy-first','event-first','legacy-rollback','event-rollback']) {
            const request=`ve-mixed-${mode}-${order}`,event=request+'-event',name='Mixed '+request;
            const legacy=(c)=>kind==='personal'
                ? c.query(`select public.${mode==='personal'?'save_personal_visit':mode==='personal-point'?'save_personal_visit_with_mapkit_point':'save_personal_visit_with_mapkit_location'}(
                    $1,$2,'Mixed address',null,null,null,null,null,null,null${mapped?',37,-122':''}${mode==='personal-structured'?',null':''}) id`,[request,name])
                : c.query(`select public.${mapped?'save_group_visit_with_mapkit_location':'save_group_visit_destination'}(
                    $1,$2,$3,'Mixed address',null,null,null,null,null,null,null,$4${mapped?',37,-122,null':''}) id`,[request,group,name,ownerAdmission]);
            const linked=(c)=>c.query(`select public.save_visit_event_destination($1,$2,$3,$4,'Mixed address',
                target_group_id=>$5,expected_membership_id=>$6,selected_latitude=>$7,selected_longitude=>$8) id`,
                [event,request,kind,name,kind==='group'?group:null,kind==='group'?ownerAdmission:null,mapped?37:null,mapped?-122:null]);
            await begin(a);await begin(b);
            const legacyWins=order.startsWith('legacy'),aborted=order.endsWith('rollback');
            await (legacyWins?legacy(a):linked(a));
            const waiter=(legacyWins?linked(b):legacy(b)).then(r=>({ok:true,id:r.rows[0].id}),e=>({ok:false,code:e.code}));
            await blocked(b);await a.query(aborted?'rollback':'commit');
            const outcome=await waiter;
            if(legacyWins&&!aborted) {
                assert.deepEqual(outcome,{ok:false,code:'22023'});await b.query('rollback');
            } else {assert(outcome.ok,`${mode}/${order} failed: ${outcome.code}`);await b.query('commit');}
            const receipt=(await admin.query('select to_jsonb(r) row from public.add_destination_requests r where user_id=$1 and request_id=$2',[owner,request])).rows[0].row;
            const before=structuredClone(receipt);
            const linkCount=(await admin.query('select count(*)::int n from public.visit_event_destinations where user_id=$1 and request_id=$2',[owner,request])).rows[0].n;
            const shouldLink=order==='event-first'||order==='legacy-rollback';
            assert.equal(linkCount,Number(shouldLink));
            assert.equal((await admin.query('select count(*)::int n from public.visit_events where user_id=$1 and event_id=$2',[owner,event])).rows[0].n,Number(shouldLink));
            assert.equal((await admin.query(`select count(*)::int n from public.${table} where ${column}=$1`,[receipt.entry_id])).rows[0].n,1);
            // A later historical retry cannot link an old receipt; a linked retry
            // keeps both the original receipt and exactly one event association.
            await begin(a);
            if(shouldLink) {assert.equal((await linked(a)).rows[0].id,receipt.entry_id);await a.query('commit');}
            else {await assert.rejects(linked(a),{code:'22023'});await a.query('rollback');}
            await begin(a);assert.equal((await legacy(a)).rows[0].id,receipt.entry_id);await a.query('commit');
            assert.deepEqual((await admin.query('select to_jsonb(r) row from public.add_destination_requests r where user_id=$1 and request_id=$2',[owner,request])).rows[0].row,before);
            assert.equal((await admin.query(`select count(*)::int n from public.${table} where ${column}=$1`,[receipt.entry_id])).rows[0].n,1);
            console.log(`PASS mixed ${mode}/${order}: eligibility, rollback, historical protection and immutable retries`);
        }
    }
    // Identical caller-supplied strings cannot couple different accounts or
    // cause the destination owner lock to become a cross-account global lock.
    await begin(a,owner);await begin(b,other);
    const first=(await save(a,'ve-account-event','ve-account-request')).rows[0].id;
    const second=(await save(b,'ve-account-event','ve-account-request')).rows[0].id;
    assert.notEqual(first,second);await a.query('commit');await b.query('commit');
    const scopes=(await admin.query("select user_id from public.visit_event_destinations where request_id='ve-account-request' order by user_id")).rows;
    assert.deepEqual(scopes.map(r=>r.user_id),[owner,other].sort());
    console.log('PASS mixed account boundary: concurrent equal IDs remain independent and private');

}
