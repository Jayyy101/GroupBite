// Offline instrumentation checks. These deliberately do not simulate UIKit,
// the Expo bridge queue or real MapKit cold-start behavior.
const assert = require('node:assert/strict');
const { click, enter, nodes, textOf } = require('./personal-places.cjs');
const { model } = require('./unified-add.cjs');
const item = { id: '1:0', name: 'Private restaurant sentinel', address: 'Private address sentinel', placeId: 'Private-provider-sentinel',
    latitude: 37.1234567, longitude: -122.7654321, kind: 'business', source: 'apple-maps-preview' };
function setup(options = {}) {
    const lines = [], calls = [], resets = [], cancellations = [], keyboardListeners = new Map();
    const native = { isAvailable: () => true, complete: async (q, m, id) => [{ id: id + ':0', title: 'Suggestion', subtitle: 'Address' }],
        resolve: async () => [item], search: (q, m, id) => {
            calls.push(id); return options.search ? options.search() : Promise.resolve([item]);
        }, cancel: async id => { cancellations.push(id); }, reset: async () => { resets.push(true); } };
    const f = model({ development: true, platform: 'ios', autocompleteEnv: { EXPO_PUBLIC_GROUPBITE_SEARCH_DIAGNOSTICS: '1' }, ...options,
        console: { ...console, info: line => lines.push(line) }, mocks: { expo: { requireOptionalNativeModule: () => native } } });
    f.rt.load('react-native').Keyboard.addListener = (event, handler) => {
        keyboardListeners.set(event, handler); return { remove: () => keyboardListeners.delete(event) };
    };
    return { ...f, lines, calls, resets, cancellations, r: f.render('add'),
        emitKeyboard: event => keyboardListeners.get(event)?.(), events: () => lines.map(line => JSON.parse(line.slice('[GroupBiteSearch] '.length))) };
}
let passed = 0;
async function test(label, run) { await run(); passed++; console.log('PASS ' + label); }
(async () => {
    await test('Diagnostics are silent without explicit development opt-in and in release mode', async () => {
        for (const options of [{ autocompleteEnv: {} }, { development: false }]) {
            const f = setup(options); try {
                await f.r.settle(); f.rt.load('@/lib/search-diagnostics').traceSearch('test', { count: 1 });
                assert.equal(f.lines.length, 0);
            } finally { f.r.unmount(); }
        }
    });
    await test('Cold and subsequent Search trace dispatch, reply, acceptance and committed UI state without private values', async () => {
        const f = setup(); try {
            await f.r.settle();
            for (const query of ['McDonalds', 'Chipotle']) {
                await enter(f.r, 'Search restaurants', ''); await enter(f.r, 'Search restaurants', query); await click(f.r, 'Search');
                assert(textOf(f.r.output).includes(item.name));
            }
            const events = f.events();
            assert.equal(events.filter(e => e.event === 'ui:button-press').length, 2);
            assert.equal(events.filter(e => e.event === 'adapter:search:dispatch').length, 2);
            assert.equal(events.filter(e => e.event === 'adapter:search:native-reply').length, 2);
            assert.equal(events.filter(e => e.event === 'ui:accept:search').length, 2);
            assert(events.some(e => e.event === 'ui:state' && e.candidates === 1 && !e.busy));
            assert(events.some(e => e.event === 'landing:state' && e.ready && !e.attempts));
            for (const event of events) for (const [key, value] of Object.entries(event)) {
                if (key !== 'event') assert(value === null || ['number', 'boolean'].includes(typeof value));
            }
            const output = f.lines.join('\n');
            for (const value of ['McDonalds', 'Chipotle', item.name, item.address, item.placeId, String(item.latitude), String(item.longitude), 'fake-a']) assert(!output.includes(value));
        } finally { f.r.unmount(); }
    });
    await test('Keyboard dismissal and unchanged input preserve the first Search request, generation, results and native session', async () => {
        let finish;
        const f = setup({ search: () => new Promise(resolve => { finish = resolve; }) }); try {
            await f.r.settle(); await enter(f.r, 'Search restaurants', 'McDonalds'); await click(f.r, 'Search');
            const start = f.events().find(e => e.event === 'ui:start:search');
            const before = { resets: f.resets.length, cancellations: f.cancellations.length, events: f.events().length };
            assert.equal(f.rt.world.keyboardDismissals, 1);
            f.emitKeyboard('keyboardDidHide'); await enter(f.r, 'Search restaurants', 'McDonalds');
            assert(textOf(f.r.output).includes('Searching Apple Maps...'));
            assert.equal(f.resets.length, before.resets); assert.equal(f.cancellations.length, before.cancellations);
            const results = Array.from({ length: 5 }, (_,i) => ({ ...item, id: '1:' + i, name: item.name + ' ' + i }));
            finish(results); await f.r.settle();
            const events = f.events();
            const after = events.slice(before.events);
            assert.deepEqual(events.filter(e => ['ui:button-press','ui:request:search','adapter:search:dispatch','ui:keyboard-hide'].includes(e.event)
                || (e.event === 'ui:input-change' && !e.changed)).map(e => e.event),
            ['ui:button-press','ui:request:search','adapter:search:dispatch','ui:keyboard-hide','ui:input-change']);
            assert.deepEqual(after.filter(e => ['ui:keyboard-hide','ui:input-change'].includes(e.event)).map(e => e.event), ['ui:keyboard-hide','ui:input-change']);
            assert(after.some(e => e.event === 'ui:input-change' && !e.changed && e.generation === start.generation));
            assert(!after.some(e => e.event.startsWith('ui:cancel:') || e.event === 'adapter:search:finish:cancelled'));
            assert(after.some(e => e.event === 'ui:accept:search' && e.count === 5 && e.generation === start.generation));
            assert.equal(f.calls.length, 1); for (const result of results) assert(textOf(f.r.output).includes(result.name));
            await enter(f.r, 'Search restaurants', 'McDonalds');
            assert.equal(f.resets.length, before.resets); assert.equal(f.cancellations.length, before.cancellations);
            for (const result of results) assert(textOf(f.r.output).includes(result.name));
        } finally { f.r.unmount(); }
    });
    await test('A genuinely changed query still cancels the old request and discards its late response', async () => {
        const pending = [];
        const f = setup({ search: () => new Promise(resolve => pending.push(resolve)) }); try {
            await f.r.settle(); await enter(f.r, 'Search restaurants', 'McDonalds'); await click(f.r, 'Search');
            const first = f.events().find(e => e.event === 'ui:start:search');
            await enter(f.r, 'Search restaurants', 'Chipotle');
            assert(f.cancellations.includes(f.calls[0]));
            await click(f.r, 'Search'); pending[1]([{ ...item, name: 'Current restaurant' }]); await f.r.settle();
            pending[0]([{ ...item, name: 'Stale restaurant' }]); await f.r.settle();
            assert(textOf(f.r.output).includes('Current restaurant')); assert(!textOf(f.r.output).includes('Stale restaurant'));
            const events = f.events();
            assert(events.some(e => e.event === 'ui:accept:search' && e.generation > first.generation));
            assert(events.some(e => e.event === 'ui:cancel:input-change' && e.pending));
            assert(events.some(e => e.event === 'adapter:search:native-reply' && e.settled && e.aborted));
        } finally { f.r.unmount(); }
    });
    await test('Post-bridge validation failure is distinguishable from native rejection without logging the invalid payload', async () => {
        const f = setup({ search: async () => [{ ...item, address: '\u0000private-invalid-payload' }] }); try {
            await f.r.settle(); await enter(f.r, 'Search restaurants', 'McDonalds'); await click(f.r, 'Search');
            const events = f.events();
            assert(events.some(e => e.event === 'adapter:search:finish:success'));
            assert(events.some(e => e.event === 'ui:error' && e.current));
            assert(events.some(e => e.event === 'ui:state' && e.error));
            assert(!f.lines.join('\n').includes('private-invalid-payload')); assert(textOf(f.r.output).includes('Apple search is unavailable.'));
        } finally { f.r.unmount(); }
    });
    console.log(`${passed} offline search diagnostic checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
