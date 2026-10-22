// Authorized detail screen + actual lookup adapter/map. All HTTP/native data is synthetic.
const assert = require('node:assert/strict');
const { runtime, fixture, screen, click, button, nodes, textOf } = require('./personal-places.cjs');
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
    return { id, placeId: 'Current Apple alias', name: 'Transient Apple name', address: 'Transient Apple address',
        latitude: 37.33, longitude: -121.88, kind: 'address', source: 'apple-maps-preview', ...overrides };
}
function setup(options = {}) {
    const time = clock(), calls = [], cancel = [];
    const native = { isAvailable: () => true, supportsPlaceIdLookup: () => options.supported !== false,
        complete() { assert.fail('No autocomplete'); }, search() { assert.fail('No address/business search'); }, resolve() { assert.fail('No suggestion resolution'); },
        lookupPlace(placeId, mode, requestId) { calls.push({ placeId, mode, requestId });
            return options.lookup ? options.lookup(requestId) : Promise.resolve([location(requestId + ':0')]); },
        async cancel(id) { cancel.push(id); }, async reset() {} };
    if (options.oldBinary) { delete native.supportsPlaceIdLookup; delete native.lookupPlace; }
    const rt = runtime({ development: true, platform: 'ios', setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, ...options,
        mocks: { expo: { requireOptionalNativeModule: () => options.missing ? null : native },
            'react-native-maps': { default: 'MapView', Marker: 'Marker', PROVIDER_DEFAULT: 'default' } } });
    rt.world.params = { id: fixture().id };
    rt.world.rows = [fixture({ apple_place_id: 'Stored Apple ID', ...options.row })];
    return { rt, time, calls, cancel, render: () => screen(rt, 'personal-place/[id]') };
}
const markers = r => nodes(r.output).filter(n => n.type === 'Marker');
const lookupButton = r => button(r, 'Look up saved Apple Place ID');
function readOnly(f) {
    assert(f.rt.world.requests.every(call => (call.method === 'GET' && ['/rest/v1/personal_places','/rest/v1/personal_visits'].includes(call.url.pathname))
        || (call.method === 'POST' && ['/rest/v1/rpc/get_saved_locations','/rest/v1/rpc/get_personal_mapkit_locations','/rest/v1/rpc/get_saved_mapkit_location'].includes(call.url.pathname))));
    assert.equal(f.rt.world.localReads, 0); assert.equal(f.rt.world.localWrites, 0);
}
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }

(async () => {
    await test('Authorized details reopen by explicit ID lookup only; Apple data and aliases never change saved facts', async () => {
        const f = setup(), original = JSON.stringify(f.rt.world.rows), r = f.render(); await r.settle();
        assert.equal(f.calls.length, 0); assert.equal(markers(r).length, 0);
        const read = f.rt.world.requests[0]; assert.equal(read.user, 'a');
        assert.equal(read.url.searchParams.get('owner_user_id'), 'eq.a'); assert.equal(read.url.searchParams.get('id'), 'eq.' + fixture().id);
        await click(r, 'Look up saved Apple Place ID');
        assert.equal(f.calls.length, 1); assert.equal(f.calls[0].placeId, 'Stored Apple ID'); assert.equal(f.calls[0].mode, 'address');
        assert.equal(markers(r).length, 1); assert.equal(markers(r)[0].props.title, 'Apple: Transient Apple name');
        assert(textOf(r.output).includes('Private Cafe')); assert(textOf(r.output).includes('Private Address'));
        const map = nodes(r.output).find(n => n.type === 'MapView'); assert.equal(map.props.provider, 'default');
        assert.equal(map.props.showsUserLocation, false); assert.equal(map.props.showsMyLocationButton, false);
        assert.equal(JSON.stringify(f.rt.world.rows), original); readOnly(f);
        await click(r, 'Edit Personal Place');
        assert.deepEqual(JSON.parse(JSON.stringify(f.rt.world.navigation.at(-1))), { pathname: '/personal-place-form', params: { id: fixture().id } }); r.unmount();
    });
    await test('Missing IDs, modules, unsupported iOS/older binaries and release platforms retain saved details', async () => {
        for (const options of [{ row: { apple_place_id: undefined } }, { row: { apple_place_id: null } }, { row: { apple_place_id: '' } },
            { missing: true }, { supported: false }, { oldBinary: true }, { platform: 'android' }, { development: false }]) {
            const f = setup(options), r = f.render(); await r.settle();
            assert(textOf(r.output).includes('Private Cafe')); assert(textOf(r.output).includes('Private Address'));
            assert(!nodes(r.output).some(n => n.type === 'Pressable' && textOf(n.props.children) === 'Look up saved Apple Place ID'));
            assert.equal(f.calls.length, 0); readOnly(f); r.unmount();
        }
    });
    await test('Invalid stored identifiers fail before native lookup without echoing or modifying the ID', async () => {
        for (const id of [' padded', 'private\u0085id', 'x'.repeat(301), 123]) {
            const f = setup({ row: { apple_place_id: id } }), r = f.render(); await r.settle(); await click(r, 'Look up saved Apple Place ID');
            assert.equal(f.calls.length, 0); assert(textOf(r.output).includes('valid Apple Place ID'));
            assert(!textOf(r.output).includes('private')); assert.equal(f.rt.world.rows[0].apple_place_id, id); readOnly(f); r.unmount();
        }
    });
    await test('Empty, offline, malformed and timed-out lookups require an explicit retry and never write', async () => {
        for (const outcome of ['empty', 'offline', 'malformed', 'timeout']) {
            const held = defer(), f = setup({ lookup: requestId => outcome === 'timeout' ? held.promise : outcome === 'offline'
                ? Promise.reject(new Error('private raw provider details')) : Promise.resolve(outcome === 'empty' ? [] : [location(requestId + ':0', { latitude: 91 })]) }), r = f.render();
            await r.settle(); const pending = lookupButton(r).props.onPress(); await r.settle();
            if (outcome === 'timeout') await f.time.advance(10000, r);
            await pending; await r.settle(); assert.equal(markers(r).length, 0); assert.equal(f.calls.length, 1);
            assert(textOf(r.output).includes(outcome === 'empty' ? 'No current Apple map result' : outcome === 'timeout' ? 'timed out' : 'unavailable'));
            assert(!textOf(r.output).includes('private raw')); assert(!lookupButton(r).props.disabled);
            await f.time.advance(10000, r); assert.equal(f.calls.length, 1);
            if (outcome === 'timeout') { held.resolve([location('1:0')]); await r.settle(); assert.equal(markers(r).length, 0); }
            readOnly(f); assert.equal(f.rt.world.rows[0].apple_place_id, 'Stored Apple ID'); r.unmount();
        }
        let attempts = 0;
        const f = setup({ lookup: requestId => ++attempts === 1 ? Promise.resolve([]) : Promise.resolve([location(requestId + ':0')]) }), r = f.render();
        await r.settle(); await click(r, 'Look up saved Apple Place ID'); await click(r, 'Look up saved Apple Place ID');
        assert.equal(f.calls.length, 2); assert.equal(markers(r).length, 1); readOnly(f); r.unmount();
    });
    await test('Double taps issue one lookup; blur/background/account/record changes cancel and discard stale responses', async () => {
        for (const action of ['blur', 'background', 'account', 'sign-out', 'record', 'refresh', 'unmount']) {
            const held = defer(), f = setup({ lookup: () => held.promise }), r = f.render(); await r.settle();
            const stale = lookupButton(r).props.onPress, pending = stale(); await stale(); await r.settle(); assert.equal(f.calls.length, 1);
            if (action === 'blur') { f.rt.world.focused = false; r.dirty = true; }
            else if (action === 'background') f.rt.emit('background');
            else if (action === 'account' || action === 'sign-out') f.rt.switch(action === 'account' ? 'b' : null, r);
            else if (action === 'record') {
                f.rt.world.params = { id: '22222222-2222-2222-2222-222222222222' };
                f.rt.world.rows.push(fixture({ id: f.rt.world.params.id, name: 'Another record', apple_place_id: 'Another ID' })); r.dirty = true;
            } else if (action === 'refresh') await click(r, 'Refresh Place');
            else r.unmount();
            if (action !== 'unmount') await r.settle();
            held.resolve([location('1:0')]); await pending; if (action !== 'unmount') await r.settle();
            assert.equal(f.cancel.length, 1, action); assert.equal(f.rt.world.lateUpdates, 0, action);
            if (action !== 'unmount') { assert.equal(markers(r).length, 0); assert(!textOf(r.output).includes('Transient Apple name')); }
            await stale(); assert.equal(f.calls.length, 1); readOnly(f); r.unmount();
        }
    });
    await test('Blur clears a still-mounted lookup component; refocus never retries completed or pending lookups', async () => {
        for (const pendingLookup of [false, true]) {
            const held = defer(), f = setup({ lookup: id => pendingLookup ? held.promise : Promise.resolve([location(id + ':0')]) });
            const Lookup = f.rt.load('@/components/personal-apple-place-lookup').default, { jsx } = f.rt.load('react/jsx-runtime');
            const r = f.rt.render(() => jsx(Lookup, { applePlaceId: 'Stored Apple ID', disabled: false }));
            await r.settle(); const stale = lookupButton(r).props.onPress, task = stale(); await r.settle();
            assert.equal(f.calls.length, 1); if (!pendingLookup) assert.equal(markers(r).length, 1);
            f.rt.world.focused = false; r.dirty = true; await r.settle();
            assert(r.output, 'Component must remain mounted during this blur test');
            assert(lookupButton(r).props.disabled); assert.equal(markers(r).length, 0);
            assert(!textOf(r.output).includes('Transient Apple name'));
            if (pendingLookup) { assert.equal(f.cancel.length, 1); held.resolve([location('1:0')]); }
            await task; await r.settle(); assert.equal(markers(r).length, 0); await stale(); assert.equal(f.calls.length, 1);
            // AppState becoming active must not reactivate a blurred component.
            f.rt.emit('inactive'); f.rt.emit('active'); await r.settle(); await stale(); assert.equal(f.calls.length, 1);
            f.rt.world.focused = true; r.dirty = true; await r.settle(); await f.time.advance(10000, r);
            assert.equal(f.calls.length, 1); assert.equal(markers(r).length, 0); assert(!lookupButton(r).props.disabled);
            await click(r, 'Look up saved Apple Place ID'); assert.equal(f.calls.length, 2); assert.equal(markers(r).length, 1);
            readOnly(f); assert.equal(f.rt.world.lateUpdates, 0); r.unmount();
        }
    });
    await test('Batched inactive/active transitions clear completed results and cancel pending lookup without retry', async () => {
        const f = setup(), r = f.render(); await r.settle(); await click(r, 'Look up saved Apple Place ID');
        assert.equal(markers(r).length, 1); f.rt.emit('inactive'); f.rt.emit('active'); await r.settle(); assert.equal(markers(r).length, 0);
        assert.equal(f.calls.length, 1); r.unmount();
        const held = defer(), next = setup({ lookup: () => held.promise }), other = next.render(); await other.settle();
        const pending = lookupButton(other).props.onPress(); await other.settle(); next.rt.emit('inactive'); next.rt.emit('active');
        held.resolve([location('1:0')]); await pending; await other.settle();
        assert.equal(next.cancel.length, 1); assert.equal(markers(other).length, 0); assert(!lookupButton(other).props.disabled);
        assert.equal(next.calls.length, 1); readOnly(next); other.unmount();
    });
    await test('Foreign/missing/malformed records and delayed old-account reads never expose a lookup control', async () => {
        for (const options of [{ row: { owner_user_id: 'b' } }, {}]) {
            const f = setup(options); if (!options.row) f.rt.world.params = { id: 'invalid' };
            const r = f.render(); await r.settle(); assert(!textOf(r.output).includes('Look up saved Apple Place ID'));
            assert.equal(f.calls.length, 0); readOnly(f); r.unmount();
        }
        const held = defer(), f = setup(), r = f.render();
        f.rt.world.override = call => call.user === 'a' ? held.promise : null; await r.settle(); f.rt.switch('b', r); await r.settle();
        held.resolve(new Response(JSON.stringify(fixture({ apple_place_id: 'Old account ID' })), { status: 200 })); await r.settle();
        assert(!textOf(r.output).includes('Look up saved Apple Place ID')); assert(!textOf(r.output).includes('Private Cafe'));
        assert.equal(f.calls.length, 0); assert.equal(f.rt.world.lateUpdates, 0); readOnly(f); r.unmount();
    });
    await test('Delete confirmation cancels lookup; cancelling delete requires a fresh explicit lookup', async () => {
        const held = defer(), f = setup({ lookup: () => held.promise }), r = f.render(); await r.settle();
        const pending = lookupButton(r).props.onPress(); await r.settle(); await click(r, 'Delete Personal Place');
        assert(lookupButton(r).props.disabled); held.resolve([location('1:0')]); await pending; await r.settle();
        assert.equal(f.cancel.length, 1); assert.equal(markers(r).length, 0); await click(r, 'Cancel');
        assert(!lookupButton(r).props.disabled); assert.equal(f.calls.length, 1); readOnly(f); r.unmount();
    });
    console.log(`${passed} offline saved personal Apple lookup checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
