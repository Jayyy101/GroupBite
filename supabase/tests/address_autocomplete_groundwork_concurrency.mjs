// Committed synthetic fixtures and real lock waits; explicitly disposable local harness only.
export async function runAddressAutocompleteGroundworkConcurrency({ admin, a, b, owner, member, other }) {
    const assert = (ok, label) => { if (!ok) throw new Error(label); };
    assert((await admin.query("select current_setting('groupbite.local_validation',true) as enabled")).rows[0].enabled === 'address-autocomplete-groundwork',
        'Requires explicit disposable local validation setup');
    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    const save = "select * from public.save_restaurant_visit_with_location_bindings($1,$2::uuid[],$3,'Binding race address',visit_rating=>4,visit_notes=>$1)";
    const legacy = "select public.save_restaurant_visit($1,$2::uuid[],$3,'Binding race address',visit_rating=>4,visit_notes=>$1) as restaurant_id";
    const reserve = 'select * from public.reserve_geoapify_request($1)';
    let raceCount = 0;
    async function begin(client, role = 'authenticated', user = owner, isolation = 'read committed') {
        assert(['authenticated','service_role'].includes(role), 'Explicit test role');
        assert(['read committed','repeatable read','serializable'].includes(isolation), 'Explicit test isolation');
        await client.query('begin isolation level ' + isolation + '; set local role ' + role);
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    }
    async function overlap(first, second, { firstRole='authenticated', secondRole='authenticated',
        firstUser=owner, secondUser=owner, errorState, rollback=false, waitExtra=0 } = {}) {
        await begin(a,firstRole,firstUser); await begin(b,secondRole,secondUser);
        const initial = await first(a);
        const pending = second(b).then(value=>({ value }),error=>({ error }));
        let waited = false;
        for (let attempt=0; attempt<60; attempt++) {
            if ((await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[bPid])).rows[0]?.wait_event_type==='Lock') {
                waited=true; break;
            }
            await new Promise(resolve=>setTimeout(resolve,25));
        }
        assert(waited,'Second operation must actually wait on a database lock');
        if (waitExtra) await new Promise(resolve=>setTimeout(resolve,waitExtra));
        await a.query(rollback?'rollback':'commit');
        const result=await pending;
        if (errorState) {
            assert(result.error?.code===errorState,'Waiting operation must fail with '+errorState+': '+result.error?.message);
            await b.query('rollback');
        } else {
            if (result.error) throw result.error;
            await b.query('commit');
        }
        raceCount++;
        return { initial, next:result.value };
    }
    async function fixture(label,two=false) {
        await begin(admin);
        const groups=[(await admin.query("select (public.create_group('Binding race '||$1)).id as id",[label])).rows[0].id];
        if (two) groups.push((await admin.query("select (public.create_group('Binding race second '||$1)).id as id",[label])).rows[0].id);
        await admin.query('commit');
        return { groups, group:groups[0], name:'Binding race '+label, request:'m9-race-'+label };
    }
    const args=f=>[f.request,f.groups,f.name];
    async function saveFixture(f,user=owner,old=false) {
        await begin(admin,'authenticated',user);
        const row=(await admin.query(old?legacy:save,args(f))).rows[0];
        await admin.query('commit');
        const entry=(await admin.query('select gr.id,v.id as visit from public.group_restaurants gr join public.visits v on v.group_restaurant_id=gr.id where gr.group_id=$1 and gr.restaurant_id=$2',[f.group,row.restaurant_id])).rows[0];
        return Object.assign(f,{ restaurant:row.restaurant_id,entry:entry.id,visit:entry.visit });
    }
    const drop=(c,f)=>c.query('select public.delete_group_visit($1,$2,$3)',[f.group,f.entry,f.visit]);
    async function targets(f,user=owner) {
        await begin(admin,'authenticated',user);
        const rows=(await admin.query('select * from public.get_visit_save_location_targets($1)',[f.request])).rows;
        await admin.query('commit'); return rows;
    }
    const bindingRows=f=>admin.query('select * from public.visit_save_location_bindings where user_id=$1 and request_id=$2 order by group_id',[owner,f.request]);
    async function addMember(f) {
        for (const group of f.groups) await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[group,member]);
        return (await admin.query('select membership_id from public.group_memberships where group_id=$1 and user_id=$2',[f.group,member])).rows[0].membership_id;
    }

    let f=await fixture('legacy-first',true);
    let result=await overlap(c=>c.query(legacy,args(f)),c=>c.query(save,args(f)));
    assert(!result.next.rows[0].bindings_recorded && (await bindingRows(f)).rowCount===0,
        'Receipt committed by legacy writer during wait must not be inferred');
    f=await fixture('wrapper-first',true);
    result=await overlap(c=>c.query(save,args(f)),c=>c.query(legacy,args(f)));
    assert(result.initial.rows[0].bindings_recorded && result.next.rows[0].restaurant_id===result.initial.rows[0].restaurant_id
        && (await bindingRows(f)).rowCount===2,'Old RPC retry preserves wrapper bindings and original receipt');
    f=await fixture('reversed-retry',true);
    result=await overlap(c=>c.query(save,args(f)),c=>c.query(save,[f.request,[...f.groups].reverse(),f.name]));
    assert(result.initial.rows[0].bindings_recorded && result.next.rows[0].bindings_recorded
        && (await bindingRows(f)).rowCount===2 && (await admin.query('select count(*)::int as n from public.visits where notes=$1',[f.request])).rows[0].n===2,
        'Concurrent reversed multi-group retries have exactly two Visits/bindings');
    f=await fixture('legacy-rollback');
    result=await overlap(c=>c.query(legacy,args(f)),c=>c.query(save,args(f)),{rollback:true});
    assert(result.next.rows[0].bindings_recorded && (await bindingRows(f)).rowCount===1,
        'Rolled-back legacy receipt allows atomic fresh binding');
    f=await fixture('wrapper-rollback',true);
    result=await overlap(c=>c.query(save,args(f)),c=>c.query(save,args(f)),{rollback:true});
    assert(result.next.rows[0].bindings_recorded && (await bindingRows(f)).rowCount===2,
        'Rolled-back wrapper leaves no receipt or immutable binding obstruction');

    f=await fixture('changed-payload',true);
    await overlap(c=>c.query(save,args(f)),c=>c.query(save,[f.request,[f.groups[1]],f.name]),{errorState:'22023'});
    assert((await bindingRows(f)).rowCount===2,'Payload mismatch never replaces original multi-group bindings');
    f=await fixture('disjoint-receipt',true);
    await overlap(c=>c.query(save,[f.request,[f.group],f.name]),c=>c.query(save,[f.request,[f.groups[1]],f.name]),{errorState:'22023'});
    assert((await bindingRows(f)).rowCount===1,'Disjoint group receipt contention cannot bind mismatched payload');

    f=await saveFixture(await fixture('delete-first'));
    const original=f.entry;
    result=await overlap(c=>drop(c,f),c=>c.query(save,args(f)));
    assert(result.next.rows[0].bindings_recorded && (await targets(f)).length===0
        && (await bindingRows(f)).rows[0].group_restaurant_id===original,'Retry after final deletion retains non-attachable historical identity');
    await begin(admin);
    await admin.query(save,['m9-recreated-race',f.groups,f.name]);
    await admin.query('commit');
    assert((await targets(f)).length===0,'Recreated entry must never become an original receipt target');
    await begin(admin,'service_role');
    let failure;
    try { await admin.query("select public.attach_verified_restaurant_location($1,$2,$3,$4,'Binding race address',0,0,'synthetic','stale','Address','building')",[owner,f.group,f.restaurant,original]); }
    catch(error) { failure=error; }
    await admin.query('rollback');
    assert(failure?.code==='42501','Historical binding cannot attach to recreated entry');

    f=await saveFixture(await fixture('retry-before-delete'));
    result=await overlap(c=>c.query(save,args(f)),c=>drop(c,f));
    assert(result.initial.rows[0].bindings_recorded && (await targets(f)).length===0,'Deletion after retry invalidates target without rewriting binding');
    f=await saveFixture(await fixture('legacy-recreated'),owner,true);
    result=await overlap(async c=>{ await drop(c,f); return c.query(legacy,['m9-legacy-replacement',f.groups,f.name]); },c=>c.query(save,args(f)));
    assert(!result.next.rows[0].bindings_recorded && (await targets(f)).length===0,'Legacy deletion/recreation during wait never upgrades old receipt');

    f=await fixture('remove-before-save',true);
    let membership=await addMember(f);
    await overlap(c=>c.query('select public.remove_group_member($1,$2,$3)',[f.group,member,membership]),
        c=>c.query(save,args(f)),{secondUser:member,errorState:'42501'});
    assert((await admin.query('select * from public.visit_save_requests where user_id=$1 and request_id=$2',[member,f.request])).rowCount===0,
        'Membership revoked during wait aborts entire multi-group save');
    f=await fixture('save-before-remove',true);
    membership=await addMember(f);
    await overlap(c=>c.query(save,args(f)),c=>c.query('select public.remove_group_member($1,$2,$3)',[f.group,member,membership]),{firstUser:member});
    assert((await targets(f,member)).length===1 && (await targets(f,member))[0].group_id===f.groups[1],
        'Bindings committed before revocation expose only remaining group');
    f=await fixture('leave-before-save');
    membership=await addMember(f);
    await overlap(c=>c.query('select public.leave_group($1,$2)',[f.group,membership]),c=>c.query(save,args(f)),
        {firstUser:member,secondUser:member,errorState:'42501'});
    f=await fixture('save-before-leave');
    membership=await addMember(f);
    await overlap(c=>c.query(save,args(f)),c=>c.query('select public.leave_group($1,$2)',[f.group,membership]),{firstUser:member,secondUser:member});
    assert((await targets(f,member)).length===0,'Departure after save hides binding even with retained Visit/receipt');

    f=await fixture('same-group-users');
    await addMember(f);
    result=await overlap(c=>c.query(save,args(f)),c=>c.query(save,args(f)),{secondUser:member});
    assert(result.initial.rows[0].restaurant_id===result.next.rows[0].restaurant_id
        && (await targets(f))[0].group_restaurant_id===(await targets(f,member))[0].group_restaurant_id,
        'Independent account receipts safely bind the same reused group entry');
    f=await fixture('cross-group-reuse',true);
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$2)',[f.groups[1],other]);
    result=await overlap(c=>c.query(save,[f.request,[f.group],f.name]),c=>c.query(save,[f.request,[f.groups[1]],f.name]),{secondUser:other});
    const ours=await targets(f),theirs=await targets(f,other);
    assert(result.initial.rows[0].restaurant_id===result.next.rows[0].restaurant_id && ours.length===1 && theirs.length===1
        && ours[0].group_restaurant_id!==theirs[0].group_restaurant_id,'Cross-group global reuse never merges exact bindings');

    const limiterRoles={firstRole:'service_role',secondRole:'service_role'};
    async function seed(actor,n,age='2 hours') {
        await admin.query('truncate public.geoapify_request_admissions');
        await admin.query("insert into public.geoapify_request_admissions(user_id,admitted_at,permit_expires_at) select $1,clock_at-$3::interval,clock_at-$3::interval+interval '1 second' from (select clock_timestamp() as clock_at) t cross join generate_series(1,$2)",[actor,n,age]);
    }
    await seed(owner,99);
    result=await overlap(c=>c.query(reserve,[owner]),c=>c.query(reserve,[owner]),limiterRoles);
    assert(result.initial.rows[0].admitted && !result.next.rows[0].admitted && result.next.rows[0].reason==='user_daily_limit',
        'Concurrent per-user last slot is admitted only once');
    await seed(other,999);
    result=await overlap(c=>c.query(reserve,[owner]),c=>c.query(reserve,[member]),limiterRoles);
    assert(result.initial.rows[0].admitted && !result.next.rows[0].admitted && result.next.rows[0].reason==='global_daily_limit',
        'Global last slot is admitted only once across actors');
    await seed(owner,2,'0 seconds');
    result=await overlap(c=>c.query(reserve,[owner]),c=>c.query(reserve,[member]),limiterRoles);
    assert(result.initial.rows[0].admitted && !result.next.rows[0].admitted && result.next.rows[0].reason==='global_rate_limit',
        'Fresh post-lock count protects concurrent global rate boundary');
    await seed(owner,99);
    result=await overlap(c=>c.query(reserve,[owner]),c=>c.query(reserve,[owner]),{...limiterRoles,rollback:true});
    assert(result.next.rows[0].admitted && (await admin.query('select count(*)::int as n from public.geoapify_request_admissions')).rows[0].n===100,
        'Rolled-back reservation consumes no durable slot; HTTP must wait for commit');
    await seed(owner,100,'24 hours 5 seconds');
    result=await overlap(c=>c.query(reserve,[owner]),c=>c.query(reserve,[owner]),limiterRoles);
    assert(result.initial.rows[0].admitted && result.next.rows[0].admitted
        && (await admin.query('select count(*)::int as n from public.geoapify_request_admissions')).rows[0].n===2,
        'Concurrent rolling expiry/pruning cannot delete fresh admissions');
    await seed(owner,3,'0 seconds');
    result=await overlap(c=>c.query('select pg_advisory_xact_lock(714015,9)'),c=>c.query(reserve,[member]),{...limiterRoles,waitExtra:2200});
    assert(result.next.rows[0].admitted && (await admin.query('select permit_expires_at>clock_timestamp() as fresh from public.geoapify_request_admissions where id=$1',[result.next.rows[0].admission_id])).rows[0].fresh,
        'Limiter uses wall clock AFTER lock wait, not transaction timestamp');
    await seed(owner,3,'0 seconds');
    result=await overlap(c=>c.query('select pg_advisory_xact_lock(714015,9)'),c=>c.query(reserve,[member]),{...limiterRoles,waitExtra:1100});
    assert(!result.next.rows[0].admitted && result.next.rows[0].reason==='global_rate_limit',
        'One-second-old admissions still block delayed dispatch bursts until the two-second boundary');

    // Production predicates at their daily cutoff (not a test-only clock parameter).
    await seed(owner,100,'24 hours');
    await begin(admin,'service_role');
    assert(!(await admin.query(reserve,[owner])).rows[0].admitted,'Reservations at 24h remain counted during one-second dispatch grace');
    await admin.query('commit');
    await seed(owner,100,'24 hours 1 second');
    await begin(admin,'service_role');
    assert((await admin.query(reserve,[owner])).rows[0].admitted,'Exact permit-expiry daily boundary releases capacity');
    await admin.query('commit');

    for (const isolation of ['repeatable read','serializable']) {
        for (const limited of [false,true]) {
            await begin(admin,limited?'service_role':'authenticated',owner,isolation);
            let error;
            try { await admin.query(limited?reserve:save,limited?[owner]:['m9-bad-isolation-'+isolation,[f.group],f.name]); }
            catch(failure) { error=failure; }
            await admin.query('rollback');
            assert(error?.code==='25001','Snapshot-sensitive RPC must reject '+isolation);
        }
    }
    return raceCount;
}
