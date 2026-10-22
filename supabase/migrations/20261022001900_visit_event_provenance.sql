begin;

-- Supplemental private proof only. Existing visits, receipts, hashes, RPCs,
-- permissions and recovery reads are deliberately left intact. No backfill.
create table public.visit_events (
    user_id uuid not null references public.profiles(id) on delete cascade,
    event_id text not null check (event_id ~ '^[a-zA-Z0-9-]{1,100}$'),
    event_hash text not null,
    created_at timestamptz not null default clock_timestamp(),
    primary key(user_id,event_id)
);
create table public.visit_event_destinations (
    user_id uuid not null, request_id text not null, event_id text not null,
    destination_key text not null,
    primary key(user_id,request_id),
    unique(user_id,event_id,destination_key),
    foreign key(user_id,event_id) references public.visit_events(user_id,event_id) on delete cascade,
    foreign key(user_id,request_id) references public.add_destination_requests(user_id,request_id) on delete cascade
);
alter table public.visit_events enable row level security;
alter table public.visit_event_destinations enable row level security;
revoke all on public.visit_events,public.visit_event_destinations from public,anon,authenticated,service_role;
create trigger immutable_visit_event before update on public.visit_events
    for each row execute function public.reject_add_receipt_update();
create trigger immutable_visit_event_destination before update on public.visit_event_destinations
    for each row execute function public.reject_add_receipt_update();

create function public.save_visit_event_destination(client_event_id text,client_request_id text,destination_kind text,
    restaurant_name text,restaurant_address text,restaurant_cuisine text default null,
    visit_date date default null,visit_rating integer default null,visit_would_go_again boolean default null,
    visit_notes text default null,restaurant_apple_place_id text default null,target_entry_id uuid default null,
    target_group_id uuid default null,expected_membership_id uuid default null,
    selected_latitude double precision default null,selected_longitude double precision default null,selected_address jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); fingerprint text; saved_hash text; linked_event text; scope_key text;
    saved_id uuid; receipt public.add_destination_requests;
begin
    if actor is null then raise exception 'Sign in first.' using errcode='42501'; end if;
    if current_setting('transaction_isolation')<>'read committed' then
        raise exception 'Saves require READ COMMITTED.' using errcode='25001'; end if;
    if client_event_id is null or client_event_id !~ '^[a-zA-Z0-9-]{1,100}$'
        or client_request_id is null or char_length(client_request_id) not between 1 and 100
        or destination_kind is null or destination_kind not in ('personal','group')
        or (destination_kind='personal' and (target_group_id is not null or expected_membership_id is not null))
        or (destination_kind='group' and (target_group_id is null or expected_membership_id is null))
        or (selected_latitude is null)<>(selected_longitude is null)
        or (selected_latitude is null and selected_address is not null) then
        raise exception 'Invalid visit event destination.' using errcode='22023'; end if;
    perform public.validate_add_visit(restaurant_name,restaurant_address,restaurant_cuisine,
        restaurant_apple_place_id,visit_date,visit_rating,visit_notes);
    -- Acquire the SAME destination lock as every legacy writer BEFORE reading
    -- receipt eligibility or creating the event. Under READ COMMITTED a legacy
    -- writer that wins this lock must commit/roll back before the receipt check.
    -- Keep destination -> event ordering: the delegated writer reacquires its
    -- own lock, and unrelated personal/group FK KEY SHARE locks stay compatible.
    if destination_kind='personal' then
        perform 1 from public.profiles where id=actor for no key update;
        if not found then raise exception 'Account not found.' using errcode='42501'; end if;
    else
        perform 1 from public.groups where id=target_group_id for update;
        if not found or not exists(select 1 from public.group_memberships m where m.group_id=target_group_id
            and m.user_id=actor and m.membership_id=expected_membership_id) then
            raise exception 'Group membership changed. Refresh before saving.' using errcode='42501'; end if;
    end if;
    -- Only common initial facts, never destination notes, enter this event hash.
    -- Later destination edits remain independent and do not rewrite provenance.
    fingerprint:=encode(extensions.digest(jsonb_build_array(btrim(restaurant_name),btrim(restaurant_address),visit_date)::text,'sha256'),'hex');
    insert into public.visit_events(user_id,event_id,event_hash) values(actor,client_event_id,fingerprint)
        on conflict(user_id,event_id) do nothing;
    select e.event_hash into strict saved_hash from public.visit_events e
        where e.user_id=actor and e.event_id=client_event_id for update;
    if saved_hash<>fingerprint then raise exception 'Visit event facts changed.' using errcode='22023'; end if;
    select d.event_id into linked_event from public.visit_event_destinations d where d.user_id=actor and d.request_id=client_request_id;
    if (linked_event is not null and linked_event<>client_event_id)
        or (linked_event is null and exists(select 1 from public.add_destination_requests r where r.user_id=actor and r.request_id=client_request_id)) then
        raise exception 'Existing receipt cannot be relinked.' using errcode='22023'; end if;
    scope_key:=case when destination_kind='personal' then 'personal' else 'group:'||target_group_id::text end;
    if exists(select 1 from public.visit_event_destinations d where d.user_id=actor and d.event_id=client_event_id
        and d.destination_key=scope_key and d.request_id<>client_request_id) then
        raise exception 'This event already has a save in this destination.' using errcode='22023'; end if;
    -- Delegate every payload/idempotency, admission, Owner, revision and point
    -- check to the existing entry point, including on a linked replay.
    if destination_kind='personal' then
        if selected_latitude is null then
            saved_id:=public.save_personal_visit(client_request_id,restaurant_name,restaurant_address,restaurant_cuisine,
                visit_date,visit_rating,visit_would_go_again,visit_notes,restaurant_apple_place_id,target_entry_id);
        else
            saved_id:=public.save_personal_visit_with_mapkit_location(client_request_id,restaurant_name,restaurant_address,restaurant_cuisine,
                visit_date,visit_rating,visit_would_go_again,visit_notes,restaurant_apple_place_id,target_entry_id,
                selected_latitude,selected_longitude,selected_address);
        end if;
    else
        if selected_latitude is null then
            saved_id:=public.save_group_visit_destination(client_request_id,target_group_id,restaurant_name,restaurant_address,restaurant_cuisine,
                visit_date,visit_rating,visit_would_go_again,visit_notes,restaurant_apple_place_id,target_entry_id,expected_membership_id);
        else
            saved_id:=public.save_group_visit_with_mapkit_location(client_request_id,target_group_id,restaurant_name,restaurant_address,restaurant_cuisine,
                visit_date,visit_rating,visit_would_go_again,visit_notes,restaurant_apple_place_id,target_entry_id,expected_membership_id,
                selected_latitude,selected_longitude,selected_address);
        end if;
    end if;
    select r.* into strict receipt from public.add_destination_requests r where r.user_id=actor and r.request_id=client_request_id;
    if receipt.destination_kind<>destination_kind or receipt.group_id is distinct from target_group_id or receipt.entry_id<>saved_id then
        raise exception 'Receipt destination mismatch.' using errcode='22023'; end if;
    insert into public.visit_event_destinations(user_id,request_id,event_id,destination_key)
        values(actor,client_request_id,client_event_id,scope_key) on conflict(user_id,request_id) do nothing;
    select d.event_id into strict linked_event from public.visit_event_destinations d where d.user_id=actor and d.request_id=client_request_id;
    if linked_event<>client_event_id then raise exception 'Concurrent receipt cannot be relinked.' using errcode='22023'; end if;
    return saved_id;
end;
$$;

-- Counts only THIS account's currently accessible live visit rows. A retained
-- receipt after deletion/revocation is save proof, not a live analytics record.
create function public.get_my_visit_event_summary()
returns table(linked_events bigint,linked_records bigint,unlinked_records bigint)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
    if actor is null then raise exception 'Sign in first.' using errcode='42501'; end if;
    return query with live as (
        select 'personal'::text kind,v.id,v.personal_place_id entry_id,null::uuid group_id
        from public.personal_visits v where v.owner_user_id=actor
        union all
        select 'group'::text,v.id,v.group_restaurant_id,gr.group_id from public.visits v
        join public.group_restaurants gr on gr.id=v.group_restaurant_id
        join public.group_memberships m on m.group_id=gr.group_id and m.user_id=actor
        where v.created_by=actor
    ), linked as (
        select v.kind,v.id,d.event_id from live v
        left join public.add_destination_requests r on r.user_id=actor and r.destination_kind=v.kind
            and r.visit_id=v.id and r.entry_id=v.entry_id and r.group_id is not distinct from v.group_id
        left join public.visit_event_destinations d on d.user_id=r.user_id and d.request_id=r.request_id
    ) select count(distinct l.event_id),count(*) filter(where l.event_id is not null),count(*) filter(where l.event_id is null)
        from linked l;
end;
$$;
revoke all on function public.save_visit_event_destination(text,text,text,text,text,text,date,integer,boolean,text,text,uuid,uuid,uuid,double precision,double precision,jsonb),
    public.get_my_visit_event_summary() from public,anon,authenticated,service_role;
grant execute on function public.save_visit_event_destination(text,text,text,text,text,text,date,integer,boolean,text,text,uuid,uuid,uuid,double precision,double precision,jsonb),
    public.get_my_visit_event_summary() to authenticated;
commit;
