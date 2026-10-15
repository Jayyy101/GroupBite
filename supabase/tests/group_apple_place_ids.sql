-- Only synthetic fixtures in an owned disposable local database.
do $$ begin
    if current_setting('groupbite.local_validation',true) is distinct from 'group-apple-place-ids' then
        raise exception 'Requires the disposable local group Apple runner';
    end if;
end $$;
begin;
create function pg_temp.assert_true(ok boolean, description text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Test failed: %', description; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
begin execute statement; raise exception 'Expected SQLSTATE %, operation succeeded', expected_state;
exception when others then if sqlstate <> expected_state then raise; end if; end $$;

select pg_temp.assert_true((select atttypid='text'::regtype and not attnotnull and not atthasdef from pg_attribute
    where attrelid='public.group_restaurants'::regclass and attname='apple_place_id'), 'Nullable text without default/backfill');
select pg_temp.assert_true((select convalidated from pg_constraint where conname='group_restaurants_apple_place_id_check'), 'Validated ID constraint');
select pg_temp.assert_true(not has_any_column_privilege('authenticated','public.group_restaurants','INSERT,UPDATE,REFERENCES')
    and not has_table_privilege('authenticated','public.group_restaurants','INSERT,UPDATE,DELETE,TRIGGER,TRUNCATE'), 'No direct metadata writes');
select pg_temp.assert_true(not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name in ('restaurants','visits') and column_name='apple_place_id'), 'IDs only on scoped entries');
do $$ declare f text; r text; begin
    foreach f in array array['public.save_restaurant_visit_with_apple_place_id(text,uuid[],text,text,text,date,integer,boolean,text,text)',
        'public.get_group_restaurant_apple_place_id(uuid,uuid)'] loop
        foreach r in array array['anon','service_role','public'] loop
            perform pg_temp.assert_true(not has_function_privilege(r,f,'EXECUTE'), 'No RPC permission for '||r);
        end loop;
        perform pg_temp.assert_true(has_function_privilege('authenticated',f,'EXECUTE'), 'Authenticated RPC');
        perform pg_temp.assert_true((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=f::regprocedure), 'Definer with empty path');
    end loop;
end $$;
select set_config('apple.owner',(select id::text from public.profiles order by id limit 1),true);
select set_config('apple.other',(select id::text from public.profiles order by id offset 1 limit 1),true);
select set_config('apple.member',(select id::text from public.profiles order by id offset 2 limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('apple.owner'),true);
select set_config('apple.ga',(select id::text from public.create_group('Apple A')),true);
select set_config('apple.gb',(select id::text from public.create_group('Apple B')),true);
select set_config('request.jwt.claim.sub',current_setting('apple.other'),true);
select set_config('apple.gc',(select id::text from public.create_group('Apple Hidden')),true);
reset role;
insert into public.group_memberships(group_id,user_id) values
    (current_setting('apple.ga')::uuid,current_setting('apple.member')::uuid),
    (current_setting('apple.gb')::uuid,current_setting('apple.member')::uuid),
    (current_setting('apple.gb')::uuid,current_setting('apple.other')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('apple.owner'),true);
select public.save_restaurant_visit('apple-legacy',array[current_setting('apple.ga')::uuid],' User Cafe ',' 100 Fixture Road ',visit_rating=>4);
select * from public.save_restaurant_visit_with_apple_place_id('apple-legacy',array[current_setting('apple.ga')::uuid],'User Cafe','100 Fixture Road',visit_rating=>4);
select pg_temp.assert_true((select count(*)=1 from public.get_group_restaurants(current_setting('apple.ga')::uuid)
    where name='User Cafe' and address='100 Fixture Road'), 'Legacy retry keeps exactly one matching card');
select pg_temp.assert_true((select total_visit_count=1 from public.get_group_restaurants(current_setting('apple.ga')::uuid)), 'Legacy receipt replays exactly with NULL ID');
select pg_temp.assert_true(not exists(select 1 from public.get_visit_save_location_targets('apple-legacy')), 'Legacy receipt never upgraded to bindings');
select pg_temp.expect_error($q$select * from public.save_restaurant_visit_with_apple_place_id('apple-legacy',array[current_setting('apple.ga')::uuid],'User Cafe','100 Fixture Road',visit_rating=>4,restaurant_apple_place_id=>'ID')$q$, '22023');
select set_config('request.jwt.claim.sub',current_setting('apple.member'),true);
select * from public.save_restaurant_visit_with_apple_place_id('apple-member-multi',array[current_setting('apple.gb')::uuid,current_setting('apple.ga')::uuid,current_setting('apple.ga')::uuid],
    ' User Cafe ',' 100 Fixture Road ',restaurant_apple_place_id=>'Opaque-α:MiXeD/Id');
select pg_temp.assert_true((select apple_place_id is null from public.group_restaurants where group_id=current_setting('apple.ga')::uuid), 'Member cannot fill existing NULL');
select pg_temp.assert_true((select apple_place_id='Opaque-α:MiXeD/Id' from public.group_restaurants where group_id=current_setting('apple.gb')::uuid), 'Member may attach at creation');
select pg_temp.assert_true((select count(*)=2 from public.get_visit_save_location_targets('apple-member-multi')), 'Exact scoped multi-group bindings');
select * from public.save_restaurant_visit_with_apple_place_id('apple-member-multi',array[current_setting('apple.ga')::uuid,current_setting('apple.gb')::uuid],
    'User Cafe','100 Fixture Road',restaurant_apple_place_id=>'Opaque-α:MiXeD/Id');
select pg_temp.assert_true((select count(*)=1 from public.get_group_restaurants(current_setting('apple.ga')::uuid)
    where name='User Cafe' and address='100 Fixture Road')
    and (select count(*)=1 from public.get_group_restaurants(current_setting('apple.gb')::uuid)
    where name='User Cafe' and address='100 Fixture Road'), 'Multi-group retry keeps exactly one matching card in EACH destination');
select pg_temp.assert_true((select total_visit_count=2 from public.get_group_restaurants(current_setting('apple.ga')::uuid))
    and (select total_visit_count=1 from public.get_group_restaurants(current_setting('apple.gb')::uuid)), 'Retries do not duplicate cards or visits');
select pg_temp.expect_error($q$select * from public.save_restaurant_visit_with_apple_place_id('apple-member-multi',array[current_setting('apple.ga')::uuid,current_setting('apple.gb')::uuid],'User Cafe','100 Fixture Road',restaurant_apple_place_id=>'Different')$q$, '22023');
select pg_temp.expect_error($q$select public.save_restaurant_visit('apple-member-multi',array[current_setting('apple.ga')::uuid,current_setting('apple.gb')::uuid],'User Cafe','100 Fixture Road')$q$, '22023');
select set_config('request.jwt.claim.sub',current_setting('apple.owner'),true);
select * from public.save_restaurant_visit_with_apple_place_id('apple-owner-fill',array[current_setting('apple.ga')::uuid,current_setting('apple.gb')::uuid],
    'User Cafe','100 Fixture Road',restaurant_apple_place_id=>'Owner ID');
select * from public.save_restaurant_visit_with_apple_place_id('apple-no-overwrite',array[current_setting('apple.ga')::uuid],'User Cafe','100 Fixture Road',restaurant_apple_place_id=>'Replacement');
select public.save_restaurant_visit('apple-no-clear',array[current_setting('apple.ga')::uuid],'User Cafe','100 Fixture Road');
select pg_temp.assert_true((select count(*)=1 from public.get_group_restaurants(current_setting('apple.ga')::uuid)
    where name='User Cafe' and address='100 Fixture Road')
    and (select count(*)=1 from public.get_group_restaurants(current_setting('apple.gb')::uuid)
    where name='User Cafe' and address='100 Fixture Road'), 'Repeated owner/member saves keep exactly one matching card per destination');
select pg_temp.assert_true((select apple_place_id='Owner ID' from public.group_restaurants where group_id=current_setting('apple.ga')::uuid), 'Owner NULL fill, never overwrite or clear');
select pg_temp.assert_true((select apple_place_id='Opaque-α:MiXeD/Id' from public.group_restaurants where group_id=current_setting('apple.gb')::uuid), 'Each group decides independently');
select set_config('apple.entry',(select id::text from public.group_restaurants where group_id=current_setting('apple.ga')::uuid),true);
select pg_temp.assert_true((select apple_place_id='Owner ID' from public.get_group_restaurant_apple_place_id(current_setting('apple.ga')::uuid,current_setting('apple.entry')::uuid)), 'Scoped saved-ID lookup');
select pg_temp.assert_true(not exists(select 1 from public.get_group_restaurant_apple_place_id(current_setting('apple.gb')::uuid,current_setting('apple.entry')::uuid)), 'Wrong route group with valid membership exposes no ID');
select pg_temp.expect_error($q$select * from public.get_group_restaurant_apple_place_id(current_setting('apple.gc')::uuid,current_setting('apple.entry')::uuid)$q$, '42501');
select pg_temp.expect_error($q$update public.group_restaurants set apple_place_id='Direct' where id=current_setting('apple.entry')::uuid$q$, '42501');
select pg_temp.expect_error($q$select * from public.save_restaurant_visit_with_apple_place_id('apple-denied',array[current_setting('apple.ga')::uuid,current_setting('apple.gc')::uuid],'Rollback','No writes',restaurant_apple_place_id=>'ID')$q$, '42501');
-- Same Apple ID and different exact names/addresses must remain separate cards.
select * from public.save_restaurant_visit_with_apple_place_id('apple-distinct',array[current_setting('apple.ga')::uuid],'Other Cafe','100 Fixture Road',restaurant_apple_place_id=>'Owner ID');
select pg_temp.assert_true((select count(*)=2 from public.get_group_restaurants(current_setting('apple.ga')::uuid)), 'Apple ID never deduplicates');
do $$ declare invalid text; code integer; begin
    foreach invalid in array array['',repeat('x',301),' padded','padded ',U&'\00A0id',U&'id\FEFF'] loop
        perform pg_temp.expect_error(format('select * from public.save_restaurant_visit_with_apple_place_id(%L,array[%L::uuid],%L,%L,restaurant_apple_place_id=>%L)',
            'apple-invalid',current_setting('apple.ga'),'Invalid','Address',invalid),'22023');
    end loop;
    for code in 1..159 loop
        if code<=31 or code>=127 then
            perform pg_temp.expect_error(format('select * from public.save_restaurant_visit_with_apple_place_id(%L,array[%L::uuid],%L,%L,restaurant_apple_place_id=>%L)',
                'apple-invalid',current_setting('apple.ga'),'Invalid','Address','in'||chr(code)||'side'),'22023');
        end if;
    end loop;
end $$;
-- ID-bearing saves cannot inherit unrelated global facts or reveal existence.
select set_config('request.jwt.claim.sub',current_setting('apple.other'),true);
select * from public.save_restaurant_visit_with_apple_place_id('apple-hidden-new',array[current_setting('apple.gc')::uuid],
    'User Cafe','100 Fixture Road','Own cuisine',restaurant_apple_place_id=>'Owner ID');
select pg_temp.assert_true((select count(*)=2 from public.restaurants where name='User Cafe')
    and (select cuisine='Own cuisine' from public.restaurants r join public.group_restaurants gr on gr.restaurant_id=r.id
        where gr.group_id=current_setting('apple.gc')::uuid), 'Apple-aware save has no unrelated first-writer fact oracle');
select set_config('request.jwt.claim.sub',current_setting('apple.owner'),true);
select * from public.save_restaurant_visit_with_apple_place_id('apple-unicode',array[current_setting('apple.gb')::uuid],'Unicode','Address',restaurant_apple_place_id=>repeat('🍕',300));
reset role;
select pg_temp.assert_true((select pg_get_constraintdef(oid) from pg_constraint where conname='group_restaurants_apple_place_id_check')
    = (select pg_get_constraintdef(oid) from pg_constraint where conname='personal_places_apple_place_id_check'), 'Identical Migration 13 opaque-ID constraint');
select pg_temp.expect_error($q$update public.group_restaurants set apple_place_id=' padded' where id=current_setting('apple.entry')::uuid$q$, '23514');
-- Existing Visit management must preserve shared metadata and other memories.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('apple.member'),true);
select public.update_group_visit(current_setting('apple.ga')::uuid,current_setting('apple.entry')::uuid,
    (select id from public.visits where group_restaurant_id=current_setting('apple.entry')::uuid and created_by=auth.uid() limit 1),
    '2026-10-13',5,false,'Updated visit');
select pg_temp.assert_true((select apple_place_id='Owner ID' from public.group_restaurants where id=current_setting('apple.entry')::uuid), 'Visit edit preserves ID');
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('apple.ga')::uuid,current_setting('apple.entry')::uuid,
    (select id from public.visits where group_restaurant_id=current_setting('apple.entry')::uuid and created_by=current_setting('apple.owner')::uuid limit 1),null,null,null,null)$q$, '42501');
select public.delete_group_visit(current_setting('apple.ga')::uuid,current_setting('apple.entry')::uuid,
    (select id from public.visits where group_restaurant_id=current_setting('apple.entry')::uuid and created_by=auth.uid() limit 1));
select pg_temp.assert_true((select apple_place_id='Owner ID' from public.group_restaurants where id=current_setting('apple.entry')::uuid), 'Nonfinal deletion preserves entry ID');
reset role;
-- Force a failure on group two after group one's writes, including an owner fill.
create function pg_temp.fail_second_visit() returns trigger language plpgsql as $$ begin
    if new.notes='forced rollback' and exists(select 1 from public.group_restaurants gr where gr.id=new.group_restaurant_id
        and gr.group_id=greatest(current_setting('apple.ga')::uuid,current_setting('apple.gb')::uuid)) then
        raise exception 'Synthetic second-group failure' using errcode='P0001';
    end if; return new;
end $$;
create trigger apple_test_failure before insert on public.visits for each row execute function pg_temp.fail_second_visit();
update public.group_restaurants set apple_place_id=null where group_id in (current_setting('apple.ga')::uuid,current_setting('apple.gb')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('apple.owner'),true);
select pg_temp.expect_error($q$select * from public.save_restaurant_visit_with_apple_place_id('apple-failed',array[current_setting('apple.ga')::uuid,current_setting('apple.gb')::uuid],'User Cafe','100 Fixture Road',visit_notes=>'forced rollback',restaurant_apple_place_id=>'Rolled back')$q$, 'P0001');
select pg_temp.expect_error($q$select * from public.save_restaurant_visit_with_apple_place_id('apple-failed-new',array[current_setting('apple.ga')::uuid,current_setting('apple.gb')::uuid],'Rollback new facts','No writes',visit_notes=>'forced rollback',restaurant_apple_place_id=>'Rolled back')$q$, 'P0001');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.restaurants where name='Rollback new facts'), 'Second-group failure rolls back new facts and cards');
select pg_temp.assert_true(not exists(select 1 from public.visit_save_requests where request_id in ('apple-failed','apple-failed-new','apple-denied','apple-invalid'))
    and not exists(select 1 from public.visits where notes='forced rollback')
    and not exists(select 1 from public.group_restaurants where apple_place_id='Rolled back'), 'All visits, ID fills, receipts and bindings roll back');
-- A historical shared Restaurant invalidates IDs in ALL groups, plus Geoapify.
update public.group_restaurants set restaurant_id=(select restaurant_id from public.group_restaurants where id=current_setting('apple.entry')::uuid),apple_place_id='Shared ID'
    where group_id=current_setting('apple.gb')::uuid and restaurant_id in(select id from public.restaurants where name='User Cafe');
update public.group_restaurants set apple_place_id='Shared ID' where id=current_setting('apple.entry')::uuid;
set local role service_role;
select public.attach_verified_restaurant_location(current_setting('apple.owner')::uuid,current_setting('apple.ga')::uuid,
    (select restaurant_id from public.group_restaurants where id=current_setting('apple.entry')::uuid),current_setting('apple.entry')::uuid,
    '100 Fixture Road',37.7,-122.4,'geoapify','group-apple-fixture','100 Fixture Road','building');
reset role;
update public.restaurants set name='Renamed Cafe',address=address where id=(select restaurant_id from public.group_restaurants where id=current_setting('apple.entry')::uuid);
select pg_temp.assert_true((select count(*)=2 from public.group_restaurants where apple_place_id='Shared ID')
    and exists(select 1 from public.group_restaurant_locations where group_restaurant_id=current_setting('apple.entry')::uuid), 'Unchanged address/name preserve IDs and Geoapify');
update public.restaurants set address='200 Changed Road' where id=(select restaurant_id from public.group_restaurants where id=current_setting('apple.entry')::uuid);
select pg_temp.assert_true(not exists(select 1 from public.group_restaurants where apple_place_id='Shared ID') and not exists(select 1 from public.group_restaurant_locations where group_restaurant_id=current_setting('apple.entry')::uuid), 'Actual underlying address edit clears all shared IDs and stale Geoapify');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('apple.owner'),true);
select * from public.save_restaurant_visit_with_apple_place_id('apple-owner-fill',array[current_setting('apple.ga')::uuid,current_setting('apple.gb')::uuid],'User Cafe','100 Fixture Road',restaurant_apple_place_id=>'Owner ID');
select pg_temp.assert_true((select apple_place_id is null from public.group_restaurants where id=current_setting('apple.entry')::uuid), 'Old receipt retry never restores invalidated ID');
select set_config('request.jwt.claim.sub',current_setting('apple.other'),true);
select pg_temp.assert_true(not exists(select 1 from public.group_restaurants where group_id=current_setting('apple.ga')::uuid), 'RLS hides unrelated IDs');
-- Last-visit deletion/recreation does not upgrade an old receipt to a new entry.
select set_config('request.jwt.claim.sub',current_setting('apple.owner'),true);
select * from public.save_restaurant_visit_with_apple_place_id('apple-delete-last',array[current_setting('apple.ga')::uuid],'Delete last','Address',restaurant_apple_place_id=>'Deleted ID');
select set_config('apple.deleted',(select gr.id::text from public.group_restaurants gr join public.restaurants r on r.id=gr.restaurant_id
    where gr.group_id=current_setting('apple.ga')::uuid and r.name='Delete last'),true);
select pg_temp.assert_true(public.delete_group_visit(current_setting('apple.ga')::uuid,current_setting('apple.deleted')::uuid,
    (select id from public.visits where group_restaurant_id=current_setting('apple.deleted')::uuid)), 'Final deletion removes scoped card');
select public.save_restaurant_visit('apple-recreated',array[current_setting('apple.ga')::uuid],'Delete last','Address');
select * from public.save_restaurant_visit_with_apple_place_id('apple-delete-last',array[current_setting('apple.ga')::uuid],'Delete last','Address',restaurant_apple_place_id=>'Deleted ID');
select pg_temp.assert_true(not exists(select 1 from public.get_group_restaurant_apple_place_id(current_setting('apple.ga')::uuid,current_setting('apple.deleted')::uuid))
    and (select gr.apple_place_id is null from public.group_restaurants gr join public.restaurants r on r.id=gr.restaurant_id where gr.group_id=current_setting('apple.ga')::uuid and r.name='Delete last'), 'Old receipt cannot relink recreated card');
reset role;
delete from public.group_memberships where group_id=current_setting('apple.gb')::uuid and user_id=current_setting('apple.other')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('apple.other'),true);
select pg_temp.expect_error($q$select * from public.get_group_restaurant_apple_place_id(current_setting('apple.gb')::uuid,current_setting('apple.entry')::uuid)$q$, '42501');
rollback;
