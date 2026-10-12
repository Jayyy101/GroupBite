begin;

-- Only the authenticated Edge backend supplies signature-verified values.
-- This wrapper is personal-only; migration 8 still owns the actual write,
-- first-resolution-wins behavior, invalidation and revision increment.
create function public.attach_geoapify_personal_place_location(
    acting_user_id uuid, target_personal_place_id uuid, expected_revision integer,
    expected_address text, verified_latitude double precision, verified_longitude double precision,
    provider_result_id text, receipt_expires_at timestamptz
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare saved public.personal_places;
begin
    select * into saved from public.personal_places p
        where p.id = target_personal_place_id and p.owner_user_id = acting_user_id for update;
    if acting_user_id is null or not found then
        raise exception 'Personal Place not found or access denied.' using errcode = '42501';
    end if;
    if saved.revision is distinct from expected_revision or saved.address is distinct from expected_address then
        raise exception 'The Personal Place changed. Resolve it again.' using errcode = '40001';
    end if;
    -- clock_timestamp, not transaction/statement start: a lock wait must not
    -- keep a now-expired receipt alive. The inner RPC reacquires our own lock.
    if receipt_expires_at is null or not pg_catalog.isfinite(receipt_expires_at)
        or receipt_expires_at <= pg_catalog.clock_timestamp() then
        raise exception 'Selection expired. Select the address again.' using errcode = '22023';
    end if;
    if verified_latitude is null or verified_longitude is null
        or not (verified_latitude between -90 and 90 and verified_longitude between -180 and 180)
        or (verified_latitude = 0 and verified_longitude = 0)
        or provider_result_id is null or provider_result_id <> pg_catalog.btrim(provider_result_id)
        or pg_catalog.char_length(provider_result_id) not between 1 and 300 then
        raise exception 'Invalid verified selection.' using errcode = '22023';
    end if;
    return public.attach_verified_personal_place_location(acting_user_id, target_personal_place_id,
        expected_revision, expected_address, verified_latitude, verified_longitude,
        'geoapify', provider_result_id, expected_address, 'building');
end;
$$;

revoke all on function public.attach_geoapify_personal_place_location(uuid, uuid, integer, text,
    double precision, double precision, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.attach_geoapify_personal_place_location(uuid, uuid, integer, text,
    double precision, double precision, text, timestamptz) to service_role;

commit;
