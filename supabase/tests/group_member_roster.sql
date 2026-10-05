-- Run after all three migrations with at least three signed-up test accounts.
-- These fixtures and temporary helpers are rolled back; no codes are printed.
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

select pg_temp.assert_true((select count(*) >= 3 from public.profiles), 'Three test accounts are required');
do $$
begin
    perform set_config('groupbite.owner', (select id::text from public.profiles order by id limit 1), true);
    perform set_config('groupbite.member', (select id::text from public.profiles order by id limit 1 offset 1), true);
    perform set_config('groupbite.outsider', (select id::text from public.profiles order by id limit 1 offset 2), true);
    perform set_config('groupbite.member_name', (select display_name from public.profiles where id = current_setting('groupbite.member')::uuid), true);
end;
$$;

set local role authenticated;
do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true);
    perform set_config('groupbite.group', (public.create_group('Roster test')).id::text, true);
    perform set_config('groupbite.code', public.generate_group_invite(current_setting('groupbite.group')::uuid), true);
end;
$$;
select pg_temp.assert_true((select count(*) = 1 from public.get_group_members(current_setting('groupbite.group')::uuid)), 'Owner can read the initial roster');
select pg_temp.assert_true((select user_id = auth.uid() and is_owner from public.get_group_members(current_setting('groupbite.group')::uuid)), 'Owner is clearly identified');

do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.member'), true);
    perform set_config('groupbite.request', public.request_group_access(current_setting('groupbite.code'))::text, true);
end;
$$;
select pg_temp.expect_error($q$select public.get_group_members(current_setting('groupbite.group')::uuid)$q$, '42501');
select pg_temp.assert_true((select status = 'pending' from public.join_requests where id = current_setting('groupbite.request')::uuid), 'Pending request stays visible to its requester');
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true); end; $$;
select pg_temp.assert_true((select count(*) = 1 from public.get_group_members(current_setting('groupbite.group')::uuid)), 'Pending requester is excluded from roster');
select public.decide_join_request(current_setting('groupbite.request')::uuid, 'approved');
select pg_temp.assert_true((select count(*) = 2 from public.get_group_members(current_setting('groupbite.group')::uuid)), 'Roster refresh includes newly approved member');
select pg_temp.assert_true((select count(*) = 1 from public.get_group_members(current_setting('groupbite.group')::uuid) where is_owner), 'Exactly one Owner is identified');
select pg_temp.assert_true((select display_name = current_setting('groupbite.member_name') and not is_owner
    from public.get_group_members(current_setting('groupbite.group')::uuid) where user_id = current_setting('groupbite.member')::uuid), 'Member display name and role are correct');

do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.member'), true); end; $$;
select pg_temp.assert_true((select count(*) = 2 from public.get_group_members(current_setting('groupbite.group')::uuid)), 'Normal member can read the full roster');
select pg_temp.assert_true((select bool_and(to_jsonb(m) - array['user_id', 'display_name', 'is_owner'] = '{}'::jsonb)
    from public.get_group_members(current_setting('groupbite.group')::uuid) m), 'Only minimal roster fields are returned, without emails');
select pg_temp.assert_true(not exists(select 1 from public.profiles where id = current_setting('groupbite.owner')::uuid), 'Other profiles remain unreadable directly');
select pg_temp.assert_true((select count(*) = 1 from public.group_memberships where group_id = current_setting('groupbite.group')::uuid), 'Direct membership reads remain self-only');
select pg_temp.expect_error($q$select public.get_group_members(null)$q$, '42501');
select pg_temp.expect_error($q$select public.get_group_members('ffffffff-ffff-ffff-ffff-ffffffffffff')$q$, '42501');

do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.outsider'), true);
    perform set_config('groupbite.other_group', (public.create_group('Other roster test')).id::text, true);
end;
$$;
select pg_temp.expect_error($q$select public.get_group_members(current_setting('groupbite.group')::uuid)$q$, '42501');
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true); end; $$;
select pg_temp.expect_error($q$select public.get_group_members(current_setting('groupbite.other_group')::uuid)$q$, '42501');
select pg_temp.assert_true(not exists(select 1 from public.profiles where id = current_setting('groupbite.member')::uuid), 'Owner cannot read other profiles directly either');

-- Check current membership, not a historical approved request, grants access.
reset role;
delete from public.group_memberships
    where group_id = current_setting('groupbite.group')::uuid and user_id = current_setting('groupbite.member')::uuid;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.member'), true); end; $$;
select pg_temp.expect_error($q$select public.get_group_members(current_setting('groupbite.group')::uuid)$q$, '42501');
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true); end; $$;
select pg_temp.assert_true((select count(*) = 1 from public.get_group_members(current_setting('groupbite.group')::uuid)), 'Roster refresh excludes former membership');

do $$ begin perform set_config('request.jwt.claim.sub', '', true); end; $$;
select pg_temp.expect_error($q$select public.get_group_members(current_setting('groupbite.group')::uuid)$q$, '42501');
set local role anon;
select pg_temp.expect_error($q$select public.get_group_members(current_setting('groupbite.group')::uuid)$q$, '42501');

rollback;
