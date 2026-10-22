// Actual RPC client, access wrapper, screen and iOS map with offline Fetch.
// No dotenv, native SDK launch, hosted backend, geocoding or location permissions.
const assert = require('node:assert/strict');
const { runtime, response, screen, click, nodes, textOf } = require('./personal-places.cjs');
const id = '11111111-1111-1111-1111-111111111111';
let passed = 0;
function saved(overrides = {}) {
    return { saved_kind: 'personal', saved_id: id, restaurant_id: null, group_id: null, group_name: null,
        name: 'Private Chipotle', address: 'Synthetic standardized address', cuisine: null,
        latitude: 37.5555437394246, longitude: -121.982959052141, resolution_status: 'resolved',
        standardized_address: 'Synthetic standardized address', resolution_accuracy: 'building', distance_meters: null,
        personal_rating: null, group_average_rating: null, rated_visit_count: null, total_visit_count: null, ...overrides };
}
function unresolved(overrides = {}) {
    return saved({ latitude: null, longitude: null, resolution_status: 'unresolved', standardized_address: null,
        resolution_accuracy: null, ...overrides });
}
function selected(overrides = {}) {
    return {id,owner_user_id:'a',name:'Selected native restaurant',address:'50 Fixture Ranch Dr',latitude:37.55,longitude:-122.12,...overrides};
}
function setup(options = {}) {
    let rows = options.rows ?? [saved()], failure = false;
    const rt = runtime({ platform: 'ios', development: true,
        mocks: { 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
            'react-native-maps': { default: 'MapView', Marker: 'Marker', PROVIDER_DEFAULT: 'default' } }, ...options,
        fetch: async call => {
            if(call.url.pathname === '/rest/v1/rpc/get_personal_mapkit_locations') {
                assert.equal(call.method,'POST'); assert.equal(call.user,'a');
                assert.deepEqual(Object.keys(call.body).sort(),['page_offset','page_size']);
                return options.pointReply ? options.pointReply(call,rt) : response(options.points ?? []);
            }
            assert.equal(call.url.pathname, '/rest/v1/rpc/get_saved_locations', 'Only the read-only personal RPC is permitted');
            assert.equal(call.method, 'POST'); assert.equal(call.user, 'a');
            assert.deepEqual(Object.keys(call.body).sort(), ['page_offset', 'page_size', 'scope', 'target_group_id']);
            assert.equal(call.body.scope, 'personal'); assert.equal(call.body.target_group_id, null);
            assert.equal(call.body.page_size, 200); assert.equal(call.body.page_offset % 200, 0);
            if (options.reply) return options.reply(call, rt);
            if (failure) return response({ code: '42501', message: 'private raw backend error' }, 403);
            return response(rows.slice(call.body.page_offset, call.body.page_offset + call.body.page_size));
        } });
    return { rt, rows(value) { rows = value; }, fail() { failure = true; }, load: signal =>
        rt.load('@/lib/personal-map').listPersonalMapPins('a', signal ?? new AbortController().signal) };
}
function markers(r) { return nodes(r.output).filter(node => node.type === 'Marker'); }
function map(r) { return nodes(r.output).find(node => node.type === 'MapView'); }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function failure(fn, rt) {
    let error;
    try { await fn(); } catch (caught) { error = caught; }
    assert(error, 'Expected failure');
    const message = rt.load('@/lib/personal-map').personalMapErrorMessage(error);
    assert(!message.includes('private raw')); assert(!message.includes('fake-')); return message;
}
(async () => {
    await test('Owner-pinned personal RPC returns only validated resolved pins and does not persist anything', async () => {
        const f = setup({ rows: [saved(), unresolved({ saved_id: '22222222-2222-2222-2222-222222222222' })] });
        const pins = await f.load(); assert.equal(pins.length, 1);
        assert.deepEqual(JSON.parse(JSON.stringify(pins[0])), { id, name: saved().name, address: saved().address,
            latitude: saved().latitude, longitude: saved().longitude });
        assert.equal(f.rt.world.requests.length, 2); assert.equal(f.rt.world.localWrites, 0);
    });
    await test('Missing or mismatched sessions and pre-cancelled reads never dispatch the RPC', async () => {
        for (const user of [null, 'b']) {
            const f = setup(); f.rt.switch(user);
            assert((await failure(() => f.load(), f.rt)).includes('account changed'));
            assert.equal(f.rt.world.requests.length, 0);
        }
        const f = setup(), parent = new AbortController(); parent.abort();
        await failure(() => f.load(parent.signal), f.rt); assert.equal(f.rt.world.requests.length, 0);
    });
    await test('Account changes during a pinned request reject the old result', async () => {
        const held = deferred(), f = setup({ reply: () => held.promise });
        const pending = f.load(); await new Promise(resolve => setImmediate(resolve));
        f.rt.switch('b'); held.resolve(response([saved()]));
        assert((await failure(() => pending, f.rt)).includes('account changed'));
        assert.equal(f.rt.world.requests[0].headers.get('Authorization'), 'Bearer fake-a');
    });
    await test('Pagination includes unresolved rows and reads later resolved pins without retries', async () => {
        const rows = Array.from({ length: 200 }, (_, index) => unresolved({ saved_id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}` }));
        rows.push(saved()); const f = setup({ rows }); const pins = await f.load();
        assert.equal(pins.length, 1); assert.deepEqual(f.rt.world.requests.map(call => call.body.page_offset), [0, 200, 0]);
    });
    await test('Foreign scope rows, invalid geometry, duplicate IDs and malformed responses fail closed', async () => {
        for (const rows of [[saved({ saved_kind: 'group' })], [saved({ group_id: id })], [saved({ restaurant_id: id })],
            [saved({ saved_id: 'bad' })], [saved({ latitude: '37.5' })], [saved({ longitude: 181 })],
            [saved({ latitude: null })], [saved({ latitude: NaN })], [saved({ resolution_accuracy: 'country' })],
            [saved({ name: '' })], [saved({ standardized_address: null })], [unresolved({ latitude: 1 })],
            [saved(), saved()], null, { data: [] }]) {
            const f = setup({ reply: () => response(rows) }); await failure(() => f.load(), f.rt);
            assert.equal(f.rt.world.requests.length, 1);
        }
    });
    await test('RPC errors are sanitized, never retried, and never fall back to shared tables or geocoding', async () => {
        const f = setup(); f.fail(); await failure(() => f.load(), f.rt);
        assert.equal(f.rt.world.requests.length, 1); assert.equal(f.rt.world.localWrites, 0);
    });
    await test('Total load deadline aborts an in-flight RPC and clears timers without retry', async () => {
        let timer, count = 0;
        const f = setup({ setTimeout(fn, ms) { assert.equal(ms, 10000); timer = fn; count++; return 1; },
            clearTimeout() { count--; }, reply(call) { return new Promise((_, reject) => {
                // The installed client passes the adapter signal to Fetch.
                f.rt.world.requestSignal.addEventListener('abort', () => reject(new Error('private raw timeout')), { once: true });
            }); } });
        // Wrap only the offline Fetch boundary to observe its signal.
        const original = f.rt.supabase.rest.fetch;
        f.rt.supabase.rest.fetch = (input, init) => { f.rt.world.requestSignal = init.signal; return original(input, init); };
        const pending = f.load(); await new Promise(resolve => setImmediate(resolve));
        timer(); await failure(() => pending, f.rt);
        assert(f.rt.world.requestSignal.aborted); assert.equal(count, 0); assert.equal(f.rt.world.requests.length, 1);
    });
    await test('iOS map replaces samples with personal callouts and preserves pan, zoom and fit controls without location permission', async () => {
        const f = setup(), r = screen(f.rt, 'dev-map'); r.draw(); assert(textOf(r.output).includes('Loading your map'));
        await r.settle(); const pins = markers(r); assert.equal(pins.length, 1);
        assert.equal(pins[0].props.title, saved().name); assert.equal(pins[0].props.description, saved().address);
        assert.equal(pins[0].props.coordinate.latitude, saved().latitude);
        const native = map(r); assert(native.props.scrollEnabled && native.props.zoomEnabled);
        assert.equal(native.props.provider, 'default'); assert.equal(native.props.showsUserLocation, false);
        assert.equal(native.props.showsMyLocationButton, false); assert.equal(native.props.initialRegion.latitude, saved().latitude);
        let fit; native.props.ref.current = { fitToCoordinates(coordinates, options) { fit = { coordinates, options }; } };
        native.props.onMapReady(); assert.equal(fit.coordinates.length, 1); assert.equal(fit.options.animated, false);
        assert(!JSON.stringify(r.output).includes('Ferry Building')); r.unmount();
    });
    await test('Empty and failed refresh states remove stale markers, with Back and explicit Refresh Map', async () => {
        const f = setup(), r = screen(f.rt, 'dev-map'); await r.settle(); assert.equal(markers(r).length, 1);
        f.rows([unresolved()]); await click(r, 'Refresh Map'); assert.equal(markers(r).length, 0);
        assert(textOf(r.output).includes('No resolved personal Places')); f.rows([saved()]); await click(r, 'Refresh Map');
        assert.equal(markers(r).length, 1); f.fail(); await click(r, 'Refresh Map');
        assert.equal(markers(r).length, 0); assert(textOf(r.output).includes('Could not load your map'));
        assert(!textOf(r.output).includes('private raw')); await click(r, 'Back');
        assert.equal(f.rt.world.navigation.at(-1), 'BACK'); r.unmount();
    });
    await test('Sign-out, account switch, blur and background unmount private markers; late results cannot restore them', async () => {
        for (const action of ['signout', 'switch', 'blur', 'background']) {
            const held = deferred(), f = setup({ reply: () => held.promise }), r = screen(f.rt, 'dev-map'); await r.settle();
            if (action === 'signout') f.rt.switch(null, r);
            if (action === 'switch') f.rt.switch('b', r);
            if (action === 'blur') { f.rt.world.focused = false; r.dirty = true; }
            if (action === 'background') f.rt.emit('background');
            // For the switch case the new account's RPC must never publish A's data.
            if (action === 'switch') f.rt.supabase.auth.getSession = async () => ({ data: { session: null }, error: null });
            await r.settle(); held.resolve(response([saved()])); await r.settle();
            assert.equal(markers(r).length, 0); assert.equal(f.rt.world.lateUpdates, 0); r.unmount();
        }
        const f = setup(), r = screen(f.rt, 'dev-map'); await r.settle(); assert.equal(markers(r).length, 1);
        f.rt.emit('background'); await r.settle(); assert.equal(markers(r).length, 0);
        f.rt.emit('active'); await r.settle(); assert.equal(markers(r).length, 1); r.unmount();
    });
    await test('My Places exposes the map only in iOS development; releases redirect without data reads', async () => {
        for (const [development, platform, visible] of [[true, 'ios', true], [false, 'ios', false], [true, 'android', false]]) {
            const rt = runtime({ development, platform }), r = screen(rt, 'my-places'); await r.settle();
            assert.equal(textOf(r.output).includes('View Saved Map'), visible);
            if (visible) { await click(r, 'View Saved Map'); assert.equal(rt.world.navigation.at(-1), '/saved-map'); }
            r.unmount();
        }
        const f = setup({ development: false }), r = screen(f.rt, 'dev-map'); await r.settle();
        assert(nodes(r.output).some(n => n.type === 'Redirect' && n.props.href === '/'));
        assert.equal(f.rt.world.requests.length, 0); r.unmount();
        const other = setup({ platform: 'android' }), fallback = screen(other.rt, 'dev-map'); await fallback.settle();
        assert(textOf(fallback.output).includes('available only on iOS')); assert.equal(other.rt.world.requests.length, 0); fallback.unmount();
    });
    await test('A native selected point maps without provider ID, verified-location linkage or invented accuracy',async()=>{
        const f=setup({rows:[unresolved()],points:[selected()]});const pins=await f.load();assert.equal(pins.length,1);
        assert.equal(pins[0].latitude,37.55);assert.equal(pins[0].address,'50 Fixture Ranch Dr');assert.equal(f.rt.world.localWrites,0);
    });
    await test('Existing verified pin wins over a selected native point for the same personal card',async()=>{
        const f=setup({points:[selected()]});const pins=await f.load();assert.equal(pins.length,1);assert.equal(pins[0].latitude,saved().latitude);
    });
    await test('Foreign, duplicated, malformed and invalid native points fail closed instead of leaking or guessing',async()=>{
        for(const points of [[selected({owner_user_id:'b'})],[selected(),selected()],[selected({id:'bad'})],[selected({name:''})],
            [selected({address:''})],[selected({latitude:'37'})],[selected({latitude:91})],[selected({longitude:NaN})],[selected({latitude:0,longitude:0})],null]){
            const f=setup({pointReply:()=>response(points)});await failure(()=>f.load(),f.rt);assert.equal(f.rt.world.requests.length,2);
        }
    });
    await test('Native points page independently and every read remains account pinned',async()=>{
        const points=Array.from({length:201},(_,i)=>selected({id:`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`}));
        const f=setup({rows:[],pointReply:call=>response(points.slice(call.body.page_offset,call.body.page_offset+call.body.page_size))});
        const pins=await f.load();assert.equal(pins.length,201);
        assert.deepEqual(f.rt.world.requests.filter(c=>c.url.pathname.endsWith('/get_personal_mapkit_locations')).map(c=>c.body.page_offset),[0,200]);
        assert(f.rt.world.requests.every(c=>c.headers.get('Authorization')==='Bearer fake-a'));
    });
    await test('Missing native-point backend gives an explicit update message, never a false empty map',async()=>{
        const f=setup({rows:[],pointReply:()=>response({code:'PGRST202'},404)});
        assert((await failure(()=>f.load(),f.rt)).includes('pending backend update'));assert.equal(f.rt.world.requests.length,2);
    });
    await test('Account switches during native-point reads reject the old result',async()=>{
        const gate=deferred(),f=setup({rows:[],pointReply:()=>gate.promise}),pending=f.load();
        await new Promise(r=>setImmediate(r));f.rt.switch('b');gate.resolve(response([selected()]));
        assert((await failure(()=>pending,f.rt)).includes('account changed'));assert.equal(f.rt.world.requests.length,2);
    });
    await test('The same total deadline cancels native-point pagination, without a second timer or retry',async()=>{
        let timer,timers=0;
        const f=setup({setTimeout(fn,ms){assert.equal(ms,10000);timer=fn;timers++;return 1;},clearTimeout(){timers--;},pointReply:()=>
            new Promise((_,reject)=>f.rt.world.requestSignal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});
        const fetch=f.rt.supabase.rest.fetch;f.rt.supabase.rest.fetch=(input,init)=>{f.rt.world.requestSignal=init.signal;return fetch(input,init);};
        const pending=f.load();await new Promise(r=>setImmediate(r));timer();await failure(()=>pending,f.rt);
        assert(f.rt.world.requestSignal.aborted);assert.equal(timers,0);assert.equal(f.rt.world.requests.length,2);
    });
    await test('Backgrounding removes native pins and blocks late private-point responses',async()=>{
        const gate=deferred(),f=setup({rows:[],pointReply:()=>gate.promise}),r=screen(f.rt,'dev-map');await r.settle();
        f.rt.emit('background');await r.settle();gate.resolve(response([selected()]));await r.settle();assert.equal(markers(r).length,0);assert.equal(f.rt.world.lateUpdates,0);r.unmount();
    });
    console.log(`${passed} offline personal-map checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
