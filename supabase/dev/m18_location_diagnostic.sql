-- READ ONLY. Run in GroupBite project goperhgeqyqzepbtwtaz SQL Editor.
-- Share only the single aggregate JSON result. No IDs, notes, coordinates,
-- emails, credentials or connection strings are returned. Requires migrations
-- 1-16, and is intentionally usable BEFORE the pending migration 17.
with target as (
    select p.* from public.personal_places p
    where p.name ilike '%in%n%out%' and p.address ilike '%50%ranch%' and p.address ilike '%milpitas%'
)
select jsonb_build_object(
    'observed_at',clock_timestamp(),
    'migrations',(select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version)
        from supabase_migrations.schema_migrations),
    'personal_cards_total',(select count(*) from public.personal_places),
    'personal_visits_total',(select count(*) from public.personal_visits),
    'matching_cards',(select count(*) from target),
    'matching_owners',(select count(distinct owner_user_id) from target),
    'matching_cards_with_apple_id',(select count(*) from target where apple_place_id is not null),
    'matching_visits',(select count(*) from public.personal_visits v join target p on p.id=v.personal_place_id),
    'matching_foreign_owner_visits',(select count(*) from public.personal_visits v join target p on p.id=v.personal_place_id where v.owner_user_id<>p.owner_user_id),
    'matching_revision_min',(select min(revision) from target),
    'matching_revision_max',(select max(revision) from target),
    'matching_location_rows',(select count(*) from public.personal_place_locations l join target p on p.id=l.personal_place_id),
    'matching_current_resolved_points',(select count(*) from public.personal_place_locations l join target p on p.id=l.personal_place_id
        where l.address_snapshot=p.address and l.resolution_status='resolved'
            and l.latitude between -90 and 90 and l.longitude between -180 and 180
            and l.resolution_accuracy in ('building','address')),
    'matching_stale_address_locations',(select count(*) from public.personal_place_locations l join target p on p.id=l.personal_place_id where l.address_snapshot is distinct from p.address),
    'matching_duplicate_name_address_sets',(select count(*) from (select owner_user_id,name,address from target group by owner_user_id,name,address having count(*)>1) d)
) as location_diagnostic;
