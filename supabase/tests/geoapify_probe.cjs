// Offline probe/production execution. No real env, secrets, or networking.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../functions');
const origin = 'https://abcdefghijklmnopqrst.supabase.co';
const userA = '11111111-1111-1111-1111-111111111111';
const userB = '22222222-2222-2222-2222-222222222222';
const admissionId = '33333333-3333-3333-3333-333333333333';
const token = 'aaa.e30.signature';
const authorization = `Bearer ${token}`;
const baseTime = Date.parse('2026-10-10T12:00:00Z');
const expiry = '2026-10-10T12:00:01.123456+00:00';
const config = { supabaseUrl: origin, anonKey: 'synthetic-anon-key', serviceRoleKey: 'synthetic-service-role-key', testUserId: userA };
const providerUrl = 'https://api.geoapify.com/v1/geocode/autocomplete?text=100%20Market&filter=countrycode%3Aus&lang=en&limit=5&format=json';
const syntheticProviderKey = 'groupbite-probe-no-provider-key';
const paths = { auth: '/auth/v1/user', reserve: '/rest/v1/rpc/reserve_geoapify_request', confirm: '/rest/v1/rpc/confirm_geoapify_request' };
function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
function modules(globals = {}) {
    const cache = new Map(), loaded = [];
    function load(filename) {
        filename = path.resolve(root, filename);
        assert([path.join(root, 'geoapify-suggest') + path.sep, path.join(root, 'geoapify-suggest-probe') + path.sep]
            .some(directory => filename.startsWith(directory)));
        if (cache.has(filename)) return cache.get(filename).exports;
        loaded.push(filename);
        const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        } }).outputText;
        const module = { exports: {} }; cache.set(filename, module);
        vm.runInNewContext(code, { module, exports: module.exports, require: name => {
            assert(name.startsWith('.')); return load(path.resolve(path.dirname(filename), name));
        }, Request, Response, ReadableStream, Headers, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, Uint8Array, Date,
        btoa, atob, crypto: webcrypto, performance, setTimeout, clearTimeout,
        fetch: () => assert.fail('Uninjected native Fetch'), ...globals }, { filename });
        return module.exports;
    }
    return { load, loaded };
}
function request(mode = 'normal', bearer = authorization, body = { action: 'suggest', query: '100 Market' }) {
    return new Request('https://abcdefghijklmnopqrst.supabase.co/functions/v1/geoapify-suggest-probe', { method: 'POST',
        headers: { Authorization: bearer, 'Content-Type': 'application/json', 'X-GroupBite-Probe-Mode': mode }, body: JSON.stringify(body) });
}
function timers() {
    const active = new Map(); let next = 0;
    return { setTimeout(fn, ms) { const id = ++next; active.set(id, { fn, ms }); return id; },
        clearTimeout(id) { active.delete(id); },
        fire(ms) { const entry = [...active].find(([, t]) => t.ms === ms); assert(entry, 'Missing timer ' + ms); active.delete(entry[0]); entry[1].fn(); },
        count: ms => [...active.values()].filter(t => t.ms === ms).length,
        get size() { return active.size; } };
}
async function until(predicate) {
    for (let i = 0; i < 80 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
    assert(predicate(), 'Condition did not complete');
}
function fixture(options = {}) {
    const clock = { mono: 0, now: baseTime }, calls = [];
    const compiled = modules(options.globals);
    const probe = compiled.load('geoapify-suggest-probe/probe.ts');
    const network = async (input, init) => {
        const url = new URL(String(input)); calls.push({ url, init });
        assert.equal(url.origin, origin, 'Only the hosted Supabase origin may reach native Fetch');
        assert(Object.values(paths).includes(url.pathname), 'Only the three endpoints may reach native Fetch');
        assert.equal(url.search, ''); assert.equal(init.redirect, 'error');
        const overridden = options.network?.({ url, init }, clock);
        if (overridden) return overridden;
        if (url.pathname === paths.auth) return json({ id: userA, role: 'authenticated', is_anonymous: false });
        if (url.pathname === paths.reserve) return json([{ admitted: true, admission_id: admissionId,
            permit_expires_at: expiry, reason: 'admitted', retry_after_seconds: 0 }]);
        return json(true);
    };
    const dependencies = { fetch: network, now: () => clock.now, monotonicNow: options.monotonicNow ?? (() => clock.mono), delay: options.delay };
    return { clock, calls, compiled, handler: probe.createProbeHandler({ ...config, ...options.config }, dependencies),
        session: () => probe.createProbeSession(config, 'normal', authorization, dependencies) };
}
function rpcInit(stage, body, signal = new AbortController().signal) {
    return { method: stage === 'auth' ? 'GET' : 'POST', redirect: 'error', signal,
        headers: stage === 'auth' ? { apikey: config.anonKey, Authorization: authorization } : {
            apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, 'Content-Type': 'application/json',
            ...(stage === 'reserve' ? { Prefer: 'tx=commit' } : {}),
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}
async function prepare(session) {
    await session.fetch(origin + paths.auth, rpcInit('auth'));
    await session.fetch(origin + paths.reserve, rpcInit('reserve', { acting_user_id: userA }));
}
async function result(response) {
    const data = await response.json();
    const raw = JSON.stringify(data);
    for (const privateValue of [token, config.serviceRoleKey, config.anonKey, syntheticProviderKey, '100 Market', expiry]) assert(!raw.includes(privateValue));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return data;
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }

(async () => {
    await test('Probe entry point reads only Supabase credentials and the nonsecret user allowlist', async () => {
        const read = []; let handler;
        const values = { SUPABASE_URL: origin, SUPABASE_ANON_KEY: config.anonKey,
            SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey, GEOAPIFY_PROBE_USER_ID: userA };
        const compiled = modules({ Deno: { env: { get(name) { read.push(name); return values[name]; } }, serve(fn) { handler = fn; } } });
        compiled.load('geoapify-suggest-probe/index.ts');
        assert.deepEqual(read, Object.keys(values)); assert.equal(typeof handler, 'function');
        assert(!compiled.loaded.some(p => p.endsWith('geoapify-suggest/index.ts')));
        const response = await handler(new Request(origin, { method: 'GET' })); assert.equal(response.status, 405);
    });
    await test('Missing allowlist, non-hosted origins and invalid configuration fail before native Fetch', async () => {
        for (const bad of [{ testUserId: '' }, { testUserId: 'invalid' }, { serviceRoleKey: '' }, { anonKey: '' },
            { supabaseUrl: 'http://abcdefghijklmnopqrst.supabase.co' }, { supabaseUrl: 'https://localhost' },
            { supabaseUrl: origin + '/path' }, { supabaseUrl: origin + '?q=x' }, { supabaseUrl: origin + ':8443' }]) {
            const f = fixture({ config: bad }); const response = await f.handler(request());
            assert.equal(response.status, 503); assert.equal((await result(response)).error.code, 'probe_unconfigured'); assert.equal(f.calls.length, 0);
        }
    });
    await test('Normal probe verifies Auth, reserves once, confirms exact identity/expiry, and mocks provider without network', async () => {
        const f = fixture(); const response = await f.handler(request()); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
        const data = await result(response); assert.deepEqual(data.suggestions, []);
        assert.deepEqual(f.calls.map(c => c.url.pathname), Object.values(paths));
        assert.equal(f.calls[0].init.headers.Authorization, authorization);
        assert.equal(f.calls[1].init.headers.Authorization, `Bearer ${config.serviceRoleKey}`);
        assert.deepEqual(JSON.parse(f.calls[2].init.body), { target_admission_id: admissionId, acting_user_id: userA, expected_permit_expires_at: expiry });
        assert.equal(f.calls[1].init.signal, f.calls[2].init.signal);
        assert.equal(data.probe.authVerified, true); assert.equal(data.probe.confirmationVerified, true);
        assert.equal(data.probe.mockProviderCalls, 1); assert.equal(data.probe.admissionId, admissionId);
    });
    await test('Unknown destinations, alternative paths, query strings, credentials and redirects cannot reach native Fetch', async () => {
        const forbidden = ['https://other.supabase.co/auth/v1/user', 'https://api.geoapify.com/other',
            'https://api.geoapify.com/v1/geocode/autocomplete/extra', 'http://api.geoapify.com/v1/geocode/autocomplete',
            'https://api.geoapify.com.evil.test/v1/geocode/autocomplete', 'http://127.0.0.1/auth/v1/user',
            origin + '/auth/v1/user?x=1', origin + '/auth/v1/user#fragment', origin + '/auth/v1/user/extra',
            origin + '/rest/v1/profiles', origin + '/rest/v1/rpc/anything', 'https://user:pass@abcdefghijklmnopqrst.supabase.co/auth/v1/user'];
        for (const url of forbidden) {
            const f = fixture(), session = f.session();
            await assert.rejects(session.fetch(url, rpcInit('auth'))); assert.equal(f.calls.length, 0);
        }
        const f = fixture();
        await assert.rejects(f.session().fetch(new Request(origin + paths.auth), rpcInit('auth')));
        await assert.rejects(f.session().fetch(origin + paths.auth, { ...rpcInit('auth'), redirect: 'follow' }));
        await assert.rejects(f.session().fetch(origin + paths.auth, { ...rpcInit('auth'), method: 'POST' }));
        assert.equal(f.calls.length, 0);
        const redirected = fixture({ network: () => json({}, 302, { Location: 'https://api.geoapify.com/' }) });
        const response = await redirected.handler(request()); assert.equal(response.status, 503);
        assert.equal((await result(response)).probe.mockProviderCalls, 0); assert.equal(redirected.calls.length, 1);
    });
    await test('Forwarded requests strip unrelated headers and options', async () => {
        const f = fixture(), session = f.session(), init = rpcInit('auth');
        init.headers.Host = 'api.geoapify.com'; init.headers['X-Private'] = 'never-forward'; init.referrer = 'https://private.example';
        await session.fetch(origin + paths.auth, init);
        assert.deepEqual(Object.keys(f.calls[0].init.headers).sort(), ['Authorization', 'apikey']);
        assert.equal(f.calls[0].init.referrer, undefined);
    });
    await test('Direct provider calls cannot bypass authentication, confirmation or single-attempt guard', async () => {
        const f = fixture(), session = f.session(), url = providerUrl;
        const init = { method: 'GET', headers: { 'x-api-key': syntheticProviderKey }, redirect: 'error', signal: new AbortController().signal };
        await assert.rejects(session.fetch(url, init)); assert.equal(f.calls.length, 0);
        await prepare(session); await assert.rejects(session.fetch(url, init)); assert.equal(f.calls.length, 2);
        await session.fetch(origin + paths.confirm, rpcInit('confirm', { target_admission_id: admissionId, acting_user_id: userA, expected_permit_expires_at: expiry }));
        assert.deepEqual(await (await session.fetch(url, init)).json(), { results: [] });
        await assert.rejects(session.fetch(url, init)); assert.equal(f.calls.length, 3);
    });
    await test('Probe only accepts the synthetic header key and rejects URL keys or unrelated headers without forwarding', async () => {
        const f = fixture(), session = f.session(); await prepare(session);
        await session.fetch(origin + paths.confirm, rpcInit('confirm', { target_admission_id: admissionId,
            acting_user_id: userA, expected_permit_expires_at: expiry }));
        const init = { method: 'GET', headers: { 'x-api-key': syntheticProviderKey }, redirect: 'error', signal: new AbortController().signal };
        for (const url of [providerUrl + '&apiKey=dummy', providerUrl + '&APIKEY=dummy', providerUrl + '&text=duplicate']) {
            await assert.rejects(session.fetch(url, init));
        }
        for (const headers of [undefined, { 'x-api-key': 'synthetic-production-key' },
            { 'x-api-key': syntheticProviderKey, Authorization: authorization },
            { 'x-api-key': syntheticProviderKey, apikey: config.serviceRoleKey }]) {
            await assert.rejects(session.fetch(providerUrl, { ...init, headers }));
        }
        assert.equal(f.calls.length, 3);
        assert.deepEqual(await (await session.fetch(providerUrl, init)).json(), { results: [] });
        assert.equal(f.calls.length, 3);
    });
    await test('Missing, malformed and API-key authorization never reach Auth or quota', async () => {
        for (const bearer of ['', 'Bearer sb_publishable_test', 'Bearer sb_secret_test', 'Basic aaa.e30.signature']) {
            const f = fixture(); const response = await f.handler(request('normal', bearer)); assert.equal(response.status, 401);
            assert.equal((await result(response)).probe.mockProviderCalls, 0); assert.equal(f.calls.length, 0);
        }
    });
    await test('Auth errors, unverified/foreign/anonymous/service users and forged claims cannot reserve', async () => {
        for (const body of [null, {}, { id: userB, role: 'authenticated' }, { id: userA, role: 'service_role' },
            { id: userA, role: 'authenticated', is_anonymous: true }]) {
            const f = fixture({ network: () => json(body) }); const response = await f.handler(request()); assert.equal(response.status, 401);
            assert.equal((await result(response)).probe.reservationRequests, 0); assert.equal(f.calls.length, 1);
        }
        for (const status of [401, 403, 500]) {
            const f = fixture({ network: () => json({}, status) }); const response = await f.handler(request());
            assert.equal(response.status, status === 500 ? 503 : 401); await result(response); assert.equal(f.calls.length, 1);
        }
    });
    await test('Forged quota identities and mismatched confirmation fields are blocked before forwarding', async () => {
        const f = fixture(), session = f.session(); await session.fetch(origin + paths.auth, rpcInit('auth'));
        await assert.rejects(session.fetch(origin + paths.reserve, rpcInit('reserve', { acting_user_id: userB })));
        assert.equal(f.calls.length, 1);
        await session.fetch(origin + paths.reserve, rpcInit('reserve', { acting_user_id: userA }));
        for (const changed of [{ target_admission_id: userB }, { acting_user_id: userB }, { expected_permit_expires_at: expiry.replace('123456', '123457') }]) {
            await assert.rejects(session.fetch(origin + paths.confirm, rpcInit('confirm', {
                target_admission_id: admissionId, acting_user_id: userA, expected_permit_expires_at: expiry, ...changed,
            })));
        }
        assert.equal(f.calls.length, 2);
    });
    await test('False, missing, malformed, failed and rollback quota responses all fail closed', async () => {
        const cases = [() => json(false), () => json(null), () => json({ confirmed: true }), () => json([true]),
            () => json({}, 404), () => json({}, 500), () => json(true, 200, { 'Preference-Applied': 'tx=rollback' }),
            () => new Response('invalid', { headers: { 'Content-Type': 'application/json' } }),
            () => { throw new Error('private message ' + config.serviceRoleKey); }];
        for (const failure of cases) {
            const f = fixture({ network: c => c.url.pathname === paths.confirm ? failure() : null });
            const response = await f.handler(request()); assert.equal(response.status, 503);
            assert.equal((await result(response)).probe.mockProviderCalls, 0); assert.equal(f.calls.length, 3);
        }
        const rollback = fixture({ network: c => c.url.pathname === paths.reserve ? json([{ admitted: true, admission_id: admissionId,
            permit_expires_at: expiry, reason: 'admitted', retry_after_seconds: 0 }], 200, { 'Preference-Applied': 'tx=rollback' }) : null });
        const response = await rollback.handler(request()); assert.equal(response.status, 503);
        assert.equal((await result(response)).probe.confirmationRequests, 0); assert.equal(rollback.calls.length, 2);
    });
    await test('Fault modes still use real Auth/reservation/confirmation and never contact a provider', async () => {
        for (const mode of ['confirmation-false', 'confirmation-error']) {
            const f = fixture(); const response = await f.handler(request(mode)); assert.equal(response.status, 503);
            const data = await result(response); assert.equal(data.error.code, 'quota_unavailable');
            assert.equal(data.probe.confirmationVerified, true); assert.equal(data.probe.mockProviderCalls, 0); assert.equal(f.calls.length, 3);
        }
    });
    await test('Quota denial preserves 429 and makes no confirmation or provider request', async () => {
        const f = fixture({ network: c => c.url.pathname === paths.reserve ? json([{ admitted: false, admission_id: null,
            permit_expires_at: null, reason: 'global_rate_limit', retry_after_seconds: 2 }]) : null });
        const response = await f.handler(request()); assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '2');
        const data = await result(response); assert.equal(data.probe.confirmationRequests, 0); assert.equal(data.probe.mockProviderCalls, 0);
    });
    await test('Confirmation is bounded by the shared deadline and late transport success cannot dispatch', async () => {
        const timer = timers(); let release;
        const held = new Promise(resolve => { release = resolve; });
        const f = fixture({ globals: { setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout },
            network: c => c.url.pathname === paths.confirm ? held : null });
        const pending = f.handler(request()); await until(() => f.calls.length === 3);
        assert.equal(timer.count(800), 1); f.clock.mono = 800; timer.fire(800);
        const response = await pending; assert.equal(response.status, 503); const data = await result(response);
        assert.equal(data.probe.mockProviderCalls, 0); assert.equal(data.probe.quotaElapsedMs, 800);
        release(json(true)); await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.calls.length, 3); assert.equal(timer.size, 0); assert(f.calls[2].init.signal.aborted);
    });
    await test('Shared-budget fault delays 400ms then past 800ms without restarting the timer', async () => {
        const timer = timers(), waits = []; let release;
        const held = new Promise(resolve => { release = resolve; });
        const f = fixture({ globals: { setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout }, delay: (ms) => {
            waits.push(ms); if (waits.length === 1) { f.clock.mono = 400; return Promise.resolve(); } return held;
        } });
        const pending = f.handler(request('shared-deadline')); await until(() => waits.length === 2);
        assert.deepEqual(waits, [400, 450]); assert.equal(timer.count(800), 1);
        f.clock.mono = 800; timer.fire(800); const response = await pending;
        assert.equal(response.status, 503); assert.equal((await result(response)).probe.mockProviderCalls, 0);
        f.clock.mono = 850; release(); await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.calls.length, 3); assert.equal(timer.size, 0);
    });
    await test('Partial confirmation fault cannot pass strict JSON true and its body is bounded', async () => {
        const timer = timers();
        const f = fixture({ globals: { setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout } });
        const pending = f.handler(request('confirmation-stall')); await until(() => f.calls.length === 3);
        for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
        f.clock.mono = 800; timer.fire(800); const response = await pending;
        assert.equal(response.status, 503); assert.equal((await result(response)).probe.mockProviderCalls, 0); assert.equal(timer.size, 0);
    });
    await test('799ms permits a mock start; 800ms, expiry and invalid clocks cannot', async () => {
        for (const elapsed of [799, 800, -1, NaN]) {
            const f = fixture({ network: (c, clock) => { if (c.url.pathname === paths.confirm) { clock.mono = elapsed; return json(true); } } });
            const response = await f.handler(request()); assert.equal(response.status, elapsed === 799 ? 200 : 503);
            assert.equal((await result(response)).probe.mockProviderCalls, elapsed === 799 ? 1 : 0);
        }
        const f = fixture(); f.clock.now = baseTime + 2000;
        const response = await f.handler(request()); assert.equal(response.status, 503);
        assert.equal((await result(response)).probe.mockProviderCalls, 0); assert.equal(f.calls.length, 2);
    });
    await test('Dispatch telemetry uses the original handler start rather than resetting at native Fetch', async () => {
        let reads = 0;
        const f = fixture({ monotonicNow: () => reads++ === 0 ? 0 : 50 });
        const response = await f.handler(request()); assert.equal(response.status, 200);
        const data = await result(response);
        assert.equal(data.probe.mockDispatchElapsedMs, 50); assert.equal(data.probe.quotaElapsedMs, 50);
    });
    await test('Cancellation during confirmation cannot dispatch; a new invocation reserves afresh', async () => {
        const controller = new AbortController(); let release, hold = true;
        const held = new Promise(resolve => { release = resolve; });
        const f = fixture({ network: c => hold && c.url.pathname === paths.confirm ? held : null });
        const req = request(); const pending = f.handler(new Request(req, { signal: controller.signal }));
        await until(() => f.calls.length === 3); controller.abort();
        const response = await pending; assert.equal(response.status, 503); assert.equal((await result(response)).probe.mockProviderCalls, 0);
        release(json(true)); await new Promise(resolve => setImmediate(resolve)); hold = false;
        const next = await f.handler(request()); assert.equal(next.status, 200);
        assert.equal((await result(next)).probe.reservationRequests, 1); assert.equal(f.calls.length, 6);
    });
    await test('Concurrent invocations isolate modes and native request counts', async () => {
        const f = fixture(); const responses = await Promise.all([f.handler(request()), f.handler(request('confirmation-false'))]);
        assert.deepEqual(responses.map(r => r.status), [200, 503]);
        const data = await Promise.all(responses.map(result));
        assert.deepEqual(data.map(d => d.probe.mockProviderCalls), [1, 0]);
        assert(data.every(d => d.probe.reservationRequests === 1 && d.probe.confirmationRequests === 1)); assert.equal(f.calls.length, 6);
    });
    await test('Unknown modes and forged body fields cannot start networking', async () => {
        const f = fixture(); const invalidMode = await f.handler(request('real-provider')); assert.equal(invalidMode.status, 400);
        const invalidBody = await f.handler(request('normal', authorization, { action: 'suggest', query: '100 Market', acting_user_id: userA }));
        assert.equal(invalidBody.status, 400); await result(invalidBody); assert.equal(f.calls.length, 0);
    });
    await test('Production entry point has no probe import, environment flag or header-controlled mock mode', async () => {
        const read = [], native = []; let handler;
        const values = { SUPABASE_URL: origin, SUPABASE_ANON_KEY: config.anonKey, SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
            GEOAPIFY_API_KEY: 'synthetic-production-provider-key', GEOAPIFY_SELECTION_SECRET: '22'.repeat(32),
            GEOAPIFY_ALLOWED_USER_ID: userA,
            GEOAPIFY_PROBE_USER_ID: userA };
        const f = fixture();
        const compiled = modules({ Deno: { env: { get(name) { read.push(name); return values[name]; } }, serve(fn) { handler = fn; } },
            fetch: async (input, init) => {
                const url = new URL(String(input)); native.push(url);
                if (url.origin === 'https://api.geoapify.com') {
                    assert(!url.searchParams.has('apiKey') && !url.href.includes(values.GEOAPIFY_API_KEY));
                    assert.deepEqual([...new Headers(init.headers)], [['x-api-key', values.GEOAPIFY_API_KEY]]);
                    return json({ results: [] }); // Test spy, never a real request.
                }
                if (url.pathname === paths.auth) return json({ id: userA, role: 'authenticated' });
                if (url.pathname === paths.reserve) return json([{ admitted: true, admission_id: admissionId,
                    permit_expires_at: new Date(Date.now() + 1000).toISOString(), reason: 'admitted', retry_after_seconds: 0 }]);
                assert.equal(init.method, 'POST'); return json(true);
            } });
        compiled.load('geoapify-suggest/index.ts');
        const response = await handler(request('confirmation-false')); assert.equal(response.status, 200);
        assert.equal(native.filter(url => url.origin === 'https://api.geoapify.com').length, 1);
        assert(!read.includes('GEOAPIFY_PROBE_USER_ID')); assert(!compiled.loaded.some(p => p.includes('geoapify-suggest-probe')));
        assert.equal(f.calls.length, 0);
    });
    console.log(passed + ' offline isolated-probe checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
