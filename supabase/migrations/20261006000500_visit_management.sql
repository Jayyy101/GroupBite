begin;

-- All visit writers lock the group first, matching save_restaurant_visit.
-- Recheck membership and the scoped child rows AFTER acquiring that lock.
create function public.update_group_visit(
    target_group_id uuid,
    target_group_restaurant_id uuid,
    target_visit_id uuid,
    visit_date date,
    visit_rating integer,
    visit_would_go_again boolean,
    visit_notes text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    owner_id uuid;
    creator_id uuid;
    clean_notes text := nullif(btrim(visit_notes), '');
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    select g.owner_user_id into owner_id from public.groups g
        where g.id = target_group_id for update;
    if not found or not exists (select 1 from public.group_memberships m
        where m.group_id = target_group_id and m.user_id = actor) then
        raise exception 'Visit not found or access denied.' using errcode = '42501';
    end if;
    perform 1 from public.group_restaurants gr
        where gr.id = target_group_restaurant_id and gr.group_id = target_group_id for update;
    if not found then raise exception 'Visit not found or access denied.' using errcode = '42501'; end if;
    select v.created_by into creator_id from public.visits v
        where v.id = target_visit_id and v.group_restaurant_id = target_group_restaurant_id for update;
    if not found or (actor is distinct from creator_id and actor is distinct from owner_id) then
        raise exception 'Visit not found or access denied.' using errcode = '42501';
    end if;
    if char_length(clean_notes) > 4000 or (visit_rating is not null and visit_rating not between 1 and 5) then
        raise exception 'Check the optional visit fields.' using errcode = '22023';
    end if;

    -- The creator, creation time, group/location link, and global facts are immutable here.
    update public.visits set visited_on = visit_date, rating = visit_rating,
        would_go_again = visit_would_go_again, notes = clean_notes, updated_at = clock_timestamp()
        where id = target_visit_id and group_restaurant_id = target_group_restaurant_id;
end;
$$;

create function public.delete_group_visit(
    target_group_id uuid,
    target_group_restaurant_id uuid,
    target_visit_id uuid
)
-- True means the final visit was deleted and its group entry was removed.
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    owner_id uuid;
    creator_id uuid;
begin
    if actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    select g.owner_user_id into owner_id from public.groups g
        where g.id = target_group_id for update;
    if not found or not exists (select 1 from public.group_memberships m
        where m.group_id = target_group_id and m.user_id = actor) then
        raise exception 'Visit not found or access denied.' using errcode = '42501';
    end if;
    perform 1 from public.group_restaurants gr
        where gr.id = target_group_restaurant_id and gr.group_id = target_group_id for update;
    if not found then raise exception 'Visit not found or access denied.' using errcode = '42501'; end if;
    select v.created_by into creator_id from public.visits v
        where v.id = target_visit_id and v.group_restaurant_id = target_group_restaurant_id for update;
    if not found or (actor is distinct from creator_id and actor is distinct from owner_id) then
        raise exception 'Visit not found or access denied.' using errcode = '42501';
    end if;

    delete from public.visits
        where id = target_visit_id and group_restaurant_id = target_group_restaurant_id;
    -- The group lock prevents any save from inserting between deletion and cleanup.
    -- A later new save can recreate this entry; an old receipt never resurrects visits.
    delete from public.group_restaurants gr
        where gr.id = target_group_restaurant_id and gr.group_id = target_group_id
        and not exists (select 1 from public.visits v where v.group_restaurant_id = gr.id);
    return found;
end;
$$;

-- Appending a return field requires recreating the read RPC. Preserve its existing
-- fields and input signature so Milestone 10 callers still receive the same data.
drop function public.get_group_restaurant_visits(uuid);
create function public.get_group_restaurant_visits(target_group_restaurant_id uuid)
returns table (
    id uuid, visited_on date, rating integer, would_go_again boolean, notes text,
    created_at timestamptz, creator_display_name text, can_manage boolean
)
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    owner_id uuid;
begin
    select g.owner_user_id into owner_id
        from public.group_restaurants gr
        join public.groups g on g.id = gr.group_id
        join public.group_memberships m on m.group_id = gr.group_id and m.user_id = actor
        where gr.id = target_group_restaurant_id;
    if actor is null or not found then
        raise exception 'Restaurant not found or access denied.' using errcode = '42501';
    end if;
    return query
        select v.id, v.visited_on, v.rating, v.would_go_again, v.notes, v.created_at,
            p.display_name, (v.created_by = actor or owner_id = actor)
        from public.visits v join public.profiles p on p.id = v.created_by
        where v.group_restaurant_id = target_group_restaurant_id
        order by v.created_at desc, v.id;
end;
$$;

-- Keep direct writes closed, including Owners and immutable columns. RLS remains
-- unchanged and nonrecursive; only explicitly authenticated RPCs can mutate visits.
revoke insert, update, delete, truncate, references, trigger
    on public.visits, public.group_restaurants, public.restaurants, public.visit_save_requests
    from public, anon, authenticated;
revoke all on function public.update_group_visit(uuid, uuid, uuid, date, integer, boolean, text),
    public.delete_group_visit(uuid, uuid, uuid), public.get_group_restaurant_visits(uuid)
    from public, anon, authenticated;
grant execute on function public.update_group_visit(uuid, uuid, uuid, date, integer, boolean, text),
    public.delete_group_visit(uuid, uuid, uuid), public.get_group_restaurant_visits(uuid)
    to authenticated;

commit;
