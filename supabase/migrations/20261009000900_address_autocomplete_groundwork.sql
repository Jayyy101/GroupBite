begin;

-- Exact, historical entry identities. No FK to groups/entries: deletion must
-- neither erase these bindings nor prevent removal of a group or final Visit.
create table public.visit_save_location_bindings (
    user_id uuid not null,
    request_id text not null,
    group_id uuid not null,
    group_restaurant_id uuid not null,
    primary key (user_id, request_id, group_id),
    foreign key (user_id, request_id) references public.visit_save_requests(user_id, request_id) on delete cascade
);
alter table public.visit_save_location_bindings enable row level security;
revoke all on public.visit_save_location_bindings from public, anon, authenticated, service_role;

-- Only the wrapper inserts bindings. No update API or upsert is allowed.
create function public.reject_visit_save_location_binding_update()
returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception 'Saved entry bindings are immutable.' using errcode = '42501';
end;
$$;
revoke all on function public.reject_visit_save_location_binding_update()
    from public, anon, authenticated, service_role;
create trigger immutable_visit_save_location_binding before update on public.visit_save_location_bindings
    for each row execute function public.reject_visit_save_location_binding_update();

create function public.save_restaurant_visit_with_location_bindings(
    client_request_id text, target_group_ids uuid[], restaurant_name text, restaurant_address text,
    restaurant_cuisine text default null, visit_date date default null,
    visit_rating integer default null, visit_would_go_again boolean default null, visit_notes text default null
)
returns table (restaurant_id uuid, bindings_recorded boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
    actor uuid := auth.uid();
    selected_groups uuid[];
    selected_group uuid;
    receipt_existed boolean;
    saved_restaurant_id uuid;
    inserted_count integer;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    -- The pre-save receipt check must see commits from writers we waited for.
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'Entry binding saves require READ COMMITTED.' using errcode = '25001';
    end if;
    if coalesce(pg_catalog.array_length(target_group_ids, 1), 0) = 0
        or pg_catalog.array_ndims(target_group_ids) <> 1 then
        raise exception 'Choose at least one group.' using errcode = '22023';
    end if;
    if pg_catalog.array_position(target_group_ids, null) is not null then
        raise exception 'Choose at least one group.' using errcode = '22023';
    end if;
    select pg_catalog.array_agg(distinct selected.id order by selected.id) into selected_groups
        from pg_catalog.unnest(target_group_ids) as selected(id);
    -- Match migration 4's group-first order. Do not lock receipts before groups.
    foreach selected_group in array selected_groups loop
        perform 1 from public.groups g where g.id = selected_group for update;
        if not found or not exists (select 1 from public.group_memberships m
            where m.group_id = selected_group and m.user_id = actor) then
            raise exception 'You must be a current member of every selected group.' using errcode = '42501';
        end if;
    end loop;
    -- Separate statement AFTER locks: a legacy save might have committed while
    -- we waited. A legacy receipt can never be upgraded to inferred bindings.
    select exists (select 1 from public.visit_save_requests s
        where s.user_id = actor and s.request_id = client_request_id) into receipt_existed;
    saved_restaurant_id := public.save_restaurant_visit(client_request_id, target_group_ids,
        restaurant_name, restaurant_address, restaurant_cuisine, visit_date,
        visit_rating, visit_would_go_again, visit_notes);
    -- The unchanged RPC owns payload validation, fingerprints, retry behavior,
    -- shared Restaurant reuse, all Visit creation and the original receipt.
    if not receipt_existed then
        insert into public.visit_save_location_bindings(user_id, request_id, group_id, group_restaurant_id)
            select actor, client_request_id, gr.group_id, gr.id from public.group_restaurants gr
            where gr.group_id = any(selected_groups) and gr.restaurant_id = saved_restaurant_id;
        get diagnostics inserted_count = row_count;
        if inserted_count <> pg_catalog.cardinality(selected_groups) then
            raise exception 'Could not bind every saved group entry.' using errcode = '40001';
        end if;
    end if;
    return query select saved_restaurant_id, exists (select 1 from public.visit_save_location_bindings b
        where b.user_id = actor and b.request_id = client_request_id);
end;
$$;

create function public.get_visit_save_location_targets(client_request_id text)
returns table (group_id uuid, restaurant_id uuid, group_restaurant_id uuid, address text)
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    if client_request_id is null or pg_catalog.char_length(client_request_id) not between 1 and 120 then
        raise exception 'A save request ID is required.' using errcode = '22023';
    end if;
    -- No historical membership/ownership bypass, and no fallback to a newly
    -- recreated entry matching (group_id, restaurant_id).
    return query select b.group_id, s.restaurant_id, b.group_restaurant_id, r.address
        from public.visit_save_location_bindings b
        join public.visit_save_requests s on s.user_id = b.user_id and s.request_id = b.request_id
        join public.group_memberships m on m.group_id = b.group_id and m.user_id = actor
        join public.group_restaurants gr on gr.id = b.group_restaurant_id
            and gr.group_id = b.group_id and gr.restaurant_id = s.restaurant_id
        join public.restaurants r on r.id = s.restaurant_id
        where b.user_id = actor and b.request_id = client_request_id
        order by b.group_id;
end;
$$;
revoke all on function public.save_restaurant_visit_with_location_bindings(text, uuid[], text, text, text, date, integer, boolean, text),
    public.get_visit_save_location_targets(text) from public, anon, authenticated, service_role;
grant execute on function public.save_restaurant_visit_with_location_bindings(text, uuid[], text, text, text, date, integer, boolean, text),
    public.get_visit_save_location_targets(text) to authenticated;

-- Reservations count even if HTTP fails or never starts. No FK to profiles:
-- deleting an account must not refund its recent global usage.
create table public.geoapify_request_admissions (
    id uuid primary key default pg_catalog.gen_random_uuid(),
    user_id uuid not null,
    admitted_at timestamptz not null check (pg_catalog.isfinite(admitted_at)),
    permit_expires_at timestamptz not null check (permit_expires_at = admitted_at + interval '1 second')
);
create index geoapify_admissions_time_idx on public.geoapify_request_admissions(permit_expires_at);
create index geoapify_admissions_user_time_idx on public.geoapify_request_admissions(user_id, permit_expires_at);
alter table public.geoapify_request_admissions enable row level security;
revoke all on public.geoapify_request_admissions from public, anon, authenticated, service_role;

create function public.reserve_geoapify_request(acting_user_id uuid)
returns table (admitted boolean, admission_id uuid, permit_expires_at timestamptz, reason text, retry_after_seconds integer)
language plpgsql volatile security definer set search_path = '' as $$
declare
    checked_at timestamptz;
    global_count bigint;
    user_count bigint;
    rate_count bigint;
    global_first_expiry timestamptz;
    user_first_expiry timestamptz;
    rate_first_expiry timestamptz;
    reserved_id uuid;
begin
    -- Edge must verify the user token and derive this ID; service identity is
    -- intentionally distinct from auth.uid(). Callers cannot choose the limits.
    if acting_user_id is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'Geoapify admission requires READ COMMITTED.' using errcode = '25001';
    end if;
    -- Dedicated transaction lock namespace. Never use a pooled session lock or
    -- combine the lock and count in one statement with a pre-wait snapshot.
    perform pg_catalog.pg_advisory_xact_lock(714015, 9);
    checked_at := pg_catalog.clock_timestamp();
    if not exists (select 1 from public.profiles p where p.id = acting_user_id) then
        raise exception 'User not found or access denied.' using errcode = '42501';
    end if;
    -- Conservatively retain/count the one-second dispatch grace. Every actual
    -- attempt must begin before expiry; an expired/uncertain permit is abandoned.
    delete from public.geoapify_request_admissions a
        where a.permit_expires_at <= checked_at - interval '24 hours';
    select count(*), count(*) filter (where a.user_id = acting_user_id),
        -- Three admissions per TWO seconds + a one-second dispatch permit:
        -- at most three timely HTTP starts in any rolling second. Admission
        -- timing alone cannot bound arrival times on the provider's network.
        count(*) filter (where a.permit_expires_at > checked_at - interval '1 second'),
        min(a.permit_expires_at), min(a.permit_expires_at) filter (where a.user_id = acting_user_id),
        min(a.permit_expires_at) filter (where a.permit_expires_at > checked_at - interval '1 second')
        into global_count, user_count, rate_count, global_first_expiry, user_first_expiry, rate_first_expiry
        from public.geoapify_request_admissions a;
    if global_count >= 1000 then
        return query select false, null::uuid, null::timestamptz, 'global_daily_limit'::text,
            greatest(1, pg_catalog.ceil(extract(epoch from (global_first_expiry + interval '24 hours' - checked_at)))::integer);
    elsif user_count >= 100 then
        return query select false, null::uuid, null::timestamptz, 'user_daily_limit'::text,
            greatest(1, pg_catalog.ceil(extract(epoch from (user_first_expiry + interval '24 hours' - checked_at)))::integer);
    elsif rate_count >= 3 then
        return query select false, null::uuid, null::timestamptz, 'global_rate_limit'::text,
            greatest(1, pg_catalog.ceil(extract(epoch from (rate_first_expiry + interval '1 second' - checked_at)))::integer);
    else
        insert into public.geoapify_request_admissions(user_id, admitted_at, permit_expires_at)
            values (acting_user_id, checked_at, checked_at + interval '1 second') returning id into reserved_id;
        return query select true, reserved_id, checked_at + interval '1 second', 'admitted'::text, 0;
    end if;
end;
$$;
revoke all on function public.reserve_geoapify_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reserve_geoapify_request(uuid) to service_role;

commit;
