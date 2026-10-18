-- READ ONLY. Explicit account/group UUID scopes must be supplied in this session
-- as groupbite.m18.backup_accounts and groupbite.m18.backup_groups (UUID arrays).
-- Save output privately outside Git, hash it, and verify restoration in a separate
-- disposable database before approving cleanup. Never export auth.users/tokens.
-- All exported sections share one snapshot even if an app writes concurrently.
begin isolation level repeatable read read only;
select current_setting('groupbite.m18.backup_accounts',false)::uuid[],current_setting('groupbite.m18.backup_groups',false)::uuid[];
select to_regclass('public.personal_visits') is not null has_history,to_regclass('public.add_destination_requests') is not null has_receipts \gset
select 'backup_metadata' table_name,jsonb_build_object('captured_at',transaction_timestamp(),
    'database',current_database(),'server_version',current_setting('server_version'),
    'read_only',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),
    'accounts',current_setting('groupbite.m18.backup_accounts')::uuid[],
    'groups',current_setting('groupbite.m18.backup_groups')::uuid[]) rows;
select 'personal_places' table_name,coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') rows from public.personal_places p
    where p.owner_user_id=any(current_setting('groupbite.m18.backup_accounts')::uuid[]);
select 'personal_place_locations' table_name,coalesce(jsonb_agg(to_jsonb(l) order by l.personal_place_id),'[]') rows from public.personal_place_locations l
    join public.personal_places p on p.id=l.personal_place_id where p.owner_user_id=any(current_setting('groupbite.m18.backup_accounts')::uuid[]);
select 'group_restaurants' table_name,coalesce(jsonb_agg(to_jsonb(gr) order by gr.id),'[]') rows from public.group_restaurants gr
    where gr.group_id=any(current_setting('groupbite.m18.backup_groups')::uuid[]);
select 'restaurants' table_name,coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') rows from public.restaurants r
    where exists(select 1 from public.group_restaurants gr where gr.restaurant_id=r.id and gr.group_id=any(current_setting('groupbite.m18.backup_groups')::uuid[]));
select 'visits' table_name,coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') rows from public.visits v join public.group_restaurants gr on gr.id=v.group_restaurant_id
    where gr.group_id=any(current_setting('groupbite.m18.backup_groups')::uuid[]);
select 'group_restaurant_locations' table_name,coalesce(jsonb_agg(to_jsonb(l) order by l.group_restaurant_id),'[]') rows from public.group_restaurant_locations l
    join public.group_restaurants gr on gr.id=l.group_restaurant_id where gr.group_id=any(current_setting('groupbite.m18.backup_groups')::uuid[]);
select 'visit_save_requests' table_name,coalesce(jsonb_agg(to_jsonb(r) order by r.user_id,r.request_id),'[]') rows from public.visit_save_requests r
    where r.user_id=any(current_setting('groupbite.m18.backup_accounts')::uuid[]);
select 'visit_save_location_bindings' table_name,coalesce(jsonb_agg(to_jsonb(r) order by r.user_id,r.request_id,r.group_id),'[]') rows from public.visit_save_location_bindings r
    where r.user_id=any(current_setting('groupbite.m18.backup_accounts')::uuid[]);
\if :has_history
select 'personal_visits' table_name,coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') rows from public.personal_visits v
    where v.owner_user_id=any(current_setting('groupbite.m18.backup_accounts')::uuid[]);
\endif
\if :has_receipts
select 'add_destination_requests' table_name,coalesce(jsonb_agg(to_jsonb(r) order by r.user_id,r.request_id),'[]') rows from public.add_destination_requests r
    where r.user_id=any(current_setting('groupbite.m18.backup_accounts')::uuid[]);
\endif
rollback;
