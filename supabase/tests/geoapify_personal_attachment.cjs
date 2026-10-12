// Executes actual Edge modules. Synthetic fixtures, mocked Fetch, no env/network.
/* global __dirname */
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../functions');
const userA = '11111111-1111-1111-1111-111111111111', userB = '22222222-2222-2222-2222-222222222222';
const placeId = '33333333-3333-3333-3333-333333333333', otherId = '44444444-4444-4444-4444-444444444444';
const tokenA = 'aaa.e30.signature', tokenB = 'bbb.e30.signature', baseTime = Date.parse('2026-10-10T12:00:00Z');
const settings = { supabaseUrl: 'http://127.0.0.1:1', anonKey: 'synthetic-anon-key', serviceRoleKey: 'synthetic-service-role-key',
    selectionSecret: '11'.repeat(32), allowedUserId: userA };
const selection = { id: 'synthetic-building', source: 'geoapify', address: '100 Public Building, Test City, US',
    latitude: 37.7749, longitude: -122.4194, accuracy: 'building', countryCode: 'us' };
let passed = 0;
function modules(globals = {}) {
    const cache = new Map();
    function load(file) {
        const filename = path.resolve(root, file); assert(filename.startsWith(root + path.sep) && filename.endsWith('.ts'));
        if (cache.has(filename)) return cache.get(filename).exports;
        const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        const module = { exports: {} }; cache.set(filename, module);
        vm.runInNewContext(source, { module, exports: module.exports, require: name => {
            assert(name.startsWith('.')); return load(path.relative(root, path.resolve(path.dirname(filename), name))); },
            Request, Response, Headers, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, Uint8Array, Date,
            btoa, atob, crypto: webcrypto, setTimeout, clearTimeout, performance,
            fetch: () => assert.fail('Unexpected native network request'), ...globals }, { filename });
        return module.exports;
    }
    return load;
}
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers } });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function timers() {
    const pending = new Map(); let sequence = 0;
    return { setTimeout(fn, ms) { const id = ++sequence; pending.set(id, { fn, ms }); return id; },
        clearTimeout(id) { pending.delete(id); }, fire(ms) {
            const found = [...pending].find(([, v]) => v.ms === ms); assert(found); pending.delete(found[0]); found[1].fn();
        }, get size() { return pending.size; } };
}
async function until(fn) { for (let i = 0; i < 50 && !fn(); i++) await new Promise(r => setImmediate(r)); assert(fn()); }
async function fixture(options = {}) {
    const selected = options.selection ?? selection;
    const logs = [], calls = [];
    const console = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug', 'trace'].map(k => [k, (...args) => logs.push(args)]));
    const load = modules({ console, ...options.globals });
    const codec = await load('geoapify-suggest/receipts.ts').createReceiptCodec(settings.selectionSecret, settings.supabaseUrl);
    const signed = await codec.sign(userA, selected, baseTime);
    let now = baseTime, location = options.location ?? null;
    const place = { id: placeId, owner_user_id: userA, address: selected.address, revision: 1, name: 'Original personal memory', notes: 'Original notes' };
    const state = { place, get location() { return location; }, calls, logs };
    const handler = load('geoapify-attach-personal/handler.ts').createPersonalAttachmentHandler({ ...settings, ...options.settings }, {
        now: () => now, crypto: options.crypto ?? webcrypto,
        fetch: async (input, init) => {
            const url = new URL(input); assert.equal(url.origin, settings.supabaseUrl);
            assert.equal(init.redirect, 'error'); assert(init.signal);
            const headers = new Headers(init.headers);
            assert(!headers.has('x-api-key'));
            const rpc = url.pathname === '/rest/v1/rpc/attach_geoapify_personal_place_location';
            assert.equal(headers.get('apikey'), rpc ? settings.serviceRoleKey : settings.anonKey);
            assert.equal(headers.get('Authorization'), rpc ? `Bearer ${settings.serviceRoleKey}` : `Bearer ${tokenA}`);
            // Wrong-user Auth is a deliberately separate test identity.
            const call = { url, init }; calls.push(call);
            const override = options.fetch?.(call, state); if (override) return override;
            if (url.pathname === '/auth/v1/user') return reply({ id: userA, role: 'authenticated', is_anonymous: false });
            if (url.pathname === '/rest/v1/personal_places') {
                assert.equal(init.method, 'GET'); assert.equal(url.searchParams.get('owner_user_id'), `eq.${userA}`);
                return reply(url.searchParams.get('id') === `eq.${placeId}` ? [{ ...place }] : []);
            }
            if (rpc) {
                assert.equal(init.method, 'POST'); assert.equal(headers.get('Prefer'), 'tx=commit');
                const data = JSON.parse(init.body);
                assert.deepEqual(Object.keys(data).sort(), ['acting_user_id', 'target_personal_place_id', 'expected_revision', 'expected_address',
                    'verified_latitude', 'verified_longitude', 'provider_result_id', 'receipt_expires_at'].sort());
                assert.equal(data.acting_user_id, userA); assert.equal(data.target_personal_place_id, placeId);
                assert.equal(data.expected_address, selected.address); assert.equal(data.verified_latitude, selected.latitude);
                assert.equal(data.verified_longitude, selected.longitude); assert.equal(data.provider_result_id, selected.id);
                assert.equal(data.receipt_expires_at, signed.expiresAt);
                if (data.expected_revision !== place.revision) return reply({ code: '40001' }, 400);
                if (location) return reply(false);
                location = { personal_place_id: placeId, address_snapshot: place.address, resolution_status: 'resolved',
                    latitude: data.verified_latitude, longitude: data.verified_longitude, resolution_provider: 'geoapify',
                    provider_location_id: data.provider_result_id, standardized_address: data.expected_address, resolution_accuracy: 'building' };
                place.revision++; return reply(true); // No acknowledgement, like hosted default commits.
            }
            assert.equal(url.pathname, '/rest/v1/personal_place_locations'); assert.equal(init.method, 'GET');
            assert.equal(url.searchParams.get('personal_place_id'), `eq.${placeId}`);
            return reply(location ? [location] : []);
        } });
    return { ...state, load, codec, signed, handler, state, setNow(value) { now = value; },
        writes: () => calls.filter(c => c.init.method === 'POST'),
        request(fields = {}, init = {}) { return new Request(settings.supabaseUrl + '/functions/v1/geoapify-attach-personal', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ personalPlaceId: placeId, expectedRevision: 1, selectionReceipt: signed.selectionReceipt, ...fields }), ...init }); } };
}
async function checkError(f, response, status, code) {
    assert.equal(response.status, status); const body = await response.json(); assert.deepEqual(body, { error: { code } });
    assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert(!response.headers.has('Access-Control-Allow-Origin'));
    const raw = JSON.stringify([body, [...response.headers]]);
    for (const value of [settings.anonKey, settings.serviceRoleKey, settings.selectionSecret, tokenA, tokenB, selection.address,
        selection.id, f.signed.selectionReceipt, 'http:', 'https:']) assert(!raw.includes(value));
    assert.deepEqual(f.logs, []);
    assert.equal(f.place.name, 'Original personal memory'); assert.equal(f.place.notes, 'Original notes');
}
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
    await test('Entrypoint reads only necessary server settings and registers a separate non-provider handler', async () => {
        const read = []; let handler;
        const values = { SUPABASE_URL: settings.supabaseUrl, SUPABASE_ANON_KEY: settings.anonKey, SUPABASE_SERVICE_ROLE_KEY: settings.serviceRoleKey,
            GEOAPIFY_SELECTION_SECRET: settings.selectionSecret, GEOAPIFY_ALLOWED_USER_ID: userA };
        modules({ Deno: { env: { get(name) { read.push(name); return values[name]; } }, serve(value) { handler = value; } } })('geoapify-attach-personal/index.ts');
        assert.deepEqual(read, Object.keys(values)); assert.equal(typeof handler, 'function');
    });
    await test('Valid receipt attaches once from signed values, then requires separate user-RLS committed readback', async () => {
        const f = await fixture(), response = await f.handler(f.request()); assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'attached' }); assert.equal(f.writes().length, 1);
        assert.deepEqual(f.calls.map(c => c.url.pathname), ['/auth/v1/user', '/rest/v1/personal_places',
            '/rest/v1/rpc/attach_geoapify_personal_place_location', '/rest/v1/personal_place_locations']);
        assert.equal(f.place.revision, 2); assert.equal(f.place.address, selection.address); assert.deepEqual(f.logs, []);
        assert.deepEqual(JSON.parse(JSON.stringify(await f.codec.verify(f.signed.selectionReceipt, userA, selection.address, baseTime))), selection);
        const verified = await f.codec.verifyForAttachment(f.signed.selectionReceipt, userA, selection.address, baseTime);
        assert.equal(verified.expiresAt, f.signed.expiresAt); assert.deepEqual(JSON.parse(JSON.stringify(verified.selection)), selection);
    });
    await test('Reported 15-significant-digit readback confirms signed coordinates without rounding the write', async () => {
        const precise = { ...selection, latitude: 37.555543739424635, longitude: -121.9829590521408 };
        const f = await fixture({ selection: precise, fetch: (c, state) => c.url.pathname === '/rest/v1/personal_place_locations'
            ? reply([{ ...state.location, latitude: 37.5555437394246, longitude: -121.982959052141 }]) : null });
        const result = await f.handler(f.request()); assert.equal(result.status, 200);
        assert.deepEqual(await result.json(), { status: 'attached' });
        assert.equal(f.state.location.latitude, precise.latitude); assert.equal(f.state.location.longitude, precise.longitude);
        assert.equal(f.place.revision, 2); assert.equal(f.writes().length, 1); assert.deepEqual(f.logs, []);
    });
    await test('15-digit readback across signs and coordinate limits remains confirmed', async () => {
        for (const [latitude, longitude] of [[-37.555543739424635, 121.9829590521408],
            [89.99999999999996, 179.99999999999994], [-89.99999999999996, -179.99999999999994],
            [0.000000000000037555543739424635, -0.000000000001219829590521408]]) {
            const f = await fixture({ selection: { ...selection, latitude, longitude }, fetch: (c, state) =>
                c.url.pathname === '/rest/v1/personal_place_locations' ? reply([{ ...state.location,
                    latitude: Number(latitude.toPrecision(15)), longitude: Number(longitude.toPrecision(15)) }]) : null });
            assert.equal((await f.handler(f.request())).status, 200); assert.equal(f.writes().length, 1);
        }
    });
    await test('Fixed absolute coordinate tolerance has no relative allowance and rejects just beyond its limit', async () => {
        for (const axis of ['latitude', 'longitude']) for (const sign of [-1, 1]) {
            for (const [difference, accepted] of [[1e-12, true], [1.0000000000000002e-12, false]]) {
                const f = await fixture({ selection: { ...selection, latitude: axis === 'latitude' ? 0 : 1,
                    longitude: axis === 'longitude' ? 0 : 1 }, fetch: (c, state) =>
                    c.url.pathname === '/rest/v1/personal_place_locations' ? reply([{ ...state.location, [axis]: sign * difference }]) : null });
                const response = await f.handler(f.request());
                if (accepted) assert.equal(response.status, 200);
                else await checkError(f, response, 503, 'attachment_unconfirmed');
                assert.equal(f.writes().length, 1);
            }
        }
        for (const axis of ['latitude', 'longitude']) for (const sign of [-1, 1]) {
            const f = await fixture({ fetch: (c, state) => c.url.pathname === '/rest/v1/personal_place_locations'
                ? reply([{ ...state.location, [axis]: state.location[axis] + sign * 2e-12 }]) : null });
            await checkError(f, await f.handler(f.request()), 503, 'attachment_unconfirmed'); assert.equal(f.writes().length, 1);
        }
    });
    await test('Readback precision allowance never accepts invalid coordinate types, nonfinite values or out-of-range values', async () => {
        for (const axis of ['latitude', 'longitude']) for (const value of [null, true, '37.7749', NaN, Infinity, -Infinity,
            axis === 'latitude' ? 90.0000000000001 : 180.0000000000001]) {
            const f = await fixture({ fetch: (c, state) => c.url.pathname === '/rest/v1/personal_place_locations'
                ? reply([{ ...state.location, [axis]: value }]) : null });
            await checkError(f, await f.handler(f.request()), 503, 'attachment_unconfirmed'); assert.equal(f.writes().length, 1);
        }
    });
    await test('Rounded coordinates cannot excuse any address, provider, accuracy or target mismatch', async () => {
        for (const mismatch of [{ address_snapshot: selection.address + ' changed' }, { standardized_address: selection.address + ' changed' },
            { resolution_provider: 'other' }, { provider_location_id: 'other' }, { resolution_accuracy: 'address' },
            { personal_place_id: otherId }, { resolution_status: 'unresolved' }]) {
            const f = await fixture({ fetch: (c, state) => c.url.pathname === '/rest/v1/personal_place_locations'
                ? reply([{ ...state.location, latitude: state.location.latitude + 5e-13, ...mismatch }]) : null });
            await checkError(f, await f.handler(f.request()), 503, 'attachment_unconfirmed'); assert.equal(f.writes().length, 1);
        }
    });
    await test('Missing/malformed configuration fails closed without outbound calls', async () => {
        for (const setting of [{ allowedUserId: '' }, { allowedUserId: '*' }, { selectionSecret: 'bad' }, { anonKey: '' },
            { serviceRoleKey: '' }, { supabaseUrl: 'http://unsafe.example' }, { supabaseUrl: settings.supabaseUrl + '/path' }]) {
            const f = await fixture({ settings: setting }); await checkError(f, await f.handler(f.request()), 503, 'service_unavailable'); assert.equal(f.calls.length, 0);
        }
    });
    await test('Missing or malformed authorization cannot reach Auth or storage', async () => {
        for (const token of ['', 'Bearer key', 'Bearer ' + 'x'.repeat(8200)]) {
            const f = await fixture(); await checkError(f, await f.handler(f.request({}, { headers: { 'Content-Type': 'application/json', Authorization: token } })), 401, 'unauthorized');
            assert.equal(f.calls.length, 0);
        }
    });
    await test('Real Auth rejection, foreign users and anonymous/service identities stop before target lookup', async () => {
        for (const auth of [reply({}, 401), reply({}, 403), reply({ id: userB, role: 'authenticated' }),
            reply({ id: userA, role: 'authenticated', is_anonymous: true }), reply({ id: userA, role: 'service_role' }), reply({ role: 'authenticated' })]) {
            const f = await fixture({ fetch: c => c.url.pathname === '/auth/v1/user' ? auth : null });
            const wrongUser = auth.status === 200 && (await auth.clone().json()).id === userB;
            await checkError(f, await f.handler(f.request()), wrongUser ? 403 : 401, wrongUser ? 'access_denied' : 'unauthorized');
            assert.equal(f.calls.length, 1); assert.equal(f.writes().length, 0);
        }
    });
    await test('Provider fields, coordinates, actor IDs, unsigned expiry and group actions are rejected before network', async () => {
        for (const extra of [{ latitude: 1 }, { longitude: 1 }, { provider: 'geoapify' }, { acting_user_id: userB },
            { expiresAt: '2099-01-01' }, { groupId: otherId }, { action: 'attach_group' }]) {
            const f = await fixture(); await checkError(f, await f.handler(f.request(extra)), 400, 'invalid_request'); assert.equal(f.calls.length, 0);
        }
    });
    await test('Input bounds and native-only method/origin policy cannot bypass validation', async () => {
        for (const input of [{ personalPlaceId: 'bad' }, { expectedRevision: 0 }, { expectedRevision: 2147483648 },
            { expectedRevision: '1' }, { selectionReceipt: 'bad' }, { selectionReceipt: 'x'.repeat(4097) }]) {
            const f = await fixture(); await checkError(f, await f.handler(f.request(input)), 400, 'invalid_request'); assert.equal(f.calls.length, 0);
        }
        const f = await fixture();
        await checkError(f, await f.handler(f.request({}, { method: 'GET', body: undefined })), 405, 'method_not_allowed');
        await checkError(f, await f.handler(f.request({}, { headers: { Origin: 'https://browser.example' } })), 403, 'origin_not_allowed');
        assert.equal(f.calls.length, 0);
    });
    await test('Non-owned/missing targets and foreign returned ownership never authorize attachment', async () => {
        const missing = await fixture(); await checkError(missing, await missing.handler(missing.request({ personalPlaceId: otherId })), 404, 'place_unavailable');
        const foreign = await fixture({ fetch: c => c.url.pathname === '/rest/v1/personal_places' ? reply([{ id: placeId, owner_user_id: userB, address: selection.address, revision: 1 }]) : null });
        await checkError(foreign, await foreign.handler(foreign.request()), 503, 'attachment_unavailable');
        assert.equal(missing.writes().length + foreign.writes().length, 0);
    });
    await test('Stale revision and exact address mismatch reject the receipt before a write', async () => {
        const stale = await fixture(); await checkError(stale, await stale.handler(stale.request({ expectedRevision: 2 })), 409, 'place_changed');
        const changed = await fixture(); changed.place.address = selection.address.toLowerCase();
        await checkError(changed, await changed.handler(changed.request()), 400, 'invalid_selection');
        assert.equal(stale.writes().length + changed.writes().length, 0);
    });
    await test('Tampered coordinates/address/expiry/signature never authorize attachment', async () => {
        for (const mutation of [p => { p.selection.latitude = 1; }, p => { p.selection.address = 'Forged address'; }, p => { p.exp += 600; }]) {
            const f = await fixture(), [body, sig] = f.signed.selectionReceipt.split('.');
            const payload = JSON.parse(Buffer.from(body, 'base64url').toString()); mutation(payload);
            const forged = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig;
            await checkError(f, await f.handler(f.request({ selectionReceipt: forged })), 400, 'invalid_selection'); assert.equal(f.writes().length, 0);
        }
        const f = await fixture(), [body] = f.signed.selectionReceipt.split('.');
        await checkError(f, await f.handler(f.request({ selectionReceipt: body + '.' + 'A'.repeat(43) })), 400, 'invalid_selection'); assert.equal(f.writes().length, 0);
    });
    await test('Expired, wrong-user, wrong-project and wrong-key receipts remain invalid', async () => {
        for (const kind of ['expiry', 'user', 'project', 'key']) {
            const f = await fixture(); let receipt = f.signed.selectionReceipt;
            if (kind === 'expiry') f.setNow(baseTime + 600000);
            else {
                const codec = await f.load('geoapify-suggest/receipts.ts').createReceiptCodec(kind === 'key' ? '22'.repeat(32) : settings.selectionSecret,
                    kind === 'project' ? 'https://different-project.example' : settings.supabaseUrl);
                receipt = (await codec.sign(kind === 'user' ? userB : userA, selection, baseTime)).selectionReceipt;
            }
            await checkError(f, await f.handler(f.request({ selectionReceipt: receipt })), 400, 'invalid_selection'); assert.equal(f.writes().length, 0);
        }
    });
    await test('An existing resolution is preserved and reported only after committed readback', async () => {
        const old = { personal_place_id: placeId, address_snapshot: selection.address, latitude: 1, longitude: 2, resolution_status: 'resolved',
            resolution_provider: 'previous-provider', provider_location_id: 'old', standardized_address: 'Previous formatted address', resolution_accuracy: 'address' };
        const f = await fixture({ location: old }), result = await f.handler(f.request());
        assert.equal(result.status, 200); assert.deepEqual(await result.json(), { status: 'already_resolved' });
        assert.deepEqual(f.state.location, old); assert.equal(f.place.revision, 1); assert.equal(f.writes().length, 1);
    });
    await test('Concurrent attachments cannot overwrite the first result and stale second write fails safely', async () => {
        const f = await fixture(), results = await Promise.all([f.handler(f.request()), f.handler(f.request())]);
        assert.equal(results.filter(r => r.status === 200).length, 1); assert.equal(results.filter(r => r.status === 409).length, 1);
        assert.equal(f.place.revision, 2); assert.equal(f.state.location.latitude, selection.latitude); assert.equal(f.writes().length, 2);
        await checkError(f, results.find(r => r.status === 409), 409, 'place_changed');
    });
    await test('SQL ownership/revision/expiry failures use safe codes and do not affect the saved memory', async () => {
        for (const [code, status, safe] of [['42501', 404, 'place_unavailable'], ['40001', 409, 'place_changed'], ['22023', 400, 'invalid_selection'], ['unknown', 503, 'attachment_unavailable']]) {
            const f = await fixture({ fetch: c => c.init.method === 'POST' ? reply({ code, message: tokenA + selection.address + settings.serviceRoleKey }, 400) : null });
            await checkError(f, await f.handler(f.request()), status, safe); assert.equal(f.place.revision, 1); assert.equal(f.state.location, null); assert.equal(f.writes().length, 1);
        }
    });
    await test('RPC false/true are not success without matching readback; reported rollback never claims success', async () => {
        for (const kind of ['missing', 'malformed', 'rollback', 'conflict', 'false-missing']) {
            const f = await fixture({ fetch: c => {
                if (c.init.method === 'POST') {
                    if (kind === 'rollback') return reply(true, 200, { 'Preference-Applied': 'tx=rollback' });
                    if (kind === 'malformed') return reply({ attached: true });
                    if (kind === 'false-missing') return reply(false);
                }
                if (c.url.pathname === '/rest/v1/personal_place_locations') return reply(kind === 'conflict' ? [{ ...f.state.location, latitude: 1 }] : []);
            } });
            await checkError(f, await f.handler(f.request()), 503, 'attachment_unconfirmed'); assert.equal(f.writes().length, 1);
            assert.equal(f.place.name, 'Original personal memory');
        }
    });
    await test('Transport failures and lost responses are sanitized and never automatically replayed', async () => {
        for (const phase of ['/auth/v1/user', '/rest/v1/personal_places', '/rest/v1/rpc/attach_geoapify_personal_place_location', '/rest/v1/personal_place_locations']) {
            const f = await fixture({ fetch: c => { if (c.url.pathname === phase) throw new Error([tokenA, selection.address, settings.serviceRoleKey, f.signed.selectionReceipt].join(' ')); } });
            await checkError(f, await f.handler(f.request()), 503, 'service_unavailable');
            assert(f.writes().length <= 1); assert(f.calls.every(c => c.url.origin === settings.supabaseUrl));
            if (phase === '/rest/v1/personal_place_locations') assert.equal(f.place.revision, 2); // May have committed; original save remains.
        }
    });
    for (const phase of ['/rest/v1/personal_places', '/rest/v1/rpc/attach_geoapify_personal_place_location', '/rest/v1/personal_place_locations']) {
        await test(`Shared enrichment deadline bounds stalled ${phase.split('/').at(-1)} and ignores late success`, async () => {
            const clock = timers(), held = deferred();
            const f = await fixture({ globals: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, fetch: c => c.url.pathname === phase ? held.promise : null });
            const pending = f.handler(f.request()); await until(() => f.calls.some(c => c.url.pathname === phase)); clock.fire(3000);
            await checkError(f, await pending, 503, 'attachment_unavailable'); const count = f.calls.length;
            held.resolve(reply(phase === '/rest/v1/personal_places' ? [f.place] : true)); await new Promise(r => setImmediate(r));
            assert.equal(f.calls.length, count); assert.equal(clock.size, 0); assert(f.calls.at(-1).init.signal.aborted); assert(f.writes().length <= 1);
        });
    }
    await test('Cancellation before mutation and during readback remains fail closed without replay or save deletion', async () => {
        for (const afterWrite of [false, true]) {
            const held = deferred(), parent = new AbortController(), phase = afterWrite ? '/rest/v1/personal_place_locations' : '/rest/v1/personal_places';
            const f = await fixture({ fetch: c => c.url.pathname === phase ? held.promise : null });
            const pending = f.handler(f.request({}, { signal: parent.signal })); await until(() => f.calls.some(c => c.url.pathname === phase)); parent.abort();
            await checkError(f, await pending, 503, 'attachment_unavailable'); held.resolve(reply([f.place])); await new Promise(r => setImmediate(r));
            assert.equal(f.writes().length, afterWrite ? 1 : 0); assert.equal(f.place.revision, afterWrite ? 2 : 1);
        }
    });
    await test('Timeout/cancellation during crypto verification cannot start a late RPC', async () => {
        const clock = timers(), held = deferred();
        const crypto = { subtle: { importKey: webcrypto.subtle.importKey.bind(webcrypto.subtle), verify: () => held.promise } };
        const f = await fixture({ crypto, globals: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout } });
        const pending = f.handler(f.request()); await until(() => f.calls.length === 2); await new Promise(r => setImmediate(r)); clock.fire(3000);
        await checkError(f, await pending, 503, 'attachment_unavailable'); held.resolve(true); await new Promise(r => setImmediate(r)); assert.equal(f.writes().length, 0);
    });
    console.log(passed + ' offline personal attachment checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
