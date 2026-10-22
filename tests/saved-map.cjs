// Production reader, matcher, lifecycle hook and screen through offline HTTP /
// native boundaries. No environment secrets or hosted writes.
const assert = require('node:assert/strict');
const { runtime, response, nodes, textOf, click } = require('./personal-places.cjs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = v => JSON.parse(JSON.stringify(v));
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), get resolve() { return resolve; } }; };
function fixture() {
    const groups = [{ id: id(1), name: 'Date Nights' }, { id: id(2), name: 'Friends' }];
    const db = { groups, group_memberships: groups.map((g, i) => ({ group_id: g.id, user_id: 'a', membership_id: id(10 + i) })),
        personal_places: [], group_restaurants: [], restaurants: [], personal_mapkit_locations: [], group_mapkit_locations: [] };
    const venues = ['Special Noodle', 'Chipotle Mexican Grill', 'Din Tai Fung', 'Dishdash', 'Tartine Bakery', 'Pizzetta 211'];
    const cities = ['Fremont', 'Fremont', 'Santa Clara', 'Sunnyvale', 'San Francisco', 'San Francisco'];
    let next = 100;
    venues.forEach((name, i) => {
        const details = { street: `${100 + i} Main St`, city: cities[i], region: 'CA', postal_code: '94538', country: 'United States', country_code: 'US' };
        const address = `${details.street}, ${details.city} CA 94538, United States`;
        const point = { address_snapshot: address, latitude: 37 + i / 10, longitude: -122, structured_address: details };
        const personal = i !== 5;
        if (personal) {
            const p = { id: id(next++), owner_user_id: 'a', name, address: i === 1 ? '123 Example St, Fremont, CA 94538' : address,
                cuisine: null, apple_place_id: i === 1 ? null : `APPLE-${i}`, notes: 'PRIVATE SECRET' };
            db.personal_places.push(p);
            if (i !== 1) db.personal_mapkit_locations.push({ ...point, personal_place_id: p.id, owner_user_id: 'a' });
        }
        const destinations = i === 0 || i === 1 || i === 3 ? groups : i === 2 ? [groups[0]] : i === 5 ? [groups[1]] : [];
        for (const g of destinations) {
            const r = { id: id(next++), name, address, cuisine: null };
            const e = { id: id(next++), restaurant_id: r.id, group_id: g.id, apple_place_id: `APPLE-${i}` };
            db.restaurants.push(r); db.group_restaurants.push(e); db.group_mapkit_locations.push({ ...point, group_restaurant_id: e.id });
        }
    });
    for (const name of ['QA Manual Restaurant', 'Special Noodles House']) db.personal_places.push({ id: id(next++), owner_user_id: 'a', name, address: 'Unverified fixture address', cuisine: null, apple_place_id: null });
    db.personal_places.push({ id: id(999), owner_user_id: 'b', name: 'Foreign private', address: 'SECRET', notes: 'FOREIGN SECRET' });
    return db;
}
function model(options = {}) {
    const db = fixture(); let override, latest;
    const member = (group, user) => db.group_memberships.some(m => m.group_id === group && m.user_id === user);
    function answer(call) {
        const { url, user, method, headers, body } = call;
        if (url.pathname.endsWith('/rpc/get_saved_locations')) {
            assert.equal(method, 'POST'); assert.equal(body.scope, 'all');
            let rows = db.personal_places.filter(p => p.owner_user_id === user).map(p => ({ saved_kind: 'personal', saved_id: p.id, group_id: null, ...p }));
            rows.push(...db.group_restaurants.filter(e => member(e.group_id, user)).map(e => ({ saved_kind: 'group', saved_id: e.id, group_id: e.group_id, ...db.restaurants.find(r => r.id === e.restaurant_id) })));
            rows = rows.map(r => ({ ...r, resolution_status: 'unresolved', latitude: null, longitude: null, standardized_address: null, resolution_accuracy: null }));
            return response(rows.slice(body.page_offset, body.page_offset + Math.min(body.page_size, options.rowCap ?? 1000)));
        }
        assert.equal(method, 'GET', 'No map writes permitted');
        const table = url.pathname.replace('/rest/v1/', ''); assert(Object.hasOwn(db, table), `Unexpected table ${table}`);
        const columns = url.searchParams.get('select').split(','); assert(!columns.includes('*') && !columns.includes('notes'));
        if (['personal_places', 'personal_mapkit_locations'].includes(table)) assert.equal(url.searchParams.get('owner_user_id'), `eq.${user}`);
        if (table === 'group_memberships') assert.equal(url.searchParams.get('user_id'), `eq.${user}`);
        let rows = db[table].filter(r => {
            if (['personal_places', 'personal_mapkit_locations'].includes(table)) return r.owner_user_id === user;
            if (table === 'group_memberships') return r.user_id === user;
            if (table === 'groups') return member(r.id, user);
            if (table === 'group_restaurants') return member(r.group_id, user);
            if (table === 'restaurants') return db.group_restaurants.some(e => e.restaurant_id === r.id && member(e.group_id, user));
            if (table === 'group_mapkit_locations') return db.group_restaurants.some(e => e.id === r.group_restaurant_id && member(e.group_id, user));
            return false;
        });
        for (const [key, value] of url.searchParams) {
            if (value.startsWith('eq.')) rows = rows.filter(r => r[key] === value.slice(3));
            if (value.startsWith('gt.')) rows = rows.filter(r => r[key] > value.slice(3));
            if (value.startsWith('in.(')) rows = rows.filter(r => value.slice(4, -1).split(',').includes(r[key]));
        }
        const order = url.searchParams.get('order')?.split('.')[0]; rows.sort((a, b) => a[order].localeCompare(b[order]));
        const count = rows.length; rows = rows.slice(0, Math.min(Number(url.searchParams.get('limit')), options.rowCap ?? 1000));
        const outHeaders = { 'Content-Type': 'application/json' };
        if (headers.get('Prefer')?.includes('count=exact')) outHeaders['Content-Range'] = `*/${count}`;
        return new Response(JSON.stringify(rows.map(row => Object.fromEntries(columns.map(k => [k, row[k]])))), { status: 200, headers: outHeaders });
    }
    const rt = runtime({ ...options, platform: 'ios', development: true, mocks: { '@/components/saved-map-canvas': { default: 'MapCanvas' }, ...options.mocks },
        fetch: call => override?.(call, () => answer(call)) ?? answer(call) });
    Object.assign(rt.load('react-native'), { FlatList: props => ({ type: 'FlatList', props: { ...props, children: [props.ListHeaderComponent, ...props.data.map(item => props.renderItem({ item })), props.data.length ? null : props.ListEmptyComponent] } }), PanResponder: { create: handlers => ({ panHandlers: handlers }) },
        Animated: { Value: class { constructor(value) { this.value = value; this.listeners = new Map(); }
            setValue(value) { this.value = value; for (const fn of this.listeners.values()) fn({ value }); }
            addListener(fn) { const key = String(this.listeners.size); this.listeners.set(key, fn); return key; }
            removeListener(key) { this.listeners.delete(key); } stopAnimation(fn) { fn?.(this.value); } },
            View: 'AnimatedView', spring: (value, config) => ({ start() { value.setValue(config.toValue); } }) } });
    const lib = rt.load('@/lib/saved-map-data'), identity = rt.load('@/lib/saved-map-model');
    return { db, rt, lib, identity, set override(value) { override = value; },
        load: (user = 'a', signal = new AbortController().signal) => lib.readSavedMap(user, signal),
        hook() { return rt.render(function Probe() { latest = rt.load('@/hooks/use-saved-map').useSavedMap('a'); return null; }, false); },
        get latest() { return latest; } };
}
let passed = 0;
async function test(name, run) { await run(); console.log('PASS ' + name); passed++; }
const source = (overrides = {}) => ({ key: 'personal:one', kind: 'personal', entryId: id(100), groupId: null, label: 'My Places', name: 'Cafe',
    address: '100 Main St, Fremont CA 94538, United States', cuisine: null, appleId: 'opaque-ID', structured: null, standardizedAddress: null,
    coordinate: { latitude: 37, longitude: -122, quality: 'apple' }, ...overrides });
(async () => {
    await test('Phase C shape: 15 destination entries become six pins, four per filter and three unmapped personal records', async () => {
        const f = model(), result = await f.load(), grouped = f.identity.groupMapRestaurants(result.sources);
        assert.equal(result.sources.length, 15); assert.equal(grouped.filter(r => r.coordinate).length, 6); assert.equal(grouped.filter(r => !r.coordinate).length, 3);
        for (const filter of ['personal', id(1), id(2)]) assert.equal(f.identity.filterMapRestaurants(grouped, filter).filter(r => r.coordinate).length, 4);
        assert.equal(new Set(result.sources.flatMap(s => s.structured?.city ? [s.structured.city] : [])).size, 4);
        assert(!JSON.stringify(result).includes('SECRET')); assert.equal(f.rt.world.localWrites, 0);
    });
    await test('Exact Apple IDs and complete ID-less copies combine collection targets without changing input', () => {
        const f = model(), inputs = [source(), source({ key: 'group:two', kind: 'group', groupId: id(1) }), source({ key: 'personal:three', appleId: null })];
        const before = JSON.stringify(inputs), grouped = f.identity.groupMapRestaurants(inputs);
        assert.equal(grouped.length, 1); assert.equal(grouped[0].sources.length, 3); assert.equal(JSON.stringify(inputs), before);
    });
    await test('Different branches, units, opaque IDs, missing addresses and ID-less bridges remain separate', () => {
        const { identity: m } = model();
        for (const inputs of [
            [source(), source({ key: 'two', address: '200 Main St, Fremont CA 94538, United States' })],
            [source({ appleId: null, address: '100 Main St Suite 1, Fremont CA 94538, United States' }), source({ key: 'two', appleId: null, address: '100 Main St Suite 2, Fremont CA 94538, United States' })],
            [source(), source({ key: 'two', appleId: 'OPAQUE-ID' })],
            [source({ appleId: null, address: 'Fremont' }), source({ key: 'two', appleId: null, address: 'Fremont' })],
        ]) assert.equal(m.groupMapRestaurants(inputs).length, 2);
        assert.equal(m.groupMapRestaurants([source(), source({ key: 'two', appleId: 'different' }), source({ key: 'three', appleId: null })]).length, 3);
    });
    await test('Conflicting coordinates split identities and filters never borrow other collections’ points', () => {
        const { identity: m } = model();
        assert.equal(m.groupMapRestaurants([source(), source({ key: 'two', coordinate: { latitude: 38, longitude: -122, quality: 'apple' } })]).length, 2);
        const all = m.groupMapRestaurants([source({ coordinate: null }), source({ key: 'group:two', kind: 'group', groupId: id(1) })]);
        assert.equal(all.length, 1); assert.equal(m.filterMapRestaurants(all, 'personal')[0].coordinate, null);
        assert.equal(m.groupMapRestaurants([source({ structured: { street: '999 Main St', city: 'Fremont', region: 'CA', postal_code: '94538', country: 'United States', country_code: 'US' } }), source({ key: 'two' })]).length, 2);
    });
    await test('Short server page caps are fully read, including native metadata and verified-location pages', async () => {
        const f = model({ rowCap: 1 }); const result = await f.load(); assert.equal(result.sources.length, 15);
        assert.equal(f.identity.groupMapRestaurants(result.sources).filter(r => r.coordinate).length, 6);
    });
    await test('Stale snapshots and invalid coordinates never produce invented pins', async () => {
        const f = model(); const tartine = f.db.personal_places.find(p => p.name === 'Tartine Bakery');
        f.db.personal_mapkit_locations.find(l => l.personal_place_id === tartine.id).address_snapshot = 'OLD ADDRESS';
        const result = await f.load(); assert.equal(result.sources.find(s => s.entryId === tartine.id).coordinate, null);
        for (const coordinate of [{ latitude: null, longitude: -122 }, { latitude: 0, longitude: 0 }, { latitude: 91, longitude: 0 }]) assert(!f.identity.validMapCoordinate(coordinate));
    });
    await test('Wrong accounts, pre-cancelled reads and foreign inventory rows fail closed', async () => {
        const f = model(); await assert.rejects(f.load('b')); assert.equal(f.rt.world.requests.length, 0);
        const controller = new AbortController(); controller.abort(); await assert.rejects(f.load('a', controller.signal)); assert.equal(f.rt.world.requests.length, 0);
        const foreign = model(); foreign.override = call => call.url.pathname.endsWith('/personal_places')
            ? new Response(JSON.stringify([{ ...foreign.db.personal_places[0], owner_user_id: 'b' }]), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '*/1' } }) : null;
        await assert.rejects(foreign.load());
    });
    await test('Membership change during load rejects all group content without mutating data', async () => {
        const f = model(); let changed = false;
        f.override = (call, answer) => { const reply = answer(); if (!changed && call.url.pathname.endsWith('/group_mapkit_locations')) { changed = true; f.db.group_memberships[0].membership_id = id(88); } return reply; };
        await assert.rejects(f.load()); assert.equal(f.rt.world.localWrites, 0);
    });
    await test('Hook clears content on failed refresh, blur and background; foreground/focus reload without polling', async () => {
        const f = model(), r = f.hook(); await r.settle(); assert.equal(f.latest.data.sources.length, 15); assert.equal(f.rt.world.intervals.size, 0);
        f.override = () => response({ message: 'PRIVATE ERROR' }, 503); f.latest.refresh(); await r.settle(); assert.equal(f.latest.data, null); assert(f.latest.error && !f.latest.error.includes('PRIVATE'));
        f.override = null; f.latest.refresh(); await r.settle();
        f.rt.emit('background'); await r.settle(); assert.equal(f.latest.data, null);
        f.db.group_memberships = []; f.rt.emit('active'); await r.settle(); assert.equal(f.latest.data.sources.length, 7); assert.equal(f.latest.data.collections.length, 0);
        f.rt.world.focused = false; r.dirty = true; await r.settle(); assert.equal(f.latest.data, null);
        f.rt.world.focused = true; r.dirty = true; await r.settle(); assert.equal(f.latest.data.sources.length, 7); r.unmount();
    });
    await test('Late account-switch results cannot publish or dispatch following pages', async () => {
        const held = deferred(), f = model(); let first = true;
        f.override = (call, answer) => { if (first) { first = false; return held.promise.then(answer); } return answer(); };
        const pending = f.load(); await new Promise(r => setImmediate(r)); f.rt.switch('b'); held.resolve(); await assert.rejects(pending);
        assert(f.rt.world.requests.every(r => r.headers.get('Authorization') === 'Bearer fake-a'));
    });
    await test('Screen filters, pin/card selection, dismissal and map-origin targets remain read-only', async () => {
        const f = model(), Screen = f.rt.load('@/components/saved-map-screen').default;
        const r = f.rt.render(() => ({ type: Screen, props: { userId: 'a' } }), false); await r.settle();
        const canvas = () => nodes(r.output).find(n => n.type === 'MapCanvas'); assert.equal(canvas().props.restaurants.filter(p => p.coordinate).length, 6);
        const requests = f.rt.world.requests.length;
        canvas().props.onRegion({ latitude: 37.5, longitude: -122, latitudeDelta: 1, longitudeDelta: 1 }); await r.settle();
        await click(r, 'My Places'); assert.equal(canvas().props.restaurants.filter(p => p.coordinate).length, 4); assert.equal(f.rt.world.requests.length, requests);
        await click(r, 'All Saved'); const pin = canvas().props.restaurants.find(p => p.name === 'Special Noodle');
        canvas().props.onSelect(pin.key); await r.settle(); await click(r, 'Open Special Noodle in Friends');
        assert.equal(f.rt.world.navigation.at(-1).pathname, '/map/group/[id]/restaurant/[entryId]');
        canvas().props.onDismiss(); await r.settle(); assert(textOf(r.output).includes('Browse saved restaurants'));
        assert.equal(f.rt.world.intervals.size, 0); assert.equal(f.rt.world.localWrites, 0); r.unmount();
    });
    await test('Panel follows drags continuously, snaps three ways and preserves selection/filter/camera', async () => {
        const f = model(), Screen = f.rt.load('@/components/saved-map-screen').default;
        const r = f.rt.render(() => ({ type: Screen, props: { userId: 'a' } }), false); await r.settle();
        const canvas = () => nodes(r.output).find(n => n.type === 'MapCanvas');
        await click(r, 'My Places');
        const pin = canvas().props.restaurants.find(p => p.name === 'Dishdash'); canvas().props.onSelect(pin.key); await r.settle();
        const region = { latitude: 37.7, longitude: -122.3, latitudeDelta: .4, longitudeDelta: .4 };
        canvas().props.onRegion(region); await r.settle();
        const requests = f.rt.world.requests.length;
        const drag = () => nodes(r.output).find(n => n.props?.onPanResponderMove)?.props;
        const value = () => nodes(r.output).find(n => n.type === 'AnimatedView').props.style[1].transform[0].translateY;
        const panel = () => nodes(r.output).find(n => n.props?.accessibilityLabel === 'Restaurant panel');
        const g = drag(), start = value().value; g.onPanResponderGrant(); g.onPanResponderMove(null, { dy: 50 });
        assert.equal(value().value, start + 50, 'movement must be visible before release');
        g.onPanResponderRelease(null, { dy: 180, vy: .6 }); await r.settle(); assert.equal(panel().props.accessibilityValue.text, 'collapsed');
        assert(nodes(r.output).find(n => n.props?.accessibilityElementsHidden === true));
        drag().onPanResponderGrant(); drag().onPanResponderMove(null, { dy: -50 }); await r.settle();
        const revealed = nodes(r.output).find(n => n.props?.accessibilityElementsHidden === true);
        assert(revealed.props.style[1].height > 0, 'content must reveal while dragging up from collapsed');
        drag().onPanResponderTerminate(); await r.settle();
        await click(r, 'Restaurant panel'); assert.equal(panel().props.accessibilityValue.text, 'compact');
        await click(r, 'Restaurant panel'); assert.equal(panel().props.accessibilityValue.text, 'expanded');
        drag().onPanResponderGrant(); drag().onPanResponderMove(null, { dy: 120 }); drag().onPanResponderRelease(null, { dy: 120, vy: .2 }); await r.settle();
        assert.equal(panel().props.accessibilityValue.text, 'compact');
        assert.equal(canvas().props.selected, pin.key); assert.deepEqual(plain(canvas().props.initialRegion), region);
        assert.equal(canvas().props.restaurants.filter(p => p.coordinate).length, 4);
        assert.equal(f.rt.world.requests.length, requests); assert.equal(f.rt.world.localWrites, 0); r.unmount();
    });
    await test('Velocity, cancellation and accessible panel actions settle within the available stops', async () => {
        const f = model(), stops = f.rt.load('@/lib/saved-map-panel'), heights = { collapsed: 74, compact: 270, expanded: 450 };
        assert.equal(stops.nearestPanelState(180, -1, heights), 'expanded');
        assert.equal(stops.nearestPanelState(180, 1, heights), 'collapsed');
        assert.equal(stops.clampPanelOffset(-100, heights), 0); assert.equal(stops.clampPanelOffset(1000, heights), 376);
        const Screen = f.rt.load('@/components/saved-map-screen').default, r = f.rt.render(() => ({ type: Screen, props: { userId: 'a' } }), false); await r.settle();
        const panel = () => nodes(r.output).find(n => n.props?.accessibilityLabel === 'Restaurant panel');
        panel().props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); await r.settle(); assert.equal(panel().props.accessibilityValue.text, 'expanded');
        const gesture = nodes(r.output).find(n => n.props?.onPanResponderMove).props;
        gesture.onPanResponderGrant(); gesture.onPanResponderMove(null, { dy: 30 }); gesture.onPanResponderTerminate(); await r.settle();
        assert.equal(panel().props.accessibilityValue.text, 'expanded');
        panel().props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }); await r.settle(); assert.equal(panel().props.accessibilityValue.text, 'compact'); r.unmount();
    });
    await test('Existing aggregate facts stay destination-specific, omit invalid ratings and never query histories', async () => {
        const f = model(); f.override = async (call, answer) => {
            if (!call.url.pathname.endsWith('/rpc/get_saved_locations')) return answer();
            const rows = await answer().json(); return response(rows.map(row => ({ ...row, personal_rating: 4,
                total_visit_count: row.group_id === id(1) ? 2 : 7, group_average_rating: row.group_id === id(1) ? 3.5 : 99 })));
        };
        const result = await f.load(), rows = result.sources.filter(s => s.name === 'Dishdash');
        assert.deepEqual(plain(rows.find(s => s.kind === 'personal').stats), { visitCount: null, rating: 4, ratingKind: 'latest' });
        assert.deepEqual(plain(rows.find(s => s.groupId === id(1)).stats), { visitCount: 2, rating: 3.5, ratingKind: 'average' });
        assert.deepEqual(plain(rows.find(s => s.groupId === id(2)).stats), { visitCount: 7, rating: null, ratingKind: 'average' });
        const Screen = f.rt.load('@/components/saved-map-screen').default, r = f.rt.render(() => ({ type: Screen, props: { userId: 'a' } }), false); await r.settle();
        await click(r, 'Select Dishdash'); const text = textOf(r.output);
        for (const label of ['Latest rating 4/5', '2 visits · Avg rating 3.5/5', '7 visits']) assert(text.includes(label));
        assert(!text.includes('99/5')); assert(!f.rt.world.requests.some(r => /\/(personal_visits|visits)$/.test(r.url.pathname))); r.unmount();
    });
    await test('Collection totals and viewport guidance remain explicit while off-area and unmapped entries stay browsable', async () => {
        const f = model(), Screen = f.rt.load('@/components/saved-map-screen').default;
        const r = f.rt.render(() => ({ type: Screen, props: { userId: 'a' } }), false); await r.settle();
        const canvas = nodes(r.output).find(n => n.type === 'MapCanvas');
        canvas.props.onRegion({ latitude: 10, longitude: 10, latitudeDelta: .01, longitudeDelta: .01 }); await r.settle();
        const text = textOf(r.output); assert(text.includes('All Saved · 6 mapped · 3 unmapped')); assert(text.includes('0 mapped restaurants in this map area'));
        assert(text.includes('Outside this map area')); assert(text.includes('QA Manual Restaurant')); assert(text.includes('No saved coordinates')); r.unmount();
    });
    await test('Home shortcut retains the development gate and map Back follows mounted history', async () => {
        const f = model(), Shortcut = f.rt.load('@/components/saved-map-shortcut').default;
        const shortcut = f.rt.render(Shortcut, false); await shortcut.settle(); await click(shortcut, 'Open Saved Map');
        assert.equal(f.rt.world.navigation.at(-1), '/home/saved-map');
        shortcut.unmount();
        const Screen = f.rt.load('@/components/saved-map-screen').default;
        const r = f.rt.render(() => ({ type: Screen, props: { userId: 'a', origin: 'home' } }), false); await r.settle(); await click(r, 'Back');
        assert.equal(f.rt.world.navigation.at(-1), 'BACK'); r.unmount();
        for (const options of [{ platform: 'ios', development: false }, { platform: 'android', development: true }]) {
            const rt = runtime(options), hidden = rt.render(rt.load('@/components/saved-map-shortcut').default, false); await hidden.settle();
            assert(!nodes(hidden.output).some(n => n.props?.accessibilityLabel === 'Open Saved Map')); assert.equal(rt.world.requests.length, 0); hidden.unmount();
        }
    });
    await test('Legacy Home map links redirect into Home without creating cross-tab Back history', async () => {
        const rt=runtime({platform:'ios',development:true,mocks:{'@/components/saved-map-screen':{default:'SavedMapScreen'}}});
        rt.world.params={fromHome:'1'};const r=rt.render(rt.load('app/saved-map').default,false);await r.settle();
        assert(nodes(r.output).some(n=>n.type==='Redirect'&&n.props.href==='/home/saved-map'));
        assert.equal(rt.world.requests.length,0);r.unmount();
    });
    await test('The actual Home route exposes Saved Map without requiring dashboard reads', async () => {
        const rt = runtime({ platform: 'ios', development: true });
        rt.world.auth.loading = true;
        const r = rt.render(rt.load('app/index').default, false); await r.settle();
        await click(r, 'Open Saved Map');
        assert.equal(rt.world.navigation.at(-1), '/home/saved-map');
        assert.equal(rt.world.requests.length, 0); assert.equal(rt.world.localWrites, 0); r.unmount();
    });
    await test('Empty collections and unsupported builds neither invent pins nor read another source', async () => {
        const f = model(); for (const key of Object.keys(f.db)) f.db[key] = [];
        const result = await f.load(); assert.equal(result.sources.length, 0); assert.equal(result.collections.length, 0);
        assert(!f.rt.world.requests.some(r => r.url.pathname.includes('/rpc/')));
        const Screen = f.rt.load('@/components/saved-map-screen').default, r = f.rt.render(() => ({ type: Screen, props: { userId: 'a' } }), false);
        await r.settle(); assert(textOf(r.output).includes('No saved restaurants')); r.unmount();
        for (const options of [{ platform: 'ios', development: false }, { platform: 'android', development: true }]) {
            const rt = runtime({ ...options, mocks: { '@/components/saved-map-screen': { default: 'SavedMapScreen' } } }), screen = rt.render(rt.load('app/saved-map').default, false); await screen.settle();
            assert(nodes(screen.output).some(n => n.type === 'Redirect' && n.props.href === '/my-places')); assert.equal(rt.world.requests.length, 0); screen.unmount();
        }
    });
    await test('Denied location is opt-in, graceful and never changes saved framing or data', async () => {
        let requests = 0; const f = model({ mocks: { '@/modules/groupbite-mapkit-search': { getMapKitSearchModule: () => ({ requestCurrentLocation: async () => { requests++; return { status: 'denied' }; } }) } } });
        const Screen = f.rt.load('@/components/saved-map-screen').default, r = f.rt.render(() => ({ type: Screen, props: { userId: 'a' } }), false);
        await r.settle(); assert.equal(requests, 0); await click(r, 'Current location'); assert.equal(requests, 1);
        assert(textOf(r.output).includes('Location access is off')); assert.equal(f.rt.world.localWrites, 0); r.unmount();
    });
    await test('An inactive permission prompt retains its answer until foreground data is revalidated', async () => {
        const held = deferred(), focuses = [], f = model({ mocks: {
            '@/modules/groupbite-mapkit-search': { getMapKitSearchModule: () => ({ requestCurrentLocation: () => held.promise }) },
            '@/components/saved-map-canvas': { default: props => { props.ref.current = { focus: p => focuses.push(p), fit() {}, zoom() {} }; return { type: 'MapCanvas', props }; } },
        } });
        const Screen = f.rt.load('@/components/saved-map-screen').default, r = f.rt.render(() => ({ type: Screen, props: { userId: 'a' } }), false);
        await r.settle(); const before = JSON.stringify(f.db);
        await click(r, 'Current location'); f.rt.emit('inactive'); await r.settle(); assert(!nodes(r.output).some(n => n.type === 'MapCanvas'));
        held.resolve({ status: 'granted', latitude: 37.5, longitude: -122 }); await r.settle(); assert.equal(focuses.length, 0);
        f.rt.emit('active'); await r.settle(); assert.deepEqual(plain(focuses), [{ latitude: 37.5, longitude: -122 }]);
        assert.equal(nodes(r.output).find(n => n.type === 'MapCanvas').props.showUser, true); assert.equal(JSON.stringify(f.db), before); r.unmount();
    });
    await test('Reader deadlines stop stalled preflight without dispatching HTTP or retaining timers', async () => {
        const timers = new Map(); let next = 0;
        const f = model({ setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: key => timers.delete(key) });
        f.rt.supabase.auth.getSession = () => new Promise(() => {});
        const pending = f.load(); await new Promise(r => setImmediate(r)); for (const fn of [...timers.values()]) fn();
        await assert.rejects(pending); assert.equal(f.rt.world.requests.length, 0); assert.equal(timers.size, 0);
    });
    await test('Verified coordinates win, invalidated metadata stays unmapped, and co-located brands stay separate', () => {
        const { identity: m } = model();
        const rows = m.groupMapRestaurants([source(), source({ key: 'group:two', coordinate: { latitude: 37.00001, longitude: -122, quality: 'verified' } })]);
        assert.equal(rows[0].coordinate.latitude, 37.00001);
        assert.equal(m.groupMapRestaurants([source({ appleId: null }), source({ key: 'two', appleId: null, name: 'Another business' })]).length, 2);
    });
    await test('Map-origin detail Back and edit return paths preserve collection IDs', async () => {
        const f = model(), nav = f.rt.load('@/lib/restaurant-navigation'), auth = f.rt.load('@/lib/auth-navigation');
        assert.equal(nav.personalPlaceHref(id(100), 'map').pathname, '/map/personal-place/[id]');
        for (const path of ['/saved-map', `/map/personal-place/${id(100)}`, `/map/group/${id(1)}/restaurant/${id(101)}`]) assert.equal(auth.safeAuthReturnTo(path), path);
        assert.equal(auth.safeAuthReturnTo('/map/unknown'), '/');
        assert.equal(auth.authReturnTo(`/map/group/${id(1)}/restaurant/${id(101)}`, { id: id(1), entryId: id(101) }), `/map/group/${id(1)}/restaurant/${id(101)}`);
    });
    console.log(`${passed} saved map checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
