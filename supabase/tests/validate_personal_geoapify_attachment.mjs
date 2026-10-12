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
    'Usage: node validate_personal_geoapify_attachment.mjs --postgres-bin /absolute/bin --pg-module /absolute/pg/lib/index.js');
assert(process.getuid?.() !== 0, 'Use an ordinary local user');
const native = args[1], pgModule = args[3], root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = '11111111-1111-1111-1111-111111111111', other = '22222222-2222-2222-2222-222222222222';
const children = [], clients = [], hashes = new Map(); let runtime;
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
    runtime = await fs.mkdtemp('/private/tmp/groupbite-personal-attachment-');
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
    const migrations = (await fs.readdir(path.join(root, 'migrations'))).filter(file => file.endsWith('.sql')).sort().slice(0, 11);
    assert.equal(migrations.length, 11); assert.equal(migrations[10], '20261010001100_personal_geoapify_attachment.sql');
    for (const migration of migrations.slice(0, 10)) await admin.query(await source('migrations/' + migration));
    await admin.query("insert into auth.users values($1,'{\"display_name\":\"Fixture owner\"}'),($2,'{\"display_name\":\"Fixture other\"}')", [owner, other]);
    await admin.query('begin; set local role authenticated');
    await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await admin.query("insert into public.personal_places(name,address,notes,client_request_id) values('Historical manual place','Manual address','Original memory','historical-personal')");
    await admin.query('commit');
    const snapshot = async () => ({
        functions: (await admin.query(`select p.oid,pg_get_functiondef(p.oid),p.proacl::text from pg_proc p
            where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname<>'attach_geoapify_personal_place_location' order by p.oid`)).rows,
        tables: (await admin.query("select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace order by oid")).rows,
        policies: (await admin.query("select * from pg_policies where schemaname='public' order by tablename,policyname")).rows,
        saved: (await admin.query('select * from public.personal_places order by id')).rows,
        locations: (await admin.query('select * from public.personal_place_locations order by personal_place_id')).rows,
    });
    const before = await snapshot(); await admin.query(await source('migrations/' + migrations[10])); assert.deepEqual(await snapshot(), before);
    console.log('PASS Migration 11 preserves existing functions, ACLs, RLS, tables and saved data; no backfill');
    await admin.query("select set_config('groupbite.local_validation','personal-geoapify-attachment',false)");
    await source('tests/personal_geoapify_attachment.mjs');
    const { runPersonalGeoapifyAttachmentTests } = await import('./personal_geoapify_attachment.mjs');
    const result = await runPersonalGeoapifyAttachmentTests({ admin, a, b, owner, other });
    for (const [file, hash] of hashes) assert.equal(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'), hash);
    console.log('PASS ' + result.checks + ' real SQL attachment checks and ' + result.races + ' actual lock-wait races');
}
try { await main(); }
catch (error) { process.exitCode = 1; console.error('Local attachment validation failed:', error); }
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
