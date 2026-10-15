begin;

-- Opaque group-scoped Apple reference. No table-write grants or RLS changes.
alter table public.group_restaurants
    add column apple_place_id text,
    add constraint group_restaurants_apple_place_id_check check (
        apple_place_id is null or (
            char_length(apple_place_id) between 1 and 300
            -- Match the adapter's whitespace/control checks regardless of locale.
            -- PostgreSQL text already rejects NUL. Never normalize an opaque ID.
            and apple_place_id collate "C" = btrim(apple_place_id,
                U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
            and apple_place_id collate "C" !~ U&'[\0001-\001F\007F-\009F]'
        )
    );

create function public.save_restaurant_visit_with_apple_place_id(
    client_request_id text,
    target_group_ids uuid[],
    restaurant_name text,
    restaurant_address text,
    restaurant_cuisine text default null,
    visit_date date default null,
    visit_rating integer default null,
    visit_would_go_again boolean default null,
    visit_notes text default null,
    restaurant_apple_place_id text default null
)
returns table (restaurant_id uuid, bindings_recorded boolean)
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
    -- NULL has exactly the historical fingerprint and binding-wrapper semantics.
    if restaurant_apple_place_id is null then
        return query select * from public.save_restaurant_visit_with_location_bindings(
            client_request_id, target_group_ids, restaurant_name, restaurant_address,
            restaurant_cuisine, visit_date, visit_rating, visit_would_go_again, visit_notes);
        return;
    end if;
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'Entry binding saves require READ COMMITTED.' using errcode = '25001';
    end if;
    if not (char_length(restaurant_apple_place_id) between 1 and 300
        and restaurant_apple_place_id collate "C" = btrim(restaurant_apple_place_id,
            U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
        and restaurant_apple_place_id collate "C" !~ U&'[\0001-\001F\007F-\009F]') then
        raise exception 'Enter a valid Apple Place ID.' using errcode = '22023';
    end if;
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
        'would_go_again', visit_would_go_again, 'notes', clean_notes,
        'apple_place_id', restaurant_apple_place_id
    )::text, 'sha256'), 'hex');
    insert into public.visit_save_requests(user_id, request_id, payload_hash)
    values (actor, client_request_id, fingerprint) on conflict on constraint visit_save_requests_pkey do nothing;
    select * into receipt from public.visit_save_requests
        where user_id = actor and request_id = client_request_id for update;
    if receipt.payload_hash <> fingerprint then
        raise exception 'This save request ID was already used for different data.' using errcode = '22023';
    end if;
    if receipt.restaurant_id is not null then
        return query select receipt.restaurant_id, exists (select 1 from public.visit_save_location_bindings b
            where b.user_id = actor and b.request_id = client_request_id);
        return;
    end if;

    -- Lock ALL existing group facts before touching ANY entry. Address edits
    -- hold the Restaurant row before their invalidation trigger touches entries.
    -- FOR SHARE blocks non-key address UPDATEs and allows saves in independent
    -- groups sharing historical facts. Sorted locks avoid multi-group inversions.
    -- Include currently nonmatching facts: a concurrent edit could otherwise
    -- turn one into a match between the lock statement and the matching loop.
    -- Under READ COMMITTED the loop below rechecks matching after any wait.
    perform r.id from public.restaurants r
        where exists (select 1 from public.group_restaurants gr
                where gr.restaurant_id = r.id and gr.group_id = any(target_groups))
        order by r.id for share of r;

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
            insert into public.group_restaurants(group_id, restaurant_id, created_by, apple_place_id)
                values (target_group, location_id, actor, restaurant_apple_place_id) returning id into entry_id;
        elsif exists (select 1 from public.groups g where g.id = target_group and g.owner_user_id = actor) then
            -- Member-supplied metadata is ignored for an existing entry. Everyone
            -- still saves their Visit. Owners may only fill NULL, never replace.
            update public.group_restaurants gr set apple_place_id = restaurant_apple_place_id
                where gr.id = entry_id and gr.apple_place_id is null;
        end if;
        first_location_id := coalesce(first_location_id, location_id);
        insert into public.visits(group_restaurant_id, created_by, visited_on, rating, would_go_again, notes)
        values (entry_id, actor, visit_date, visit_rating, visit_would_go_again, clean_notes);
        insert into public.visit_save_location_bindings(user_id, request_id, group_id, group_restaurant_id)
            values (actor, client_request_id, target_group, entry_id);
    end loop;
    update public.visit_save_requests set restaurant_id = first_location_id
        where user_id = actor and request_id = client_request_id;
    return query select first_location_id, true;
end;
$$;

create or replace function public.invalidate_saved_location_address()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if new.address is distinct from old.address then
        if tg_table_name = 'personal_places' then
            delete from public.personal_place_locations where personal_place_id = new.id;
        elsif tg_table_name = 'restaurants' then
            -- Historical Restaurant rows may belong to multiple groups. Clear
            -- every affected entry in this same transaction, without group locks
            -- that could invert the save/Geoapify group -> Restaurant lock order.
            update public.group_restaurants set apple_place_id = null
                where restaurant_id = new.id and apple_place_id is not null;
            delete from public.group_restaurant_locations l using public.group_restaurants gr
                where l.group_restaurant_id = gr.id and gr.restaurant_id = new.id;
        end if;
    end if;
    return new;
end;
$$;
create function public.get_group_restaurant_apple_place_id(
    target_group_id uuid, target_group_restaurant_id uuid
)
returns table (group_id uuid, group_restaurant_id uuid, apple_place_id text)
language plpgsql stable security definer set search_path = '' as $$
begin
    if auth.uid() is null or not exists (select 1 from public.group_memberships m
        where m.group_id = target_group_id and m.user_id = auth.uid()) then
        raise exception 'Saved restaurant not found or access denied.' using errcode = '42501';
    end if;
    return query select gr.group_id, gr.id, gr.apple_place_id from public.group_restaurants gr
        where gr.group_id = target_group_id and gr.id = target_group_restaurant_id;
end;
$$;

revoke all on function public.save_restaurant_visit_with_apple_place_id(text, uuid[], text, text, text, date, integer, boolean, text, text),
    public.get_group_restaurant_apple_place_id(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_restaurant_visit_with_apple_place_id(text, uuid[], text, text, text, date, integer, boolean, text, text),
    public.get_group_restaurant_apple_place_id(uuid, uuid) to authenticated;

commit;
