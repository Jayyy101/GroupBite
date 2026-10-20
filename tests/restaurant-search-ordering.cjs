// Actual Add landing/search/adapter with deterministic timers and native replies.
// All HTTP, storage and MapKit boundaries are offline; no .env or hosted calls.
const assert = require('node:assert/strict');
const { click, enter, button, nodes, textOf } = require('./personal-places.cjs');
const { model } = require('./unified-add.cjs');

function defer() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function clock() {
    let now = 0, sequence = 0;
    const timers = new Map();
    return {
        setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        async advance(ms, r) {
            const end = now + ms;
            while (true) {
                const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
                if (!next || next[1].at > end) break;
                now = next[1].at; timers.delete(next[0]); next[1].fn(); await r.settle();
            }
            now = end; await r.settle();
        },
    };
}
function location(name = 'McDonalds', address = '100 Main Street, Test City') {
    return { id: '1:0', name, address, placeId: 'Opaque:Apple/' + name,
        latitude: 37.123456789, longitude: -121.987654321, kind: 'business', source: 'apple-maps-preview' };
}
function setup() {
    const time = clock(), calls = [], cancellations = [];
    const request = action => (...args) => {
        const pending = defer(); calls.push({ action, args, ...pending }); return pending.promise;
    };
    const native = { isAvailable: () => true, complete: request('complete'), search: request('search'), resolve: request('resolve'),
        reset: async () => {}, cancel: async id => { cancellations.push(id); } };
    const f = model({ platform: 'ios', development: true, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
        mocks: { expo: { requireOptionalNativeModule: () => native } } });
    let route = 'app/add', selected;
    const r = f.rt.render(() => {
        selected = f.rt.load('@/providers/unified-add').useUnifiedAdd().state.restaurant;
        return { type: f.rt.load(route).default, props: {} };
    });
    return { ...f, r, time, calls, cancellations, selected: () => selected,
        async form() { route = 'app/add-visit'; r.dirty = true; await r.settle(); } };
}
async function type(f, query = 'McDonalds') {
    await enter(f.r, 'Search restaurants', query); await f.time.advance(400, f.r);
    return f.calls.at(-1);
}
async function suggestions(f) {
    const completion = await type(f);
    completion.resolve([{ id: completion.args[2] + ':0', title: 'McDonalds', subtitle: 'Test City' }]); await f.r.settle();
}
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('Settled suggestions transition on the first Search tap and the page retains handled keyboard taps', async () => {
    const f = setup(); try {
        await f.r.settle(); await suggestions(f); assert(nodes(f.r.output).some(n => n.props?.accessibilityLabel === 'Restaurant suggestions'));
        const page = nodes(f.r.output).find(n => n.type === 'ScrollView' && !n.props.horizontal);
        assert.equal(page.props.keyboardShouldPersistTaps, 'handled');
        await click(f.r, 'Search'); assert.equal(f.calls.at(-1).action, 'search');
        assert(textOf(f.r.output).includes('Searching Apple Maps...')); assert(!textOf(f.r.output).includes('Suggestions —'));
        f.calls.at(-1).resolve([location()]); await f.r.settle();
        assert(button(f.r, 'Choose restaurant: McDonalds, 100 Main Street, Test City'));
        assert.equal(f.calls.filter(c => c.action === 'search').length, 1); assert.equal(f.rt.world.keyboardDismissals, 1);
    } finally { f.r.unmount(); }
});

test('The first Search tap supersedes pending suggestions and late autocomplete cannot hide full results', async () => {
    const f = setup(); try {
        await f.r.settle(); const completion = await type(f);
        assert.equal(button(f.r, 'Search').props.disabled, false, 'Autocomplete must not disable explicit Search');
        await click(f.r, 'Search'); const full = f.calls.at(-1); assert.equal(full.action, 'search');
        assert(f.cancellations.includes(completion.args[2]));
        await f.time.advance(400, f.r); assert.equal(f.calls.length, 2);
        full.resolve([location()]); await f.r.settle();
        completion.resolve([{ id: completion.args[2] + ':0', title: 'Obsolete suggestion', subtitle: 'Old address' }]); await f.r.settle();
        assert(!textOf(f.r.output).includes('Obsolete suggestion')); assert(button(f.r, 'Choose restaurant: McDonalds, 100 Main Street, Test City'));
    } finally { f.r.unmount(); }
});

test('Search before the typing debounce fires cancels the scheduled suggestion lookup', async () => {
    const f = setup(); try {
        await f.r.settle(); await enter(f.r, 'Search restaurants', 'McDonalds'); await click(f.r, 'Search');
        await f.time.advance(400, f.r); assert.deepEqual(f.calls.map(c => c.action), ['search']);
        f.calls[0].resolve([location()]); await f.r.settle(); assert(textOf(f.r.output).includes('Choose a restaurant'));
    } finally { f.r.unmount(); }
});

test('Slow full search cannot be restarted by duplicate button or keyboard submissions', async () => {
    const f = setup(); try {
        await f.r.settle(); await enter(f.r, 'Search restaurants', 'McDonalds');
        const press = button(f.r, 'Search').props.onPress;
        const submit = nodes(f.r.output).find(n => n.props?.accessibilityLabel === 'Search restaurants').props.onSubmitEditing;
        press(); press(); submit(); await f.r.settle();
        assert.equal(f.calls.length, 1); assert(button(f.r, 'Search').props.disabled);
        f.calls[0].resolve([location()]); await f.r.settle(); assert.equal(button(f.r, 'Search').props.disabled, false);
    } finally { f.r.unmount(); }
});

test('One Search exposes completed-empty, sanitized error and timeout feedback without a second tap', async () => {
    for (const outcome of ['empty', 'error', 'timeout']) {
        const f = setup(); try {
            await f.r.settle(); await enter(f.r, 'Search restaurants', 'McDonalds'); await click(f.r, 'Search');
            assert(textOf(f.r.output).includes('Searching Apple Maps...'));
            if (outcome === 'empty') f.calls[0].resolve([]);
            else if (outcome === 'error') f.calls[0].reject({ code: 'ERR_UNAVAILABLE', message: 'private raw platform error' });
            else await f.time.advance(10000, f.r);
            await f.r.settle(); const text = textOf(f.r.output);
            assert(text.includes(outcome === 'empty' ? 'No restaurants found.' : outcome === 'error' ? 'Apple search is unavailable.' : 'Apple search timed out.'));
            assert(!text.includes('private raw')); assert(!text.includes('Searching Apple Maps...')); assert.equal(f.calls.length, 1);
            assert.equal(button(f.r, 'Search').props.disabled, false); assert(button(f.r, 'Enter Restaurant Manually'));
        } finally { f.r.unmount(); }
    }
});

test('Changing the query cancels older searches and preserves the new full result and exact unified Add selection', async () => {
    const f = setup(); try {
        await f.r.settle(); await enter(f.r, 'Search restaurants', 'McDonalds'); await click(f.r, 'Search'); const old = f.calls[0];
        await enter(f.r, 'Search restaurants', 'New Restaurant'); await click(f.r, 'Search'); const current = f.calls[1];
        const chosen = location('New Restaurant', '200 Correct Street, Test City'); current.resolve([chosen]); await f.r.settle();
        old.resolve([location('Old Restaurant', 'Wrong address')]); await f.r.settle(); assert(!textOf(f.r.output).includes('Wrong address'));
        await click(f.r, 'Choose restaurant: ' + chosen.name + ', ' + chosen.address);
        assert.equal(f.rt.world.navigation.at(-1), '/add-visit'); assert.equal(f.selected().apple_place_id, chosen.placeId);
        assert.equal(f.selected().mapkit_point.latitude, chosen.latitude); assert.equal(f.selected().mapkit_point.longitude, chosen.longitude);
        await f.form(); assert.equal(nodes(f.r.output).find(n => n.props?.accessibilityLabel === 'Restaurant address').props.value, chosen.address);
        assert(nodes(f.r.output).filter(n => n.props?.accessibilityRole === 'checkbox').every(n => !n.props.accessibilityState.checked));
        assert.equal(f.state.visits.length, 0);
    } finally { f.r.unmount(); }
});

test('Typing suggestions still resolve to explicit candidates with their exact restaurant identity', async () => {
    const f = setup(); try {
        await f.r.settle(); await suggestions(f); await click(f.r, 'McDonalds Test City');
        assert.equal(f.calls.at(-1).action, 'resolve'); assert.equal(f.rt.world.navigation.length, 0);
        const chosen = location(); f.calls.at(-1).resolve([chosen]); await f.r.settle();
        await click(f.r, 'Choose restaurant: ' + chosen.name + ', ' + chosen.address);
        assert.equal(f.selected().address, chosen.address); assert.equal(f.selected().apple_place_id, chosen.placeId);
        assert.equal(f.selected().mapkit_point.latitude, chosen.latitude); assert.equal(f.rt.world.navigation.at(-1), '/add-visit');
    } finally { f.r.unmount(); }
});

(async () => {
    let passed = 0;
    for (const { name, run } of tests) {
        try { await run(); passed++; console.log('PASS ' + name); }
        catch (error) { console.error('FAIL ' + name); console.error(error); process.exitCode = 1; }
    }
    console.log(`${passed}/${tests.length} offline restaurant search ordering checks passed.`);
})();
