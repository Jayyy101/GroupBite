-- Hosted preflight: SELECT-only; use the confirmed GroupBite project.
-- Do not run local fixture tests against hosted data.
-- SQL Editor: run blocks A, B and C separately and export each result.
-- No application row contents or credentials are selected. Function definitions
-- are source-code metadata; pg_get_functiondef does not execute those functions.
-- The read_only field reports session mode and may be off in SQL Editor.

-- A: migration history (share every returned version/name; no stored SQL needed).
SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version;

-- B: compatibility summary (one JSON value; aggregate data counts only).
SELECT jsonb_build_object(
 'observed_at',clock_timestamp(),'database',current_database(),'role',current_user,
 'read_only',current_setting('transaction_read_only'),'server_version',current_setting('server_version'),
 'default_isolation',current_setting('default_transaction_isolation'),
 'row_security_active',row_security_active('public.personal_places'::regclass),
 'extensions',(select jsonb_agg(jsonb_build_object('name',extname,'version',extversion,'schema',extnamespace::regnamespace::text)) from pg_extension where extname in('postgis','pgcrypto','uuid-ossp')),
 'counts',(select jsonb_build_object('profiles',(select count(*) from public.profiles),'groups',(select count(*) from public.groups),
  'memberships',(select count(*) from public.group_memberships),'personal_cards',(select count(*) from public.personal_places),
  'personal_locations',(select count(*) from public.personal_place_locations),'group_entries',(select count(*) from public.group_restaurants),
  'restaurants',(select count(*) from public.restaurants),'visits',(select count(*) from public.visits),
  'group_locations',(select count(*) from public.group_restaurant_locations),'legacy_receipts',(select count(*) from public.visit_save_requests),
  'bindings',(select count(*) from public.visit_save_location_bindings))),
 'personal_backfill',(select jsonb_build_object('legacy_visits',count(*) filter(where visited_on is not null or rating is not null or would_go_again is not null or notes is not null),
  'empty_cards',count(*) filter(where visited_on is null and rating is null and would_go_again is null and notes is null),
  'undated_memories',count(*) filter(where visited_on is null and(rating is not null or would_go_again is not null or notes is not null)),
  'false_again',count(*) filter(where would_go_again=false),
  'revision_near_limit',count(*) filter(where revision>=2147483646),
  'existing_m18_request_prefix',count(*) filter(where client_request_id like 'm18:%'),
  'invalid_dates',count(*) filter(where visited_on is not null and not(visited_on between date '0001-01-01' and date '9999-12-31')),
  'invalid_ratings',count(*) filter(where rating is not null and rating not between 1 and 5),
  'invalid_notes',count(*) filter(where notes is not null and(notes is distinct from nullif(btrim(notes),'') or char_length(notes) not between 1 and 4000))) from public.personal_places),
 'duplicates',jsonb_build_object(
  'personal_exact',(select count(*) from(select owner_user_id,name,address from public.personal_places group by 1,2,3 having count(*)>1)d),
  'personal_apple',(select count(*) from(select owner_user_id,apple_place_id from public.personal_places where apple_place_id is not null group by 1,2 having count(*)>1)d),
  'group_exact',(select count(*) from(select gr.group_id,r.name,r.address from public.group_restaurants gr join public.restaurants r on r.id=gr.restaurant_id group by 1,2,3 having count(*)>1)d),
  'group_apple',(select count(*) from(select group_id,apple_place_id from public.group_restaurants where apple_place_id is not null group by 1,2 having count(*)>1)d)),
 'orphaned_personal_owners',(select count(*) from public.personal_places p left join public.profiles u on u.id=p.owner_user_id where u.id is null),
 'personal_apple_address_conflicts',(select count(*) from(select owner_user_id,apple_place_id from public.personal_places where apple_place_id is not null group by 1,2 having count(distinct address)>1)d),
 'group_apple_address_conflicts',(select count(*) from(select gr.group_id,gr.apple_place_id from public.group_restaurants gr join public.restaurants r on r.id=gr.restaurant_id where gr.apple_place_id is not null group by 1,2 having count(distinct r.address)>1)d),
 'new_relations',jsonb_build_object('personal_visits',to_regclass('public.personal_visits'),'add_destination_requests',to_regclass('public.add_destination_requests')),
 'name_collisions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid))),'[]') from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any(array['save_personal_visit','update_personal_place','delete_personal_place','manage_personal_visit','save_group_visit_destination','get_add_destination_result','get_recent_add_restaurants','validate_add_visit','reject_add_receipt_update','prepare_personal_visit','refresh_personal_place_memory'])),
 'new_index_conflicts',(select coalesce(jsonb_agg(relname),'[]') from pg_class where relnamespace='public'::regnamespace and relname=any(array['personal_places_id_owner_key','personal_places_identity_idx','personal_places_apple_identity_idx','personal_visits_place_created_idx'])),
 'event_triggers',(select jsonb_agg(jsonb_build_object('name',e.evtname,'enabled',e.evtenabled,'event',e.evtevent,'tags',e.evttags,'owner',pg_get_userbyid(e.evtowner),'function',e.evtfoid::regprocedure::text,'definition',pg_get_functiondef(e.evtfoid)) order by e.evtname) from pg_event_trigger e),
 'default_privileges',(select jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(defaclrole),'schema',defaclnamespace::regnamespace::text,'kind',defaclobjtype,'acl',defaclacl::text)) from pg_default_acl),
 'unvalidated_constraints',(select count(*) from pg_constraint where connamespace='public'::regnamespace and not convalidated),
 'invalid_indexes',(select count(*) from pg_index i join pg_class r on r.oid=i.indrelid where r.relnamespace='public'::regnamespace and(not i.indisvalid or not i.indisready)),
 'target_locks',(select coalesce(jsonb_agg(jsonb_build_object('relation',relation::regclass::text,'mode',mode,'granted',granted)),'[]') from pg_locks where relation=any(array['public.personal_places'::regclass,'public.profiles'::regclass,'public.groups'::regclass,'public.group_restaurants'::regclass,'public.visits'::regclass]) and pid<>pg_backend_pid()),
 'login_roles',(select coalesce(jsonb_agg(jsonb_build_object('name',rolname,'until',rolvaliduntil,'login',rolcanlogin)),'[]') from pg_roles where rolname like 'cli_login%')
) AS compatibility;

-- C: schema and permissions (one JSON value; no application table row contents).
SELECT pg_catalog.jsonb_build_object(
 'tables',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.name) FROM (
   SELECT c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
     pg_catalog.pg_get_userbyid(c.relowner) AS owner,
     (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',r,'select',pg_catalog.has_table_privilege(r,c.oid,'SELECT'),'insert',pg_catalog.has_table_privilege(r,c.oid,'INSERT'),'update',pg_catalog.has_table_privilege(r,c.oid,'UPDATE'),'delete',pg_catalog.has_table_privilege(r,c.oid,'DELETE'),'truncate',pg_catalog.has_table_privilege(r,c.oid,'TRUNCATE'),'references',pg_catalog.has_table_privilege(r,c.oid,'REFERENCES'),'trigger',pg_catalog.has_table_privilege(r,c.oid,'TRIGGER')) ORDER BY r)
      FROM pg_catalog.unnest(ARRAY['anon','authenticated','service_role']) r) AS privileges
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p')
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::pg_catalog.regclass AND d.objid=c.oid AND d.deptype='e')
 ) t),
 'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.table_name,t.position) FROM (
   SELECT c.relname AS table_name,a.attname AS name,a.attnum AS position,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',r,'select',pg_catalog.has_column_privilege(r,c.oid,a.attnum,'SELECT'),'insert',pg_catalog.has_column_privilege(r,c.oid,a.attnum,'INSERT'),'update',pg_catalog.has_column_privilege(r,c.oid,a.attnum,'UPDATE'),'references',pg_catalog.has_column_privilege(r,c.oid,a.attnum,'REFERENCES')) ORDER BY r) FROM pg_catalog.unnest(ARRAY['anon','authenticated','service_role']) r) AS privileges
   FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend e WHERE e.classid='pg_catalog.pg_class'::pg_catalog.regclass AND e.objid=c.oid AND e.deptype='e')
 ) t),
 'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.table_name,t.name) FROM (
   SELECT r.relname AS table_name,c.conname AS name,c.convalidated,pg_catalog.pg_get_constraintdef(c.oid) AS definition FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
   WHERE c.connamespace='public'::pg_catalog.regnamespace
 ) t),
 'indexes',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.table_name,t.name) FROM (
   SELECT r.relname AS table_name,i.relname AS name,x.indisvalid,x.indisready,pg_catalog.pg_get_indexdef(i.oid) AS definition
   FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid JOIN pg_catalog.pg_class r ON r.oid=x.indrelid
   WHERE r.relnamespace='public'::pg_catalog.regnamespace
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend e WHERE e.classid='pg_catalog.pg_class'::pg_catalog.regclass AND e.objid=r.oid AND e.deptype='e')
 ) t),
 'policies',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.tablename,t.policyname) FROM (SELECT * FROM pg_catalog.pg_policies WHERE schemaname='public') t),
 'functions',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.name,t.args) FROM (
   SELECT p.proname AS name,pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,pg_catalog.pg_get_functiondef(p.oid) AS definition,pg_catalog.pg_get_userbyid(p.proowner) AS owner,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',r,'execute',pg_catalog.has_function_privilege(r,p.oid,'EXECUTE')) ORDER BY r) FROM pg_catalog.unnest(ARRAY['anon','authenticated','service_role','public']) r) AS privileges
   FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::pg_catalog.regnamespace AND p.prokind='f'
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::pg_catalog.regclass AND d.objid=p.oid AND d.deptype='e')
 ) t),
 'triggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.schema,t.table_name,t.name) FROM (
   SELECT n.nspname AS schema,c.relname AS table_name,t.tgname AS name,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid) AS definition
   FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE NOT t.tgisinternal AND (n.nspname='public' OR (n.nspname='auth' AND t.tgname='on_auth_user_created'))
 ) t)
) AS catalog;
