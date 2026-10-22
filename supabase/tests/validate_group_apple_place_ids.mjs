// Explicit local tooling only. Fresh owned database, private Unix socket, no TCP,
// app configuration, credentials, downloads, hosted connections or Apple calls.
// Usage: node supabase/tests/validate_group_apple_place_ids.mjs \
//   --postgres-bin /absolute/postgres/bin --pg-module /absolute/pg/lib/index.js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const visitEvents = args.at(-1) === '--visit-events';
if (visitEvents) args.pop();
const structuredMapkit = visitEvents || args.at(-1) === '--structured-mapkit';
if (args.at(-1) === '--structured-mapkit') args.pop();
const mapkitLocations = structuredMapkit || args.at(-1) === '--mapkit-locations';
if (args.at(-1) === '--mapkit-locations') args.pop();
const milestone18 = mapkitLocations || args.at(-1) === '--milestone18';
if (args.at(-1) === '--milestone18') args.pop();
assert(args.length === 4 && args[0] === '--postgres-bin' && args[2] === '--pg-module' && path.isAbsolute(args[1]) && path.isAbsolute(args[3]),
    'Supply explicit local --postgres-bin and --pg-module paths');
assert(process.getuid?.() !== 0, 'Use an ordinary local user');
const native = args[1], pgModule = args[3], root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = '11111111-1111-1111-1111-111111111111', other = '22222222-2222-2222-2222-222222222222', member = '33333333-3333-3333-3333-333333333333';
const children = [], clients = [], hashes = new Map(); let runtime;
for (const key of Object.keys(process.env)) delete process.env[key];
async function bounded(operation, ms = 30000) {
    let timer;
    try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Local operation timed out')), ms); })]); }
    finally { clearTimeout(timer); }
}
function launch(name, argv) {
    const child = spawn(path.join(native, name), argv, { cwd: runtime, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', TMPDIR: runtime, LC_ALL: 'C', TZ: 'UTC' } });
    const state = { child, output: '', closed: false };
    const output = bytes => { state.output = (state.output + bytes).slice(-20000); };
    child.stdout.on('data', output); child.stderr.on('data', output);
    state.done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => { state.closed = true; resolve(code); }); });
    children.push(state); return state;
}
async function source(relative) {
    const file = path.join(root, relative); assert.equal(await fs.realpath(file), file, 'No symlinked inputs');
    const bytes = await fs.readFile(file); hashes.set(file, crypto.createHash('sha256').update(bytes).digest('hex')); return bytes.toString();
}
async function main() {
    runtime = await fs.mkdtemp('/private/tmp/groupbite-group-apple-ids-');
    const socket = path.join(runtime, 'socket'), db = path.join(runtime, 'db'); await fs.mkdir(socket, { mode: 0o700 });
    const init = launch('initdb', ['-D', db, '--auth=trust', '--username=postgres', '--locale=C', '--encoding=UTF8']);
    assert.equal(await bounded(init.done), 0, init.output);
    const server = launch('postgres', ['-D', db, '-h', '', '-k', socket, '-c', 'fsync=on', '-c', 'synchronous_commit=on',
        '-c', 'statement_timeout=10000', '-c', 'idle_in_transaction_session_timeout=10000']);
    for (let i = 0; i < 200 && !server.output.includes('database system is ready to accept connections'); i++) {
        assert(!server.closed, server.output); await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(server.output.includes('database system is ready to accept connections'), server.output);
    const { default: pg } = await import(pathToFileURL(pgModule).href);
    async function connect() {
        const client = new pg.Client({ host: socket, port: 5432, user: 'postgres', database: 'postgres',
            connectionTimeoutMillis: 3000, query_timeout: 15000 });
        client.on('error', () => {}); clients.push(client); await client.connect(); return client;
    }
    const admin = await connect(), a = await connect(), b = await connect();
    await admin.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
        create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
        grant usage on schema auth to anon,authenticated,service_role;
        alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
        alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
    const migrations = (await fs.readdir(path.join(root, 'migrations'))).filter(file => file.endsWith('.sql')).sort().slice(0, 14);
    assert.equal(migrations.length, 14); assert.equal(migrations[11], '20261011001200_restaurant_catalog_privacy.sql');
    assert.equal(migrations[12], '20261013001300_personal_apple_place_ids.sql');
    for (const migration of migrations.slice(0, 13)) await admin.query(await source('migrations/' + migration));
    const versions = (await admin.query("select current_setting('server_version') postgres,extensions.postgis_lib_version() postgis")).rows[0];
    console.log(`Local tooling: PostgreSQL ${versions.postgres}; PostGIS ${versions.postgis}; Unix socket only`);
    await admin.query("insert into auth.users values($1,'{}'),($2,'{}'),($3,'{}')", [owner, other, member]);
    await admin.query('begin; set local role authenticated');
    await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    const group = (await admin.query("select (public.create_group('Historical group')).id as id")).rows[0].id;
    const restaurant = (await admin.query("select * from public.save_restaurant_visit_with_location_bindings('m13-history-group',$1,'Historical restaurant','100 Fixture Road',visit_rating=>4,visit_notes=>'Original group memory')", [[group]])).rows[0].restaurant_id;
    const personal = (await admin.query("insert into public.personal_places(name,address,notes,rating,would_go_again,client_request_id) values('Historical personal','100 Fixture Road','Original personal memory',5,false,'m13-history-personal') returning id,revision")).rows[0];
    await admin.query("insert into public.personal_places(name,address,client_request_id) values('Historical manual','Unresolved address','m13-history-manual')");
    await admin.query('commit');
    const entry = (await admin.query('select id from public.group_restaurants where group_id=$1 and restaurant_id=$2', [group, restaurant])).rows[0].id;
    await admin.query('begin; set local role service_role');
    assert.equal((await admin.query('select public.attach_geoapify_personal_place_location($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval \'1 minute\') as attached',
        [owner,personal.id,personal.revision,'100 Fixture Road',37.7,-122.4,'synthetic-historical-personal'])).rows[0].attached, true);
    assert.equal((await admin.query('select public.attach_verified_restaurant_location($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as attached',
        [owner,group,restaurant,entry,'100 Fixture Road',37.7,-122.4,'geoapify','synthetic-historical-group','100 Fixture Road','building'])).rows[0].attached, true);
    await admin.query('commit');

    const tables = ['profiles','groups','group_memberships','group_invites','join_requests','restaurants','group_restaurants',
        'visits','visit_save_requests','personal_places','group_restaurant_locations','personal_place_locations','visit_save_location_bindings','geoapify_request_admissions'];
    async function snapshot() {
        const data = {};
        for (const table of tables) {
            const row = 'to_jsonb(t)' + (table === 'group_restaurants' ? " - 'apple_place_id'" : '');
            data[table] = (await admin.query(`select ${row} as row from public.${table} t order by (${row})::text`)).rows;
        }
        return {
            data,
            relations: (await admin.query("select oid,relname,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by oid")).rows,
            columns: (await admin.query(`select a.attrelid,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,a.attacl::text,pg_get_expr(d.adbin,d.adrelid) as expression
                from pg_attribute a join pg_class c on c.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
                where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attnum>0 and not a.attisdropped and a.attname<>'apple_place_id' order by a.attrelid,a.attnum`)).rows,
            policies: (await admin.query("select * from pg_policies where schemaname='public' order by tablename,policyname")).rows,
            constraints: (await admin.query(`select c.oid,c.conrelid,c.conname,c.convalidated,pg_get_constraintdef(c.oid) as definition from pg_constraint c
                where c.connamespace='public'::regnamespace and c.conname<>'group_restaurants_apple_place_id_check' order by c.oid`)).rows,
            indexes: (await admin.query("select i.*,pg_get_indexdef(i.indexrelid) as definition from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace order by i.indexrelid")).rows,
            triggers: (await admin.query("select g.oid,g.tgfoid,g.tgenabled,pg_get_triggerdef(g.oid) as definition from pg_trigger g join pg_class c on c.oid=g.tgrelid where c.relnamespace in ('public'::regnamespace,'auth'::regnamespace) order by g.oid")).rows,
            functions: (await admin.query(`select p.oid,p.proowner,p.prolang,p.prorettype,p.proargtypes::text,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text,
                case when p.proname<>'invalidate_saved_location_address' then pg_get_functiondef(p.oid) end as definition
                from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname not in ('save_restaurant_visit_with_apple_place_id','get_group_restaurant_apple_place_id') order by p.oid`)).rows,
            defaults: (await admin.query('select * from pg_default_acl order by oid')).rows,
        };
    }
    const before = await snapshot();
    await admin.query(await source('migrations/' + migrations[13]));
    assert.deepEqual(await snapshot(), before);
    assert.equal((await admin.query('select count(*)::int as n from public.group_restaurants where apple_place_id is not null')).rows[0].n, 0);
    console.log('PASS Migration 14 preserves historical data, grants, RLS, Geoapify, old RPC identities and receipts');
    await admin.query("select set_config('groupbite.local_validation','group-apple-place-ids',false)");
    await admin.query(await source('tests/group_apple_place_ids.sql'));
    console.log('PASS focused group Apple SQL contract');
    await admin.query('begin; set local role authenticated');
    await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await assert.rejects(admin.query("select * from public.save_restaurant_visit_with_apple_place_id('apple-nul',$1,'Invalid','Address',restaurant_apple_place_id=>$2)", [[group],'in\0side']), { code: '22021' });
    await admin.query('rollback');
    await admin.query('begin isolation level repeatable read; set local role authenticated');
    await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await assert.rejects(admin.query("select * from public.save_restaurant_visit_with_apple_place_id('apple-isolation',$1,'Invalid','Address',restaurant_apple_place_id=>'ID')", [[group]]), { code: '25001' });
    await admin.query('rollback');
    console.log('PASS parameterized NUL rejection and isolation guard');
    await source('tests/group_apple_place_ids_concurrency.mjs');
    const { runGroupAppleConcurrency } = await import('./group_apple_place_ids_concurrency.mjs');
    if (!milestone18) await runGroupAppleConcurrency({ admin,a,b,owner,other,member });
    for (const suite of ['group_membership_lifecycle.sql','restaurant_catalog_privacy.sql','personal_apple_place_ids.sql']) {
        await admin.query("select set_config('groupbite.local_validation','personal-apple-place-ids',false)");
        await admin.query(await source('tests/' + suite)); console.log('PASS post-Migration-14 regression: ' + suite);
    }
    await source('tests/restaurant_catalog_privacy_concurrency.mjs');
    const { runCatalogPrivacyConcurrency } = await import('./restaurant_catalog_privacy_concurrency.mjs');
    await admin.query("select set_config('groupbite.local_validation','restaurant-catalog-privacy',false)");
    if (!milestone18) await runCatalogPrivacyConcurrency({ admin,a,b,owner,other });
    if (milestone18) {
        // Legacy duplicates and incomplete memories must survive the cutover.
        await admin.query('begin; set local role authenticated');
        await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
        await admin.query(`insert into public.personal_places(name,address,client_request_id,visited_on,rating,would_go_again,notes) values
            ('M18 legacy duplicate','Legacy address','m18-legacy-a',null,3,false,'Legacy private memory'),
            ('M18 legacy duplicate','Legacy address','m18-legacy-b','2026-09-01',null,null,null),
            ('M18 legacy empty','Legacy empty address','m18-legacy-empty',null,null,null,null)`);
        await admin.query('commit');
        const existingRows = {};
        for (const table of tables) existingRows[table] = (await admin.query(`select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`)).rows;
        const oldFunctions = (await admin.query(`select p.oid,pg_get_functiondef(p.oid) definition,p.proacl::text
            from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' order by p.oid`)).rows;
        for (const migration of ['20261017001500_personal_visit_history.sql','20261017001600_unified_add_destinations.sql']) {
            await admin.query(await source('migrations/' + migration));
        }
        for (const table of tables) assert.deepEqual((await admin.query(`select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`)).rows, existingRows[table]);
        assert.deepEqual((await admin.query(`select p.oid,pg_get_functiondef(p.oid) definition,p.proacl::text
            from pg_proc p where p.oid=any($1::oid[]) order by p.oid`, [oldFunctions.map(f => f.oid)])).rows, oldFunctions);
        console.log('PASS M18 migrations preserve every existing row, including locations and both legacy receipts/bindings');
        console.log('PASS M18 cutover preserves all existing function definitions, identities and execution grants');
        // Run the existing group/16D contracts AGAIN against the final schema.
        // The old personal suite intentionally expects direct INSERT/UPDATE;
        // its cutover replacements are in unified_add.sql.
        for (const suite of ['group_apple_place_ids.sql','group_membership_lifecycle.sql','restaurant_catalog_privacy.sql']) {
            await admin.query("select set_config('groupbite.local_validation','group-apple-place-ids',false)");
            await admin.query(await source('tests/' + suite));
            console.log('PASS post-M18 regression: ' + suite);
        }
        await runGroupAppleConcurrency({ admin,a,b,owner,other,member });
        await admin.query("select set_config('groupbite.local_validation','restaurant-catalog-privacy',false)");
        await runCatalogPrivacyConcurrency({ admin,a,b,owner,other });
        await admin.query("select set_config('groupbite.local_validation','m18-unified-add',false)");
        await admin.query(await source('tests/unified_add.sql'));
        console.log('PASS M18 personal history, scoped identities, RLS, permissions, deletion and atomic receipt failures');
        for (const [name, sql, values] of [
            ['personal', "select public.save_personal_visit('m18-input-guard','Cafe','Address',restaurant_apple_place_id=>$1)", ['in\0side']],
            ['group', "select public.save_group_visit_destination('m18-input-guard',$2,'Cafe','Address',restaurant_apple_place_id=>$1)", ['in\0side',group]],
        ]) {
            await admin.query('begin; set local role authenticated');
            await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
            await assert.rejects(admin.query(sql,values), { code: '22021' });
            await admin.query('rollback');
            await admin.query('begin isolation level repeatable read; set local role authenticated');
            await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
            await assert.rejects(admin.query(sql,values.map(value => value === 'in\0side' ? 'valid-id' : value)), { code: '25001' });
            await admin.query('rollback');
            console.log(`PASS M18 ${name} RPC: parameterized NUL rejection and isolation guard`);
        }
        await source('tests/unified_add_concurrency.mjs');
        const { runUnifiedAddConcurrency } = await import('./unified_add_concurrency.mjs');
        await runUnifiedAddConcurrency({admin,a,b,owner,other,member});
    }
    if (mapkitLocations) {
        const preservedTables=[...tables,'personal_visits','add_destination_requests'];
        const rows=async()=>Object.fromEntries(await Promise.all(preservedTables.map(async table=>[table,
            (await admin.query(`select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`)).rows])));
        const beforeRows=await rows();
        const oldFunctions=(await admin.query("select oid,pg_get_functiondef(oid) definition,proacl::text from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by oid")).rows;
        await admin.query(await source('migrations/20261018001700_personal_mapkit_locations.sql'));
        assert.deepEqual(await rows(),beforeRows);
        assert.deepEqual((await admin.query('select oid,pg_get_functiondef(oid) definition,proacl::text from pg_proc where oid=any($1::oid[]) order by oid',[oldFunctions.map(f=>f.oid)])).rows,oldFunctions);
        console.log('PASS migration 17 preserves every original row and all pre-existing function bodies/grants');
        await admin.query("select set_config('groupbite.local_validation','m18-mapkit-locations',false)");
        await admin.query(await source('tests/personal_mapkit_locations.sql'));
        assert.deepEqual(await rows(),beforeRows);
        console.log('PASS MapKit location SQL: null/present IDs, atomic rollback, idempotency, repair, RLS and address/deletion safety');
        await source('tests/personal_mapkit_locations_concurrency.mjs');
        const {runMapkitLocationConcurrency}=await import('./personal_mapkit_locations_concurrency.mjs');
        await runMapkitLocationConcurrency({admin,a,b,owner,other});
        for (const suite of ['group_apple_place_ids.sql','group_membership_lifecycle.sql','restaurant_catalog_privacy.sql','unified_add.sql']) {
            await admin.query("select set_config('groupbite.local_validation',$1,false)",[suite==='unified_add.sql'?'m18-unified-add':'group-apple-place-ids']);
            await admin.query(await source('tests/'+suite));console.log('PASS post-migration-17 regression: '+suite);
        }
    }
    if (structuredMapkit) {
        const preservedTables=[...tables,'personal_visits','add_destination_requests','personal_mapkit_locations','personal_mapkit_save_requests'];
        const rows=async()=>Object.fromEntries(await Promise.all(preservedTables.map(async table=>[table,
            (await admin.query(`select to_jsonb(t)${table==='personal_mapkit_locations'?" - 'structured_address'":''} row from public.${table} t
                order by (to_jsonb(t)${table==='personal_mapkit_locations'?" - 'structured_address'":''})::text`)).rows])));
        const beforeRows=await rows();
        const oldFunctions=(await admin.query("select oid,pg_get_functiondef(oid) definition,proacl::text from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by oid")).rows;
        const permissions=async()=>(await admin.query(`select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class
            where oid=any($1::regclass[]) order by oid`,[preservedTables.map(t=>'public.'+t)])).rows;
        const policies=async()=>(await admin.query('select * from pg_policies where schemaname=\'public\' and tablename=any($1::text[]) order by tablename,policyname',[preservedTables])).rows;
        const beforePermissions=await permissions(), beforePolicies=await policies();
        await admin.query(await source('migrations/20261021001800_structured_mapkit_locations.sql'));
        assert.deepEqual(await rows(),beforeRows);
        assert.deepEqual(await permissions(),beforePermissions);assert.deepEqual(await policies(),beforePolicies);
        assert.deepEqual((await admin.query('select oid,pg_get_functiondef(oid) definition,proacl::text from pg_proc where oid=any($1::oid[]) order by oid',[oldFunctions.map(f=>f.oid)])).rows,oldFunctions);
        assert.equal((await admin.query('select count(*)::int n from public.personal_mapkit_locations where structured_address is not null')).rows[0].n,0);
        console.log('PASS migration 18 preserves every existing row, RPC body/grant, table grant and RLS policy');
        await admin.query("select set_config('groupbite.local_validation','structured-mapkit',false)");
        await admin.query(await source('tests/structured_mapkit_locations.sql'));
        assert.deepEqual(await rows(),beforeRows);
        console.log('PASS structured MapKit SQL contracts and transactional rollback');
        await source('tests/structured_mapkit_locations_concurrency.mjs');
        const {runStructuredMapkitConcurrency}=await import('./structured_mapkit_locations_concurrency.mjs');
        await runStructuredMapkitConcurrency({admin,a,b,owner,other,member});
        // The old point suite assumes an empty MapKit inventory and runs above
        // before concurrent fixtures. Legacy point calls are also covered by the
        // new SQL suite after migration 18.
        for (const [suite,marker] of [['unified_add.sql','m18-unified-add'],['group_apple_place_ids.sql','group-apple-place-ids']]) {
            await admin.query("select set_config('groupbite.local_validation',$1,false)",[marker]);
            await admin.query(await source('tests/'+suite));console.log('PASS post-migration-18 regression: '+suite);
        }
    }
    if (visitEvents) {
        const tables = (await admin.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename);
        const rows = async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,
            (await admin.query(`select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`)).rows])));
        const beforeRows=await rows();
        const functions=(await admin.query("select oid,pg_get_functiondef(oid) definition,proacl::text from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by oid")).rows;
        const access=async()=>(await admin.query("select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where oid=any($1::regclass[]) order by oid",[tables.map(t=>'public.'+t)])).rows;
        const policies=async()=>(await admin.query("select * from pg_policies where schemaname='public' and tablename=any($1::text[]) order by tablename,policyname",[tables])).rows;
        const beforeAccess=await access(),beforePolicies=await policies();
        await admin.query(await source('migrations/20261022001900_visit_event_provenance.sql'));
        assert.deepEqual(await rows(),beforeRows);assert.deepEqual(await access(),beforeAccess);assert.deepEqual(await policies(),beforePolicies);
        assert.deepEqual((await admin.query('select oid,pg_get_functiondef(oid) definition,proacl::text from pg_proc where oid=any($1::oid[]) order by oid',[functions.map(f=>f.oid)])).rows,functions);
        assert.equal((await admin.query('select count(*)::int n from public.visit_events')).rows[0].n,0);
        console.log('PASS migration 19 preserves all historical rows, RPCs, grants and policies; no inferred provenance');
        await admin.query("select set_config('groupbite.local_validation','visit-events',false)");
        await admin.query(await source('tests/visit_events.sql'));
        assert.deepEqual(await rows(),beforeRows);
        console.log('PASS visit-event SQL: atomic proof, private notes, legacy coverage, scoped totals and permissions');
        await source('tests/visit_events_concurrency.mjs');
        const {runVisitEventConcurrency}=await import('./visit_events_concurrency.mjs');
        await runVisitEventConcurrency({admin,a,b,owner,other,member});
        await admin.query("select set_config('groupbite.local_validation','m18-unified-add',false)");
        await admin.query(await source('tests/unified_add.sql'));
        console.log('PASS post-migration-19 legacy saves and recovery remain compatible');
    }
    for (const [file, hash] of hashes) assert.equal(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'), hash);
    console.log('PASS all migration/test input hashes unchanged during validation');
}
try { await main(); }
catch (error) { process.exitCode = 1; console.error('Local group Apple Place ID validation failed:', error); }
finally {
    for (const client of clients) { try { await bounded(client.end(), 3000); } catch { client.connection?.stream?.destroy(); process.exitCode = 1; } }
    for (const state of children.toReversed()) {
        if (state.closed) continue;
        state.child.kill('SIGINT');
        try { await bounded(state.done, 10000); }
        catch { state.child.kill('SIGKILL'); await bounded(state.done, 5000); process.exitCode = 1; }
    }
    if (runtime && children.every(state => state.closed)) await fs.rm(runtime, { recursive: true, force: true });
    console.log('Owned local database stopped; disposable fixture directory cleaned up.');
}
