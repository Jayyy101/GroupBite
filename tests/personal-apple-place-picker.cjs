// Actual personal form, Apple adapter and map props. Offline native/HTTP boundaries.
const assert = require('node:assert/strict');
const { runtime, fixture, response, screen, click, enter, fill, button, nodes, textOf } = require('./personal-places.cjs');
let passed = 0;
function defer() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function clock() {
    let now = 0, sequence = 0; const timers = new Map();
    return { setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        async advance(ms, r) { const end = now + ms;
            while (true) {
                const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
                if (!next || next[1].at > end) break;
                now = next[1].at; timers.delete(next[0]); next[1].fn(); await r.settle();
            }
            now = end; await r.settle();
        } };
}
function location(id, overrides = {}) {
    return { id, placeId: 'Opaque Apple ID', name: 'Apple-only name', address: 'Apple-only address', latitude: 37.33, longitude: -121.88,
        kind: 'business', source: 'apple-maps-preview', ...overrides };
}
function setup(options = {}) {
    const time = clock(), calls = [], cancel = [], reset = [];
    const native = { isAvailable: () => true,
        complete(query, mode, id) { calls.push({ action: 'complete', query, mode }); return options.complete ? options.complete(id) : Promise.resolve([{ id: id + ':0', title: 'Apple suggestion', subtitle: 'Apple subtitle' }]); },
        search(query, mode, id) { calls.push({ action: 'search', query, mode }); return options.search ? options.search(id) : Promise.resolve([location(id + ':0', { kind: mode })]); },
        resolve(suggestionId, id) { calls.push({ action: 'resolve', suggestionId }); return options.resolve ? options.resolve(id) : Promise.resolve([location(id + ':0')]); },
        async cancel(id) { cancel.push(id); }, async reset() { reset.push(true); } };
    // No ID lookup capability methods: exercise compatibility with older binaries.
    const rt = runtime({ development: true, platform: 'ios', setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
        ...options, mocks: { expo: { requireOptionalNativeModule: () => options.missing ? null : native },
            'react-native-maps': { default: 'MapView', Marker: 'Marker', PROVIDER_DEFAULT: 'default' } } });
    const api = rt.load('@/lib/personal-places'), create = api.createPersonalPlace, saves = [];
    api.createPersonalPlace = (...args) => { saves.push(args); return create(...args); };
    if (options.edit) { rt.world.params = { id: fixture().id }; rt.world.rows = [fixture({ apple_place_id: 'existing-id' })]; }
    return { rt, time, calls, cancel, reset, saves, render: () => screen(rt, 'personal-place-form') };
}
const suggestions = r => nodes(r.output).filter(n => n.props?.accessibilityLabel?.startsWith('Select Apple suggestion:'));
const candidates = r => nodes(r.output).filter(n => n.props?.accessibilityLabel?.startsWith('Preview Apple location:'));
const markers = r => nodes(r.output).filter(n => n.type === 'Marker');
async function open(f, r) { await click(r, 'Choose Apple Maps place (optional)'); }
async function type(f, r) { await enter(r, 'Apple Maps search', 'Public test address, San Jose'); await f.time.advance(400, r); }
async function choose(f, r) { await type(f, r); await suggestions(r)[0].props.onPress(); await r.settle(); candidates(r)[0].props.onPress(); await r.settle(); }
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }

(async () => {
    await test('Development saving includes only an explicitly selected ID with independent user fields', async () => {
        const f = setup(), r = f.render(); await r.settle(); await fill(r);
        assert.equal(f.calls.length, 0); await open(f, r); assert.equal(f.calls.length, 0);
        await enter(r, 'Apple Maps search', 'Public address'); await f.time.advance(399, r); assert.equal(f.calls.length, 0);
        await f.time.advance(1, r); await suggestions(r)[0].props.onPress(); await r.settle();
        assert.equal(markers(r).length, 1); assert(!textOf(r.output).includes('Apple Place ID selected'));
        candidates(r)[0].props.onPress(); await r.settle();
        assert.equal(markers(r).length, 1); assert.equal(markers(r)[0].props.title, 'Apple: Apple-only name');
        assert.equal(markers(r)[0].props.description, 'Apple-only address');
        const map = nodes(r.output).find(n => n.type === 'MapView');
        assert.equal(map.props.provider, 'default'); assert.equal(map.props.showsUserLocation, false); assert.equal(map.props.showsMyLocationButton, false);
        await click(r, 'Save Personal Place'); assert.equal(f.saves.length, 1); assert.equal(f.saves[0][3], 'Opaque Apple ID');
        const body = f.rt.world.requests[0].body;
        assert.deepEqual(Object.keys(body).sort(), ['address', 'apple_place_id', 'client_request_id', 'cuisine', 'name', 'notes', 'rating', 'visited_on', 'would_go_again']);
        assert.equal(body.apple_place_id, 'Opaque Apple ID'); assert.equal(f.rt.world.rows[0].apple_place_id, 'Opaque Apple ID');
        assert.equal(body.name, 'New Cafe'); assert.equal(body.address, 'New Address');
        assert.equal(f.rt.world.localWrites, 0); assert.equal(f.rt.world.navigation.at(-1).pathname, '/personal-place/[id]'); r.unmount();
    });
    await test('Autocomplete and resolved candidate maps do not add an ID without an explicit candidate tap', async () => {
        for (const resolved of [false, true]) {
            const f = setup(), r = f.render(); await r.settle(); await fill(r); await open(f, r); await type(f, r);
            if (resolved) { await suggestions(r)[0].props.onPress(); await r.settle(); assert.equal(markers(r).length, 1); }
            await click(r, 'Save Personal Place'); assert.equal(f.saves[0][3], undefined);
            assert(!('apple_place_id' in f.rt.world.requests[0].body)); r.unmount();
        }
    });
    await test('Explicit selections without IDs save normally; malformed native IDs fail closed', async () => {
        for (const id of [undefined, null, ' padded', 'private\u0085id', 'x'.repeat(301)]) {
            const f = setup({ resolve: requestId => Promise.resolve([location(requestId + ':0', { placeId: id })]) }), r = f.render();
            await r.settle(); await fill(r); await open(f, r); await type(f, r); await suggestions(r)[0].props.onPress(); await r.settle();
            if (id == null) { candidates(r)[0].props.onPress(); await r.settle(); assert(textOf(r.output).includes('No Apple Place ID')); }
            else { assert.equal(candidates(r).length, 0); assert.equal(markers(r).length, 0); assert(!textOf(r.output).includes('private')); }
            await click(r, 'Save Personal Place'); assert.equal(f.saves[0][3], undefined);
            assert(!('apple_place_id' in f.rt.world.requests[0].body)); assert.equal(f.rt.world.requests[0].body.address, 'New Address'); r.unmount();
        }
    });
    await test('Selected-ID saves preserve receipt reconciliation and uncertain-save locks without replay', async () => {
        for (const committed of [false, true]) {
            const f = setup(), r = f.render(); await r.settle(); await fill(r); await open(f, r); await choose(f, r);
            f.rt.world.override = call => {
                if (call.method !== 'POST') return null;
                if (committed) f.rt.world.rows.push(fixture({ ...call.body, owner_user_id: call.user }));
                return response({ code: '', message: 'Lost response' }, 400);
            };
            const save = button(r, 'Save Personal Place').props.onPress; await save(); await r.settle();
            const post = f.rt.world.requests.find(call => call.method === 'POST'); assert.equal(post.body.apple_place_id, 'Opaque Apple ID');
            assert.equal(f.saves[0][3], 'Opaque Apple ID'); assert.equal(post.user, 'a');
            assert(f.rt.world.requests.filter(call => call.method === 'GET').every(call => call.url.searchParams.get('client_request_id') === 'eq.' + post.body.client_request_id));
            if (committed) { assert.equal(f.rt.world.rows[0].apple_place_id, 'Opaque Apple ID'); assert.equal(f.rt.world.navigation.at(-1).params.id, fixture().id); }
            else { assert(button(r, 'Save Personal Place').props.disabled); await save(); await click(r, 'Check Saved Result'); assert.equal(f.rt.world.navigation.length, 0); }
            assert.equal(f.rt.world.requests.filter(call => call.method === 'POST').length, 1); assert.equal(f.rt.world.localWrites, 0); r.unmount();
        }
    });
    await test('Address mode searches outside Fremont and ambiguous results require explicit map selection', async () => {
        const f = setup({ search: id => Promise.resolve([location(id + ':0'), location(id + ':1', { name: 'Second result', placeId: undefined })]) }), r = f.render();
        await r.settle(); await fill(r); await open(f, r); await click(r, 'Addresses'); await type(f, r);
        await click(r, 'Search Apple places'); await f.time.advance(400, r);
        assert.equal(f.calls.at(-1).mode, 'address'); assert.equal(f.calls.at(-1).query, 'Public test address, San Jose');
        assert.equal(candidates(r).length, 2); assert.equal(markers(r).length, 2);
        assert.deepEqual(markers(r).map(marker => marker.props.title), ['Apple: Apple-only name', 'Apple: Second result']);
        candidates(r)[1].props.onPress(); await r.settle(); assert.equal(markers(r).length, 2);
        assert(textOf(r.output).includes('No Apple Place ID')); await click(r, 'Save Personal Place');
        assert.equal(f.saves[0][3], undefined); assert(!('apple_place_id' in f.rt.world.requests[0].body)); r.unmount();
    });
    await test('Candidate maps do not select IDs; only explicit candidate taps emit a validated optional ID', async () => {
        const f = setup(), selections = [], Picker = f.rt.load('@/components/personal-apple-place-picker').default;
        const { jsx } = f.rt.load('react/jsx-runtime');
        const r = f.rt.render(() => jsx(Picker, { disabled: false, onSelect: id => selections.push(id) }));
        await r.settle(); await open(f, r); await type(f, r);
        assert.equal(markers(r).length, 0); // Autocomplete remains text-only.
        await suggestions(r)[0].props.onPress(); await r.settle();
        assert.equal(markers(r).length, 1); assert(selections.every(id => id === null));
        assert.equal(f.rt.world.requests.length, 0);
        candidates(r)[0].props.onPress(); await r.settle(); assert.equal(selections.at(-1), 'Opaque Apple ID');
        assert.equal(f.rt.world.requests.length, 0); r.unmount();
    });
    await test('Entered-address changes clear the map/selection and invalidate stale candidate callbacks', async () => {
        const f = setup(), r = f.render(); await r.settle(); await fill(r); await open(f, r); await choose(f, r);
        const stale = candidates(r)[0]; await enter(r, 'Restaurant address', 'Changed user address');
        assert.equal(markers(r).length, 0); stale.props.onPress(); await r.settle(); assert.equal(markers(r).length, 0);
        assert(!textOf(r.output).includes('Apple Place ID selected')); await click(r, 'Save Personal Place');
        assert.equal(f.saves[0][3], undefined); assert.equal(f.rt.world.requests[0].body.address, 'Changed user address'); r.unmount();
    });
    await test('Query edits cancel resolution and stale suggestion double taps cannot restore results', async () => {
        const held = defer(), f = setup({ resolve: () => held.promise }), r = f.render(); await r.settle(); await open(f, r); await type(f, r);
        const stale = suggestions(r)[0], pending = stale.props.onPress(); stale.props.onPress(); await r.settle();
        assert.equal(f.calls.filter(c => c.action === 'resolve').length, 1);
        await enter(r, 'Apple Maps search', 'Another address'); held.resolve([location('2:0')]); await pending; await r.settle();
        await stale.props.onPress(); assert.equal(candidates(r).length, 0); assert.equal(markers(r).length, 0); assert.equal(f.cancel.length, 1); r.unmount();
    });
    await test('Blur, background, account change and sign-out dispose private search work and selections', async () => {
        for (const action of ['blur', 'background', 'account', 'sign-out']) {
            const held = defer(), f = setup({ complete: () => held.promise }), r = f.render(); await r.settle(); await fill(r); await open(f, r); await type(f, r);
            if (action === 'blur') { f.rt.world.focused = false; r.dirty = true; }
            else if (action === 'background') f.rt.emit('background');
            else f.rt.switch(action === 'account' ? 'b' : null, r);
            await r.settle(); held.resolve([{ id: '1:0', title: 'Private late result', subtitle: '' }]); await r.settle();
            assert(!textOf(r.output).includes('Private late result')); assert.equal(f.cancel.length, 1); assert.equal(f.rt.world.lateUpdates, 0);
            if (action === 'blur') { f.rt.world.focused = true; r.dirty = true; }
            else if (action === 'background') f.rt.emit('active');
            else f.rt.switch('a', r);
            await r.settle(); assert(!textOf(r.output).includes('Apple Place ID selected')); assert.equal(markers(r).length, 0);
            assert.equal(f.rt.world.requests.length, 0); r.unmount();
        }
    });
    await test('Timeouts, empty and malformed results are safe and never retry or write automatically', async () => {
        for (const outcome of ['timeout', 'empty', 'malformed', 'failure']) {
            const held = defer(), f = setup({ complete: () => outcome === 'timeout' ? held.promise : outcome === 'failure'
                ? Promise.reject(new Error('private raw error')) : Promise.resolve(outcome === 'empty' ? [] : [{}]) }), r = f.render();
            await r.settle(); await open(f, r); await type(f, r);
            await f.time.advance(10000, r); assert.equal(f.calls.length, 1); assert.equal(markers(r).length, 0);
            assert(!textOf(r.output).includes('private raw')); assert(textOf(r.output).includes(outcome === 'timeout' ? 'timed out' : outcome === 'empty' ? 'No matching Apple results' : 'unavailable'));
            if (outcome === 'timeout') { held.resolve([{ id: '1:0', title: 'late', subtitle: '' }]); await r.settle(); assert.equal(suggestions(r).length, 0); }
            await fill(r); await click(r, 'Save Personal Place'); assert.equal(f.saves[0][3], undefined); r.unmount();
        }
    });
    await test('Selected IDs/maps are discarded across account changes and batched inactive/active events', async () => {
        for (const changeAccount of [false, true]) {
            const f = setup(), r = f.render(); await r.settle(); await open(f, r); await choose(f, r);
            assert(textOf(r.output).includes('Apple Place ID selected')); assert.equal(markers(r).length, 1);
            if (changeAccount) f.rt.switch('b', r);
            else { f.rt.emit('inactive'); f.rt.emit('active'); }
            await r.settle(); assert.equal(markers(r).length, 0); assert(!textOf(r.output).includes('Apple Place ID selected'));
            await fill(r); await click(r, 'Save Personal Place'); assert.equal(f.saves[0][3], undefined); r.unmount();
        }
        const held = defer(), f = setup({ complete: () => held.promise }), r = f.render();
        await r.settle(); await open(f, r); await type(f, r); f.rt.emit('inactive'); f.rt.emit('active');
        held.resolve([{ id: '1:0', title: 'Private batched result', subtitle: '' }]); await r.settle();
        assert.equal(f.cancel.length, 1); assert.equal(suggestions(r).length, 0); assert.equal(f.rt.world.lateUpdates, 0); r.unmount();
    });
    await test('Unavailable modules/platforms allow normal saving; release and edit modes have no picker', async () => {
        for (const options of [{ missing: true }, { platform: 'android' }, { development: false }, { edit: true }]) {
            const f = setup(options), r = f.render(); await r.settle();
            if (options.edit || options.development === false) assert(!textOf(r.output).includes('Choose Apple Maps place'));
            else { await open(f, r); assert(textOf(r.output).includes('You can save normally')); }
            if (options.edit) { await enter(r, 'Personal notes', 'Edited user note'); await click(r, 'Save Changes'); assert(!('apple_place_id' in f.rt.world.requests.find(c => c.method === 'PATCH').body)); }
            else { await fill(r); await click(r, 'Save Personal Place'); assert.equal(f.saves[0][3], undefined); }
            assert.equal(f.calls.length, 0); r.unmount();
        }
    });
    await test('Release save gate rejects an ID even if unexpected retained selection state exists', async () => {
        const f = setup({ development: false, observeComponent(type, props) {
            if (type.name === 'PersonalPlaceFormBody') props.appleSelection.current = { id: 'must-not-save', address: props.fields.address };
        } }), r = f.render();
        await r.settle(); await fill(r); assert(!textOf(r.output).includes('Choose Apple Maps place'));
        await click(r, 'Save Personal Place'); assert.equal(f.saves[0][3], undefined);
        assert(!('apple_place_id' in f.rt.world.requests[0].body)); assert.equal(f.calls.length, 0); r.unmount();
    });
    await test('Saving cancels pending search and uncertain saves retain the existing read-only recovery flow', async () => {
        const held = defer(), f = setup({ complete: () => held.promise }), r = f.render(); await r.settle(); await fill(r); await open(f, r); await type(f, r);
        f.rt.world.override = call => call.method === 'POST' ? new Response(JSON.stringify({ code: '', message: 'lost response' }), { status: 400 }) : null;
        await click(r, 'Save Personal Place'); assert.equal(f.cancel.length, 1);
        held.resolve([{ id: '1:0', title: 'late result', subtitle: '' }]); await r.settle(); assert.equal(suggestions(r).length, 0);
        assert(button(r, 'Save Personal Place').props.disabled); await click(r, 'Check Saved Result');
        assert.equal(f.rt.world.requests.filter(c => c.method === 'POST').length, 1); assert.equal(f.saves[0][3], undefined);
        assert(f.rt.world.requests.filter(c => c.method === 'GET').every(c => c.user === 'a')); r.unmount();
    });
    console.log(`${passed} offline personal Apple picker checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
