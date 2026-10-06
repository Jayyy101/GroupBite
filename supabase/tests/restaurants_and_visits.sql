-- Run after migrations 1–4 with three signed-up test accounts. All fixtures roll back.
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
    execute statement;
    raise exception 'Expected SQLSTATE %, but the operation succeeded', expected_state;
exception when others then
    if sqlstate <> expected_state then raise; end if;
end;
$$;
select pg_temp.assert_true((select count(*) >= 3 from public.profiles), 'Three accounts are required');
do $$
begin
    perform set_config('groupbite.owner', (select id::text from public.profiles order by id limit 1), true);
    perform set_config('groupbite.member', (select id::text from public.profiles order by id limit 1 offset 1), true);
    perform set_config('groupbite.outsider', (select id::text from public.profiles order by id limit 1 offset 2), true);
    perform set_config('groupbite.owner_name', (select display_name from public.profiles where id = current_setting('groupbite.owner')::uuid), true);
end;
$$;
set local role authenticated;
do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true);
    perform set_config('groupbite.a', (public.create_group('Visit test A')).id::text, true);
    perform set_config('groupbite.b', (public.create_group('Visit test B')).id::text, true);
    perform set_config('groupbite.code', public.generate_group_invite(current_setting('groupbite.a')::uuid), true);
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.member'), true);
    perform set_config('groupbite.request', public.request_group_access(current_setting('groupbite.code'))::text, true);
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true);
    perform public.decide_join_request(current_setting('groupbite.request')::uuid, 'approved');
    perform set_config('groupbite.restaurant', public.save_restaurant_visit('first-save',
        array[current_setting('groupbite.a')::uuid, current_setting('groupbite.b')::uuid],
        ' Milestone 10 Cafe ', ' Test address 100 ', ' Italian ', '2026-10-04', 5, true, ' First memory ')::text, true);
    perform set_config('groupbite.entry_a', (select id::text from public.group_restaurants where group_id = current_setting('groupbite.a')::uuid and restaurant_id = current_setting('groupbite.restaurant')::uuid), true);
    perform set_config('groupbite.entry_b', (select id::text from public.group_restaurants where group_id = current_setting('groupbite.b')::uuid and restaurant_id = current_setting('groupbite.restaurant')::uuid), true);
end;
$$;
select pg_temp.assert_true(current_setting('groupbite.entry_a') <> current_setting('groupbite.entry_b'), 'Each group gets its own restaurant entry');
select pg_temp.assert_true((select name = 'Milestone 10 Cafe' and address = 'Test address 100' and cuisine = 'Italian'
    from public.restaurants where id = current_setting('groupbite.restaurant')::uuid), 'Global facts are trimmed');
select pg_temp.assert_true((select count(*) = 2 and count(distinct id) = 2 from public.visits
    where group_restaurant_id in (current_setting('groupbite.entry_a')::uuid, current_setting('groupbite.entry_b')::uuid)), 'Multi-group save creates independent visits');
select pg_temp.assert_true((select bool_and(created_by = auth.uid() and notes = 'First memory' and visited_on = '2026-10-04'::date)
    from public.visits where group_restaurant_id in (current_setting('groupbite.entry_a')::uuid, current_setting('groupbite.entry_b')::uuid)), 'Creator comes from auth.uid and optional fields are saved');
-- The same receipt and canonical payload are safe to retry, including reordered groups.
select public.save_restaurant_visit('first-save', array[current_setting('groupbite.b')::uuid,current_setting('groupbite.a')::uuid,current_setting('groupbite.a')::uuid],
    'Milestone 10 Cafe','Test address 100','Italian','2026-10-04',5,true,'First memory');
select pg_temp.assert_true((select count(*) = 2 from public.visits where group_restaurant_id in
    (current_setting('groupbite.entry_a')::uuid, current_setting('groupbite.entry_b')::uuid)), 'Retry does not duplicate visits');
select pg_temp.expect_error($q$select public.save_restaurant_visit('first-save', array[current_setting('groupbite.a')::uuid], 'Changed', 'Test address 100')$q$, '22023');

do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.member'), true); end; $$;
select public.save_restaurant_visit('second-save',array[current_setting('groupbite.a')::uuid], 'Milestone 10 Cafe','Test address 100','Different cuisine',null,3,false,' Member memory ');
select public.save_restaurant_visit('unrated-save',array[current_setting('groupbite.a')::uuid], 'Milestone 10 Cafe','Test address 100');
select pg_temp.assert_true((select count(*) = 1 from public.group_restaurants where group_id = current_setting('groupbite.a')::uuid), 'Same group/location has only one entry');
select pg_temp.assert_true((select total_visit_count = 3 and rated_visit_count = 2 and average_rating = 4
    from public.get_group_restaurants(current_setting('groupbite.a')::uuid) where id = current_setting('groupbite.entry_a')::uuid), 'New saves create visits; unrated visits do not change the average');
select pg_temp.assert_true((select count(*) = 3 from public.visits
    where group_restaurant_id = current_setting('groupbite.entry_a')::uuid), 'Current member can directly read all visits in their group');
select pg_temp.assert_true((select created_by = auth.uid() and would_go_again = false from public.visits
    where group_restaurant_id = current_setting('groupbite.entry_a')::uuid and notes = 'Member memory'), 'Member cannot spoof creator; false preference is retained');
select pg_temp.assert_true((select cuisine = 'Italian' from public.restaurants where id = current_setting('groupbite.restaurant')::uuid), 'Memory saves do not overwrite shared facts');
select pg_temp.assert_true(exists(select 1 from public.get_group_restaurant_visits(current_setting('groupbite.entry_a')::uuid)
    where creator_display_name = current_setting('groupbite.owner_name')), 'Authorized visit RPC exposes creator display name');
select pg_temp.assert_true(not exists(select 1 from public.profiles where id = current_setting('groupbite.owner')::uuid), 'Profiles remain private directly');
select pg_temp.assert_true(not exists(select 1 from public.group_restaurants where group_id = current_setting('groupbite.b')::uuid), 'Member of A cannot read B entries');
select pg_temp.assert_true(not exists(select 1 from public.visits where group_restaurant_id = current_setting('groupbite.entry_b')::uuid), 'Member of A cannot read B visits');
select pg_temp.expect_error($q$select public.get_group_restaurant_visits(current_setting('groupbite.entry_b')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.save_restaurant_visit('unauthorized',array[current_setting('groupbite.a')::uuid,current_setting('groupbite.b')::uuid], 'Must Roll Back', 'Test address 200')$q$, '42501');
select pg_temp.assert_true(not exists(select 1 from public.restaurants where name = 'Must Roll Back'), 'Unauthorized multi-group save creates no global restaurant');
select pg_temp.expect_error($q$insert into public.visits(group_restaurant_id,created_by) values(current_setting('groupbite.entry_a')::uuid,current_setting('groupbite.owner')::uuid)$q$, '42501');
select pg_temp.expect_error($q$insert into public.group_restaurants(group_id,restaurant_id,created_by) values(current_setting('groupbite.b')::uuid,current_setting('groupbite.restaurant')::uuid,auth.uid())$q$, '42501');
select pg_temp.expect_error($q$insert into public.restaurants(name,address) values('Bypass','Test')$q$, '42501');
select pg_temp.expect_error($q$update public.restaurants set cuisine='Forged' where id=current_setting('groupbite.restaurant')::uuid$q$, '42501');
select pg_temp.expect_error($q$select * from public.visit_save_requests$q$, '42501');
select pg_temp.expect_error($q$select public.save_restaurant_visit('spoof',array[current_setting('groupbite.a')::uuid], 'Spoof','Test', created_by => current_setting('groupbite.owner')::uuid)$q$, '42883');
select pg_temp.expect_error($q$select public.save_restaurant_visit('rating',array[current_setting('groupbite.a')::uuid], 'Bad rating','Test',visit_rating => 6)$q$, '22023');
select pg_temp.expect_error($q$select public.save_restaurant_visit('empty',array[]::uuid[], 'No groups','Test')$q$, '22023');
select pg_temp.expect_error($q$select public.save_restaurant_visit('null-group',array[null]::uuid[], 'No groups','Test')$q$, '22023');
select pg_temp.expect_error($q$select public.save_restaurant_visit('nested-groups',array[[current_setting('groupbite.a')::uuid]], 'No groups','Test')$q$, '22023');

do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.outsider'), true);
    perform public.request_group_access(current_setting('groupbite.code'));
    perform set_config('groupbite.c', (public.create_group('Visit test C')).id::text, true);
end;
$$;
select pg_temp.assert_true(exists(select 1 from public.restaurants where id=current_setting('groupbite.restaurant')::uuid), 'Authenticated users may read global facts');
select pg_temp.assert_true(not exists(select 1 from public.group_restaurants where group_id=current_setting('groupbite.a')::uuid), 'Pending requester cannot read entries');
select pg_temp.assert_true(not exists(select 1 from public.visits where group_restaurant_id=current_setting('groupbite.entry_a')::uuid), 'Pending requester cannot read visits');
select pg_temp.assert_true(not exists(select 1 from public.visits where group_restaurant_id=current_setting('groupbite.entry_b')::uuid), 'Non-member without a join request cannot read visits');
select pg_temp.expect_error($q$select public.save_restaurant_visit('pending',array[current_setting('groupbite.a')::uuid], 'Pending','Test')$q$, '42501');
select pg_temp.expect_error($q$select public.get_group_restaurants(current_setting('groupbite.a')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.get_group_restaurant_visits(current_setting('groupbite.entry_a')::uuid)$q$, '42501');
select public.save_restaurant_visit('first-save',array[current_setting('groupbite.c')::uuid],'Milestone 10 Cafe','Test address 100',null,null,1,null,'Other group memory');
select pg_temp.assert_true((select total_visit_count=1 and average_rating=1 from public.get_group_restaurants(current_setting('groupbite.c')::uuid)), 'Unrelated group has independent history and user-scoped retry IDs');

do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.owner'),true); end; $$;
select pg_temp.assert_true((select total_visit_count=1 and average_rating=5 from public.get_group_restaurants(current_setting('groupbite.b')::uuid)), 'A and C visits do not affect B average or counts');
select public.save_restaurant_visit('second-location',array[current_setting('groupbite.a')::uuid],'Milestone 10 Cafe','Test address 300');
select pg_temp.assert_true((select count(*)=2 from public.restaurants where name='Milestone 10 Cafe'), 'Same chain at different addresses remains distinct');
select pg_temp.expect_error($q$update public.restaurants set name='Owner overwrite' where id=current_setting('groupbite.restaurant')::uuid$q$, '42501');

reset role;
select pg_temp.assert_true(not exists(select 1 from public.visit_save_requests where request_id='unauthorized'), 'Failed validation creates no retry receipt');
-- The unique constraint also rejects competing direct inserts into the same entry.
select pg_temp.expect_error($q$insert into public.group_restaurants(group_id,restaurant_id,created_by)
    values(current_setting('groupbite.a')::uuid,current_setting('groupbite.restaurant')::uuid,current_setting('groupbite.owner')::uuid)$q$, '23505');
create function pg_temp.fail_last_visit()
returns trigger language plpgsql as $$
begin
    if new.notes='fail-late' and exists(select 1 from public.group_restaurants gr
        where gr.id=new.group_restaurant_id and gr.group_id=greatest(current_setting('groupbite.a')::uuid,current_setting('groupbite.b')::uuid)) then
        raise exception 'Simulated last-group failure' using errcode='23514';
    end if;
    return new;
end;
$$;
create trigger test_fail_last_visit before insert on public.visits for each row execute function pg_temp.fail_last_visit();
set local role authenticated;
select pg_temp.expect_error($q$select public.save_restaurant_visit('late-failure',array[current_setting('groupbite.a')::uuid,current_setting('groupbite.b')::uuid],
    'Late rollback','Test address 400',visit_notes => 'fail-late')$q$, '23514');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.restaurants where name='Late rollback'), 'Failure after first visit rolls back global facts too');
select pg_temp.assert_true(not exists(select 1 from public.visits where notes='fail-late'), 'Failure in last group rolls back all visits');
select pg_temp.assert_true(not exists(select 1 from public.visit_save_requests where request_id='late-failure'), 'Failed transaction rolls back receipt');
drop trigger test_fail_last_visit on public.visits;

-- Membership must be current, even for visits this user created earlier.
delete from public.group_memberships where group_id = current_setting('groupbite.a')::uuid
    and user_id = current_setting('groupbite.member')::uuid;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.member'),true); end; $$;
select pg_temp.assert_true(not exists(select 1 from public.visits
    where group_restaurant_id = current_setting('groupbite.entry_a')::uuid), 'Former member cannot read visits, including their own');

set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub','',true); end; $$;
select pg_temp.expect_error($q$select public.save_restaurant_visit('anonymous',array[current_setting('groupbite.a')::uuid],'No auth','Test')$q$, '42501');
select pg_temp.assert_true(not exists(select 1 from public.restaurants), 'Authenticated role without a user cannot read restaurants');
select pg_temp.assert_true(not exists(select 1 from public.visits), 'Authenticated role without a user cannot read visits');
set local role anon;
select pg_temp.expect_error($q$select * from public.restaurants$q$, '42501');
select pg_temp.expect_error($q$select * from public.visits$q$, '42501');
select pg_temp.expect_error($q$select public.get_group_restaurants(current_setting('groupbite.a')::uuid)$q$, '42501');

rollback;
