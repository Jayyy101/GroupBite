import assert from 'node:assert/strict';
export async function runGroupAppleConcurrency({ admin,a,b,owner,other,member }) {
    assert.equal((await admin.query("select current_setting('groupbite.local_validation',true) as marker")).rows[0].marker,'group-apple-place-ids');
    async function begin(c,actor) { await c.query('begin; set local role authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]); }
    async function blocked(c) {
        for(let i=0;i<150;i++) {
            if((await admin.query('select cardinality(pg_blocking_pids($1))>0 as waiting',[c.processID])).rows[0].waiting) return;
            await new Promise(r=>setTimeout(r,20));
        }
        assert.fail('Expected a real lock wait');
    }
    const save=(c,request,groups,name,id,address='Race address')=>c.query('select * from public.save_restaurant_visit_with_apple_place_id($1,$2,$3,$4,restaurant_apple_place_id=>$5)',[request,groups,name,address,id]);
    await begin(admin,owner);
    const ga=(await admin.query("select (public.create_group('Apple race A')).id as id")).rows[0].id;
    const gb=(await admin.query("select (public.create_group('Apple race B')).id as id")).rows[0].id;
    await admin.query('commit');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$3),($2,$3),($1,$4)',[ga,gb,member,other]);
    async function entry(name,group=ga) {return (await admin.query('select gr.*,r.address from public.group_restaurants gr join public.restaurants r on r.id=gr.restaurant_id where gr.group_id=$1 and r.name=$2',[group,name])).rows[0];}
    async function visits(name) {return (await admin.query('select count(*)::int as n from public.visits v join public.group_restaurants gr on gr.id=v.group_restaurant_id join public.restaurants r on r.id=gr.restaurant_id where r.name=$1',[name])).rows[0].n;}
    async function oneCard(name, groups, address='Race address') {
        for (const group of groups) {
            assert.equal((await admin.query('select count(*)::int as n from public.group_restaurants gr join public.restaurants r on r.id=gr.restaurant_id where gr.group_id=$1 and r.name=$2 and r.address=$3',
                [group,name,address])).rows[0].n,1,'Exactly one matching card in each destination');
        }
    }
    // Lost response / same request, overlapping reversed group order.
    await begin(a,owner); await begin(b,owner);
    const first=(await save(a,'apple-race-retry',[ga,gb],'Apple exact race','First')).rows[0];
    const retry=save(b,'apple-race-retry',[gb,ga],'Apple exact race','First'); await blocked(b); await a.query('commit');
    assert.deepEqual((await retry).rows[0],first); await b.query('commit'); assert.equal(await visits('Apple exact race'),2); await oneCard('Apple exact race',[ga,gb]);
    assert.equal((await entry('Apple exact race')).apple_place_id,'First');
    console.log('PASS race: reversed multi-group exact retry creates one visit per group');
    // Member/new entry wins, owner later cannot replace its ID.
    await begin(a,member); await begin(b,owner);
    await save(a,'apple-member-first',[ga],'Apple creation race','Member');
    const repeat=save(b,'apple-owner-later',[ga],'Apple creation race','Owner'); await blocked(b); await a.query('commit'); await repeat; await b.query('commit');
    assert.equal((await entry('Apple creation race')).apple_place_id,'Member'); assert.equal(await visits('Apple creation race'),2); await oneCard('Apple creation race',[ga]);
    console.log('PASS race: same exact restaurant creates one card, two visits, first ID retained');
    // Address invalidation waits for attachment, then clears it on shared rows.
    await begin(admin,owner); await save(admin,'apple-share-seed',[ga],'Apple shared race',null); await admin.query('commit');
    const shared=await entry('Apple shared race');
    await admin.query('insert into public.group_restaurants(group_id,restaurant_id,created_by,apple_place_id) values($1,$2,$3,$4)',[gb,shared.restaurant_id,owner,'Other group ID']);
    await begin(a,owner); await b.query('begin');
    await save(a,'apple-before-edit',[ga,gb],'Apple shared race','Owner fill');
    const edit=b.query('update public.restaurants set address=$1 where id=$2',['Changed address',shared.restaurant_id]); await blocked(b); await a.query('commit'); await edit; await b.query('commit');
    assert.equal((await admin.query('select count(*)::int as n from public.group_restaurants where restaurant_id=$1 and apple_place_id is not null',[shared.restaurant_id])).rows[0].n,0);
    await oneCard('Apple shared race',[ga,gb],'Changed address');
    console.log('PASS race: shared address edit waits for save then invalidates all group IDs');
    // Edit wins before old-address save: recheck after lock; no stale attachment.
    await a.query('begin'); await begin(b,owner);
    await a.query('update public.restaurants set address=$1 where id=$2',['Newer address',shared.restaurant_id]);
    const stale=save(b,'apple-after-edit',[ga,gb],'Apple shared race','New entry ID','Changed address'); await blocked(b); await a.query('commit'); await stale; await b.query('commit');
    assert.equal((await admin.query('select count(*)::int as n from public.group_restaurants where restaurant_id=$1 and apple_place_id is not null',[shared.restaurant_id])).rows[0].n,0);
    assert.equal((await entry('Apple shared race')).address,'Newer address');
    assert.equal((await admin.query("select count(*)::int as n from public.group_restaurants gr join public.restaurants r on r.id=gr.restaurant_id where r.name='Apple shared race' and r.address='Changed address' and gr.apple_place_id='New entry ID'")).rows[0].n,2);
    await oneCard('Apple shared race',[ga,gb],'Changed address');
    console.log('PASS race: old-address save after concurrent edit creates independent exact entries');
    // Shared facts: independent groups can hold SHARE locks and save concurrently.
    await begin(a,owner); await begin(b,owner);
    await save(a,'apple-independent-a',[ga],'Apple shared race','A ID','Newer address');
    await b.query('set local statement_timeout=2000'); await save(b,'apple-independent-b',[gb],'Apple shared race','B ID','Newer address');
    await b.query('commit'); await a.query('commit');
    assert.equal((await entry('Apple shared race',ga)).apple_place_id,'A ID'); assert.equal((await entry('Apple shared race',gb)).apple_place_id,'B ID');
    await oneCard('Apple shared race',[ga,gb],'Newer address');
    console.log('PASS race: independent groups sharing a Restaurant save without blocking or ID propagation');
    // A nonmatching fact edited INTO a match must be locked and rechecked too.
    await begin(admin,owner); await save(admin,'apple-incoming-seed',[ga],'Apple incoming match',null,'Before address'); await admin.query('commit');
    const incoming=await entry('Apple incoming match');
    await a.query('begin'); await begin(b,owner);
    await a.query('update public.restaurants set address=$1 where id=$2',['After address',incoming.restaurant_id]);
    const matched=save(b,'apple-incoming-save',[ga],'Apple incoming match','After ID','After address');
    await blocked(b); await a.query('commit'); await matched; await b.query('commit');
    assert.equal((await entry('Apple incoming match')).id,incoming.id);assert.equal((await entry('Apple incoming match')).apple_place_id,'After ID');
    assert.equal(await visits('Apple incoming match'),2); await oneCard('Apple incoming match',[ga],'After address');
    console.log('PASS race: previously nonmatching address edits are locked and rechecked without duplicate cards');
    // Competing owner fills: first wins, second still adds its permitted visit.
    await begin(admin,owner);await save(admin,'apple-fill-seed',[ga],'Apple fill race',null);await admin.query('commit');
    await begin(a,owner);await begin(b,owner);await save(a,'apple-fill-first',[ga],'Apple fill race','First fill');
    const later=save(b,'apple-fill-later',[ga],'Apple fill race','Later fill');await blocked(b);await a.query('commit');await later;await b.query('commit');
    assert.equal((await entry('Apple fill race')).apple_place_id,'First fill');assert.equal(await visits('Apple fill race'),3); await oneCard('Apple fill race',[ga]);
    console.log('PASS race: competing owner fills preserve first ID and all real visits');
    // Revocation wins group lock; a previously uncertain retry must still reauthorize.
    await begin(a,owner); await begin(b,member);
    const m=(await a.query('select membership_id from public.get_group_membership_targets($1) where user_id=$2',[ga,member])).rows[0].membership_id;
    await a.query('select public.remove_group_member($1,$2,$3)',[ga,member,m]);
    const denied=save(b,'apple-member-first',[ga],'Apple creation race','Member').then(()=>assert.fail('Revoked retry accepted'),e=>assert.equal(e.code,'42501'));
    await blocked(b); await a.query('commit'); await denied; await b.query('rollback');
    assert.equal(await visits('Apple creation race'),2); await oneCard('Apple creation race',[ga]);
    console.log('PASS race: revoked member cannot retry a historical successful save');
    // Ownership transfer wins before NULL fill: old owner still saves as member.
    await begin(admin,owner); await save(admin,'apple-transfer-seed',[ga],'Apple transfer race',null); await admin.query('commit');
    await begin(a,owner); await begin(b,owner);
    const target=(await a.query('select membership_id from public.get_group_membership_targets($1) where user_id=$2',[ga,other])).rows[0].membership_id;
    await a.query('select public.transfer_group_ownership($1,$2,$3)',[ga,other,target]);
    const demoted=save(b,'apple-demoted',[ga],'Apple transfer race','Old owner ID'); await blocked(b); await a.query('commit'); await demoted; await b.query('commit');
    assert.equal((await entry('Apple transfer race')).apple_place_id,null); assert.equal(await visits('Apple transfer race'),2); await oneCard('Apple transfer race',[ga]);
    console.log('PASS race: demoted owner saves visit but cannot fill shared metadata');
}
