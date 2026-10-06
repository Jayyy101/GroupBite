begin;

create table public.restaurants (
    id uuid primary key default gen_random_uuid(),
    name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
    address text not null check (address = btrim(address) and char_length(address) between 1 and 300),
    cuisine text check (char_length(cuisine) <= 100),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- Only exact, trimmed name/address matches are reused. No fuzzy merging.
    unique (name, address)
);

create table public.group_restaurants (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references public.groups(id) on delete cascade,
    restaurant_id uuid not null references public.restaurants(id) on delete restrict,
    created_by uuid not null references public.profiles(id) on delete restrict,
    created_at timestamptz not null default now(),
    unique (group_id, restaurant_id)
);
create index group_restaurants_restaurant_idx on public.group_restaurants(restaurant_id);

create table public.visits (
    id uuid primary key default gen_random_uuid(),
    group_restaurant_id uuid not null references public.group_restaurants(id) on delete cascade,
    created_by uuid not null references public.profiles(id) on delete restrict,
    visited_on date,
    rating integer check (rating between 1 and 5),
    would_go_again boolean,
    notes text check (char_length(notes) <= 4000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index visits_group_restaurant_idx on public.visits(group_restaurant_id, created_at);

-- A private receipt makes retries safe. It stores no visit text or group list.
create table public.visit_save_requests (
    user_id uuid not null references public.profiles(id) on delete restrict,
    request_id text not null check (char_length(request_id) between 1 and 120),
    payload_hash text not null,
    restaurant_id uuid references public.restaurants(id) on delete restrict,
    created_at timestamptz not null default now(),
    primary key (user_id, request_id)
);

alter table public.restaurants enable row level security;
alter table public.group_restaurants enable row level security;
alter table public.visits enable row level security;
alter table public.visit_save_requests enable row level security;
revoke all on public.restaurants, public.group_restaurants, public.visits, public.visit_save_requests
    from public, anon, authenticated;
grant select on public.restaurants, public.group_restaurants, public.visits to authenticated;

create policy restaurants_read_authenticated on public.restaurants
    for select to authenticated using ((select auth.uid()) is not null);
create policy group_restaurants_read_member on public.group_restaurants
    for select to authenticated using (
        exists (select 1 from public.group_memberships m
            where m.group_id = group_restaurants.group_id and m.user_id = (select auth.uid()))
    );
create policy visits_read_member on public.visits
    for select to authenticated using (
        exists (select 1 from public.group_restaurants gr
            join public.group_memberships m on m.group_id = gr.group_id
            where gr.id = visits.group_restaurant_id and m.user_id = (select auth.uid()))
    );
-- No client policies/grants for receipts; only the save RPC can access them.

create function public.save_restaurant_visit(
    client_request_id text,
    target_group_ids uuid[],
    restaurant_name text,
    restaurant_address text,
    restaurant_cuisine text default null,
    visit_date date default null,
    visit_rating integer default null,
    visit_would_go_again boolean default null,
    visit_notes text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    target_groups uuid[];
    target_group uuid;
    location_id uuid;
    entry_id uuid;
    clean_name text := btrim(restaurant_name);
    clean_address text := btrim(restaurant_address);
    clean_cuisine text := nullif(btrim(restaurant_cuisine), '');
    clean_notes text := nullif(btrim(visit_notes), '');
    fingerprint text;
    receipt public.visit_save_requests;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    if clean_name is null or char_length(clean_name) not between 1 and 100
        or clean_address is null or char_length(clean_address) not between 1 and 300 then
        raise exception 'Enter a restaurant name and address.' using errcode = '22023';
    end if;
    if char_length(clean_cuisine) > 100 or char_length(clean_notes) > 4000
        or (visit_rating is not null and visit_rating not between 1 and 5) then
        raise exception 'Check the optional visit fields.' using errcode = '22023';
    end if;
    if client_request_id is null or char_length(client_request_id) not between 1 and 120 then
        raise exception 'A save request ID is required.' using errcode = '22023';
    end if;
    if coalesce(array_length(target_group_ids, 1), 0) = 0 or array_ndims(target_group_ids) <> 1 then
        raise exception 'Choose at least one group.' using errcode = '22023';
    end if;
    if array_position(target_group_ids, null) is not null then
        raise exception 'Choose at least one group.' using errcode = '22023';
    end if;
    select array_agg(distinct group_id order by group_id) into target_groups
        from unnest(target_group_ids) as selected(group_id);

    -- Lock all groups in a consistent order, and validate all before any writes.
    -- These locks also serialize concurrent saves to the same group.
    foreach target_group in array target_groups loop
        perform 1 from public.groups where id = target_group for update;
        if not found or not exists (select 1 from public.group_memberships
            where group_id = target_group and user_id = actor) then
            raise exception 'You must be a current member of every selected group.' using errcode = '42501';
        end if;
    end loop;

    fingerprint := encode(extensions.digest(jsonb_build_object(
        'groups', target_groups, 'name', clean_name, 'address', clean_address,
        'cuisine', clean_cuisine, 'date', visit_date, 'rating', visit_rating,
        'would_go_again', visit_would_go_again, 'notes', clean_notes
    )::text, 'sha256'), 'hex');
    insert into public.visit_save_requests(user_id, request_id, payload_hash)
    values (actor, client_request_id, fingerprint) on conflict (user_id, request_id) do nothing;
    select * into receipt from public.visit_save_requests
        where user_id = actor and request_id = client_request_id for update;
    if receipt.payload_hash <> fingerprint then
        raise exception 'This save request ID was already used for different data.' using errcode = '22023';
    end if;
    if receipt.restaurant_id is not null then return receipt.restaurant_id; end if;

    insert into public.restaurants(name, address, cuisine)
    values (clean_name, clean_address, clean_cuisine) on conflict (name, address) do nothing;
    select id into location_id from public.restaurants where name = clean_name and address = clean_address;
    -- Reuse preserves existing global facts; saving memories never edits them.
    foreach target_group in array target_groups loop
        insert into public.group_restaurants(group_id, restaurant_id, created_by)
        values (target_group, location_id, actor) on conflict (group_id, restaurant_id) do nothing;
        select id into entry_id from public.group_restaurants
            where group_id = target_group and restaurant_id = location_id;
        insert into public.visits(group_restaurant_id, created_by, visited_on, rating, would_go_again, notes)
        values (entry_id, actor, visit_date, visit_rating, visit_would_go_again, clean_notes);
    end loop;
    update public.visit_save_requests set restaurant_id = location_id
        where user_id = actor and request_id = client_request_id;
    return location_id;
end;
$$;

create function public.get_group_restaurants(target_group_id uuid)
returns table (
    id uuid, restaurant_id uuid, name text, address text, cuisine text,
    average_rating numeric, rated_visit_count bigint, total_visit_count bigint
)
language plpgsql security definer set search_path = ''
as $$
begin
    if auth.uid() is null or not exists (select 1 from public.group_memberships m
        where m.group_id = target_group_id and m.user_id = auth.uid()) then
        raise exception 'Group not found or access denied.' using errcode = '42501';
    end if;
    return query
        select gr.id, r.id, r.name, r.address, r.cuisine, avg(v.rating), count(v.rating), count(v.id)
        from public.group_restaurants gr
        join public.restaurants r on r.id = gr.restaurant_id
        left join public.visits v on v.group_restaurant_id = gr.id
        where gr.group_id = target_group_id
        group by gr.id, r.id
        order by gr.created_at desc, gr.id;
end;
$$;

create function public.get_group_restaurant_visits(target_group_restaurant_id uuid)
returns table (
    id uuid, visited_on date, rating integer, would_go_again boolean, notes text,
    created_at timestamptz, creator_display_name text
)
language plpgsql security definer set search_path = ''
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from public.group_restaurants gr join public.group_memberships m on m.group_id = gr.group_id
        where gr.id = target_group_restaurant_id and m.user_id = auth.uid()
    ) then raise exception 'Restaurant not found or access denied.' using errcode = '42501'; end if;
    return query
        select v.id, v.visited_on, v.rating, v.would_go_again, v.notes, v.created_at, p.display_name
        from public.visits v join public.profiles p on p.id = v.created_by
        where v.group_restaurant_id = target_group_restaurant_id
        order by v.created_at desc, v.id;
end;
$$;

revoke all on function public.save_restaurant_visit(text, uuid[], text, text, text, date, integer, boolean, text),
    public.get_group_restaurants(uuid), public.get_group_restaurant_visits(uuid) from public, anon, authenticated;
grant execute on function public.save_restaurant_visit(text, uuid[], text, text, text, date, integer, boolean, text),
    public.get_group_restaurants(uuid), public.get_group_restaurant_visits(uuid) to authenticated;

commit;
