-- Run after Milestones 8 and 9 with at least three signed-up test accounts.
-- All fixtures, temporary helpers, and transient test codes roll back.
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
    perform set_config('groupbite.requester', (select id::text from public.profiles order by id limit 1 offset 1), true);
    perform set_config('groupbite.third', (select id::text from public.profiles order by id limit 1 offset 2), true);
    perform set_config('groupbite.requester_name', (select display_name from public.profiles where id = current_setting('groupbite.requester')::uuid), true);
end;
$$;

set local role authenticated;
do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true);
    perform set_config('groupbite.group', (public.create_group('Invite test')).id::text, true);
    perform set_config('groupbite.code', public.generate_group_invite(current_setting('groupbite.group')::uuid), true);
end;
$$;
select pg_temp.assert_true(current_setting('groupbite.code') ~ '^[0-9a-f]{64}$', 'Code is 32 random bytes encoded as hex');
select pg_temp.assert_true((select count(*) = 1 from public.group_invites where group_id = current_setting('groupbite.group')::uuid and revoked_at is null), 'Exactly one current invite');
select pg_temp.assert_true((select token_hash = encode(sha256(convert_to(current_setting('groupbite.code'), 'UTF8')), 'hex') and token_hash <> current_setting('groupbite.code') from public.group_invites where group_id = current_setting('groupbite.group')::uuid), 'Only a hash is stored');

do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.requester'), true); end; $$;
select pg_temp.expect_error($q$select public.generate_group_invite(current_setting('groupbite.group')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.revoke_group_invite(current_setting('groupbite.group')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.get_pending_join_requests(current_setting('groupbite.group')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.request_group_access('not-a-code')$q$, '22023');
select pg_temp.expect_error($q$select public.request_group_access(repeat('0', 64))$q$, '22023');
do $$
begin
    perform set_config('groupbite.request', public.request_group_access('  ' || upper(current_setting('groupbite.code')) || '  ')::text, true);
end;
$$;
select pg_temp.expect_error($q$select public.request_group_access(current_setting('groupbite.code'))$q$, '23505');
select pg_temp.assert_true(not exists(select 1 from public.groups where id = current_setting('groupbite.group')::uuid), 'Pending requester cannot read group');
select pg_temp.assert_true(not exists(select 1 from public.group_invites where group_id = current_setting('groupbite.group')::uuid), 'Requester cannot read invites');
select pg_temp.assert_true(not exists(select 1 from public.group_memberships where group_id = current_setting('groupbite.group')::uuid), 'Request does not create membership');
select pg_temp.expect_error($q$insert into public.group_memberships(group_id, user_id) values (current_setting('groupbite.group')::uuid, auth.uid())$q$, '42501');
select pg_temp.expect_error($q$update public.groups set owner_user_id = auth.uid() where id = current_setting('groupbite.group')::uuid$q$, '42501');
select pg_temp.expect_error($q$update public.join_requests set status = 'approved' where id = current_setting('groupbite.request')::uuid$q$, '42501');
select pg_temp.expect_error($q$insert into public.join_requests(group_id,user_id,invite_id) values (current_setting('groupbite.group')::uuid,auth.uid(),gen_random_uuid())$q$, '42501');
select pg_temp.expect_error($q$insert into public.group_invites(group_id,token_hash,created_by) values (current_setting('groupbite.group')::uuid,repeat('1',64),auth.uid())$q$, '42501');

do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true); end; $$;
select pg_temp.assert_true((select count(*) = 1 from public.get_pending_join_requests(current_setting('groupbite.group')::uuid)), 'Owner sees pending request');
select pg_temp.assert_true((select display_name = current_setting('groupbite.requester_name') from public.get_pending_join_requests(current_setting('groupbite.group')::uuid)), 'Owner RPC provides requester name');
select pg_temp.assert_true(not exists(select 1 from public.profiles where id = current_setting('groupbite.requester')::uuid), 'Other profiles remain private');
select public.decide_join_request(current_setting('groupbite.request')::uuid, 'approved');
select public.decide_join_request(current_setting('groupbite.request')::uuid, 'approved');
select pg_temp.expect_error($q$select public.decide_join_request(current_setting('groupbite.request')::uuid, 'denied')$q$, '22023');
select pg_temp.assert_true((select status = 'approved' and decided_by = auth.uid() and decided_at is not null from public.join_requests where id = current_setting('groupbite.request')::uuid), 'Approval metadata is recorded');

do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.requester'), true); end; $$;
select pg_temp.assert_true((select count(*) = 1 from public.group_memberships where group_id = current_setting('groupbite.group')::uuid), 'Repeated approval creates exactly one membership');
select pg_temp.assert_true(exists(select 1 from public.groups where id = current_setting('groupbite.group')::uuid), 'Approved member can read group');
select pg_temp.expect_error($q$select public.request_group_access(current_setting('groupbite.code'))$q$, '23514');
select pg_temp.expect_error($q$select public.generate_group_invite(current_setting('groupbite.group')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.revoke_group_invite(current_setting('groupbite.group')::uuid)$q$, '42501');

do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.third'), true);
    perform set_config('groupbite.denied_request', public.request_group_access(current_setting('groupbite.code'))::text, true);
end;
$$;
select pg_temp.assert_true(not exists(select 1 from public.join_requests where id = current_setting('groupbite.request')::uuid), 'Requesters cannot read another user request');
select pg_temp.expect_error($q$select public.decide_join_request(current_setting('groupbite.denied_request')::uuid, 'approved')$q$, '42501');
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true); end; $$;
select public.decide_join_request(current_setting('groupbite.denied_request')::uuid, 'denied');
select public.decide_join_request(current_setting('groupbite.denied_request')::uuid, 'denied');
do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.third'), true);
    perform pg_temp.assert_true(not exists(select 1 from public.group_memberships where group_id = current_setting('groupbite.group')::uuid), 'Denial creates no membership');
    perform set_config('groupbite.retry_request', public.request_group_access(current_setting('groupbite.code'))::text, true);
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true);
    perform set_config('groupbite.new_code', public.generate_group_invite(current_setting('groupbite.group')::uuid), true);
end;
$$;
select pg_temp.assert_true((select count(*) = 1 from public.group_invites where group_id = current_setting('groupbite.group')::uuid and revoked_at is null), 'Reset keeps only one current invite');
select pg_temp.assert_true(current_setting('groupbite.code') <> current_setting('groupbite.new_code'), 'Reset generates a new random code');
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.third'), true); end; $$;
select pg_temp.expect_error($q$select public.request_group_access(current_setting('groupbite.code'))$q$, '22023');
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true); end; $$;
-- Revoking/resetting an invite does not withdraw an already-pending request.
select public.decide_join_request(current_setting('groupbite.retry_request')::uuid, 'denied');
select public.revoke_group_invite(current_setting('groupbite.group')::uuid);
select public.revoke_group_invite(current_setting('groupbite.group')::uuid);
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.third'), true); end; $$;
select pg_temp.expect_error($q$select public.request_group_access(current_setting('groupbite.new_code'))$q$, '22023');

do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true);
    perform set_config('groupbite.expired_code', public.generate_group_invite(current_setting('groupbite.group')::uuid), true);
end;
$$;
reset role;
update public.group_invites set expires_at = clock_timestamp() - interval '1 hour'
    where group_id = current_setting('groupbite.group')::uuid and revoked_at is null;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.third'), true); end; $$;
select pg_temp.expect_error($q$select public.request_group_access(current_setting('groupbite.expired_code'))$q$, '22023');

do $$
begin
    perform set_config('groupbite.other_group', (public.create_group('Other private group')).id::text, true);
    perform set_config('groupbite.other_code', public.generate_group_invite(current_setting('groupbite.other_group')::uuid), true);
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.requester'), true);
    perform set_config('groupbite.other_request', public.request_group_access(current_setting('groupbite.other_code'))::text, true);
    perform set_config('request.jwt.claim.sub', current_setting('groupbite.owner'), true);
end;
$$;
select pg_temp.expect_error($q$select public.decide_join_request(current_setting('groupbite.other_request')::uuid, 'approved')$q$, '42501');
select pg_temp.expect_error($q$select public.get_pending_join_requests(current_setting('groupbite.other_group')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.generate_group_invite(current_setting('groupbite.other_group')::uuid)$q$, '42501');
select pg_temp.assert_true(not exists(select 1 from public.groups where id = current_setting('groupbite.other_group')::uuid), 'Knowing group ID grants no access');
select pg_temp.assert_true(not exists(select 1 from public.join_requests where group_id = current_setting('groupbite.other_group')::uuid), 'Requests do not leak across groups');
select pg_temp.assert_true(not exists(select 1 from public.group_invites where group_id = current_setting('groupbite.other_group')::uuid), 'Invites do not leak across groups');

do $$ begin perform set_config('request.jwt.claim.sub', '', true); end; $$;
select pg_temp.expect_error($q$select public.request_group_access(current_setting('groupbite.other_code'))$q$, '42501');
set local role anon;
select pg_temp.expect_error($q$select public.request_group_access(current_setting('groupbite.other_code'))$q$, '42501');
select pg_temp.expect_error($q$select public.generate_group_invite(current_setting('groupbite.group')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select * from public.join_requests$q$, '42501');

reset role;
select pg_temp.assert_true(not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'group_invites' and column_name in ('code', 'token', 'raw_code', 'invite_code')
), 'No usable code column exists');
-- The composite foreign key prevents an invite being attached to another group.
select pg_temp.expect_error($q$
    insert into public.join_requests(group_id,user_id,invite_id)
    values (current_setting('groupbite.other_group')::uuid,current_setting('groupbite.owner')::uuid,
        (select id from public.group_invites where group_id = current_setting('groupbite.group')::uuid and revoked_at is null))
$q$, '23503');

-- Simulate a failed decision write after the membership insert. Both must roll back.
create function pg_temp.reject_decision()
returns trigger language plpgsql as $$
begin
    raise exception 'Simulated decision failure' using errcode = '23514';
end;
$$;
create trigger test_reject_decision before update on public.join_requests
    for each row execute function pg_temp.reject_decision();
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', current_setting('groupbite.third'), true); end; $$;
select pg_temp.expect_error($q$select public.decide_join_request(current_setting('groupbite.other_request')::uuid, 'approved')$q$, '23514');
reset role;
select pg_temp.assert_true(not exists (
    select 1 from public.group_memberships
    where group_id = current_setting('groupbite.other_group')::uuid
        and user_id = current_setting('groupbite.requester')::uuid
), 'Failed approval rolls back the membership insert');
select pg_temp.assert_true((select status = 'pending' and decided_at is null and decided_by is null
    from public.join_requests where id = current_setting('groupbite.other_request')::uuid), 'Failed approval leaves the request pending');
drop trigger test_reject_decision on public.join_requests;

rollback;
