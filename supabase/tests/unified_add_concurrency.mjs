import assert from 'node:assert/strict';
// Reuse the existing owned disposable PostgreSQL runner and its three sessions.
export async function runUnifiedAddConcurrency({admin,a,b,owner,other}) {
    assert.equal((await admin.query("select current_setting('groupbite.local_validation',true) marker")).rows[0].marker,'m18-unified-add');
    async function begin(c,actor){await c.query('begin; set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);}
    async function blocked(c){for(let i=0;i<150;i++){if((await admin.query('select cardinality(pg_blocking_pids($1))>0 waiting',[c.processID])).rows[0].waiting)return;await new Promise(r=>setTimeout(r,20));}assert.fail('Expected a real lock wait');}
    const personal=(c,id,name='M18 personal race')=>c.query('select public.save_personal_visit($1,$2,$3) id',[id,name,'M18 race address']);
    const groupSave=(c,id,g,m,name='M18 group race')=>c.query('select public.save_group_visit_destination($1,$2,$3,$4,expected_membership_id=>$5) id',[id,g,name,'M18 race address',m]);
    await begin(a,owner);await begin(b,owner);
    const first=(await personal(a,'m18-race-same')).rows[0].id;
    const retry=personal(b,'m18-race-same');await blocked(b);await a.query('commit');assert.equal((await retry).rows[0].id,first);await b.query('commit');
    assert.equal((await admin.query('select count(*)::int n from public.personal_visits where personal_place_id=$1',[first])).rows[0].n,1);
    console.log('PASS M18 race: same personal request creates one card, one visit and one receipt');
    await begin(a,owner);await begin(b,owner);await personal(a,'m18-race-repeat-a');
    const repeat=personal(b,'m18-race-repeat-b');await blocked(b);await a.query('commit');assert.equal((await repeat).rows[0].id,first);await b.query('commit');
    assert.equal((await admin.query('select count(*)::int n from public.personal_visits where personal_place_id=$1',[first])).rows[0].n,3);
    console.log('PASS M18 race: distinct personal repeat requests share a card and retain independent visits');
    await begin(admin,owner);const ga=(await admin.query("select (public.create_group('M18 race group')).id id")).rows[0].id;await admin.query('commit');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[ga,other]);
    const admission=(await admin.query('select membership_id from public.group_memberships where group_id=$1 and user_id=$2',[ga,owner])).rows[0].membership_id;
    const otherAdmission=(await admin.query('select membership_id from public.group_memberships where group_id=$1 and user_id=$2',[ga,other])).rows[0].membership_id;
    await begin(a,owner);await begin(b,owner);const entry=(await groupSave(a,'m18-group-race-same',ga,admission)).rows[0].id;
    const groupRetry=groupSave(b,'m18-group-race-same',ga,admission);await blocked(b);await a.query('commit');assert.equal((await groupRetry).rows[0].id,entry);await b.query('commit');
    assert.equal((await admin.query('select count(*)::int n from public.visits where group_restaurant_id=$1',[entry])).rows[0].n,1);
    console.log('PASS M18 race: same group request commits exactly one legacy/recovery receipt, binding and visit');
    await begin(a,owner);await begin(b,other);await a.query('select public.remove_group_member($1,$2,$3)',[ga,other,otherAdmission]);
    const denied=groupSave(b,'m18-revoked-race',ga,otherAdmission).then(()=>assert.fail('Revoked save accepted'),e=>assert.equal(e.code,'42501'));
    await blocked(b);await a.query('commit');await denied;await b.query('rollback');
    console.log('PASS M18 race: revoked admission cannot save after waiting for the group lock');
    await begin(a,owner);await begin(b,owner);await personal(a,'m18-cross-scope-request','M18 collision personal');
    const collision=groupSave(b,'m18-cross-scope-request',ga,admission,'M18 collision group').then(()=>assert.fail('Request collision accepted'),e=>assert.equal(e.code,'23505'));
    await blocked(b);await a.query('commit');await collision;await b.query('rollback');
    assert.equal((await admin.query("select count(*)::int n from public.visit_save_requests where request_id='m18:m18-cross-scope-request'")).rows[0].n,0);
    assert.equal((await admin.query("select count(*)::int n from public.add_destination_requests where request_id='m18-cross-scope-request'")).rows[0].n,1);
    console.log('PASS M18 race: cross-destination request collision rolls back the losing visit and legacy receipt');
    await begin(a,owner);await begin(b,owner);
    await groupSave(a,'m18-group-repeat-a',ga,admission);
    const groupRepeat=groupSave(b,'m18-group-repeat-b',ga,admission);await blocked(b);await a.query('commit');
    assert.equal((await groupRepeat).rows[0].id,entry);await b.query('commit');
    assert.equal((await admin.query('select count(*)::int n from public.visits where group_restaurant_id=$1',[entry])).rows[0].n,3);
    console.log('PASS M18 race: distinct group requests share one card and keep all independent visits');

    await begin(a,owner);await begin(b,owner);
    await personal(a,'m18-independent-personal','M18 parallel personal');
    await b.query('set local statement_timeout=2000');await groupSave(b,'m18-independent-group',ga,admission,'M18 parallel group');
    await b.query('commit');await a.query('commit');
    console.log('PASS M18 race: one actor can commit unrelated personal and group destinations independently');

    const revision=(await admin.query('select revision from public.personal_places where id=$1',[first])).rows[0].revision;
    await begin(a,owner);await begin(b,owner);await personal(a,'m18-before-delete');
    const staleDelete=b.query('select public.delete_personal_place($1,$2) removed',[first,revision]);
    await blocked(b);await a.query('commit');assert.equal((await staleDelete).rows[0].removed,false);await b.query('commit');
    assert.equal((await admin.query('select count(*)::int n from public.personal_visits where personal_place_id=$1',[first])).rows[0].n,4);
    console.log('PASS M18 race: stale whole-card deletion cannot erase a concurrent new personal visit');

    await begin(a,owner);await begin(b,owner);
    const currentRevision=(await a.query('select revision from public.personal_places where id=$1',[first])).rows[0].revision;
    await a.query('select public.update_personal_place($1,$2,$3,$4)',[first,currentRevision,'M18 personal race','M18 changed address']);
    const staleSource=b.query('select public.save_personal_visit($1,$2,$3,target_entry_id=>$4)',
        ['m18-stale-source-race','M18 personal race','M18 race address',first])
        .then(()=>assert.fail('Stale source accepted'),e=>assert.equal(e.code,'40001'));
    await blocked(b);await a.query('commit');await staleSource;await b.query('rollback');
    console.log('PASS M18 race: changed personal source is rechecked after the owner lock');

    // Independent commits are the actual multi-destination contract. A later
    // denied destination must not undo either successful destination or receipt.
    await begin(a,owner);const privateEntry=(await a.query("select public.save_personal_visit('m18-multi-personal','M18 multi','M18 multi address',visit_notes=>'PRIVATE ONLY') id")).rows[0].id;await a.query('commit');
    await begin(a,owner);const sharedEntry=(await a.query("select public.save_group_visit_destination('m18-multi-group',$1,'M18 multi','M18 multi address',visit_notes=>'SHARED ONLY',expected_membership_id=>$2) id",[ga,admission])).rows[0].id;await a.query('commit');
    await begin(a,owner);await assert.rejects(groupSave(a,'m18-multi-denied',ga,otherAdmission),{code:'42501'});await a.query('rollback');
    assert.equal((await admin.query("select count(*)::int n from public.add_destination_requests where user_id=$1 and request_id in ('m18-multi-personal','m18-multi-group')",[owner])).rows[0].n,2);
    assert.equal((await admin.query('select notes from public.personal_visits where personal_place_id=$1',[privateEntry])).rows[0].notes,'PRIVATE ONLY');
    assert.equal((await admin.query('select notes from public.visits where group_restaurant_id=$1',[sharedEntry])).rows[0].notes,'SHARED ONLY');
    assert.equal((await admin.query("select count(*)::int n from public.add_destination_requests where request_id='m18-multi-denied'")).rows[0].n,0);
    console.log('PASS M18 independent commits: later destination denial preserves successful visits, private note isolation and receipts');
}
