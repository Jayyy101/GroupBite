do $$ begin
    if current_setting('groupbite.local_validation',true) is distinct from 'structured-mapkit' then
        raise exception 'Requires disposable --structured-mapkit runner'; end if;
end $$;
begin;
create or replace function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Test failed: %',label;end if;end $$;
create or replace function pg_temp.expect_error(statement text,expected_state text) returns void language plpgsql as $$
begin execute statement;raise exception 'Expected SQLSTATE %',expected_state;
exception when others then if sqlstate<>expected_state then raise;end if;end $$;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
set local role authenticated;
select set_config('sm.group',(public.create_group('Structured Maps')).id::text,true);
select set_config('sm.membership',(select membership_id::text from public.group_memberships where group_id=current_setting('sm.group')::uuid and user_id=auth.uid()),true);
select set_config('sm.address','{"street":"10 Native Street","city":"Native City","region":"CA","postal_code":"94538","country":"United States","country_code":"US"}',true);
select set_config('sm.personal',public.save_personal_visit_with_mapkit_location('sm-personal','Native Cafe','Formatted display',null,null,4,false,'PRIVATE',null,null,37.55,-122.12,current_setting('sm.address')::jsonb)::text,true);
select set_config('sm.entry',public.save_group_visit_with_mapkit_location('sm-group',current_setting('sm.group')::uuid,'Native Cafe','Formatted display',null,null,4,false,'SHARED','Opaque ID',null,current_setting('sm.membership')::uuid,37.55,-122.12,current_setting('sm.address')::jsonb)::text,true);
select pg_temp.assert_true((select structured_address=current_setting('sm.address')::jsonb and latitude=37.55 and longitude=-122.12 from public.personal_mapkit_locations where personal_place_id=current_setting('sm.personal')::uuid),'Exact personal snapshot without Apple ID');
select pg_temp.assert_true((select structured_address=current_setting('sm.address')::jsonb and latitude=37.55 and longitude=-122.12 from public.group_mapkit_locations where group_restaurant_id=current_setting('sm.entry')::uuid),'Exact group snapshot');
select pg_temp.assert_true((select apple_place_id='Opaque ID' from public.group_restaurants where id=current_setting('sm.entry')::uuid),'Apple ID independent of components');
select pg_temp.assert_true(public.get_saved_mapkit_location('group',current_setting('sm.entry')::uuid,'Formatted display')->'structured_address'=current_setting('sm.address')::jsonb,'Scoped read preserves full snapshot');
select pg_temp.assert_true(exists(select 1 from public.get_recent_add_restaurants_with_mapkit(50,0) where entry_id=current_setting('sm.personal')::uuid and mapkit_point->'structured_address'=current_setting('sm.address')::jsonb),'Recent choices retain metadata');
select pg_temp.assert_true((select notes='PRIVATE' from public.personal_visits where personal_place_id=current_setting('sm.personal')::uuid) and (select notes='SHARED' from public.visits where group_restaurant_id=current_setting('sm.entry')::uuid),'Private notes stay isolated');
select public.save_personal_visit_with_mapkit_location('sm-personal','Native Cafe','Formatted display',null,null,4,false,'PRIVATE',null,null,37.55,-122.12,current_setting('sm.address')::jsonb);
select public.save_group_visit_with_mapkit_location('sm-group',current_setting('sm.group')::uuid,'Native Cafe','Formatted display',null,null,4,false,'SHARED','Opaque ID',null,current_setting('sm.membership')::uuid,37.55,-122.12,current_setting('sm.address')::jsonb);
select pg_temp.assert_true((select count(*)=1 from public.personal_visits where personal_place_id=current_setting('sm.personal')::uuid) and (select count(*)=1 from public.visits where group_restaurant_id=current_setting('sm.entry')::uuid),'Exact retries never duplicate visits');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-personal','Native Cafe','Formatted display',null,null,4,false,'PRIVATE',null,null,37.55,-122.12,'{"city":"Changed"}')$q$,'22023');
select pg_temp.expect_error($q$select public.save_group_visit_with_mapkit_location('sm-group',current_setting('sm.group')::uuid,'Native Cafe','Formatted display',null,null,4,false,'SHARED','Opaque ID',null,current_setting('sm.membership')::uuid,38,-122,current_setting('sm.address')::jsonb)$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-conflict','Native Cafe','Formatted display',null,null,null,null,null,null,null,38,-122,null)$q$,'GB001');
select pg_temp.expect_error($q$select public.save_group_visit_with_mapkit_location('sm-conflict',current_setting('sm.group')::uuid,'Native Cafe','Formatted display',null,null,null,null,null,null,null,current_setting('sm.membership')::uuid,37.55,-122.12,'{"city":"Changed"}')$q$,'GB001');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-bad','Bad','Address',null,null,null,null,null,null,null,0,0,null)$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-bad','Bad','Address',null,null,null,null,null,null,null,'NaN',-122,null)$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-bad','Bad','Address',null,null,null,null,null,null,null,37,-122,'{"country_code":"USA"}')$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-bad','Bad','Address',null,null,null,null,null,null,null,37,-122,'{"city":" leading"}')$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-bad','Bad','Address',null,null,null,null,null,null,null,37,-122,'{"city":42}')$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-bad','Bad','Address',null,null,null,null,null,null,null,37,-122,'{"notes":"not permitted"}')$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-bad','Bad','Address',null,null,null,null,null,null,null,37,-122,jsonb_build_object('city',repeat('x',201)))$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-bad','Bad','Address',null,null,null,null,null,null,null,37,-122,jsonb_build_object('city',E'bad\ncity'))$q$,'22023');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.group_mapkit_locations','INSERT,UPDATE,DELETE,MAINTAIN') and not has_table_privilege('service_role','public.group_mapkit_locations','SELECT,INSERT,UPDATE,DELETE,MAINTAIN'),'No direct group metadata writes');
select pg_temp.expect_error('select * from public.mapkit_location_save_requests','42501');
select pg_temp.expect_error('select public.normalize_mapkit_address(null)','42501');
select pg_temp.expect_error($q$select public.get_saved_mapkit_location('group',current_setting('sm.entry')::uuid,'Stale')$q$,'42501');
-- Manual/recent paths add visits without erasing established metadata.
select public.save_personal_visit('sm-manual-personal','Native Cafe','Formatted display');
select public.save_group_visit_destination('sm-manual-group',current_setting('sm.group')::uuid,'Native Cafe','Formatted display',expected_membership_id=>current_setting('sm.membership')::uuid);
select pg_temp.assert_true(public.get_saved_mapkit_location('personal',current_setting('sm.personal')::uuid,'Formatted display')->'structured_address'=current_setting('sm.address')::jsonb,'Manual visit retains selected snapshot');
-- A legacy point can gain partial components without moving or bumping its card.
select set_config('sm.legacy',public.save_personal_visit_with_mapkit_point('sm-legacy','Legacy point','Legacy display',null,null,null,null,null,null,null,37,-122)::text,true);
select set_config('sm.revision',(select revision::text from public.personal_places where id=current_setting('sm.legacy')::uuid),true);
select public.save_personal_visit_with_mapkit_location('sm-fill','Legacy point','Legacy display',null,null,null,null,null,null,null,37,-122,'{"city":"Native City"}');
select pg_temp.assert_true((select structured_address->>'city'='Native City' and structured_address->>'country_code' is null from public.personal_mapkit_locations where personal_place_id=current_setting('sm.legacy')::uuid) and (select revision=current_setting('sm.revision')::integer+1 from public.personal_places where id=current_setting('sm.legacy')::uuid),'Partial native facts add no extra card revision beyond the visit');
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-legacy','Legacy point','Legacy display',null,null,null,null,null,null,null,37,-122,null)$q$,'22023');
-- Existing verified Geoapify metadata must not suppress new Apple components.
reset role;
select set_config('sm.verified',(select id::text from public.personal_places where client_request_id='m13-history-personal'),true);
select set_config('sm.verifiedbefore',(select to_jsonb(l)::text from public.personal_place_locations l where personal_place_id=current_setting('sm.verified')::uuid),true);
set local role authenticated;
select public.save_personal_visit_with_mapkit_location('sm-verified','Historical personal','100 Fixture Road',null,null,null,null,null,null,current_setting('sm.verified')::uuid,37,-122,current_setting('sm.address')::jsonb);
select pg_temp.assert_true((select structured_address=current_setting('sm.address')::jsonb from public.personal_mapkit_locations where personal_place_id=current_setting('sm.verified')::uuid),'Apple components retained alongside Geoapify');
reset role;
select pg_temp.assert_true((select to_jsonb(l)=current_setting('sm.verifiedbefore')::jsonb from public.personal_place_locations l where personal_place_id=current_setting('sm.verified')::uuid),'Verified location untouched');
set local role authenticated;
select set_config('sm.repair',public.save_personal_visit('sm-repair','Repair structured','Repair display')::text,true);
select set_config('sm.repairbefore',(select to_jsonb(p)::text from public.personal_places p where id=current_setting('sm.repair')::uuid),true);
select pg_temp.assert_true(public.set_personal_mapkit_location_with_address(current_setting('sm.repair')::uuid,
    (current_setting('sm.repairbefore')::jsonb->>'revision')::integer,'Repair display',37,-122,current_setting('sm.address')::jsonb),'Repair retains structured selection');
select pg_temp.assert_true((select to_jsonb(p)=current_setting('sm.repairbefore')::jsonb from public.personal_places p where id=current_setting('sm.repair')::uuid)
    and public.get_saved_mapkit_location('personal',current_setting('sm.repair')::uuid,'Repair display')->'structured_address'=current_setting('sm.address')::jsonb,'Repair preserves exact original card and its visit');
select pg_temp.assert_true(not public.set_personal_mapkit_location_with_address(current_setting('sm.repair')::uuid,
    (current_setting('sm.repairbefore')::jsonb->>'revision')::integer,'Repair display',38,-121,null),'Repair cannot replace existing selection');
reset role;
-- Members create new cards with metadata, but cannot enrich existing cards.
insert into public.group_memberships(group_id,user_id) values(current_setting('sm.group')::uuid,'33333333-3333-3333-3333-333333333333');
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select set_config('sm.member',(select membership_id::text from public.group_memberships where group_id=current_setting('sm.group')::uuid and user_id=auth.uid()),true);
select set_config('sm.newmember',public.save_group_visit_with_mapkit_location('sm-member-new',current_setting('sm.group')::uuid,'Member Cafe','Member display',null,null,null,null,null,null,null,current_setting('sm.member')::uuid,38,-121,null)::text,true);
select pg_temp.assert_true(exists(select 1 from public.group_mapkit_locations where group_restaurant_id=current_setting('sm.newmember')::uuid),'Member may create a located card without structured fields');
select pg_temp.expect_error($q$select public.save_group_visit_with_mapkit_location('sm-member-fill',current_setting('sm.group')::uuid,'Member Cafe','Member display',null,null,null,null,null,null,null,current_setting('sm.member')::uuid,38,-121,current_setting('sm.address')::jsonb)$q$,'GB002');
select public.save_group_visit_with_mapkit_location('sm-member-same',current_setting('sm.group')::uuid,'Native Cafe','Formatted display',null,null,null,null,null,'Opaque ID',current_setting('sm.entry')::uuid,current_setting('sm.member')::uuid,37.55,-122.12,current_setting('sm.address')::jsonb);
select pg_temp.expect_error($q$select public.get_saved_mapkit_location('personal',current_setting('sm.personal')::uuid,'Formatted display')$q$,'42501');
select pg_temp.assert_true(not exists(select 1 from public.personal_mapkit_locations),'Group membership never exposes personal points');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select pg_temp.assert_true(not exists(select 1 from public.group_mapkit_locations),'Nonmember cannot read group points');
select pg_temp.expect_error($q$select public.get_saved_mapkit_location('group',current_setting('sm.entry')::uuid,'Formatted display')$q$,'42501');
select pg_temp.expect_error($q$select public.save_group_visit_with_mapkit_location('sm-foreign',current_setting('sm.group')::uuid,'Native Cafe','Formatted display',null,null,null,null,null,null,null,current_setting('sm.membership')::uuid,37,-122,null)$q$,'42501');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error('select * from public.get_recent_add_restaurants_with_mapkit()','42501');
-- Failure of the new proof must roll back card, point, visit and all receipts.
reset role;
create function pg_temp.fail_structured_proof() returns trigger language plpgsql as $$begin raise exception 'synthetic failure' using errcode='23514';end $$;
create trigger fail_structured_proof before insert on public.mapkit_location_save_requests for each row execute function pg_temp.fail_structured_proof();
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.expect_error($q$select public.save_personal_visit_with_mapkit_location('sm-rollback-p','Rollback personal','New display',null,null,null,null,null,null,null,37,-122,current_setting('sm.address')::jsonb)$q$,'23514');
select pg_temp.expect_error($q$select public.save_group_visit_with_mapkit_location('sm-rollback-g',current_setting('sm.group')::uuid,'Rollback group','New display',null,null,null,null,null,null,null,current_setting('sm.membership')::uuid,37,-122,current_setting('sm.address')::jsonb)$q$,'23514');
reset role;
drop trigger fail_structured_proof on public.mapkit_location_save_requests;
select pg_temp.assert_true(not exists(select 1 from public.personal_places where name='Rollback personal') and not exists(select 1 from public.restaurants where name='Rollback group') and not exists(select 1 from public.add_destination_requests where request_id in ('sm-rollback-p','sm-rollback-g')) and not exists(select 1 from public.personal_mapkit_save_requests where request_id='sm-rollback-p'),'No partial save after proof failure');
select pg_temp.expect_error($q$update public.mapkit_location_save_requests set location_hash=repeat('0',64)$q$,'42501');
-- Name/cuisine-only changes retain snapshots; address edits clear all location identity.
set local role authenticated;
select public.update_personal_place(current_setting('sm.personal')::uuid,(select revision from public.personal_places where id=current_setting('sm.personal')::uuid),'Renamed','Formatted display','Cuisine');
select pg_temp.assert_true(exists(select 1 from public.personal_mapkit_locations where personal_place_id=current_setting('sm.personal')::uuid),'Personal rename preserves location');
select public.update_personal_place(current_setting('sm.personal')::uuid,(select revision from public.personal_places where id=current_setting('sm.personal')::uuid),'Native Cafe','Changed display');
select pg_temp.assert_true(not exists(select 1 from public.personal_mapkit_locations where personal_place_id=current_setting('sm.personal')::uuid),'Personal address edit clears entire snapshot');
select public.save_personal_visit_with_mapkit_location('sm-personal','Native Cafe','Formatted display',null,null,4,false,'PRIVATE',null,null,37.55,-122.12,current_setting('sm.address')::jsonb);
select pg_temp.assert_true(not exists(select 1 from public.personal_mapkit_locations where personal_place_id=current_setting('sm.personal')::uuid),'Receipt replay never restores stale metadata');
reset role;
-- Historical Restaurant facts may be shared, but selected location rows never
-- inherit across group entries. An address edit invalidates both explicit rows.
set local role authenticated;
select set_config('sm.sharedgroup',(public.create_group('Historical shared Maps')).id::text,true);
select set_config('sm.sharedmembership',(select membership_id::text from public.group_memberships where group_id=current_setting('sm.sharedgroup')::uuid and user_id=auth.uid()),true);
reset role;
insert into public.group_restaurants(group_id,restaurant_id,created_by)
    select current_setting('sm.sharedgroup')::uuid,restaurant_id,'11111111-1111-1111-1111-111111111111'::uuid from public.group_restaurants where id=current_setting('sm.entry')::uuid;
select set_config('sm.sharedentry',(select id::text from public.group_restaurants where group_id=current_setting('sm.sharedgroup')::uuid),true);
select pg_temp.assert_true(not exists(select 1 from public.group_mapkit_locations where group_restaurant_id=current_setting('sm.sharedentry')::uuid),'Shared Restaurant never inherits another group location');
set local role authenticated;
select public.save_group_visit_with_mapkit_location('sm-shared',current_setting('sm.sharedgroup')::uuid,'Native Cafe','Formatted display',null,null,null,null,null,null,current_setting('sm.sharedentry')::uuid,current_setting('sm.sharedmembership')::uuid,37.55,-122.12,current_setting('sm.address')::jsonb);
reset role;
update public.restaurants set name='Renamed' where id=(select restaurant_id from public.group_restaurants where id=current_setting('sm.entry')::uuid);
select pg_temp.assert_true(exists(select 1 from public.group_mapkit_locations where group_restaurant_id=current_setting('sm.entry')::uuid),'Group name edit retains snapshot');
update public.restaurants set address='Changed display' where id=(select restaurant_id from public.group_restaurants where id=current_setting('sm.entry')::uuid);
select pg_temp.assert_true(not exists(select 1 from public.group_mapkit_locations where group_restaurant_id=current_setting('sm.entry')::uuid) and (select apple_place_id is null from public.group_restaurants where id=current_setting('sm.entry')::uuid),'Group address edit clears point, components and Apple identity');
select pg_temp.assert_true(not exists(select 1 from public.group_mapkit_locations where group_restaurant_id=current_setting('sm.sharedentry')::uuid),'Shared address edit clears every affected group entry');
set local role authenticated;
select public.save_group_visit_with_mapkit_location('sm-group',current_setting('sm.group')::uuid,'Native Cafe','Formatted display',null,null,4,false,'SHARED','Opaque ID',null,current_setting('sm.membership')::uuid,37.55,-122.12,current_setting('sm.address')::jsonb);
select pg_temp.assert_true(not exists(select 1 from public.group_mapkit_locations where group_restaurant_id=current_setting('sm.entry')::uuid),'Group replay cannot restore invalidated location');
select public.delete_group_visit(current_setting('sm.group')::uuid,current_setting('sm.newmember')::uuid,
    (select id from public.visits where group_restaurant_id=current_setting('sm.newmember')::uuid));
select pg_temp.assert_true(not exists(select 1 from public.group_mapkit_locations where group_restaurant_id=current_setting('sm.newmember')::uuid),'Final visit deletion cascades selected group metadata');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select public.save_group_visit_with_mapkit_location('sm-member-new',current_setting('sm.group')::uuid,'Member Cafe','Member display',null,null,null,null,null,null,null,current_setting('sm.member')::uuid,38,-121,null);
select pg_temp.assert_true(not exists(select 1 from public.group_restaurants where id=current_setting('sm.newmember')::uuid),'Group receipt replay never resurrects a deleted entry');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select public.delete_personal_place(current_setting('sm.legacy')::uuid,(select revision from public.personal_places where id=current_setting('sm.legacy')::uuid));
select public.save_personal_visit_with_mapkit_location('sm-fill','Legacy point','Legacy display',null,null,null,null,null,null,null,37,-122,'{"city":"Native City"}');
select pg_temp.assert_true(not exists(select 1 from public.personal_mapkit_locations where personal_place_id=current_setting('sm.legacy')::uuid),'Personal receipt replay never restores deleted metadata');
rollback;
