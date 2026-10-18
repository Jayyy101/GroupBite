-- PREPARED ONLY. No approved row allowlist exists. Never identify disposable data
-- from a restaurant/group name. Requires inventory, protected backup, exact row
-- manifest, account/group scope, and separate approval of the target environment.
-- psql defaults to ROLLBACK. A separately reviewed execution may set apply=true.
\if :{?apply}
\else
\set apply false
\endif
begin;
create temporary table m18_cleanup_manifest(document jsonb not null) on commit drop;
insert into m18_cleanup_manifest values(current_setting('groupbite.m18.cleanup_manifest',false)::jsonb);
do $$
declare manifest jsonb; expected_count integer; actual_count integer;
begin
    if current_setting('groupbite.m18.approved_operation',true) is distinct from 'm18-cleanup-v1' then
        raise exception 'Exact cleanup approval and backup are required.'; end if;
    select document into manifest from m18_cleanup_manifest;
    if manifest->>'backup_verified' is distinct from 'true' or manifest->>'environment' is null
        or jsonb_array_length(manifest->'account_ids')=0 then raise exception 'Missing verified backup/environment/account scope.'; end if;
    if not (manifest ?& array['account_ids','group_ids','personal','group_visits','empty_entry_ids'])
        or exists(select 1 from jsonb_each(manifest) e where e.key in ('account_ids','group_ids','personal','group_visits','empty_entry_ids')
            and jsonb_typeof(e.value)<>'array') then raise exception 'Incomplete cleanup manifest.'; end if;
    -- Serialize against approved accounts' personal mutations and group writers.
    perform p.id from public.profiles p where p.id in(select value::uuid from jsonb_array_elements_text(manifest->'account_ids')) order by p.id for no key update;
    perform g.id from public.groups g where g.id in(select value::uuid from jsonb_array_elements_text(manifest->'group_ids')) order by g.id for update;
    perform p.id from public.personal_places p where p.id in(select (value->>'id')::uuid from jsonb_array_elements(manifest->'personal')) order by p.id for update;
    expected_count := jsonb_array_length(manifest->'personal');
    select count(*) into actual_count from public.personal_places p join jsonb_to_recordset(manifest->'personal') as approved(id uuid,row_hash text)
        on p.id=approved.id and md5(to_jsonb(p)::text)=approved.row_hash
        where p.owner_user_id in(select value::uuid from jsonb_array_elements_text(manifest->'account_ids'));
    if actual_count<>expected_count then raise exception 'Personal allowlist/hash/account mismatch.'; end if;
    expected_count := jsonb_array_length(manifest->'group_visits');
    select count(*) into actual_count from public.visits v join public.group_restaurants gr on gr.id=v.group_restaurant_id
        join jsonb_to_recordset(manifest->'group_visits') as approved(id uuid,row_hash text) on v.id=approved.id and md5(to_jsonb(v)::text)=approved.row_hash
        where v.created_by in(select value::uuid from jsonb_array_elements_text(manifest->'account_ids'))
        and gr.group_id in(select value::uuid from jsonb_array_elements_text(manifest->'group_ids'));
    if actual_count<>expected_count then raise exception 'Visit allowlist/hash/account/group mismatch.'; end if;
    delete from public.personal_places where id in(select (value->>'id')::uuid from jsonb_array_elements(manifest->'personal'));
    delete from public.visits where id in(select (value->>'id')::uuid from jsonb_array_elements(manifest->'group_visits'));
    -- Entry IDs must be explicitly approved too. Never remove a card with any
    -- remaining visit, including one contributed by another testing account.
    delete from public.group_restaurants gr where gr.id in(select value::uuid from jsonb_array_elements_text(manifest->'empty_entry_ids'))
        and gr.group_id in(select value::uuid from jsonb_array_elements_text(manifest->'group_ids'))
        and not exists(select 1 from public.visits v where v.group_restaurant_id=gr.id);
    -- Retain all catalog facts and both receipt ledgers/immutable bindings.
end;
$$;
\if :apply
commit;
\else
rollback;
\endif
