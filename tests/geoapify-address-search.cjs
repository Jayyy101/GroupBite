// Actual typed adapter, virtual timers, synthetic session and mocked Fetch only.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../lib');
const userA = '11111111-1111-1111-1111-111111111111', userB = '22222222-2222-2222-2222-222222222222';
const base = Date.parse('2026-10-10T12:00:00Z');
const token = 'aaa.e30.signature';
const publicKey = 'sb_publishable_offline_fixture';
const receipt = 'opaque_payload.' + 'a'.repeat(43);
const row = { id: 'provider-building', source: 'geoapify', address: '100 Market Street, San Francisco, CA, US',
    latitude: 37.7749, longitude: -122.4194, accuracy: 'building', countryCode: 'us', selectionReceipt: receipt,
    expiresAt: new Date(base + 600000).toISOString() };
const attribution = { text: 'Powered by Geoapify | © OpenStreetMap contributors',
    geoapifyUrl: 'https://www.geoapify.com/', openStreetMapUrl: 'https://www.openstreetmap.org/copyright' };
const json = (body = { suggestions: [row], attribution }, status = 200, headers = {}) => new Response(JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json', ...headers } });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; }
function modules(enabled, timers, logs) {
    const cache = new Map();
    function load(name) {
        const file = path.resolve(root, name + '.ts'); assert.equal(path.dirname(file), root);
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} }; cache.set(file, module);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
        vm.runInNewContext(code, { module, exports: module.exports, require: name => load(name), URL, Headers,
            AbortController, Date, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
            fetch: () => assert.fail('Unmocked network request'), console: Object.fromEntries(['log', 'warn', 'error', 'debug', 'info', 'trace'].map(k => [k, (...args) => logs.push(args)])) }, { filename: file });
        return module.exports;
    }
    const shared = load('address-search'); assert.equal(shared.GEOAPIFY_AUTOCOMPLETE_ENABLED, false);
    // Simulates the future approved code switch only inside this isolated VM.
    shared.GEOAPIFY_AUTOCOMPLETE_ENABLED = enabled;
    return { shared, adapter: load('geoapify-address-search') };
}
function fixture(options = {}) {
    const calls = [], logs = [], pendingTimers = new Map(); let sequence = 0, time = base, sessions = 0;
    let session = { access_token: token, user: { id: userA, is_anonymous: false }, expires_at: base / 1000 + 3600 };
    const timers = { setTimeout(fn, ms) { const id = ++sequence; pendingTimers.set(id, { fn, ms }); return id; },
        clearTimeout(id) { pendingTimers.delete(id); } };
    const compiled = modules(options.enabled ?? true, timers, logs);
    const search = compiled.adapter.createGeoapifyAddressSearch({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
        publishableKey: publicKey, ...options.config, now: () => time, getSession: () => { sessions++; return options.session ? options.session() : session; },
        fetch: async (input, init) => { const url = new URL(input); calls.push({ url, init });
            assert.equal(url.origin, 'https://abcdefghijklmnopqrst.supabase.co'); assert.equal(url.pathname, '/functions/v1/geoapify-suggest');
            assert.equal(url.search, ''); assert(!url.href.includes(token)); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
            const headers = new Headers(init.headers); assert.equal(headers.get('Authorization'), `Bearer ${token}`);
            assert.equal(headers.get('apikey'), publicKey); assert(!headers.has('x-api-key')); assert.equal(headers.get('Content-Type'), 'application/json');
            assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(), ['action', 'query']);
            return options.fetch ? options.fetch(calls.at(-1)) : json(); } });
    return { search, calls, logs, compiled, pendingTimers, sessions: () => sessions,
        setSession: next => { session = next; }, advance: ms => { time += ms; },
        timeout() { const [id, timer] = [...pendingTimers].find(([, t]) => t.ms === 15000); pendingTimers.delete(id); timer.fn(); } };
}
async function fail(promise, kind) {
    await assert.rejects(promise, error => { assert.equal(error.kind, kind);
        for (const value of [token, publicKey, row.address, receipt]) assert(!String(error).includes(value)); return true; });
}
const signal = () => new AbortController().signal;
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
(async () => {
    await test('Checked-in disabled gate precedes session/configuration and all Fetch', async () => {
        const f = fixture({ enabled: false, config: { supabaseUrl: 'invalid' } });
        await fail(f.search('100 Market', signal()), 'disabled'); assert.equal(f.sessions(), 0); assert.equal(f.calls.length, 0);
    });
    await test('Authenticated POST calls only the suggestion Edge Function and retains opaque metadata exactly', async () => {
        const f = fixture(), items = await f.search('  100 Market &apiKey=not-a-key  ', signal());
        assert.deepEqual({ ...items[0] }, row); assert(Object.isFrozen(items[0])); assert.equal(f.calls.length, 1);
        assert.deepEqual(JSON.parse(f.calls[0].init.body), { action: 'suggest', query: '100 Market &apiKey=not-a-key' });
        assert.equal(f.pendingTimers.size, 0); assert.deepEqual(f.logs, []);
    });
    await test('Missing sessions, invalid/expired tokens and anonymous users never make requests', async () => {
        for (const session of [null, { access_token: 'sb_publishable_bad', user: { id: userA } },
            { access_token: token, user: { id: userA, is_anonymous: true } },
            { access_token: token, user: { id: 'bad' } }, { access_token: token, user: { id: userA }, expires_at: base / 1000 }]) {
            const f = fixture({ session: () => session }); await fail(f.search('100 Market', signal()), 'authentication'); assert.equal(f.calls.length, 0);
        }
    });
    await test('Invalid destinations or secret/service keys cannot configure a mobile adapter', async () => {
        for (const config of [{ supabaseUrl: 'http://abcdefghijklmnopqrst.supabase.co' }, { supabaseUrl: 'https://api.geoapify.com' },
            { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co/?key=x' }, { supabaseUrl: 'https://user:pass@abcdefghijklmnopqrst.supabase.co/' },
            { publishableKey: 'sb_secret_never-use' }, { publishableKey: 'aaa.e30.signature' }]) {
            const f = fixture({ config }); await fail(f.search('100 Market', signal()), 'unconfigured'); assert.equal(f.calls.length, 0);
        }
    });
    await test('Input limits reject short/oversized/control-character queries without fetching', async () => {
        for (const query of ['aa', ' ', 'a'.repeat(301), '100\nMarket']) {
            const f = fixture(); await fail(f.search(query, signal()), 'invalid_query'); assert.equal(f.calls.length, 0);
        }
    });
    await test('Authentication, Taylor restriction and service errors are sanitized without reading raw error bodies', async () => {
        for (const [status, kind] of [[401, 'authentication'], [403, 'access_denied'], [503, 'unavailable'], [502, 'unavailable']]) {
            const f = fixture({ fetch: () => { const response = json({ message: token + receipt }, status); response.text = () => assert.fail('Raw error body read'); return response; } });
            await fail(f.search('100 Market', signal()), kind); assert.equal(f.calls.length, 1); assert.deepEqual(f.logs, []);
        }
    });
    await test('Retry-After blocks explicit new edits through the full cooldown, without retries or scheduled Fetch', async () => {
        for (const status of [429, 503]) {
            const f = fixture({ fetch: () => json({}, status, { 'Retry-After': '3' }) });
            await fail(f.search('100 Market', signal()), 'rate_limited'); await fail(f.search('200 Market', signal()), 'rate_limited');
            assert.equal(f.calls.length, 1); f.advance(2999); await fail(f.search('300 Market', signal()), 'rate_limited');
            assert.equal(f.calls.length, 1); f.advance(1); await fail(f.search('400 Market', signal()), 'rate_limited'); assert.equal(f.calls.length, 2);
            assert.equal(f.pendingTimers.size, 0);
        }
    });
    await test('Retry-After HTTP dates, excessive values and missing/malformed hints are bounded', async () => {
        for (const [hint, seconds] of [[new Date(base + 5000).toUTCString(), 5], ['999999999', 86401], ['bad', 60], [null, 60]]) {
            const f = fixture({ fetch: () => json({}, 429, hint === null ? {} : { 'Retry-After': hint }) });
            await assert.rejects(f.search('100 Market', signal()), error => error.retryAfterSeconds === seconds);
            assert.equal(f.calls.length, 1);
        }
    });
    await test('Parent cancellation ignores late transports and never repeats a possibly charged request', async () => {
        const task = deferred(), f = fixture({ fetch: () => task.promise }), controller = new AbortController();
        const pending = f.search('100 Market', controller.signal); controller.abort(); await fail(pending, 'cancelled');
        task.resolve(json()); await new Promise(r => setImmediate(r)); assert.equal(f.calls.length, 1); assert(f.calls[0].init.signal.aborted);
        const before = fixture(), cancelled = new AbortController(); cancelled.abort(); await fail(before.search('100 Market', cancelled.signal), 'cancelled'); assert.equal(before.calls.length, 0);
    });
    await test('Client deadline covers response bodies and ignores late success even when abort is ignored', async () => {
        for (const body of [false, true]) {
            const task = deferred(); const response = json(); if (body) response.text = () => task.promise;
            const f = fixture({ fetch: () => body ? response : task.promise }); const pending = f.search('100 Market', signal());
            await new Promise(r => setImmediate(r)); f.timeout(); await fail(pending, 'timeout');
            task.resolve(body ? JSON.stringify({ suggestions: [row], attribution }) : response);
            await new Promise(r => setImmediate(r)); assert.equal(f.calls.length, 1); assert.equal(f.pendingTimers.size, 0);
        }
    });
    await test('Account switches, token changes and sign-out discard responses before and after body completion', async () => {
        for (const next of [null, { access_token: token, user: { id: userB } }, { access_token: 'bbb.e30.signature', user: { id: userA } }]) {
            for (const body of [false, true]) {
                const task = deferred(), response = json(); if (body) response.text = () => task.promise;
                const f = fixture({ fetch: () => body ? response : task.promise }), pending = f.search('100 Market', signal());
                await new Promise(r => setImmediate(r)); f.setSession(next);
                task.resolve(body ? JSON.stringify({ suggestions: [row], attribution }) : response);
                await fail(pending, 'account_changed'); assert.equal(f.calls.length, 1);
            }
        }
    });
    await test('Invalid schema, attribution, coordinate, receipt and expiry contracts fail closed', async () => {
        const badRows = [{ source: 'development-mock' }, { selectionReceipt: '' }, { expiresAt: new Date(base).toISOString() },
            { expiresAt: 'invalid' }, { latitude: 91 }, { longitude: 181 }, { latitude: 0, longitude: 0 }, { accuracy: 'street' }, { countryCode: 'ca' }, { address: 'bad\naddress' }];
        const bodies = [null, {}, { suggestions: [row], attribution: { ...attribution, geoapifyUrl: 'https://evil.test/' } },
            { suggestions: [row, row], attribution }, { suggestions: Array(6).fill(row), attribution },
            ...badRows.map(change => ({ suggestions: [{ ...row, ...change }], attribution }))];
        for (const body of bodies) {
            const f = fixture({ fetch: () => json(body) }); await fail(f.search('100 Market', signal()), 'invalid_response'); assert.equal(f.calls.length, 1);
        }
    });
    await test('Empty results remain successful; unknown provider fields never enter selection metadata', async () => {
        const empty = fixture({ fetch: () => json({ suggestions: [], attribution }) }); assert.equal((await empty.search('100 Market', signal())).length, 0);
        const extra = fixture({ fetch: () => json({ suggestions: [{ ...row, debug: token }], attribution, secret: token }) });
        assert.deepEqual({ ...(await extra.search('100 Market', signal()))[0] }, row);
    });
    await test('Malformed/oversized JSON and unsafe content types never yield suggestions', async () => {
        for (const response of [new Response('bad', { headers: { 'Content-Type': 'application/json' } }),
            new Response('x'.repeat(65537), { headers: { 'Content-Type': 'application/json' } }),
            json(undefined, 200, { 'Content-Length': '65537' }), json(undefined, 200, { 'Content-Type': 'text/html' })]) {
            const f = fixture({ fetch: () => response }); await fail(f.search('100 Market', signal()), 'invalid_response');
        }
    });
    await test('Transport/session failures never expose raw tokens, queries or exception messages', async () => {
        for (const sessionFailure of [false, true]) {
            const failRaw = () => { throw new Error(token + receipt + row.address); };
            const f = fixture(sessionFailure ? { session: failRaw } : { fetch: failRaw });
            await fail(f.search('100 Market', signal()), 'unavailable'); assert.deepEqual(f.logs, []);
            assert.equal(f.calls.length, sessionFailure ? 0 : 1);
        }
    });
    console.log(passed + ' offline authenticated Geoapify client checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
