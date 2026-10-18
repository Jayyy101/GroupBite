begin;

-- One destination per transaction: existing legacy receipt, immutable location
-- binding, new visit and recovery receipt either ALL commit or ALL roll back.
create function public.save_group_visit_destination(client_request_id text, target_group_id uuid,
    restaurant_name text, restaurant_address text, restaurant_cuisine text default null,
    visit_date date default null, visit_rating integer default null, visit_would_go_again boolean default null,
    visit_notes text default null, restaurant_apple_place_id text default null, target_entry_id uuid default null,
    expected_membership_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
    actor uuid := auth.uid(); receipt public.add_destination_requests; fingerprint text;
    saved_entry public.group_restaurants; saved_restaurant public.restaurants;
    matches integer; resolved_entry_id uuid; old_visits uuid[]; saved_visit_id uuid; legacy_id text := 'm18:' || client_request_id;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'Saves require READ COMMITTED.' using errcode = '25001'; end if;
    perform public.validate_add_visit(restaurant_name,restaurant_address,restaurant_cuisine,
        restaurant_apple_place_id,visit_date,visit_rating,visit_notes);
    if client_request_id is null or char_length(client_request_id) not between 1 and 100 then
        raise exception 'A save request ID is required.' using errcode = '22023'; end if;
    -- Match every existing group writer's lock order and recheck this admission.
    perform 1 from public.groups where id = target_group_id for update;
    if not found or not exists (select 1 from public.group_memberships m where m.group_id = target_group_id
        and m.user_id = actor and m.membership_id = expected_membership_id) then
        raise exception 'Group membership changed. Refresh before saving.' using errcode = '42501'; end if;
    fingerprint := encode(extensions.digest(jsonb_build_object('kind','group','group',target_group_id,
        'membership',expected_membership_id,'entry',target_entry_id,'name',btrim(restaurant_name),
        'address',btrim(restaurant_address),'cuisine',nullif(btrim(restaurant_cuisine),''),'apple',restaurant_apple_place_id,
        'date',visit_date,'rating',visit_rating,'again',visit_would_go_again,'notes',nullif(btrim(visit_notes),''))::text,'sha256'),'hex');
    select * into receipt from public.add_destination_requests where user_id = actor and request_id = client_request_id;
    if found then
        if receipt.payload_hash <> fingerprint then raise exception 'Request payload changed.' using errcode = '22023'; end if;
        return receipt.entry_id;
    end if;
    -- Do not adopt an unrelated legacy request or infer its Visit identity.
    if exists(select 1 from public.visit_save_requests where user_id = actor and request_id = legacy_id) then
        raise exception 'Request ID already used.' using errcode = '22023'; end if;
    -- Address edits lock Restaurant before invalidating its entries. Match 16D.
    perform r.id from public.restaurants r where exists(select 1 from public.group_restaurants gr
        where gr.restaurant_id = r.id and gr.group_id = target_group_id) order by r.id for share of r;
    if target_entry_id is not null then
        select * into saved_entry from public.group_restaurants where id = target_entry_id and group_id = target_group_id;
        if not found then raise exception 'Saved restaurant not found or access denied.' using errcode = '42501'; end if;
        select * into saved_restaurant from public.restaurants where id = saved_entry.restaurant_id;
        if saved_restaurant.name <> btrim(restaurant_name) or saved_restaurant.address <> btrim(restaurant_address) then
            raise exception 'Restaurant changed. Select it again.' using errcode = '40001'; end if;
    else
        if restaurant_apple_place_id is not null and exists(select 1 from public.group_restaurants gr
            join public.restaurants r on r.id = gr.restaurant_id where gr.group_id = target_group_id
            and gr.apple_place_id = restaurant_apple_place_id and r.address <> btrim(restaurant_address)) then
            raise exception 'Conflicting restaurant location. Review the group.' using errcode = '22023'; end if;
        select count(*) into matches from public.group_restaurants gr join public.restaurants r on r.id = gr.restaurant_id
        where gr.group_id = target_group_id and ((restaurant_apple_place_id is not null
            and gr.apple_place_id = restaurant_apple_place_id and r.address = btrim(restaurant_address))
            or (r.name = btrim(restaurant_name) and r.address = btrim(restaurant_address)));
        if matches > 1 then raise exception 'Multiple matching cards. Select an existing card.' using errcode = '22023'; end if;
        select gr.* into saved_entry from public.group_restaurants gr join public.restaurants r on r.id = gr.restaurant_id
        where gr.group_id = target_group_id and ((restaurant_apple_place_id is not null
            and gr.apple_place_id = restaurant_apple_place_id and r.address = btrim(restaurant_address))
            or (r.name = btrim(restaurant_name) and r.address = btrim(restaurant_address)));
        if saved_entry.id is not null then select * into saved_restaurant from public.restaurants where id = saved_entry.restaurant_id; end if;
    end if;
    if saved_entry.id is not null and restaurant_apple_place_id is not null and saved_entry.apple_place_id is not null
        and saved_entry.apple_place_id <> restaurant_apple_place_id then
        raise exception 'Conflicting Apple identity. Select the restaurant again.' using errcode = '22023'; end if;
    resolved_entry_id := saved_entry.id;
    select coalesce(array_agg(v.id),'{}'::uuid[]) into old_visits from public.visits v where v.group_restaurant_id = saved_entry.id;
    -- The canonical facts are selected only inside this authorized destination.
    -- Preserve the existing owner-only NULL-fill and unchanged legacy fingerprint.
    perform public.save_restaurant_visit_with_apple_place_id(legacy_id,array[target_group_id],
        coalesce(saved_restaurant.name,btrim(restaurant_name)),coalesce(saved_restaurant.address,btrim(restaurant_address)),
        case when saved_restaurant.id is null then restaurant_cuisine else saved_restaurant.cuisine end,
        visit_date,visit_rating,visit_would_go_again,visit_notes,restaurant_apple_place_id);
    select gr.* into strict saved_entry from public.visit_save_location_bindings b
        join public.group_restaurants gr on gr.id = b.group_restaurant_id and gr.group_id = b.group_id
        where b.user_id = actor and b.request_id = legacy_id and b.group_id = target_group_id;
    if resolved_entry_id is not null and saved_entry.id <> resolved_entry_id then
        raise exception 'Ambiguous saved restaurant. Review duplicate cards.' using errcode = '22023'; end if;
    -- The group lock excludes every other Visit writer. Identify exactly this
    -- call's newly inserted Visit, without relying on transaction timestamps.
    select v.id into strict saved_visit_id from public.visits v where v.group_restaurant_id = saved_entry.id
        and v.created_by = actor and v.id <> all(old_visits);
    insert into public.add_destination_requests(user_id,request_id,payload_hash,destination_kind,group_id,entry_id,visit_id)
        values(actor,client_request_id,fingerprint,'group',target_group_id,saved_entry.id,saved_visit_id);
    return saved_entry.id;
end;
$$;

create function public.get_add_destination_result(client_request_id text)
returns table(destination_kind text, group_id uuid, entry_id uuid, visit_id uuid, available boolean)
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid(); receipt public.add_destination_requests; permitted boolean;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    select * into receipt from public.add_destination_requests r where r.user_id = actor and r.request_id = client_request_id;
    if not found then return; end if;
    -- Own historical receipt proves commit, including after deletion/revocation.
    -- Current group contents and navigable IDs require CURRENT membership.
    permitted := receipt.destination_kind = 'personal' or exists(select 1 from public.group_memberships m
        where m.group_id = receipt.group_id and m.user_id = actor);
    return query select receipt.destination_kind,receipt.group_id,
        case when permitted then receipt.entry_id end,case when permitted then receipt.visit_id end,
        permitted and case when receipt.destination_kind = 'personal' then exists(select 1 from public.personal_places p
            where p.id = receipt.entry_id and p.owner_user_id = actor)
            else exists(select 1 from public.group_restaurants gr where gr.id = receipt.entry_id and gr.group_id = receipt.group_id) end;
end;
$$;

-- Recent identities contain no visit/private/group notes, ratings or inherited
-- destinations. Bound and paginate reads; frontend selection starts unchecked.
create function public.get_recent_add_restaurants(page_size integer default 12, page_offset integer default 0)
returns table(destination_kind text, group_id uuid, entry_id uuid, name text, address text, cuisine text, apple_place_id text)
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    if page_size is null or page_size not between 1 and 50 or page_offset is null or page_offset not between 0 and 100000 then
        raise exception 'Invalid pagination.' using errcode = '22023'; end if;
    return query select s.kind,s.gid,s.eid,s.rname,s.raddress,s.rcuisine,s.apple from (
        select 'personal'::text kind,null::uuid gid,p.id eid,p.name rname,p.address raddress,p.cuisine rcuisine,
            p.apple_place_id apple,p.updated_at recent from public.personal_places p where p.owner_user_id = actor
        union all
        select 'group'::text,gr.group_id,gr.id,r.name,r.address,r.cuisine,gr.apple_place_id,
            coalesce((select max(v.created_at) from public.visits v where v.group_restaurant_id = gr.id),gr.created_at)
        from public.group_memberships m join public.group_restaurants gr on gr.group_id = m.group_id
            join public.restaurants r on r.id = gr.restaurant_id where m.user_id = actor
    ) s order by s.recent desc,s.kind,s.eid limit page_size offset page_offset;
end;
$$;
revoke all on function public.save_group_visit_destination(text,uuid,text,text,text,date,integer,boolean,text,text,uuid,uuid),
    public.get_add_destination_result(text),public.get_recent_add_restaurants(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.save_group_visit_destination(text,uuid,text,text,text,date,integer,boolean,text,text,uuid,uuid),
    public.get_add_destination_result(text),public.get_recent_add_restaurants(integer,integer) to authenticated;
commit;
