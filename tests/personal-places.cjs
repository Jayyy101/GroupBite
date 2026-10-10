// Offline tests of the actual Supabase client, CRUD helpers and screen modules.
// The HTTP boundary and native/navigation APIs are mocked. No .env or network.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const placeId = '11111111-1111-1111-1111-111111111111';
let passed = 0;

function fixture(overrides = {}) {
    return { id: placeId, owner_user_id: 'a', name: 'Private Cafe', address: 'Private Address', cuisine: 'Italian',
        visited_on: '2026-10-07', rating: 4, would_go_again: false, notes: 'Private memory',
        client_request_id: 'original', revision: 1, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z', ...overrides };
}
function response(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
function defer() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

function runtime(options = {}) {
    const world = { auth: { loading: false, error: '', session: { user: { id: 'a' }, access_token: 'fake-a' } },
        focused: true, params: {}, rows: [], requests: [], navigation: [], listeners: new Set(), override: null,
        local: JSON.stringify([{ id: 'legacy', name: 'Local Cafe', notes: 'Device memory', wouldGoAgain: false }]), localWrites: 0, lateUpdates: 0, keyboardDismissals: 0, links: [] };
    let nextId = 2;
    async function fetchOffline(input, init) {
        const url = new URL(input), method = init.method ?? 'GET', headers = new Headers(init.headers);
        const user = headers.get('Authorization')?.replace('Bearer fake-', '');
        const body = init.body ? JSON.parse(init.body) : undefined;
        const call = { url, method, headers, user, body };
        world.requests.push(call);
        assert.equal(url.origin, 'http://127.0.0.1:1');
        if (options.fetch) return options.fetch(call);
        assert.equal(url.pathname, '/rest/v1/personal_places', 'Personal screens must not request shared/group data');
        if (method === 'POST' || method === 'PATCH') {
            const allowed = ['name', 'address', 'cuisine', 'visited_on', 'rating', 'would_go_again', 'notes', ...(method === 'POST' ? ['client_request_id'] : [])];
            assert(Object.keys(body).every(key => allowed.includes(key)), 'Immutable columns must not enter mutation payloads');
        }
        const overridden = world.override?.(call);
        if (overridden) return overridden;
        function matches(row) {
            return row.owner_user_id === user && [...url.searchParams].filter(([k]) => !['select', 'order'].includes(k))
                .every(([k, v]) => v === 'eq.' + row[k]);
        }
        let rows;
        if (method === 'POST') {
            if (world.rows.some(row => row.owner_user_id === user && row.client_request_id === body.client_request_id)) {
                return response({ code: '23505', message: 'duplicate retry' }, 409);
            }
            const row = fixture({ ...body, id: `00000000-0000-0000-0000-${String(nextId++).padStart(12, '0')}`, owner_user_id: user });
            world.rows.push(row); rows = [row];
        } else if (method === 'PATCH') {
            rows = world.rows.filter(matches).map(row => { Object.assign(row, body, { revision: row.revision + 1 }); return row; });
        } else if (method === 'DELETE') {
            rows = world.rows.filter(matches); world.rows = world.rows.filter(row => !matches(row));
        } else rows = world.rows.filter(matches);
        if (headers.get('Accept')?.includes('vnd.pgrst.object')) {
            if (rows.length !== 1) return response({ code: 'PGRST116', details: `The result contains ${rows.length} rows`, message: 'Cannot coerce the result to a single JSON object' }, 406);
            return response(rows[0], method === 'POST' ? 201 : 200);
        }
        return response(rows, method === 'POST' ? 201 : 200);
    }
    const supabase = createClient('http://127.0.0.1:1', 'sb_publishable_offline_test', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchOffline },
    });
    supabase.auth.getSession = async () => ({ data: { session: world.auth.session }, error: null });
    const appState = { currentState: 'active', addEventListener(_, fn) { world.listeners.add(fn); return { remove: () => world.listeners.delete(fn) }; } };
    let current;
    const react = {
        useState(initial) {
            const frame = current, i = frame.cursor++;
            const slot = frame.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slot.value, next => {
                if (!frame.alive) { world.lateUpdates++; return; }
                const value = typeof next === 'function' ? next(slot.value) : next;
                if (!Object.is(value, slot.value)) { slot.value = value; frame.renderer.dirty = true; }
            }];
        },
        useRef(initial) { const frame = current, i = frame.cursor++; return (frame.slots[i] ??= { value: { current: initial } }).value; },
        useEffect(fn, deps) {
            const frame = current, i = frame.cursor++, old = frame.slots[i];
            if (!old || !deps || deps.length !== old.deps.length || deps.some((d, n) => !Object.is(d, old.deps[n]))) {
                frame.slots[i] = { deps, cleanup: old?.cleanup };
                frame.renderer.effects.push(() => { old?.cleanup?.(); frame.slots[i].cleanup = fn(); });
            }
        },
        useCallback(fn, deps) {
            const frame = current, i = frame.cursor++, old = frame.slots[i];
            if (!old || deps.some((d, n) => !Object.is(d, old.deps[n]))) frame.slots[i] = { deps, value: fn };
            return frame.slots[i].value;
        },
    };
    const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
    const router = options.router ?? { push: x => world.navigation.push(x), replace: x => world.navigation.push(x), dismissTo: x => world.navigation.push(x),
        canGoBack: () => world.canGoBack !== false, back: () => world.navigation.push('BACK') };
    const mocks = {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
        'react-native': { AppState: appState, Keyboard: { dismiss: () => world.keyboardDismissals++ },
            Linking: { async openURL(url) { world.links.push(url); } }, Platform: { OS: options.platform ?? 'web' }, StyleSheet: { create: x => x }, Pressable: 'Pressable', ScrollView: 'ScrollView', View: 'View', Text: 'Text', TextInput: 'TextInput' },
        'expo-router': { Redirect: 'Redirect', useRouter: () => router, useLocalSearchParams: () => world.params,
            useFocusEffect: cb => react.useEffect(() => world.focused ? cb() : undefined, [world.focused, cb]) },
        '@react-navigation/native': { useIsFocused: () => world.focused },
        '@/lib/supabase': { supabase, supabasePublicConfig: { url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_offline_test' } },
        '@/providers/auth': { useAuth: () => world.auth },
        '@react-native-async-storage/async-storage': { default: { async getItem(key) { assert.equal(key, 'savedPlaces'); return world.local; },
            async setItem(key, value) { assert.equal(key, 'savedPlaces'); world.localWrites++; world.local = value; } } },
    };
    const cache = {};
    function load(name) {
        if (mocks[name]) return mocks[name];
        if (cache[name]) return cache[name];
        const base = path.join(root, name.replace(/^@\//, ''));
        const file = ['.ts', '.tsx'].map(ext => base + ext).find(file => fs.existsSync(file));
        assert(file, 'Unexpected import ' + name);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
        const module = { exports: {} }; cache[name] = module.exports;
        vm.runInNewContext(code, { exports: module.exports, module, require: name => name.startsWith('.') ? load('@/' + path.relative(root, path.resolve(path.dirname(file), name))) : load(name),
            setInterval: () => 1, clearInterval: () => {},
            setTimeout: options.setTimeout ?? setTimeout, clearTimeout: options.clearTimeout ?? clearTimeout,
            fetch: options.autocompleteFetch ?? (() => assert.fail('Unexpected unmocked autocomplete Fetch')),
            AbortController, URL, Headers, Request, Response, __DEV__: options.development ?? false, Date, console });
        return module.exports;
    }
    function render(Screen) {
        const frames = new Map();
        const renderer = { dirty: true, output: null, effects: [],
            draw() {
                renderer.dirty = false; renderer.effects = [];
                for (const frame of frames.values()) frame.used = false;
                function visit(element, route) {
                    if (element == null || typeof element === 'boolean') return null;
                    if (Array.isArray(element)) return element.map((x, i) => visit(x, route + '/' + (x?.key ?? i)));
                    if (typeof element !== 'object') return element;
                    if (typeof element.type === 'function') {
                        options.observeComponent?.(element.type, element.props);
                        const key = route + ':' + element.type.name + ':' + (element.key ?? '');
                        const frame = frames.get(key) ?? { slots: [], alive: true, renderer };
                        frames.set(key, frame); frame.used = true; frame.cursor = 0;
                        const previous = current; current = frame;
                        const output = element.type(element.props); current = previous;
                        return visit(output, key);
                    }
                    return { ...element, props: { ...element.props, children: visit(element.props.children, route + '/' + element.type) } };
                }
                renderer.output = visit(jsx(Screen, {}), 'root');
                for (const [key, frame] of frames) if (!frame.used) { frame.alive = false; frame.slots.forEach(slot => slot.cleanup?.()); frames.delete(key); }
                renderer.effects.splice(0).forEach(fn => fn());
            },
            async settle() { for (let i = 0; i < 35; i++) { if (renderer.dirty) renderer.draw(); await new Promise(resolve => setImmediate(resolve)); } assert(!renderer.dirty, 'Render did not settle'); },
            unmount() { for (const frame of frames.values()) { frame.alive = false; frame.slots.forEach(slot => slot.cleanup?.()); } frames.clear(); },
        };
        return renderer;
    }
    return { world, load, render, supabase, emit(state) { appState.currentState = state; [...world.listeners].forEach(fn => fn(state)); }, switch(user, renderer) {
        world.auth = { loading: false, error: '', session: user ? { user: { id: user }, access_token: 'fake-' + user } : null };
        if (renderer) renderer.dirty = true;
    } };
}

function nodes(element) {
    if (element == null || typeof element === 'boolean') return [];
    if (Array.isArray(element)) return element.flatMap(nodes);
    if (typeof element !== 'object') return [element];
    return [element, ...nodes(element.props.children)];
}
const textOf = x => nodes(x).filter(n => typeof n === 'string' || typeof n === 'number').join(' ');
function button(r, label) { const b = nodes(r.output).find(n => n.type === 'Pressable' && textOf(n.props.children) === label); assert(b, 'Missing ' + label + ': ' + textOf(r.output)); return b; }
async function click(r, label) { const b = button(r, label); assert(!b.props.disabled, label + ' disabled'); await b.props.onPress(); await r.settle(); }
async function enter(r, label, value) { const input = nodes(r.output).find(n => n.type === 'TextInput' && n.props.accessibilityLabel === label); assert(input); assert(input.props.editable); input.props.onChangeText(value); await r.settle(); }
async function fill(r) { await enter(r, 'Restaurant name', ' New Cafe '); await enter(r, 'Restaurant address', ' New Address '); await enter(r, 'Personal notes', ' New memory '); }
async function test(label, fn) { await fn(); passed++; console.log('PASS ' + label); }
function screen(rt, name) { return rt.render(rt.load('app/' + name).default); }

module.exports = { runtime, fixture, response, screen, click, enter, fill, button, nodes, textOf };

if (require.main === module) (async () => {
    await test('Home exposes personal, group and legacy navigation without local writes', async () => {
        const rt = runtime(), r = screen(rt, 'index'); await r.settle();
        for (const [label, route] of [['My Places', '/my-places'], ['Add Restaurant / Visit', '/add-visit'], ['Saved Places (this device)', '/saved-places'], ['Groups', '/groups']]) {
            await click(r, label); assert.equal(rt.world.navigation.at(-1), route);
        }
        assert.equal(rt.world.localWrites, 0); assert.equal(rt.world.requests.length, 0); r.unmount();
    });
    await test('All personal routes require auth; restoration issues no request', async () => {
        for (const name of ['my-places', 'personal-place-form', 'personal-place/[id]']) {
            const rt = runtime(); rt.switch(null); const r = screen(rt, name); await r.settle();
            assert(textOf(r.output).includes('No group is required')); await click(r, 'Sign In / Sign Up');
            assert.equal(rt.world.navigation.at(-1), '/auth'); assert.equal(rt.world.requests.length, 0);
            rt.world.auth.loading = true; r.dirty = true; await r.settle(); assert(textOf(r.output).includes('Restoring your session')); assert(!textOf(r.output).includes('Sign In / Sign Up')); r.unmount();
        }
    });
    await test('My Places empty state is account-based; a failed refresh clears stale data', async () => {
        const rt = runtime(), r = screen(rt, 'my-places'); await r.settle(); assert(textOf(r.output).includes('No personal Places yet'));
        rt.world.rows = [fixture()]; await click(r, 'Refresh My Places'); assert(textOf(r.output).includes('Private Cafe'));
        await click(r, 'Add Personal Place'); assert.equal(rt.world.navigation.at(-1), '/personal-place-form');
        rt.world.override = () => response({ code: 'offline', message: 'private raw error' }, 400); await click(r, 'Refresh My Places');
        assert(!textOf(r.output).includes('Private Cafe')); assert(!textOf(r.output).includes('No personal Places yet')); assert(!textOf(r.output).includes('private raw error')); r.unmount();
    });
    await test('Create needs no group, trims values, preserves false and permits intentional duplicate saves', async () => {
        const rt = runtime(), before = rt.world.local; const r = screen(rt, 'personal-place-form'); await r.settle(); await fill(r); await click(r, 'No'); await click(r, '4'); await click(r, 'Save Personal Place');
        assert.equal(rt.world.rows.length, 1); assert.equal(rt.world.rows[0].name, 'New Cafe'); assert.equal(rt.world.rows[0].would_go_again, false); assert.equal(rt.world.rows[0].rating, 4);
        assert.equal(rt.world.navigation.at(-1).pathname, '/personal-place/[id]'); assert(!('owner_user_id' in rt.world.requests.find(x => x.method === 'POST').body));
        r.unmount(); const again = screen(rt, 'personal-place-form'); await again.settle(); await fill(again); await click(again, 'Save Personal Place');
        assert.equal(rt.world.rows.length, 2); assert.notEqual(rt.world.rows[0].client_request_id, rt.world.rows[1].client_request_id);
        assert.equal(rt.world.local, before); assert.equal(rt.world.localWrites, 0); again.unmount();
    });
    await test('Validation rejects invalid memories before HTTP; nullable controls clear answers', async () => {
        const rt = runtime(), r = screen(rt, 'personal-place-form'); await r.settle(); await click(r, 'Save Personal Place'); assert.equal(rt.world.requests.length, 0);
        await fill(r); await enter(r, 'Visit date', '2026-02-30'); await click(r, 'Save Personal Place'); assert(textOf(r.output).includes('real visit date')); assert.equal(rt.world.requests.length, 0);
        await enter(r, 'Visit date', ''); await click(r, 'No'); await click(r, 'No'); await click(r, '5'); await click(r, '5'); await click(r, 'Save Personal Place');
        assert.equal(rt.world.rows[0].rating, null); assert.equal(rt.world.rows[0].would_go_again, null); assert.equal(rt.world.rows[0].visited_on, null);
        const api = rt.load('@/lib/personal-places'), valid = fixture();
        for (const fields of [{ name: 'x'.repeat(101) }, { address: 'x'.repeat(301) }, { cuisine: 'x'.repeat(101) }, { notes: 'x'.repeat(4001) }, { rating: 1.5 }, { rating: 0 }, { rating: 6 }, { visited_on: '0000-01-01' }]) assert.throws(() => api.normalizePersonalPlace({ ...valid, ...fields }));
        assert.equal(api.normalizePersonalPlace({ ...valid, name: '🍕'.repeat(100), cuisine: ' ', notes: ' ', visited_on: '2024-02-29' }).cuisine, null); r.unmount();
    });
    await test('Personal detail retains false, offers edit, and delete requires cancellable confirmation', async () => {
        const rt = runtime(); rt.world.params = { id: placeId }; rt.world.rows = [fixture(), fixture({ id: '22222222-2222-2222-2222-222222222222', client_request_id: 'independent' })];
        const r = screen(rt, 'personal-place/[id]'); await r.settle(); assert(textOf(r.output).includes('Would go again:  No'));
        await click(r, 'Edit Personal Place'); assert.equal(rt.world.navigation.at(-1).pathname, '/personal-place-form');
        await click(r, 'Delete Personal Place'); await click(r, 'Cancel'); assert.equal(rt.world.requests.filter(x => x.method === 'DELETE').length, 0);
        await click(r, 'Delete Personal Place'); await click(r, 'Confirm Delete'); assert.equal(rt.world.rows.length, 1); assert.equal(rt.world.navigation.at(-1), '/my-places'); r.unmount();
    });
    await test('Personal edits change private facts, clear optionals and use the loaded revision', async () => {
        const rt = runtime(); rt.world.params = { id: placeId }; rt.world.rows = [fixture()]; const r = screen(rt, 'personal-place-form'); await r.settle();
        await enter(r, 'Restaurant name', 'Edited Cafe'); await enter(r, 'Cuisine', ''); await enter(r, 'Visit date', ''); await enter(r, 'Personal notes', ''); await click(r, '4'); await click(r, 'No'); await click(r, 'Save Changes');
        const row = rt.world.rows[0]; assert.equal(row.name, 'Edited Cafe'); assert.equal(row.cuisine, null); assert.equal(row.notes, null); assert.equal(row.rating, null); assert.equal(row.would_go_again, null); assert.equal(row.revision, 2);
        assert.equal(rt.world.requests.find(x => x.method === 'PATCH').url.searchParams.get('revision'), 'eq.1'); assert.equal(rt.world.navigation.at(-1).params.id, placeId); r.unmount();
    });
    await test('Missing, malformed, array and foreign IDs never allow edit/delete or local fallback', async () => {
        for (const id of ['missing', ['one', 'two'], placeId]) for (const name of ['personal-place-form', 'personal-place/[id]']) {
            const rt = runtime(); rt.world.params = { id }; rt.world.rows = [fixture({ owner_user_id: 'b' })]; const r = screen(rt, name); await r.settle();
            assert(textOf(r.output).includes('could not be found')); assert(!textOf(r.output).includes('Private memory')); assert(!textOf(r.output).includes('Save Changes')); assert(!textOf(r.output).includes('Delete Personal Place'));
            if (id !== placeId) assert.equal(rt.world.requests.length, 0); assert.equal(rt.world.localWrites, 0); r.unmount();
        }
    });
    await test('Lost create response reconciles the committed result with one POST', async () => {
        const rt = runtime(); rt.world.override = call => {
            if (call.method !== 'POST') return null;
            rt.world.rows.push(fixture({ ...call.body })); return response({ code: '', message: 'Failed to fetch' }, 400);
        };
        const r = screen(rt, 'personal-place-form'); await r.settle(); await fill(r); await click(r, 'Save Personal Place');
        assert.equal(rt.world.requests.filter(x => x.method === 'POST').length, 1); assert.equal(rt.world.navigation.at(-1).params.id, placeId); r.unmount();
    });
    await test('An uncertain missing save locks mutation and Check Saved Result is read-only', async () => {
        const rt = runtime(); rt.world.override = call => call.method === 'POST' ? response({ code: '', message: 'Failed to fetch' }, 400) : null;
        const r = screen(rt, 'personal-place-form'); await r.settle(); await fill(r); await click(r, 'Save Personal Place'); assert(button(r, 'Save Personal Place').props.disabled);
        await click(r, 'Check Saved Result'); assert(textOf(r.output).includes('may still finish')); assert.equal(rt.world.requests.filter(x => x.method === 'POST').length, 1);
        const original = rt.world.requests.find(x => x.method === 'POST').body;
        rt.world.rows.push(fixture({ ...original, name: 'Edited after save', revision: 2 })); await click(r, 'Check Saved Result');
        assert.equal(rt.world.navigation.at(-1).params.id, placeId); assert.equal(rt.world.rows[0].name, 'Edited after save'); assert.equal(rt.world.requests.filter(x => x.method === 'POST').length, 1); r.unmount();
    });
    await test('A deleted uncertain save is never automatically resurrected', async () => {
        const rt = runtime(); rt.world.override = call => {
            if (call.method === 'POST') {
                rt.world.rows.push(fixture({ ...call.body, owner_user_id: call.user }));
                return response({ code: '', message: 'lost result' }, 400);
            }
            // The save committed, but its lost response and failed initial read
            // leave the original form uncertain while another client deletes it.
            return call.method === 'GET' ? response({ code: '', message: 'reconciliation unavailable' }, 400) : null;
        };
        const r = screen(rt, 'personal-place-form'); await r.settle(); await fill(r); await click(r, 'Save Personal Place');
        assert.equal(rt.world.rows.length, 1);
        const committed = rt.world.rows[0];
        assert.equal(committed.client_request_id, rt.world.requests.find(x => x.method === 'POST').body.client_request_id);
        assert(button(r, 'Save Personal Place').props.disabled); assert.equal(rt.world.navigation.length, 0);

        rt.world.override = null;
        await rt.load('@/lib/personal-places').deletePersonalPlace('a', committed);
        assert.equal(rt.world.rows.length, 0);
        const deletion = rt.world.requests.find(x => x.method === 'DELETE');
        assert.equal(deletion.url.searchParams.get('id'), 'eq.' + committed.id);
        assert.equal(deletion.url.searchParams.get('revision'), 'eq.' + committed.revision);

        const beforeCheck = rt.world.requests.length;
        await click(r, 'Check Saved Result');
        const checks = rt.world.requests.slice(beforeCheck);
        assert.equal(checks.length, 1); assert.equal(checks[0].method, 'GET');
        assert.equal(checks[0].url.searchParams.get('client_request_id'), 'eq.' + committed.client_request_id);
        assert(button(r, 'Save Personal Place').props.disabled); assert(textOf(r.output).includes('may still finish'));
        assert.equal(rt.world.navigation.length, 0);
        await click(r, 'Review My Places');
        assert.equal(rt.world.rows.length, 0); assert.equal(rt.world.requests.filter(x => x.method === 'POST').length, 1);
        assert.equal(rt.world.requests.filter(x => x.method === 'DELETE').length, 1);
        assert.equal(rt.world.navigation.at(-1), '/my-places'); r.unmount();
    });
    await test('Duplicate request reconciles an already edited record without an upsert', async () => {
        const rt = runtime(); rt.world.rows = [fixture({ name: 'Newer facts', revision: 3 })];
        const api = rt.load('@/lib/personal-places'); const saved = await api.createPersonalPlace('a', fixture(), 'original');
        assert.equal(saved.name, 'Newer facts'); assert.equal(rt.world.rows[0].revision, 3); assert.equal(rt.world.requests.filter(x => x.method === 'PATCH').length, 0);
    });
    await test('Double taps submit once and busy controls cannot navigate or alter fields', async () => {
        const rt = runtime(), delayed = defer(); rt.world.override = call => call.method === 'POST' ? delayed.promise : null;
        const r = screen(rt, 'personal-place-form'); await r.settle(); await fill(r); const submit = button(r, 'Save Personal Place').props.onPress;
        const first = submit(); const second = submit(); await r.settle(); assert.equal(rt.world.requests.filter(x => x.method === 'POST').length, 1); assert(button(r, 'Back').props.disabled);
        assert(nodes(r.output).filter(x => x.type === 'TextInput').every(x => !x.props.editable)); delayed.resolve(response(fixture(), 201)); await Promise.all([first, second]); await r.settle(); r.unmount();
    });
    await test('Stale edit locks the form and never overwrites a newer revision', async () => {
        const rt = runtime(); rt.world.params = { id: placeId }; rt.world.rows = [fixture()]; const r = screen(rt, 'personal-place-form'); await r.settle();
        rt.world.rows[0].revision = 2; rt.world.rows[0].notes = 'Other device'; await enter(r, 'Personal notes', 'Stale draft'); await click(r, 'Save Changes');
        assert(button(r, 'Save Changes').props.disabled); assert(textOf(r.output).includes('place changed')); assert.equal(rt.world.rows[0].notes, 'Other device'); assert.equal(rt.world.navigation.length, 0); await click(r, 'Cancel and Refresh Place'); r.unmount();
    });
    await test('Stale delete reloads details and requires a fresh confirmation', async () => {
        const rt = runtime(); rt.world.params = { id: placeId }; rt.world.rows = [fixture()]; const r = screen(rt, 'personal-place/[id]'); await r.settle(); await click(r, 'Delete Personal Place');
        rt.world.rows[0].revision = 2; rt.world.rows[0].name = 'Newer Cafe'; await click(r, 'Confirm Delete'); assert(textOf(r.output).includes('Newer Cafe')); assert(textOf(r.output).includes('place changed')); assert.equal(rt.world.rows.length, 1);
        assert(!textOf(r.output).includes('Confirm Delete')); await click(r, 'Delete Personal Place'); await click(r, 'Confirm Delete'); assert.equal(rt.world.rows.length, 0); r.unmount();
    });
    await test('Lost update result never replays; returning to details reveals the committed revision', async () => {
        const rt = runtime(); rt.world.params = { id: placeId }; rt.world.rows = [fixture()]; rt.world.override = call => {
            if (call.method !== 'PATCH') return null;
            Object.assign(rt.world.rows[0], call.body, { revision: 2 }); return response({ code: '', message: 'lost response' }, 400);
        };
        const r = screen(rt, 'personal-place-form'); await r.settle(); await enter(r, 'Personal notes', 'Committed memory'); await click(r, 'Save Changes');
        assert(button(r, 'Save Changes').props.disabled); assert.equal(rt.world.requests.filter(x => x.method === 'PATCH').length, 1); await click(r, 'Cancel and Refresh Place'); r.unmount();
        const details = screen(rt, 'personal-place/[id]'); await details.settle(); assert(textOf(details.output).includes('Committed memory')); details.unmount();
    });
    await test('Lost delete result reloads missing state and never automatically retries', async () => {
        const rt = runtime(); rt.world.params = { id: placeId }; rt.world.rows = [fixture()]; rt.world.override = call => {
            if (call.method !== 'DELETE') return null;
            rt.world.rows = []; return response({ code: '', message: 'lost delete response' }, 400);
        };
        const r = screen(rt, 'personal-place/[id]'); await r.settle(); await click(r, 'Delete Personal Place'); await click(r, 'Confirm Delete');
        assert(textOf(r.output).includes('could not be found')); assert(!textOf(r.output).includes('Confirm Delete')); assert.equal(rt.world.requests.filter(x => x.method === 'DELETE').length, 1); r.unmount();
    });
    await test('Account changes cannot issue a previous account mutation; each HTTP request pins its token', async () => {
        const rt = runtime(), api = rt.load('@/lib/personal-places'); rt.switch('b');
        await assert.rejects(api.createPersonalPlace('a', fixture(), 'wrong-account'), error => error.kind === 'account'); assert.equal(rt.world.requests.length, 0);
        rt.switch('a'); const originalGetSession = rt.supabase.auth.getSession;
        rt.supabase.auth.getSession = async () => { const result = await originalGetSession(); rt.switch('b'); return result; };
        const saved = await api.createPersonalPlace('a', fixture(), 'pinned-account'); assert.equal(saved.owner_user_id, 'a'); assert.equal(rt.world.requests[0].headers.get('Authorization'), 'Bearer fake-a');
    });
    await test('Sign-out and account switches clear data and isolate drafts across all personal routes', async () => {
        for (const name of ['my-places', 'personal-place-form', 'personal-place/[id]']) {
            const rt = runtime(); rt.world.params = name === 'personal-place-form' ? {} : { id: placeId }; rt.world.rows = [fixture(), fixture({ id: '22222222-2222-2222-2222-222222222222', owner_user_id: 'b', name: 'B Cafe' })];
            const r = screen(rt, name); await r.settle(); if (name === 'personal-place-form') await fill(r);
            rt.switch('b', r); await r.settle(); assert(!textOf(r.output).includes('Private memory')); assert(!textOf(r.output).includes('Private Cafe'));
            if (name === 'personal-place-form') assert(nodes(r.output).filter(x => x.type === 'TextInput').every(x => x.props.value === ''));
            rt.switch(null, r); await r.settle(); assert(textOf(r.output).includes('Sign in')); assert(!textOf(r.output).includes('B Cafe')); assert.equal(rt.world.localWrites, 0); r.unmount();
        }
    });
    await test('Blur/background hide private UI and clear confirmations; create text survives', async () => {
        for (const name of ['my-places', 'personal-place-form', 'personal-place/[id]']) {
            const rt = runtime(); rt.world.params = name === 'personal-place-form' ? {} : { id: placeId }; rt.world.rows = [fixture()]; const r = screen(rt, name); await r.settle();
            if (name === 'personal-place-form') await fill(r); if (name === 'personal-place/[id]') await click(r, 'Delete Personal Place');
            rt.emit('background'); await r.settle(); assert.equal(r.output, null); rt.emit('active'); await r.settle(); assert(!textOf(r.output).includes('Confirm Delete'));
            if (name === 'personal-place-form') assert.equal(nodes(r.output).find(x => x.props?.accessibilityLabel === 'Restaurant name').props.value, ' New Cafe ');
            rt.world.focused = false; r.dirty = true; await r.settle(); assert.equal(r.output, null); rt.world.focused = true; r.dirty = true; await r.settle(); assert(r.output); r.unmount();
        }
    });
    await test('Late read from account A never appears under account B', async () => {
        const rt = runtime(), delayed = defer(); let held = true;
        rt.world.override = call => call.method === 'GET' && call.user === 'a' && held ? delayed.promise : null;
        const r = screen(rt, 'my-places'); await r.settle(); rt.switch('b', r); await r.settle(); held = false; delayed.resolve(response([fixture()])); await r.settle();
        assert(!textOf(r.output).includes('Private Cafe')); assert.equal(rt.world.lateUpdates, 0); r.unmount();
    });
    await test('Late create/edit/delete responses after background cannot update unmounted UI or navigate', async () => {
        for (const operation of ['POST', 'PATCH', 'DELETE']) {
            const rt = runtime(), delayed = defer(); rt.world.params = operation === 'POST' ? {} : { id: placeId }; rt.world.rows = [fixture()]; rt.world.override = call => call.method === operation ? delayed.promise : null;
            const r = screen(rt, operation === 'DELETE' ? 'personal-place/[id]' : 'personal-place-form'); await r.settle();
            if (operation === 'POST') await fill(r); if (operation === 'DELETE') await click(r, 'Delete Personal Place');
            const submit = button(r, operation === 'POST' ? 'Save Personal Place' : operation === 'PATCH' ? 'Save Changes' : 'Confirm Delete').props.onPress(); await r.settle();
            rt.emit('background'); await r.settle(); delayed.resolve(response(fixture(), operation === 'POST' ? 201 : 200)); await submit; await r.settle();
            assert.equal(rt.world.navigation.length, 0); assert.equal(rt.world.lateUpdates, 0); r.unmount();
        }
    });
    await test('Legacy records survive personal CRUD and sign-out; legacy edit/delete remain local', async () => {
        const rt = runtime(), before = rt.world.local; const api = rt.load('@/lib/personal-places'); const saved = await api.createPersonalPlace('a', fixture(), 'legacy-check');
        await api.updatePersonalPlace('a', saved, fixture({ name: 'Updated' })); await api.deletePersonalPlace('a', fixture({ ...saved, revision: 2 })); rt.switch(null);
        assert.equal(rt.world.local, before); assert.equal(rt.world.localWrites, 0);
        rt.world.params = { id: 'legacy' }; const r = screen(rt, 'add-place'); await r.settle();
        // The legacy name input predates accessibility labels.
        nodes(r.output).find(x => x.type === 'TextInput' && x.props.placeholder === 'Enter a name').props.onChangeText('Changed Local Cafe');
        await r.settle(); await click(r, 'Save Changes'); assert.equal(JSON.parse(rt.world.local)[0].name, 'Changed Local Cafe'); r.unmount();
        const detail = screen(rt, 'place/[id]'); await detail.settle(); await click(detail, 'Delete Place'); await click(detail, 'Cancel'); assert.equal(JSON.parse(rt.world.local).length, 1);
        await click(detail, 'Delete Place'); await click(detail, 'Confirm Delete'); assert.equal(JSON.parse(rt.world.local).length, 0); detail.unmount();
    });
    console.log(`${passed} offline personal Places client/screen checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
