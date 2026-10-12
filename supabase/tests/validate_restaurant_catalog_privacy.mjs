// Explicit local tooling only. Fresh owned database, private Unix socket, no TCP,
// env/secrets reads, dependency downloads, hosted connections or provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
assert(args.length === 4 && args[0] === '--postgres-bin' && args[2] === '--pg-module' && path.isAbsolute(args[1]) && path.isAbsolute(args[3]),
    'Usage: node validate_restaurant_catalog_privacy.mjs --postgres-bin /absolute/bin --pg-module /absolute/pg/lib/index.js');
assert(process.getuid?.() !== 0, 'Use an ordinary local user');
const native = args[1], pgModule = args[3], root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = '11111111-1111-1111-1111-111111111111', other = '22222222-2222-2222-2222-222222222222', member = '33333333-3333-3333-3333-333333333333';
const children = [], clients = [], hashes = new Map(); let runtime;
// Prevent inherited PG*/NODE*/app configuration from affecting this local harness.
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
    runtime = await fs.mkdtemp('/private/tmp/groupbite-catalog-privacy-');
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
    const migrations = (await fs.readdir(path.join(root, 'migrations'))).filter(file => file.endsWith('.sql')).sort();
    assert.equal(migrations.length, 12); assert.equal(migrations[11], '20261011001200_restaurant_catalog_privacy.sql');
    for (const migration of migrations.slice(0, 11)) await admin.query(await source('migrations/' + migration));
    await admin.query("insert into auth.users values($1,'{}'),($2,'{}'),($3,'{}')", [owner, other, member]);
    await admin.query('begin; set local role authenticated');
    await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    const preMap=(await admin.query("select (public.create_group('Pre-map group')).id as id")).rows[0].id;
    await admin.query("select public.save_restaurant_visit('pre-map-save',$1,'Pre-map restaurant','Original historical address',visit_rating=>4)",[[preMap]]);
    await admin.query('commit');
    const suites = ['foundation.sql','private_group_invites.sql','group_member_roster.sql',
        'restaurants_and_visits.sql','visit_management.sql','group_membership_lifecycle.sql',
        'personal_saved_places.sql','saved_locations.sql','address_autocomplete_groundwork.sql'];
    // Historical suites verify their original schema contracts before the forward
    // privacy correction. The new suite verifies the changed contract afterward.
    for (const suite of suites) {
        if (suite === 'saved_locations.sql') await admin.query("select set_config('groupbite.local_validation','saved-locations',false)");
        if (suite === 'address_autocomplete_groundwork.sql') await admin.query("select set_config('groupbite.local_validation','address-autocomplete-groundwork',false)");
        await admin.query(await source('tests/' + suite)); console.log('PASS historical SQL suite: ' + suite);
    }
    const raceSuites = [
        ['visit-management','visit_management_concurrency.mjs','runVisitManagementConcurrency'],
        ['group-membership-lifecycle','group_membership_lifecycle_concurrency.mjs','runGroupMembershipLifecycleConcurrency'],
        ['personal-places','personal_saved_places_concurrency.mjs','runPersonalPlacesConcurrency'],
        ['saved-locations','saved_locations_concurrency.mjs','runSavedLocationsConcurrency'],
        ['address-autocomplete-groundwork','address_autocomplete_groundwork_concurrency.mjs','runAddressAutocompleteGroundworkConcurrency'],
    ];
    for (const [marker,file,name] of raceSuites) {
        await source('tests/' + file);
        await admin.query("select set_config('groupbite.local_validation',$1,false)",[marker]);
        const suite = await import('./' + file);
        const count = await suite[name]({admin,a,b,owner,member,other});
        console.log('PASS historical concurrency: ' + marker + ' (' + count + ' cases)');
    }
    await admin.query('begin; set local role authenticated');
    await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    const groups = (await admin.query("select (public.create_group('Historical one')).id as a, (public.create_group('Historical two')).id as b")).rows[0];
    await admin.query("select public.save_restaurant_visit('historical-shared',$1,'Historical shared','Historical address','Original cuisine')", [[groups.a,groups.b]]);
    await admin.query("select public.save_restaurant_visit_with_location_bindings('historical-bound',$1,'Historical shared','Historical address')", [[groups.a,groups.b]]);
    await admin.query("insert into public.personal_places(name,address,notes,client_request_id) values('Historical manual place','Manual address','Original memory','historical-personal')");
    await admin.query('commit');
    const tables = ['profiles','groups','group_memberships','group_invites','join_requests','restaurants','group_restaurants',
        'visits','visit_save_requests','personal_places','group_restaurant_locations','personal_place_locations','visit_save_location_bindings','geoapify_request_admissions'];
    async function snapshot() {
        const result = {};
        for (const table of tables) result[table] = (await admin.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows;
        return result;
    }
    const before = await snapshot();
    const unchangedFunctions = async () => (await admin.query(`select p.oid,pg_get_functiondef(p.oid),p.proacl::text from pg_proc p
        where p.pronamespace='public'::regnamespace and p.prokind='f'
        and p.proname not in ('save_restaurant_visit','save_restaurant_visit_with_location_bindings','get_visit_save_location_targets') order by p.oid`)).rows;
    const functionsBefore=await unchangedFunctions();
    const saveAclBefore=(await admin.query("select proacl::text from pg_proc where oid='public.save_restaurant_visit(text,uuid[],text,text,text,date,integer,boolean,text)'::regprocedure")).rows;
    await admin.query(await source('migrations/' + migrations[11]));
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await unchangedFunctions(), functionsBefore);
    assert.deepEqual((await admin.query("select proacl::text from pg_proc where oid='public.save_restaurant_visit(text,uuid[],text,text,text,date,integer,boolean,text)'::regprocedure")).rows,saveAclBefore);
    console.log('PASS Migration 12 preserves all existing rows, IDs, locations, Visits and receipts');
    await admin.query('begin; set local role authenticated');
    await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    const historical = await admin.query("select * from public.get_visit_save_location_targets('historical-bound')");
    assert.equal(historical.rows.length, 2); assert.equal(new Set(historical.rows.map(row=>row.restaurant_id)).size, 1);
    await admin.query('rollback');
    console.log('PASS historical shared facts and exact location bindings still readable to authorized members');
    await admin.query(await source('tests/restaurant_catalog_privacy.sql'));
    console.log('PASS catalog privacy SQL suite: direct reads, filters, RPCs, save oracles, membership, Owner/Member permissions, multi-group retries/bindings');
    // These original suites are compatible with the tightened read policy and
    // do not depend on the retired global uniqueness contract.
    for (const suite of ['foundation.sql','private_group_invites.sql','group_member_roster.sql']) {
        await admin.query(await source('tests/' + suite)); console.log('PASS post-correction SQL suite: ' + suite);
    }
    await source('tests/geoapify_admission_confirmation.mjs');
    const { runAdmissionConfirmationTests } = await import('./geoapify_admission_confirmation.mjs');
    await admin.query("select set_config('groupbite.local_validation','address-autocomplete-groundwork',false)");
    await runAdmissionConfirmationTests({admin,a,b,userA:owner,userB:other});
    await source('tests/restaurant_catalog_privacy_concurrency.mjs');
    const { runCatalogPrivacyConcurrency } = await import('./restaurant_catalog_privacy_concurrency.mjs');
    await admin.query("select set_config('groupbite.local_validation','restaurant-catalog-privacy',false)");
    await runCatalogPrivacyConcurrency({ admin, a, b, owner, other });
    for (const [file, hash] of hashes) assert.equal(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'), hash);
    console.log('PASS complete catalog privacy validation');
}
try { await main(); }
catch (error) { process.exitCode = 1; console.error('Local catalog privacy validation failed:', error); }
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
