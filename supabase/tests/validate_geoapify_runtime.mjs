// Explicit local tooling only; fresh Unix-socket PostgreSQL, loopback PostgREST,
// mocked Auth/provider, existing public synthetic fixtures. No env files or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const args = process.argv.slice(2);
assert(args.length === 8 && args[0] === '--postgres-bin' && args[2] === '--pg-module' && args[4] === '--deno' && args[6] === '--postgrest',
    'Usage: node validate_geoapify_runtime.mjs --postgres-bin /absolute/bin --pg-module /absolute/pg/lib/index.js --deno /absolute/deno --postgrest /absolute/postgrest');
const [native, pgModule, deno, postgrest] = [args[1], args[3], args[5], args[7]];
for (const value of [native, pgModule, deno, postgrest]) assert(path.isAbsolute(value));
assert(process.getuid?.() !== 0, 'Run as an ordinary user');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userA = '11111111-1111-1111-1111-111111111111', userB = '22222222-2222-2222-2222-222222222222';
const owner = '00000000-0000-0000-0000-000000000001', member = '00000000-0000-0000-0000-000000000002', other = '00000000-0000-0000-0000-000000000003';
const processes = [], clients = [], hashes = new Map();
let runtime, gateway, database;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms = 30000) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Local operation timed out')), ms); })]); }
    finally { clearTimeout(timer); }
}
function launch(binary, argv, extraEnv = {}) {
    const child = spawn(binary, argv, { cwd: runtime, env: { PATH: '/usr/bin:/bin', TMPDIR: runtime, LC_ALL: 'C', TZ: 'UTC',
        DENO_DIR: path.join(runtime, 'deno-cache'), ...extraEnv }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const state = { child, output: '', closed: false };
    const output = chunk => { state.output = (state.output + chunk).slice(-16000); };
    child.stdout.on('data', output); child.stderr.on('data', output);
    state.done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => { state.closed = true; resolve(code); }); });
    processes.push(state); return state;
}
async function stop(state) {
    if (!state || state.closed) return;
    state.child.kill('SIGINT');
    try { await bounded(state.done, 10000); }
    catch { state.child.kill('SIGKILL'); await bounded(state.done, 5000); throw new Error('Local process required forced shutdown'); }
}
async function freePort() {
    const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function source(file) {
    const filename = path.join(root, file); assert.equal(await fs.realpath(filename), filename, 'No symlinked inputs');
    const bytes = await fs.readFile(filename); hashes.set(filename, crypto.createHash('sha256').update(bytes).digest('hex')); return bytes.toString();
}
async function main() {
    runtime = await fs.mkdtemp('/private/tmp/groupbite-geo-runtime-');
    const socket = path.join(runtime, 'socket'); await fs.mkdir(socket, { mode: 0o700 });
    const port = await freePort(); const db = path.join(runtime, 'db');
    const init = launch(path.join(native, 'initdb'), ['-D', db, '--auth=trust', '--username=postgres', '--locale=C', '--encoding=UTF8']);
    assert.equal(await bounded(init.done), 0, init.output);
    // No TCP listener and no password: only the private disposable socket directory.
    database = launch(path.join(native, 'postgres'), ['-D', db, '-p', String(port), '-h', '', '-k', socket,
        '-c', 'fsync=on', '-c', 'synchronous_commit=on', '-c', 'statement_timeout=30000', '-c', 'idle_in_transaction_session_timeout=30000']);
    const { default: pg } = await import(pathToFileURL(pgModule).href);
    for (let i = 0; i < 100 && !database.output.includes('database system is ready to accept connections'); i++) {
        assert(!database.closed, database.output); await sleep(50);
    }
    assert(database.output.includes('database system is ready to accept connections'), database.output);
    async function connect(name) {
        const client = new pg.Client({ host: socket, port, user: 'postgres', database: 'postgres', application_name: name,
            connectionTimeoutMillis: 3000, query_timeout: 30000 });
        clients.push(client); client.on('error', () => {}); await client.connect(); return client;
    }
    const admin = await connect('runtime-fixtures'), observer = await connect('independent-commit-observer');
    const settings = (await observer.query("select current_setting('fsync') as fsync,current_setting('synchronous_commit') as sync")).rows[0];
    assert.equal(settings.fsync, 'on'); assert.equal(settings.sync, 'on');
    await admin.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
        create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
        grant usage on schema auth to anon,authenticated,service_role;
        alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
        alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
    const migrations = (await fs.readdir(path.join(root, 'migrations'))).filter(file => file.endsWith('.sql')).sort(); assert.equal(migrations.length, 10);
    for (const file of migrations.slice(0, 8)) await admin.query(await source('migrations/' + file));
    for (const id of [owner, member, other, userA, userB]) await admin.query("insert into auth.users values($1,'{\"display_name\":\"Runtime fixture\"}')", [id]);
    await admin.query('begin; set local role authenticated');
    await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    const historicalGroup = (await admin.query("select (public.create_group('Pre-map group')).id as id")).rows[0].id;
    await admin.query("select public.save_restaurant_visit('pre-map-save',array[$1::uuid],'Pre-map restaurant','Original historical address',visit_rating=>4)", [historicalGroup]);
    await admin.query("insert into public.personal_places(name,address,client_request_id) values('Pre-map private place','Original private address','pre-map-personal')");
    await admin.query('commit');
    await admin.query(await source('migrations/' + migrations[8]));
    // Migration 10 must only add its function; existing definitions, ACLs,
    // tables, RLS and policies must remain identical over populated data.
    const snapshot = async () => ({
        functions: (await admin.query(`select p.oid,pg_get_functiondef(p.oid),p.proacl::text from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
            and p.proname<>'confirm_geoapify_request' and p.prokind='f' order by p.oid`)).rows,
        tables: (await admin.query(`select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class
            where relnamespace='public'::regnamespace order by oid`)).rows,
        policies: (await admin.query(`select * from pg_policies where schemaname='public' order by tablename,policyname`)).rows,
    });
    const beforeConfirmation = await snapshot();
    await admin.query(await source('migrations/' + migrations[9]));
    assert.deepEqual(await snapshot(), beforeConfirmation);
    console.log('PASS Migration 10 preserves existing function definitions, grants, tables and policies');
    const suites = ['foundation.sql', 'private_group_invites.sql', 'group_member_roster.sql', 'restaurants_and_visits.sql',
        'visit_management.sql', 'group_membership_lifecycle.sql', 'personal_saved_places.sql', 'saved_locations.sql', 'address_autocomplete_groundwork.sql'];
    for (const file of suites) {
        await admin.query("select set_config('groupbite.local_validation',$1,false)", [file.startsWith('address_') ? 'address-autocomplete-groundwork' : 'saved-locations']);
        await admin.query(await source('tests/' + file)); console.log('PASS SQL suite ' + file);
    }
    const a = await connect('runtime-race-a'), b = await connect('runtime-race-b');
    await admin.query("select set_config('groupbite.local_validation','address-autocomplete-groundwork',false)");
    await source('tests/address_autocomplete_groundwork_concurrency.mjs');
    const { runAddressAutocompleteGroundworkConcurrency } = await import('./address_autocomplete_groundwork_concurrency.mjs');
    const races = await runAddressAutocompleteGroundworkConcurrency({ admin, a, b, owner, member, other });
    console.log('PASS ' + races + ' Migration 9 lock-wait concurrency cases');
    await source('tests/geoapify_admission_confirmation.mjs');
    const { runAdmissionConfirmationTests } = await import('./geoapify_admission_confirmation.mjs');
    await runAdmissionConfirmationTests({ admin, a, b, userA, userB });


    // No JWT signing credentials are needed: the private loopback-only PostgREST
    // fixtures use an anonymous service role. The gateway separately checks the
    // handler's synthetic service headers; this does NOT simulate gateway JWT auth.
    const endpoints = {};
    for (const [mode, txEnd] of [['commit', 'commit-allow-override'], ['silent-rollback', 'rollback'], ['no-ack-commit', 'commit']]) {
        const httpPort = await freePort();
        const configFile = path.join(runtime, mode + '.conf');
        const uri = `postgresql://postgres@/postgres?host=${encodeURIComponent(socket)}&port=${port}`;
        await fs.writeFile(configFile, `db-uri = "${uri}"\ndb-schemas = "public"\ndb-anon-role = "service_role"\ndb-tx-end = "${txEnd}"\nserver-host = "127.0.0.1"\nserver-port = ${httpPort}\n`, { mode: 0o600 });
        const processState = launch(postgrest, [configFile], { DYLD_LIBRARY_PATH: path.join(path.dirname(native), 'lib') });
        const origin = `http://127.0.0.1:${httpPort}`; let ready = false;
        for (let i = 0; i < 100 && !ready; i++) {
            assert(!processState.closed, processState.output);
            try { const response = await fetch(origin, { signal: AbortSignal.timeout(500) }); await response.arrayBuffer(); ready = response.ok; } catch { /* startup */ }
            if (!ready) await sleep(50);
        }
        assert(ready, processState.output); endpoints[mode] = origin;
    }
    let providerCalls = 0, observedCommits = 0, rpcAdmitted = false, confirmationCalls = 0;
    let transactionHeaders = [], permits = [];
    const body = async request => { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; assert(size < 8192); chunks.push(chunk); } return Buffer.concat(chunks).toString(); };
    const reply = (response, data, status = 200, headers = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(data)); };
    gateway = http.createServer((request, response) => { void (async () => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname; const mode = request.headers['x-test-mode'];
        assert(['commit', 'silent-rollback', 'reported-rollback', 'no-ack-commit', 'quota-body-stall', 'confirmation-body-stall', 'missing-confirmation', 'shared-budget', 'provider-body-stall', 'provider-failure'].includes(mode));
        if (pathname.startsWith('/control/')) {
            const action = pathname.slice('/control/'.length);
            if (action === 'reset') {
                await admin.query('truncate public.geoapify_request_admissions');
                providerCalls = 0; observedCommits = 0; rpcAdmitted = false; confirmationCalls = 0; transactionHeaders = []; permits = [];
            } else if (action === 'user-limit' || action === 'global-limit') {
                await admin.query("insert into public.geoapify_request_admissions(user_id,admitted_at,permit_expires_at) select $1,statement_timestamp()-interval '2 hours',statement_timestamp()-interval '2 hours'+interval '1 second' from generate_series(1,$2)",
                    [action === 'user-limit' ? userA : userB, action === 'user-limit' ? 100 : 1000]);
            } else assert.equal(action, 'state');
            return reply(response, { rows: (await observer.query('select count(*)::int as n from public.geoapify_request_admissions')).rows[0].n,
                providerCalls, observedCommits, transactionHeaders, rpcAdmitted, confirmationCalls });
        }
        if (pathname === '/auth/v1/user') {
            assert.equal(request.headers.apikey, 'synthetic-anon-key'); const bearer = request.headers.authorization;
            return bearer === 'Bearer aaa.e30.signature' || bearer === 'Bearer bbb.e30.signature'
                ? reply(response, { id: bearer === 'Bearer aaa.e30.signature' ? userA : userB, role: 'authenticated', is_anonymous: false })
                : reply(response, {}, 401);
        }
        if (pathname === '/rest/v1/rpc/reserve_geoapify_request') {
            assert.equal(request.headers.apikey, 'synthetic-service-role-key'); assert.equal(request.headers.authorization, 'Bearer synthetic-service-role-key');
            assert.equal(request.headers.prefer, 'tx=commit');
            const payload = JSON.parse(await body(request)); assert.deepEqual(Object.keys(payload), ['acting_user_id']); assert([userA, userB].includes(payload.acting_user_id));
            const rpc = await fetch((endpoints[mode] ?? endpoints.commit) + '/rpc/reserve_geoapify_request', { method: 'POST',
                headers: { 'Content-Type': 'application/json', Prefer: mode === 'reported-rollback' ? 'tx=rollback' : 'tx=commit' },
                body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(5000) });
            const result = await rpc.json(); const applied = rpc.headers.get('Preference-Applied') ?? ''; transactionHeaders.push(applied);
            if (result[0]?.admitted === true) {
                rpcAdmitted = true;
                // Observe persistence BEFORE returning the RPC response to Deno.
                // The handler cannot dispatch its mock-provider request until then.
                const visible = (await observer.query('select user_id from public.geoapify_request_admissions where id=$1', [result[0].admission_id])).rows[0];
                permits.push({ id: result[0].admission_id, user: payload.acting_user_id, used: false, confirmed: false,
                    visibleBeforeResponse: visible?.user_id === payload.acting_user_id });
            }
            if (mode === 'quota-body-stall') {
                response.writeHead(200, { 'Content-Type': 'application/json', 'Preference-Applied': applied }); response.write('['); return;
            }
            if (mode === 'shared-budget') await sleep(450);
            return reply(response, result, rpc.status, applied ? { 'Preference-Applied': applied } : {});
        }
        if (pathname === '/rest/v1/rpc/confirm_geoapify_request') {
            confirmationCalls++;
            assert.equal(request.headers.apikey, 'synthetic-service-role-key');
            assert.equal(request.headers.authorization, 'Bearer synthetic-service-role-key');
            const payload = JSON.parse(await body(request));
            assert.deepEqual(Object.keys(payload), ['target_admission_id', 'acting_user_id', 'expected_permit_expires_at']);
            if (mode === 'missing-confirmation') return reply(response, {}, 404);
            // Always a new PostgREST transaction, including when the reservation
            // endpoint silently rolls back. Readback itself writes nothing.
            const rpc = await fetch((endpoints[mode] ?? endpoints['no-ack-commit']) + '/rpc/confirm_geoapify_request', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(5000) });
            const confirmed = await rpc.json();
            if (confirmed === true) {
                const permit = permits.find(item => item.id === payload.target_admission_id && item.user === payload.acting_user_id);
                assert(permit?.visibleBeforeResponse, 'Confirmation requires independently committed reservation');
                permit.confirmed = true;
            }
            if (mode === 'confirmation-body-stall') {
                response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('t'); return;
            }
            if (mode === 'shared-budget') await sleep(450);
            return reply(response, confirmed, rpc.status);
        }
        assert.equal(pathname, '/mock-provider');
        assert.equal(request.headers['x-api-key'], 'synthetic-geoapify-key');
        assert.equal(request.headers.authorization, undefined); assert.equal(request.headers.apikey, undefined);
        providerCalls++;
        const permit = permits.find(item => !item.used && item.confirmed); assert(permit, 'Provider attempt has no distinct admission'); permit.used = true;
        assert(permit.visibleBeforeResponse, 'Admission was not independently visible before dispatch could begin');
        // This connection did not execute the admission RPC and never opens a
        // transaction. Visibility here proves the row was committed, not just returned.
        const persisted = (await observer.query('select user_id,permit_expires_at>clock_timestamp() as timely from public.geoapify_request_admissions where id=$1', [permit.id])).rows[0];
        assert(persisted && persisted.user_id === permit.user && persisted.timely, 'Uncommitted, wrong-account or expired provider admission'); observedCommits++;
        if (mode === 'provider-body-stall') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{'); return; }
        if (mode === 'provider-failure') return reply(response, { error: 'synthetic_provider_failure' }, 500);
        return reply(response, { results: [{ place_id: 'fixture-building', formatted: '100 Market Street, San Francisco, CA, US',
            country_code: 'us', result_type: 'building', housenumber: '100', street: 'Market Street', lat: 37.7749, lon: -122.4194,
            rank: { confidence: 0.95, confidence_building_level: 0.95, match_type: 'full_match' } }] });
    })().catch(error => { console.error('Local fixture failed: ' + error.message); reply(response, { error: 'fixture_failure' }, 500); }); });
    await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${gateway.address().port}/`;
    await source('tests/geoapify_suggest_runtime.ts');
    for (const file of ['handler.ts', 'http.ts', 'receipts.ts', 'index.ts']) await source('functions/geoapify-suggest/' + file);
    const tests = launch(deno, ['test', '--no-config', '--cached-only', '--allow-net=127.0.0.1', path.join(root, 'tests/geoapify_suggest_runtime.ts'), '--', origin]);
    const code = await bounded(tests.done, 60000); console.log(tests.output); assert.equal(code, 0, 'Deno runtime/database tests failed');
    for (const [filename, hash] of hashes) assert.equal(crypto.createHash('sha256').update(await fs.readFile(filename)).digest('hex'), hash, 'Input changed during validation');
    console.log('PASS independent admission visibility with fsync/synchronous_commit enabled; all migration inputs unchanged');
}
try { await main(); }
catch (error) { process.exitCode = 1; console.error('Runtime validation failed: ' + error.message); }
finally {
    try {
        if (gateway) { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); }
        for (const state of processes.toReversed().filter(state => state !== database)) await stop(state);
        for (const client of clients) await bounded(client.end(), 5000);
        await stop(database);
        if (runtime && processes.every(state => state.closed)) await fs.rm(runtime, { recursive: true, force: true });
        console.log('Owned processes stopped and disposable database removed; downloaded tooling retained.');
    } catch (error) { process.exitCode = 1; console.error('Cleanup failed: ' + error.message); }
}
