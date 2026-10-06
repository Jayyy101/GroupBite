-- Run after migrations 1–5 with three signed-up test accounts. All fixtures roll back.
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
select pg_temp.assert_true((select attnotnull from pg_attribute
    where attrelid='public.visits'::regclass and attname='created_by' and not attisdropped), 'Visit creator is NOT NULL');
do $$
begin
    perform set_config('groupbite.owner', (select id::text from public.profiles order by id limit 1), true);
    perform set_config('groupbite.member', (select id::text from public.profiles order by id limit 1 offset 1), true);
    perform set_config('groupbite.outsider', (select id::text from public.profiles order by id limit 1 offset 2), true);
end;
$$;
set local role authenticated;
do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true);
    perform set_config('groupbite.a', (public.create_group('Manage visits A')).id::text, true);
    perform set_config('groupbite.b', (public.create_group('Manage visits B')).id::text, true);
    perform set_config('groupbite.code', public.generate_group_invite(current_setting('groupbite.a')::uuid), true);
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.member'), true);
    perform set_config('groupbite.request', public.request_group_access(current_setting('groupbite.code'))::text, true);
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true);
    perform public.decide_join_request(current_setting('groupbite.request')::uuid, 'approved');
    perform set_config('groupbite.restaurant', public.save_restaurant_visit('management-original',
        array[current_setting('groupbite.a')::uuid,current_setting('groupbite.b')::uuid],
        'Milestone 11 Cafe','Management address','Italian','2026-10-06',5,true,'Original owner visit')::text, true);
    perform set_config('groupbite.entry_a', (select id::text from public.group_restaurants
        where group_id=current_setting('groupbite.a')::uuid and restaurant_id=current_setting('groupbite.restaurant')::uuid), true);
    perform set_config('groupbite.entry_b', (select id::text from public.group_restaurants
        where group_id=current_setting('groupbite.b')::uuid and restaurant_id=current_setting('groupbite.restaurant')::uuid), true);
    perform set_config('groupbite.owner_visit', (select id::text from public.visits where group_restaurant_id=current_setting('groupbite.entry_a')::uuid), true);
    perform set_config('groupbite.b_visit', (select id::text from public.visits where group_restaurant_id=current_setting('groupbite.entry_b')::uuid), true);
    perform set_config('groupbite.restaurant_snapshot', (select to_jsonb(r)::text from public.restaurants r where id=current_setting('groupbite.restaurant')::uuid), true);
    perform set_config('groupbite.b_snapshot', (select to_jsonb(v)::text from public.visits v where id=current_setting('groupbite.b_visit')::uuid), true);
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.member'), true);
    perform public.save_restaurant_visit('management-member',array[current_setting('groupbite.a')::uuid],
        'Milestone 11 Cafe','Management address',visit_rating => 3,visit_notes => 'Member original');
    perform set_config('groupbite.member_visit', (select id::text from public.visits
        where group_restaurant_id=current_setting('groupbite.entry_a')::uuid and notes='Member original'), true);
    perform set_config('groupbite.member_snapshot', (select to_jsonb(v)::text from public.visits v where id=current_setting('groupbite.member_visit')::uuid), true);
    perform public.save_restaurant_visit('management-member-delete',array[current_setting('groupbite.a')::uuid],
        'Milestone 11 Cafe','Management address',visit_notes => 'Member delete');
    perform set_config('groupbite.member_delete', (select id::text from public.visits
        where group_restaurant_id=current_setting('groupbite.entry_a')::uuid and notes='Member delete'), true);
end;
$$;

-- Defense in depth: simulate nullable attribution inside a rolled-back savepoint.
-- The real schema and all fixtures are restored before continuing the suite.
savepoint nullable_attribution;
reset role;
alter table public.visits alter column created_by drop not null;
update public.visits set created_by=null where id=current_setting('groupbite.owner_visit')::uuid;
set local role authenticated;
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid,null,1,null,'Null creator bypass')$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid)$q$, '42501');
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true); end; $$;
select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid,null,4,null,'Owner manages null creator');
select pg_temp.assert_true((select created_by is null and rating=4 from public.visits
    where id=current_setting('groupbite.owner_visit')::uuid), 'Owner permission works independently of nullable attribution');
select pg_temp.assert_true(not public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid), 'Owner can delete a null-attributed visit without removing other visits');
rollback to savepoint nullable_attribution;
release savepoint nullable_attribution;

-- Creation and editing use PostgreSQL DATE, accepting leap days and rejecting
-- impossible dates. Both UI forms use the same isVisitDate validator as well.
savepoint date_validation;
select public.save_restaurant_visit('management-leap-day',array[current_setting('groupbite.a')::uuid],
    'Milestone 11 Cafe','Management address',visit_date => '2024-02-29');
select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,'2024-02-29',null,null,null);
select pg_temp.assert_true((select count(*)=2 from public.visits where group_restaurant_id=current_setting('groupbite.entry_a')::uuid
    and visited_on='2024-02-29'::date), 'Creation and editing both accept valid leap days');
select pg_temp.expect_error($q$select public.save_restaurant_visit('management-invalid-day',array[current_setting('groupbite.a')::uuid],
    'Milestone 11 Cafe','Management address',visit_date => '2026-02-30')$q$, '22008');
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,'2026-02-30',null,null,null)$q$, '22008');
rollback to savepoint date_validation;
release savepoint date_validation;

select pg_temp.assert_true((select bool_and(can_manage = (id <> current_setting('groupbite.owner_visit')::uuid))
    from public.get_group_restaurant_visits(current_setting('groupbite.entry_a')::uuid)), 'Member controls cover only their own visits');
select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,'2026-09-30',2,false,'  Edited memory  ');
select pg_temp.assert_true((select visited_on='2026-09-30'::date and rating=2 and would_go_again=false and notes='Edited memory'
    from public.visits where id=current_setting('groupbite.member_visit')::uuid), 'Member can edit all four fields and notes are trimmed');
select pg_temp.assert_true((select created_by=current_setting('groupbite.member')::uuid
    and created_at=(current_setting('groupbite.member_snapshot')::jsonb->>'created_at')::timestamptz
    and group_restaurant_id=current_setting('groupbite.entry_a')::uuid
    and updated_at >= (current_setting('groupbite.member_snapshot')::jsonb->>'updated_at')::timestamptz
    from public.visits where id=current_setting('groupbite.member_visit')::uuid), 'Edit preserves creator, created_at and group link');
select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,null,null,null,'   ');
select pg_temp.assert_true((select visited_on is null and rating is null and would_go_again is null and notes is null
    from public.visits where id=current_setting('groupbite.member_visit')::uuid), 'All optional fields can be cleared');
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,null,6,null,null)$q$, '22023');
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,null,0,null,null)$q$, '22023');
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,null,null,null,repeat('x',4001))$q$, '22023');
select pg_temp.assert_true((select rating is null and notes is null from public.visits where id=current_setting('groupbite.member_visit')::uuid), 'Invalid edits leave the visit unchanged');
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid,null,1,null,'Forged')$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid)$q$, '42501');
select pg_temp.assert_true(not public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_delete')::uuid), 'Member can delete their own nonfinal visit without removing the entry');
select pg_temp.assert_true((select total_visit_count=2 and rated_visit_count=1 and average_rating=5
    from public.get_group_restaurants(current_setting('groupbite.a')::uuid) where id=current_setting('groupbite.entry_a')::uuid), 'Summary reflects edits and deletion');

-- Direct writes remain forbidden even for immutable fields and the caller's own visit.
select pg_temp.expect_error($q$update public.visits set notes='Bypass' where id=current_setting('groupbite.member_visit')::uuid$q$, '42501');
select pg_temp.expect_error($q$update public.visits set created_by=auth.uid(),created_at=now(),group_restaurant_id=current_setting('groupbite.entry_b')::uuid$q$, '42501');
select pg_temp.expect_error($q$delete from public.visits where id=current_setting('groupbite.member_visit')::uuid$q$, '42501');
select pg_temp.expect_error($q$insert into public.visits(group_restaurant_id,created_by) values(current_setting('groupbite.entry_a')::uuid,auth.uid())$q$, '42501');
select pg_temp.expect_error($q$delete from public.group_restaurants where id=current_setting('groupbite.entry_a')::uuid$q$, '42501');
select pg_temp.expect_error($q$delete from public.restaurants where id=current_setting('groupbite.restaurant')::uuid$q$, '42501');
select pg_temp.expect_error($q$delete from public.visit_save_requests$q$, '42501');
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,null,null,null,null,created_by => auth.uid())$q$, '42883');

-- An unrelated Owner and pending requester get no management access to A.
do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.outsider'), true);
    perform public.request_group_access(current_setting('groupbite.code'));
    perform set_config('groupbite.c', (public.create_group('Manage visits C')).id::text, true);
    perform public.save_restaurant_visit('management-other',array[current_setting('groupbite.c')::uuid],
        'Milestone 11 Cafe','Management address',visit_rating => 1,visit_notes => 'Other group memory');
    perform set_config('groupbite.entry_c', (select id::text from public.group_restaurants where group_id=current_setting('groupbite.c')::uuid), true);
    perform set_config('groupbite.c_visit', (select id::text from public.visits where group_restaurant_id=current_setting('groupbite.entry_c')::uuid), true);
    perform set_config('groupbite.c_snapshot', (select to_jsonb(v)::text from public.visits v where id=current_setting('groupbite.c_visit')::uuid), true);
end;
$$;
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid,null,1,null,'Intrusion')$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.get_group_restaurant_visits(current_setting('groupbite.entry_a')::uuid)$q$, '42501');

-- Historical creator status does not replace current membership.
reset role;
delete from public.group_memberships where group_id=current_setting('groupbite.a')::uuid and user_id=current_setting('groupbite.member')::uuid;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.member'), true); end; $$;
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,null,1,null,'Former member')$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.get_group_restaurant_visits(current_setting('groupbite.entry_a')::uuid)$q$, '42501');
reset role;
insert into public.group_memberships(group_id,user_id) values(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid);
-- Even an Owner must be a current member (the FK is deferred in this test transaction).
delete from public.group_memberships where group_id=current_setting('groupbite.a')::uuid and user_id=current_setting('groupbite.owner')::uuid;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true); end; $$;
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid,null,null,null,null)$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid)$q$, '42501');
reset role;
insert into public.group_memberships(group_id,user_id) values(current_setting('groupbite.a')::uuid,current_setting('groupbite.owner')::uuid);
set local role authenticated;

select pg_temp.assert_true((select bool_and(can_manage) from public.get_group_restaurant_visits(current_setting('groupbite.entry_a')::uuid)), 'Owner has controls for every visit');
select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,'2026-10-01',4,true,'Owner edited member visit');
select pg_temp.assert_true((select rating=4 and created_by=current_setting('groupbite.member')::uuid
    and created_at=(current_setting('groupbite.member_snapshot')::jsonb->>'created_at')::timestamptz
    from public.visits where id=current_setting('groupbite.member_visit')::uuid), 'Owner can edit another creator without changing attribution');
select pg_temp.assert_true((select total_visit_count=2 and rated_visit_count=2 and average_rating=4.5
    from public.get_group_restaurants(current_setting('groupbite.a')::uuid) where id=current_setting('groupbite.entry_a')::uuid), 'Owner edits update group ratings');

-- All three IDs must match, even when this Owner owns both groups.
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.b')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid,null,null,null,null)$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.b')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.b_visit')::uuid,null,null,null,null)$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.b_visit')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    'ffffffff-ffff-ffff-ffff-ffffffffffff')$q$, '42501');
select pg_temp.expect_error($q$select public.update_group_visit(null,null,null,null,null,null,null)$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(null,null,null)$q$, '42501');
select pg_temp.expect_error($q$update public.visits set notes='Owner bypass'$q$, '42501');
select pg_temp.expect_error($q$delete from public.visits$q$, '42501');
select pg_temp.expect_error($q$delete from public.group_restaurants$q$, '42501');
select pg_temp.expect_error($q$update public.restaurants set cuisine='Owner bypass'$q$, '42501');

-- Simulate an update failure and a failure AFTER deleting the final visit, at cleanup.
reset role;
create function pg_temp.fail_management()
returns trigger language plpgsql as $$
begin
    if tg_op='UPDATE' then
        if new.notes='fail-update' then
            raise exception 'Simulated update failure' using errcode='23514';
        end if;
    elsif tg_op='DELETE' and old.id=current_setting('groupbite.entry_a')::uuid then
        raise exception 'Simulated cleanup failure' using errcode='23514';
    end if;
    if tg_op='DELETE' then return old; end if;
    return new;
end;
$$;
create trigger test_fail_update before update on public.visits for each row execute function pg_temp.fail_management();
create trigger test_fail_cleanup before delete on public.group_restaurants for each row execute function pg_temp.fail_management();
set local role authenticated;
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid,null,1,false,'fail-update')$q$, '23514');
select pg_temp.assert_true((select notes='Owner edited member visit' and rating=4 and would_go_again=true
    from public.visits where id=current_setting('groupbite.member_visit')::uuid), 'Failed update rolls back all edited fields');
select pg_temp.assert_true(not public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.member_visit')::uuid), 'Owner can delete another member visit');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid)$q$, '23514');
select pg_temp.assert_true(exists(select 1 from public.visits where id=current_setting('groupbite.owner_visit')::uuid)
    and exists(select 1 from public.group_restaurants where id=current_setting('groupbite.entry_a')::uuid), 'Cleanup failure restores the deleted visit and entry');
reset role;
drop trigger test_fail_update on public.visits;
drop trigger test_fail_cleanup on public.group_restaurants;
set local role authenticated;
select pg_temp.assert_true(public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid), 'Final visit deletion removes its group entry');
select pg_temp.assert_true(not exists(select 1 from public.get_group_restaurants(current_setting('groupbite.a')::uuid)
    where id=current_setting('groupbite.entry_a')::uuid), 'Removed entry disappears from the group list');
select pg_temp.expect_error($q$select public.get_group_restaurant_visits(current_setting('groupbite.entry_a')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid)$q$, '42501');
select pg_temp.assert_true((select to_jsonb(v)=current_setting('groupbite.b_snapshot')::jsonb from public.visits v
    where id=current_setting('groupbite.b_visit')::uuid), 'Another group owned by the same actor remains unchanged');

select public.save_restaurant_visit('management-original',array[current_setting('groupbite.b')::uuid,current_setting('groupbite.a')::uuid],
    'Milestone 11 Cafe','Management address','Italian','2026-10-06',5,true,'Original owner visit');
select pg_temp.assert_true(not exists(select 1 from public.group_restaurants where id=current_setting('groupbite.entry_a')::uuid)
    and not exists(select 1 from public.get_group_restaurants(current_setting('groupbite.a')::uuid)), 'Old save receipt does not resurrect a deleted visit or entry');
select pg_temp.assert_true((select total_visit_count=1 from public.get_group_restaurants(current_setting('groupbite.b')::uuid)), 'Retry still does not duplicate another group visit');
do $$
begin
    perform public.save_restaurant_visit('management-new',array[current_setting('groupbite.a')::uuid],
        'Milestone 11 Cafe','Management address','Different cuisine');
    perform set_config('groupbite.new_entry', (select id::text from public.group_restaurants where group_id=current_setting('groupbite.a')::uuid), true);
    perform set_config('groupbite.new_visit', (select id::text from public.visits where group_restaurant_id=current_setting('groupbite.new_entry')::uuid), true);
end;
$$;
select pg_temp.assert_true(current_setting('groupbite.new_entry')<>current_setting('groupbite.entry_a'), 'New save creates a fresh group entry at the original location');
select pg_temp.assert_true(public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.new_entry')::uuid,
    current_setting('groupbite.new_visit')::uuid), 'Fresh final visit can be deleted');
select pg_temp.assert_true(public.delete_group_visit(current_setting('groupbite.b')::uuid,current_setting('groupbite.entry_b')::uuid,
    current_setting('groupbite.b_visit')::uuid), 'Owner can remove final visit from the second owned group');
reset role;
select pg_temp.assert_true((select to_jsonb(v)=current_setting('groupbite.c_snapshot')::jsonb from public.visits v
    where id=current_setting('groupbite.c_visit')::uuid), 'Unrelated group visit remains unchanged');
select pg_temp.assert_true((select to_jsonb(r)=current_setting('groupbite.restaurant_snapshot')::jsonb from public.restaurants r
    where id=current_setting('groupbite.restaurant')::uuid), 'All global facts and timestamps remain unchanged');
select pg_temp.assert_true(exists(select 1 from public.visit_save_requests where user_id=current_setting('groupbite.owner')::uuid
    and request_id='management-original'), 'Deletion preserves idempotency receipts');
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.outsider'),true); end; $$;
select pg_temp.assert_true(public.delete_group_visit(current_setting('groupbite.c')::uuid,current_setting('groupbite.entry_c')::uuid,
    current_setting('groupbite.c_visit')::uuid), 'Creator can delete their final visit');
select pg_temp.assert_true(exists(select 1 from public.restaurants where id=current_setting('groupbite.restaurant')::uuid), 'Global restaurant survives even with no group visits');

do $$ begin perform set_config('request.jwt.claim.sub','',true); end; $$;
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid,null,null,null,null)$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry_a')::uuid,
    current_setting('groupbite.owner_visit')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.get_group_restaurant_visits(current_setting('groupbite.entry_a')::uuid)$q$, '42501');
set local role anon;
select pg_temp.expect_error($q$select public.update_group_visit(null,null,null,null,null,null,null)$q$, '42501');
select pg_temp.expect_error($q$select public.delete_group_visit(null,null,null)$q$, '42501');
select pg_temp.expect_error($q$select public.get_group_restaurant_visits(null)$q$, '42501');
reset role;
select pg_temp.assert_true((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
    where oid in ('public.update_group_visit(uuid,uuid,uuid,date,integer,boolean,text)'::regprocedure,
        'public.delete_group_visit(uuid,uuid,uuid)'::regprocedure,'public.get_group_restaurant_visits(uuid)'::regprocedure)), 'RPCs have an empty search_path');

rollback;
