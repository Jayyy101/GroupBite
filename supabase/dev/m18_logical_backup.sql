-- Authorized M18 application-scope logical backup: one SELECT, one MVCC snapshot.
-- All application accounts, not an actor/account filter. No Auth secrets/sessions.
-- Private export only: do not paste its result into chat or commit it to Git.
SELECT jsonb_build_object(
 'format','groupbite-m18-logical-v1','project_ref','goperhgeqyqzepbtwtaz',
 'captured_at',statement_timestamp(),'snapshot',pg_current_snapshot()::text,
 'database',current_database(),'role',current_user,'read_only',current_setting('transaction_read_only'),
 'rls_active',(SELECT jsonb_object_agg(t,row_security_active(('public.'||t)::regclass)) FROM unnest(ARRAY['profiles','groups','group_memberships','group_invites','join_requests','restaurants','group_restaurants','visits','visit_save_requests','personal_places','group_restaurant_locations','personal_place_locations','visit_save_location_bindings','geoapify_request_admissions']) t),
 'server_version',current_setting('server_version'),'server_encoding',current_setting('server_encoding'),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',e.extnamespace::regnamespace::text) ORDER BY e.extname) FROM pg_extension e),
 'migration_history',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.version) FROM supabase_migrations.schema_migrations m),
 'auth_user_keys',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id) ORDER BY u.id),'[]'::jsonb) FROM auth.users u WHERE EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=u.id)),
 'auth_uid_definition',pg_get_functiondef('auth.uid()'::regprocedure),
 'data',jsonb_build_object('profiles',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.profiles t),
 'groups',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.groups t),
 'group_memberships',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.group_memberships t),
 'group_invites',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.group_invites t),
 'join_requests',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.join_requests t),
 'restaurants',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.restaurants t),
 'group_restaurants',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.group_restaurants t),
 'visits',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.visits t),
 'visit_save_requests',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.visit_save_requests t),
 'personal_places',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.personal_places t),
 'group_restaurant_locations',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.group_restaurant_locations t),
 'personal_place_locations',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.personal_place_locations t),
 'visit_save_location_bindings',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.visit_save_location_bindings t),
 'geoapify_request_admissions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.geoapify_request_admissions t)),
 'catalog',pg_catalog.jsonb_build_object(
 'tables',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.name) FROM (
   SELECT c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
     pg_catalog.pg_get_userbyid(c.relowner) AS owner,
     (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',r,'select',pg_catalog.has_table_privilege(r,c.oid,'SELECT'),'insert',pg_catalog.has_table_privilege(r,c.oid,'INSERT'),'update',pg_catalog.has_table_privilege(r,c.oid,'UPDATE'),'delete',pg_catalog.has_table_privilege(r,c.oid,'DELETE'),'truncate',pg_catalog.has_table_privilege(r,c.oid,'TRUNCATE'),'references',pg_catalog.has_table_privilege(r,c.oid,'REFERENCES'),'trigger',pg_catalog.has_table_privilege(r,c.oid,'TRIGGER')) ORDER BY r)
      FROM pg_catalog.unnest(ARRAY['anon','authenticated','service_role','public']) r) AS privileges
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p')
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::pg_catalog.regclass AND d.objid=c.oid AND d.deptype='e')
 ) t),
 'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.table_name,t.position) FROM (
   SELECT c.relname AS table_name,a.attname AS name,a.attnum AS position,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',r,'select',pg_catalog.has_column_privilege(r,c.oid,a.attnum,'SELECT'),'insert',pg_catalog.has_column_privilege(r,c.oid,a.attnum,'INSERT'),'update',pg_catalog.has_column_privilege(r,c.oid,a.attnum,'UPDATE'),'references',pg_catalog.has_column_privilege(r,c.oid,a.attnum,'REFERENCES')) ORDER BY r) FROM pg_catalog.unnest(ARRAY['anon','authenticated','service_role','public']) r) AS privileges
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
),
 'schema_privileges',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',n.nspacl::text,
   'privileges',(SELECT jsonb_agg(jsonb_build_object('role',r,'usage',has_schema_privilege(r,n.oid,'USAGE'),'create',has_schema_privilege(r,n.oid,'CREATE')) ORDER BY r) FROM unnest(ARRAY['anon','authenticated','service_role','public']) r)) ORDER BY n.nspname) FROM pg_namespace n WHERE n.nspname IN('public','extensions','auth')),
 'default_privileges',(SELECT coalesce(jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(defaclrole),'schema',defaclnamespace::regnamespace::text,'kind',defaclobjtype,'acl',defaclacl::text)),'[]'::jsonb) FROM pg_default_acl),
 'event_triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.evtname,'enabled',e.evtenabled,'event',e.evtevent,'tags',e.evttags,'owner',pg_get_userbyid(e.evtowner),'function',e.evtfoid::regprocedure::text,'definition',pg_get_functiondef(e.evtfoid)) ORDER BY e.evtname),'[]'::jsonb) FROM pg_event_trigger e),
 'excluded','Auth credentials, sessions, identities, storage objects, Vault secrets and platform configuration; Auth dependency IDs only'
) AS backup;
