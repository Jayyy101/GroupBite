begin;

-- Explicit user-selected MapKit points are NOT server-verified Geoapify results.
-- Keep them separate: no weakening of verified-location constraints or grants,
-- no invented provider IDs/building accuracy, no backfill or changes to visits.
create table public.personal_mapkit_locations (
    personal_place_id uuid primary key,
    owner_user_id uuid not null,
    address_snapshot text not null check (char_length(address_snapshot) between 1 and 300),
    latitude double precision not null check (latitude between -90 and 90),
    longitude double precision not null check (longitude between -180 and 180),
    created_at timestamptz not null default clock_timestamp(),
    check (latitude <> 0 or longitude <> 0),
    foreign key (personal_place_id,owner_user_id) references public.personal_places(id,owner_user_id) on delete cascade
);
-- The legacy receipt covers the restaurant/visit payload. This immutable sibling
-- covers coordinates; both commit with the visit and point in ONE transaction.
create table public.personal_mapkit_save_requests (
    user_id uuid not null,
    request_id text not null,
    point_hash text not null check (point_hash ~ '^[0-9a-f]{64}$'),
    primary key(user_id,request_id),
    foreign key(user_id,request_id) references public.add_destination_requests(user_id,request_id) on delete cascade
);
alter table public.personal_mapkit_locations enable row level security;
alter table public.personal_mapkit_save_requests enable row level security;
revoke all on public.personal_mapkit_locations,public.personal_mapkit_save_requests from public,anon,authenticated,service_role;
grant select on public.personal_mapkit_locations to authenticated;
create policy personal_mapkit_locations_read_own on public.personal_mapkit_locations for select to authenticated
    using(owner_user_id=(select auth.uid()));
create trigger immutable_personal_mapkit_receipt before update on public.personal_mapkit_save_requests
    for each row execute function public.reject_add_receipt_update();

create function public.validate_mapkit_point(selected_latitude double precision,selected_longitude double precision)
returns void language plpgsql immutable set search_path='' as $$
begin
    if selected_latitude is null or selected_longitude is null
        or not (selected_latitude between -90 and 90 and selected_longitude between -180 and 180)
        or (selected_latitude=0 and selected_longitude=0) then
        raise exception 'Select a valid restaurant location.' using errcode='22023';
    end if;
end;
$$;
revoke all on function public.validate_mapkit_point(double precision,double precision) from public,anon,authenticated,service_role;

-- Location-only repair: exact owner/card/revision/address; no visit, restaurant
-- creation, Apple identity change, parent revision bump or overwrite of a point.
create function public.set_personal_mapkit_location(target_personal_place_id uuid,expected_revision integer,
    expected_address text,selected_latitude double precision,selected_longitude double precision)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); saved public.personal_places;
begin
    if actor is null then raise exception 'Sign in first.' using errcode='42501'; end if;
    perform public.validate_mapkit_point(selected_latitude,selected_longitude);
    perform 1 from public.profiles where id=actor for no key update;
    select * into saved from public.personal_places where id=target_personal_place_id and owner_user_id=actor for update;
    if not found then raise exception 'Personal Place not found or access denied.' using errcode='42501'; end if;
    if expected_revision is distinct from saved.revision or expected_address is distinct from saved.address then
        raise exception 'The Personal Place changed. Select its location again.' using errcode='40001';
    end if;
    -- First-resolution-wins, including existing backend-verified location rows.
    if exists(select 1 from public.personal_place_locations l where l.personal_place_id=saved.id
        and l.address_snapshot=saved.address and l.resolution_status='resolved') then return false; end if;
    insert into public.personal_mapkit_locations(personal_place_id,owner_user_id,address_snapshot,latitude,longitude)
        values(saved.id,actor,saved.address,selected_latitude,selected_longitude)
        on conflict(personal_place_id) do nothing;
    return found;
end;
$$;

create function public.save_personal_visit_with_mapkit_point(client_request_id text,restaurant_name text,restaurant_address text,
    restaurant_cuisine text,visit_date date,visit_rating integer,visit_would_go_again boolean,visit_notes text,
    restaurant_apple_place_id text,target_entry_id uuid,selected_latitude double precision,selected_longitude double precision)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); point_fingerprint text; prior_hash text; had_receipt boolean; saved public.personal_places; saved_id uuid;
begin
    if actor is null then raise exception 'Sign in first.' using errcode='42501'; end if;
    if current_setting('transaction_isolation')<>'read committed' then
        raise exception 'Saves require READ COMMITTED.' using errcode='25001'; end if;
    perform public.validate_mapkit_point(selected_latitude,selected_longitude);
    perform 1 from public.profiles where id=actor for no key update;
    point_fingerprint:=encode(extensions.digest(jsonb_build_array(selected_latitude,selected_longitude)::text,'sha256'),'hex');
    select exists(select 1 from public.add_destination_requests r where r.user_id=actor and r.request_id=client_request_id) into had_receipt;
    select point_hash into prior_hash from public.personal_mapkit_save_requests r where r.user_id=actor and r.request_id=client_request_id;
    if had_receipt and prior_hash is distinct from point_fingerprint then
        raise exception 'Request location changed.' using errcode='22023'; end if;
    -- Reuse the original identity resolution, frozen payload fingerprint, locks,
    -- visit creation and same-transaction receipt. No caught intermediate errors.
    saved_id:=public.save_personal_visit(client_request_id,restaurant_name,restaurant_address,restaurant_cuisine,
        visit_date,visit_rating,visit_would_go_again,visit_notes,restaurant_apple_place_id,target_entry_id);
    if had_receipt then return saved_id; end if; -- never resurrect a deleted target
    select * into saved from public.personal_places where id=saved_id and owner_user_id=actor for update;
    perform public.set_personal_mapkit_location(saved.id,saved.revision,saved.address,selected_latitude,selected_longitude);
    insert into public.personal_mapkit_save_requests(user_id,request_id,point_hash) values(actor,client_request_id,point_fingerprint);
    return saved_id;
end;
$$;

create function public.get_personal_mapkit_locations(page_size integer default 200,page_offset integer default 0)
returns table(id uuid,owner_user_id uuid,name text,address text,latitude double precision,longitude double precision)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
    if actor is null then raise exception 'Sign in first.' using errcode='42501'; end if;
    if page_size is null or page_size not between 1 and 1000 or page_offset is null or page_offset not between 0 and 100000 then
        raise exception 'Invalid pagination.' using errcode='22023'; end if;
    return query select p.id,p.owner_user_id,p.name,p.address,l.latitude,l.longitude
        from public.personal_places p join public.personal_mapkit_locations l
            on l.personal_place_id=p.id and l.owner_user_id=p.owner_user_id and l.address_snapshot=p.address
        where p.owner_user_id=actor order by p.id limit page_size offset page_offset;
end;
$$;

create function public.invalidate_personal_mapkit_location() returns trigger
language plpgsql security definer set search_path='' as $$
begin
    if new.address is distinct from old.address then
        delete from public.personal_mapkit_locations where personal_place_id=new.id;
    end if;
    return new;
end;
$$;
revoke all on function public.invalidate_personal_mapkit_location() from public,anon,authenticated,service_role;
create trigger invalidate_personal_mapkit_location after update of address on public.personal_places
    for each row execute function public.invalidate_personal_mapkit_location();

revoke all on function public.set_personal_mapkit_location(uuid,integer,text,double precision,double precision),
    public.save_personal_visit_with_mapkit_point(text,text,text,text,date,integer,boolean,text,text,uuid,double precision,double precision),
    public.get_personal_mapkit_locations(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.set_personal_mapkit_location(uuid,integer,text,double precision,double precision),
    public.save_personal_visit_with_mapkit_point(text,text,text,text,date,integer,boolean,text,text,uuid,double precision,double precision),
    public.get_personal_mapkit_locations(integer,integer) to authenticated;
commit;
