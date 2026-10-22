begin;

-- Selected Apple facts stay separate from server-verified Geoapify locations.
-- No backfill, parent-card revision change, or alteration of old RPC contracts.
create function public.normalize_mapkit_address(value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare field text; part text; result jsonb := '{}'::jsonb; max_length integer;
begin
    if value is null or value = 'null'::jsonb then return null; end if;
    if jsonb_typeof(value) <> 'object' then
        raise exception 'Invalid Apple Maps address details.' using errcode='22023'; end if;
    if exists(select 1 from jsonb_object_keys(value) k where k not in ('street','city','region','postal_code','country','country_code')) then
        raise exception 'Invalid Apple Maps address details.' using errcode='22023'; end if;
    foreach field in array array['street','city','region','postal_code','country','country_code'] loop
        if value ? field and jsonb_typeof(value->field) not in ('string','null') then
            raise exception 'Invalid Apple Maps address details.' using errcode='22023'; end if;
        part := value->>field;
        max_length := case field when 'street' then 300 when 'postal_code' then 50 when 'country_code' then 2 else 200 end;
        if part is not null and (char_length(part)>max_length or part collate "C" ~ U&'[\0001-\001F\007F-\009F]'
            or part <> btrim(part,U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
            or part='' or (field='country_code' and part collate "C" !~ '^[A-Z]{2}$')) then
            raise exception 'Invalid Apple Maps address details.' using errcode='22023'; end if;
        result := result || jsonb_build_object(field,part);
    end loop;
    if jsonb_strip_nulls(result)='{}'::jsonb then return null; end if;
    return result;
end;
$$;

alter table public.personal_mapkit_locations add column structured_address jsonb,
    add constraint personal_mapkit_address_check check (structured_address is not distinct from public.normalize_mapkit_address(structured_address));
create table public.group_mapkit_locations (
    group_restaurant_id uuid primary key references public.group_restaurants(id) on delete cascade,
    address_snapshot text not null check (char_length(address_snapshot) between 1 and 300),
    latitude double precision not null check (latitude between -90 and 90),
    longitude double precision not null check (longitude between -180 and 180),
    structured_address jsonb check (structured_address is not distinct from public.normalize_mapkit_address(structured_address)),
    created_at timestamptz not null default clock_timestamp(),
    check (latitude<>0 or longitude<>0)
);
-- Immutable proof supplements (rather than changing) existing receipt hashes.
create table public.mapkit_location_save_requests (
    user_id uuid not null, request_id text not null,
    location_hash text not null check (location_hash ~ '^[0-9a-f]{64}$'),
    primary key(user_id,request_id),
    foreign key(user_id,request_id) references public.add_destination_requests(user_id,request_id) on delete cascade
);
alter table public.group_mapkit_locations enable row level security;
alter table public.mapkit_location_save_requests enable row level security;
revoke all on public.group_mapkit_locations,public.mapkit_location_save_requests from public,anon,authenticated,service_role;
grant select on public.group_mapkit_locations to authenticated;
create policy group_mapkit_locations_read_member on public.group_mapkit_locations for select to authenticated
    using(exists(select 1 from public.group_restaurants gr join public.group_memberships m on m.group_id=gr.group_id
        where gr.id=group_restaurant_id and m.user_id=(select auth.uid())));
create trigger immutable_mapkit_location_receipt before update on public.mapkit_location_save_requests
    for each row execute function public.reject_add_receipt_update();

-- First selection wins. Missing components may be filled without replacing any
-- known fact. A conflicting selected snapshot rejects the entire destination.
create function public.merge_mapkit_address(saved_latitude double precision,saved_longitude double precision,saved_address jsonb,
    selected_latitude double precision,selected_longitude double precision,selected_address jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare field text;
begin
    if saved_latitude is distinct from selected_latitude or saved_longitude is distinct from selected_longitude then
        raise exception 'Apple Maps location already saved. Choose the saved restaurant.' using errcode='GB001'; end if;
    for field in select jsonb_object_keys(selected_address) loop
        if saved_address->>field is not null and selected_address->>field is not null
            and saved_address->>field <> selected_address->>field then
            raise exception 'Apple Maps address details conflict. Choose the saved restaurant.' using errcode='GB001'; end if;
    end loop;
    return public.normalize_mapkit_address(coalesce(saved_address,'{}'::jsonb)||coalesce(jsonb_strip_nulls(selected_address),'{}'::jsonb));
end;
$$;

create function public.save_personal_visit_with_mapkit_location(client_request_id text,restaurant_name text,restaurant_address text,
    restaurant_cuisine text,visit_date date,visit_rating integer,visit_would_go_again boolean,visit_notes text,
    restaurant_apple_place_id text,target_entry_id uuid,selected_latitude double precision,selected_longitude double precision,
    selected_address jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); details jsonb; fingerprint text; had_receipt boolean; prior_hash text; saved_id uuid;
begin
    if actor is null then raise exception 'Sign in first.' using errcode='42501'; end if;
    if current_setting('transaction_isolation')<>'read committed' then
        raise exception 'Saves require READ COMMITTED.' using errcode='25001'; end if;
    perform public.validate_mapkit_point(selected_latitude,selected_longitude);
    details:=public.normalize_mapkit_address(selected_address);
    perform 1 from public.profiles where id=actor for no key update;
    fingerprint:=encode(extensions.digest(jsonb_build_array(selected_latitude,selected_longitude,details)::text,'sha256'),'hex');
    select exists(select 1 from public.add_destination_requests r where r.user_id=actor and r.request_id=client_request_id) into had_receipt;
    select location_hash into prior_hash from public.mapkit_location_save_requests r where r.user_id=actor and r.request_id=client_request_id;
    if had_receipt and prior_hash is distinct from fingerprint then
        raise exception 'Request location changed.' using errcode='22023'; end if;
    -- Reuse the old point proof as well, preserving retries through older clients.
    saved_id:=public.save_personal_visit_with_mapkit_point(client_request_id,restaurant_name,restaurant_address,restaurant_cuisine,
        visit_date,visit_rating,visit_would_go_again,visit_notes,restaurant_apple_place_id,target_entry_id,selected_latitude,selected_longitude);
    if had_receipt then return saved_id; end if; -- Never resurrect deleted/invalidated metadata.
    -- Store selected facts even when a separate Geoapify point already exists;
    -- verified metadata and the existing map's preference remain untouched.
    insert into public.personal_mapkit_locations(personal_place_id,owner_user_id,address_snapshot,latitude,longitude,structured_address)
        values(saved_id,actor,btrim(restaurant_address),selected_latitude,selected_longitude,details)
        on conflict(personal_place_id) do update set structured_address=public.merge_mapkit_address(
            personal_mapkit_locations.latitude,personal_mapkit_locations.longitude,personal_mapkit_locations.structured_address,
            excluded.latitude,excluded.longitude,excluded.structured_address);
    insert into public.mapkit_location_save_requests values(actor,client_request_id,fingerprint);
    return saved_id;
end;
$$;

create function public.save_group_visit_with_mapkit_location(client_request_id text,target_group_id uuid,
    restaurant_name text,restaurant_address text,restaurant_cuisine text,visit_date date,visit_rating integer,
    visit_would_go_again boolean,visit_notes text,restaurant_apple_place_id text,target_entry_id uuid,
    expected_membership_id uuid,selected_latitude double precision,selected_longitude double precision,selected_address jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); details jsonb; fingerprint text; had_receipt boolean; prior_hash text; saved_id uuid;
    existing_ids uuid[]; old public.group_mapkit_locations; merged jsonb; is_owner boolean;
begin
    if actor is null then raise exception 'Sign in first.' using errcode='42501'; end if;
    if current_setting('transaction_isolation')<>'read committed' then
        raise exception 'Saves require READ COMMITTED.' using errcode='25001'; end if;
    perform public.validate_mapkit_point(selected_latitude,selected_longitude);
    details:=public.normalize_mapkit_address(selected_address);
    -- Keep group -> Restaurant -> entry lock ordering and admission checks.
    select owner_user_id=actor into is_owner from public.groups where id=target_group_id for update;
    if not found or not exists(select 1 from public.group_memberships m where m.group_id=target_group_id
        and m.user_id=actor and m.membership_id=expected_membership_id) then
        raise exception 'Group membership changed. Refresh before saving.' using errcode='42501'; end if;
    fingerprint:=encode(extensions.digest(jsonb_build_array(selected_latitude,selected_longitude,details)::text,'sha256'),'hex');
    select exists(select 1 from public.add_destination_requests r where r.user_id=actor and r.request_id=client_request_id) into had_receipt;
    select location_hash into prior_hash from public.mapkit_location_save_requests r where r.user_id=actor and r.request_id=client_request_id;
    if had_receipt and prior_hash is distinct from fingerprint then
        raise exception 'Request location changed.' using errcode='22023'; end if;
    select coalesce(array_agg(gr.id),'{}'::uuid[]) into existing_ids from public.group_restaurants gr where gr.group_id=target_group_id;
    saved_id:=public.save_group_visit_destination(client_request_id,target_group_id,restaurant_name,restaurant_address,restaurant_cuisine,
        visit_date,visit_rating,visit_would_go_again,visit_notes,restaurant_apple_place_id,target_entry_id,expected_membership_id);
    if had_receipt then return saved_id; end if;
    select * into old from public.group_mapkit_locations where group_restaurant_id=saved_id;
    if found then
        merged:=public.merge_mapkit_address(old.latitude,old.longitude,old.structured_address,selected_latitude,selected_longitude,details);
        if not is_owner and merged is distinct from old.structured_address then
            raise exception 'Only the Owner may enrich an existing restaurant.' using errcode='GB002'; end if;
        if merged is distinct from old.structured_address then
            update public.group_mapkit_locations set structured_address=merged where group_restaurant_id=saved_id; end if;
    else
        if saved_id=any(existing_ids) and not is_owner then
            raise exception 'Only the Owner may enrich an existing restaurant.' using errcode='GB002'; end if;
        insert into public.group_mapkit_locations(group_restaurant_id,address_snapshot,latitude,longitude,structured_address)
            values(saved_id,btrim(restaurant_address),selected_latitude,selected_longitude,details);
    end if;
    insert into public.mapkit_location_save_requests values(actor,client_request_id,fingerprint);
    return saved_id;
end;
$$;

-- Personal address invalidation already deletes its entire MapKit row. Add the
-- matching group trigger without changing legacy Geoapify/Apple-ID triggers.
create function public.invalidate_group_mapkit_location() returns trigger
language plpgsql security definer set search_path='' as $$
begin
    if new.address is distinct from old.address then
        delete from public.group_mapkit_locations l using public.group_restaurants gr
            where l.group_restaurant_id=gr.id and gr.restaurant_id=new.id;
    end if;
    return new;
end;
$$;
create trigger invalidate_group_mapkit_location after update of address on public.restaurants
    for each row execute function public.invalidate_group_mapkit_location();

-- Keep the development-only, location-only repair's exact owner/revision/address
-- and first-resolution-wins behavior while retaining a new native selection.
create function public.set_personal_mapkit_location_with_address(target_personal_place_id uuid,expected_revision integer,
    expected_address text,selected_latitude double precision,selected_longitude double precision,selected_address jsonb default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare details jsonb; added boolean;
begin
    if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
    details:=public.normalize_mapkit_address(selected_address);
    added:=public.set_personal_mapkit_location(target_personal_place_id,expected_revision,expected_address,selected_latitude,selected_longitude);
    if added then update public.personal_mapkit_locations set structured_address=details where personal_place_id=target_personal_place_id; end if;
    return added;
end;
$$;

-- Current authorized facts only. Used when adding another visit/from recents;
-- raw Apple selections never enter route parameters or recovery storage.
create function public.get_saved_mapkit_location(target_kind text,target_entry_id uuid,expected_address text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
    if actor is null then raise exception 'Sign in first.' using errcode='42501'; end if;
    if target_kind='personal' then
        if not exists(select 1 from public.personal_places p where p.id=target_entry_id and p.owner_user_id=actor and p.address=expected_address) then
            raise exception 'Saved restaurant changed or unavailable.' using errcode='42501'; end if;
        select jsonb_build_object('name',p.name,'address',p.address,'latitude',l.latitude,'longitude',l.longitude,'structured_address',l.structured_address)
            into result from public.personal_places p join public.personal_mapkit_locations l on l.personal_place_id=p.id
            and l.owner_user_id=p.owner_user_id and l.address_snapshot=p.address where p.id=target_entry_id and p.owner_user_id=actor;
    elsif target_kind='group' then
        if not exists(select 1 from public.group_restaurants gr join public.restaurants r on r.id=gr.restaurant_id
            join public.group_memberships m on m.group_id=gr.group_id and m.user_id=actor where gr.id=target_entry_id and r.address=expected_address) then
            raise exception 'Saved restaurant changed or unavailable.' using errcode='42501'; end if;
        select jsonb_build_object('name',r.name,'address',r.address,'latitude',l.latitude,'longitude',l.longitude,'structured_address',l.structured_address)
            into result from public.group_restaurants gr join public.restaurants r on r.id=gr.restaurant_id
            join public.group_memberships m on m.group_id=gr.group_id and m.user_id=actor
            join public.group_mapkit_locations l on l.group_restaurant_id=gr.id and l.address_snapshot=r.address where gr.id=target_entry_id;
    else raise exception 'Invalid destination.' using errcode='22023'; end if;
    return result;
end;
$$;
create function public.get_recent_add_restaurants_with_mapkit(page_size integer default 12,page_offset integer default 0)
returns table(destination_kind text,group_id uuid,entry_id uuid,name text,address text,cuisine text,apple_place_id text,mapkit_point jsonb)
language sql stable security definer set search_path='' as $$
    select r.*,public.get_saved_mapkit_location(r.destination_kind,r.entry_id,r.address)
        from public.get_recent_add_restaurants(page_size,page_offset) r;
$$;

revoke all on function public.normalize_mapkit_address(jsonb),
    public.merge_mapkit_address(double precision,double precision,jsonb,double precision,double precision,jsonb),
    public.invalidate_group_mapkit_location(),
    public.set_personal_mapkit_location_with_address(uuid,integer,text,double precision,double precision,jsonb),
    public.save_personal_visit_with_mapkit_location(text,text,text,text,date,integer,boolean,text,text,uuid,double precision,double precision,jsonb),
    public.save_group_visit_with_mapkit_location(text,uuid,text,text,text,date,integer,boolean,text,text,uuid,uuid,double precision,double precision,jsonb),
    public.get_saved_mapkit_location(text,uuid,text),public.get_recent_add_restaurants_with_mapkit(integer,integer)
    from public,anon,authenticated,service_role;
grant execute on function
    public.set_personal_mapkit_location_with_address(uuid,integer,text,double precision,double precision,jsonb),
    public.save_personal_visit_with_mapkit_location(text,text,text,text,date,integer,boolean,text,text,uuid,double precision,double precision,jsonb),
    public.save_group_visit_with_mapkit_location(text,uuid,text,text,text,date,integer,boolean,text,text,uuid,uuid,double precision,double precision,jsonb),
    public.get_saved_mapkit_location(text,uuid,text),public.get_recent_add_restaurants_with_mapkit(integer,integer) to authenticated;

commit;
