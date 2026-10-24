begin;

-- Prepared locally for Phase G. No historical visit or receipt is changed.
-- Bytes are immutable. Removal revokes access immediately; physical reclamation
-- is a separate, explicitly authorized Storage API maintenance operation.
create table public.visit_photos (
    id uuid primary key,
    uploaded_by uuid not null references public.profiles(id) on delete cascade,
    personal_visit_id uuid references public.personal_visits(id) on delete cascade,
    group_visit_id uuid references public.visits(id) on delete cascade,
    upload_membership_id uuid,
    width integer not null check (width between 1 and 1600),
    height integer not null check (height between 1 and 1600),
    image_bytes integer not null check (image_bytes between 1 and 5242880),
    thumbnail_bytes integer not null check (thumbnail_bytes between 1 and 524288),
    removed boolean not null default false,
    revision integer not null default 1 check (revision > 0),
    created_at timestamptz not null default clock_timestamp(),
    check (num_nonnulls(personal_visit_id, group_visit_id) = 1),
    check ((group_visit_id is null) = (upload_membership_id is null))
);
create index visit_photos_personal_idx on public.visit_photos(personal_visit_id, created_at, id);
create index visit_photos_group_idx on public.visit_photos(group_visit_id, created_at, id);
alter table public.visit_photos enable row level security;
revoke all on public.visit_photos from public, anon, authenticated, service_role;

-- Helpers expose only an authorization decision; metadata is read through the
-- scoped RPC below. A group Owner gains no access to personal photographs.
create function public.can_access_visit_photo(photo_id uuid, writing boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.visit_photos p
        where p.id = photo_id and not p.removed and auth.uid() is not null and (
            exists (select 1 from public.personal_visits v
                where v.id = p.personal_visit_id and v.owner_user_id = auth.uid())
            or exists (select 1 from public.visits v
                join public.group_restaurants e on e.id = v.group_restaurant_id
                join public.groups g on g.id = e.group_id
                join public.group_memberships m on m.group_id = g.id and m.user_id = auth.uid()
                where v.id = p.group_visit_id
                and (not writing or v.created_by = auth.uid() or g.owner_user_id = auth.uid()))
        ) and (not writing or (p.uploaded_by = auth.uid() and (
            p.group_visit_id is null or exists (
                select 1 from public.visits v join public.group_restaurants e on e.id = v.group_restaurant_id
                join public.group_memberships m on m.group_id = e.group_id and m.user_id = auth.uid()
                where v.id = p.group_visit_id and m.membership_id = p.upload_membership_id
            )
        )))
    );
$$;

-- This helper accepts the exact object name, never a user-supplied path cast.
create function public.can_access_visit_photo_object(object_name text, writing boolean)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.visit_photos p
        where object_name in (p.uploaded_by::text || '/' || p.id::text || '/image.jpg',
                              p.uploaded_by::text || '/' || p.id::text || '/thumbnail.jpg')
        and public.can_access_visit_photo(p.id, writing));
$$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', false, 5242880, array['image/jpeg']);
create policy visit_photos_object_read on storage.objects for select to authenticated
    using (bucket_id = 'visit-photos' and public.can_access_visit_photo_object(name, false));
create policy visit_photos_object_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'visit-photos' and public.can_access_visit_photo_object(name, true));
-- Bucket limits enforce JPEG/5 MiB through the Storage service. Do not require
-- size metadata in INSERT RLS: Storage's preflight may supply only contentLength
-- (or no metadata on older versions). Completion reads validate stored metadata.
-- No UPDATE/upsert or client DELETE policy. A removed identity never resurrects.

create function public.visit_photo_command(
    operation text, target_kind text, target_entry_id uuid, target_visit_id uuid,
    target_group_id uuid default null, expected_membership_id uuid default null,
    photo_id uuid default null, image_width integer default null, image_height integer default null,
    image_size integer default null, thumbnail_size integer default null, expected_revision integer default null
) returns setof public.visit_photos
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); owner_id uuid; creator_id uuid; saved public.visit_photos;
begin
    if actor is null or operation not in ('list', 'reserve', 'remove') then
        raise exception 'Photo unavailable.' using errcode = '42501';
    end if;
    -- Match the existing writers' parent-first lock order. Reads take no locks.
    if target_kind = 'personal' and target_group_id is null and expected_membership_id is null then
        if operation <> 'list' then
            perform 1 from public.personal_places where id = target_entry_id and owner_user_id = actor for update;
        end if;
        if not exists (select 1 from public.personal_visits v where v.id = target_visit_id
            and v.personal_place_id = target_entry_id and v.owner_user_id = actor) then
            raise exception 'Photo unavailable.' using errcode = '42501';
        end if;
    elsif target_kind = 'group' then
        if operation <> 'list' then
            perform 1 from public.groups where id = target_group_id for update;
            perform 1 from public.group_restaurants where id = target_entry_id and group_id = target_group_id for update;
        end if;
        select g.owner_user_id, v.created_by into owner_id, creator_id from public.visits v
            join public.group_restaurants e on e.id = v.group_restaurant_id
            join public.groups g on g.id = e.group_id
            join public.group_memberships m on m.group_id = g.id and m.user_id = actor
            where v.id = target_visit_id and e.id = target_entry_id and g.id = target_group_id
            and m.membership_id = expected_membership_id;
        if not found or (operation <> 'list' and actor <> owner_id and actor <> creator_id) then
            raise exception 'Photo unavailable.' using errcode = '42501';
        end if;
    else raise exception 'Photo unavailable.' using errcode = '42501';
    end if;
    if operation = 'reserve' then
        select * into saved from public.visit_photos p where p.id = photo_id;
        if found then
            if saved.uploaded_by <> actor or saved.personal_visit_id is distinct from
                    (case when target_kind = 'personal' then target_visit_id end)
                or saved.group_visit_id is distinct from (case when target_kind = 'group' then target_visit_id end)
                or saved.upload_membership_id is distinct from expected_membership_id
                or saved.width is distinct from image_width or saved.height is distinct from image_height
                or saved.image_bytes is distinct from image_size or saved.thumbnail_bytes is distinct from thumbnail_size then
                raise exception 'Photo identity changed.' using errcode = '22023';
            end if;
        else
            if (select count(*) from public.visit_photos p where not p.removed and
                ((target_kind = 'personal' and p.personal_visit_id = target_visit_id) or (target_kind = 'group' and p.group_visit_id = target_visit_id))) >= 12 then
                raise exception 'A visit can have up to 12 photos.' using errcode = '22023';
            end if;
            insert into public.visit_photos(id, uploaded_by, personal_visit_id, group_visit_id,
                upload_membership_id, width, height, image_bytes, thumbnail_bytes)
            values (photo_id, actor, case when target_kind = 'personal' then target_visit_id end,
                case when target_kind = 'group' then target_visit_id end, expected_membership_id,
                image_width, image_height, image_size, thumbnail_size);
        end if;
    elsif operation = 'remove' then
        select * into saved from public.visit_photos p where p.id = photo_id and
            ((target_kind = 'personal' and p.personal_visit_id = target_visit_id) or (target_kind = 'group' and p.group_visit_id = target_visit_id)) for update;
        if not found then raise exception 'Photo unavailable.' using errcode = '42501'; end if;
        if not saved.removed then
            if saved.revision is distinct from expected_revision then
                raise exception 'Photo changed. Refresh first.' using errcode = '40001';
            end if;
            update public.visit_photos set removed = true, revision = revision + 1 where id = photo_id;
        end if;
    end if;
    return query select p.* from public.visit_photos p where
        ((target_kind = 'personal' and p.personal_visit_id = target_visit_id) or (target_kind = 'group' and p.group_visit_id = target_visit_id))
        and (photo_id is null or p.id = photo_id)
        -- A reader sees completed photos; managers can also reconcile reservations.
        and (not p.removed or operation <> 'list' or target_kind = 'personal' or actor = owner_id or actor = creator_id)
        and (target_kind = 'personal' or actor = owner_id or actor = creator_id or (
            exists(select 1 from storage.objects o where o.bucket_id = 'visit-photos'
                and o.name = p.uploaded_by::text || '/' || p.id::text || '/image.jpg'
                and o.metadata->>'mimetype' = 'image/jpeg'
                and coalesce((o.metadata->>'size')::bigint,(o.metadata->>'contentLength')::bigint) = p.image_bytes)
            and exists(select 1 from storage.objects o where o.bucket_id = 'visit-photos'
                and o.name = p.uploaded_by::text || '/' || p.id::text || '/thumbnail.jpg'
                and o.metadata->>'mimetype' = 'image/jpeg'
                and coalesce((o.metadata->>'size')::bigint,(o.metadata->>'contentLength')::bigint) = p.thumbnail_bytes)))
        order by p.created_at, p.id;
end;
$$;

-- Small read-only projection for completion checks. A missing object does NOT
-- prove that an earlier HTTP upload cannot still finish.
create function public.get_visit_photos(target_kind text, target_entry_id uuid, target_visit_id uuid,
    target_group_id uuid default null, expected_membership_id uuid default null)
returns table(id uuid, image_path text, thumbnail_path text, width integer, height integer, state text, revision integer)
language sql security definer set search_path = '' as $$
    select p.id, p.uploaded_by::text || '/' || p.id::text || '/image.jpg',
        p.uploaded_by::text || '/' || p.id::text || '/thumbnail.jpg', p.width, p.height,
        case when p.removed then 'removed' when
            exists(select 1 from storage.objects o where o.bucket_id = 'visit-photos'
                and o.name = p.uploaded_by::text || '/' || p.id::text || '/image.jpg'
                and o.metadata->>'mimetype' = 'image/jpeg'
                and coalesce((o.metadata->>'size')::bigint,(o.metadata->>'contentLength')::bigint) = p.image_bytes) and
            exists(select 1 from storage.objects o where o.bucket_id = 'visit-photos'
                and o.name = p.uploaded_by::text || '/' || p.id::text || '/thumbnail.jpg'
                and o.metadata->>'mimetype' = 'image/jpeg'
                and coalesce((o.metadata->>'size')::bigint,(o.metadata->>'contentLength')::bigint) = p.thumbnail_bytes)
            then 'ready' else 'pending' end, p.revision
    from public.visit_photo_command('list', target_kind, target_entry_id, target_visit_id,
        target_group_id, expected_membership_id) p;
$$;

revoke all on function public.can_access_visit_photo(uuid,boolean),
    public.can_access_visit_photo_object(text,boolean),
    public.visit_photo_command(text,text,uuid,uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer),
    public.get_visit_photos(text,uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_access_visit_photo(uuid,boolean),
    public.can_access_visit_photo_object(text,boolean),
    public.visit_photo_command(text,text,uuid,uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer),
    public.get_visit_photos(text,uuid,uuid,uuid,uuid) to authenticated;

commit;
