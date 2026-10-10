// Actual form -> hook -> component -> typed adapter. Entirely offline: synthetic
// sessions/public config, virtual timers and blocked/mocked HTTP boundaries.
const assert = require('node:assert/strict');
const { runtime, fixture, response, screen, click, enter, nodes, textOf } = require('./personal-places.cjs');

const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const groupId = '22222222-2222-2222-2222-222222222222';
const restaurantId = '44444444-4444-4444-4444-444444444444';
const tokenA = 'offline.e30.signatureA', tokenB = 'offline.e30.signatureB';
const address = '100 Offline Test Street, San Francisco, CA 94103, USA';
const receipt = 'offline.' + 'a'.repeat(43);
const forms = ['personal-place-form', 'add-visit'];
let passed = 0;

function clock() {
    let time = 0, nextId = 0;
    const timers = new Map();
    return {
        setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { at: time + delay, fn }); return id; },
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
function suggestion(overrides = {}) {
    return { id: 'offline-result', source: 'geoapify', address, latitude: 37.7749, longitude: -122.4194,
        accuracy: 'building', countryCode: 'us', selectionReceipt: receipt,
        expiresAt: new Date(Date.now() + 600000).toISOString(), ...overrides };
}
function result(rt, items = [suggestion()]) { return response({ suggestions: items, attribution: rt.load('@/lib/address-search').GEOAPIFY_ATTRIBUTION }); }
function backend(call) {
    if (call.url.pathname === '/rest/v1/groups') return response([{ id: groupId, name: 'Dinner', owner_user_id: userA }]);
    if (call.url.pathname === '/rest/v1/restaurants') return response({ id: restaurantId, name: 'Existing Cafe', address: 'Existing Address', cuisine: null });
    if (call.url.pathname === '/rest/v1/rpc/save_restaurant_visit') return response(restaurantId);
    if (call.url.pathname === '/rest/v1/personal_places' && call.method === 'POST') return response(fixture({ ...call.body, owner_user_id: userA }), 201);
    assert.fail('Unexpected backend path: ' + call.url.pathname);
}
function setup(name, options = {}) {
    const time = clock(), calls = []; let addressProps;
    const rt = runtime({ development: true, platform: 'ios', setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
        fetch: options.backend ?? backend, ...options,
        observeComponent(type, props) { if (type.name === 'AddressAutocomplete') addressProps = props; },
        autocompleteFetch(input, init) {
            const url = new URL(input), headers = new Headers(init.headers), body = JSON.parse(init.body);
            // Any unexpected HTTP destination fails; never use native/global Fetch.
            assert.equal(url.href, 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/geoapify-suggest');
            assert.equal(url.search, ''); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
            assert.equal(headers.get('apikey'), 'sb_publishable_offline_test');
            assert.equal(headers.get('Content-Type'), 'application/json');
            assert.deepEqual(Object.keys(body).sort(), ['action', 'query']); assert.equal(body.action, 'suggest');
            calls.push({ headers, body, signal: init.signal });
            return options.reply ? options.reply(calls.length, rt) : Promise.resolve(result(rt));
        },
    });
    rt.world.auth.session = { user: { id: userA }, access_token: tokenA };
    rt.world.params = { groupId };
    if (options.enabled) rt.load('@/lib/address-search').GEOAPIFY_AUTOCOMPLETE_ENABLED = true; // Isolated VM future-build simulation only.
    const r = screen(rt, name);
    return { rt, r, time, calls, get props() { return addressProps; } };
}
function input(r) { return nodes(r.output).find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Restaurant address'); }
function suggestions(r) { return nodes(r.output).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Use address:')); }
async function query(f, value = 'Offline') { await enter(f.r, 'Restaurant address', value); await f.time.advance(400, f.r); }
async function choose(f) { const row = suggestions(f.r)[0]; assert(row); row.props.onPress(); await f.r.settle(); }
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }

(async () => {
    await test('Disabled native gate preserves development mocks in both forms without constructing a live adapter', async () => {
        for (const name of forms) for (const platform of ['ios', 'android']) {
            const f = setup(name, { platform }); await f.r.settle();
            assert.equal(f.rt.load('@/lib/address-search').GEOAPIFY_AUTOCOMPLETE_ENABLED, false);
            assert.equal(f.props.mode, 'mock'); assert.equal(f.props.search, undefined);
            await query(f, 'Demo');
            assert(textOf(f.r.output).includes('fictional mock')); assert.equal(f.calls.length, 0);
            assert.equal(nodes(f.r.output).filter(n => n.props?.accessibilityLabel?.startsWith('Use mock address:')).length, 5);
            f.r.unmount();
        }
    });
    await test('Disabled native release gate preserves manual entry and original saves in both forms', async () => {
        for (const name of forms) {
            const f = setup(name, { development: false }); await f.r.settle();
            await enter(f.r, 'Restaurant name', 'Manual Cafe'); await query(f, 'Manual Address');
            assert(!textOf(f.r.output).includes('mock')); assert.equal(f.props.selection, null); assert.equal(f.calls.length, 0);
            await click(f.r, name === 'add-visit' ? 'Save Visit' : 'Save Personal Place');
            const save = f.rt.world.requests.find(c => c.method === 'POST'); assert(save);
            assert.equal(save.body.address ?? save.body.restaurant_address, 'Manual Address');
            assert.equal(f.rt.world.localWrites, 0); f.r.unmount();
        }
    });
    await test('Even a future enabled build keeps the web form off the native live adapter', async () => {
        for (const name of forms) for (const development of [true, false]) {
            const f = setup(name, { enabled: true, platform: 'web', development }); await f.r.settle(); await query(f, 'Demo');
            assert.equal(f.props.mode, 'mock'); assert.equal(f.props.search, undefined); assert.equal(f.calls.length, 0);
            assert.equal(textOf(f.r.output).includes('fictional mock'), development); f.r.unmount();
        }
    });
    for (const name of forms) {
        await test(`${name}: native wiring retains 400ms debounce across unrelated rerenders and carries attribution/opaque metadata`, async () => {
            const f = setup(name, { enabled: true, platform: name === 'add-visit' ? 'android' : 'ios' }); await f.r.settle();
            assert.equal(f.props.mode, 'geoapify'); const originalSearch = f.props.search; assert.equal(typeof originalSearch, 'function');
            await enter(f.r, 'Restaurant address', 'Of'); await f.time.advance(500, f.r); assert.equal(f.calls.length, 0);
            await enter(f.r, 'Restaurant address', 'Offline'); await f.time.advance(399, f.r);
            await enter(f.r, 'Restaurant name', 'Wired Cafe'); assert.equal(f.props.search, originalSearch);
            await f.time.advance(1, f.r); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].headers.get('Authorization'), `Bearer ${tokenA}`);
            assert.equal(f.calls[0].body.query, 'Offline'); assert.equal(suggestions(f.r).length, 1);
            const links = nodes(f.r.output).filter(n => n.props?.accessibilityRole === 'link'); assert.equal(links.length, 2);
            for (const link of links) await link.props.onPress();
            assert.deepEqual(f.rt.world.links, ['https://www.geoapify.com/', 'https://www.openstreetmap.org/copyright']);
            await choose(f); assert.equal(input(f.r).props.value, address);
            assert.equal(f.props.selection.selectionReceipt, receipt); assert.equal(f.props.selection.latitude, 37.7749);
            assert.equal(f.props.selection.longitude, -122.4194); assert(!textOf(f.r.output).includes(receipt));
            await f.time.advance(2000, f.r); assert.equal(f.calls.length, 1);
            await enter(f.r, 'Restaurant address', address); assert.equal(f.props.selection, null);
            f.r.unmount(); assert.equal(f.time.size, 0);
        });
        await test(`${name}: token refresh discards an in-flight result and the next explicit edit uses the current session`, async () => {
            const task = deferred(), f = setup(name, { enabled: true, reply: n => n === 1 ? task.promise : Promise.resolve(result(f.rt)) });
            await f.r.settle(); await query(f); const search = f.props.search;
            f.rt.world.auth.session = { user: { id: userA }, access_token: tokenB }; f.r.dirty = true; await f.r.settle();
            assert.equal(f.props.search, search); task.resolve(result(f.rt)); await f.r.settle();
            assert.equal(suggestions(f.r).length, 0); assert(textOf(f.r.output).includes('Sign in again'));
            assert.equal(f.calls.length, 1); await query(f, 'New query');
            assert.equal(f.calls.length, 2); assert.equal(f.calls[1].headers.get('Authorization'), `Bearer ${tokenB}`);
            assert.equal(suggestions(f.r).length, 1); f.r.unmount();
        });
        await test(`${name}: account switch, sign-out and unmount abort searches and disable retained old callbacks`, async () => {
            for (const change of ['account', 'signout', 'unmount', 'loading']) {
                const task = deferred(), f = setup(name, { enabled: true, reply: () => task.promise });
                await f.r.settle(); await query(f); const oldSearch = f.props.search;
                if (change === 'unmount') f.r.unmount();
                else {
                    if (change === 'loading') f.rt.world.auth.loading = true;
                    else f.rt.world.auth.session = change === 'signout' ? null : { user: { id: userB }, access_token: tokenB };
                    f.r.dirty = true; await f.r.settle();
                }
                assert(f.calls[0].signal.aborted);
                await assert.rejects(oldSearch('New query', new AbortController().signal), e => e.kind === 'authentication');
                assert.equal(f.calls.length, 1); task.resolve(result(f.rt));
                if (change !== 'unmount') { await f.r.settle(); assert.equal(suggestions(f.r).length, 0); }
                assert.equal(f.rt.world.lateUpdates, 0); f.r.unmount();
            }
        });
        await test(`${name}: current Auth-provider errors fail closed before HTTP and leave manual entry editable`, async () => {
            const f = setup(name, { enabled: true }); await f.r.settle();
            f.rt.world.auth.error = 'Safe fixture auth error'; f.r.dirty = true; await f.r.settle(); await query(f);
            assert.equal(f.calls.length, 0); assert(textOf(f.r.output).includes('Sign in again')); assert.equal(input(f.r).props.editable, true);
            f.r.unmount();
        });
        await test(`${name}: editing cancels old requests and ignores late stale results`, async () => {
            const task = deferred(), f = setup(name, { enabled: true, reply: n => n === 1 ? task.promise : Promise.resolve(result(f.rt, [suggestion({ address: 'Latest address' })])) });
            await f.r.settle(); await query(f, 'Old query'); await query(f, 'Latest query'); assert(f.calls[0].signal.aborted);
            task.resolve(result(f.rt, [suggestion({ address: 'Old address' })])); await f.r.settle();
            assert(textOf(f.r.output).includes('Latest address')); assert(!textOf(f.r.output).includes('Old address'));
            assert.equal(f.calls.length, 2); f.r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
        });
        await test(`${name}: background cancels the real adapter and returning does not repeat the request`, async () => {
            const task = deferred(), f = setup(name, { enabled: true, reply: () => task.promise });
            await f.r.settle(); await query(f); await enter(f.r, 'Restaurant name', 'Preserved name');
            f.rt.emit('background'); await f.r.settle(); assert(f.calls[0].signal.aborted);
            task.resolve(result(f.rt)); await f.r.settle(); f.rt.emit('active'); await f.r.settle();
            assert.equal(input(f.r).props.value, 'Offline'); assert.equal(f.props.selection, null); assert.equal(suggestions(f.r).length, 0);
            await f.time.advance(2000, f.r); assert.equal(f.calls.length, 1); assert.equal(f.rt.world.lateUpdates, 0); f.r.unmount();
        });
        await test(`${name}: Retry-After survives rerenders and background/focus cycles with no scheduled retry`, async () => {
            const f = setup(name, { enabled: true, reply: () => Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '60' } })) });
            await f.r.settle(); await query(f); assert.equal(f.calls.length, 1); assert(textOf(f.r.output).includes('Suggestions paused'));
            const stable = f.props.search; await enter(f.r, 'Restaurant name', 'Same form');
            f.rt.world.auth.session = { user: { id: userA }, access_token: tokenB }; f.r.dirty = true; await f.r.settle();
            f.rt.emit('background'); await f.r.settle(); f.rt.emit('active'); await f.r.settle();
            assert.equal(f.props.search, stable); await query(f, 'Other query'); assert.equal(f.calls.length, 1);
            assert(textOf(f.r.output).includes('Suggestions paused')); assert.equal(input(f.r).props.editable, true);
            f.rt.world.focused = false; f.r.dirty = true; await f.r.settle(); f.rt.world.focused = true; f.r.dirty = true; await f.r.settle();
            assert.equal(f.props.search, stable); await f.time.advance(15000, f.r); assert.equal(f.calls.length, 1);
            assert.equal(f.rt.world.localWrites, 0); f.r.unmount();
        });
        await test(`${name}: safe auth/access/service messages never reflect backend error bodies or trigger retries`, async () => {
            for (const [status, message] of [[401, 'Sign in again'], [403, 'not available for this account'], [503, 'unavailable']]) {
                const f = setup(name, { enabled: true, reply: () => Promise.resolve(new Response('UNSAFE_BODY_QUERY_TOKEN_RECEIPT', { status })) });
                await f.r.settle(); await query(f); assert(textOf(f.r.output).includes(message)); assert(!textOf(f.r.output).includes('UNSAFE_BODY'));
                assert.equal(input(f.r).props.editable, true); await f.time.advance(20000, f.r); assert.equal(f.calls.length, 1);
                f.r.unmount();
            }
        });
        await test(`${name}: stalled native Fetch reaches the client deadline, ignores late success and never retries`, async () => {
            const task = deferred(), f = setup(name, { enabled: true, reply: () => task.promise });
            await f.r.settle(); await query(f); await f.time.advance(14999, f.r); assert(!f.calls[0].signal.aborted);
            await f.time.advance(1, f.r); assert(f.calls[0].signal.aborted); assert(textOf(f.r.output).includes('unavailable'));
            task.resolve(result(f.rt)); await f.r.settle(); assert.equal(suggestions(f.r).length, 0);
            await f.time.advance(15000, f.r); assert.equal(f.calls.length, 1); assert.equal(f.time.size, 0); f.r.unmount();
        });
        await test(`${name}: real selections retain their receipt only in disposable UI and preserve exact save payloads`, async () => {
            const saveTask = deferred(), f = setup(name, { enabled: true, backend: call => call.method === 'POST' ? saveTask.promise : backend(call) });
            await f.r.settle(); await enter(f.r, 'Restaurant name', 'Real Selected Cafe'); await query(f); await choose(f);
            const saveButton = nodes(f.r.output).find(n => n.type === 'Pressable' && textOf(n.props.children) === (name === 'add-visit' ? 'Save Visit' : 'Save Personal Place'));
            const pending = saveButton.props.onPress(); await f.r.settle();
            assert.equal(input(f.r).props.editable, false); assert(textOf(f.r.output).includes('Powered by Geoapify'));
            const posts = f.rt.world.requests.filter(c => c.method === 'POST'); assert.equal(posts.length, 1);
            const save = posts[0];
            const keys = name === 'add-visit'
                ? ['client_request_id', 'restaurant_address', 'restaurant_cuisine', 'restaurant_name', 'target_group_ids', 'visit_date', 'visit_notes', 'visit_rating', 'visit_would_go_again']
                : ['address', 'client_request_id', 'cuisine', 'name', 'notes', 'rating', 'visited_on', 'would_go_again'];
            assert.deepEqual(Object.keys(save.body).sort(), keys.sort()); assert.equal(save.body.address ?? save.body.restaurant_address, address);
            assert(!JSON.stringify(save.body).includes(receipt)); assert.equal(f.rt.world.localWrites, 0);
            assert.equal(f.calls.length, 1); assert(!f.rt.world.requests.some(c => /attach|location|quota/.test(c.url.pathname)));
            saveTask.resolve(backend(save)); await pending; await f.r.settle();
            f.rt.emit('background'); await f.r.settle(); f.rt.emit('active'); await f.r.settle(); assert.equal(f.props.selection, null);
            f.r.unmount();
        });
    }
    await test('Personal edit loads silently, uses the native adapter only on edits and preserves revision-based saving', async () => {
        const place = fixture({ owner_user_id: userA });
        const f = setup('personal-place-form', { enabled: true, backend: call => {
            assert.equal(call.url.pathname, '/rest/v1/personal_places');
            if (call.method === 'GET') return response(place);
            assert.equal(call.method, 'PATCH'); return response({ ...place, ...call.body, revision: 2 });
        } });
        f.rt.world.params = { id: place.id }; await f.r.settle(); await f.time.advance(2000, f.r);
        assert.equal(input(f.r).props.value, place.address); assert.equal(f.calls.length, 0);
        assert.equal(f.props.mode, 'geoapify'); await query(f); await choose(f); await click(f.r, 'Save Changes');
        const save = f.rt.world.requests.find(c => c.method === 'PATCH'); assert(save);
        assert.equal(save.url.searchParams.get('owner_user_id'), 'eq.' + userA);
        assert.equal(save.url.searchParams.get('revision'), 'eq.1'); assert.equal(save.body.address, address);
        assert.equal(save.body.notes, place.notes);
        assert.deepEqual(Object.keys(save.body).sort(), ['address', 'cuisine', 'name', 'notes', 'rating', 'visited_on', 'would_go_again']);
        assert.equal(f.calls.length, 1); assert.equal(f.rt.world.localWrites, 0); f.r.unmount();
    });
    await test('Existing shared Restaurant addresses remain locked with no live autocomplete request even in a future enabled build', async () => {
        const f = setup('add-visit', { enabled: true }); f.rt.world.params.restaurantId = restaurantId;
        await f.r.settle(); await f.time.advance(2000, f.r);
        assert.equal(input(f.r).props.value, 'Existing Address'); assert.equal(input(f.r).props.editable, false);
        assert.equal(f.props, undefined); assert.equal(f.calls.length, 0); f.r.unmount();
    });
    console.log(`${passed} offline Geoapify native form wiring checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
