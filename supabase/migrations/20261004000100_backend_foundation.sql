begin;

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
    created_at timestamptz not null default now()
);

create table public.groups (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(btrim(name)) between 1 and 100),
    owner_user_id uuid not null references public.profiles(id) on delete restrict,
    created_at timestamptz not null default now()
);

create table public.group_memberships (
    group_id uuid not null references public.groups(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    joined_at timestamptz not null default now(),
    primary key (group_id, user_id)
);

create index group_memberships_user_id_idx on public.group_memberships(user_id);
create index groups_owner_user_id_idx on public.groups(owner_user_id);

-- Every committed group must include its owner as a member. Deferred so
-- create_group can insert the group and then its membership in one transaction.
alter table public.groups add constraint groups_owner_membership_fk
    foreign key (id, owner_user_id)
    references public.group_memberships(group_id, user_id)
    deferrable initially deferred;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;

-- Remove Supabase's default table grants, then allow only milestone operations.
revoke all on public.profiles, public.groups, public.group_memberships from public, anon, authenticated;
grant select on public.profiles, public.groups, public.group_memberships to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy profiles_read_own on public.profiles
    for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
    for update to authenticated
    using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Membership policies do not query groups or themselves, avoiding recursion.
-- This milestone needs only the current user's memberships, not a roster.
create policy memberships_read_own on public.group_memberships
    for select to authenticated using (user_id = (select auth.uid()));
create policy groups_read_member on public.groups
    for select to authenticated using (
        exists (
            select 1 from public.group_memberships membership
            where membership.group_id = groups.id
                and membership.user_id = (select auth.uid())
        )
    );

create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    insert into public.profiles (id, display_name)
    values (
        new.id,
        left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'GroupBite User'), 80)
    );
    return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Also support any users created in the project before this migration.
insert into public.profiles (id, display_name)
select id, left(coalesce(nullif(btrim(raw_user_meta_data ->> 'display_name'), ''), 'GroupBite User'), 80)
from auth.users
on conflict (id) do nothing;

create function public.create_group(group_name text)
returns public.groups
language plpgsql security definer set search_path = ''
as $$
declare
    creator_id uuid := auth.uid();
    new_group public.groups;
begin
    if creator_id is null then
        raise exception 'Sign in before creating a group.' using errcode = '42501';
    end if;
    if group_name is null or char_length(btrim(group_name)) not between 1 and 100 then
        raise exception 'Group name must be between 1 and 100 characters.' using errcode = '22023';
    end if;

    insert into public.groups (name, owner_user_id)
    values (btrim(group_name), creator_id)
    returning * into new_group;

    insert into public.group_memberships (group_id, user_id)
    values (new_group.id, creator_id);

    return new_group;
end;
$$;
revoke all on function public.create_group(text) from public, anon, authenticated;
grant execute on function public.create_group(text) to authenticated;

-- No client writes to groups/memberships, ownership transfers, or deletion yet.
-- create_group derives the owner from auth.uid(), never from client input.
commit;
