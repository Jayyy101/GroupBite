begin;

-- Call only in a separate request/transaction AFTER reserve_geoapify_request.
-- Its snapshot can see committed reservations, never another transaction's
-- uncommitted insert. This is a readback, not a reusable dispatch/claim token.
create function public.confirm_geoapify_request(
    target_admission_id uuid, acting_user_id uuid, expected_permit_expires_at timestamptz
)
returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.geoapify_request_admissions a
        where a.id = target_admission_id
            and a.user_id = acting_user_id
            and a.permit_expires_at = expected_permit_expires_at
            and a.permit_expires_at > pg_catalog.statement_timestamp()
    );
$$;

revoke all on function public.confirm_geoapify_request(uuid, uuid, timestamptz)
    from public, anon, authenticated, service_role;
grant execute on function public.confirm_geoapify_request(uuid, uuid, timestamptz) to service_role;

commit;
