begin;

-- Reveal a group's roster only to its current members. Existing RLS stays unchanged.
create function public.get_group_members(target_group_id uuid)
returns table (user_id uuid, display_name text, is_owner boolean)
language plpgsql security definer set search_path = ''
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from public.group_memberships m
        where m.group_id = target_group_id and m.user_id = auth.uid()
    ) then
        raise exception 'Group not found or access denied.' using errcode = '42501';
    end if;

    return query
        select m.user_id, p.display_name, m.user_id = g.owner_user_id
        from public.group_memberships m
        join public.profiles p on p.id = m.user_id
        join public.groups g on g.id = m.group_id
        where m.group_id = target_group_id
        order by (m.user_id = g.owner_user_id) desc, m.joined_at, m.user_id;
end;
$$;

revoke all on function public.get_group_members(uuid) from public, anon, authenticated;
grant execute on function public.get_group_members(uuid) to authenticated;

commit;
