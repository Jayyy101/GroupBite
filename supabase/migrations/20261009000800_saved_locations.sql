begin;

-- Do not silently move an existing extension. Deployment must resolve a schema
-- mismatch first; all spatial references below are explicitly qualified.
create extension if not exists postgis with schema extensions;
do $$
begin
    if not exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
        where e.extname = 'postgis' and n.nspname = 'extensions') then
        raise exception 'PostGIS must be installed in the extensions schema before migration 8.';
    end if;
end;
$$;

-- Restaurants has a globally authenticated SELECT grant. Keep new geographic
-- facts outside that catalog, scoped to each saved group entry. Reusing a
-- Restaurant in another group never inherits coordinates or provider metadata.
-- No rows are backfilled: a missing row means unresolved, with null coordinates.
create table public.group_restaurant_locations (
    group_restaurant_id uuid primary key references public.group_restaurants(id) on delete cascade,
    address_snapshot text not null check (char_length(address_snapshot) between 1 and 300),
    latitude double precision,
    longitude double precision,
    location extensions.geography(Point, 4326) generated always as (
        case when latitude is not null and longitude is not null then
            extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
        end
    ) stored,
    resolution_status text not null default 'unresolved'
        check (resolution_status in ('unresolved', 'resolved', 'failed', 'ambiguous')),
    resolution_provider text check (resolution_provider = btrim(resolution_provider)
        and char_length(resolution_provider) between 1 and 100),
    provider_location_id text check (provider_location_id = btrim(provider_location_id)
        and char_length(provider_location_id) between 1 and 300),
    standardized_address text check (standardized_address = btrim(standardized_address)
        and char_length(standardized_address) between 1 and 300),
    resolution_accuracy text check (resolution_accuracy in ('building', 'address')),
    resolved_at timestamptz,
    check ((latitude is null) = (longitude is null)),
    -- BETWEEN also rejects PostgreSQL NaN and infinities.
    check (latitude between -90 and 90 and longitude between -180 and 180),
    check ((resolution_status = 'resolved' and latitude is not null and longitude is not null
        and resolution_provider is not null and provider_location_id is not null
        and standardized_address is not null and resolution_accuracy is not null and resolved_at is not null)
        or (resolution_status <> 'resolved' and latitude is null and longitude is null
            and resolution_accuracy is null and resolved_at is null))
);
create index group_restaurant_locations_location_idx on public.group_restaurant_locations using gist(location);

-- A separate table also preserves the Personal Place row/CRUD contract exactly.
create table public.personal_place_locations (
    personal_place_id uuid primary key references public.personal_places(id) on delete cascade,
    address_snapshot text not null check (char_length(address_snapshot) between 1 and 300),
    latitude double precision,
    longitude double precision,
    location extensions.geography(Point, 4326) generated always as (
        case when latitude is not null and longitude is not null then
            extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
        end
    ) stored,
    resolution_status text not null default 'unresolved'
        check (resolution_status in ('unresolved', 'resolved', 'failed', 'ambiguous')),
    resolution_provider text check (resolution_provider = btrim(resolution_provider)
        and char_length(resolution_provider) between 1 and 100),
    provider_location_id text check (provider_location_id = btrim(provider_location_id)
        and char_length(provider_location_id) between 1 and 300),
    standardized_address text check (standardized_address = btrim(standardized_address)
        and char_length(standardized_address) between 1 and 300),
    resolution_accuracy text check (resolution_accuracy in ('building', 'address')),
    resolved_at timestamptz,
    check ((latitude is null) = (longitude is null)),
    check (latitude between -90 and 90 and longitude between -180 and 180),
    check ((resolution_status = 'resolved' and latitude is not null and longitude is not null
        and resolution_provider is not null and provider_location_id is not null
        and standardized_address is not null and resolution_accuracy is not null and resolved_at is not null)
        or (resolution_status <> 'resolved' and latitude is null and longitude is null
            and resolution_accuracy is null and resolved_at is null))
);
create index personal_place_locations_location_idx on public.personal_place_locations using gist(location);

alter table public.group_restaurant_locations enable row level security;
alter table public.personal_place_locations enable row level security;
revoke all on public.group_restaurant_locations, public.personal_place_locations
    from public, anon, authenticated, service_role;
grant select on public.group_restaurant_locations, public.personal_place_locations to authenticated;

create policy group_restaurant_locations_read_member on public.group_restaurant_locations
    for select to authenticated using (exists (
        select 1 from public.group_restaurants gr join public.group_memberships m on m.group_id = gr.group_id
        where gr.id = group_restaurant_locations.group_restaurant_id and m.user_id = (select auth.uid())
    ));
create policy personal_place_locations_read_own on public.personal_place_locations
    for select to authenticated using (exists (
        select 1 from public.personal_places p
        where p.id = personal_place_locations.personal_place_id and p.owner_user_id = (select auth.uid())
    ));

-- Address edits invalidate old coordinates in the same transaction. The existing
-- personal trigger still owns trimming, timestamps and optimistic revisions.
create function public.invalidate_saved_location_address()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if new.address is distinct from old.address then
        if tg_table_name = 'personal_places' then
            delete from public.personal_place_locations where personal_place_id = new.id;
        elsif tg_table_name = 'restaurants' then
            delete from public.group_restaurant_locations l using public.group_restaurants gr
                where l.group_restaurant_id = gr.id and gr.restaurant_id = new.id;
        end if;
    end if;
    return new;
end;
$$;
revoke all on function public.invalidate_saved_location_address() from public, anon, authenticated, service_role;
create trigger invalidate_personal_place_location after update of address on public.personal_places
    for each row execute function public.invalidate_saved_location_address();
create trigger invalidate_restaurant_location after update of address on public.restaurants
    for each row execute function public.invalidate_saved_location_address();

-- Backend-only trust boundary: a future backend must authenticate the acting
-- user and verify the provider result. SQL does not itself geocode or verify a
-- provider's response. Never grant these attachment RPCs to mobile clients.
create function public.attach_verified_restaurant_location(
    acting_user_id uuid, target_group_id uuid, target_restaurant_id uuid,
    target_group_restaurant_id uuid, expected_address text,
    verified_latitude double precision, verified_longitude double precision,
    provider_name text, provider_result_id text, formatted_address text, accuracy text
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
    saved_address text;
begin
    -- Keep group-first serialization with saves, departures and Visit management.
    -- Restaurant before entry also matches saves and address invalidation.
    perform 1 from public.groups g where g.id = target_group_id for update;
    if acting_user_id is null or not found or not exists (select 1 from public.group_memberships m
        where m.group_id = target_group_id and m.user_id = acting_user_id) then
        raise exception 'Saved restaurant not found or access denied.' using errcode = '42501';
    end if;
    select r.address into saved_address from public.restaurants r
        where r.id = target_restaurant_id for update;
    if not found then
        raise exception 'Saved restaurant not found or access denied.' using errcode = '42501';
    end if;
    perform 1 from public.group_restaurants gr
        where gr.id = target_group_restaurant_id and gr.group_id = target_group_id
            and gr.restaurant_id = target_restaurant_id for update;
    if not found then
        raise exception 'Saved restaurant not found or access denied.' using errcode = '42501';
    end if;
    if saved_address is distinct from expected_address then
        raise exception 'The saved address changed. Resolve it again.' using errcode = '40001';
    end if;
    -- Resolve only this entry, including when its save reused a global Restaurant.
    -- A deleted/recreated entry has a different ID: stale results cannot attach.
    -- No changes to facts, memories, receipts or existing save RPCs are required.
    insert into public.group_restaurant_locations as existing (
        group_restaurant_id, address_snapshot, latitude, longitude, resolution_status,
        resolution_provider, provider_location_id, standardized_address, resolution_accuracy, resolved_at
    ) values (target_group_restaurant_id, saved_address, verified_latitude, verified_longitude, 'resolved',
        provider_name, provider_result_id, formatted_address, accuracy, clock_timestamp())
    on conflict (group_restaurant_id) do update set
        address_snapshot = excluded.address_snapshot, latitude = excluded.latitude, longitude = excluded.longitude,
        resolution_status = excluded.resolution_status, resolution_provider = excluded.resolution_provider,
        provider_location_id = excluded.provider_location_id, standardized_address = excluded.standardized_address,
        resolution_accuracy = excluded.resolution_accuracy, resolved_at = excluded.resolved_at
    where existing.resolution_status <> 'resolved';
    return found; -- false: this entry is already resolved; other groups are independent.
end;
$$;

create function public.attach_verified_personal_place_location(
    acting_user_id uuid, target_personal_place_id uuid, expected_revision integer, expected_address text,
    verified_latitude double precision, verified_longitude double precision,
    provider_name text, provider_result_id text, formatted_address text, accuracy text
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
    saved public.personal_places;
begin
    select * into saved from public.personal_places p
        where p.id = target_personal_place_id and p.owner_user_id = acting_user_id for update;
    if acting_user_id is null or not found then
        raise exception 'Personal Place not found or access denied.' using errcode = '42501';
    end if;
    if saved.revision is distinct from expected_revision or saved.address is distinct from expected_address then
        raise exception 'The Personal Place changed. Resolve it again.' using errcode = '40001';
    end if;
    insert into public.personal_place_locations as existing (
        personal_place_id, address_snapshot, latitude, longitude, resolution_status,
        resolution_provider, provider_location_id, standardized_address, resolution_accuracy, resolved_at
    ) values (target_personal_place_id, saved.address, verified_latitude, verified_longitude, 'resolved',
        provider_name, provider_result_id, formatted_address, accuracy, clock_timestamp())
    on conflict (personal_place_id) do update set
        address_snapshot = excluded.address_snapshot, latitude = excluded.latitude, longitude = excluded.longitude,
        resolution_status = excluded.resolution_status, resolution_provider = excluded.resolution_provider,
        provider_location_id = excluded.provider_location_id, standardized_address = excluded.standardized_address,
        resolution_accuracy = excluded.resolution_accuracy, resolved_at = excluded.resolved_at
    where existing.resolution_status <> 'resolved';
    if not found then return false; end if;
    -- Coordinate changes participate in existing optimistic concurrency. The
    -- original trigger increments revision; the unchanged address retains metadata.
    update public.personal_places set address = saved.address where id = saved.id;
    return true;
end;
$$;

revoke all on function public.attach_verified_restaurant_location(uuid, uuid, uuid, uuid, text, double precision, double precision, text, text, text, text),
    public.attach_verified_personal_place_location(uuid, uuid, integer, text, double precision, double precision, text, text, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.attach_verified_restaurant_location(uuid, uuid, uuid, uuid, text, double precision, double precision, text, text, text, text),
    public.attach_verified_personal_place_location(uuid, uuid, integer, text, double precision, double precision, text, text, text, text)
    to service_role;

create function public.get_saved_locations(
    scope text default 'all', target_group_id uuid default null,
    center_latitude double precision default null, center_longitude double precision default null,
    radius_meters double precision default null, page_size integer default 200, page_offset integer default 0
)
returns table (
    saved_kind text, saved_id uuid, restaurant_id uuid, group_id uuid, group_name text,
    name text, address text, cuisine text, latitude double precision, longitude double precision,
    resolution_status text, standardized_address text, resolution_accuracy text, distance_meters double precision,
    personal_rating integer, group_average_rating numeric, rated_visit_count bigint, total_visit_count bigint
)
language plpgsql stable security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    center_point extensions.geography;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    if scope is null or scope not in ('all', 'personal', 'group')
        or (scope = 'group' and target_group_id is null)
        or (scope <> 'group' and target_group_id is not null) then
        raise exception 'Choose all, personal, or one group.' using errcode = '22023';
    end if;
    if scope = 'group' and not exists (select 1 from public.group_memberships m
        where m.group_id = target_group_id and m.user_id = actor) then
        raise exception 'Group not found or access denied.' using errcode = '42501';
    end if;
    if (center_latitude is null) <> (center_longitude is null)
        or (center_latitude is not null and not (center_latitude between -90 and 90 and center_longitude between -180 and 180))
        or (radius_meters is not null and (center_latitude is null or not (radius_meters between 0 and 100000)))
        or page_size is null or page_size not between 1 and 1000
        or page_offset is null or page_offset not between 0 and 100000 then
        raise exception 'Check center, radius (0–100000 meters), and pagination.' using errcode = '22023';
    end if;
    if center_latitude is not null then
        center_point := extensions.st_setsrid(extensions.st_makepoint(center_longitude, center_latitude), 4326)::extensions.geography;
    end if;
    -- SECURITY DEFINER requires explicit authorization in BOTH branches. Never
    -- start from the authenticated global Restaurant catalog. One row per group
    -- entry preserves independent ratings and all authorized navigation targets.
    return query
        with saved as (
            select 'personal'::text as kind, p.id as id, null::uuid as restaurant_id,
                null::uuid as group_id, null::text as group_name, p.name, p.address, p.cuisine,
                l.latitude, l.longitude, coalesce(l.resolution_status, 'unresolved') as status,
                l.standardized_address, l.resolution_accuracy, l.location,
                p.rating as personal_rating, null::numeric as average_rating,
                null::bigint as rated_count, null::bigint as visit_count
            from public.personal_places p
            left join public.personal_place_locations l on l.personal_place_id = p.id and l.address_snapshot = p.address
            where p.owner_user_id = actor and scope in ('all', 'personal')
                and (radius_meters is null or extensions.st_dwithin(l.location, center_point, radius_meters))
            union all
            select 'group'::text, gr.id, r.id, g.id, g.name, r.name, r.address, r.cuisine,
                l.latitude, l.longitude, coalesce(l.resolution_status, 'unresolved'),
                l.standardized_address, l.resolution_accuracy, l.location,
                null::integer, ratings.average_rating, ratings.rated_count, ratings.visit_count
            from public.group_memberships m
            join public.groups g on g.id = m.group_id
            join public.group_restaurants gr on gr.group_id = m.group_id
            join public.restaurants r on r.id = gr.restaurant_id
            left join public.group_restaurant_locations l on l.group_restaurant_id = gr.id and l.address_snapshot = r.address
            cross join lateral (
                select avg(v.rating) as average_rating, count(v.rating) as rated_count, count(*) as visit_count
                from public.visits v where v.group_restaurant_id = gr.id
            ) ratings
            where m.user_id = actor and scope in ('all', 'group')
                and (scope <> 'group' or gr.group_id = target_group_id)
                and (radius_meters is null or extensions.st_dwithin(l.location, center_point, radius_meters))
        )
        select s.kind, s.id, s.restaurant_id, s.group_id, s.group_name, s.name, s.address, s.cuisine,
            s.latitude, s.longitude, s.status, s.standardized_address, s.resolution_accuracy,
            case when center_point is not null and s.location is not null then extensions.st_distance(s.location, center_point) end,
            s.personal_rating, s.average_rating, s.rated_count, s.visit_count
        from saved s
        order by case when center_point is not null then extensions.st_distance(s.location, center_point) end nulls last,
            s.kind, s.id
        limit page_size offset page_offset;
end;
$$;
revoke all on function public.get_saved_locations(text, uuid, double precision, double precision, double precision, integer, integer)
    from public, anon, authenticated, service_role;
grant execute on function public.get_saved_locations(text, uuid, double precision, double precision, double precision, integer, integer)
    to authenticated;

commit;
