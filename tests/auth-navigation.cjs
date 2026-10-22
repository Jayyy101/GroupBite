// Offline auth/layout/screen checks; real Supabase provider and installed Router
// path parsing/reducers, with native UI, transport and storage mocked in memory.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runtime, screen, click, enter, nodes, textOf } = require('./personal-places.cjs');
let passed = 0;
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function test(label, fn) { await fn(); passed++; console.log('PASS ' + label); }

function layoutRuntime() {
    let rt;
    const Stack = Object.assign(props => ({ type: 'PrivateStack', props: { ...props,
        children: rt.world.route ? { type: rt.world.route, props: {} } : props.children } }), { Screen: 'StackScreen' });
    rt = runtime({ mocks: {
        'expo-router': { Stack, Redirect: 'Redirect', usePathname: () => rt.world.pathname ?? '/',
            useGlobalSearchParams: () => rt.world.params, useLocalSearchParams: () => rt.world.params,
            useRouter: () => ({ push: x => rt.world.navigation.push(x), replace: x => rt.world.navigation.push(x) }),
            useFocusEffect: cb => rt.load('react').useEffect(() => rt.world.focused ? cb() : undefined, [rt.world.focused, cb]) },
        '@/providers/legacy-archive': undefined,
    } });
    return rt;
}

(async () => {
    await test('Session restoration blocks all private routes and preserves deep-link query parameters', async () => {
        const rt = layoutRuntime(); rt.world.pathname = '/add-visit'; rt.world.params = { groupId: 'group-a' };
        rt.world.auth.loading = true;
        const r = screen(rt, '(app)/_layout'); await r.settle();
        assert(textOf(r.output).includes('Restoring your session'));
        assert(!nodes(r.output).some(n => n.type === 'PrivateStack')); assert.equal(rt.world.requests.length, 0);
        rt.switch(null, r); await r.settle();
        assert.equal(r.output.type, 'Redirect'); assert.equal(r.output.props.href.pathname, '/auth');
        assert.equal(r.output.props.href.params.returnTo, '/add-visit?groupId=group-a');
        rt.switch('a', r); await r.settle(); assert.equal(r.output.type, 'PrivateStack');
        rt.switch(null, r); await r.settle(); assert.equal(r.output.props.href.params.returnTo, '/'); r.unmount();
    });
    await test('A hidden app anchor cannot replace an active auth deep-link destination', async () => {
        const rt = layoutRuntime(); rt.switch(null); rt.world.focused = false;
        rt.world.pathname = '/auth'; rt.world.params = { returnTo: '/group/a' };
        const r = screen(rt, '(app)/_layout'); await r.settle();
        assert.equal(r.output, null); assert.equal(rt.world.navigation.length, 0); r.unmount();
    });
    await test('Sign-out and direct account replacement dispose private route state', async () => {
        const rt = layoutRuntime(), react = rt.load('react');
        rt.world.route = function PrivateDraft() {
            const [value, setValue] = react.useState('');
            return { type: 'TextInput', props: { accessibilityLabel: 'Private draft', value, editable: true, onChangeText: setValue } };
        };
        const r = screen(rt, '(app)/_layout'); await r.settle(); await enter(r, 'Private draft', 'A-only memory');
        rt.switch('b', r); await r.settle(); assert.equal(r.output.props.children.props.value, '');
        rt.switch(null, r); await r.settle(); assert(!textOf(r.output).includes('A-only memory'));
        assert.equal(r.output.type, 'Redirect'); r.unmount();
    });
    await test('Actual app layout retains Join uncertainty across route remount/token refresh and disposes it per account', async () => {
        const rt = layoutRuntime(), { useJoinRequest } = rt.load('@/providers/join-request');
        let join;
        function Probe() { join = useJoinRequest(); return null; }
        rt.world.route = Probe;
        const r = screen(rt, '(app)/_layout'); await r.settle();
        const attempt = join.begin(); r.dirty = true; await r.settle();
        join.settle(attempt, true); r.dirty = true; await r.settle(); const uncertain = join.attempt;
        rt.world.route = () => null; r.dirty = true; await r.settle();
        rt.world.route = Probe; r.dirty = true; await r.settle(); assert.equal(join.attempt, uncertain);
        rt.switch('a', r); await r.settle(); assert.equal(join.attempt, uncertain);
        const old = join; rt.switch('b', r); await r.settle(); assert.equal(join.attempt, null);
        assert.equal(old.acknowledge(uncertain), false);
        const next = join.begin(); r.dirty = true; await r.settle(); const oldAccount = join;
        rt.switch(null, r); await r.settle(); assert.equal(oldAccount.settle(next, true), false);
        assert.equal(r.output.type, 'Redirect'); assert.equal(rt.world.requests.length, 0); r.unmount();
    });
    await test('Auth resumes only known internal links, retaining legacy editor and dynamic-route parameters', async () => {
        const rt = runtime(), api = rt.load('@/lib/auth-navigation');
        for (const value of ['https://evil.test', '//evil.test', '/auth', ['/', '/groups'], '/group/a/../auth', '/unknown', '/groups#x']) {
            assert.equal(api.safeAuthReturnTo(value), '/');
        }
        assert.equal(api.authReturnTo('/personal-place-form', { id: 'edit-me' }), '/personal-place-form?id=edit-me');
        assert.equal(api.authReturnTo('/add-place', { id: 'legacy' }), '/add-place?id=legacy');
        assert.equal(api.authReturnTo('/group/a/restaurant/b', { id: 'a', entryId: 'b', source: 'link' }), '/group/a/restaurant/b?source=link');
        assert.equal(api.authReturnTo('/add/group/a/restaurant/b', { id: 'a', entryId: 'b' }), '/add/group/a/restaurant/b');
        assert.equal(api.safeAuthReturnTo('/join-group'), '/join-group');
        assert.equal(api.authReturnTo('/join-group', {}), '/join-group');
        assert.equal(api.safeAuthReturnTo('/create-group'), '/create-group');
        assert.equal(api.authReturnTo('/create-group', {}), '/create-group');
        assert.equal(api.safeAuthReturnTo('/add/personal-place/a'), '/add/personal-place/a');
        assert.equal(api.safeAuthReturnTo('/add/group/a/restaurant/b'), '/add/group/a/restaurant/b');
        assert.equal(api.safeAuthReturnTo('/add/other-route'), '/');
        rt.world.params = { returnTo: '/add-visit?groupId=group-a' };
        const r = screen(rt, 'auth'); await r.settle(); assert.equal(r.output.props.href, rt.world.params.returnTo); r.unmount();
        rt.switch(null); const auth = screen(rt, 'auth'); await auth.settle();
        assert(textOf(auth.output).includes('Sign In')); assert(!textOf(auth.output).includes('Back'));
        assert.equal(rt.world.requests.length, 0); auth.unmount();
    });
    await test('Existing password login and signup stay unchanged, without extra verification challenges', async () => {
        const rt = runtime(); rt.switch(null); const calls = [];
        rt.supabase.auth.signInWithPassword = async value => { calls.push(['password', value]); return { error: null }; };
        rt.supabase.auth.signUp = async value => { calls.push(['signup', value]); return { data: { session: {} }, error: null }; };
        const r = screen(rt, 'auth'); await r.settle();
        await enter(r, 'Email', ' friend@example.test '); await enter(r, 'Password', 'password'); await click(r, 'Sign In');
        assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['password', { email: 'friend@example.test', password: 'password' }]);
        await click(r, 'Create an Account'); await enter(r, 'Display name', ' Friend '); await enter(r, 'Password', 'password'); await click(r, 'Sign Up');
        assert.equal(calls[1][0], 'signup'); assert.equal(calls[1][1].options.data.display_name, 'Friend'); r.unmount();
    });
    await test('Account shows the current email, blocks duplicate sign-out and clears identity on sign-out', async () => {
        const rt = runtime(), pending = defer(); rt.world.auth.session.user.email = 'a@example.test';
        const calls = []; rt.supabase.auth.signOut = options => { calls.push(options); return pending.promise; };
        const r = screen(rt, 'account'); await r.settle(); assert(textOf(r.output).includes('a@example.test'));
        const handler = nodes(r.output).find(n => n.type === 'Pressable' && textOf(n.props.children) === 'Sign Out').props.onPress;
        const attempt = handler(); await handler(); assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ scope: 'local' }]);
        rt.switch(null, r); await r.settle(); assert.equal(r.output, null);
        pending.resolve({ error: null }); await attempt; await r.settle(); assert.equal(rt.world.lateUpdates, 0);
        assert.equal(rt.world.localWrites, 0); assert.equal(rt.world.navigation.length, 0); r.unmount();
    });
    await test('A failed sign-out keeps the current account visible and permits an explicit retry', async () => {
        const rt = runtime(); rt.world.auth.session.user.email = 'a@example.test';
        let calls = 0; rt.supabase.auth.signOut = async () => ({ error: ++calls === 1 ? new Error('offline') : null });
        const r = screen(rt, 'account'); await r.settle(); await click(r, 'Sign Out');
        assert(textOf(r.output).includes('a@example.test')); assert(nodes(r.output).some(n => n.props?.accessibilityRole === 'alert'));
        await click(r, 'Sign Out'); assert.equal(calls, 2); r.unmount();
    });
    await test('Every legacy URL gates storage reads; acknowledgement resets for the next account/session', async () => {
        for (const name of ['saved-places', 'place/[id]', 'add-place']) {
            const rt = layoutRuntime(); rt.world.params = { id: 'legacy' }; rt.world.route = rt.load('app/' + name).default;
            const before = rt.world.local, r = screen(rt, '(app)/_layout'); await r.settle();
            assert(textOf(r.output).includes('not linked to any account')); assert(!textOf(r.output).includes('Local Cafe'));
            assert.equal(rt.world.localReads, 0); assert.equal(rt.world.localWrites, 0);
            await click(r, 'These are my records — open archive'); assert(rt.world.localReads > 0);
            const reads = rt.world.localReads;
            rt.switch('b', r); await r.settle(); assert(textOf(r.output).includes('not linked to any account'));
            assert.equal(rt.world.localReads, reads); assert(!textOf(r.output).includes('Local Cafe'));
            rt.switch(null, r); await r.settle(); rt.switch('a', r); await r.settle();
            assert(textOf(r.output).includes('not linked to any account')); assert.equal(rt.world.local, before);
            assert.equal(rt.world.localWrites, 0); r.unmount();
        }
    });
    await test('Add launches the unified form and never writes memories', async () => {
        const rt = runtime(), r = screen(rt, 'add'); await r.settle();
        await click(r, 'Enter Restaurant Manually'); assert.equal(rt.world.navigation.at(-1), '/add-visit');
        assert(rt.world.requests.every(call=>call.url.pathname.endsWith('/get_recent_add_restaurants'))); assert.equal(rt.world.localWrites, 0); r.unmount();
    });
    await test('Supabase restoration, auth events and refresh lifecycle remain persistent and race-safe', async () => {
        const rt = runtime({ platform: 'ios', mocks: { '@/providers/auth': undefined } }), pending = defer(), events = [];
        let onAuth;
        rt.supabase.auth.getSession = () => pending.promise;
        rt.supabase.auth.onAuthStateChange = cb => { onAuth = cb; return { data: { subscription: { unsubscribe: () => events.push('unsubscribe') } } }; };
        rt.supabase.auth.startAutoRefresh = () => events.push('start'); rt.supabase.auth.stopAutoRefresh = () => events.push('stop');
        const react = rt.load('react'), provider = rt.load('@/providers/auth');
        function Probe() { const state = provider.useAuth(); return { type: 'Probe', props: { state } }; }
        function Harness() { return { type: provider.AuthProvider, props: { children: { type: Probe, props: {} } } }; }
        const r = rt.render(Harness); await r.settle(); assert(r.output.props.state.loading);
        onAuth('SIGNED_IN', { user: { id: 'b' } }); await r.settle();
        pending.resolve({ data: { session: { user: { id: 'a' } } }, error: null }); await r.settle();
        assert.equal(r.output.props.state.session.user.id, 'b'); assert(!r.output.props.state.loading);
        rt.emit('background'); await r.settle(); rt.emit('active'); await r.settle();
        onAuth('SIGNED_OUT', null); await r.settle(); assert.equal(r.output.props.state.session, null);
        r.unmount(); assert.deepEqual(events, ['start', 'stop', 'start', 'unsubscribe', 'stop']);
        const source = fs.readFileSync(path.join(__dirname, '../lib/supabase.ts'), 'utf8');
        assert(source.includes('storage: AsyncStorage')); assert(source.includes('persistSession: true')); assert(source.includes('autoRefreshToken: true'));
        assert(source.includes('detectSessionInUrl: false')); assert.equal(rt.world.localWrites, 0);
        assert(react);
    });

    const { validatePathConfig } = await import('@react-navigation/core');
    const { StackRouter, TabRouter } = await import('@react-navigation/routers');
    const routerBase = path.dirname(require.resolve('expo-router/build/getRoutes'));
    const cache = {};
    function routerModule(relative) {
        const filename = path.resolve(routerBase, relative);
        if (cache[filename]) return cache[filename].exports;
        const module = { exports: {} }; cache[filename] = module;
        let source = fs.readFileSync(filename, 'utf8');
        if (filename.endsWith('/global-state/routing.js')) source += '\nexports.getNavigateAction = getNavigateAction;';
        vm.runInNewContext(source, { module, exports: module.exports, console, process, URL, URLSearchParams,
            require(name) {
                if (name === '@react-navigation/native') return { validatePathConfig };
                if (['expo/dom', 'expo-linking', 'react-native', './router-store', '../domComponents/emitDomEvent', '../getRoutesRedirects', '../link/href'].includes(name)) return {};
                if (name.startsWith('.')) return routerModule(path.relative(routerBase, path.resolve(path.dirname(filename), name + '.js')));
                return require(name);
            } });
        return module.exports;
    }
    await test('Installed Expo Router resolves old URLs into one gated app and exactly five tabs', async () => {
        const rt = runtime({ mocks: { '@expo/vector-icons/Ionicons': { default: 'Icon' },
            'expo-router': { Tabs: Object.assign(props => ({ type: 'Tabs', props }), { Screen: 'TabScreen' }) } } });
        const tabs = screen(rt, '(app)/(tabs)/_layout'); await tabs.settle();
        assert.deepEqual(nodes(tabs.output).filter(n => n.type === 'TabScreen').map(n => n.props.options.title), ['Home', 'My Places', 'Add', 'Groups', 'Account']); tabs.unmount();
        const keys = fs.readdirSync(path.join(__dirname, '../app'), { recursive: true }).filter(p => p.endsWith('.tsx')).map(p => './' + p);
        const context = key => ({ default: () => null, ...(key.endsWith('_layout.tsx') ? {
            unstable_settings: rt.load('app/' + key.slice(2, -4)).unstable_settings,
        } : {}) }); context.keys = () => keys;
        const tree = require('expo-router/build/getRoutes').getRoutes(context, { platform: 'ios', skipGenerated: true });
        const config = require('expo-router/build/getReactNavigationConfig').getReactNavigationConfig(tree, true);
        const { getStateFromPath } = routerModule('fork/getStateFromPath.js');
        const paths = ['/', '/my-places', '/add', '/groups', '/account', '/add-visit?groupId=a', '/personal-place-form?id=b',
            '/personal-place/a', '/group/a', '/group/a/restaurant/b', '/saved-places', '/place/a', '/add-place?id=a', '/dev-map', '/dev-apple-search', '/home/personal-place/a', '/home/group/a', '/home/group/a/restaurant/b', '/home/saved-map'];
        for (const url of paths) {
            const state = getStateFromPath(url, config), app = state.routes.at(-1);
            assert.equal(app.name, '(app)', url); assert(app.state, url);
        }
        assert.equal(getStateFromPath('/auth', config).routes.at(-1).name, 'auth');
        const appNode = tree.children.find(n => n.route === '(app)');
        assert.equal(appNode.children.find(n => n.route === '(tabs)').children.length, 5);
        // Exercise installed routing action selection across the new tab/stack boundary.
        const stack = StackRouter({}), tab = TabRouter({ backBehavior: 'history', initialRouteName: '(home)' });
        const tabOptions = { routeNames: ['(home)', '(my-places)', 'add', '(groups)', '(account)'], routeParamList: {}, routeGetIdList: {} };
        let tabState = tab.getInitialState(tabOptions);
        const appOptions = { routeNames: appNode.children.map(n => n.route), routeParamList: {}, routeGetIdList: {} };
        let appState = stack.getRehydratedState({ stale: true, routes: [{ name: '(tabs)', state: tabState }, { name: 'add-visit' }], index: 1 }, appOptions);
        const rootState = { type: 'stack', key: 'root', index: 0, routes: [{ name: '(app)', state: appState }] };
        const action = routerModule('global-state/routing.js').getNavigateAction(getStateFromPath('/groups', config), rootState, 'POP_TO');
        assert.equal(action.target, appState.key); assert.equal(action.payload.name, '(tabs)');
        appState = stack.getStateForAction(appState, action, appOptions);
        assert.equal(appState.routes.length, 1); assert.equal(appState.routes[0].name, '(tabs)');
        tabState = tab.getStateForAction(tabState, { type: 'NAVIGATE', payload: { name: action.payload.params.screen, params: action.payload.params.params } }, tabOptions);
        assert.equal(tabState.routes[tabState.index].name, '(groups)');
    });
    await test('Auth resumes only known Home browsing links and removes duplicate path parameters', () => {
        const nav=runtime().load('@/lib/auth-navigation');
        for(const path of ['/home/personal-place/a','/home/group/a','/home/group/a/restaurant/b','/home/saved-map'])assert.equal(nav.safeAuthReturnTo(path),path);
        for(const path of ['/home/unknown','/home/group/a/manage','/home/../account','https://example.test/home/group/a'])assert.equal(nav.safeAuthReturnTo(path),'/');
        assert.equal(nav.authReturnTo('/home/group/a/restaurant/b',{id:'a',entryId:'b'}),'/home/group/a/restaurant/b');
    });
    console.log(`${passed} offline authentication/navigation checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
