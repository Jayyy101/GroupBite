-- Synthetic fixture suite, only inside the existing disposable local runner.
do $$ begin
    if current_setting('groupbite.local_validation',true) is distinct from 'm18-unified-add' then
        raise exception 'Requires the disposable --milestone18 runner'; end if;
end $$;
begin;
create function pg_temp.assert_true(ok boolean,description text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Test failed: %',description; end if; end $$;
create function pg_temp.expect_error(statement text,expected_state text) returns void language plpgsql as $$
begin execute statement;raise exception 'Expected SQLSTATE %',expected_state;
exception when others then if sqlstate<>expected_state then raise;end if;end $$;
select set_config('m18.owner','11111111-1111-1111-1111-111111111111',true);
select set_config('m18.other','22222222-2222-2222-2222-222222222222',true);
select set_config('m18.member','33333333-3333-3333-3333-333333333333',true);
select pg_temp.assert_true((select count(*)=0 from public.personal_visits v join public.personal_places p on p.id=v.personal_place_id
    where v.origin='legacy' and (v.visited_on is distinct from p.visited_on or v.rating is distinct from p.rating
        or v.notes is distinct from p.notes or v.would_go_again is distinct from p.would_go_again)), 'Backfill copies actual values only');
select pg_temp.assert_true((select count(*)=2 from public.personal_places where name='M18 legacy duplicate')
    and (select count(*)=2 from public.personal_visits v join public.personal_places p on p.id=v.personal_place_id where p.name='M18 legacy duplicate' and v.origin='legacy')
    and not exists(select 1 from public.personal_visits v join public.personal_places p on p.id=v.personal_place_id where p.name='M18 legacy empty'),
    'Duplicate cards preserved, one legacy memory each, no invented empty visit');
select pg_temp.assert_true(exists(select 1 from public.personal_visits v join public.personal_places p on p.id=v.personal_place_id
    where p.client_request_id='m18-legacy-a' and v.visited_on is null and v.rating=3 and v.would_go_again=false
    and v.notes='Legacy private memory' and v.created_at=p.created_at and v.updated_at=p.updated_at),
    'Legacy false, NULL date and original timestamps preserved');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.personal_places','INSERT')
    and not has_column_privilege('authenticated','public.personal_places','name','INSERT')
    and not has_column_privilege('authenticated','public.personal_places','notes','UPDATE'),'Legacy direct writes closed');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.add_destination_requests','SELECT')
    and not has_table_privilege('service_role','public.add_destination_requests','INSERT'),'Receipts are RPC only');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.personal_visits'::regclass),'Personal visit RLS enabled');
select pg_temp.assert_true(not has_any_column_privilege('authenticated','public.personal_places','INSERT,UPDATE')
    and not has_table_privilege('authenticated','public.personal_visits','INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated','public.add_destination_requests','SELECT,INSERT,UPDATE,DELETE'),
    'No leftover column grants bypass personal RPCs or expose receipts');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.refresh_personal_place_memory()','EXECUTE')
    and not has_function_privilege('authenticated','public.validate_add_visit(text,text,text,text,date,integer,text)','EXECUTE')
    and not has_function_privilege('service_role','public.save_personal_visit(text,text,text,text,date,integer,boolean,text,text,uuid)','EXECUTE'),
    'Internal helpers and new mutations cannot be called through unintended roles');
set local role anon;
select pg_temp.expect_error($q$select public.save_personal_visit('anon','Cafe','Address')$q$,'42501');
select pg_temp.expect_error($q$select * from public.personal_visits$q$,'42501');
select pg_temp.expect_error($q$select * from public.get_recent_add_restaurants()$q$,'42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error($q$select public.save_personal_visit('no-identity','Cafe','Address')$q$,'42501');
select pg_temp.expect_error($q$select * from public.get_add_destination_result('m18-p1')$q$,'42501');
reset role;
select set_config('request.jwt.claim.sub',current_setting('m18.owner'),true);
set local role authenticated;
select set_config('m18.ga',(public.create_group('M18 synthetic A')).id::text,true);
select set_config('m18.gb',(public.create_group('M18 synthetic B')).id::text,true);
reset role;
insert into public.group_memberships(group_id,user_id) values(current_setting('m18.ga')::uuid,current_setting('m18.member')::uuid);
select set_config('m18.admission',(select membership_id::text from public.group_memberships where group_id=current_setting('m18.ga')::uuid and user_id=current_setting('m18.owner')::uuid),true);
select set_config('m18.admission_b',(select membership_id::text from public.group_memberships where group_id=current_setting('m18.gb')::uuid and user_id=current_setting('m18.owner')::uuid),true);
set local role authenticated;
select pg_temp.expect_error($q$select public.save_personal_visit('m18-ambiguous-legacy','M18 legacy duplicate','Legacy address')$q$,'22023');
select set_config('m18.legacy',(select id::text from public.personal_places where client_request_id='m18-legacy-a'),true);
select public.save_personal_visit('m18-exact-legacy','M18 legacy duplicate','Legacy address',target_entry_id=>current_setting('m18.legacy')::uuid);
select pg_temp.assert_true((select count(*)=2 from public.personal_visits where personal_place_id=current_setting('m18.legacy')::uuid),
    'Explicit legacy duplicate target adds only to the selected card');
select pg_temp.expect_error($q$select public.save_personal_visit('m18-stale-source','Renamed','Legacy address',target_entry_id=>current_setting('m18.legacy')::uuid)$q$,'40001');
select set_config('m18.personal',public.save_personal_visit('m18-p1','M18 Cafe','100 Fixture Road',visit_rating=>5,visit_would_go_again=>false,visit_notes=>'M18 PRIVATE')::text,true);
select pg_temp.assert_true(public.save_personal_visit('m18-p1','M18 Cafe','100 Fixture Road',visit_rating=>5,visit_would_go_again=>false,visit_notes=>'M18 PRIVATE')=current_setting('m18.personal')::uuid,'Exact retry returns same entry');
select public.save_personal_visit('m18-p2','M18 Cafe','100 Fixture Road',visit_date=>date '2026-10-01',visit_rating=>2);
select pg_temp.assert_true((select count(*)=2 from public.personal_visits where personal_place_id=current_setting('m18.personal')::uuid),'Repeat save creates another independent personal visit');
select pg_temp.assert_true((select count(*)=1 from public.personal_places where name='M18 Cafe' and address='100 Fixture Road'),'Repeat save never creates another personal card');
select pg_temp.assert_true((select visited_on is null and would_go_again=false from public.personal_visits where notes='M18 PRIVATE'),'NULL date and false preserved');
select pg_temp.expect_error($q$select public.save_personal_visit('m18-p1','Changed','100 Fixture Road')$q$,'22023');
select public.save_personal_visit('m18-other-location','M18 Cafe','200 Fixture Road');
select pg_temp.assert_true((select count(*)=2 from public.personal_places where name='M18 Cafe'),'Distinct locations remain distinct');
select pg_temp.expect_error($q$select public.update_personal_place(current_setting('m18.personal')::uuid,
    (select revision from public.personal_places where id=current_setting('m18.personal')::uuid),'M18 Cafe','200 Fixture Road')$q$,'22023');
select public.save_personal_visit('m18-apple1','M18 Apple','300 Fixture Road',restaurant_apple_place_id=>'synthetic-apple');
select public.save_personal_visit('m18-apple2','M18 Apple alias','300 Fixture Road',restaurant_apple_place_id=>'synthetic-apple');
select pg_temp.assert_true((select count(*)=1 from public.personal_places where apple_place_id='synthetic-apple'),'Scoped Apple identity reuses a unique consistent location');
select pg_temp.expect_error($q$select public.save_personal_visit('m18-conflict','M18 Apple','400 Fixture Road',restaurant_apple_place_id=>'synthetic-apple')$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit('m18-invalid-date','Cafe','Address',visit_date=>'infinity')$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit('','Cafe','Address')$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit('m18-invalid-rating','Cafe','Address',visit_rating=>6)$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit('m18-invalid-apple','Cafe','Address',restaurant_apple_place_id=>' padded ')$q$,'22023');
select pg_temp.expect_error($q$select * from public.get_recent_add_restaurants(51)$q$,'22023');
select set_config('m18.group_entry',public.save_group_visit_destination('m18-g1',current_setting('m18.ga')::uuid,'M18 Cafe','100 Fixture Road',
    visit_notes=>'M18 SHARED',expected_membership_id=>current_setting('m18.admission')::uuid)::text,true);
select public.save_group_visit_destination('m18-g1',current_setting('m18.ga')::uuid,'M18 Cafe','100 Fixture Road',
    visit_notes=>'M18 SHARED',expected_membership_id=>current_setting('m18.admission')::uuid);
select public.save_group_visit_destination('m18-g2',current_setting('m18.ga')::uuid,'M18 Cafe','100 Fixture Road',expected_membership_id=>current_setting('m18.admission')::uuid);
select public.save_group_visit_destination('m18-gb',current_setting('m18.gb')::uuid,'M18 Cafe','100 Fixture Road',visit_notes=>'M18 SHARED',expected_membership_id=>current_setting('m18.admission_b')::uuid);
select pg_temp.assert_true((select count(*)=2 from public.visits where group_restaurant_id=current_setting('m18.group_entry')::uuid),'Group repeat and exact retry create exactly two visits');
select pg_temp.assert_true((select count(*)=0 from public.visits where notes='M18 PRIVATE'),'Private notes absent from groups');
select pg_temp.assert_true((select count(*)=0 from public.personal_visits where notes='M18 SHARED'),'Group notes absent from personal history');
select pg_temp.assert_true((select count(distinct restaurant_id)=2 from public.group_restaurants where group_id in(current_setting('m18.ga')::uuid,current_setting('m18.gb')::uuid)), 'Restaurant catalog facts stay destination scoped');
select pg_temp.expect_error($q$select public.save_group_visit_destination('m18-wrong-admission',current_setting('m18.ga')::uuid,'Wrong','Address',expected_membership_id=>gen_random_uuid())$q$,'42501');
select pg_temp.expect_error($q$select public.save_personal_visit('m18-wrong-entry','Cafe','Address',target_entry_id=>current_setting('m18.group_entry')::uuid)$q$,'42501');
select pg_temp.expect_error($q$insert into public.personal_visits(personal_place_id,owner_user_id) values(current_setting('m18.personal')::uuid,auth.uid())$q$,'42501');
-- Existing-entry Apple behavior through the NEW adapter: Members save visits
-- without filling NULL; the current Owner may fill NULL but never replace IDs.
reset role;
select set_config('request.jwt.claim.sub',current_setting('m18.member'),true);
select set_config('m18.member_admission',(select membership_id::text from public.group_memberships where group_id=current_setting('m18.ga')::uuid and user_id=current_setting('m18.member')::uuid),true);
set local role authenticated;
select public.save_group_visit_destination('m18-member-apple',current_setting('m18.ga')::uuid,'M18 Cafe','100 Fixture Road',
    restaurant_apple_place_id=>'synthetic-group-apple',expected_membership_id=>current_setting('m18.member_admission')::uuid);
select pg_temp.assert_true((select apple_place_id is null from public.group_restaurants where id=current_setting('m18.group_entry')::uuid),'Member NULL fill ignored');
reset role;
select set_config('request.jwt.claim.sub',current_setting('m18.owner'),true);
set local role authenticated;
select public.save_group_visit_destination('m18-owner-apple',current_setting('m18.ga')::uuid,'M18 Cafe','100 Fixture Road',
    restaurant_apple_place_id=>'synthetic-group-apple',expected_membership_id=>current_setting('m18.admission')::uuid);
select public.save_group_visit_destination('m18-owner-alias',current_setting('m18.ga')::uuid,'M18 native alias','100 Fixture Road',
    restaurant_apple_place_id=>'synthetic-group-apple',expected_membership_id=>current_setting('m18.admission')::uuid);
select pg_temp.assert_true((select count(*)=1 from public.group_restaurants where group_id=current_setting('m18.ga')::uuid),'Apple alias reuses existing group card');
select pg_temp.expect_error($q$select public.save_group_visit_destination('m18-group-apple-conflict',current_setting('m18.ga')::uuid,'M18 Cafe','100 Fixture Road',
    restaurant_apple_place_id=>'different-synthetic-id',expected_membership_id=>current_setting('m18.admission')::uuid)$q$,'22023');
-- The personal RPC cutover retains 16C reference/location invalidation, revision
-- checks and creation-only Apple IDs. History changes still project to the map.
select set_config('m18.facts',public.save_personal_visit('m18-facts','M18 facts','700 Fixture Road',
    restaurant_apple_place_id=>'synthetic-facts-apple',visit_rating=>5,visit_would_go_again=>false,visit_notes=>'Latest private memory')::text,true);
select set_config('m18.facts_revision',(select revision::text from public.personal_places where id=current_setting('m18.facts')::uuid),true);
reset role;
set local role service_role;
select pg_temp.assert_true(public.attach_geoapify_personal_place_location(current_setting('m18.owner')::uuid,current_setting('m18.facts')::uuid,
    current_setting('m18.facts_revision')::integer,'700 Fixture Road',37.7,-122.4,'synthetic-m18-location',clock_timestamp()+interval '1 minute'),
    'Existing server-only personal location attachment works after cutover');
reset role;
set local role authenticated;
select set_config('m18.facts_revision',(select revision::text from public.personal_places where id=current_setting('m18.facts')::uuid),true);
select public.update_personal_place(current_setting('m18.facts')::uuid,current_setting('m18.facts_revision')::integer,'M18 renamed',' 700 Fixture Road ','');
select pg_temp.assert_true((select apple_place_id='synthetic-facts-apple' and cuisine is null and rating=5 and would_go_again=false
    and notes='Latest private memory' from public.personal_places where id=current_setting('m18.facts')::uuid),
    'Facts RPC preserves history and Apple ID when normalized address is unchanged');
select pg_temp.assert_true((select count(*)=0 from public.update_personal_place(current_setting('m18.facts')::uuid,
    current_setting('m18.facts_revision')::integer,'Stale facts','700 Fixture Road')), 'Stale facts revision cannot overwrite newer edit');
select pg_temp.assert_true(not public.delete_personal_place(current_setting('m18.facts')::uuid,current_setting('m18.facts_revision')::integer),
    'Stale whole-card deletion cannot erase newer facts');
select public.update_personal_place(current_setting('m18.facts')::uuid,(select revision from public.personal_places where id=current_setting('m18.facts')::uuid),
    'M18 renamed','701 Fixture Road');
select pg_temp.assert_true((select apple_place_id is null from public.personal_places where id=current_setting('m18.facts')::uuid)
    and not exists(select 1 from public.personal_place_locations where personal_place_id=current_setting('m18.facts')::uuid),
    'Address RPC clears stale Apple ID and verified location atomically');
select public.save_personal_visit('m18-facts-repeat','M18 renamed','701 Fixture Road',restaurant_apple_place_id=>'must-not-fill');
select pg_temp.assert_true((select apple_place_id is null and rating is null and notes is null and would_go_again is null
    from public.personal_places where id=current_setting('m18.facts')::uuid), 'Existing personal ID stays creation-only; empty newest visit clears map projection');
select set_config('m18.last_visit',(select id::text from public.personal_visits where personal_place_id=current_setting('m18.facts')::uuid
    and origin='visit' order by created_at desc,id desc limit 1),true);
select public.manage_personal_visit(current_setting('m18.facts')::uuid,current_setting('m18.last_visit')::uuid,1,true);
select pg_temp.assert_true((select rating=5 and would_go_again=false and notes='Latest private memory' from public.personal_places where id=current_setting('m18.facts')::uuid),
    'Deleting latest visit restores remaining memory projection');
select public.manage_personal_visit(current_setting('m18.facts')::uuid,(select id from public.personal_visits where personal_place_id=current_setting('m18.facts')::uuid),1,true);
select pg_temp.assert_true((select rating is null and notes is null and visited_on is null and would_go_again is null
    from public.personal_places where id=current_setting('m18.facts')::uuid), 'Deleting last visit keeps card with empty map memory');
-- Individual edits/deletes never change another personal visit or any group.
select set_config('m18.first_visit',(select id::text from public.personal_visits where notes='M18 PRIVATE'),true);
select public.manage_personal_visit(current_setting('m18.personal')::uuid,current_setting('m18.first_visit')::uuid,1,false,visit_rating=>4,visit_notes=>'M18 edited private');
select pg_temp.assert_true((select count(*)=1 from public.personal_visits where personal_place_id=current_setting('m18.personal')::uuid and rating=2),'Other personal visit unchanged');
select pg_temp.assert_true((select count(*)=0 from public.manage_personal_visit(current_setting('m18.personal')::uuid,current_setting('m18.first_visit')::uuid,1,false)), 'Stale revision cannot edit');
select public.manage_personal_visit(current_setting('m18.personal')::uuid,current_setting('m18.first_visit')::uuid,2,true);
select pg_temp.assert_true((select count(*)=1 from public.personal_places where id=current_setting('m18.personal')::uuid),'Deleting one visit keeps restaurant');
select pg_temp.assert_true((select count(*)=1 from public.personal_visits where personal_place_id=current_setting('m18.personal')::uuid),'Other visit retained');
select pg_temp.assert_true((select count(*)=1 from public.get_add_destination_result('m18-p1')),'Receipt retained after visit deletion');
reset role;
select pg_temp.expect_error($q$update public.add_destination_requests set entry_id=gen_random_uuid() where request_id='m18-p1'$q$,'42501');
-- Force recovery-receipt insertion to fail AFTER the legacy group save. Catching
-- the exception in a subtransaction must roll back entry, visit, old receipt AND
-- location binding. This tests the no-gap contract against actual PostgreSQL.
create function pg_temp.fail_m18_receipt() returns trigger language plpgsql as $$
begin if new.request_id like 'm18-receipt-fail%' then raise exception 'Synthetic receipt failure' using errcode='22023';end if;return new;end $$;
create trigger m18_receipt_failure before insert on public.add_destination_requests for each row execute function pg_temp.fail_m18_receipt();
set local role authenticated;
select pg_temp.expect_error($q$select public.save_group_visit_destination('m18-receipt-fail-group',current_setting('m18.ga')::uuid,'M18 failed receipt','500 Fixture Road',expected_membership_id=>current_setting('m18.admission')::uuid)$q$,'22023');
select pg_temp.expect_error($q$select public.save_personal_visit('m18-receipt-fail-personal','M18 failed receipt','500 Fixture Road')$q$,'22023');
select pg_temp.assert_true((select count(*)=0 from public.personal_places where name='M18 failed receipt'),'Personal receipt failure rolls back card');
select pg_temp.assert_true((select count(*)=0 from public.restaurants where name='M18 failed receipt'),'Group receipt failure rolls back Restaurant/card/visit');
reset role;
select pg_temp.assert_true((select count(*)=0 from public.visit_save_requests where request_id='m18:m18-receipt-fail-group'),'Legacy receipt rolled back with recovery receipt failure');
select pg_temp.assert_true((select count(*)=0 from public.visit_save_location_bindings where request_id='m18:m18-receipt-fail-group'),'Binding rolled back with receipt failure');
-- Foreign account gets no personal data or another actor's receipt.
select set_config('request.jwt.claim.sub',current_setting('m18.other'),true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.personal_visits where owner_user_id=current_setting('m18.owner')::uuid),'Foreign personal visits hidden');
select pg_temp.assert_true((select count(*)=0 from public.get_add_destination_result('m18-p1')),'Foreign receipt hidden');
select pg_temp.assert_true((select count(*)=0 from public.get_recent_add_restaurants(50) where name like 'M18%'), 'Foreign recent identities reveal no owner cards or groups');
select public.save_personal_visit('m18-p1','M18 Apple','300 Fixture Road',restaurant_apple_place_id=>'synthetic-apple');
select pg_temp.assert_true((select count(*)=1 from public.personal_places where apple_place_id='synthetic-apple'), 'Same opaque Apple ID can identify a separate private card for another owner');
select pg_temp.assert_true((select count(*)=0 from public.update_personal_place(current_setting('m18.facts')::uuid,1,'Foreign edit','Address'))
    and not public.delete_personal_place(current_setting('m18.facts')::uuid,1), 'Foreign facts edit/delete cannot mutate owner cards');
select pg_temp.expect_error($q$select public.save_group_visit_destination('m18-denied',current_setting('m18.ga')::uuid,'M18 denied','600 Fixture Road',expected_membership_id=>current_setting('m18.admission')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.manage_personal_visit(current_setting('m18.personal')::uuid,current_setting('m18.first_visit')::uuid,3,true)$q$,'42501');
reset role;
-- Whole-card deletion retains receipt tombstones, and retries do not resurrect.
select set_config('request.jwt.claim.sub',current_setting('m18.owner'),true);
set local role authenticated;
select public.delete_personal_place(current_setting('m18.personal')::uuid,(select revision from public.personal_places where id=current_setting('m18.personal')::uuid));
select pg_temp.assert_true((select not available from public.get_add_destination_result('m18-p1')),'Deleted card receipt confirms historical save without navigation');
select public.save_personal_visit('m18-p1','M18 Cafe','100 Fixture Road',visit_rating=>5,visit_would_go_again=>false,visit_notes=>'M18 PRIVATE');
select pg_temp.assert_true((select count(*)=0 from public.personal_places where id=current_setting('m18.personal')::uuid),'Retry never recreates deleted personal card');
reset role;
-- Removing membership hides protected result IDs but keeps own commit proof.
-- Transfer ownership first because an Owner must remain a member.
update public.groups set owner_user_id=current_setting('m18.member')::uuid where id=current_setting('m18.ga')::uuid;
delete from public.group_memberships where group_id=current_setting('m18.ga')::uuid and user_id=current_setting('m18.owner')::uuid;
set local role authenticated;
select pg_temp.assert_true((select not available and entry_id is null and visit_id is null from public.get_add_destination_result('m18-g1')), 'Revoked membership retains own proof without group contents');
select pg_temp.assert_true((select count(*)=0 from public.get_recent_add_restaurants(50) where group_id=current_setting('m18.ga')::uuid),'Recent source excludes revoked groups');
rollback;
