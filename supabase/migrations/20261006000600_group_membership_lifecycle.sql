begin;

-- A membership ID identifies this particular admission, not the user. Existing
-- rows are backfilled; create_group and approval inserts keep using the default.
-- The existing (group_id, user_id) key and Owner-membership FK remain unchanged.
alter table public.group_memberships
    add column membership_id uuid not null default gen_random_uuid(),
    add constraint group_memberships_membership_id_key unique (membership_id);

-- Preserve get_group_members's return shape for existing screens and clients.
-- Only the current Owner needs other members' incarnation IDs for management.
create function public.get_group_membership_targets(target_group_id uuid)
returns table (user_id uuid, membership_id uuid, display_name text)
language plpgsql security definer set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
    if actor is null or not exists (
        select 1 from public.groups g join public.group_memberships m on m.group_id = g.id
        where g.id = target_group_id and g.owner_user_id = actor and m.user_id = actor
    ) then raise exception 'Group not found or access denied.' using errcode = '42501'; end if;
    return query
        select m.user_id, m.membership_id, p.display_name
        from public.group_memberships m join public.profiles p on p.id = m.user_id
        where m.group_id = target_group_id and m.user_id <> actor
        order by m.joined_at, m.user_id;
end;
$$;

create function public.leave_group(target_group_id uuid, expected_membership_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    owner_id uuid;
    current_membership_id uuid;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    -- Same group-first order as saves, visit management, invites, and approvals.
    select g.owner_user_id into owner_id from public.groups g where g.id = target_group_id for update;
    if not found then raise exception 'Group not found or access denied.' using errcode = '42501'; end if;
    select m.membership_id into current_membership_id from public.group_memberships m
        where m.group_id = target_group_id and m.user_id = actor for update;
    if not found then raise exception 'Group not found or access denied.' using errcode = '42501'; end if;
    if actor is not distinct from owner_id then
        raise exception 'Transfer ownership before leaving the group.' using errcode = '22023';
    end if;
    if expected_membership_id is distinct from current_membership_id then
        raise exception 'Membership changed. Refresh and try again.' using errcode = '22023';
    end if;
    delete from public.group_memberships
        where group_id = target_group_id and user_id = actor and membership_id = expected_membership_id;
    -- Visits, attribution, requests, invites, and save receipts are historical
    -- records, not memberships. Leaving never deletes or rewrites them.
end;
$$;

create function public.remove_group_member(
    target_group_id uuid, target_user_id uuid, expected_membership_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    owner_id uuid;
    current_membership_id uuid;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    select g.owner_user_id into owner_id from public.groups g where g.id = target_group_id for update;
    if not found or actor is distinct from owner_id or not exists (
        select 1 from public.group_memberships m where m.group_id = target_group_id and m.user_id = actor
    ) then raise exception 'Group not found or access denied.' using errcode = '42501'; end if;
    if target_user_id is null or target_user_id is not distinct from owner_id then
        raise exception 'Choose another current member.' using errcode = '22023';
    end if;
    select m.membership_id into current_membership_id from public.group_memberships m
        where m.group_id = target_group_id and m.user_id = target_user_id for update;
    if not found or expected_membership_id is distinct from current_membership_id then
        raise exception 'Membership changed. Refresh and try again.' using errcode = '22023';
    end if;
    delete from public.group_memberships
        where group_id = target_group_id and user_id = target_user_id and membership_id = expected_membership_id;
end;
$$;

create function public.transfer_group_ownership(
    target_group_id uuid, target_user_id uuid, expected_membership_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    owner_id uuid;
    current_membership_id uuid;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    select g.owner_user_id into owner_id from public.groups g where g.id = target_group_id for update;
    if not found or actor is distinct from owner_id or not exists (
        select 1 from public.group_memberships m where m.group_id = target_group_id and m.user_id = actor
    ) then raise exception 'Group not found or access denied.' using errcode = '42501'; end if;
    if target_user_id is null or target_user_id is not distinct from owner_id then
        raise exception 'Choose another current member.' using errcode = '22023';
    end if;
    select m.membership_id into current_membership_id from public.group_memberships m
        where m.group_id = target_group_id and m.user_id = target_user_id for update;
    if not found or expected_membership_id is distinct from current_membership_id then
        raise exception 'Membership changed. Refresh and try again.' using errcode = '22023';
    end if;
    update public.groups set owner_user_id = target_user_id where id = target_group_id;
    update public.group_invites set revoked_at = clock_timestamp()
        where group_id = target_group_id and revoked_at is null;
    -- Both memberships and pending requests remain intact. Revoke codes rather
    -- than deleting invites, which are referenced by historical/pending requests.
end;
$$;

-- RLS stays unchanged: reads depend on current membership and ownership, not
-- historical approval or Visit creation. Incarnation IDs confer no authority.
revoke insert, update, delete, truncate, references, trigger
    on public.groups, public.group_memberships from public, anon, authenticated;
revoke all on function public.get_group_membership_targets(uuid), public.leave_group(uuid, uuid),
    public.remove_group_member(uuid, uuid, uuid), public.transfer_group_ownership(uuid, uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.get_group_membership_targets(uuid), public.leave_group(uuid, uuid),
    public.remove_group_member(uuid, uuid, uuid), public.transfer_group_ownership(uuid, uuid, uuid)
    to authenticated;

-- Group deletion and its retention/recovery policy are deferred.
commit;
