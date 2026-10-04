-- Run after the migration with at least two signed-up test users.
-- All changes, including temporary group creation, are rolled back.
begin;

do $$
begin
    if (select count(*) from public.profiles) < 2 then
        raise exception 'Sign up two test users before running these checks.';
    end if;
end;
$$;

select set_config('groupbite.test_user_a', (select id::text from public.profiles order by id limit 1), true);
select set_config('groupbite.test_user_b', (select id::text from public.profiles order by id limit 1 offset 1), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('groupbite.test_user_a'), true);
select set_config('groupbite.test_group', (public.create_group('  Foundation test  ')).id::text, true);

do $$
begin
    if (select count(*) from public.profiles) <> 1 then
        raise exception 'Profile reads are not private.';
    end if;
    update public.profiles set display_name = 'Foundation test user'
        where id = auth.uid();
    if not found then raise exception 'Own profile update failed.'; end if;
    update public.profiles set display_name = 'Not allowed'
        where id = current_setting('groupbite.test_user_b')::uuid;
    if found then raise exception 'Another profile could be updated.'; end if;

    if not exists (
        select 1 from public.groups
        where id = current_setting('groupbite.test_group')::uuid
            and owner_user_id = auth.uid() and name = 'Foundation test'
    ) then raise exception 'Group creation or owner identity failed.'; end if;
    if not exists (
        select 1 from public.group_memberships
        where group_id = current_setting('groupbite.test_group')::uuid and user_id = auth.uid()
    ) then raise exception 'Owner membership is missing.'; end if;

    begin
        insert into public.groups (name, owner_user_id) values ('Bypass', auth.uid());
        raise exception 'Direct group creation was allowed.';
    exception when insufficient_privilege then null;
    end;
    begin
        update public.groups set owner_user_id = current_setting('groupbite.test_user_b')::uuid
            where id = current_setting('groupbite.test_group')::uuid;
        raise exception 'Direct ownership change was allowed.';
    exception when insufficient_privilege then null;
    end;
    begin
        delete from public.groups where id = current_setting('groupbite.test_group')::uuid;
        raise exception 'Group deletion was exposed too early.';
    exception when insufficient_privilege then null;
    end;
    begin
        delete from public.group_memberships where group_id = current_setting('groupbite.test_group')::uuid;
        raise exception 'Membership deletion was exposed too early.';
    exception when insufficient_privilege then null;
    end;
    begin
        update public.profiles set created_at = now() where id = auth.uid();
        raise exception 'Protected profile columns could be changed.';
    exception when insufficient_privilege then null;
    end;
    begin
        perform public.create_group('   ');
        raise exception 'Blank group name was accepted.';
    exception when invalid_parameter_value then null;
    end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('groupbite.test_user_b'), true);
do $$
begin
    if exists (select 1 from public.groups where id = current_setting('groupbite.test_group')::uuid) then
        raise exception 'A nonmember could read another group.';
    end if;
    if exists (select 1 from public.group_memberships where group_id = current_setting('groupbite.test_group')::uuid) then
        raise exception 'A nonmember could read another membership.';
    end if;
    begin
        insert into public.group_memberships (group_id, user_id)
            values (current_setting('groupbite.test_group')::uuid, auth.uid());
        raise exception 'A user could join without approval.';
    exception when insufficient_privilege then null;
    end;
end;
$$;

select set_config('request.jwt.claim.sub', '', true);
do $$
begin
    begin
        perform public.create_group('Unauthenticated');
        raise exception 'Group creation accepted a missing identity.';
    exception when insufficient_privilege then null;
    end;
end;
$$;

set local role anon;
do $$
begin
    begin
        perform public.create_group('Anonymous');
        raise exception 'Anonymous group creation was allowed.';
    exception when insufficient_privilege then null;
    end;
    begin
        perform * from public.groups;
        raise exception 'Anonymous group reads were allowed.';
    exception when insufficient_privilege then null;
    end;
end;
$$;

reset role;
-- Even a privileged direct insert cannot commit an ownerless membership state.
do $$
begin
    begin
        insert into public.groups (name, owner_user_id)
            values ('Missing membership', current_setting('groupbite.test_user_a')::uuid);
        set constraints groups_owner_membership_fk immediate;
        raise exception 'The owner membership invariant was not enforced.';
    exception when foreign_key_violation then null;
    end;
end;
$$;

rollback;
