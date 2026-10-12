begin;

-- Forward-only privacy correction. Preserve every existing fact, entry, Visit,
-- location and receipt. Do not edit/reapply historical migrations 1–11.
drop policy restaurants_read_authenticated on public.restaurants;
create policy restaurants_read_member on public.restaurants
    for select to authenticated using (exists (
        select 1 from public.group_restaurants gr
        join public.group_memberships m on m.group_id = gr.group_id
        where gr.restaurant_id = restaurants.id and m.user_id = (select auth.uid())
    ));

-- Global uniqueness/reuse is an existence and first-writer-facts side channel.
-- Existing shared rows remain shared; future reuse is confined to a group.
alter table public.restaurants drop constraint restaurants_name_address_key;
create index restaurants_name_address_idx on public.restaurants(name, address);

create or replace function public.save_restaurant_visit(
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
    first_location_id uuid;
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

    -- Reuse only an entry already saved to THIS authorized group. A name/address
    -- match in an unrelated group must not reveal its UUID, cuisine or existence.
    -- The existing sorted group locks serialize all saves and entry cleanup.
    foreach target_group in array target_groups loop
        location_id := null;
        entry_id := null;
        select gr.restaurant_id, gr.id into location_id, entry_id
            from public.group_restaurants gr join public.restaurants r on r.id = gr.restaurant_id
            where gr.group_id = target_group and r.name = clean_name and r.address = clean_address
            order by gr.created_at, gr.id limit 1;
        if entry_id is null then
            insert into public.restaurants(name, address, cuisine)
                values (clean_name, clean_address, clean_cuisine) returning id into location_id;
            insert into public.group_restaurants(group_id, restaurant_id, created_by)
                values (target_group, location_id, actor) returning id into entry_id;
        end if;
        first_location_id := coalesce(first_location_id, location_id);
        insert into public.visits(group_restaurant_id, created_by, visited_on, rating, would_go_again, notes)
        values (entry_id, actor, visit_date, visit_rating, visit_would_go_again, clean_notes);
    end loop;
    update public.visit_save_requests set restaurant_id = first_location_id
        where user_id = actor and request_id = client_request_id;
    return first_location_id;
end;
$$;

create or replace function public.save_restaurant_visit_with_location_bindings(
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
    -- The save RPC owns validation and retry identity. Each group's exact entry
    -- can now refer to a different Restaurant, so bind actual scoped entries.
    if not receipt_existed then
        insert into public.visit_save_location_bindings(user_id, request_id, group_id, group_restaurant_id)
            select actor, client_request_id, gr.group_id, gr.id
            from public.group_restaurants gr join public.restaurants r on r.id = gr.restaurant_id
            where gr.group_id = any(selected_groups)
                and r.name = btrim(restaurant_name) and r.address = btrim(restaurant_address);
        get diagnostics inserted_count = row_count;
        if inserted_count <> pg_catalog.cardinality(selected_groups) then
            raise exception 'Could not bind every saved group entry.' using errcode = '40001';
        end if;
    end if;
    return query select saved_restaurant_id, exists (select 1 from public.visit_save_location_bindings b
        where b.user_id = actor and b.request_id = client_request_id);
end;
$$;

create or replace function public.get_visit_save_location_targets(client_request_id text)
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
    return query select b.group_id, gr.restaurant_id, b.group_restaurant_id, r.address
        from public.visit_save_location_bindings b
        join public.visit_save_requests s on s.user_id = b.user_id and s.request_id = b.request_id
        join public.group_memberships m on m.group_id = b.group_id and m.user_id = actor
        join public.group_restaurants gr on gr.id = b.group_restaurant_id
            and gr.group_id = b.group_id
        join public.restaurants r on r.id = gr.restaurant_id
        where b.user_id = actor and b.request_id = client_request_id
        order by b.group_id;
end;
$$;
revoke all on function public.save_restaurant_visit_with_location_bindings(text, uuid[], text, text, text, date, integer, boolean, text),
    public.get_visit_save_location_targets(text) from public, anon, authenticated, service_role;
grant execute on function public.save_restaurant_visit_with_location_bindings(text, uuid[], text, text, text, date, integer, boolean, text),
    public.get_visit_save_location_targets(text) to authenticated;

-- CREATE OR REPLACE preserves the original save function's identity and grants.

commit;
