do $$ begin
    if current_setting('groupbite.local_validation',true) is distinct from 'm18-mapkit-locations' then
        raise exception 'Requires disposable --mapkit-locations runner'; end if;
end $$;
begin;
create or replace function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Test failed: %',label;end if;end $$;
create or replace function pg_temp.expect_error(statement text,expected_state text) returns void language plpgsql as $$
begin execute statement;raise exception 'Expected SQLSTATE %',expected_state;
exception when others then if sqlstate<>expected_state then raise;end if;end $$;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
set local role authenticated;
select pg_temp.assert_true(not has_table_privilege('authenticated','public.personal_mapkit_locations','INSERT,UPDATE,DELETE,MAINTAIN')
    and not has_table_privilege('authenticated','public.personal_mapkit_save_requests','SELECT,INSERT,UPDATE,DELETE,MAINTAIN')
    and not has_table_privilege('service_role','public.personal_mapkit_save_requests','SELECT,INSERT,UPDATE,DELETE,MAINTAIN'),'No direct writes/receipt access');
select pg_temp.expect_error('select public.validate_mapkit_point(37,-122)','42501');
select pg_temp.expect_error('insert into public.personal_mapkit_locations values(null,null,null,37,-122,now())','42501');
select set_config('point.noid',public.save_personal_visit_with_mapkit_point('point-no-id','Synthetic In-N-Out','50 Fixture Ranch',null,null,4,false,'Private',null,null,37.5555437394246,-121.982959052141)::text,true);
select pg_temp.assert_true((select apple_place_id is null from public.personal_places where id=current_setting('point.noid')::uuid)
    and (select latitude=37.5555437394246 and longitude=-121.982959052141 from public.personal_mapkit_locations where personal_place_id=current_setting('point.noid')::uuid)
    and (select count(*)=1 from public.personal_visits where personal_place_id=current_setting('point.noid')::uuid),'No stable ID required; exact point and one visit');
select pg_temp.assert_true(public.save_personal_visit_with_mapkit_point('point-no-id','Synthetic In-N-Out','50 Fixture Ranch',null,null,4,false,'Private',null,null,37.5555437394246,-121.982959052141)=current_setting('point.noid')::uuid
    and (select count(*)=1 from public.personal_visits where personal_place_id=current_setting('point.noid')::uuid),'Exact replay creates no visit');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_point('point-no-id','Synthetic In-N-Out','50 Fixture Ranch',null,null,4,false,'Private',null,null,38,-121)$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_point('point-no-id','Synthetic In-N-Out','50 Fixture Ranch',null,null,4,false,'Changed',null,null,37.5555437394246,-121.982959052141)$q$,'22023');
select set_config('point.withid',public.save_personal_visit_with_mapkit_point('point-with-id','With ID','Point address',null,null,null,null,null,'Opaque Apple:ID/A',null,37.8,-122.1)::text,true);
select pg_temp.assert_true((select apple_place_id='Opaque Apple:ID/A' from public.personal_places where id=current_setting('point.withid')::uuid),'Available Apple ID retained independently');
select set_config('point.repair',public.save_personal_visit('point-manual','Repair this card','Existing address')::text,true);
select set_config('point.before',(select to_jsonb(p)::text from public.personal_places p where id=current_setting('point.repair')::uuid),true);
select set_config('point.visitcount',(select count(*)::text from public.personal_visits),true);
select pg_temp.assert_true(public.set_personal_mapkit_location(current_setting('point.repair')::uuid,(current_setting('point.before')::jsonb->>'revision')::integer,'Existing address',37.9,-122.2),'Repair inserts missing point');
select pg_temp.assert_true((select to_jsonb(p)=current_setting('point.before')::jsonb from public.personal_places p where id=current_setting('point.repair')::uuid)
    and (select count(*)=current_setting('point.visitcount')::bigint from public.personal_visits),'Repair preserves exact card, ownership, revision and visits');
select pg_temp.assert_true(not public.set_personal_mapkit_location(current_setting('point.repair')::uuid,(current_setting('point.before')::jsonb->>'revision')::integer,'Existing address',38,-122),'Existing point never moved');
select pg_temp.expect_error($q$select public.set_personal_mapkit_location(current_setting('point.repair')::uuid,1,'Existing address',37,-122)$q$,'40001');
select pg_temp.expect_error($q$select public.set_personal_mapkit_location(current_setting('point.repair')::uuid,(current_setting('point.before')::jsonb->>'revision')::integer,'Wrong address',37,-122)$q$,'40001');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_point('point-manual','Repair this card','Existing address',null,null,null,null,null,null,null,37.9,-122.2)$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_point('invalid','Bad','Bad',null,null,null,null,null,null,null,'NaN',-122)$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_point('invalid','Bad','Bad',null,null,null,null,null,null,null,37,'Infinity')$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_point('invalid','Bad','Bad',null,null,null,null,null,null,null,0,0)$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_point('invalid','Bad','Bad',null,null,null,null,null,null,null,null,-122)$q$,'22023');
select pg_temp.assert_true((select count(*)=3 from public.get_personal_mapkit_locations()),'Owner map returns selected points');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select pg_temp.assert_true(not exists(select 1 from public.get_personal_mapkit_locations()) and not exists(select 1 from public.personal_mapkit_locations),'Foreign points hidden');
select pg_temp.expect_error($q$select public.set_personal_mapkit_location(current_setting('point.repair')::uuid,1,'Existing address',37,-122)$q$,'42501');
select pg_temp.expect_error('select * from public.personal_mapkit_save_requests','42501');
select pg_temp.expect_error('select * from public.get_personal_mapkit_locations(0,0)','22023');
select pg_temp.expect_error('select * from public.get_personal_mapkit_locations(200,-1)','22023');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error('select * from public.get_personal_mapkit_locations()','42501');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_point('no-jwt','Bad','Bad',null,null,null,null,null,null,null,37,-122)$q$,'42501');
select pg_temp.expect_error($q$select public.set_personal_mapkit_location(current_setting('point.repair')::uuid,1,'Existing address',37,-122)$q$,'42501');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
reset role;
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.personal_mapkit_save_requests'::regclass),'Private proof RLS');
select pg_temp.assert_true((select count(*)=2 from public.personal_mapkit_save_requests),'Proofs committed with saves, repair has no save receipt');
select pg_temp.expect_error($q$update public.personal_mapkit_save_requests set point_hash=repeat('0',64)$q$,'42501');
select set_config('point.verified',(select id::text from public.personal_places where client_request_id='m13-history-personal'),true);
select set_config('point.verified_before',(select to_jsonb(l)::text from public.personal_place_locations l where personal_place_id=current_setting('point.verified')::uuid),true);
set local role authenticated;
select public.save_personal_visit_with_mapkit_point('point-verified-existing','Historical personal','100 Fixture Road',null,null,null,null,null,null,current_setting('point.verified')::uuid,1,1);
select pg_temp.assert_true(not exists(select 1 from public.personal_mapkit_locations where personal_place_id=current_setting('point.verified')::uuid),'Existing verified resolution wins');
reset role;
select pg_temp.assert_true((select to_jsonb(l)=current_setting('point.verified_before')::jsonb from public.personal_place_locations l where personal_place_id=current_setting('point.verified')::uuid),'Verified location row untouched');
-- Fail after the original save has inserted its card, visit and receipt.
create function pg_temp.fail_point() returns trigger language plpgsql as $$begin raise exception 'synthetic failure' using errcode='23514';end $$;
create trigger fail_point before insert on public.personal_mapkit_locations for each row execute function pg_temp.fail_point();
set local role authenticated;
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_point('point-rollback','Must roll back','New address',null,null,null,null,null,null,null,37,-122)$q$,'23514');
reset role;
drop trigger fail_point on public.personal_mapkit_locations;
select pg_temp.assert_true(not exists(select 1 from public.personal_places where name='Must roll back')
    and not exists(select 1 from public.add_destination_requests where request_id='point-rollback')
    and not exists(select 1 from public.personal_mapkit_save_requests where request_id='point-rollback'),'Point failure rolls back original save and both proofs');
create trigger fail_point before insert on public.personal_mapkit_save_requests for each row execute function pg_temp.fail_point();
set local role authenticated;
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_point('point-proof-rollback','Proof rolls back','New address',null,null,null,null,null,null,null,37,-122)$q$,'23514');
reset role;
drop trigger fail_point on public.personal_mapkit_save_requests;
select pg_temp.assert_true(not exists(select 1 from public.personal_places where name='Proof rolls back')
    and not exists(select 1 from public.add_destination_requests where request_id='point-proof-rollback'),'Point proof failure rolls back card/visit/point/receipt');
set local role authenticated;
select public.update_personal_place(current_setting('point.withid')::uuid,(select revision from public.personal_places where id=current_setting('point.withid')::uuid),'Renamed','Point address','Cuisine');
select pg_temp.assert_true(exists(select 1 from public.personal_mapkit_locations where personal_place_id=current_setting('point.withid')::uuid),'Name/cuisine edits preserve point');
select public.update_personal_place(current_setting('point.noid')::uuid,(select revision from public.personal_places where id=current_setting('point.noid')::uuid),'Synthetic In-N-Out','Changed address');
select pg_temp.assert_true(not exists(select 1 from public.personal_mapkit_locations where personal_place_id=current_setting('point.noid')::uuid),'Address change invalidates point');
select public.save_personal_visit_with_mapkit_point('point-no-id','Synthetic In-N-Out','50 Fixture Ranch',null,null,4,false,'Private',null,null,37.5555437394246,-121.982959052141);
select pg_temp.assert_true(not exists(select 1 from public.personal_mapkit_locations where personal_place_id=current_setting('point.noid')::uuid),'Replay cannot restore invalidated point');
select public.delete_personal_place(current_setting('point.withid')::uuid,(select revision from public.personal_places where id=current_setting('point.withid')::uuid));
select public.save_personal_visit_with_mapkit_point('point-with-id','With ID','Point address',null,null,null,null,null,'Opaque Apple:ID/A',null,37.8,-122.1);
select pg_temp.assert_true(not exists(select 1 from public.personal_places where id=current_setting('point.withid')::uuid),'Replay cannot resurrect deleted card');
reset role;
select pg_temp.assert_true(exists(select 1 from public.personal_mapkit_save_requests where request_id='point-with-id'),'Coordinate proof survives target deletion');
set local role anon;
select pg_temp.expect_error('select * from public.get_personal_mapkit_locations()','42501');
select pg_temp.expect_error('select * from public.personal_mapkit_locations','42501');
reset role;
rollback;
