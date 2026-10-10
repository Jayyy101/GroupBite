-- Disposable local harness only. Every fixture (including quota history) rolls back.
begin;
create function pg_temp.assert_true(ok boolean, description text)
returns void language plpgsql as $$
begin
    if ok is distinct from true then raise exception 'Test failed: %', description; end if;
end;
$$;
create function pg_temp.expect_error(statement text, expected_state text)
returns void language plpgsql as $$
begin
    begin
        execute statement;
    exception when others then
        if sqlstate <> expected_state then raise; end if;
        return;
    end;
    raise exception 'Expected SQLSTATE %, but the operation succeeded', expected_state;
end;
$$;
select pg_temp.assert_true(current_setting('groupbite.local_validation', true) = 'address-autocomplete-groundwork', 'Explicit local harness required');
-- Negative control: the helper must reject a successful statement even when
-- its own unexpected-success assertion has the expected SQLSTATE P0001.
do $$
declare unexpected_success_rejected boolean := false;
begin
    begin
        perform pg_temp.expect_error('SELECT 1', 'P0001');
    exception when sqlstate 'P0001' then
        if sqlerrm <> 'Expected SQLSTATE P0001, but the operation succeeded' then raise; end if;
        unexpected_success_rejected := true;
    end;
    perform pg_temp.assert_true(unexpected_success_rejected,
        'Error helper must reject successful SELECT 1 when P0001 is expected');
end;
$$;
select set_config('m9.owner', (select id::text from public.profiles order by id limit 1), true);
select set_config('m9.member', (select id::text from public.profiles order by id limit 1 offset 1), true);
select set_config('m9.other', (select id::text from public.profiles order by id limit 1 offset 2), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('m9.owner'), true);
select set_config('m9.a', (public.create_group('Binding A')).id::text, true);
select set_config('m9.b', (public.create_group('Binding B')).id::text, true);
select pg_temp.assert_true((select bindings_recorded from public.save_restaurant_visit_with_location_bindings(
    'm9-multi', array[current_setting('m9.b')::uuid,current_setting('m9.a')::uuid,current_setting('m9.a')::uuid],
    'Binding cafe','Binding address',visit_rating=>5,visit_notes=>'m9-multi')), 'New save captures all distinct groups');
select pg_temp.assert_true((select count(*)=2 and count(distinct restaurant_id)=1 and count(distinct group_restaurant_id)=2
    from public.get_visit_save_location_targets('m9-multi')), 'Multi-group save has distinct exact entries and one reused Restaurant');
select set_config('m9.restaurant', (select restaurant_id::text from public.get_visit_save_location_targets('m9-multi') limit 1), true);
select set_config('m9.entry_a', (select group_restaurant_id::text from public.get_visit_save_location_targets('m9-multi') where group_id=current_setting('m9.a')::uuid), true);
select set_config('m9.entry_b', (select group_restaurant_id::text from public.get_visit_save_location_targets('m9-multi') where group_id=current_setting('m9.b')::uuid), true);
select pg_temp.assert_true((select bindings_recorded and restaurant_id=current_setting('m9.restaurant')::uuid
    from public.save_restaurant_visit_with_location_bindings('m9-multi', array[current_setting('m9.a')::uuid,current_setting('m9.b')::uuid],
    'Binding cafe','Binding address',visit_rating=>5,visit_notes=>'m9-multi')), 'Normalized retry retains original identity');
select pg_temp.assert_true((select count(*)=2 from public.visits where notes='m9-multi'), 'Retry does not duplicate Visits');
select pg_temp.expect_error($q$select public.save_restaurant_visit_with_location_bindings('m9-multi',
    array[current_setting('m9.a')::uuid,current_setting('m9.b')::uuid],'Binding cafe','Changed address',visit_rating=>5,visit_notes=>'m9-multi')$q$, '22023');
select pg_temp.expect_error($q$select public.save_restaurant_visit_with_location_bindings('m9-empty',array[]::uuid[],'Cafe','Address')$q$, '22023');
select pg_temp.expect_error($q$select public.save_restaurant_visit_with_location_bindings('m9-null',array[current_setting('m9.a')::uuid,null],'Cafe','Address')$q$, '22023');
select pg_temp.expect_error($q$select public.save_restaurant_visit_with_location_bindings('m9-dims',array[[current_setting('m9.a')::uuid]],'Cafe','Address')$q$, '22023');
select pg_temp.expect_error($q$select public.get_visit_save_location_targets(null)$q$, '22023');
select pg_temp.expect_error($q$select public.get_visit_save_location_targets(repeat('x',121))$q$, '22023');
select pg_temp.assert_true(not exists(select 1 from public.get_visit_save_location_targets('unknown')), 'Unknown receipt reveals nothing');
select pg_temp.expect_error('select * from public.visit_save_location_bindings', '42501');
select pg_temp.expect_error('select * from public.geoapify_request_admissions', '42501');
select pg_temp.expect_error($q$insert into public.visit_save_location_bindings values(current_setting('m9.owner')::uuid,'m9-multi',current_setting('m9.a')::uuid,current_setting('m9.entry_a')::uuid)$q$, '42501');
select pg_temp.expect_error('update public.visit_save_location_bindings set group_restaurant_id=gen_random_uuid()', '42501');
select pg_temp.expect_error('delete from public.visit_save_location_bindings', '42501');
select pg_temp.expect_error($q$select public.reserve_geoapify_request(current_setting('m9.owner')::uuid)$q$, '42501');

-- Old RPC receipts, including migration-8-era data, can never acquire inferred bindings.
select public.save_restaurant_visit('m9-legacy',array[current_setting('m9.a')::uuid],'Legacy binding cafe','Legacy address');
select pg_temp.assert_true((select not bindings_recorded from public.save_restaurant_visit_with_location_bindings(
    'm9-legacy',array[current_setting('m9.a')::uuid],'Legacy binding cafe','Legacy address')), 'Existing old-RPC receipt stays unbound');
select pg_temp.assert_true(not exists(select 1 from public.get_visit_save_location_targets('m9-legacy')), 'Legacy reader has no target fallback');
select pg_temp.assert_true((select not bindings_recorded from public.save_restaurant_visit_with_location_bindings(
    'pre-map-save',array[(select id from public.groups where name='Pre-map group')],
    'Pre-map restaurant','Original historical address',visit_rating=>4)), 'Pre-migration receipt remains unbound');

-- Foreign receipt IDs and global Restaurant reuse must not expose bindings or locations.
select set_config('request.jwt.claim.sub', current_setting('m9.other'), true);
select set_config('m9.c', (public.create_group('Binding unrelated C')).id::text, true);
select pg_temp.assert_true(not exists(select 1 from public.get_visit_save_location_targets('m9-multi')), 'Known foreign request ID grants no access');
select pg_temp.assert_true((select restaurant_id=current_setting('m9.restaurant')::uuid and bindings_recorded
    from public.save_restaurant_visit_with_location_bindings('m9-multi',array[current_setting('m9.c')::uuid],
    'Binding cafe','Binding address',visit_rating=>1)), 'Same request ID in another account reuses Restaurant independently');
select pg_temp.assert_true((select count(*)=1 and bool_and(group_id=current_setting('m9.c')::uuid)
    from public.get_visit_save_location_targets('m9-multi')), 'Caller-scoped binding reader returns only C');
select pg_temp.expect_error($q$select public.save_restaurant_visit_with_location_bindings('m9-forge',
    array[current_setting('m9.c')::uuid,current_setting('m9.a')::uuid],'Forged cafe','Forged address')$q$, '42501');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.visit_save_requests where request_id='m9-forge'), 'Unauthorized multi-group save is atomic');
select pg_temp.expect_error('update public.visit_save_location_bindings set group_restaurant_id=gen_random_uuid()', '42501');
insert into public.group_memberships(group_id,user_id) values(current_setting('m9.a')::uuid,current_setting('m9.member')::uuid),
    (current_setting('m9.b')::uuid,current_setting('m9.member')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('m9.member'), true);
select public.save_restaurant_visit_with_location_bindings('m9-member',array[current_setting('m9.a')::uuid,current_setting('m9.b')::uuid],
    'Binding cafe','Binding address',visit_rating=>3);
select public.leave_group(current_setting('m9.a')::uuid,
    (select membership_id from public.group_memberships where group_id=current_setting('m9.a')::uuid and user_id=auth.uid()));
select pg_temp.assert_true((select count(*)=1 and bool_and(group_id=current_setting('m9.b')::uuid)
    from public.get_visit_save_location_targets('m9-member')), 'Revocation filters only revoked binding, preserving other group');
select pg_temp.expect_error($q$select public.save_restaurant_visit_with_location_bindings('m9-member',
    array[current_setting('m9.a')::uuid,current_setting('m9.b')::uuid],'Binding cafe','Binding address',visit_rating=>3)$q$, '42501');

-- Independent post-save attachments: one invalid attachment cannot erase the saves or the other resolution.
set local role service_role;
select pg_temp.expect_error('select * from public.visit_save_location_bindings', '42501');
select pg_temp.expect_error($q$select public.get_visit_save_location_targets('m9-multi')$q$, '42501');
select pg_temp.expect_error($q$select public.save_restaurant_visit_with_location_bindings('m9-service',array[current_setting('m9.a')::uuid],'Cafe','Address')$q$, '42501');
select pg_temp.assert_true(public.attach_verified_restaurant_location(current_setting('m9.owner')::uuid,current_setting('m9.a')::uuid,
    current_setting('m9.restaurant')::uuid,current_setting('m9.entry_a')::uuid,'Binding address',10,10,'synthetic','a','Standardized A','building'), 'Attach first exact binding');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('m9.owner')::uuid,current_setting('m9.b')::uuid,
    current_setting('m9.restaurant')::uuid,current_setting('m9.entry_b')::uuid,'Binding address',91,0,'synthetic','b','Standardized B','address')$q$, '23514');
select pg_temp.assert_true(public.attach_verified_restaurant_location(current_setting('m9.owner')::uuid,current_setting('m9.b')::uuid,
    current_setting('m9.restaurant')::uuid,current_setting('m9.entry_b')::uuid,'Binding address',20,20,'synthetic','b','Standardized B','address'), 'Retry remaining group independently');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('m9.member')::uuid,current_setting('m9.a')::uuid,
    current_setting('m9.restaurant')::uuid,current_setting('m9.entry_a')::uuid,'Binding address',10,10,'synthetic','a','Standardized A','building')$q$, '42501');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('m9.other'), true);
select pg_temp.assert_true((select latitude is null and group_average_rating=1 from public.get_saved_locations()
    where restaurant_id=current_setting('m9.restaurant')::uuid), 'Reuse in C inherits neither A/B coordinates nor ratings');
select set_config('request.jwt.claim.sub', current_setting('m9.owner'), true);
select pg_temp.assert_true((select count(*)=2 from public.get_saved_locations() where restaurant_id=current_setting('m9.restaurant')::uuid
    and ((group_id=current_setting('m9.a')::uuid and latitude=10) or (group_id=current_setting('m9.b')::uuid and latitude=20))), 'Accessible groups retain independent resolutions');

-- Deletion/recreation keeps the original tombstone; new receipt gets a fresh entry.
select public.save_restaurant_visit_with_location_bindings('m9-delete',array[current_setting('m9.a')::uuid],'Binding delete cafe','Delete address');
select set_config('m9.deleted', (select group_restaurant_id::text from public.get_visit_save_location_targets('m9-delete')), true);
select public.delete_group_visit(current_setting('m9.a')::uuid,current_setting('m9.deleted')::uuid,
    (select id from public.visits where group_restaurant_id=current_setting('m9.deleted')::uuid));
select pg_temp.assert_true((select bindings_recorded from public.save_restaurant_visit_with_location_bindings(
    'm9-delete',array[current_setting('m9.a')::uuid],'Binding delete cafe','Delete address')), 'Deleted retry retains historical binding, never re-saves');
select pg_temp.assert_true(not exists(select 1 from public.get_visit_save_location_targets('m9-delete')), 'Missing entry is not an attachable target');
select public.save_restaurant_visit_with_location_bindings('m9-recreate',array[current_setting('m9.a')::uuid],'Binding delete cafe','Delete address');
select pg_temp.assert_true((select group_restaurant_id<>current_setting('m9.deleted')::uuid from public.get_visit_save_location_targets('m9-recreate')), 'New request binds recreated ID');
select pg_temp.assert_true(not exists(select 1 from public.get_visit_save_location_targets('m9-delete')), 'Original receipt never retargets recreated entry');
reset role;
select pg_temp.assert_true((select group_restaurant_id=current_setting('m9.deleted')::uuid from public.visit_save_location_bindings
    where user_id=current_setting('m9.owner')::uuid and request_id='m9-delete'), 'Historical exact identity survives final-Visit deletion');

-- Binding insertion failure must roll back receipts, Restaurant, entries and Visits together.
create function pg_temp.reject_test_binding() returns trigger language plpgsql as $$
begin raise exception 'Injected binding failure' using errcode='P0001'; end; $$;
create trigger test_binding_failure before insert on public.visit_save_location_bindings
    for each row when (new.request_id='m9-rollback') execute function pg_temp.reject_test_binding();
set local role authenticated;
select pg_temp.expect_error($q$select public.save_restaurant_visit_with_location_bindings('m9-rollback',
    array[current_setting('m9.a')::uuid,current_setting('m9.b')::uuid],'Binding rollback cafe','Rollback address')$q$, 'P0001');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.visit_save_requests where request_id='m9-rollback')
    and not exists(select 1 from public.restaurants where name='Binding rollback cafe')
    and not exists(select 1 from public.visit_save_location_bindings where request_id='m9-rollback'), 'Injected failure rolls back complete save');
drop trigger test_binding_failure on public.visit_save_location_bindings;
set local role authenticated;
select pg_temp.assert_true((select bindings_recorded from public.save_restaurant_visit_with_location_bindings('m9-rollback',
    array[current_setting('m9.a')::uuid,current_setting('m9.b')::uuid],'Binding rollback cafe','Rollback address')), 'Same request succeeds after complete rollback');
-- Removing one entry in a multi-group receipt does not erase the other target.
select set_config('m9.multi_deleted', (select group_restaurant_id::text from public.get_visit_save_location_targets('m9-rollback')
    where group_id=current_setting('m9.a')::uuid), true);
select public.delete_group_visit(current_setting('m9.a')::uuid,current_setting('m9.multi_deleted')::uuid,
    (select id from public.visits where group_restaurant_id=current_setting('m9.multi_deleted')::uuid));
select pg_temp.assert_true((select count(*)=1 and bool_and(group_id=current_setting('m9.b')::uuid)
    from public.get_visit_save_location_targets('m9-rollback')), 'Final deletion in A preserves only original B target');
select public.save_restaurant_visit_with_location_bindings('m9-multi-recreated',array[current_setting('m9.a')::uuid],
    'Binding rollback cafe','Rollback address');
select pg_temp.assert_true((select count(*)=1 and bool_and(group_id=current_setting('m9.b')::uuid)
    from public.get_visit_save_location_targets('m9-rollback')), 'Multi-group historical receipt never adds replacement A');
-- Losing the remaining membership removes every target even if caller is the group's Owner.
reset role;
delete from public.group_memberships where group_id=current_setting('m9.b')::uuid and user_id=current_setting('m9.owner')::uuid;
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from public.get_visit_save_location_targets('m9-rollback')), 'Owner has no membership bypass');
reset role;
insert into public.group_memberships(group_id,user_id) values(current_setting('m9.b')::uuid,current_setting('m9.owner')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error($q$select public.get_visit_save_location_targets('m9-multi')$q$, '42501');
select pg_temp.expect_error($q$select public.save_restaurant_visit_with_location_bindings('m9-no-user',array[current_setting('m9.a')::uuid],'Cafe','Address')$q$, '42501');
set local role anon;
select pg_temp.expect_error($q$select public.get_visit_save_location_targets('m9-multi')$q$, '42501');
select pg_temp.expect_error($q$select public.reserve_geoapify_request(current_setting('m9.owner')::uuid)$q$, '42501');
reset role;

-- Deterministic quota fixtures: no provider, no elapsed-time sleeps, no test clock in production RPC.
create function pg_temp.seed_admissions(actor uuid, quantity integer, age interval) returns void language sql as $$
    insert into public.geoapify_request_admissions(user_id,admitted_at,permit_expires_at)
        select actor,statement_timestamp()-age,statement_timestamp()-age+interval '1 second' from generate_series(1,quantity);
$$;
truncate public.geoapify_request_admissions;
select pg_temp.seed_admissions(current_setting('m9.owner')::uuid,99,interval '2 hours');
set local role service_role;
select pg_temp.assert_true((select admitted and admission_id is not null and permit_expires_at>clock_timestamp()
    and reason='admitted' and retry_after_seconds=0 from public.reserve_geoapify_request(current_setting('m9.owner')::uuid)), '100th user admission allowed');
select pg_temp.assert_true((select not admitted and reason='user_daily_limit' and admission_id is null and permit_expires_at is null
    and retry_after_seconds>0 from public.reserve_geoapify_request(current_setting('m9.owner')::uuid)), '101st user admission denied');
select pg_temp.expect_error('select * from public.geoapify_request_admissions', '42501');
select pg_temp.expect_error('delete from public.geoapify_request_admissions', '42501');
select pg_temp.expect_error('select public.reserve_geoapify_request(null)', '42501');
select pg_temp.expect_error($q$select public.reserve_geoapify_request('ffffffff-ffff-ffff-ffff-ffffffffffff')$q$, '42501');
reset role;
select pg_temp.assert_true((select count(*)=100 from public.geoapify_request_admissions), 'Denials do not create reservations or refund prior attempts');
truncate public.geoapify_request_admissions;
select pg_temp.seed_admissions(current_setting('m9.other')::uuid,999,interval '2 hours');
set local role service_role;
select pg_temp.assert_true((select admitted from public.reserve_geoapify_request(current_setting('m9.owner')::uuid)), '1000th global admission allowed');
select pg_temp.assert_true((select not admitted and reason='global_daily_limit' from public.reserve_geoapify_request(current_setting('m9.member')::uuid)), '1001st global admission denied across users');
reset role;
truncate public.geoapify_request_admissions;
-- Reservations whose permits expired more than 24h ago may be removed.
select pg_temp.seed_admissions(current_setting('m9.owner')::uuid,100,interval '24 hours 5 seconds');
set local role service_role;
select pg_temp.assert_true((select admitted from public.reserve_geoapify_request(current_setting('m9.owner')::uuid)), 'Expired rolling quota releases capacity');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.geoapify_request_admissions), 'Only expired reservations are pruned');
truncate public.geoapify_request_admissions;
-- Grace extends the daily window conservatively by exactly one second.
select pg_temp.seed_admissions(current_setting('m9.owner')::uuid,100,interval '23 hours 59 minutes 50 seconds');
set local role service_role;
select pg_temp.assert_true((select not admitted and reason='user_daily_limit' from public.reserve_geoapify_request(current_setting('m9.owner')::uuid)), 'Recent rolling history remains counted across calendar boundaries');
reset role;
-- Exact half-open boundaries for both predicates used by the RPC.
select pg_temp.assert_true((select count(*)=1 from (values
    (timestamptz '2026-10-09 12:00:00+00'),(timestamptz '2026-10-09 12:00:00.000001+00')) a(expiry)
    where a.expiry>timestamptz '2026-10-10 12:00:00+00'-interval '24 hours'), 'Exact daily cutoff excludes boundary and includes next microsecond');
select pg_temp.assert_true((select count(*)=1 from (values
    (timestamptz '2026-10-09 12:00:00+00'),(timestamptz '2026-10-09 12:00:00.000001+00')) a(expiry)
    where a.expiry>timestamptz '2026-10-09 12:00:01+00'-interval '1 second'), 'Exact rate cutoff excludes boundary and includes next microsecond');
truncate public.geoapify_request_admissions;
select pg_temp.seed_admissions(current_setting('m9.owner')::uuid,3,interval '-5 seconds');
set local role service_role;
select pg_temp.assert_true((select not admitted and reason='global_rate_limit' and retry_after_seconds>=1
    from public.reserve_geoapify_request(current_setting('m9.member')::uuid)), 'Recent/future rate reservations block all users conservatively');
reset role;
truncate public.geoapify_request_admissions;
select pg_temp.seed_admissions(current_setting('m9.owner')::uuid,3,interval '5 seconds');
set local role service_role;
select pg_temp.assert_true((select admitted from public.reserve_geoapify_request(current_setting('m9.member')::uuid)), 'Rate window expires independently of daily counts');
reset role;
select pg_temp.expect_error($q$insert into public.geoapify_request_admissions(user_id,admitted_at,permit_expires_at)
    values(current_setting('m9.owner')::uuid,now(),now()+interval '2 seconds')$q$, '23514');
-- Account deletion cannot erase global usage history.
insert into auth.users(id,raw_user_meta_data) values('99999999-9999-9999-9999-999999999999','{"display_name":"Disposable quota actor"}');
select pg_temp.seed_admissions('99999999-9999-9999-9999-999999999999',1,interval '2 hours');
delete from auth.users where id='99999999-9999-9999-9999-999999999999';
select pg_temp.assert_true(exists(select 1 from public.geoapify_request_admissions where user_id='99999999-9999-9999-9999-999999999999'), 'Deleted-account usage remains globally counted');
select pg_temp.assert_true(not has_function_privilege('anon','public.reserve_geoapify_request(uuid)','EXECUTE')
    and not has_function_privilege('authenticated','public.reserve_geoapify_request(uuid)','EXECUTE')
    and has_function_privilege('service_role','public.reserve_geoapify_request(uuid)','EXECUTE'), 'Service-only limiter grants');
select pg_temp.assert_true((select bool_and(prosecdef and proconfig=array['search_path=""']) from pg_proc
    where oid in ('public.reserve_geoapify_request(uuid)'::regprocedure,
    'public.get_visit_save_location_targets(text)'::regprocedure,
    'public.save_restaurant_visit_with_location_bindings(text,uuid[],text,text,text,date,integer,boolean,text)'::regprocedure)), 'Hardened RPC search paths');
select pg_temp.assert_true((select count(*)=0 from pg_policies where schemaname='public'
    and tablename in ('visit_save_location_bindings','geoapify_request_admissions')), 'Private tables have no client RLS policies');
rollback;
