begin;

-- Forward only. Existing cards, values, IDs and provider locations are retained.
alter table public.personal_places add constraint personal_places_id_owner_key unique (id, owner_user_id);
create index personal_places_identity_idx on public.personal_places(owner_user_id, name, address);
create index personal_places_apple_identity_idx on public.personal_places(owner_user_id, apple_place_id)
    where apple_place_id is not null;

create table public.personal_visits (
    id uuid primary key default gen_random_uuid(),
    personal_place_id uuid not null,
    owner_user_id uuid not null references public.profiles(id) on delete cascade,
    visited_on date check (visited_on between date '0001-01-01' and date '9999-12-31'),
    rating integer check (rating between 1 and 5),
    would_go_again boolean,
    notes text check (notes = nullif(btrim(notes), '') and char_length(notes) between 1 and 4000),
    origin text not null default 'visit' check (origin in ('visit', 'legacy')),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    revision integer not null default 1 check (revision > 0),
    foreign key (personal_place_id, owner_user_id) references public.personal_places(id, owner_user_id) on delete cascade
);
create index personal_visits_place_created_idx on public.personal_visits(personal_place_id, created_at desc, id);

-- A legacy saved memory is not evidence of its visit date. Do not infer one, or
-- manufacture a visit for a card without any memory values. No merging/deletion.
insert into public.personal_visits(id, personal_place_id, owner_user_id, visited_on, rating,
    would_go_again, notes, origin, created_at, updated_at)
select id, id, owner_user_id, visited_on, rating, would_go_again, notes, 'legacy', created_at, updated_at
from public.personal_places
where visited_on is not null or rating is not null or would_go_again is not null or notes is not null;

-- Complete receipts are inserted in the SAME transaction as their destination's
-- entry and visit. Historical IDs deliberately have no entry/group/visit FK:
-- deleting/recreating a card must never retarget or erase proof of an old save.
create table public.add_destination_requests (
    user_id uuid not null references public.profiles(id) on delete cascade,
    request_id text not null check (char_length(request_id) between 1 and 100),
    payload_hash text not null,
    destination_kind text not null check (destination_kind in ('personal', 'group')),
    group_id uuid,
    entry_id uuid not null,
    visit_id uuid not null,
    created_at timestamptz not null default clock_timestamp(),
    primary key (user_id, request_id),
    check ((destination_kind = 'personal' and group_id is null) or (destination_kind = 'group' and group_id is not null))
);
alter table public.personal_visits enable row level security;
alter table public.add_destination_requests enable row level security;
revoke all on public.personal_visits, public.add_destination_requests from public, anon, authenticated, service_role;
grant select on public.personal_visits to authenticated;
create policy personal_visits_read_own on public.personal_visits for select to authenticated
    using (owner_user_id = (select auth.uid()));

create function public.reject_add_receipt_update() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Save receipts are immutable.' using errcode = '42501'; end;
$$;
create trigger immutable_add_receipt before update on public.add_destination_requests
    for each row execute function public.reject_add_receipt_update();

create function public.prepare_personal_visit() returns trigger
language plpgsql set search_path = '' as $$
begin
    new.notes := nullif(btrim(new.notes), '');
    if tg_op = 'UPDATE' then
        new.revision := old.revision + 1;
        new.updated_at := clock_timestamp();
    end if;
    return new;
end;
$$;
create trigger prepare_personal_visit before insert or update on public.personal_visits
    for each row execute function public.prepare_personal_visit();

-- Old columns remain a private latest-memory projection for existing readers,
-- including get_saved_locations. History is authoritative. Bump the card's
-- revision even on an older visit edit, so stale whole-card deletes fail safely.
create function public.refresh_personal_place_memory() returns trigger
language plpgsql security definer set search_path = '' as $$
declare place_id uuid; latest public.personal_visits;
begin
    if tg_op = 'DELETE' then place_id := old.personal_place_id; else place_id := new.personal_place_id; end if;
    select * into latest from public.personal_visits v where v.personal_place_id = place_id
        order by v.created_at desc, v.id desc limit 1;
    update public.personal_places set visited_on = latest.visited_on, rating = latest.rating,
        would_go_again = latest.would_go_again, notes = latest.notes where id = place_id;
    return null;
end;
$$;
create trigger refresh_personal_place_memory after insert or update or delete on public.personal_visits
    for each row execute function public.refresh_personal_place_memory();

create function public.validate_add_visit(restaurant_name text, restaurant_address text, restaurant_cuisine text,
    restaurant_apple_place_id text, visit_date date, visit_rating integer, visit_notes text)
returns void language plpgsql immutable set search_path = '' as $$
begin
    if restaurant_name is null or char_length(btrim(restaurant_name)) not between 1 and 100
        or restaurant_address is null or char_length(btrim(restaurant_address)) not between 1 and 300
        or char_length(nullif(btrim(restaurant_cuisine), '')) > 100
        or char_length(nullif(btrim(visit_notes), '')) > 4000
        or (visit_rating is not null and visit_rating not between 1 and 5)
        or (visit_date is not null and not (visit_date between date '0001-01-01' and date '9999-12-31')) then
        raise exception 'Check the restaurant and visit fields.' using errcode = '22023';
    end if;
    if restaurant_apple_place_id is not null and not (
        char_length(restaurant_apple_place_id) between 1 and 300
        and restaurant_apple_place_id collate "C" = btrim(restaurant_apple_place_id,
            U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
        and restaurant_apple_place_id collate "C" !~ U&'[\0001-\001F\007F-\009F]') then
        raise exception 'Enter a valid Apple Place ID.' using errcode = '22023';
    end if;
end;
$$;

create function public.save_personal_visit(client_request_id text, restaurant_name text, restaurant_address text,
    restaurant_cuisine text default null, visit_date date default null, visit_rating integer default null,
    visit_would_go_again boolean default null, visit_notes text default null,
    restaurant_apple_place_id text default null, target_entry_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    actor uuid := auth.uid(); saved public.personal_places; receipt public.add_destination_requests;
    fingerprint text; matches integer; saved_visit_id uuid;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'Saves require READ COMMITTED.' using errcode = '25001'; end if;
    perform public.validate_add_visit(restaurant_name, restaurant_address, restaurant_cuisine,
        restaurant_apple_place_id, visit_date, visit_rating, visit_notes);
    if client_request_id is null or char_length(client_request_id) not between 1 and 100 then
        raise exception 'A save request ID is required.' using errcode = '22023'; end if;
    fingerprint := encode(extensions.digest(jsonb_build_object('kind','personal','entry',target_entry_id,
        'name',btrim(restaurant_name),'address',btrim(restaurant_address),'cuisine',nullif(btrim(restaurant_cuisine),''),
        'apple',restaurant_apple_place_id,'date',visit_date,'rating',visit_rating,'again',visit_would_go_again,
        'notes',nullif(btrim(visit_notes),''))::text,'sha256'),'hex');
    -- Serialize this owner's identity resolution, including absent-card races.
    -- NO KEY UPDATE permits the FK KEY SHARE locks used by unrelated group saves.
    perform 1 from public.profiles where id = actor for no key update;
    select * into receipt from public.add_destination_requests where user_id = actor and request_id = client_request_id;
    if found then
        if receipt.payload_hash <> fingerprint then raise exception 'Request payload changed.' using errcode = '22023'; end if;
        return receipt.entry_id;
    end if;
    if target_entry_id is not null then
        select * into saved from public.personal_places where id = target_entry_id and owner_user_id = actor for update;
        if not found then raise exception 'Personal Place not found or access denied.' using errcode = '42501'; end if;
        if saved.name <> btrim(restaurant_name) or saved.address <> btrim(restaurant_address) then
            raise exception 'Restaurant changed. Select it again.' using errcode = '40001'; end if;
    else
        if restaurant_apple_place_id is not null and exists (select 1 from public.personal_places p
            where p.owner_user_id = actor and p.apple_place_id = restaurant_apple_place_id
                and p.address <> btrim(restaurant_address)) then
            raise exception 'Conflicting restaurant location. Review My Places.' using errcode = '22023'; end if;
        select count(*) into matches from public.personal_places p where p.owner_user_id = actor and
            ((restaurant_apple_place_id is not null and p.apple_place_id = restaurant_apple_place_id and p.address = btrim(restaurant_address))
            or (p.name = btrim(restaurant_name) and p.address = btrim(restaurant_address)));
        if matches > 1 then raise exception 'Multiple matching cards. Select an existing card.' using errcode = '22023'; end if;
        select * into saved from public.personal_places p where p.owner_user_id = actor and
            ((restaurant_apple_place_id is not null and p.apple_place_id = restaurant_apple_place_id and p.address = btrim(restaurant_address))
            or (p.name = btrim(restaurant_name) and p.address = btrim(restaurant_address))) for update;
    end if;
    if saved.id is not null and restaurant_apple_place_id is not null and saved.apple_place_id is not null
        and saved.apple_place_id <> restaurant_apple_place_id then
        raise exception 'Conflicting Apple identity. Select the restaurant again.' using errcode = '22023'; end if;
    if saved.id is null then
        insert into public.personal_places(owner_user_id,name,address,cuisine,client_request_id,apple_place_id)
        values(actor,btrim(restaurant_name),btrim(restaurant_address),nullif(btrim(restaurant_cuisine),''),
            'm18:' || client_request_id,restaurant_apple_place_id) returning * into saved;
    end if;
    -- Existing personal Apple references stay creation-only, as in Milestone 16C.
    insert into public.personal_visits(personal_place_id,owner_user_id,visited_on,rating,would_go_again,notes)
    values(saved.id,actor,visit_date,visit_rating,visit_would_go_again,nullif(btrim(visit_notes),'')) returning id into saved_visit_id;
    insert into public.add_destination_requests(user_id,request_id,payload_hash,destination_kind,entry_id,visit_id)
        values(actor,client_request_id,fingerprint,'personal',saved.id,saved_visit_id);
    return saved.id;
end;
$$;

create function public.update_personal_place(target_personal_place_id uuid, expected_revision integer,
    restaurant_name text, restaurant_address text, restaurant_cuisine text default null)
returns setof public.personal_places language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    perform public.validate_add_visit(restaurant_name,restaurant_address,restaurant_cuisine,null,null,null,null);
    perform 1 from public.profiles where id = actor for no key update;
    if exists(select 1 from public.personal_places p where p.owner_user_id = actor and p.id <> target_personal_place_id
        and p.name = btrim(restaurant_name) and p.address = btrim(restaurant_address)) then
        raise exception 'Another saved restaurant has these facts. Review My Places.' using errcode = '22023'; end if;
    return query update public.personal_places set name = btrim(restaurant_name), address = btrim(restaurant_address),
        cuisine = nullif(btrim(restaurant_cuisine),'')
        where id = target_personal_place_id and owner_user_id = actor and revision = expected_revision returning *;
end;
$$;
create function public.delete_personal_place(target_personal_place_id uuid, expected_revision integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    perform 1 from public.profiles where id = actor for no key update;
    delete from public.personal_places where id = target_personal_place_id and owner_user_id = actor and revision = expected_revision;
    return found;
end;
$$;
create function public.manage_personal_visit(target_personal_place_id uuid, target_visit_id uuid,
    expected_revision integer, remove_visit boolean, visit_date date default null, visit_rating integer default null,
    visit_would_go_again boolean default null, visit_notes text default null)
returns setof public.personal_visits language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    if remove_visit is null then raise exception 'Choose an action.' using errcode = '22023'; end if;
    perform public.validate_add_visit('visit','visit',null,null,visit_date,visit_rating,visit_notes);
    perform 1 from public.profiles where id = actor for no key update;
    perform 1 from public.personal_places where id = target_personal_place_id and owner_user_id = actor for update;
    if not found then raise exception 'Personal Place not found or access denied.' using errcode = '42501'; end if;
    if remove_visit then
        return query delete from public.personal_visits where id = target_visit_id and personal_place_id = target_personal_place_id
            and owner_user_id = actor and revision = expected_revision returning *;
    else
        return query update public.personal_visits set visited_on = visit_date, rating = visit_rating,
            would_go_again = visit_would_go_again, notes = nullif(btrim(visit_notes),'')
            where id = target_visit_id and personal_place_id = target_personal_place_id and owner_user_id = actor
                and revision = expected_revision returning *;
    end if;
end;
$$;

-- Deliberate cutover: older binaries cannot bypass history or duplicate-card
-- protection. Explicit column revocation is required in addition to table ACLs.
revoke insert, update, delete on public.personal_places from public, anon, authenticated;
revoke insert (name,address,cuisine,visited_on,rating,would_go_again,notes,client_request_id,apple_place_id),
    update (name,address,cuisine,visited_on,rating,would_go_again,notes) on public.personal_places from authenticated;
revoke all on function public.reject_add_receipt_update(), public.prepare_personal_visit(),
    public.refresh_personal_place_memory(), public.validate_add_visit(text,text,text,text,date,integer,text),
    public.save_personal_visit(text,text,text,text,date,integer,boolean,text,text,uuid),
    public.update_personal_place(uuid,integer,text,text,text), public.delete_personal_place(uuid,integer),
    public.manage_personal_visit(uuid,uuid,integer,boolean,date,integer,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.save_personal_visit(text,text,text,text,date,integer,boolean,text,text,uuid),
    public.update_personal_place(uuid,integer,text,text,text), public.delete_personal_place(uuid,integer),
    public.manage_personal_visit(uuid,uuid,integer,boolean,date,integer,boolean,text) to authenticated;
commit;
