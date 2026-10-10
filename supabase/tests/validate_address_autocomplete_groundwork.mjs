// Explicit local binaries + pg module only. No app imports, env files, hosted
// connections, dependency installation, shell execution or existing databases.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--postgres-bin' || args[2] !== '--pg-module'
    || !path.isAbsolute(args[1]) || !path.isAbsolute(args[3])) {
    throw new Error('Usage: node supabase/tests/validate_address_autocomplete_groundwork.mjs --postgres-bin /absolute/bin --pg-module /absolute/pg/lib/index.js');
}
const native = args[1], pgModule = args[3];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrations = [
    '20261004000100_backend_foundation.sql', '20261004000200_private_group_invites.sql',
    '20261004000300_group_member_roster.sql', '20261004000400_restaurants_and_visits.sql',
    '20261006000500_visit_management.sql', '20261006000600_group_membership_lifecycle.sql',
    '20261007000700_personal_saved_places.sql', '20261009000800_saved_locations.sql',
    '20261009000900_address_autocomplete_groundwork.sql',
];
const suites = ['foundation.sql', 'private_group_invites.sql', 'group_member_roster.sql',
    'restaurants_and_visits.sql', 'visit_management.sql', 'group_membership_lifecycle.sql',
    'personal_saved_places.sql', 'saved_locations.sql', 'address_autocomplete_groundwork.sql'];
const raceFiles = ['visit_management_concurrency.mjs', 'group_membership_lifecycle_concurrency.mjs',
    'personal_saved_places_concurrency.mjs', 'saved_locations_concurrency.mjs', 'address_autocomplete_groundwork_concurrency.mjs'];
// Prevent inherited PG*/NODE*/app configuration from affecting clients or binaries.
for (const key of Object.keys(process.env)) delete process.env[key];
const clients = [];
let runtime, server, stopping = false;
const children = [];
const password = crypto.randomBytes(24).toString('hex');
const port = crypto.randomInt(49152, 65000);
const owner = '00000000-0000-0000-0000-000000000001';
const member = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
const assert = (ok, label) => { if (!ok) throw new Error(label); };
const say = message => process.stdout.write(message + '\n');

async function bounded(promise, ms, label) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(label)), ms);
        })]);
    } finally { clearTimeout(timer); }
}
function launch(name, argv, env) {
    const child = spawn(path.join(native, name), argv, { cwd: runtime, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const managed = { child, output: '', closed: false };
    children.push(managed);
    child.stdout.on('data', chunk => { managed.output = (managed.output + chunk).slice(-20000); });
    child.stderr.on('data', chunk => { managed.output = (managed.output + chunk).slice(-20000); });
    managed.done = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code => { managed.closed = true; managed.code = code; resolve(code); });
    });
    return managed;
}
async function cleanup() {
    stopping = true;
    const errors = [];
    for (const managed of children.toReversed()) {
        if (managed.closed) continue;
        managed.child.kill('SIGINT');
        try { await bounded(managed.done, 10000, 'Local database shutdown timed out'); }
        catch (error) {
            errors.push(error);
            managed.child.kill('SIGKILL');
            try { await bounded(managed.done, 5000, 'Forced shutdown timed out'); } catch (failure) { errors.push(failure); }
        }
        if (managed.code !== 0) errors.push(new Error('Local subprocess did not shut down cleanly'));
    }
    for (const client of clients) {
        try { await bounded(client.end(), 3000, 'Client shutdown timed out'); }
        catch (error) { client.connection?.stream?.destroy(); errors.push(error); }
    }
    if (runtime && children.every(child => child.closed)) await fs.rm(runtime, { recursive: true, force: true });
    if (errors.length) throw new AggregateError(errors, 'Disposable database cleanup failed');
}
const interrupt = () => { if (server && !server.closed) server.child.kill('SIGINT'); };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

async function main() {
    assert(process.getuid?.() !== 0, 'Do not run local validation as root');
    const { default: pg } = await import(pathToFileURL(pgModule).href);
    runtime = await fs.mkdtemp('/private/tmp/groupbite-m15-validation-');
    const sql = new Map(), hashes = new Map();
    for (const name of [...migrations.map(file => 'migrations/' + file),
        ...suites.map(file => 'tests/' + file), ...raceFiles.map(file => 'tests/' + file)]) {
        const source = path.join(root, name);
        assert(await fs.realpath(source) === source, 'No symlinked test inputs');
        const content = await fs.readFile(source);
        hashes.set(name, crypto.createHash('sha256').update(content).digest('hex'));
        sql.set(name, content.toString('utf8'));
        await fs.mkdir(path.dirname(path.join(runtime, name)), { recursive: true });
        await fs.writeFile(path.join(runtime, name), content, { flag: 'wx' });
    }
    await fs.writeFile(path.join(runtime, 'manifest.json'), JSON.stringify(Object.fromEntries(hashes)));
    const database = path.join(runtime, 'db'), socket = path.join(runtime, 'socket'), pwFile = path.join(runtime, 'password');
    await fs.mkdir(socket, { mode: 0o700 });
    await fs.writeFile(pwFile, password + '\n', { mode: 0o600, flag: 'wx' });
    const env = { PATH: '/usr/bin:/bin', TMPDIR: runtime, LC_ALL: 'C', TZ: 'UTC' };
    const initdb = launch('initdb', ['-D', database, '--auth=scram-sha-256', '--username=postgres',
        '--pwfile=' + pwFile, '--locale=C', '--encoding=UTF8'], env);
    assert(await bounded(initdb.done, 30000, 'initdb timed out') === 0, 'initdb failed: ' + initdb.output);
    await fs.unlink(pwFile);
    server = launch('postgres', ['-D', database, '-p', String(port), '-h', '127.0.0.1', '-k', socket,
        '-c', 'ssl=off', '-c', 'shared_preload_libraries=', '-c', 'logging_collector=off',
        '-c', 'statement_timeout=30000', '-c', 'idle_in_transaction_session_timeout=30000'], env);
    const ready = new Promise(resolve => server.child.stderr.on('data', () => {
        if (server.output.includes('database system is ready to accept connections')) resolve();
    }));
    await bounded(Promise.race([ready, server.done.then(() => { throw new Error('Local PostgreSQL startup failed: ' + server.output); })]),
        15000, 'Local PostgreSQL startup timed out');
    async function connect(name) {
        assert(!server.closed, 'Owned local PostgreSQL must be running before connecting');
        const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres',
            application_name: name, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 60000 });
        client.on('error', error => { if (!stopping) say('Local client error: ' + error.message); });
        clients.push(client);
        await client.connect();
        return client;
    }
    const admin = await connect('groupbite-m15-admin');
    await admin.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
        create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
        grant usage on schema auth to anon, authenticated, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
    for (const file of migrations.slice(0, 7)) await admin.query(sql.get('migrations/' + file));
    await admin.query(`insert into auth.users values ('${owner}','{"display_name":"Owner"}'),
        ('${member}','{"display_name":"Member"}'),('${other}','{"display_name":"Other"}');`);
    // Seed historical data through unchanged save paths before applying migration 8.
    await admin.query(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${owner}',true);`);
    const group = (await admin.query("select (public.create_group('Pre-map group')).id as id")).rows[0].id;
    await admin.query("select public.save_restaurant_visit('pre-map-save',array[$1::uuid],'Pre-map restaurant','Original historical address',visit_rating => 4)", [group]);
    await admin.query("insert into public.personal_places(name,address,client_request_id) values('Pre-map private place','Original private address','pre-map-personal')");
    await admin.query('commit');
    const oldTables = ['profiles', 'groups', 'group_memberships', 'group_invites', 'join_requests',
        'restaurants', 'group_restaurants', 'visits', 'visit_save_requests', 'personal_places'];
    async function snapshot() {
        const rows = {};
        for (const table of oldTables) rows[table] = (await admin.query(`select coalesce(jsonb_agg(row order by row::text),'[]') as data from
            (select to_jsonb(t) as row from public.${table} t) x`)).rows[0].data;
        rows.functions = (await admin.query("select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as definition, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by signature")).rows;
        rows.policies = (await admin.query('select * from pg_policies where schemaname=\'public\' order by tablename, policyname')).rows;
        rows.grants = (await admin.query('select * from information_schema.table_privileges where table_schema=\'public\' and table_name=any($1) order by table_name,grantee,privilege_type', [oldTables])).rows;
        rows.columns = (await admin.query('select * from information_schema.column_privileges where table_schema=\'public\' and table_name=any($1) order by table_name,column_name,grantee,privilege_type', [oldTables])).rows;
        return rows;
    }
    const before = await snapshot();
    // A schema mismatch must fail atomically, without moving a hosted extension.
    await admin.query('begin; create extension postgis with schema public');
    try { await admin.query(sql.get('migrations/' + migrations[7])); throw new Error('Schema mismatch unexpectedly succeeded'); }
    catch (error) { assert(error.code === 'P0001' && error.message.includes('extensions schema'), 'Explicit PostGIS schema mismatch required'); }
    await admin.query('rollback');
    await admin.query(sql.get('migrations/' + migrations[7]));
    const after = await snapshot();
    for (const key of ['functions', 'policies']) {
        const originals = key === 'functions' ? new Set(before[key].map(row => row.signature)) : new Set(oldTables);
        after[key] = after[key].filter(row => originals.has(key === 'functions' ? row.signature : row.tablename));
    }
    assert(JSON.stringify(before) === JSON.stringify(after), 'Migration 8 must preserve historical rows, old functions, policies and grants');
    assert((await admin.query('select count(*)::int as n from public.group_restaurant_locations')).rows[0].n === 0
        && (await admin.query('select count(*)::int as n from public.personal_place_locations')).rows[0].n === 0, 'No automatic backfill');
    say('Passed migration 8 schema guard and preservation of rows/functions/RLS/grants; no backfill.');
    say((await admin.query('select extensions.postgis_full_version() as version')).rows[0].version);
    // Preserve populated migration-8 location sidecars as well as all original objects.
    const historical = (await admin.query("select gr.id,gr.restaurant_id from public.group_restaurants gr where gr.group_id=$1", [group])).rows[0];
    const historicalPersonal = (await admin.query("select id from public.personal_places where client_request_id='pre-map-personal'")).rows[0].id;
    await admin.query('begin; set local role service_role');
    await admin.query("select public.attach_verified_restaurant_location($1,$2,$3,$4,'Original historical address',0,0,'synthetic','pre-nine','Standardized historical','building')",
        [owner,group,historical.restaurant_id,historical.id]);
    await admin.query("select public.attach_verified_personal_place_location($1,$2,1,'Original private address',0,0,'synthetic','pre-nine-personal','Standardized private','address')", [owner,historicalPersonal]);
    await admin.query('commit');
    oldTables.push('group_restaurant_locations', 'personal_place_locations');
    async function snapshotNine() {
        const state = await snapshot();
        state.rls = (await admin.query("select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1) order by c.relname",[oldTables])).rows;
        state.constraints = (await admin.query("select c.relname,x.conname,pg_get_constraintdef(x.oid) as definition from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1) order by c.relname,x.conname",[oldTables])).rows;
        state.triggers = (await admin.query("select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition,x.conrelid::regclass::text as constraint_table from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace left join pg_constraint x on x.oid=t.tgconstraint where n.nspname='public' and c.relname=any($1) order by c.relname,t.tgname",[oldTables])).rows;
        state.indexes = (await admin.query("select * from pg_indexes where schemaname='public' and tablename=any($1) order by tablename,indexname",[oldTables])).rows;
        state.definitions = (await admin.query("select * from information_schema.columns where table_schema='public' and table_name=any($1) order by table_name,ordinal_position",[oldTables])).rows;
        return state;
    }
    const beforeNine = await snapshotNine();
    await admin.query(sql.get('migrations/' + migrations[8]));
    const afterNine = await snapshotNine();
    const oldFunctions = new Set(beforeNine.functions.map(row => row.signature));
    afterNine.functions = afterNine.functions.filter(row => oldFunctions.has(row.signature));
    afterNine.policies = afterNine.policies.filter(row => oldTables.includes(row.tablename));
    // PostgreSQL adds two internal parent-side FK triggers on the original
    // receipt table. Existing triggers must still be byte-for-byte unchanged.
    const oldTriggers = new Set(beforeNine.triggers.map(row => row.relname + ':' + row.tgname));
    const addedTriggers = afterNine.triggers.filter(row => !oldTriggers.has(row.relname + ':' + row.tgname));
    assert(addedTriggers.length === 2 && addedTriggers.every(row => row.relname === 'visit_save_requests'
        && row.constraint_table === 'visit_save_location_bindings'), 'Only additive binding FK triggers allowed on original tables');
    afterNine.triggers = afterNine.triggers.filter(row => oldTriggers.has(row.relname + ':' + row.tgname));
    for (const key of Object.keys(beforeNine)) {
        assert(JSON.stringify(beforeNine[key]) === JSON.stringify(afterNine[key]),
            'Migration 9 changed historical state: ' + key);
    }
    assert((await admin.query('select count(*)::int as n from public.visit_save_location_bindings')).rows[0].n === 0
        && (await admin.query('select count(*)::int as n from public.geoapify_request_admissions')).rows[0].n === 0,
        'Migration 9 must not backfill bindings or usage');
    say('Passed migration 9 populated-data preservation, including migration 8 coordinates/revisions; no backfill.');

    await admin.query("select set_config('groupbite.local_validation','saved-locations',false)");
    for (const file of suites) {
        if (file === 'address_autocomplete_groundwork.sql') await admin.query("select set_config('groupbite.local_validation','address-autocomplete-groundwork',false)");
        await admin.query(sql.get('tests/' + file));
        say('Passed SQL suite: ' + file);
    }
    const a = await connect('groupbite-m15-race-a'), b = await connect('groupbite-m15-race-b');
    // Preserve the three original overlapping save/retry/global-reuse checks.
    async function beginAs(client, user) {
        await client.query('begin; set local role authenticated');
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    }
    await beginAs(admin, owner);
    const groups = (await admin.query("select (public.create_group('Save race A')).id as a, (public.create_group('Save race B')).id as b")).rows[0];
    await admin.query('commit');
    await admin.query('insert into public.group_memberships(group_id,user_id) values($1,$3),($2,$3)', [groups.a, groups.b, member]);
    const save = 'select public.save_restaurant_visit($1,$2::uuid[],$3,$4,visit_rating=>$5,visit_notes=>$6) as id';
    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    async function compete(firstUser, secondUser, firstArgs, secondArgs) {
        await beginAs(a, firstUser); await beginAs(b, secondUser);
        await a.query(save, firstArgs);
        const pending = b.query(save, secondArgs).then(value => ({ value }), error => ({ error }));
        let waited = false;
        for (let attempt = 0; attempt < 60; attempt++) {
            if ((await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [bPid])).rows[0]?.wait_event_type === 'Lock') { waited = true; break; }
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert(waited, 'Save writers must overlap and wait on a lock');
        await a.query('commit');
        const result = await pending;
        if (result.error) throw result.error;
        await b.query('commit');
    }
    await compete(owner, member, ['save-race-a', [groups.a], 'Core race cafe', 'Same address', 5, 'core-race'],
        ['save-race-b', [groups.a], 'Core race cafe', 'Same address', 3, 'core-race']);
    let count = (await admin.query("select count(distinct gr.id)::int as entries,count(v.id)::int as visits from public.group_restaurants gr join public.restaurants r on r.id=gr.restaurant_id join public.visits v on v.group_restaurant_id=gr.id where r.name='Core race cafe'")).rows[0];
    assert(count.entries === 1 && count.visits === 2, 'Concurrent saves preserve one entry and independent memories');
    await compete(owner, owner, ['save-race-retry', [groups.a, groups.b], 'Core retry cafe', 'Retry address', 4, 'core-retry'],
        ['save-race-retry', [groups.b, groups.a], 'Core retry cafe', 'Retry address', 4, 'core-retry']);
    assert((await admin.query("select count(*)::int as n from public.visits where notes='core-retry'")).rows[0].n === 2, 'Concurrent multi-group retries preserve exactly one Visit per group');
    await compete(owner, member, ['save-global-a', [groups.a], 'Core global cafe', 'Global address', 5, 'core-global'],
        ['save-global-b', [groups.b], 'Core global cafe', 'Global address', 1, 'core-global']);
    count = (await admin.query("select count(distinct r.id)::int as restaurants,count(distinct gr.id)::int as entries,count(v.id)::int as visits from public.restaurants r join public.group_restaurants gr on gr.restaurant_id=r.id join public.visits v on v.group_restaurant_id=gr.id where r.name='Core global cafe'")).rows[0];
    assert(count.restaurants === 1 && count.entries === 2 && count.visits === 2, 'Concurrent saves across groups reuse global facts without merging private memories');
    say('Passed 3 original overlapping save/retry/global-reuse cases.');
    const raceSuites = [
        ['visit-management', raceFiles[0], 'runVisitManagementConcurrency'],
        ['group-membership-lifecycle', raceFiles[1], 'runGroupMembershipLifecycleConcurrency'],
        ['personal-places', raceFiles[2], 'runPersonalPlacesConcurrency'],
        ['saved-locations', raceFiles[3], 'runSavedLocationsConcurrency'],
        ['address-autocomplete-groundwork', raceFiles[4], 'runAddressAutocompleteGroundworkConcurrency'],
    ];
    let raceCount = 3;
    for (const [marker, file, exported] of raceSuites) {
        await admin.query("select set_config('groupbite.local_validation',$1,false)", [marker]);
        const module = await import(pathToFileURL(path.join(runtime, 'tests', file)).href);
        const count = await module[exported]({ admin, a, b, owner, member, other });
        raceCount += count;
        say('Passed ' + count + ' concurrency cases: ' + file);
    }
    // Inputs must still match the exact files tested, including migrations 1–8.
    for (const [name, digest] of hashes) assert(crypto.createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex') === digest,
        'Test input changed during validation: ' + name);
    say('Passed ' + suites.length + ' SQL suites and ' + raceCount + ' concurrency cases.');
}
try {
    await main();
} catch (error) {
    process.exitCode = 1;
    process.stderr.write('Validation failed: ' + error.message + '\n');
} finally {
    try { await cleanup(); say('Owned local database stopped; disposable runtime directory removed.'); }
    catch (error) { process.exitCode = 1; process.stderr.write(error.message + '\n'); }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
}
