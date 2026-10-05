begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
-- Supabase normally installs pgcrypto here. Do not silently move an existing extension.
do $$
begin
    if not exists (
        select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
        where e.extname = 'pgcrypto' and n.nspname = 'extensions'
    ) then
        raise exception 'pgcrypto must be installed in the extensions schema before applying Milestone 9.';
    end if;
end;
$$;

create table public.group_invites (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references public.groups(id) on delete cascade,
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    created_by uuid not null references public.profiles(id) on delete restrict,
    created_at timestamptz not null default now(),
    expires_at timestamptz,
    revoked_at timestamptz,
    unique (id, group_id)
);

create unique index group_invites_one_current_idx
    on public.group_invites(group_id) where revoked_at is null;

create table public.join_requests (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references public.groups(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete restrict,
    invite_id uuid not null,
    status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
    requested_at timestamptz not null default now(),
    decided_by uuid references public.profiles(id) on delete restrict,
    decided_at timestamptz,
    foreign key (invite_id, group_id) references public.group_invites(id, group_id),
    check (
        (status = 'pending' and decided_by is null and decided_at is null)
        or (status in ('approved', 'denied') and decided_by is not null and decided_at is not null)
    )
);

create unique index join_requests_one_pending_idx
    on public.join_requests(group_id, user_id) where status = 'pending';
create index join_requests_user_id_idx on public.join_requests(user_id);
create index join_requests_invite_id_idx on public.join_requests(invite_id);

alter table public.group_invites enable row level security;
alter table public.join_requests enable row level security;
revoke all on public.group_invites, public.join_requests from public, anon, authenticated;
grant select on public.group_invites, public.join_requests to authenticated;

create policy invites_read_owner on public.group_invites
    for select to authenticated using (
        exists (select 1 from public.groups g where g.id = group_id and g.owner_user_id = (select auth.uid()))
    );
create policy requests_read_requester_or_owner on public.join_requests
    for select to authenticated using (
        user_id = (select auth.uid())
        or exists (select 1 from public.groups g where g.id = group_id and g.owner_user_id = (select auth.uid()))
    );

create function public.generate_group_invite(target_group_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    raw_code text;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    -- Every invite/request mutation locks the group first, then its child row.
    perform 1 from public.groups g
        where g.id = target_group_id and g.owner_user_id = actor for update;
    if not found then raise exception 'Only the group Owner may manage invites.' using errcode = '42501'; end if;

    update public.group_invites set revoked_at = clock_timestamp()
        where group_id = target_group_id and revoked_at is null;
    raw_code := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.group_invites (group_id, token_hash, created_by, expires_at)
    values (target_group_id, encode(extensions.digest(raw_code, 'sha256'), 'hex'), actor, clock_timestamp() + interval '7 days');
    return raw_code;
end;
$$;

create function public.revoke_group_invite(target_group_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    perform 1 from public.groups g
        where g.id = target_group_id and g.owner_user_id = actor for update;
    if not found then raise exception 'Only the group Owner may manage invites.' using errcode = '42501'; end if;
    update public.group_invites set revoked_at = clock_timestamp()
        where group_id = target_group_id and revoked_at is null;
end;
$$;

create function public.request_group_access(invite_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    normalized_code text := lower(btrim(invite_code));
    invite public.group_invites;
    request_id uuid;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    if normalized_code is null or normalized_code !~ '^[0-9a-f]{64}$' then
        raise exception 'Invalid, revoked, or expired invite code.' using errcode = '22023';
    end if;
    select * into invite from public.group_invites
        where token_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex');
    if not found then raise exception 'Invalid, revoked, or expired invite code.' using errcode = '22023'; end if;

    perform 1 from public.groups where id = invite.group_id for update;
    if not found then raise exception 'Invalid, revoked, or expired invite code.' using errcode = '22023'; end if;
    -- Revalidate after waiting for the group lock so a concurrent reset wins safely.
    select * into invite from public.group_invites where id = invite.id for update;
    if invite.revoked_at is not null or (invite.expires_at is not null and invite.expires_at <= clock_timestamp()) then
        raise exception 'Invalid, revoked, or expired invite code.' using errcode = '22023';
    end if;
    if exists (select 1 from public.group_memberships where group_id = invite.group_id and user_id = actor) then
        raise exception 'You are already a member of this group.' using errcode = '23514';
    end if;
    if exists (select 1 from public.join_requests where group_id = invite.group_id and user_id = actor and status = 'pending') then
        raise exception 'You already have a pending request for this group.' using errcode = '23505';
    end if;
    insert into public.join_requests (group_id, user_id, invite_id)
    values (invite.group_id, actor, invite.id) returning id into request_id;
    return request_id;
end;
$$;

create function public.decide_join_request(target_request_id uuid, decision text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    target_group uuid;
    request public.join_requests;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    if decision is null or decision not in ('approved', 'denied') then
        raise exception 'Choose approve or deny.' using errcode = '22023';
    end if;
    select group_id into target_group from public.join_requests where id = target_request_id;
    perform 1 from public.groups g where g.id = target_group and g.owner_user_id = actor for update;
    if not found then raise exception 'Request not found or access denied.' using errcode = '42501'; end if;
    select * into request from public.join_requests where id = target_request_id for update;
    if not found then raise exception 'Request not found or access denied.' using errcode = '42501'; end if;
    if request.status = decision then return; end if;
    if request.status <> 'pending' then raise exception 'This request was already decided.' using errcode = '22023'; end if;

    if decision = 'approved' then
        insert into public.group_memberships (group_id, user_id) values (request.group_id, request.user_id)
        on conflict (group_id, user_id) do nothing;
    end if;
    update public.join_requests set status = decision, decided_by = actor, decided_at = clock_timestamp()
        where id = request.id;
end;
$$;

-- Reveal requester display names only to the current Owner, never all profiles.
create function public.get_pending_join_requests(target_group_id uuid)
returns table (id uuid, display_name text, requested_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from public.groups g where g.id = target_group_id and g.owner_user_id = auth.uid()
    ) then raise exception 'Only the group Owner may review requests.' using errcode = '42501'; end if;
    return query
        select r.id, p.display_name, r.requested_at
        from public.join_requests r join public.profiles p on p.id = r.user_id
        where r.group_id = target_group_id and r.status = 'pending'
        order by r.requested_at, r.id;
end;
$$;

revoke all on function public.generate_group_invite(uuid), public.revoke_group_invite(uuid),
    public.request_group_access(text), public.decide_join_request(uuid, text),
    public.get_pending_join_requests(uuid) from public, anon, authenticated;
grant execute on function public.generate_group_invite(uuid), public.revoke_group_invite(uuid),
    public.request_group_access(text), public.decide_join_request(uuid, text),
    public.get_pending_join_requests(uuid) to authenticated;

commit;
