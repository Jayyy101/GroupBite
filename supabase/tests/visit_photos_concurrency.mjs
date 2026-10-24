import assert from 'node:assert/strict';
export async function runVisitPhotoConcurrency({admin,a,b,owner,member}) {
    assert.equal((await admin.query("select current_setting('groupbite.local_validation',true) marker")).rows[0].marker,'visit-photos');
    async function begin(c,user=owner) { await c.query('begin;set local role authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user]); }
    async function blocked(c) { for(let i=0;i<150;i++) {
        if ((await admin.query('select cardinality(pg_blocking_pids($1))>0 waiting',[c.processID])).rows[0].waiting) return;
        await new Promise(r=>setTimeout(r,20));
    } assert.fail('Expected a real parent lock wait'); }
    await begin(a);
    const group=(await a.query("select (public.create_group('Photo race')).id id")).rows[0].id;
    await a.query('commit');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[group,member]);
    const admission=(await admin.query('select membership_id from public.group_memberships where group_id=$1 and user_id=$2',[group,member])).rows[0].membership_id;
    await begin(a,member);
    const entry=(await a.query("select public.save_group_visit_destination('vp-race',$1,'Photo race cafe','Photo race address',expected_membership_id=>$2) id",[group,admission])).rows[0].id;
    const visit=(await a.query("select visit_id from public.get_add_destination_result('vp-race')")).rows[0].visit_id;
    await a.query('commit');
    const reserve=(c,id='aaaaaaaa-aaaa-4aaa-8aaa-000000000001')=>c.query("select * from public.visit_photo_command('reserve','group',$1,$2,$3,$4,$5,100,100,100,20)",[entry,visit,group,admission,id]);
    await begin(a,member);await begin(b,member);await reserve(a);
    const replay=reserve(b);await blocked(b);await a.query('commit');await replay;await b.query('commit');
    assert.equal((await admin.query('select count(*)::int n from public.visit_photos where group_visit_id=$1',[visit])).rows[0].n,1);
    console.log('PASS photo race: same identity creates one reservation');
    await begin(a,member);await begin(b,member);
    await a.query("select * from public.visit_photo_command('remove','group',$1,$2,$3,$4,'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',expected_revision=>1)",[entry,visit,group,admission]);
    const afterRemoval=reserve(b);await blocked(b);await a.query('commit');
    assert.equal((await afterRemoval).rows[0].removed,true);await b.query('commit');
    console.log('PASS photo race: reservation cannot resurrect a concurrent removal');
    await admin.query('begin');await admin.query('select id from public.groups where id=$1 for update',[group]);
    await admin.query('delete from public.group_memberships where group_id=$1 and user_id=$2',[group,member]);
    await begin(b,member);
    const revoked=reserve(b,'aaaaaaaa-aaaa-4aaa-8aaa-000000000002').then(()=>assert.fail('Revoked member reserved'),e=>assert.equal(e.code,'42501'));
    await blocked(b);await admin.query('commit');await revoked;await b.query('rollback');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[group,member]);
    await begin(b,member);await assert.rejects(reserve(b),{code:'42501'});await b.query('rollback');
    console.log('PASS photo race: membership removal and rejoin reject old upload admission');
}
