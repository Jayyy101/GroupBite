// Actual native component + form modules with virtual timers and offline HTTP.
// No Expo CLI, .env, hosted backend, provider request or installed test dependency.
const assert = require('node:assert/strict');
const { runtime, fixture, response, screen, click, enter, nodes, textOf } = require('./personal-places.cjs');

const sampleAddress = '100 Demo Market Street, San Francisco, CA 94103, USA';
const sample = { id: 'result', source: 'development-mock', address: sampleAddress, latitude: 37.7749, longitude: -122.4194 };
const groupA = '22222222-2222-2222-2222-222222222222';
const groupB = '33333333-3333-3333-3333-333333333333';
const restaurantId = '44444444-4444-4444-4444-444444444444';
let passed = 0;

function virtualClock() {
    let time = 0, sequence = 0;
    const timers = new Map();
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
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function input(r) { return nodes(r.output).find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Restaurant address'); }
function suggestions(r) { return nodes(r.output).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Use mock address:')); }
async function choose(r, index = 0) {
    const suggestion = suggestions(r)[index]; assert(suggestion, 'Missing mock suggestion');
    suggestion.props.onPress(); await r.settle();
}
async function toggleGroup(r, name) {
    const row = nodes(r.output).find(n => n.type === 'Pressable' && n.props.accessibilityRole === 'checkbox'
        && textOf(n.props.children).trim().replace(/^✓\s*/, '') === name);
    assert(row && !row.props.disabled, 'Missing enabled group ' + name);
    row.props.onPress(); await r.settle();
}
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
function setup(options = {}) {
    const clock = virtualClock();
    const rt = runtime({ development: true, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, ...options });
    if (options.enableGeoapify) rt.load('@/lib/address-search').GEOAPIFY_AUTOCOMPLETE_ENABLED = true; // Offline future-build simulation only.
    const React = rt.load('react'), { jsx } = rt.load('react/jsx-runtime');
    const { AddressAutocomplete } = rt.load('@/components/address-autocomplete');
    const control = { editable: true, active: true, resetKey: 0, ...options.props };
    const search = options.createSearch ? options.createSearch(rt) : options.search;
    function Form() {
        const [value, setValue] = React.useState(options.initial ?? '');
        const [selection, setSelection] = React.useState(null);
        control.value = value; control.selection = selection;
        control.reset = next => { setValue(next); setSelection(null); control.resetKey++; };
        return jsx(AddressAutocomplete, { value, selection, ...control, search,
            onChange: (address, selected) => { setValue(address); setSelection(selected); } });
    }
    const r = rt.render(Form);
    return { rt, r, clock, control };
}
function formRuntime(options = {}) {
    const clock = virtualClock(); let addressProps;
    const rt = runtime({ development: true, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
        observeComponent: (type, props) => { if (type.name === 'AddressAutocomplete') addressProps = props; }, ...options });
    return { rt, clock, get addressProps() { return addressProps; } };
}
function groupFetch(call) {
    if (call.url.pathname === '/rest/v1/groups') return response([
        { id: groupA, name: 'Dinner', owner_user_id: 'a' }, { id: groupB, name: 'Lunch', owner_user_id: 'a' },
    ]);
    if (call.url.pathname === '/rest/v1/restaurants') return response({ id: restaurantId, name: 'Existing Cafe', address: 'Existing Address', cuisine: 'Italian' });
    if (call.url.pathname === '/rest/v1/rpc/save_restaurant_visit') return response(restaurantId);
    assert.fail('Unexpected backend request: ' + call.url.pathname);
}
async function selectMock(r, clock) { await enter(r, 'Restaurant address', 'Demo'); await clock.advance(400, r); await choose(r); }

(async () => {
    await test('Release builds keep manual entry and never call the mock provider', async () => {
        let calls = 0;
        const { rt, r, clock, control } = setup({ development: false, search: async () => { calls++; return [sample]; } });
        await r.settle(); await enter(r, 'Restaurant address', 'Demo'); await clock.advance(2000, r);
        assert.equal(control.value, 'Demo'); assert.equal(control.selection, null); assert.equal(calls, 0);
        assert.equal(suggestions(r).length, 0); assert(!textOf(r.output).includes('Development only')); assert.equal(rt.world.requests.length, 0); r.unmount();
    });
    await test('Loaded addresses and focus do not search automatically', async () => {
        let calls = 0;
        const { r, clock } = setup({ initial: sampleAddress, search: async () => { calls++; return [sample]; } });
        await r.settle(); input(r).props.onFocus?.(); await clock.advance(2000, r);
        assert.equal(calls, 0); assert.equal(clock.size, 0); assert.equal(suggestions(r).length, 0); r.unmount();
    });
    await test('Three-character threshold and exact 400ms debounce apply to user edits', async () => {
        const queries = [];
        const { r, clock } = setup({ search: async q => { queries.push(q); return [sample]; } });
        await r.settle(); await enter(r, 'Restaurant address', ' De '); await clock.advance(1000, r);
        assert.equal(queries.length, 0);
        await enter(r, 'Restaurant address', ' Dem '); await clock.advance(399, r); assert.equal(queries.length, 0);
        await clock.advance(1, r); assert.deepEqual(queries, ['Dem']); assert.equal(suggestions(r).length, 1); r.unmount();
    });
    await test('Rapid typing restarts the debounce and shows only the latest query', async () => {
        const queries = [];
        const { r, clock } = setup({ search: async q => { queries.push(q); return [sample]; } });
        await r.settle(); await enter(r, 'Restaurant address', 'Dem'); await clock.advance(300, r);
        await enter(r, 'Restaurant address', 'Demo'); await clock.advance(399, r); assert.equal(queries.length, 0);
        await clock.advance(1, r); assert.deepEqual(queries, ['Demo']);
        // Repeated native edit events must not cancel a timer without replacing it.
        await enter(r, 'Restaurant address', 'Demo'); await clock.advance(100, r);
        await enter(r, 'Restaurant address', 'Demo'); await clock.advance(399, r); assert.equal(queries.length, 1);
        await clock.advance(1, r); assert.deepEqual(queries, ['Demo', 'Demo']); r.unmount();
    });
    await test('Mock fixtures are deterministic and both provider and UI cap suggestions at five', async () => {
        const { rt, r, clock } = setup(); await r.settle();
        const provider = rt.load('@/lib/mock-address-search').searchMockAddresses;
        const signal = new AbortController().signal;
        const a = await provider('demo', signal), b = await provider('DEMO', signal);
        assert.equal(a.length, 5); assert.deepEqual(a, b); assert.equal(a[0].address, sampleAddress);
        await enter(r, 'Restaurant address', 'Demo'); await clock.advance(400, r);
        assert.equal(suggestions(r).length, 5); assert(textOf(r.output).includes('Development only: fictional mock addresses'));
        r.unmount();
        const overflow = setup({ search: async () => Array.from({ length: 8 }, (_, i) => ({ ...sample, id: String(i) })) });
        await overflow.r.settle(); await enter(overflow.r, 'Restaurant address', 'Demo'); await overflow.clock.advance(400, overflow.r);
        assert.equal(suggestions(overflow.r).length, 5); overflow.r.unmount();
    });
    await test('Selection fills standardized mock address and keeps coordinates hidden without another search', async () => {
        let calls = 0;
        const { rt, r, clock, control } = setup({ search: async () => { calls++; return [sample]; } });
        await r.settle(); await selectMock(r, clock);
        assert.equal(input(r).props.value, sampleAddress); assert.equal(control.selection.latitude, sample.latitude);
        assert.equal(control.selection.longitude, sample.longitude); assert.equal(control.selection.source, 'development-mock');
        assert(!textOf(r.output).includes(String(sample.latitude))); assert(!textOf(r.output).includes(String(sample.longitude)));
        assert.equal(suggestions(r).length, 0); assert.equal(rt.world.keyboardDismissals, 1);
        await clock.advance(2000, r); assert.equal(calls, 1); assert.equal(rt.world.requests.length, 0); r.unmount();
    });
    await test('Every address edit clears selection and coordinates, including retyping identical text', async () => {
        const { r, clock, control } = setup(); await r.settle(); await selectMock(r, clock);
        await enter(r, 'Restaurant address', sampleAddress); assert.equal(control.selection, null);
        await enter(r, 'Restaurant address', 'My manually entered address');
        assert.equal(control.selection, null); assert.equal(control.value, 'My manually entered address'); r.unmount();
    });
    await test('Stale completions and errors are ignored even if the provider ignores abort', async () => {
        const requests = [];
        const { r, clock } = setup({ search: (q, signal) => { const task = deferred(); requests.push({ q, signal, ...task }); return task.promise; } });
        await r.settle(); await enter(r, 'Restaurant address', 'old'); await clock.advance(400, r);
        await enter(r, 'Restaurant address', 'new'); assert(requests[0].signal.aborted); await clock.advance(400, r);
        requests[1].resolve([{ ...sample, address: 'New mock address' }]); await r.settle();
        requests[0].resolve([{ ...sample, address: 'Old mock address' }]); await r.settle();
        assert(textOf(r.output).includes('New mock address')); assert(!textOf(r.output).includes('Old mock address'));
        await enter(r, 'Restaurant address', 'bad'); await clock.advance(400, r);
        await enter(r, 'Restaurant address', 'latest'); await clock.advance(400, r);
        requests[2].reject(new Error('Stale failure')); requests[3].resolve([sample]); await r.settle();
        assert(!textOf(r.output).includes('unavailable')); assert.equal(suggestions(r).length, 1); r.unmount();
    });
    await test('Blur and Done cancel pending work without searching again on focus', async () => {
        let calls = 0;
        const { r, clock } = setup({ search: async () => { calls++; return [sample]; } });
        await r.settle(); await enter(r, 'Restaurant address', 'Demo'); input(r).props.onBlur(); await r.settle();
        await clock.advance(1000, r); assert.equal(calls, 0); assert.equal(clock.size, 0);
        input(r).props.onFocus?.(); await clock.advance(1000, r); assert.equal(calls, 0);
        await enter(r, 'Restaurant address', 'Market'); input(r).props.onSubmitEditing(); await r.settle();
        await clock.advance(1000, r); assert.equal(calls, 0); r.unmount();
    });
    await test('Blur aborts an in-flight search; an obsolete row cannot change the address', async () => {
        const task = deferred(); let signal;
        const { r, clock } = setup({ search: (_, s) => { signal = s; return task.promise; } });
        await r.settle(); await enter(r, 'Restaurant address', 'Demo'); await clock.advance(400, r);
        input(r).props.onBlur(); await r.settle(); assert(signal.aborted);
        task.resolve([sample]); await r.settle(); assert.equal(suggestions(r).length, 0); r.unmount();
        const next = setup(); await next.r.settle(); await enter(next.r, 'Restaurant address', 'Demo'); await next.clock.advance(400, next.r);
        const obsolete = suggestions(next.r)[0]; await enter(next.r, 'Restaurant address', 'manual'); obsolete.props.onPress(); await next.r.settle();
        assert.equal(next.control.value, 'manual'); assert.equal(next.control.selection, null); next.r.unmount();
    });
    await test('Disable, inactivity and same-address form reset cancel searches and do not restart them', async () => {
        for (const mode of ['editable', 'active', 'reset']) {
            const task = deferred(); let signal;
            const { r, clock, control } = setup({ search: (_, s) => { signal = s; return task.promise; } });
            await r.settle(); await enter(r, 'Restaurant address', 'Demo'); await clock.advance(400, r);
            if (mode === 'reset') control.reset('Demo'); else control[mode] = false;
            r.dirty = true; await r.settle(); assert(signal.aborted);
            task.resolve([sample]); await r.settle(); assert.equal(suggestions(r).length, 0);
            control.active = true; control.editable = true; r.dirty = true; await r.settle(); await clock.advance(1000, r);
            assert.equal(suggestions(r).length, 0); assert.equal(clock.size, 0); r.unmount();
        }
    });
    await test('External address replacement and unmount discard timers and late results', async () => {
        const { rt, r, clock, control } = setup(); await r.settle(); await enter(r, 'Restaurant address', 'Demo');
        control.reset('Loaded existing address'); r.dirty = true; await r.settle(); await clock.advance(1000, r);
        assert.equal(suggestions(r).length, 0); assert.equal(clock.size, 0); r.unmount(); assert.equal(rt.world.lateUpdates, 0);
        const task = deferred(); const pending = setup({ search: () => task.promise }); await pending.r.settle();
        await enter(pending.r, 'Restaurant address', 'Demo'); await pending.clock.advance(400, pending.r);
        pending.r.unmount(); task.resolve([sample]); await pending.r.settle(); assert.equal(pending.rt.world.lateUpdates, 0);
    });
    await test('Empty results and current errors retain manual entry and recover on a new edit', async () => {
        let calls = 0;
        const { r, clock, control } = setup({ search: async () => { calls++; if (calls === 1) return []; if (calls === 2) throw new Error('Offline mock'); return [sample]; } });
        await r.settle(); await enter(r, 'Restaurant address', 'none'); await clock.advance(400, r);
        assert(textOf(r.output).includes('No mock matches')); assert(input(r).props.editable);
        await enter(r, 'Restaurant address', 'error'); await clock.advance(400, r); assert(textOf(r.output).includes('unavailable'));
        assert.equal(control.value, 'error'); assert.equal(control.selection, null);
        await enter(r, 'Restaurant address', 'Demo'); await clock.advance(400, r); assert.equal(suggestions(r).length, 1); r.unmount();
    });
    await test('Native controls expose labels, large suggestion targets and keyboard-safe scroll containers', async () => {
        const { r, clock } = setup(); await r.settle(); await enter(r, 'Restaurant address', 'Demo'); await clock.advance(400, r);
        assert(input(r).props.accessibilityHint.includes('manually')); assert.equal(input(r).props.returnKeyType, 'done');
        assert.equal(input(r).props.maxLength, 300); assert.equal(input(r).props.autoCorrect, false);
        for (const row of suggestions(r)) { assert.equal(row.props.accessibilityRole, 'button'); assert(row.props.style.minHeight >= 48); }
        r.unmount();
        const f = formRuntime(), form = screen(f.rt, 'personal-place-form'); await form.settle();
        const scroll = nodes(form.output).find(n => n.type === 'ScrollView');
        assert.equal(scroll.props.keyboardShouldPersistTaps, 'handled'); assert.equal(scroll.props.automaticallyAdjustKeyboardInsets, true); form.unmount();
    });
    await test('Personal create stores selection only in form state and sends the original memory payload', async () => {
        const f = formRuntime(), r = screen(f.rt, 'personal-place-form'); await r.settle();
        await enter(r, 'Restaurant name', 'Mock UI Cafe'); await selectMock(r, f.clock);
        assert.equal(f.addressProps.selection.latitude, sample.latitude);
        await enter(r, 'Personal notes', 'Keep my notes'); await click(r, '4'); await click(r, 'No');
        assert.equal(f.addressProps.selection.longitude, sample.longitude);
        await click(r, 'Save Personal Place');
        const body = f.rt.world.requests.find(c => c.method === 'POST').body;
        assert.deepEqual(Object.keys(body).sort(), ['address','client_request_id','cuisine','name','notes','rating','visited_on','would_go_again']);
        assert.equal(body.address, sampleAddress); assert.equal(body.rating, 4); assert.equal(body.notes, 'Keep my notes'); assert.equal(body.would_go_again, false);
        assert.equal(f.rt.world.navigation.at(-1).pathname, '/personal-place/[id]'); assert.equal(f.rt.world.localWrites, 0); r.unmount();
    });
    await test('Personal edits load silently, clear edited selections and preserve revision-based saving', async () => {
        const f = formRuntime(); const place = fixture(); f.rt.world.rows = [place]; f.rt.world.params = { id: place.id };
        const r = screen(f.rt, 'personal-place-form'); await r.settle(); await f.clock.advance(2000, r);
        assert.equal(suggestions(r).length, 0); assert.equal(f.addressProps.selection, null);
        await selectMock(r, f.clock); await enter(r, 'Restaurant address', 'Manual replacement address'); assert.equal(f.addressProps.selection, null);
        await click(r, 'Save Changes');
        const patch = f.rt.world.requests.find(c => c.method === 'PATCH'); assert.equal(patch.url.searchParams.get('revision'), 'eq.1');
        assert.equal(patch.body.address, 'Manual replacement address'); assert.equal(patch.body.notes, place.notes); assert(!('latitude' in patch.body)); r.unmount();
    });
    await test('Add Visit retains multi-group choices, ratings, notes and the unchanged save RPC', async () => {
        const f = formRuntime({ fetch: groupFetch }), r = screen(f.rt, 'add-visit'); await r.settle();
        await enter(r, 'Restaurant name', 'Mock UI Cafe'); await selectMock(r, f.clock);
        await toggleGroup(r, 'Dinner'); await toggleGroup(r, 'Lunch'); await click(r, '5'); await click(r, 'No'); await enter(r, 'Visit notes', 'Keep group notes');
        assert.equal(f.addressProps.selection.latitude, sample.latitude);
        await click(r, 'Save Visit');
        const calls = f.rt.world.requests.filter(c => c.method === 'POST'); assert.equal(calls.length, 1);
        assert.equal(calls[0].url.pathname, '/rest/v1/rpc/save_restaurant_visit');
        assert.deepEqual(Object.keys(calls[0].body).sort(), ['client_request_id','restaurant_address','restaurant_cuisine','restaurant_name','target_group_ids','visit_date','visit_notes','visit_rating','visit_would_go_again']);
        assert.deepEqual(calls[0].body.target_group_ids, [groupA,groupB]); assert.equal(calls[0].body.restaurant_address, sampleAddress);
        assert.equal(calls[0].body.visit_rating, 5); assert.equal(calls[0].body.visit_notes, 'Keep group notes'); assert.equal(calls[0].body.visit_would_go_again, false);
        assert.equal(f.rt.world.navigation.at(-1), '/groups'); assert.equal(f.rt.world.localWrites, 0); r.unmount();
    });
    await test('Existing shared Restaurant facts remain locked without any autocomplete or lookup', async () => {
        const f = formRuntime({ fetch: groupFetch }); f.rt.world.params = { groupId: groupA, restaurantId };
        const r = screen(f.rt, 'add-visit'); await r.settle(); await f.clock.advance(2000, r);
        assert.equal(input(r).props.value, 'Existing Address'); assert.equal(input(r).props.editable, false);
        assert.equal(f.addressProps, undefined); assert.equal(suggestions(r).length, 0); assert.equal(f.clock.size, 0);
        assert(!textOf(r.output).includes('fictional mock')); await click(r, 'Save Visit');
        assert.equal(f.rt.world.requests.find(c => c.method === 'POST').body.restaurant_address, 'Existing Address'); r.unmount();
    });
    await test('Account changes clear both forms, selections and pending searches', async () => {
        for (const name of ['personal-place-form', 'add-visit']) {
            const f = formRuntime(name === 'add-visit' ? { fetch: groupFetch } : {}), r = screen(f.rt, name); await r.settle();
            await selectMock(r, f.clock); assert(f.addressProps.selection);
            f.rt.switch('b', r); await r.settle(); assert.equal(input(r).props.value, ''); assert.equal(f.addressProps.selection, null);
            await enter(r, 'Restaurant address', 'Demo'); assert.equal(f.clock.size, 1);
            f.rt.switch('c', r); await r.settle(); await f.clock.advance(2000, r);
            assert.equal(suggestions(r).length, 0); assert.equal(f.clock.size, 0); assert.equal(f.rt.world.lateUpdates, 0); r.unmount();
        }
    });
    await test('Account switches and sign-out abort in-flight form searches without late updates', async () => {
        for (const name of ['personal-place-form', 'add-visit']) for (const nextAccount of ['b', null]) {
            const f = formRuntime(name === 'add-visit' ? { fetch: groupFetch } : {});
            const task = deferred(); let signal;
            f.rt.load('@/lib/mock-address-search').searchMockAddresses = (_, s) => { signal = s; return task.promise; };
            const r = screen(f.rt, name); await r.settle();
            await enter(r, 'Restaurant address', 'Demo'); await f.clock.advance(400, r);
            f.rt.switch(nextAccount, r); await r.settle(); assert(signal.aborted);
            task.resolve([sample]); await r.settle(); assert.equal(suggestions(r).length, 0); assert.equal(f.rt.world.lateUpdates, 0);
            if (nextAccount) { assert.equal(input(r).props.value, ''); assert.equal(f.addressProps.selection, null); }
            else assert(textOf(r.output).includes('Sign In / Sign Up'));
            r.unmount();
        }
    });
    await test('Blur and background clear selection; create and Visit text survive without automatic lookup', async () => {
        for (const name of ['personal-place-form', 'add-visit']) for (const mode of ['blur', 'background']) {
            const f = formRuntime(name === 'add-visit' ? { fetch: groupFetch } : {}), r = screen(f.rt, name); await r.settle();
            await selectMock(r, f.clock);
            if (mode === 'blur') { f.rt.world.focused = false; r.dirty = true; } else f.rt.emit('background');
            await r.settle(); assert.equal(suggestions(r).length, 0); assert.equal(f.clock.size, 0);
            if (mode === 'blur') { f.rt.world.focused = true; r.dirty = true; } else f.rt.emit('active');
            await r.settle(); await f.clock.advance(2000, r);
            assert.equal(f.addressProps.selection, null); assert.equal(suggestions(r).length, 0);
            assert.equal(input(r).props.value, sampleAddress); r.unmount();
        }
    });
    await test('Personal create background cancels debounce while retaining manual text without restarting search', async () => {
        const f = formRuntime(), r = screen(f.rt, 'personal-place-form'); await r.settle();
        await enter(r, 'Restaurant name', 'Draft Cafe'); await enter(r, 'Restaurant address', 'Demo'); assert.equal(f.clock.size, 1);
        f.rt.emit('inactive'); await r.settle(); assert.equal(r.output, null); assert.equal(f.clock.size, 0);
        f.rt.emit('background'); await r.settle(); f.rt.emit('active'); await r.settle(); await f.clock.advance(5000, r);
        assert.equal(input(r).props.value, 'Demo'); assert.equal(f.addressProps.selection, null); assert.equal(suggestions(r).length, 0);
        assert.equal(nodes(r.output).find(n => n.props?.accessibilityLabel === 'Restaurant name').props.value, 'Draft Cafe');
        assert.equal(f.rt.world.requests.length, 0); assert.equal(f.rt.world.lateUpdates, 0); r.unmount();
    });
    await test('Personal create background aborts in-flight autocomplete and ignores late results after remount', async () => {
        const f = formRuntime(), task = deferred(); let signal, calls = 0;
        f.rt.load('@/lib/mock-address-search').searchMockAddresses = (_, s) => { signal = s; calls++; return task.promise; };
        const r = screen(f.rt, 'personal-place-form'); await r.settle(); await enter(r, 'Restaurant address', 'Demo'); await f.clock.advance(400, r);
        f.rt.emit('background'); await r.settle(); assert(signal.aborted); f.rt.emit('active'); await r.settle();
        task.resolve([sample]); await r.settle(); await f.clock.advance(5000, r);
        assert.equal(input(r).props.value, 'Demo'); assert.equal(suggestions(r).length, 0); assert.equal(f.addressProps.selection, null);
        assert.equal(calls, 1); assert.equal(f.rt.world.lateUpdates, 0); assert.equal(f.rt.world.requests.length, 0); r.unmount();
    });
    await test('Refresh Groups clears autocomplete state while preserving address, notes and chosen groups', async () => {
        const f = formRuntime({ fetch: groupFetch }), r = screen(f.rt, 'add-visit'); await r.settle();
        await selectMock(r, f.clock); await toggleGroup(r, 'Dinner'); await enter(r, 'Visit notes', 'Draft notes');
        await click(r, 'Refresh Groups'); assert.equal(f.addressProps.selection, null); assert.equal(input(r).props.value, sampleAddress);
        assert(textOf(r.output).includes('✓  Dinner')); assert.equal(nodes(r.output).find(n => n.props?.accessibilityLabel === 'Visit notes').props.value, 'Draft notes');
        await f.clock.advance(2000, r); assert.equal(suggestions(r).length, 0); r.unmount();
    });
    await test('Real-mode props cannot enable network searches in the checked-in build', async () => {
        for (const development of [true, false]) {
            let calls = 0;
            const f = setup({ development, props: { mode: 'geoapify' }, search: async () => { calls++; return []; } });
            await f.r.settle(); await enter(f.r, 'Restaurant address', '100 Market'); await f.clock.advance(2000, f.r);
            assert.equal(calls, 0); assert.equal(f.control.value, '100 Market'); assert.equal(f.control.selection, null);
            assert.equal(f.rt.world.requests.length, 0); f.r.unmount();
        }
    });
    const realSuggestion = () => ({ ...sample, source: 'geoapify', accuracy: 'building', countryCode: 'us',
        selectionReceipt: 'opaque_payload.' + 'a'.repeat(43), expiresAt: new Date(Date.now() + 600000).toISOString() });
    const realRows = r => nodes(r.output).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Use address:'));
    await test('Prepared native real mode uses the authenticated adapter, preserves selection proof and shows safe attribution links', async () => {
        const item = realSuggestion(), calls = [];
        const f = setup({ development: false, enableGeoapify: true, props: { mode: 'geoapify' }, createSearch: rt =>
            rt.load('@/lib/geoapify-address-search').createGeoapifyAddressSearch({
                supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_test',
                getSession: () => ({ access_token: 'aaa.e30.signature', user: { id: '11111111-1111-1111-1111-111111111111' } }),
                fetch: async (url, init) => { calls.push({ url, init }); return response({ suggestions: [item], attribution: rt.load('@/lib/address-search').GEOAPIFY_ATTRIBUTION }); },
            }) });
        await f.r.settle(); await enter(f.r, 'Restaurant address', '100 Market'); await f.clock.advance(399, f.r); assert.equal(calls.length, 0);
        await f.clock.advance(1, f.r); assert.equal(calls.length, 1); assert.equal(realRows(f.r).length, 1);
        assert(textOf(f.r.output).includes('Powered by Geoapify')); assert(textOf(f.r.output).includes('© OpenStreetMap contributors'));
        for (const link of nodes(f.r.output).filter(n => n.props?.accessibilityRole === 'link')) { link.props.onPress(); }
        await f.r.settle(); assert.deepEqual(f.rt.world.links, ['https://www.geoapify.com/', 'https://www.openstreetmap.org/copyright']);
        realRows(f.r)[0].props.onPress(); await f.r.settle();
        assert.equal(f.control.selection.selectionReceipt, item.selectionReceipt); assert.equal(f.control.selection.expiresAt, item.expiresAt);
        assert.equal(f.control.selection.latitude, item.latitude); assert.equal(f.control.selection.longitude, item.longitude);
        assert(!textOf(f.r.output).includes(item.selectionReceipt)); assert(!textOf(f.r.output).includes(String(item.latitude)));
        f.control.editable = false; f.r.dirty = true; await f.r.settle(); assert(textOf(f.r.output).includes('Powered by Geoapify'));
        f.control.editable = true; f.r.dirty = true; await f.r.settle();
        await enter(f.r, 'Restaurant address', item.address); assert.equal(f.control.selection, null);
        f.r.unmount(); assert.equal(calls.length, 1);
    });
    await test('Prepared real errors and rate limits preserve manual entry without exposing exception details', async () => {
        for (const [kind, hint] of [['authentication', 'Sign in again'], ['access_denied', 'not available for this account'],
            ['rate_limited', 'Wait 7 seconds'], ['timeout', 'unavailable']]) {
            const f = setup({ enableGeoapify: true, props: { mode: 'geoapify' }, createSearch: rt => async () => {
                throw new (rt.load('@/lib/address-search').AddressSearchError)(kind, kind === 'rate_limited' ? 7 : undefined);
            } });
            await f.r.settle(); await enter(f.r, 'Restaurant address', '100 Market'); await f.clock.advance(400, f.r);
            assert(textOf(f.r.output).includes(hint)); assert(input(f.r).props.editable); assert.equal(f.control.value, '100 Market');
            assert.equal(f.control.selection, null); f.r.unmount();
        }
    });
    await test('Prepared real mode shows attribution for empty results and rejects expired selections', async () => {
        const empty = setup({ enableGeoapify: true, props: { mode: 'geoapify' }, search: async () => [] });
        await empty.r.settle(); await enter(empty.r, 'Restaurant address', '100 Market'); await empty.clock.advance(400, empty.r);
        assert(textOf(empty.r.output).includes('No address matches')); assert(textOf(empty.r.output).includes('Powered by Geoapify')); empty.r.unmount();
        const expired = setup({ enableGeoapify: true, props: { mode: 'geoapify' }, search: async () => [{ ...realSuggestion(), expiresAt: new Date(0).toISOString() }] });
        await expired.r.settle(); await enter(expired.r, 'Restaurant address', '100 Market'); await expired.clock.advance(400, expired.r);
        realRows(expired.r)[0].props.onPress(); await expired.r.settle(); assert.equal(expired.control.selection, null);
        assert.equal(expired.control.value, '100 Market'); assert(textOf(expired.r.output).includes('expired')); expired.r.unmount();
    });
    await test('Prepared real mode still aborts and ignores stale responses after edits, blur or mode changes', async () => {
        const tasks = [], f = setup({ enableGeoapify: true, props: { mode: 'geoapify' }, search: (_, signal) => {
            const task = deferred(); tasks.push({ signal, ...task }); return task.promise;
        } });
        await f.r.settle(); await enter(f.r, 'Restaurant address', 'Old'); await f.clock.advance(400, f.r);
        await enter(f.r, 'Restaurant address', 'New'); assert(tasks[0].signal.aborted); await f.clock.advance(400, f.r);
        tasks[1].resolve([realSuggestion()]); await f.r.settle(); tasks[0].resolve([{ ...realSuggestion(), address: 'Stale result' }]); await f.r.settle();
        assert(!textOf(f.r.output).includes('Stale result')); input(f.r).props.onBlur(); await f.r.settle(); assert.equal(realRows(f.r).length, 0);
        await enter(f.r, 'Restaurant address', 'Next'); await f.clock.advance(400, f.r);
        f.control.mode = 'mock'; f.r.dirty = true; await f.r.settle(); assert(tasks[2].signal.aborted);
        tasks[2].resolve([realSuggestion()]); await f.r.settle(); assert.equal(realRows(f.r).length, 0); f.r.unmount();
    });
    await test('Future real selections remain transient and never change personal or Visit save payloads', async () => {
        for (const name of ['personal-place-form', 'add-visit']) {
            const item = realSuggestion(); let selectedProps;
            const f = formRuntime({ ...(name === 'add-visit' ? { fetch: groupFetch } : {}), observeComponent: (type, props) => {
                if (type.name === 'AddressAutocomplete') {
                    selectedProps = props; props.mode = 'geoapify'; props.search = stableSearch;
                }
            } });
            const stableSearch = async () => [item];
            f.rt.load('@/lib/address-search').GEOAPIFY_AUTOCOMPLETE_ENABLED = true; // Isolated future wiring simulation.
            const r = screen(f.rt, name); await r.settle(); await enter(r, 'Restaurant name', 'Real Cafe');
            await enter(r, 'Restaurant address', '100 Market'); await f.clock.advance(400, r); realRows(r)[0].props.onPress(); await r.settle();
            assert.equal(selectedProps.selection.selectionReceipt, item.selectionReceipt);
            if (name === 'add-visit') await toggleGroup(r, 'Dinner');
            await click(r, name === 'add-visit' ? 'Save Visit' : 'Save Personal Place');
            const save = f.rt.world.requests.find(call => call.method === 'POST'); assert(save);
            assert(!JSON.stringify(save.body).includes(item.selectionReceipt)); assert(!JSON.stringify(save.body).includes(String(item.latitude)));
            assert(!Object.keys(save.body).some(key => /receipt|coordinate|latitude|longitude/.test(key)));
            assert(!f.rt.world.requests.some(call => call.url.pathname.includes('attach_verified'))); r.unmount();
        }
    });
    console.log(passed + ' offline address autocomplete component/form checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
