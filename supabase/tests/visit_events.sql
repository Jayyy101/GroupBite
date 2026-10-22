do $$ begin
    if current_setting('groupbite.local_validation',true) is distinct from 'visit-events' then raise exception 'Requires disposable --visit-events runner'; end if;
end $$;
begin;
create or replace function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Test failed: %',label;end if;end $$;
create or replace function pg_temp.expect_error(statement text,expected_state text) returns void language plpgsql as $$
begin execute statement;raise exception 'Expected SQLSTATE %',expected_state;
exception when others then if sqlstate<>expected_state then raise;end if;end $$;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
set local role authenticated;
select set_config('ve.group',(public.create_group('Visit event SQL')).id::text,true);
select set_config('ve.admission',(select membership_id::text from public.group_memberships where group_id=current_setting('ve.group')::uuid and user_id=auth.uid()),true);
select set_config('ve.before',(select row_to_json(s)::text from public.get_my_visit_event_summary() s),true);
select set_config('ve.personal',public.save_visit_event_destination('ve-one','ve-personal','personal','Event cafe','Event display',visit_date=>'2026-10-22',visit_notes=>'PRIVATE',selected_latitude=>37,selected_longitude=>-122,selected_address=>'{"city":"Fremont","region":"CA","country_code":"US"}')::text,true);
select set_config('ve.entry',public.save_visit_event_destination('ve-one','ve-group','group','Event cafe','Event display',visit_date=>'2026-10-22',visit_notes=>'SHARED',target_group_id=>current_setting('ve.group')::uuid,expected_membership_id=>current_setting('ve.admission')::uuid)::text,true);
select pg_temp.assert_true((select linked_events=(current_setting('ve.before')::jsonb->>'linked_events')::bigint+1 and linked_records=(current_setting('ve.before')::jsonb->>'linked_records')::bigint+2 from public.get_my_visit_event_summary()),'One operation across destinations counts once');
select public.save_visit_event_destination('ve-one','ve-personal','personal','Event cafe','Event display',visit_date=>'2026-10-22',visit_notes=>'PRIVATE',selected_latitude=>37,selected_longitude=>-122,selected_address=>'{"city":"Fremont","region":"CA","country_code":"US"}');
select pg_temp.assert_true((select count(*)=1 and min(notes)='PRIVATE' from public.personal_visits where personal_place_id=current_setting('ve.personal')::uuid) and (select count(*)=1 and min(notes)='SHARED' from public.visits where group_restaurant_id=current_setting('ve.entry')::uuid),'Retries preserve independent notes and visits');
select pg_temp.assert_true(public.get_saved_mapkit_location('personal',current_setting('ve.personal')::uuid,'Event display')->'structured_address'->>'city'='Fremont','Wrapper preserves Apple components');
select pg_temp.assert_true((select available from public.get_add_destination_result('ve-personal')),'Legacy recovery receipt remains authoritative');
select pg_temp.expect_error($q$select public.save_visit_event_destination('ve-one','ve-personal','personal','Event cafe','Event display',visit_date=>'2026-10-22',visit_notes=>'CHANGED')$q$,'22023');
select pg_temp.expect_error($q$select public.save_visit_event_destination('ve-other','ve-personal','personal','Event cafe','Event display',visit_date=>'2026-10-22')$q$,'22023');
select pg_temp.expect_error($q$select public.save_visit_event_destination('ve-one','ve-duplicate','personal','Event cafe','Event display',visit_date=>'2026-10-22')$q$,'22023');
select pg_temp.expect_error($q$select public.save_visit_event_destination('ve-one','ve-changed-date','group','Event cafe','Event display',visit_date=>'2026-10-21',target_group_id=>current_setting('ve.group')::uuid,expected_membership_id=>current_setting('ve.admission')::uuid)$q$,'22023');
-- A separate operation with identical facts is a separate occasion.
select public.save_visit_event_destination('ve-two','ve-repeat','personal','Event cafe','Event display',visit_date=>'2026-10-22');
select public.save_personal_visit('ve-legacy','Legacy unlinked','Legacy display');
select pg_temp.assert_true((select linked_events=(current_setting('ve.before')::jsonb->>'linked_events')::bigint+2 and unlinked_records=(current_setting('ve.before')::jsonb->>'unlinked_records')::bigint+1 from public.get_my_visit_event_summary()),'Legacy unlinked rows remain explicitly incomplete');
select pg_temp.expect_error($q$select public.save_visit_event_destination('ve-legacy-event','ve-legacy','personal','Legacy unlinked','Legacy display')$q$,'22023');
select pg_temp.expect_error('select * from public.visit_events','42501');
select pg_temp.expect_error('select * from public.visit_event_destinations','42501');
select pg_temp.assert_true(not has_table_privilege('service_role','public.visit_events','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated','public.visit_event_destinations','INSERT,UPDATE,DELETE'),'No direct provenance access');
select pg_temp.assert_true(not has_function_privilege('anon','public.get_my_visit_event_summary()','EXECUTE'),'Anonymous summary denied');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select set_config('ve.otherbefore',(select row_to_json(s)::text from public.get_my_visit_event_summary() s),true);
select public.save_visit_event_destination('ve-one','ve-personal','personal','Other cafe','Other address');
select pg_temp.assert_true((select linked_events=(current_setting('ve.otherbefore')::jsonb->>'linked_events')::bigint+1 from public.get_my_visit_event_summary()),'Same opaque event string in another account is independent');
select pg_temp.expect_error($q$select public.save_visit_event_destination('ve-foreign','ve-foreign','group','Event cafe','Event display',target_group_id=>current_setting('ve.group')::uuid,expected_membership_id=>current_setting('ve.admission')::uuid)$q$,'42501');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error('select * from public.get_my_visit_event_summary()','42501');
reset role;
-- Enforce transaction atomicity by failing ONLY the new link insertion.
create function pg_temp.fail_event_link() returns trigger language plpgsql as $$begin raise exception 'synthetic failure' using errcode='23514';end $$;
create trigger fail_event_link before insert on public.visit_event_destinations for each row execute function pg_temp.fail_event_link();
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.expect_error($q$select public.save_visit_event_destination('ve-rollback','ve-rollback','personal','Rollback event','Rollback address',selected_latitude=>37,selected_longitude=>-122,selected_address=>'{"city":"Fremont"}')$q$,'23514');
select pg_temp.expect_error($q$select public.save_visit_event_destination('ve-two','ve-partial-group','group','Event cafe','Event display',visit_date=>'2026-10-22',target_group_id=>current_setting('ve.group')::uuid,expected_membership_id=>current_setting('ve.admission')::uuid)$q$,'23514');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.visit_event_destinations where user_id='11111111-1111-1111-1111-111111111111' and event_id='ve-two')
    and exists(select 1 from public.add_destination_requests where request_id='ve-repeat')
    and not exists(select 1 from public.add_destination_requests where request_id='ve-partial-group'),'Later failed destination preserves the previously committed event and receipt');
drop trigger fail_event_link on public.visit_event_destinations;
select pg_temp.assert_true(not exists(select 1 from public.visit_events where event_id='ve-rollback') and not exists(select 1 from public.add_destination_requests where request_id='ve-rollback') and not exists(select 1 from public.personal_places where name='Rollback event') and not exists(select 1 from public.mapkit_location_save_requests where request_id='ve-rollback'),'New link failure rolls back event/card/visit/location/receipts together');
select pg_temp.expect_error($q$update public.visit_events set event_hash='changed' where event_id='ve-one'$q$,'42501');
select pg_temp.expect_error($q$update public.visit_event_destinations set event_id='changed' where request_id='ve-group'$q$,'42501');
-- Member's own recorded occasions only; other members' histories stay separate.
insert into public.group_memberships(group_id,user_id) values(current_setting('ve.group')::uuid,'33333333-3333-3333-3333-333333333333');
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select set_config('ve.member',(select membership_id::text from public.group_memberships where group_id=current_setting('ve.group')::uuid and user_id=auth.uid()),true);
select set_config('ve.memberbefore',(select row_to_json(s)::text from public.get_my_visit_event_summary() s),true);
select public.save_visit_event_destination('ve-member','ve-member','group','Event cafe','Event display',target_entry_id=>current_setting('ve.entry')::uuid,target_group_id=>current_setting('ve.group')::uuid,expected_membership_id=>current_setting('ve.member')::uuid);
select pg_temp.assert_true((select linked_events=(current_setting('ve.memberbefore')::jsonb->>'linked_events')::bigint+1 and linked_records=(current_setting('ve.memberbefore')::jsonb->>'linked_records')::bigint+1 from public.get_my_visit_event_summary()),'Membership gives access without counting another author');
reset role;
delete from public.group_memberships where group_id=current_setting('ve.group')::uuid and user_id='33333333-3333-3333-3333-333333333333';
set local role authenticated;
select pg_temp.assert_true((select linked_events=(current_setting('ve.memberbefore')::jsonb->>'linked_events')::bigint from public.get_my_visit_event_summary()),'Revoked group history excluded from current total');
select pg_temp.assert_true((select not available from public.get_add_destination_result('ve-member')),'Revocation keeps receipt proof but removes navigation');
select pg_temp.expect_error($q$select public.save_visit_event_destination('ve-member','ve-member','group','Event cafe','Event display',target_entry_id=>current_setting('ve.entry')::uuid,target_group_id=>current_setting('ve.group')::uuid,expected_membership_id=>current_setting('ve.member')::uuid)$q$,'42501');
reset role;
-- Independent removal never deletes another destination's history or proof.
delete from public.personal_visits where personal_place_id=current_setting('ve.personal')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.assert_true((select linked_events=(current_setting('ve.before')::jsonb->>'linked_events')::bigint+1 from public.get_my_visit_event_summary()),'Event remains counted once while group copy survives');
reset role;
delete from public.visits where group_restaurant_id=current_setting('ve.entry')::uuid;
set local role authenticated;
select pg_temp.assert_true((select linked_events=(current_setting('ve.before')::jsonb->>'linked_events')::bigint from public.get_my_visit_event_summary()),'No live copies means no occasion in current total');
reset role;
select pg_temp.assert_true(exists(select 1 from public.add_destination_requests where request_id='ve-group') and exists(select 1 from public.visit_event_destinations where request_id='ve-group'),'Historical destination proof survives deletion');
rollback;
