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

function fixture(overrides = {}) {
    return { id: placeId, owner_user_id: 'a', name: 'Private Cafe', address: 'Private Address', cuisine: 'Italian',
        visited_on: '2026-10-07', rating: 4, would_go_again: false, notes: 'Private memory',
        client_request_id: 'original', revision: 1, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z', ...overrides };
}
function response(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }

function runtime(options = {}) {
    const world = { auth: { loading: false, error: '', session: { user: { id: 'a' }, access_token: 'fake-a' } },
        safeAreaInsets: options.safeAreaInsets ?? { top: 0, left: 0, right: 0, bottom: 0 },
        focused: true, params: {}, rows: [], visits: [], receipts: new Map(), journal: new Map(), requests: [], navigation: [], listeners: new Set(), intervals: new Set(), override: null,
        local: JSON.stringify([{ id: 'legacy', name: 'Local Cafe', notes: 'Device memory', wouldGoAgain: false }]), localReads: 0, localWrites: 0, lateUpdates: 0, keyboardDismissals: 0, links: [], removalGuards: new Set() };
    let nextId = 2;
    async function fetchOffline(input, init) {
        const url = new URL(input), method = init.method ?? 'GET', headers = new Headers(init.headers);
        const user = headers.get('Authorization')?.replace('Bearer fake-', '');
        const body = init.body ? JSON.parse(init.body) : undefined;
        const call = { url, method, headers, user, body };
        world.requests.push(call);
        assert.equal(url.origin, 'http://127.0.0.1:1');
        if (options.fetch) return options.fetch(call);
        const override = world.override?.(call);
        if (override) return override;
        if (['/rest/v1/rpc/get_saved_locations','/rest/v1/rpc/get_personal_mapkit_locations'].includes(url.pathname)) return response([]);
        if (url.pathname === '/rest/v1/personal_visits') return response(world.visits.filter(v => v.owner_user_id === user
            && (!url.searchParams.has('personal_place_id') || url.searchParams.get('personal_place_id') === 'eq.' + v.personal_place_id)
            && (!url.searchParams.get('id')?.startsWith('gt.') || v.id > url.searchParams.get('id').slice(3)))
            .sort((a,b)=>a.id.localeCompare(b.id)).slice(0,Number(url.searchParams.get('limit')??world.visits.length)));
        if (url.pathname === '/rest/v1/rpc/get_add_destination_result') return response(world.receipts.has(user + ':' + body.client_request_id) ? [world.receipts.get(user + ':' + body.client_request_id)] : []);
        if (url.pathname === '/rest/v1/rpc/save_personal_visit') {
            const receiptKey = user + ':' + body.client_request_id;
            const existing = world.receipts.get(receiptKey);
            if (existing) return response(existing.entry_id);
            let row = world.rows.find(p => p.owner_user_id === user && p.name === body.restaurant_name && p.address === body.restaurant_address);
            if (!row) { row = fixture({ id: `00000000-0000-0000-0000-${String(nextId++).padStart(12,'0')}`,owner_user_id:user,
                name:body.restaurant_name,address:body.restaurant_address,cuisine:body.restaurant_cuisine,apple_place_id:body.restaurant_apple_place_id,
                client_request_id:'m18:'+body.client_request_id }); world.rows.push(row); }
            world.visits.push({id: `00000000-0000-0000-0001-${String(nextId++).padStart(12,'0')}`,personal_place_id:row.id,owner_user_id:user,
                visited_on:body.visit_date,rating:body.visit_rating,would_go_again:body.visit_would_go_again,notes:body.visit_notes,revision:1,origin:'visit',created_at:'2026-10-17'});
            world.receipts.set(receiptKey,{destination_kind:'personal',group_id:null,entry_id:row.id,visit_id:world.visits.at(-1).id,available:true});
            return response(row.id);
        }
        if (url.pathname === '/rest/v1/rpc/update_personal_place') {
            const row = world.rows.find(p=>p.owner_user_id===user && p.id===body.target_personal_place_id && p.revision===body.expected_revision);
            if (row) Object.assign(row,{name:body.restaurant_name,address:body.restaurant_address,cuisine:body.restaurant_cuisine,revision:row.revision+1});
            return response(row ? [row] : []);
        }
        if (url.pathname === '/rest/v1/rpc/delete_personal_place') {
            const row = world.rows.find(p=>p.owner_user_id===user && p.id===body.target_personal_place_id && p.revision===body.expected_revision);
            if (row) { world.rows=world.rows.filter(p=>p!==row);world.visits=world.visits.filter(v=>v.personal_place_id!==row.id); }
            return response(!!row);
        }
        assert.equal(url.pathname, '/rest/v1/personal_places', 'Unexpected personal fixture request');
        if (method === 'POST' || method === 'PATCH') {
            const allowed = ['name', 'address', 'cuisine', 'visited_on', 'rating', 'would_go_again', 'notes', ...(method === 'POST' ? ['client_request_id', 'apple_place_id'] : [])];
            assert(Object.keys(body).every(key => allowed.includes(key)), 'Immutable columns must not enter mutation payloads');
        }
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
        createContext(value) { const context = { value }; context.Provider = { context }; return context; },
        useContext(context) { return context.value; },
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
    const router = options.router ?? { push: x => world.navigation.push(x), navigate: x => world.navigation.push(x), replace: x => world.navigation.push(x), dismissTo: x => world.navigation.push(x),
        canGoBack: () => world.canGoBack !== false, back: () => world.navigation.push('BACK') };
    const navigation = options.navigation ?? { dispatch: action => options.navigationDispatch
        ? options.navigationDispatch(action) : world.navigation.push(action) };
    const mocks = {
        '@expo/vector-icons/Ionicons': { default: 'Icon' },
        react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
        'react-native': { KeyboardAvoidingView: 'KeyboardAvoidingView', AppState: appState, Modal: 'Modal', ActivityIndicator: 'ActivityIndicator', Keyboard: { dismiss: () => world.keyboardDismissals++ },
            Linking: { async openURL(url) { world.links.push(url); } }, Platform: { OS: options.platform ?? 'web' }, StyleSheet: { create: x => x }, Pressable: 'Pressable', ScrollView: 'ScrollView', View: 'View', Text: 'Text', TextInput: 'TextInput' },
        'expo-router': { Redirect: 'Redirect', useRouter: () => router, useLocalSearchParams: () => world.params,
            useGlobalSearchParams: () => world.params, usePathname: () => world.pathname ?? '/',
            Tabs: Object.assign(props => ({ type: 'Tabs', props: { ...props, children: [props.children, world.tabsScreen ? { type: world.tabsScreen, props: {} } : null] } }), { Screen: 'TabScreen' }),
            Stack: Object.assign(props => ({ type: 'Stack', props }), { Screen: 'StackScreen' }),
            useFocusEffect: cb => react.useEffect(() => world.focused ? cb() : undefined, [world.focused, cb]) },
        '@react-navigation/native': { StackActions: { popToTop: () => ({ type: 'POP_TO_TOP' }) }, TabActions: { jumpTo: name => ({ type: 'JUMP_TO', payload: { name } }) }, useIsFocused: () => world.focused, useNavigation: () => navigation,
            usePreventRemove(enabled, callback) {
                const guard = react.useRef(); guard.current = { enabled, callback };
                react.useEffect(() => { world.removalGuards.add(guard); return () => world.removalGuards.delete(guard); }, []);
            } },
        '@/lib/supabase': { supabase, supabasePublicConfig: { url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_offline_test' } },
        '@/providers/auth': { useAuth: () => world.auth },
        '@/providers/legacy-archive': { useLegacyArchive: () => ({ allowed: options.archiveAllowed ?? true, allow: () => {} }) },
        '@react-native-async-storage/async-storage': { default: { async getItem(key) { if(key !== 'savedPlaces') return world.journal.get(key) ?? null; world.localReads++; return world.local; },
            async setItem(key, value) { if(key !== 'savedPlaces') { world.journal.set(key,value);return; } world.localWrites++; world.local = value; },
            async removeItem(key) { assert.notEqual(key,'savedPlaces');world.journal.delete(key); } } },
        expo: { requireOptionalNativeModule: () => null },
        'react-native-maps': { default: 'MapView', Marker: 'Marker', PROVIDER_DEFAULT: 'default' },
        ...options.mocks,
        // Map fixtures add SafeAreaView; preserve the inset hook used by shared screens.
        'react-native-safe-area-context': { useSafeAreaInsets: () => world.safeAreaInsets,
            ...options.mocks?.['react-native-safe-area-context'] },
    };
    const cache = {};
    function load(name) {
        if (mocks[name]) return mocks[name];
        if (cache[name]) return cache[name];
        const base = path.join(root, name.replace(/^@\//, ''));
        const extensions = options.platform === 'ios' ? ['.ios.ts', '.ios.tsx', '.ts', '.tsx'] : ['.ts', '.tsx'];
        const route = name.startsWith('app/') ? name.slice(4) : null;
        const file = [base, ...(route ? [path.join(root, 'app/(app)/(tabs)', route), ...['(my-places)', '(groups)', '(account)'].map(group => path.join(root, 'app/(app)/(tabs)', group, route)), path.join(root, 'app/(app)', route)] : [])]
            .flatMap(base => [base, path.join(base, 'index')])
            .flatMap(base => extensions.map(ext => base + ext)).find(file => fs.existsSync(file));
        assert(file, 'Unexpected import ' + name);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
        const module = { exports: {} }; cache[name] = module.exports;
        vm.runInNewContext(code, { exports: module.exports, module, require: name => name.startsWith('.') ? load('@/' + path.relative(root, path.resolve(path.dirname(file), name))) : load(name),
            setInterval: callback => { world.intervals.add(callback); return callback; }, clearInterval: callback => world.intervals.delete(callback),
            setTimeout: options.setTimeout ?? setTimeout, clearTimeout: options.clearTimeout ?? clearTimeout,
            fetch: options.autocompleteFetch ?? (() => assert.fail('Unexpected unmocked autocomplete Fetch')),
            process: { env: options.autocompleteEnv ?? {} },
            AbortController, URL, URLSearchParams, Headers, Request, Response, __DEV__: options.development ?? false, Date, console });
        return module.exports;
    }
    function render(Screen, accountBoundary = true) {
        // Match the account-scoped production lifetime above disposable routes.
        const Provider = load('@/providers/group-creation').GroupCreationProvider;
        const AddProvider = load('@/providers/unified-add').UnifiedAddProvider;
        function Boundary() { return accountBoundary ? jsx(Provider, { children: world.auth.session
            ? jsx(AddProvider,{userId:world.auth.session.user.id,children:jsx(Screen,{})},world.auth.session.user.id) : jsx(Screen,{}) }, world.auth.session?.user.id) : jsx(Screen, {}); }
        const frames = new Map();
        const renderer = { dirty: true, output: null, effects: [],
            draw() {
                renderer.dirty = false; renderer.effects = [];
                for (const frame of frames.values()) frame.used = false;
                function visit(element, route) {
                    if (element == null || typeof element === 'boolean') return null;
                    if (Array.isArray(element)) return element.map((x, i) => visit(x, route + '/' + (x?.key ?? i)));
                    if (typeof element !== 'object') return element;
                    if (element.type?.context) {
                        const context = element.type.context, previous = context.value;
                        context.value = element.props.value;
                        const children = visit(element.props.children, route + '/Provider');
                        context.value = previous;
                        return children;
                    }
                    if (typeof element.type === 'function') {
                        options.observeComponent?.(element.type, element.props);
                        const key = route + ':' + element.type.name + ':' + (element.key ?? '');
                        const frame = frames.get(key) ?? { slots: [], alive: true, renderer };
                        frames.set(key, frame); frame.used = true; frame.cursor = 0;
                        const previous = current; current = frame;
                        const output = element.type(element.props); current = previous;
                        return visit(output, key);
                    }
                    const children = element.type === 'Pressable' && typeof element.props.children === 'function'
                        ? element.props.children({ pressed: world.pressed ?? false }) : element.props.children;
                    return { ...element, props: { ...element.props, children: visit(children, route + '/' + element.type) } };
                }
                renderer.output = visit(jsx(Boundary, {}), 'root');
                for (const [key, frame] of frames) if (!frame.used) { frame.alive = false; frame.slots.forEach(slot => slot.cleanup?.()); frames.delete(key); }
                renderer.effects.splice(0).forEach(fn => fn());
            },
            async settle() { for (let i = 0; i < 35; i++) { if (renderer.dirty) renderer.draw(); await new Promise(resolve => setImmediate(resolve)); } assert(!renderer.dirty, 'Render did not settle'); },
            unmount() { for (const frame of frames.values()) { frame.alive = false; frame.slots.forEach(slot => slot.cleanup?.()); } frames.clear(); },
        };
        return renderer;
    }
    return { world, load, render, supabase,
        attemptRemoval(action, proceed = () => navigation.dispatch(action)) {
            const guard = [...world.removalGuards].find(guard => guard.current.enabled);
            if (guard) { guard.current.callback({ data: { action } }); return true; }
            proceed(); return false;
        },
        poll() { [...world.intervals].forEach(fn => fn()); },
        emit(state) { appState.currentState = state; [...world.listeners].forEach(fn => fn(state)); }, switch(user, renderer) {
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
function button(r, label) { const b = nodes(r.output).find(n => n.type === 'Pressable' && (n.props.accessibilityLabel === label || textOf(n.props.children) === label)); assert(b, 'Missing ' + label + ': ' + textOf(r.output)); return b; }
async function click(r, label) { const b = button(r, label); assert(!b.props.disabled, label + ' disabled'); await b.props.onPress(); await r.settle(); }
async function enter(r, label, value) { const input = nodes(r.output).find(n => n.type === 'TextInput' && n.props.accessibilityLabel === label); assert(input); assert(input.props.editable); input.props.onChangeText(value); await r.settle(); }
async function fill(r) { await enter(r, 'Restaurant name', ' New Cafe '); await enter(r, 'Restaurant address', ' New Address '); await enter(r, 'Private notes', ' New memory '); }
// The actual app layout owns its provider and must itself survive auth changes.
function screen(rt, name) { return rt.render(rt.load('app/' + name).default, name !== '(app)/_layout'); }

module.exports = { runtime, fixture, response, screen, click, enter, fill, button, nodes, textOf };

// M18 intentionally replaces single-memory creation and direct-write contracts.
if (require.main === module) require('./unified-add.cjs').run('personal').catch(error => { console.error(error); process.exitCode = 1; });
