// Explicit local tooling only. Fresh owned database, private Unix socket, no TCP,
// app configuration, credentials, downloads, hosted connections or Apple calls.
// Usage: node supabase/tests/validate_personal_apple_place_ids.mjs \
//   --postgres-bin /absolute/postgres/bin --pg-module /absolute/pg/lib/index.js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
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
    runtime = await fs.mkdtemp('/private/tmp/groupbite-personal-apple-ids-');
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
    const migrations = (await fs.readdir(path.join(root, 'migrations'))).filter(file => file.endsWith('.sql')).sort().slice(0, 13);
    assert.equal(migrations.length, 13); assert.equal(migrations[11], '20261011001200_restaurant_catalog_privacy.sql');
    assert.equal(migrations[12], '20261013001300_personal_apple_place_ids.sql');
    for (const migration of migrations.slice(0, 12)) await admin.query(await source('migrations/' + migration));
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
            const row = 'to_jsonb(t)' + (table === 'personal_places' ? " - 'apple_place_id'" : '');
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
                where c.connamespace='public'::regnamespace and c.conname<>'personal_places_apple_place_id_check' order by c.oid`)).rows,
            indexes: (await admin.query("select i.*,pg_get_indexdef(i.indexrelid) as definition from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace order by i.indexrelid")).rows,
            triggers: (await admin.query("select g.oid,g.tgfoid,g.tgenabled,pg_get_triggerdef(g.oid) as definition from pg_trigger g join pg_class c on c.oid=g.tgrelid where c.relnamespace in ('public'::regnamespace,'auth'::regnamespace) order by g.oid")).rows,
            functions: (await admin.query(`select p.oid,p.proowner,p.prolang,p.prorettype,p.proargtypes::text,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text,
                case when p.proname<>'prepare_personal_place' then pg_get_functiondef(p.oid) end as definition
                from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' order by p.oid`)).rows,
            defaults: (await admin.query('select * from pg_default_acl order by oid')).rows,
        };
    }
    const before = await snapshot();
    await admin.query(await source('migrations/' + migrations[12]));
    assert.deepEqual(await snapshot(), before);
    assert.equal((await admin.query('select count(*)::int as n from public.personal_places where apple_place_id is not null')).rows[0].n, 0);
    console.log('PASS Migration 13 preserves all historical data, UUIDs/revisions, Geoapify locations, old columns/grants, RLS, triggers, indexes and other functions');

    await admin.query("select set_config('groupbite.local_validation','personal-apple-place-ids',false)");
    await admin.query(await source('tests/personal_apple_place_ids.sql'));
    console.log('PASS focused SQL: optional/opaque IDs, Unicode validation, narrow grants, owner privacy, retries, normalized address invalidation, rollback and Geoapify compatibility');
    // NUL cannot be represented in PostgreSQL text, including parameterized API inputs.
    await admin.query('begin; set local role authenticated');
    await admin.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await assert.rejects(admin.query("insert into public.personal_places(name,address,client_request_id,apple_place_id) values('Invalid','Address','apple-nul',$1)", ['in\0side']), { code: '22021' });
    await admin.query('rollback');
    console.log('PASS parameterized NUL input rejected');
    for (const suite of ['personal_saved_places.sql','restaurant_catalog_privacy.sql']) {
        await admin.query(await source('tests/' + suite)); console.log('PASS post-Migration-13 regression: ' + suite);
    }
    await source('tests/personal_saved_places_concurrency.mjs');
    const { runPersonalPlacesConcurrency } = await import('./personal_saved_places_concurrency.mjs');
    await admin.query("select set_config('groupbite.local_validation','personal-places',false)");
    const races = await runPersonalPlacesConcurrency({ admin,a,b,owner,member });
    console.log('PASS existing personal-place concurrency: ' + races + ' actual lock/race cases');
    await source('tests/personal_geoapify_attachment.mjs');
    const { runPersonalGeoapifyAttachmentTests } = await import('./personal_geoapify_attachment.mjs');
    // The original attachment suite expects an empty group-location fixture.
    // Its seed was needed above to prove preservation across Migration 13.
    await admin.query('delete from public.group_restaurant_locations where group_restaurant_id=$1', [entry]);
    await admin.query("select set_config('groupbite.local_validation','personal-geoapify-attachment',false)");
    const geoapify = await runPersonalGeoapifyAttachmentTests({ admin,a,b,owner,other });
    console.log('PASS existing Geoapify attachment: ' + geoapify.checks + ' SQL checks, ' + geoapify.races + ' actual lock/race cases');
    for (const [file, hash] of hashes) assert.equal(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'), hash);
    console.log('PASS all migration/test input hashes unchanged during validation');
}
try { await main(); }
catch (error) { process.exitCode = 1; console.error('Local Apple Place ID validation failed:', error); }
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
