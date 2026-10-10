// Offline execution of the actual Edge modules using installed TypeScript + Web APIs.
// Every Fetch is mocked. No real env, secrets, Auth, PostgREST or Geoapify requests.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../functions/geoapify-suggest');
const userA = '11111111-1111-1111-1111-111111111111';
const userB = '22222222-2222-2222-2222-222222222222';
const baseTime = Date.parse('2026-10-10T12:00:00Z');
const config = { supabaseUrl: 'http://127.0.0.1:1', anonKey: 'synthetic-anon-key', serviceRoleKey: 'synthetic-service-role-key',
    geoapifyKey: 'synthetic-geoapify-key', selectionSecret: '11'.repeat(32), allowedUserId: userA };
const tokenA = 'aaa.eyJzdWIiOiJmb3JnZWQtY2xhaW0ifQ.signature', tokenB = 'bbb.e30.signature';
let passed = 0;
function modules(options = {}) {
    const cache = new Map();
    function load(file) {
        const filename = path.resolve(root, file);
        assert.equal(path.dirname(filename), root);
        if (cache.has(filename)) return cache.get(filename).exports;
        const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        } }).outputText;
        const module = { exports: {} }; cache.set(filename, module);
        vm.runInNewContext(source, { module, exports: module.exports, require: name => { assert(name.startsWith('./')); return load(name); },
            Request, Response, Headers, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, Uint8Array, Date,
            btoa, atob, crypto: webcrypto, performance, setTimeout, clearTimeout,
            fetch: () => assert.fail('Unexpected non-injected network request'), ...options }, { filename });
        return module.exports;
    }
    return load;
}
function reply(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
function building(overrides = {}) {
    return { place_id: 'provider-address-1', formatted: '100 Market Street, San Francisco, CA 94103, United States', country_code: 'us',
        result_type: 'building', housenumber: '100', street: 'Market Street', lat: 37.7749, lon: -122.4194,
        rank: { confidence: 0.95, confidence_building_level: 0.95, match_type: 'full_match' }, ...overrides };
}
function admission(overrides = {}) {
    return [{ admitted: true, admission_id: '33333333-3333-3333-3333-333333333333',
        permit_expires_at: new Date(baseTime + 1000).toISOString(), reason: 'admitted', retry_after_seconds: 0, ...overrides }];
}
function request(body = { action: 'suggest', query: '100 Market' }, options = {}) {
    return new Request('http://127.0.0.1:1/functions/v1/geoapify-suggest', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` }, body: JSON.stringify(body), ...options });
}
function setup(options = {}) {
    const load = modules(options.globals), calls = [], signals = [];
    let mono = 0, now = baseTime;
    const handler = load('handler.ts').createSuggestHandler({ ...config, ...options.config }, {
        now: () => now, monotonicNow: () => mono, crypto: webcrypto,
        fetch: async (input, init) => {
            const url = new URL(input); const call = { url, init }; calls.push(call); signals.push(init.signal);
            for (const value of [config.geoapifyKey, config.anonKey, config.serviceRoleKey, config.selectionSecret, tokenA, tokenB]) {
                assert(!url.href.includes(value), 'Outbound URLs must never contain credentials');
            }
            const headers = new Headers(init.headers);
            if (url.origin === 'https://api.geoapify.com') {
                assert.deepEqual([...headers.keys()], ['x-api-key'], 'Only the provider credential may reach Geoapify');
                assert.equal(headers.get('x-api-key'), config.geoapifyKey);
                assert.deepEqual([...url.searchParams.keys()].sort(), ['filter', 'format', 'lang', 'limit', 'text']);
                assert.equal(url.searchParams.get('apiKey'), null);
            } else assert.equal(headers.get('x-api-key'), null, 'Provider key must never reach Supabase');
            assert.equal(init.redirect, 'error', 'All automatic redirects must be disabled');
            const overridden = options.fetch?.(call, { setMono: value => { mono = value; }, setNow: value => { now = value; } });
            if (overridden) return overridden;
            if (url.pathname === '/auth/v1/user') {
                assert.equal(url.origin, config.supabaseUrl); assert.equal(init.headers.apikey, config.anonKey);
                const id = init.headers.Authorization === `Bearer ${tokenB}` ? userB : userA;
                return reply({ id, role: 'authenticated', is_anonymous: false });
            }
            if (url.pathname === '/rest/v1/rpc/reserve_geoapify_request') {
                assert.equal(url.origin, config.supabaseUrl); assert.equal(init.headers.apikey, config.serviceRoleKey);
                assert.equal(init.headers.Authorization, `Bearer ${config.serviceRoleKey}`);
                assert.equal(init.headers.Prefer, 'tx=commit');
                assert.deepEqual(Object.keys(JSON.parse(init.body)), ['acting_user_id']); return reply(admission());
            }
            if (url.pathname === '/rest/v1/rpc/confirm_geoapify_request') {
                assert.equal(url.origin, config.supabaseUrl); assert.equal(init.headers.apikey, config.serviceRoleKey);
                assert.equal(init.headers.Authorization, `Bearer ${config.serviceRoleKey}`);
                assert.equal(init.method, 'POST');
                const body = JSON.parse(init.body);
                assert.deepEqual(Object.keys(body), ['target_admission_id', 'acting_user_id', 'expected_permit_expires_at']);
                assert.equal(body.target_admission_id, admission()[0].admission_id);
                assert([userA, userB].includes(body.acting_user_id));
                assert.equal(typeof body.expected_permit_expires_at, 'string');
                return reply(true);
            }
            assert.equal(url.origin, 'https://api.geoapify.com'); assert.equal(url.pathname, '/v1/geocode/autocomplete');
            assert.equal(init.method, 'GET'); assert.equal(url.searchParams.get('filter'), 'countrycode:us');
            assert.equal(url.searchParams.get('limit'), '5'); assert.equal(url.searchParams.get('format'), 'json');
            assert.equal(url.searchParams.get('lang'), 'en');
            assert.equal(url.searchParams.get('type'), null); return reply({ results: [building()] });
        },
    });
    return { handler, load, calls, signals, providers: () => calls.filter(c => c.url.origin === 'https://api.geoapify.com'),
        reservations: () => calls.filter(c => c.url.pathname.endsWith('/reserve_geoapify_request')),
        confirmations: () => calls.filter(c => c.url.pathname.endsWith('/confirm_geoapify_request')), setMono: value => { mono = value; }, setNow: value => { now = value; } };
}
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function error(response, status, code) {
    assert.equal(response.status, status); const data = await response.json(); assert.equal(data.error.code, code);
    assert.equal(data.manualEntryAllowed, true); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const raw = JSON.stringify(data);
    for (const sensitive of [config.geoapifyKey, config.selectionSecret, config.serviceRoleKey, config.anonKey, tokenA, tokenB, '100 Market']) {
        assert(!raw.includes(sensitive)); assert(!JSON.stringify([...response.headers]).includes(sensitive));
    }
}
function timerControl() {
    const timers = new Map(); let sequence = 0;
    return { setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
        clearTimeout(id) { timers.delete(id); }, fire(ms) {
            const timer = [...timers].find(([, value]) => value.ms === ms); assert(timer, 'Missing timeout ' + ms);
            timers.delete(timer[0]); timer[1].fn();
        }, get size() { return timers.size; } };
}
async function until(predicate) { for (let i = 0; i < 40 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve)); assert(predicate()); }

(async () => {
    await test('Real entry point reads only named server secrets and registers the isolated handler', async () => {
        const read = []; let handler;
        const secrets = { SUPABASE_URL: config.supabaseUrl, SUPABASE_ANON_KEY: config.anonKey, SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
            GEOAPIFY_API_KEY: config.geoapifyKey, GEOAPIFY_SELECTION_SECRET: config.selectionSecret, GEOAPIFY_ALLOWED_USER_ID: userA };
        modules({ Deno: { env: { get(name) { read.push(name); return secrets[name]; } }, serve(value) { handler = value; } } })('index.ts');
        assert.deepEqual(read, Object.keys(secrets)); assert.equal(typeof handler, 'function');
        await error(await handler(request({}, { method: 'GET', body: undefined })), 405, 'method_not_allowed');
    });
    await test('Authenticated suggestion verifies user, meters once, filters request and signs a private-account receipt', async () => {
        const f = setup(), result = await f.handler(request({ action: 'suggest', query: '  100 Market  ' })); assert.equal(result.status, 200);
        const data = await result.json(); assert.equal(data.suggestions.length, 1); const selected = data.suggestions[0];
        assert.equal(selected.address, building().formatted); assert.equal(selected.latitude, building().lat); assert.equal(selected.source, 'geoapify');
        assert.equal(f.calls.map(c => c.url.pathname).join('|'), '/auth/v1/user|/rest/v1/rpc/reserve_geoapify_request|/rest/v1/rpc/confirm_geoapify_request|/v1/geocode/autocomplete');
        assert.equal(JSON.parse(f.reservations()[0].init.body).acting_user_id, userA, 'Never trust the JWT text claim');
        assert.equal(f.providers()[0].url.searchParams.get('text'), '100 Market'); assert(data.attribution.geoapifyUrl); assert(data.attribution.openStreetMapUrl);
        assert.equal(result.headers.get('Cache-Control'), 'no-store'); assert(!result.headers.has('Access-Control-Allow-Origin'));
        const codec = await f.load('receipts.ts').createReceiptCodec(config.selectionSecret, config.supabaseUrl);
        const verified = await codec.verify(selected.selectionReceipt, userA, selected.address, baseTime);
        assert.equal(verified.id, selected.id); assert.equal(verified.longitude, selected.longitude);
        assert.equal(selected.expiresAt, new Date(baseTime + 600000).toISOString());
        assert.equal(await codec.verify(selected.selectionReceipt, userB, selected.address, baseTime), null);
    });
    await test('Missing or malformed allowlist fails closed before all outbound work', async () => {
        for (const allowedUserId of [undefined, null, '', 'Taylor', '*', userA + ',' + userB, ' ' + userA, userA + ' ']) {
            const f = setup({ config: { allowedUserId } });
            await error(await f.handler(request()), 503, 'service_unavailable');
            assert.equal(f.calls.length, 0);
        }
    });
    await test('Real entry point without allowlist cannot silently enable unrestricted production', async () => {
        let handler;
        const values = { SUPABASE_URL: config.supabaseUrl, SUPABASE_ANON_KEY: config.anonKey,
            SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey, GEOAPIFY_API_KEY: config.geoapifyKey,
            GEOAPIFY_SELECTION_SECRET: config.selectionSecret };
        modules({ Deno: { env: { get(name) { return values[name]; } }, serve(value) { handler = value; } } })('index.ts');
        await error(await handler(request()), 503, 'service_unavailable');
    });
    await test('Other verified users stop after Auth with no signer, admission, confirmation or provider work', async () => {
        const f = setup({ fetch: c => c.url.pathname === '/auth/v1/user'
            ? reply({ id: userB, role: 'authenticated', is_anonymous: false, email: 'Taylor@example.test' }) : null });
        await error(await f.handler(request()), 403, 'access_denied');
        assert.deepEqual(f.calls.map(c => c.url.pathname), ['/auth/v1/user']);
        const body = await (await f.handler(request(undefined, { headers: {
            'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}`, 'X-GroupBite-Probe-Mode': 'normal',
            'X-Allowed-User-Id': userA,
        } }))).json();
        assert.equal(body.error.code, 'access_denied');
        assert(!JSON.stringify(body).includes(userA)); assert(!JSON.stringify(body).includes(userB));
        assert.equal(f.reservations().length, 0); assert.equal(f.confirmations().length, 0); assert.equal(f.providers().length, 0);
    });
    await test('Allowlist compares normalized verified UUIDs, not JWT claims', async () => {
        const id = 'abcdefab-abcd-abcd-abcd-abcdefabcdef';
        const f = setup({ config: { allowedUserId: id.toUpperCase() }, fetch: c => {
            if (c.url.pathname === '/auth/v1/user') return reply({ id, role: 'authenticated' });
            if (c.url.pathname.endsWith('/confirm_geoapify_request')) return reply(true);
            return null;
        } });
        assert.equal((await f.handler(request())).status, 200);
        assert.equal(JSON.parse(f.reservations()[0].init.body).acting_user_id, id);
        assert.equal(JSON.parse(f.confirmations()[0].init.body).acting_user_id, id);
    });
    await test('Concurrent allowed and denied users cannot inherit one another\'s access', async () => {
        const f = setup();
        const responses = await Promise.all([f.handler(request()), f.handler(request(undefined, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
        }))]);
        assert.deepEqual(responses.map(r => r.status), [200, 403]);
        await error(responses[1], 403, 'access_denied');
        assert.equal(f.reservations().length, 1); assert.equal(f.confirmations().length, 1); assert.equal(f.providers().length, 1);
        assert.equal(JSON.parse(f.reservations()[0].init.body).acting_user_id, userA);
    });
    await test('Missing/malformed/API-key authorization cannot request admission or contact provider', async () => {
        for (const Authorization of ['', 'Bearer key-only', 'Basic aaa.bbb.ccc', 'Bearer a.b.c extra', 'Bearer ' + 'a'.repeat(8192)]) {
            const f = setup(); await error(await f.handler(request(undefined, { headers: { 'Content-Type': 'application/json', Authorization } })), 401, 'unauthorized');
            assert.equal(f.calls.length, 0);
        }
    });
    await test('Auth rejects expired/forged tokens, non-user identities, deleted or anonymous users', async () => {
        for (const auth of [reply({ error: 'invalid signature' }, 401), reply({}, 403), reply({ id: userA, role: 'service_role' }),
            reply({ id: userA, role: 'authenticated', is_anonymous: true }), reply({ id: userA, role: 'authenticated', is_anonymous: 'false' }),
            reply({ id: 'bad', role: 'authenticated' }), reply({}), reply({ user: { id: userA } })]) {
            const f = setup({ fetch: c => c.url.pathname === '/auth/v1/user' ? auth : null });
            await error(await f.handler(request()), 401, 'unauthorized'); assert.equal(f.reservations().length, 0); assert.equal(f.providers().length, 0);
        }
    });
    await test('Auth errors, malformed responses and redirect/network failures fail closed', async () => {
        for (const kind of ['status', 'body', 'throw']) {
            const f = setup({ fetch: c => { if (c.url.pathname !== '/auth/v1/user') return null;
                if (kind === 'throw') throw new Error('private raw error ' + config.serviceRoleKey);
                return kind === 'status' ? reply({}, 500) : new Response('invalid', { headers: { 'Content-Type': 'application/json' } }); } });
            await error(await f.handler(request()), 503, 'auth_unavailable'); assert.equal(f.providers().length, 0);
        }
    });
    await test('Strict inputs reject forged actor/coordinates/limits/attach actions and invalid queries before network', async () => {
        for (const body of [null, [], {}, { action: 'attach', query: '100 Market' }, { action: 'suggest', query: 'ab' },
            { action: 'suggest', query: 123 }, { action: 'suggest', query: 'a'.repeat(301) }, { action: 'suggest', query: 'ab\ncd' },
            ...['user_id', 'acting_user_id', 'coordinates', 'receipt', 'limit', 'country', 'endpoint'].map(key => ({ action: 'suggest', query: '100 Market', [key]: userB }))]) {
            const f = setup(); await error(await f.handler(request(body)), 400, 'invalid_request'); assert.equal(f.calls.length, 0);
        }
        for (const options of [{ body: '{' }, { body: ' '.repeat(2049) }, { headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${tokenA}` } },
            { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}`, 'Content-Length': '3000' } }]) {
            const f = setup(); await error(await f.handler(request(undefined, options)), 400, 'invalid_request'); assert.equal(f.calls.length, 0);
        }
    });
    await test('No browser origin, alternate method or unconfigured server can reach Auth/provider', async () => {
        const f = setup(); await error(await f.handler(request(undefined, { headers: { Origin: 'https://untrusted.example' } })), 403, 'origin_not_allowed');
        for (const method of ['GET', 'OPTIONS', 'PUT']) await error(await f.handler(request(undefined, { method, body: undefined })), 405, 'method_not_allowed');
        assert.equal(f.calls.length, 0);
        for (const bad of [{ geoapifyKey: '' }, { selectionSecret: 'weak' }, { anonKey: '' }, { serviceRoleKey: '' },
            { supabaseUrl: 'http://remote.example' }, { supabaseUrl: 'https://x.example/overridden/path' }]) {
            const broken = setup({ config: bad }); await error(await broken.handler(request()), 503, 'service_unavailable'); assert.equal(broken.calls.length, 0);
        }
    });
    await test('Every Migration 9 quota denial returns bounded retry guidance and no provider request', async () => {
        for (const reason of ['global_daily_limit', 'user_daily_limit', 'global_rate_limit']) {
            const f = setup({ fetch: c => c.url.pathname.endsWith('/reserve_geoapify_request') ? reply(admission({ admitted: false, admission_id: null, permit_expires_at: null, reason, retry_after_seconds: 3 })) : null });
            const result = await f.handler(request()); assert.equal(result.headers.get('Retry-After'), '3'); await error(result, 429, 'quota_exceeded');
            assert.equal(f.reservations().length, 1); assert.equal(f.providers().length, 0);
        }
    });
    await test('Unavailable/uncertain/malformed admission responses never fall back to an in-memory quota', async () => {
        for (const permit of [[], {}, admission({ admitted: 'true' }), admission({ admission_id: null }), admission({ permit_expires_at: 'invalid' }),
            admission({ reason: 'unknown' }), admission({ retry_after_seconds: 1 }), admission({ admitted: false }),
            admission({ admitted: false, admission_id: null, permit_expires_at: null, reason: 'global_daily_limit', retry_after_seconds: 0 }),
            [admission()[0], admission()[0]]]) {
            const f = setup({ fetch: c => c.url.pathname.endsWith('/reserve_geoapify_request') ? reply(permit) : null });
            await error(await f.handler(request()), 503, 'quota_unavailable'); assert.equal(f.providers().length, 0);
        }
        for (const status of [401, 403, 500]) {
            const f = setup({ fetch: c => c.url.pathname.endsWith('/reserve_geoapify_request') ? reply({ message: 'private failure' }, status) : null });
            await error(await f.handler(request()), 503, 'quota_unavailable'); assert.equal(f.providers().length, 0);
        }
    });
    await test('Dispatch rejects exact budget boundary, expired permits and invalid monotonic clocks', async () => {
        for (const elapsed of [800, 1000, -1, NaN]) {
            const f = setup({ fetch: (c, clock) => { if (!c.url.pathname.endsWith('/reserve_geoapify_request')) return null; clock.setMono(elapsed); return reply(admission()); } });
            await error(await f.handler(request()), 503, 'permit_expired'); assert.equal(f.providers().length, 0);
        }
        const expired = setup({ fetch: c => c.url.pathname.endsWith('/reserve_geoapify_request') ? reply(admission({ permit_expires_at: new Date(baseTime).toISOString() })) : null });
        await error(await expired.handler(request()), 503, 'permit_expired'); assert.equal(expired.providers().length, 0);
        const timely = setup({ fetch: (c, clock) => { if (!c.url.pathname.endsWith('/reserve_geoapify_request')) return null; clock.setMono(799); return reply(admission()); } });
        assert.equal((await timely.handler(request())).status, 200); assert.equal(timely.providers().length, 1);
    });
    await test('Reported rollback never authorizes outbound HTTP even with an affirmative admission result', async () => {
        const f = setup({ fetch: c => c.url.pathname.endsWith('/reserve_geoapify_request') ? reply(admission(), 200, { 'Preference-Applied': 'tx=rollback' }) : null });
        await error(await f.handler(request()), 503, 'quota_unavailable'); assert.equal(f.providers().length, 0);
    });
    await test('Default commits without acknowledgement still require a separate successful readback', async () => {
        for (const applied of ['', 'return=representation', 'tx=commit', 'return=representation, tx=commit']) {
            const f = setup({ fetch: c => c.url.pathname.endsWith('/reserve_geoapify_request') ? reply(admission(), 200, { 'Preference-Applied': applied }) : null });
            assert.equal((await f.handler(request())).status, 200);
            assert.equal(f.confirmations().length, 1); assert.equal(f.providers().length, 1);
            assert.deepEqual(JSON.parse(f.confirmations()[0].init.body), { target_admission_id: admission()[0].admission_id,
                acting_user_id: userA, expected_permit_expires_at: admission()[0].permit_expires_at });
        }
    });
    await test('Missing, malformed, failed or rollback confirmation never dispatches even with acknowledged admission', async () => {
        const failures = [() => reply(false), () => reply(null), () => reply([]), () => reply([true]), () => reply('true'),
            () => reply({ confirmed: true }), () => reply(true, 404), () => reply(true, 500),
            () => reply(true, 200, { 'Preference-Applied': 'tx=rollback' }),
            () => new Response('invalid', { headers: { 'Content-Type': 'application/json' } }),
            () => new Response(' '.repeat(4097), { headers: { 'Content-Type': 'application/json' } }),
            () => { throw new Error('private transport error'); }];
        for (const failure of failures) {
            const f = setup({ fetch: c => c.url.pathname.endsWith('/confirm_geoapify_request') ? failure() :
                c.url.pathname.endsWith('/reserve_geoapify_request') ? reply(admission(), 200, { 'Preference-Applied': 'tx=commit' }) : null });
            await error(await f.handler(request()), 503, 'quota_unavailable');
            assert.equal(f.reservations().length, 1); assert.equal(f.confirmations().length, 1); assert.equal(f.providers().length, 0);
        }
        const conflict = setup({ fetch: c => c.url.pathname.endsWith('/reserve_geoapify_request') ?
            reply(admission(), 200, { 'Preference-Applied': 'tx=commit, tx=rollback' }) : null });
        await error(await conflict.handler(request()), 503, 'quota_unavailable');
        assert.equal(conflict.confirmations().length, 0); assert.equal(conflict.providers().length, 0);
    });
    await test('Confirmation preserves microsecond expiry and shares the original monotonic budget', async () => {
        const expiry = '2026-10-10T12:00:01.123456+00:00';
        for (const elapsed of [799, 800, 1000, -1, NaN]) {
            const f = setup({ fetch: (c, clock) => {
                if (c.url.pathname.endsWith('/reserve_geoapify_request')) { clock.setMono(500); return reply(admission({ permit_expires_at: expiry })); }
                if (c.url.pathname.endsWith('/confirm_geoapify_request')) {
                    assert.equal(JSON.parse(c.init.body).expected_permit_expires_at, expiry);
                    clock.setMono(elapsed); return reply(true);
                }
            } });
            const result = await f.handler(request());
            if (elapsed === 799) { assert.equal(result.status, 200); assert.equal(f.providers().length, 1); }
            else { await error(result, 503, 'permit_expired'); assert.equal(f.providers().length, 0); }
            assert.equal(f.confirmations().length, 1);
        }
    });
    await test('Cancellation during readback ignores late success and never reuses an abandoned admission', async () => {
        const controller = new AbortController(); let resolve;
        const held = new Promise(r => { resolve = r; });
        const f = setup({ fetch: c => c.url.pathname.endsWith('/confirm_geoapify_request') ? held : null });
        const pending = f.handler(request(undefined, { signal: controller.signal }));
        await until(() => f.confirmations().length === 1); controller.abort();
        await error(await pending, 503, 'quota_unavailable'); resolve(reply(true));
        await new Promise(r => setImmediate(r));
        assert.equal(f.providers().length, 0); assert.equal(f.reservations().length, 1); assert(f.signals.at(-1).aborted);
    });
    await test('Behind wall clock never extends monotonic dispatch budget; ahead clock safely abandons admission', async () => {
        const behind = setup({ fetch: (c, clock) => { if (!c.url.pathname.endsWith('/reserve_geoapify_request')) return null; clock.setNow(baseTime - 3600000); clock.setMono(1000); return reply(admission()); } });
        await error(await behind.handler(request()), 503, 'permit_expired'); assert.equal(behind.providers().length, 0);
        const ahead = setup(); ahead.setNow(baseTime + 3600000); await error(await ahead.handler(request()), 503, 'permit_expired'); assert.equal(ahead.providers().length, 0);
    });
    await test('Coarse, foreign, incomplete, invalid-coordinate and low-confidence results never receive receipts', async () => {
        const bad = [null, {}, ...['street', 'city', 'postcode', 'amenity', 'address', 'unknown'].map(result_type => building({ result_type })),
            building({ country_code: 'ca' }), building({ country_code: null }), building({ housenumber: '' }), building({ street: null }),
            building({ place_id: '' }), building({ formatted: 'x'.repeat(301) }), building({ formatted: 'Address\nInjected' }), building({ lat: null }),
            building({ lon: '12' }), building({ lat: 91 }), building({ lon: -181 }), building({ lat: 0, lon: 0 }), building({ lat: NaN }), building({ rank: null }),
            ...[{ confidence: 0.79 }, { confidence: 1.1 }, { confidence_building_level: 0.79 }, { confidence_building_level: null }, { match_type: 'match_by_street' }]
                .map(rank => building({ rank: { ...building().rank, ...rank } }))];
        const f = setup({ fetch: c => c.url.origin === 'https://api.geoapify.com' ? reply({ results: bad }) : null });
        const result = await f.handler(request()); assert.equal(result.status, 200); assert.deepEqual((await result.json()).suggestions, []); assert.equal(f.providers().length, 1);
    });
    await test('Precise results are whitelisted/deduplicated and capped at five even if provider ignores limit', async () => {
        const rows = Array.from({ length: 8 }, (_, i) => building({ place_id: 'address-' + i, formatted: `${100 + i} Market Street, San Francisco, CA, US` }));
        const f = setup({ fetch: c => c.url.origin === 'https://api.geoapify.com' ? reply({ results: [rows[0], rows[0], building({ result_type: 'city' }), ...rows,
            building({ private_debug: config.geoapifyKey })] }) : null });
        const result = await f.handler(request()), data = await result.json(); assert.equal(result.status, 200); assert.equal(data.suggestions.length, 5);
        assert.equal(new Set(data.suggestions.map(s => s.id)).size, 5);
        assert.deepEqual(Object.keys(data.suggestions[0]).sort(), ['accuracy', 'address', 'countryCode', 'expiresAt', 'id', 'latitude', 'longitude', 'selectionReceipt', 'source'].sort());
        assert(!JSON.stringify(data).includes(config.geoapifyKey));
    });
    await test('Provider HTTP errors/throttling, invalid JSON, oversized streams and redirects are never retried', async () => {
        for (const kind of ['http', 'throttle', 'json', 'shape', 'size', 'redirect']) {
            const f = setup({ fetch: c => { if (c.url.origin !== 'https://api.geoapify.com') return null;
                if (kind === 'redirect') throw new Error('URL contains ' + config.geoapifyKey);
                if (kind === 'http') return reply({ private: config.geoapifyKey }, 500);
                if (kind === 'throttle') return reply({}, 429, { 'Retry-After': '999999999' });
                if (kind === 'shape') return reply({ features: [] });
                return new Response(kind === 'size' ? ' '.repeat(65537) : 'invalid', { headers: { 'Content-Type': 'application/json' } }); } });
            const result = await f.handler(request()); await error(result, kind === 'throttle' ? 503 : 502,
                kind === 'http' || kind === 'shape' ? 'provider_unavailable' : kind === 'throttle' ? 'provider_throttled' : 'service_unavailable');
            assert.equal(f.providers().length, 1); assert.equal(f.reservations().length, 1);
        }
    });
    await test('Header-auth failures never leak keys or queries, log raw errors, retry, or fall back to URL authentication', async () => {
        for (const phase of ['auth', 'quota', 'confirmation', 'provider']) {
            for (const transportError of [false, true]) {
                const logged = [], console = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug', 'trace']
                    .map(name => [name, (...args) => logged.push(args)]));
                const paths = { auth: '/auth/v1/user', quota: '/rest/v1/rpc/reserve_geoapify_request',
                    confirmation: '/rest/v1/rpc/confirm_geoapify_request', provider: '/v1/geocode/autocomplete' };
                const f = setup({ globals: { console }, fetch: c => {
                    if (c.url.pathname !== paths[phase]) return null;
                    const privateDetails = [config.geoapifyKey, config.selectionSecret, config.serviceRoleKey,
                        config.anonKey, tokenA, '100 Market'].join(' ');
                    if (transportError) throw new Error(privateDetails);
                    return reply({ message: privateDetails }, 401);
                } });
                const expected = phase === 'auth' ? [transportError ? 503 : 401, transportError ? 'auth_unavailable' : 'unauthorized']
                    : phase === 'provider' ? [502, transportError ? 'service_unavailable' : 'provider_unavailable'] : [503, 'quota_unavailable'];
                await error(await f.handler(request()), ...expected);
                assert.deepEqual(logged, []); assert.equal(f.providers().length, phase === 'provider' ? 1 : 0);
            }
        }
    });
    await test('Input/Auth/admission/provider timeouts abort and ignore late results without extra attempts', async () => {
        for (const phase of ['input', 'auth', 'quota', 'confirmation', 'provider']) {
            const timers = timerControl(); let resolve;
            const held = new Promise(r => { resolve = r; });
            const phasePath = { auth: '/auth/v1/user', quota: '/rest/v1/rpc/reserve_geoapify_request', confirmation: '/rest/v1/rpc/confirm_geoapify_request', provider: '/v1/geocode/autocomplete' };
            const f = setup({ globals: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
                fetch: c => c.url.pathname === phasePath[phase] ? held : null });
            const req = phase === 'input' ? request(undefined, { body: new ReadableStream({ start() {} }), duplex: 'half' }) : request();
            const pending = f.handler(req); const duration = { input: 1000, auth: 3000, quota: 800, confirmation: 800, provider: 5000 }[phase];
            if (phase !== 'input') await until(() => f.calls.some(c => c.url.pathname === phasePath[phase]));
            else await new Promise(r => setImmediate(r));
            timers.fire(duration); const result = await pending;
            const codes = { input: [400, 'invalid_request'], auth: [503, 'auth_unavailable'], quota: [503, 'quota_unavailable'], confirmation: [503, 'quota_unavailable'], provider: [504, 'provider_timeout'] };
            await error(result, ...codes[phase]); const count = f.calls.length;
            resolve(reply(phase === 'quota' ? admission() : phase === 'confirmation' ? true : phase === 'auth' ? { id: userA, role: 'authenticated' } : { results: [building()] }));
            await new Promise(r => setImmediate(r)); assert.equal(f.calls.length, count); assert.equal(timers.size, 0);
            if (phase !== 'input') assert(f.signals.at(-1).aborted);
            assert.equal(f.providers().length, phase === 'provider' ? 1 : 0);
        }
    });
    await test('Client cancellation before/during provider work preserves fail-closed metering and no receipt', async () => {
        const controller = new AbortController(), before = setup(); controller.abort(); await error(await before.handler(request(undefined, { signal: controller.signal })), 400, 'invalid_request'); assert.equal(before.calls.length, 0);
        const active = new AbortController(); let resolve; const held = new Promise(r => { resolve = r; });
        const f = setup({ fetch: c => c.url.origin === 'https://api.geoapify.com' ? held : null });
        const pending = f.handler(request(undefined, { signal: active.signal })); await until(() => f.providers().length === 1); active.abort();
        await error(await pending, 504, 'provider_timeout'); resolve(reply({ results: [building()] }));
        await new Promise(r => setImmediate(r)); assert.equal(f.reservations().length, 1); assert.equal(f.providers().length, 1); assert(f.signals.at(-1).aborted);
    });
    for (const phase of ['auth', 'quota', 'confirmation', 'provider']) {
        await test(`${phase} stalled response body is bounded and cancelled after headers arrive`, async () => {
            const timers = timerControl(); let pulls = 0, cancels = 0;
            const stream = new ReadableStream({ pull() { pulls++; }, cancel() { cancels++; } });
            const paths = { auth: '/auth/v1/user', quota: '/rest/v1/rpc/reserve_geoapify_request', confirmation: '/rest/v1/rpc/confirm_geoapify_request', provider: '/v1/geocode/autocomplete' };
            const f = setup({ globals: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
                fetch: c => c.url.pathname === paths[phase] ? new Response(stream, { headers: {
                    'Content-Type': 'application/json', 'Preference-Applied': 'tx=commit',
                } }) : null });
            const pending = f.handler(request());
            await until(() => f.calls.some(c => c.url.pathname === paths[phase]) && pulls > 0 && stream.locked);
            timers.fire({ auth: 3000, quota: 800, confirmation: 800, provider: 5000 }[phase]);
            const codes = { auth: [503, 'auth_unavailable'], quota: [503, 'quota_unavailable'], confirmation: [503, 'quota_unavailable'], provider: [504, 'provider_timeout'] };
            await error(await pending, ...codes[phase]); await new Promise(resolve => setImmediate(resolve));
            assert.equal(cancels, 1); assert.equal(stream.locked, false); assert.equal(timers.size, 0);
            assert.equal(f.providers().length, phase === 'provider' ? 1 : 0);
            assert.equal(f.reservations().length, phase === 'auth' ? 0 : 1); assert(f.signals.at(-1).aborted);
        });
    }
    await test('Concurrent users keep server-derived quota identities and receipts isolated', async () => {
        const f = setup(), other = setup({ config: { allowedUserId: userB } });
        const responses = await Promise.all([f.handler(request()), other.handler(request(undefined, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
        }))]);
        const [a, b] = await Promise.all(responses.map(r => r.json()));
        assert.deepEqual([...f.reservations(), ...other.reservations()].map(c => JSON.parse(c.init.body).acting_user_id).sort(), [userA, userB]);
        const codec = await f.load('receipts.ts').createReceiptCodec(config.selectionSecret, config.supabaseUrl);
        assert(await codec.verify(a.suggestions[0].selectionReceipt, userA, building().formatted, baseTime));
        assert(await codec.verify(b.suggestions[0].selectionReceipt, userB, building().formatted, baseTime));
        assert.equal(await codec.verify(a.suggestions[0].selectionReceipt, userB, building().formatted, baseTime), null);
        assert.equal(await codec.verify(b.suggestions[0].selectionReceipt, userA, building().formatted, baseTime), null);
        assert.equal(f.providers().length + other.providers().length, 2); assert.equal(f.reservations().length + other.reservations().length, 2);
    });
    await test('Concurrent calls dispatch only for their own affirmative confirmed admissions', async () => {
        let reservations = 0;
        const f = setup({ fetch: c => { if (!c.url.pathname.endsWith('/reserve_geoapify_request')) return null;
            return reply(++reservations <= 3 ? admission() : admission({ admitted: false, admission_id: null, permit_expires_at: null, reason: 'global_rate_limit', retry_after_seconds: 2 })); } });
        const results = await Promise.all(Array.from({ length: 12 }, () => f.handler(request())));
        assert.equal(results.filter(r => r.status === 200).length, 3); assert.equal(results.filter(r => r.status === 429).length, 9);
        assert.equal(f.reservations().length, 12); assert.equal(f.confirmations().length, 3); assert.equal(f.providers().length, 3);
    });
    await test('Signed receipt detects payload/signature tampering, edited addresses, wrong user/project/key, and expiry', async () => {
        const f = setup(), data = await (await f.handler(request())).json(), selected = data.suggestions[0];
        const codec = await f.load('receipts.ts').createReceiptCodec(config.selectionSecret, config.supabaseUrl);
        const [body, signature] = selected.selectionReceipt.split('.');
        const decoded = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
        assert.equal(decoded.sub, userA); assert.equal(decoded.selection.latitude, selected.latitude);
        for (const change of [p => { p.sub = userB; }, p => { p.selection.latitude = 0; }, p => { p.selection.address = 'Edited Address'; }, p => { p.exp += 100000; }]) {
            const altered = JSON.parse(JSON.stringify(decoded)); change(altered);
            const replacement = btoa(JSON.stringify(altered)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            assert.equal(await codec.verify(`${replacement}.${signature}`, userA, selected.address, baseTime), null);
        }
        for (const invalid of ['', null, selected.selectionReceipt + '.extra', `${body}.AAAA`, 'a'.repeat(4097), `${body}=.${signature}`]) {
            assert.equal(await codec.verify(invalid, userA, selected.address, baseTime), null);
        }
        assert.equal(await codec.verify(selected.selectionReceipt, userA, 'Edited Address', baseTime), null);
        assert(await codec.verify(selected.selectionReceipt, userA, selected.address, baseTime + 599999));
        assert.equal(await codec.verify(selected.selectionReceipt, userA, selected.address, baseTime + 600000), null);
        assert.equal(await codec.verify(selected.selectionReceipt, userA, selected.address, baseTime - 1000), null);
        for (const [secret, issuer] of [['22'.repeat(32), config.supabaseUrl], [config.selectionSecret, 'https://different-project.example']]) {
            const wrong = await f.load('receipts.ts').createReceiptCodec(secret, issuer);
            assert.equal(await wrong.verify(selected.selectionReceipt, userA, selected.address, baseTime), null);
        }
    });
    await test('Receipt signer rejects mock/coarse selections and exposes no public signing or attachment operation', async () => {
        const f = setup(), codec = await f.load('receipts.ts').createReceiptCodec(config.selectionSecret, config.supabaseUrl);
        const invalid = { id: 'mock', source: 'development-mock', address: 'Demo', latitude: 37, longitude: -122, accuracy: 'building', countryCode: 'us' };
        await assert.rejects(codec.sign(userA, invalid, baseTime));
        for (const action of ['sign', 'verify', 'attach', 'save']) {
            await error(await f.handler(request({ action, query: '100 Market' })), 400, 'invalid_request');
        }
        assert.equal(f.calls.length, 0);
    });
    console.log(passed + ' offline Geoapify Edge Function checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
