// Actual adapter, access wrapper, preview screen and native-map props offline.
// Native MapKit is a mock; no Expo CLI, dotenv, provider or hosted request.
const assert = require('node:assert/strict');
const { runtime, response, screen, click, enter, nodes, textOf } = require('./personal-places.cjs');
const comparisonId = '8b6fdcaf-5915-4d13-811b-bf62a9c87ac3';
let passed = 0;
function clock() {
    let time = 0, sequence = 0; const timers = new Map();
    return { setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: time + ms }); return id; },
        clearTimeout(id) { timers.delete(id); }, get size() { return timers.size; },
        async advance(ms, r) { const end = time + ms;
            while (true) {
                const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
                if (!next || next[1].at > end) break;
                time = next[1].at; timers.delete(next[0]); next[1].fn();
                if (r) await r.settle(); else await new Promise(resolve => setImmediate(resolve));
            }
            time = end; if (r) await r.settle();
        } };
}
function defer() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function saved() {
    return { saved_kind: 'personal', saved_id: comparisonId, restaurant_id: null, group_id: null, group_name: null,
        name: 'Saved Chipotle', address: 'Synthetic saved address', latitude: 37.5555437394246, longitude: -121.982959052141,
        resolution_status: 'resolved', standardized_address: 'Synthetic saved address', resolution_accuracy: 'building' };
}
function location(id = '2:0', overrides = {}) {
    return { id, name: 'Chipotle Mexican Grill', address: '2760 Mowry Avenue, Fremont, CA 94538',
        latitude: 37.553, longitude: -121.980, source: 'apple-maps-preview', kind: 'business', ...overrides };
}
function setup(options = {}) {
    const time = clock(), calls = [], reset = [], cancel = []; let lookups = 0;
    const native = { isAvailable: () => options.nativeAvailable !== false,
        complete(query, mode, requestId) { calls.push({ action: 'complete', query, mode, requestId });
            return options.complete ? options.complete(query, mode, requestId) : Promise.resolve([{ id: requestId + ':0', title: 'Chipotle Mexican Grill', subtitle: '2760 Mowry Avenue, Fremont' }]); },
        resolve(suggestionId, requestId) { calls.push({ action: 'resolve', suggestionId, requestId });
            return options.resolve ? options.resolve(suggestionId, requestId) : Promise.resolve([location(requestId + ':0')]); },
        search(query, mode, requestId) { calls.push({ action: 'search', query, mode, requestId });
            return options.search ? options.search(query, mode, requestId) : Promise.resolve([location(requestId + ':0', { kind: mode })]); },
        supportsPlaceIdLookup: () => options.lookupAvailable !== false,
        lookupPlace(placeId, mode, requestId) { calls.push({ action: 'lookup', placeId, mode, requestId });
            return options.lookup ? options.lookup(placeId, mode, requestId) : Promise.resolve([location(requestId + ':0', { placeId, kind: mode })]); },
        async cancel(id) { cancel.push(id); }, async reset() { reset.push(true); } };
    if (options.oldModule) delete native.search;
    if (options.oldLookupModule) { delete native.lookupPlace; delete native.supportsPlaceIdLookup; }
    const rt = runtime({ development: true, platform: 'ios', setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
        ...options,
        mocks: { expo: { requireOptionalNativeModule(name) { assert.equal(name, 'GroupBiteMapKitSearch'); lookups++; return options.missing ? null : native; } },
            'react-native-maps': { default: 'MapView', Marker: 'Marker', PROVIDER_DEFAULT: 'default' },
            'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' } },
        fetch(call) {
            assert.equal(call.url.pathname, '/rest/v1/rpc/get_saved_locations'); assert.equal(call.method, 'POST');
            assert.equal(call.body.scope, 'personal'); assert.equal(call.body.target_group_id, null);
            return response(call.user === 'a' && options.saved !== false ? [saved()] : []);
        } });
    return { rt, time, native, calls, reset, cancel, lookups: () => lookups, api: rt.load('@/lib/apple-map-search'),
        render: () => screen(rt, 'dev-apple-search') };
}
function suggestions(r) { return nodes(r.output).filter(n => n.props?.accessibilityLabel?.startsWith('Select Apple suggestion:')); }
function candidates(r) { return nodes(r.output).filter(n => n.props?.accessibilityLabel?.startsWith('Preview Apple location:')); }
function markers(r) { return nodes(r.output).filter(n => n.type === 'Marker'); }
async function type(f, r, query = 'Chipotle') { await enter(r, 'Apple Maps search', query); await f.time.advance(400, r); }
async function resolve(f, r) { await type(f, r); const b = suggestions(r)[0]; assert(b); await b.props.onPress(); await r.settle(); }
async function preview(f, r) { await resolve(f, r); const b = candidates(r)[0]; assert(b); b.props.onPress(); await r.settle(); }
async function error(f, operation) { let caught; try { await operation(); } catch (e) { caught = e; }
    assert(caught); const message = f.api.appleSearchErrorMessage(caught); assert(!message.includes('private raw')); return caught; }
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
    await test('Release/other platforms block search; missing debug modules fail safely with setup instructions', async () => {
        for (const opts of [{ development: false }, { platform: 'android' }, { platform: 'web' }, { missing: true }, { nativeAvailable: false }, { oldModule: true }]) {
            const f = setup(opts); assert.equal(f.api.appleSearchAvailable(), false);
            await error(f, () => f.api.completeAppleSearch('Chipotle', 'business', new AbortController().signal)); assert.equal(f.calls.length, 0);
            const r = f.render(); await r.settle();
            if (opts.development === false || opts.platform) { assert.equal(f.lookups(), 0); assert.equal(f.rt.world.requests.length, 0); }
            else { assert(textOf(r.output).includes('Expo Go')); assert.equal(suggestions(r).length, 0); }
            r.unmount();
        }
    });
    await test('Business and address requests are typed, bounded and preserve only preview fields', async () => {
        const f = setup();
        for (const mode of ['business', 'address']) {
            const list = await f.api.completeAppleSearch('  Chipotle  ', mode, new AbortController().signal);
            assert.equal(list.length, 1); assert.equal(f.calls.at(-1).query, 'Chipotle'); assert.equal(f.calls.at(-1).mode, mode);
            const locations = await f.api.resolveAppleSuggestion(list[0].id, new AbortController().signal);
            assert.equal(locations[0].source, 'apple-maps-preview'); assert(!('selectionReceipt' in locations[0]));
        }
        for (const [query, mode] of [['ab', 'business'], ['x'.repeat(201), 'address'], ['bad\nquery', 'address'], ['valid', 'other']]) {
            const count = f.calls.length; await error(f, () => f.api.completeAppleSearch(query, mode, new AbortController().signal)); assert.equal(f.calls.length, count);
        }
        await error(f, () => f.api.resolveAppleSuggestion('not-a-current-id', new AbortController().signal));
        assert.equal(f.rt.world.requests.length, 0);
    });
    await test('Malformed, duplicate, nonfinite, out-of-range and forged provider responses fail closed', async () => {
        for (const result of [null, {}, Array(6).fill(location()), [location(), location()], [location('bad')],
            [location('1:0', { latitude: NaN })], [location('1:0', { longitude: 181 })], [location('1:0', { latitude: '37.5' })],
            [location('1:0', { source: 'geoapify' })], [location('1:0', { address: 'bad\naddress' })]]) {
            const f = setup({ resolve: () => Promise.resolve(result) });
            await error(f, () => f.api.resolveAppleSuggestion('1:0', new AbortController().signal)); assert.equal(f.calls.length, 1);
        }
        const f = setup({ complete: () => Promise.resolve([{ id: '1:0', title: 'ok', subtitle: '' }, { id: '1:0', title: 'other', subtitle: '' }]) });
        await error(f, () => f.api.completeAppleSearch('address', 'address', new AbortController().signal));
    });
    await test('No request starts automatically; typing uses 400ms debounce and address/business switches clear the preview', async () => {
        const f = setup(), r = f.render(); await r.settle(); assert.equal(f.calls.length, 0);
        await enter(r, 'Apple Maps search', 'ab'); await f.time.advance(1000, r); assert.equal(f.calls.length, 0);
        await enter(r, 'Apple Maps search', 'Chipotle'); await f.time.advance(399, r); assert.equal(f.calls.length, 0);
        await f.time.advance(1, r); assert.equal(f.calls.length, 1); assert.equal(suggestions(r).length, 1);
        await click(r, 'Addresses'); assert.equal(suggestions(r).length, 0); await f.time.advance(400, r);
        assert.equal(f.calls.at(-1).mode, 'address'); assert.equal(f.rt.world.requests.length, 1); r.unmount();
    });
    await test('Suggestions resolve only on selection; multiple locations require a separate explicit preview choice', async () => {
        const f = setup({ resolve: (_, requestId) => Promise.resolve([location(requestId + ':0'), location(requestId + ':1', { name: 'Another location' })]) });
        const r = f.render(); await r.settle(); await resolve(f, r);
        assert.equal(candidates(r).length, 2); assert.equal(markers(r).length, 0); // Map opens only after a location is selected.
        const selected = candidates(r)[1]; selected.props.onPress(); await r.settle();
        assert.equal(markers(r).length, 2); assert.equal(markers(r).find(p => p.props.pinColor === 'blue').props.title, 'Apple: Another location');
        assert.equal(f.calls.filter(c => c.action === 'resolve').length, 1); r.unmount();
    });
    await test('Comparison preserves the authorized saved point, previews Apple in blue and never writes, signs or attaches', async () => {
        const f = setup(), r = f.render(); await r.settle(); await preview(f, r);
        const red = markers(r).find(p => p.props.pinColor === 'red'), blue = markers(r).find(p => p.props.pinColor === 'blue');
        assert.equal(red.props.coordinate.latitude, saved().latitude); assert.equal(red.props.coordinate.longitude, saved().longitude);
        assert.equal(blue.props.coordinate.latitude, location().latitude); assert.equal(blue.props.description, location().address);
        assert.equal(red.props.draggable, false); assert.equal(blue.props.draggable, false);
        assert(textOf(r.output).includes('approximately')); await click(r, 'Looks correct (preview only)');
        assert(textOf(r.output).includes('Nothing was saved')); assert.equal(f.rt.world.localWrites, 0);
        assert.equal(f.rt.world.requests.length, 1); assert.equal(f.api.pinDistanceMeters(saved(), saved()), 0);
        const map = nodes(r.output).find(n => n.type === 'MapView'); assert(map.props.scrollEnabled && map.props.zoomEnabled);
        assert.equal(map.props.showsUserLocation, false); assert.equal(map.props.showsMyLocationButton, false);
        assert.equal(map.props.style.flex, 1); assert(map.props.style.minHeight >= 240); assert(!('height' in map.props.style));
        let fit, options; map.props.ref.current = { fitToCoordinates(value, settings) { fit = value; options = settings; } };
        map.props.onMapReady(); assert.equal(fit.length, 2); assert(Object.values(options.edgePadding).every(value => value >= 40));
        assert.equal(nodes(r.output).filter(n => n.type === 'TextInput').length, 0);
        assert(textOf(r.output).includes(String(saved().latitude))); assert(textOf(r.output).includes(String(saved().longitude)));
        const count = f.calls.length; await click(r, 'Return to search'); assert.equal(markers(r).length, 0);
        assert.equal(candidates(r).length, 1); await f.time.advance(1000, r); assert.equal(f.calls.length, count);
        r.unmount();
    });
    await test('Explicit Chipotle action searches once; absent ownership never substitutes hardcoded saved coordinates', async () => {
        const f = setup({ saved: false }), r = f.render(); await r.settle();
        assert.equal(markers(r).length, 0); assert(textOf(r.output).includes('No saved Chipotle comparison pin'));
        await click(r, 'Search Chipotle in Apple Maps'); await f.time.advance(400, r);
        assert.equal(f.calls.length, 1); assert.equal(f.calls[0].query, f.api.CHIPOTLE_SEARCH);
        assert.equal(f.calls[0].action, 'search'); assert.equal(candidates(r).length, 1); r.unmount();
    });
    await test('Cancellation and the adapter deadline discard late completion without retry', async () => {
        for (const timedOut of [false, true]) {
            const held = defer(), f = setup({ complete: () => held.promise }), parent = new AbortController();
            const pending = f.api.completeAppleSearch('Chipotle', 'business', parent.signal);
            const rejection = error(f, () => pending);
            if (timedOut) await f.time.advance(10000); else parent.abort();
            assert.equal((await rejection).kind, timedOut ? 'timeout' : 'cancelled'); assert.equal(f.calls.length, 1); assert.equal(f.cancel.length, 1);
            held.resolve([{ id: '1:0', title: 'late', subtitle: '' }]); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.time.size, 0);
        }
    });
    await test('Query edits cancel completion/resolution and stale callbacks cannot restore a preview', async () => {
        const held = defer(), f = setup({ complete: () => held.promise }), r = f.render(); await r.settle(); await type(f, r);
        await enter(r, 'Apple Maps search', 'New query'); held.resolve([{ id: '1:0', title: 'obsolete', subtitle: '' }]); await r.settle();
        assert.equal(suggestions(r).length, 0); assert.equal(f.cancel.length, 1); r.unmount();
        const resolving = defer(), next = setup({ resolve: () => resolving.promise }), other = next.render(); await other.settle();
        await type(next, other); const stale = suggestions(other)[0]; const pending = stale.props.onPress(); await other.settle();
        await enter(other, 'Apple Maps search', 'Changed'); resolving.resolve([location()]); await pending; await other.settle();
        assert.equal(candidates(other).length, 0); await stale.props.onPress(); await other.settle();
        assert.equal(next.calls.filter(c => c.action === 'resolve').length, 1); other.unmount();
    });
    await test('Native failures remain safe, double-taps do not resolve twice, and retries occur only after another edit', async () => {
        const held = defer(), f = setup({ resolve: () => held.promise }), r = f.render(); await r.settle(); await type(f, r);
        const b = suggestions(r)[0], one = b.props.onPress(), two = b.props.onPress();
        assert.equal(f.calls.filter(c => c.action === 'resolve').length, 1);
        held.reject(new Error('private raw query, token or provider response')); await one; await two; await r.settle();
        assert(!textOf(r.output).includes('private raw')); assert(textOf(r.output).includes('unavailable'));
        await f.time.advance(20000, r); assert.equal(f.calls.length, 2); r.unmount();
    });
    await test('Business/address autocomplete and explicit text searches produce separately selectable results', async () => {
        for (const [mode, query] of [['business', 'Chipotle Fremont'], ['address', '2760 Mowry Avenue, Fremont']]) {
            const f = setup(), r = f.render(); await r.settle();
            if (mode === 'address') await click(r, 'Addresses');
            await type(f, r, query); assert.equal(suggestions(r).length, 1);
            assert.equal(f.calls.at(-1).mode, mode); assert.equal(f.calls.at(-1).query, query);
            await click(r, 'Search places'); assert(textOf(r.output).includes('Searching Apple locations'));
            await f.time.advance(399, r); assert.equal(f.calls.length, 1);
            await f.time.advance(1, r); assert.equal(f.calls.length, 2); assert.equal(f.calls.at(-1).action, 'search');
            assert.equal(candidates(r).length, 1); assert.equal(suggestions(r).length, 0); assert.equal(markers(r).length, 0);
            candidates(r)[0].props.onPress(); await r.settle(); assert.equal(markers(r).length, 2);
            assert.equal(f.calls.filter(call => call.action === 'resolve').length, 0); r.unmount();
        }
    });
    await test('Loading, completed-empty and native error states are distinct, safe and require explicit new searches', async () => {
        const held = defer(), f = setup({ complete: () => held.promise, search: () => Promise.resolve([]) }), r = f.render(); await r.settle();
        assert(!textOf(r.output).includes('No Apple suggestions'));
        await type(f, r); assert(textOf(r.output).includes('Loading Apple suggestions')); assert(!textOf(r.output).includes('No Apple suggestions'));
        held.resolve([]); await r.settle(); assert(textOf(r.output).includes('No Apple suggestions'));
        await click(r, 'Search places'); await f.time.advance(400, r); assert(textOf(r.output).includes('No matching Apple locations'));
        await f.time.advance(20000, r); assert.equal(f.calls.length, 2); r.unmount();
        for (const [code, expected] of [['ERR_TIMEOUT', 'timed out'], ['ERR_INVALID', 'Check the search text'], ['ERR_DISABLED', 'debug build'], ['UNKNOWN', 'unavailable']]) {
            const next = setup({ complete: () => Promise.reject({ code, message: 'private raw address' }) }), other = next.render(); await other.settle();
            await type(next, other); assert(textOf(other.output).includes(expected)); assert(!textOf(other.output).includes('private raw'));
            assert(!textOf(other.output).includes('No Apple suggestions')); assert(nodes(other.output).some(n => n.props?.accessibilityRole === 'alert'));
            await next.time.advance(20000, other); assert.equal(next.calls.length, 1); other.unmount();
        }
    });
    await test('Explicit text search validates results, cancels on edits/background and ignores stale location responses', async () => {
        for (const action of ['edit', 'background']) {
            const held = defer(), f = setup({ search: () => held.promise }), r = f.render(); await r.settle();
            await click(r, 'Search Chipotle in Apple Maps'); await f.time.advance(400, r);
            if (action === 'edit') await enter(r, 'Apple Maps search', 'Changed query'); else { f.rt.emit('background'); await r.settle(); }
            held.resolve([location()]); await r.settle(); assert.equal(candidates(r).length, 0); assert.equal(markers(r).length, 0);
            assert.equal(f.cancel.length, 1); assert.equal(f.calls.length, 1); r.unmount();
        }
        const f = setup({ search: () => Promise.resolve([location('1:0', { latitude: Infinity })]) });
        await error(f, () => f.api.searchApplePlaces('Chipotle Fremont', 'business', new AbortController().signal));
        const before = f.calls.length; await error(f, () => f.api.searchApplePlaces('ab', 'business', new AbortController().signal));
        assert.equal(f.calls.length, before);
    });
    await test('Sign-out, account switch, blur and background clear all private pins and late search results', async () => {
        for (const action of ['signout', 'switch', 'blur', 'background']) {
            const held = defer(), f = setup({ complete: () => held.promise }), r = f.render(); await r.settle(); await type(f, r);
            if (action === 'signout') f.rt.switch(null, r);
            if (action === 'switch') f.rt.switch('b', r);
            if (action === 'blur') { f.rt.world.focused = false; r.dirty = true; }
            if (action === 'background') f.rt.emit('background');
            await r.settle(); held.resolve([{ id: '1:0', title: 'obsolete', subtitle: '' }]); await r.settle();
            assert.equal(markers(r).length, 0); assert.equal(suggestions(r).length, 0); assert.equal(f.rt.world.lateUpdates, 0);
            assert(f.reset.length > 0); r.unmount();
        }
    });
    await test('Optional opaque Place IDs preserve temporary IDs on completion resolution and text search', async () => {
        for (const placeId of [undefined, null, 'Opaque:Mixed-Case/ref', 'I63802885C8189B2B']) {
            const f = setup({ resolve: (_, requestId) => Promise.resolve([location(requestId + ':0', { placeId, secret: 'discard', selectionReceipt: 'discard' })]),
                search: (_, mode, requestId) => Promise.resolve([location(requestId + ':0', { placeId, kind: mode })]) });
            for (const row of [
                ...(await f.api.resolveAppleSuggestion('1:0', new AbortController().signal)),
                ...(await f.api.searchApplePlaces('Synthetic address', 'address', new AbortController().signal)),
            ]) {
                assert.match(row.id, /^[0-9]+:0$/);
                assert.equal(row.placeId, placeId ?? undefined);
                assert.equal('placeId' in row, typeof placeId === 'string');
                assert(!('selectionReceipt' in row)); assert(!('secret' in row));
            }
            assert.equal(f.rt.world.requests.length, 0); assert.equal(f.rt.world.localWrites, 0);
        }
        for (const placeId of ['', ' ', ' padded', 'bad\nID', 'bad\u0085ID', 'x'.repeat(301), 12, {}]) {
            const f = setup({ search: () => Promise.resolve([location('1:0', { placeId })]) });
            await error(f, () => f.api.searchApplePlaces('Synthetic address', 'address', new AbortController().signal));
        }
    });
    await test('Older binaries/OS versions retain search, disable only lookup, and release/platform gates hold', async () => {
        for (const opts of [{ oldLookupModule: true }, { lookupAvailable: false }]) {
            const f = setup(opts);
            assert.equal(f.api.appleSearchAvailable(), true); assert.equal(f.api.applePlaceIdLookupAvailable(), false);
            assert.equal((await f.api.searchApplePlaces('Synthetic query', 'business', new AbortController().signal)).length, 1);
            const e = await error(f, () => f.api.lookupApplePlace('Opaque-ID', 'business', new AbortController().signal));
            assert.equal(e.kind, 'unavailable'); assert(e.message.includes('iOS 18'));
            assert.equal(f.calls.filter(c => c.action === 'lookup').length, 0);
            const r = f.render(); await r.settle(); await preview(f, r);
            assert(textOf(r.output).includes('Search preview is still available'));
            assert(nodes(r.output).find(n => n.type === 'Pressable' && textOf(n.props.children) === 'Look up Apple Place ID again').props.disabled);
            r.unmount();
        }
        const broken = setup(); broken.native.supportsPlaceIdLookup = () => { throw new Error('private raw capability'); };
        assert.equal(broken.api.applePlaceIdLookupAvailable(), false);
        delete broken.native.supportsPlaceIdLookup;
        assert.equal(broken.api.applePlaceIdLookupAvailable(), false);
        for (const opts of [{ development: false }, { platform: 'android' }, { platform: 'web' }, { missing: true }]) {
            const f = setup(opts); assert.equal(f.api.applePlaceIdLookupAvailable(), false);
            await error(f, () => f.api.lookupApplePlace('Opaque-ID', 'business', new AbortController().signal));
            assert.equal(f.calls.length, 0);
        }
    });
    await test('Identifier lookup preserves exact references, accepts changed/absent IDs, and validates single results', async () => {
        for (const mode of ['business', 'address']) {
            const f = setup({ lookup: (_, kind, requestId) => Promise.resolve([location(requestId + ':0', { placeId: 'New-Alias', kind })]) });
            const rows = await f.api.lookupApplePlace('Opaque:Mixed-Case/ref', mode, new AbortController().signal);
            assert.equal(f.calls[0].placeId, 'Opaque:Mixed-Case/ref'); assert.equal(f.calls[0].mode, mode);
            assert.equal(rows[0].placeId, 'New-Alias'); assert.equal(rows[0].id, f.calls[0].requestId + ':0');
        }
        const missingId = setup({ lookup: (_, kind, requestId) => Promise.resolve([location(requestId + ':0', { kind })]) });
        assert(!('placeId' in (await missingId.api.lookupApplePlace('Original-ID', 'business', new AbortController().signal))[0]));
        for (const [placeId, mode] of [['', 'business'], [' padded', 'business'], ['bad\nID', 'address'], ['x'.repeat(301), 'address'], ['valid', 'other']]) {
            const f = setup(); assert.equal((await error(f, () => f.api.lookupApplePlace(placeId, mode, new AbortController().signal))).kind, 'invalid');
            assert.equal(f.calls.length, 0);
        }
        for (const result of [null, {}, [location('1:0'), location('1:1')], [location('bad')],
            [location('1:0', { longitude: Infinity })], [location('1:0', { placeId: 123 })], [location('1:0', { source: 'geoapify' })]]) {
            const f = setup({ lookup: () => Promise.resolve(result) });
            await error(f, () => f.api.lookupApplePlace('Valid-ID', 'business', new AbortController().signal));
        }
    });
    await test('Lookup adapter cancellation/deadline discard late responses and never retry', async () => {
        for (const timedOut of [false, true]) {
            const held = defer(), f = setup({ lookup: () => held.promise }), controller = new AbortController();
            const pending = error(f, () => f.api.lookupApplePlace('Opaque-ID', 'business', controller.signal));
            if (timedOut) await f.time.advance(10000); else controller.abort();
            assert.equal((await pending).kind, timedOut ? 'timeout' : 'cancelled');
            assert.equal(f.calls.length, 1); assert.equal(f.cancel.length, 1);
            held.resolve([location('1:0')]); await f.time.advance(20000);
            assert.equal(f.calls.length, 1); assert.equal(f.time.size, 0);
        }
        const f = setup(), cancelled = new AbortController(); cancelled.abort();
        await error(f, () => f.api.lookupApplePlace('Opaque-ID', 'business', cancelled.signal)); assert.equal(f.calls.length, 0);
    });
    await test('Search-to-ID-to-lookup updates only the transient Apple preview, never the saved pin', async () => {
        const f = setup({ search: (_, kind, requestId) => Promise.resolve([location(requestId + ':0', { placeId: 'Original-ID', kind })]),
            lookup: (_, kind, requestId) => Promise.resolve([location(requestId + ':0', { placeId: 'Current-ID', kind, name: 'Fresh Apple restaurant', latitude: 37.554 })]) });
        const r = f.render(); await r.settle(); await click(r, 'Search Chipotle in Apple Maps'); await f.time.advance(400, r);
        assert.equal(f.calls.length, 1); candidates(r)[0].props.onPress(); await r.settle();
        assert(textOf(r.output).includes('Apple Place ID: Original-ID')); assert.equal(f.calls.length, 1);
        await click(r, 'Look up Apple Place ID again');
        assert.equal(f.calls.length, 2); assert.equal(f.calls[1].action, 'lookup'); assert.equal(f.calls[1].placeId, 'Original-ID');
        assert(textOf(r.output).includes('Apple Place ID: Current-ID')); assert(textOf(r.output).includes('returned current Apple details'));
        assert.equal(markers(r).find(n => n.props.pinColor === 'blue').props.coordinate.latitude, 37.554);
        assert.equal(markers(r).find(n => n.props.pinColor === 'red').props.coordinate.latitude, saved().latitude);
        assert.equal(f.rt.world.localWrites, 0); assert.equal(f.rt.world.requests.length, 1);
        await click(r, 'Return to search'); assert.equal(candidates(r).length, 1); await f.time.advance(20000, r);
        assert.equal(f.calls.length, 2); r.unmount();
        const noId = setup(), other = noId.render(); await other.settle(); await preview(noId, other);
        assert(textOf(other.output).includes('unavailable for this result'));
        assert(nodes(other.output).find(n => n.type === 'Pressable' && textOf(n.props.children) === 'Look up Apple Place ID again').props.disabled);
        other.unmount();
    });
    await test('Empty and failed lookups leave the prior preview intact and require another explicit action', async () => {
        for (const failure of [false, true]) {
            const f = setup({ resolve: (_, requestId) => Promise.resolve([location(requestId + ':0', { placeId: 'Original-ID' })]),
                lookup: () => failure ? Promise.reject({ code: 'UNKNOWN', message: 'private raw lookup' }) : Promise.resolve([]) });
            const r = f.render(); await r.settle(); await preview(f, r); await click(r, 'Look up Apple Place ID again');
            assert(textOf(r.output).includes(failure ? 'unavailable' : 'No current Apple details'));
            assert(!textOf(r.output).includes('private raw lookup')); assert(textOf(r.output).includes('Apple Place ID: Original-ID'));
            assert.equal(markers(r).find(n => n.props.pinColor === 'blue').props.coordinate.latitude, location().latitude);
            await f.time.advance(20000, r); assert.equal(f.calls.filter(c => c.action === 'lookup').length, 1);
            assert.equal(f.rt.world.requests.length, 1); assert.equal(f.rt.world.localWrites, 0); r.unmount();
        }
    });
    await test('Pending lookup double taps, return-to-search and privacy lifecycle discard obsolete responses', async () => {
        for (const action of ['return', 'background', 'blur', 'signout', 'switch', 'unmount']) {
            const held = defer(), f = setup({ resolve: (_, requestId) => Promise.resolve([location(requestId + ':0', { placeId: 'Original-ID' })]), lookup: () => held.promise });
            const r = f.render(); await r.settle(); await preview(f, r);
            const button = nodes(r.output).find(n => n.type === 'Pressable' && textOf(n.props.children) === 'Look up Apple Place ID again');
            const one = button.props.onPress(), two = button.props.onPress(); await r.settle();
            assert.equal(f.calls.filter(c => c.action === 'lookup').length, 1); assert(textOf(r.output).includes('Looking up Apple Place ID'));
            if (action === 'return') await click(r, 'Return to search');
            if (action === 'background') f.rt.emit('background');
            if (action === 'blur') { f.rt.world.focused = false; r.dirty = true; }
            if (action === 'signout') f.rt.switch(null, r);
            if (action === 'switch') f.rt.switch('b', r);
            if (action === 'unmount') r.unmount();
            await r.settle(); held.resolve([location('99:0', { name: 'Obsolete Apple result', placeId: 'Old-account-ID' })]);
            await one; await two; await r.settle(); await button.props.onPress();
            assert(!textOf(r.output).includes('Obsolete Apple result')); assert(!textOf(r.output).includes('Old-account-ID'));
            assert.equal(f.rt.world.lateUpdates, 0); assert.equal(f.calls.filter(c => c.action === 'lookup').length, 1);
            assert.equal(f.cancel.length, 1); assert.equal(f.rt.world.localWrites, 0); r.unmount();
        }
    });
    await test('Ordinary address candidates outside Fremont stay selectable with or without Apple Place IDs', async () => {
        for (const placeId of [undefined, 'Opaque-Address-ID']) {
            const address = 'Synthetic street, Other City, NY, US';
            const f = setup({ saved: false, complete: () => Promise.resolve([]),
                search: (_, kind, requestId) => Promise.resolve([
                    location(requestId + ':0', { kind, name: 'First street match', address, latitude: 40.7, longitude: -74.0 }),
                    location(requestId + ':1', { kind, name: address, address, latitude: 40.71, longitude: -74.01, placeId }),
                ]) });
            const r = f.render(); await r.settle(); await click(r, 'Addresses'); await type(f, r, address);
            assert(textOf(r.output).includes('No Apple suggestions')); await click(r, 'Search places'); await f.time.advance(400, r);
            assert.equal(f.calls.at(-1).query, address); assert.equal(f.calls.at(-1).mode, 'address');
            assert.equal(candidates(r).length, 2); assert.equal(markers(r).length, 0); // Never choose an ambiguous match automatically.
            candidates(r)[1].props.onPress(); await r.settle();
            assert.equal(markers(r).length, 1); assert.equal(markers(r)[0].props.coordinate.latitude, 40.71);
            assert(textOf(r.output).includes(placeId ? 'Apple Place ID: ' + placeId : 'Apple Place ID: unavailable for this result.'));
            const lookup = nodes(r.output).find(n => n.type === 'Pressable' && textOf(n.props.children) === 'Look up Apple Place ID again');
            assert.equal(lookup.props.disabled, !placeId);
            assert.equal(f.calls.filter(c => c.action === 'lookup').length, 0);
            assert.equal(f.rt.world.requests.length, 1); assert.equal(f.rt.world.localWrites, 0); r.unmount();
        }
    });
    await test('Fresh preview runtimes resolve the manually re-entered address without stored results or IDs', async () => {
        const address = 'Synthetic street, Other City, NY, US';
        for (let launch = 0; launch < 2; launch++) {
            const f = setup({ saved: false, complete: () => Promise.resolve([]), search: (_, kind, requestId) =>
                Promise.resolve([location(requestId + ':0', { kind, name: address, address, latitude: 40.7, longitude: -74.0 })]) });
            const r = f.render(); await r.settle();
            assert.equal(f.calls.length, 0); assert.equal(markers(r).length, 0);
            assert.equal(nodes(r.output).find(n => n.type === 'TextInput').props.value, '');
            await click(r, 'Addresses'); await type(f, r, address); await click(r, 'Search places'); await f.time.advance(400, r);
            assert.equal(f.calls.filter(c => c.action === 'search').length, 1); assert.equal(f.calls.at(-1).query, address);
            candidates(r)[0].props.onPress(); await r.settle();
            assert.equal(markers(r)[0].props.coordinate.latitude, 40.7);
            assert(textOf(r.output).includes('unavailable for this result'));
            assert.equal(f.rt.world.localReads, 0); assert.equal(f.rt.world.localWrites, 0);
            assert.equal(f.calls.filter(c => c.action === 'resolve' || c.action === 'lookup').length, 0);
            r.unmount(); assert(f.reset.length > 0);
        }
    });
    await test('Ordinary address empty/failed/timed-out searches remain distinct without retries or provider fallback', async () => {
        for (const code of [null, 'ERR_UNAVAILABLE', 'ERR_TIMEOUT']) {
            const f = setup({ saved: false, complete: () => Promise.resolve([]), search: () => code === null
                ? Promise.resolve([]) : Promise.reject({ code, message: 'private raw address failure' }) });
            const r = f.render(); await r.settle(); await click(r, 'Addresses'); await type(f, r, 'Synthetic street, Other City');
            await click(r, 'Search places'); await f.time.advance(400, r);
            assert(textOf(r.output).includes(code === null ? 'No matching Apple locations' : code === 'ERR_TIMEOUT' ? 'timed out' : 'unavailable'));
            assert(!textOf(r.output).includes('private raw address failure'));
            if (code !== null) assert(!textOf(r.output).includes('No matching Apple locations'));
            await f.time.advance(20000, r); assert.equal(f.calls.filter(c => c.action === 'search').length, 1);
            assert.equal(candidates(r).length, 0); assert.equal(markers(r).length, 0);
            assert.equal(f.rt.world.requests.length, 1); assert.equal(f.rt.world.localWrites, 0); r.unmount();
        }
    });
    console.log(`${passed} offline native Apple search checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
