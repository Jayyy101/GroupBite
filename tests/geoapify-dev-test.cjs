// Opt-in iOS test mode through actual forms/component/adapter. Synthetic public
// config and Auth sessions only; every HTTP boundary is mocked, never forwarded.
const assert = require('node:assert/strict');
const { runtime, fixture, response, screen, click, enter, nodes, textOf, button } = require('./personal-places.cjs');
const taylor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const group = '22222222-2222-2222-2222-222222222222';
const token = 'offline.e30.signature';
const address = '100 Offline Test Street, San Francisco, CA 94103, USA';
const receipt = 'offline.' + 'a'.repeat(43);
const optedIn = { EXPO_PUBLIC_GEOAPIFY_DEV_TEST: 'true', EXPO_PUBLIC_GEOAPIFY_DEV_USER_ID: taylor };
const forms = ['personal-place-form']; // M18 retains Geoapify only in personal restaurant-facts editing.
let passed = 0;
function clock() {
    let time = 0, sequence = 0; const timers = new Map();
    return {
        setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { at: time + delay, fn }); return id; },
        clearTimeout(id) { timers.delete(id); },
        get size() { return timers.size; },
        async advance(ms, r) {
            const end = time + ms;
            while (true) {
                const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
                if (!next || next[1].at > end) break;
                time = next[1].at; timers.delete(next[0]); next[1].fn(); await r.settle();
            }
            time = end; await r.settle();
        },
    };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function backend(call) {
    if (call.url.pathname === '/rest/v1/groups') return response([{ id: group, name: 'Dinner', owner_user_id: taylor }]);
    if (call.url.pathname === '/rest/v1/rpc/get_group_restaurants') return response([{ id: '55555555-5555-5555-5555-555555555555', restaurant_id: '44444444-4444-4444-4444-444444444444' }]);
    if (call.url.pathname === '/rest/v1/rpc/save_restaurant_visit') return response('44444444-4444-4444-4444-444444444444');
    if (call.url.pathname === '/rest/v1/personal_places' && call.method === 'POST') return response(fixture({ ...call.body, owner_user_id: taylor }), 201);
    if (call.url.pathname === '/rest/v1/personal_places' && call.method === 'GET') return response(fixture());
    if (call.url.pathname.endsWith('/update_personal_place')) return response([fixture()]);
    assert.fail('Unexpected backend path ' + call.url.pathname);
}
function result(rt) {
    return response({ suggestions: [{ id: 'test-result', source: 'geoapify', address, latitude: 37.7749, longitude: -122.4194,
        accuracy: 'building', countryCode: 'us', selectionReceipt: receipt, expiresAt: new Date(Date.now() + 600000).toISOString() }],
        attribution: rt.load('@/lib/address-search').GEOAPIFY_ATTRIBUTION });
}
function setup(options = {}) {
    const time = clock(), calls = []; let props;
    const rt = runtime({ development: true, platform: 'ios', autocompleteEnv: optedIn, fetch: backend,
        setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, ...options,
        observeComponent(type, value) { if (type.name === 'AddressAutocomplete') props = value; },
        autocompleteFetch(input, init) {
            assert.equal(new URL(input).href, 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/geoapify-suggest');
            assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
            const headers = new Headers(init.headers), body = JSON.parse(init.body);
            assert.equal(headers.get('apikey'), 'sb_publishable_offline_test');
            assert.deepEqual(Object.keys(body).sort(), ['action', 'query']); assert.equal(body.action, 'suggest');
            calls.push({ headers, body, signal: init.signal });
            return options.reply ? options.reply(calls.length, rt) : Promise.resolve(result(rt));
        },
    });
    rt.world.auth.session = { user: { id: taylor }, access_token: token };
    rt.world.params = { id: fixture().id };
    return { rt, time, calls, get props() { return props; } };
}
function rows(r) { return nodes(r.output).filter(n => n.props?.accessibilityLabel?.startsWith('Use address:')); }
function input(r) { return nodes(r.output).find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Restaurant address'); }
async function search(f, r, text = 'Offline') {
    await enter(r, 'Restaurant address', text); await click(r, 'Search address once'); await f.time.advance(400, r);
}
async function test(label, fn) { await fn(); passed++; console.log('PASS ' + label); }

(async () => {
    await test('Missing, false, malformed or incomplete public opt-in config keeps both forms on mocks with zero real HTTP', async () => {
        for (const env of [{}, { ...optedIn, EXPO_PUBLIC_GEOAPIFY_DEV_TEST: 'false' }, { ...optedIn, EXPO_PUBLIC_GEOAPIFY_DEV_TEST: 'TRUE' },
            { ...optedIn, EXPO_PUBLIC_GEOAPIFY_DEV_TEST: '1' }, { EXPO_PUBLIC_GEOAPIFY_DEV_TEST: 'true' },
            { ...optedIn, EXPO_PUBLIC_GEOAPIFY_DEV_USER_ID: 'invalid' }, { ...optedIn, EXPO_PUBLIC_GEOAPIFY_DEV_USER_ID: ` ${taylor} ` },
            { ...optedIn, EXPO_PUBLIC_GEOAPIFY_DEV_USER_ID: taylor + '\n' }]) {
            for (const name of forms) {
                const f = setup({ autocompleteEnv: env }), r = screen(f.rt, name); await r.settle();
                await enter(r, 'Restaurant address', 'Demo'); await f.time.advance(2000, r);
                assert.equal(f.props.mode, 'mock'); assert.equal(f.props.search, undefined); assert.equal(f.calls.length, 0);
                assert(!textOf(r.output).includes('Search address once')); assert(textOf(r.output).includes('fictional mock')); r.unmount();
            }
        }
    });
    await test('Release builds stay manual even with opt-in values and a simulated future code gate', async () => {
        for (const name of forms) for (const futureGate of [false, true]) {
            const f = setup({ development: false }); f.rt.load('@/lib/address-search').GEOAPIFY_AUTOCOMPLETE_ENABLED = futureGate;
            const r = screen(f.rt, name); await r.settle(); await enter(r, 'Restaurant address', 'Manual Address'); await f.time.advance(2000, r);
            assert.equal(f.props.mode, 'mock'); assert.equal(f.props.search, undefined); assert.equal(f.calls.length, 0);
            assert(!textOf(r.output).includes('Search address once')); assert(!textOf(r.output).includes('mock')); assert.equal(input(r).props.editable, true);
            let lookups = 0;
            const adapter = f.rt.load('@/lib/geoapify-address-search').createGeoapifyAddressSearch({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
                publishableKey: 'sb_publishable_offline_test', getSession() { lookups++; return f.rt.world.auth.session; } });
            await assert.rejects(adapter('Offline', new AbortController().signal), e => e.kind === 'disabled'); assert.equal(lookups, 0);
            r.unmount();
        }
    });
    await test('The opt-in test is iOS-only; Android and web retain existing mock/manual behavior', async () => {
        for (const platform of ['android', 'web']) for (const name of forms) {
            const f = setup({ platform }), r = screen(f.rt, name); await r.settle(); await enter(r, 'Restaurant address', 'Demo'); await f.time.advance(2000, r);
            assert.equal(f.props.mode, 'mock'); assert.equal(f.props.search, undefined); assert.equal(f.calls.length, 0); r.unmount();
        }
    });
    await test('Only the configured current account gets real controls; direct wrong-account calls fail before Fetch', async () => {
        for (const name of forms) {
            const f = setup(); f.rt.world.auth.session = { user: { id: other }, access_token: token };
            const r = screen(f.rt, name); await r.settle(); assert.equal(f.props.mode, 'mock'); await enter(r, 'Restaurant address', 'Demo'); await f.time.advance(2000, r);
            assert.equal(f.calls.length, 0); assert(!textOf(r.output).includes('Search address once'));
            const adapter = f.rt.load('@/lib/geoapify-address-search').createGeoapifyAddressSearch({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
                publishableKey: 'sb_publishable_offline_test', getSession: () => f.rt.world.auth.session });
            await assert.rejects(adapter('Offline', new AbortController().signal), e => e.kind === 'access_denied'); assert.equal(f.calls.length, 0); r.unmount();
        }
    });
    for (const name of forms) {
        await test(`${name}: typing is free; an explicit button press retains debounce, double-tap safety, JWT and attribution`, async () => {
            const f = setup(), r = screen(f.rt, name); await r.settle();
            assert.equal(f.rt.load('@/lib/address-search').GEOAPIFY_AUTOCOMPLETE_ENABLED, false);
            assert.equal(f.props.mode, 'geoapify'); assert.equal(f.props.manualSearch, true);
            await enter(r, 'Restaurant address', 'Of'); assert(button(r, 'Search address once').props.disabled);
            await enter(r, 'Restaurant address', 'Offline'); await f.time.advance(2000, r); assert.equal(f.calls.length, 0);
            const press = button(r, 'Search address once').props.onPress; press(); press(); await r.settle();
            assert(button(r, 'Search address once').props.disabled); await f.time.advance(399, r); assert.equal(f.calls.length, 0);
            await enter(r, 'Restaurant name', 'Test Cafe'); await f.time.advance(1, r); assert.equal(f.calls.length, 1);
            assert.equal(f.calls[0].headers.get('Authorization'), `Bearer ${token}`); assert.equal(rows(r).length, 1);
            assert(textOf(r.output).includes('Powered by Geoapify')); assert(textOf(r.output).includes('OpenStreetMap'));
            await f.time.advance(2000, r); assert.equal(f.calls.length, 1); assert(button(r, 'Search address once').props.disabled);
            rows(r)[0].props.onPress(); await r.settle(); assert.equal(f.props.selection.selectionReceipt, receipt);
            assert.equal(f.props.selection.latitude, 37.7749); assert.equal(f.props.selection.longitude, -122.4194);
            await enter(r, 'Restaurant address', 'Manual replacement'); assert.equal(f.props.selection, null);
            await f.time.advance(2000, r); assert.equal(f.calls.length, 1); r.unmount();
        });
        await test(`${name}: the opt-in selection preserves original saves without coordinates, receipts or attachment calls`, async () => {
            const f = setup(), r = screen(f.rt, name); await r.settle(); await enter(r, 'Restaurant name', 'Test Cafe'); await search(f, r);
            rows(r)[0].props.onPress(); await r.settle(); await click(r, name === 'add-visit' ? 'Save Visit' : 'Save Changes');
            const posts = f.rt.world.requests.filter(c => c.method === 'POST' && !c.url.pathname.endsWith('/get_group_restaurants'));  assert.equal(posts.length, 1);
            const keys = name === 'add-visit' ? ['client_request_id', 'restaurant_address', 'restaurant_cuisine', 'restaurant_name', 'target_group_ids', 'visit_date', 'visit_notes', 'visit_rating', 'visit_would_go_again']
                : ['target_personal_place_id','expected_revision','restaurant_name','restaurant_address','restaurant_cuisine'];
            assert.deepEqual(Object.keys(posts[0].body).sort(), keys.sort()); assert.equal(posts[0].body.address ?? posts[0].body.restaurant_address, address);
            assert.equal(f.rt.world.localWrites, 0); assert.equal(f.calls.length, 1); assert(!JSON.stringify(posts[0].body).includes(receipt));
            assert(!f.rt.world.requests.some(c => /attach|location|quota/.test(c.url.pathname))); r.unmount();
        });
    }
    await test('Three attempts are shared across both forms, remounts, background, account changes and refreshed tokens', async () => {
        const f = setup();
        for (const [i, name] of ['personal-place-form', 'personal-place-form', 'personal-place-form'].entries()) {
            const r = screen(f.rt, name); await r.settle(); await search(f, r, 'Offline ' + i); assert.equal(f.calls.length, i + 1);
            f.rt.emit('background'); await r.settle(); f.rt.emit('active'); await r.settle();
            f.rt.world.auth.session = { user: { id: taylor }, access_token: 'new.e30.signature' }; r.dirty = true; await r.settle(); r.unmount();
        }
        f.rt.world.auth.session = { user: { id: other }, access_token: token };
        const wrong = screen(f.rt, 'personal-place-form'); await wrong.settle(); assert.equal(f.props.mode, 'mock'); wrong.unmount();
        f.rt.world.auth.session = { user: { id: taylor }, access_token: token };
        const r = screen(f.rt, 'personal-place-form'); await r.settle(); await search(f, r, 'Fourth query');
        assert.equal(f.calls.length, 3); assert(textOf(r.output).includes('Development test limit reached')); assert.equal(input(r).props.editable, true);
        await f.time.advance(20000, r); assert.equal(f.calls.length, 3); r.unmount();
    });
    await test('Concurrent adapter instances cannot race past the shared three-attempt cap', async () => {
        const f = setup(), release = deferred(); let starts = 0;
        const make = f.rt.load('@/lib/geoapify-address-search').createGeoapifyAddressSearch;
        const adapters = Array.from({ length: 4 }, () => make({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
            publishableKey: 'sb_publishable_offline_test', getSession: () => f.rt.world.auth.session,
            fetch: async input => {
                assert.equal(new URL(input).href, 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/geoapify-suggest');
                starts++; await release.promise; return result(f.rt);
            } }));
        const pending = Promise.allSettled(adapters.map((search, i) => search('Concurrent query ' + i, new AbortController().signal)));
        assert.equal(starts, 3); release.resolve();
        const results = await pending; assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
        assert.equal(results.filter(r => r.status === 'rejected' && r.reason.kind === 'test_limit').length, 1);
        await assert.rejects(adapters[0]('One more query', new AbortController().signal), e => e.kind === 'test_limit');
        assert.equal(starts, 3);
    });
    await test('Failed, cancelled and timed-out HTTP attempts remain spent; late responses cannot produce results or retries', async () => {
        const cancelled = deferred(), timeout = deferred();
        const f = setup({ reply: n => n === 1 ? Promise.resolve(new Response('UNSAFE_ERROR_TOKEN', { status: 503 })) : n === 2 ? cancelled.promise : timeout.promise });
        const r = screen(f.rt, 'personal-place-form'); await r.settle(); await search(f, r, 'First query');
        assert(!textOf(r.output).includes('UNSAFE_ERROR')); await search(f, r, 'Second query');
        input(r).props.onBlur(); await r.settle(); assert(f.calls[1].signal.aborted); cancelled.resolve(result(f.rt)); await r.settle();
        await search(f, r, 'Third query'); await f.time.advance(15000, r); assert(f.calls[2].signal.aborted);
        timeout.resolve(result(f.rt)); await r.settle(); assert.equal(rows(r).length, 0);
        await search(f, r, 'Fourth query'); assert.equal(f.calls.length, 3); assert(textOf(r.output).includes('Development test limit reached'));
        assert.equal(f.time.size, 0); assert.equal(f.rt.world.lateUpdates, 0); r.unmount();
    });
    await test('Cancelled debounce and rejected local authentication spend no attempt', async () => {
        const f = setup(), r = screen(f.rt, 'personal-place-form'); await r.settle();
        await enter(r, 'Restaurant address', 'Cancel before dispatch'); await click(r, 'Search address once'); input(r).props.onBlur(); await r.settle();
        await f.time.advance(400, r); assert.equal(f.calls.length, 0);
        f.rt.world.auth.error = 'Safe synthetic auth error'; r.dirty = true; await r.settle(); await search(f, r, 'Auth error'); assert.equal(f.calls.length, 0);
        f.rt.world.auth.error = ''; r.dirty = true; await r.settle();
        for (let i = 0; i < 3; i++) await search(f, r, 'Valid query ' + i);
        assert.equal(f.calls.length, 3); r.unmount();
    });
    await test('Retry-After remains enforced with explicit search; cooldown rejections spend no further attempts', async () => {
        const f = setup({ reply: () => Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '60' } })) });
        const r = screen(f.rt, 'personal-place-form'); await r.settle(); await search(f, r, 'First query'); await search(f, r, 'Cooldown query');
        assert.equal(f.calls.length, 1); assert(textOf(r.output).includes('Suggestions paused')); r.unmount();
        const direct = f.rt.load('@/lib/geoapify-address-search').createGeoapifyAddressSearch({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
            publishableKey: 'sb_publishable_offline_test', getSession: () => f.rt.world.auth.session, fetch: async () => result(f.rt) });
        await direct('Second attempt', new AbortController().signal); await direct('Third attempt', new AbortController().signal);
        await assert.rejects(direct('Fourth attempt', new AbortController().signal), e => e.kind === 'test_limit');
    });
    await test('Account changes and sign-out cancel real test work; refreshed sessions discard old results without retry', async () => {
        for (const change of ['account', 'signout', 'refresh']) {
            const pending = deferred(), f = setup({ reply: () => pending.promise }), r = screen(f.rt, 'personal-place-form');
            await r.settle(); await search(f, r);
            f.rt.world.auth.session = change === 'signout' ? null : { user: { id: change === 'account' ? other : taylor }, access_token: 'new.e30.signature' };
            r.dirty = true; await r.settle(); pending.resolve(result(f.rt)); await r.settle();
            assert.equal(rows(r).length, 0); assert.equal(f.calls.length, 1); assert.equal(f.rt.world.lateUpdates, 0);
            if (change !== 'refresh') assert(f.calls[0].signal.aborted);
            else assert(textOf(r.output).includes('Sign in again'));
            r.unmount();
        }
    });
    console.log(`${passed} offline development-only Geoapify test-mode checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
