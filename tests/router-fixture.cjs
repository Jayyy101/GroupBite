// Installed Expo URL/action generation + installed React Navigation reducers.
// Native event delivery and useNavigationBuilder's nested-param consumption are
// modeled here; no native rendering, auth service or HTTP is involved.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runtime } = require('./personal-places.cjs');
module.exports = async function routing() {
    const { validatePathConfig } = await import('@react-navigation/core');
    const { StackRouter, TabRouter } = await import('@react-navigation/routers');
    const base = path.dirname(require.resolve('expo-router/build/getRoutes')), cache = {};
    function load(relative) {
        const file = path.resolve(base, relative);
        if (cache[file]) return cache[file].exports;
        const module = { exports: {} }; cache[file] = module;
        let code = fs.readFileSync(file, 'utf8');
        if (file.endsWith('/global-state/routing.js')) code += '\nexports.getNavigateAction = getNavigateAction;';
        vm.runInNewContext(code, { module, exports: module.exports, console, process, URL, URLSearchParams,
            require(name) {
                if (name === '@react-navigation/native') return { validatePathConfig };
                if (['expo/dom', 'expo-linking', 'react-native', './router-store', '../domComponents/emitDomEvent', '../getRoutesRedirects', '../link/href'].includes(name)) return {};
                if (name.startsWith('.')) return load(path.relative(base, path.resolve(path.dirname(file), name + '.js')));
                return require(name);
            } });
        return module.exports;
    }
    const rt = runtime();
    const keys = fs.readdirSync(path.join(__dirname, '../app'), { recursive: true }).filter(p => p.endsWith('.tsx')).map(p => './' + p);
    const context = key => ({ default: () => null, ...(key.endsWith('_layout.tsx') ? {
        unstable_settings: rt.load('app/' + key.slice(2, -4)).unstable_settings,
    } : {}) }); context.keys = () => keys;
    const tree = require('expo-router/build/getRoutes').getRoutes(context, { platform: 'ios', skipGenerated: true });
    const config = require('expo-router/build/getReactNavigationConfig').getReactNavigationConfig(tree, true);
    const { getStateFromPath } = load('fork/getStateFromPath.js');
    const { getNavigateAction } = load('global-state/routing.js');
    const parse = href => {
        if (typeof href === 'string') return getStateFromPath(href, config);
        let url = href.pathname; const query = new URLSearchParams();
        for (const [key, value] of Object.entries(href.params ?? {})) {
            if (url.includes('[' + key + ']')) url = url.replace('[' + key + ']', value);
            else query.set(key, value);
        }
        return getStateFromPath(url + (query.size ? '?' + query : ''), config);
    };
    function history(url = '/') {
        const routers = new Map(), nodes = new Map();
        const options = node => ({ routeNames: node.children.map(n => n.route), routeParamList: {}, routeGetIdList: {} });
        function hydrate(partial, node, params) {
            const router = node.route === '(tabs)' ? TabRouter({ initialRouteName: '(home)', backBehavior: 'history' }) : StackRouter({ initialRouteName: node.initialRouteName });
            let state = partial ? router.getRehydratedState(partial, options(node)) : params?.screen && params.initial !== false
                ? router.getRehydratedState({ stale: true, routes: [{ name: params.screen, params: params.params }] }, options(node)) : router.getInitialState(options(node));
            routers.set(state.key, router); nodes.set(state.key, node);
            if (!partial && params?.screen && params.initial === false) state = router.getStateForAction(state,
                { type: 'NAVIGATE', payload: { name: params.screen, params: params.params, pop: params.pop } }, options(node));
            state = { ...state, routes: state.routes.map(route => {
                const child = node.children.find(n => n.route === route.name);
                return child.children.length && (route.state || route.params?.screen || route === state.routes[state.index])
                    ? { ...route, state: hydrate(route.state, child, route.params) } : route;
            }) };
            return state;
        }
        let state = hydrate(parse(url), tree);
        function consume(childState, node, params) {
            if (!childState) return hydrate(undefined, node, params);
            if (!params?.screen) return childState;
            const router = routers.get(childState.key);
            let next = router.getStateForAction(childState, { type: 'NAVIGATE', payload: { name: params.screen, params: params.params, pop: params.pop } }, options(node));
            assert(next, 'Nested NAVIGATE handled');
            next = { ...next, routes: next.routes.map(route => {
                const child = node.children.find(n => n.route === route.name);
                return route === next.routes[next.index] && child.children.length
                    ? { ...route, state: consume(route.state, child, route.params) } : route;
            }) };
            return next;
        }
        function dispatch(action) {
            let handled = false;
            function apply(current) {
                if (!current) return current;
                if (current.key === action.target) {
                    const node = nodes.get(current.key), next = routers.get(current.key).getStateForAction(current, action, options(node));
                    assert(next, 'Unhandled action ' + JSON.stringify(action)); handled = true;
                    return { ...next, routes: next.routes.map(route => {
                        const child = node.children.find(n => n.route === route.name);
                        return route === next.routes[next.index] && child.children.length
                            ? { ...route, state: consume(route.state, child, route.params) } : route;
                    }) };
                }
                return { ...current, routes: current.routes.map(route => ({ ...route, ...(route.state ? { state: apply(route.state) } : {}) })) };
            }
            state = apply(state); assert(handled, 'Action target exists');
        }
        const chain = () => { const result = []; let s = state; while (s) { const r = s.routes[s.index]; result.push(r); s = r.state; } return result; };
        const tabState = () => chain().find(r => r.name === '(tabs)')?.state;
        const route = (type, href, options) => dispatch(getNavigateAction(parse(href), state, type, options?.withAnchor));
        const router = { push: (href, opts) => route('PUSH', href, opts), navigate: (href, opts) => route('NAVIGATE', href, opts),
            replace: (href, opts) => route('REPLACE', href, opts), dismissTo: (href, opts) => route('POP_TO', href, opts),
            canGoBack: () => chain().some(r => r.state?.type === 'stack' && r.state.index > 0),
            back() {
                const stacks = [state, ...chain().map(r => r.state)].filter(s => s?.type === 'stack' && s.index > 0);
                assert(stacks.length, 'Back has a stack anchor'); dispatch({ type: 'POP', payload: { count: 1 }, target: stacks.at(-1).key });
            } };
        function select(name) {
            const tabs = tabState(), target = tabs.routes.find(r => r.name === name); assert(target);
            // Native-stack's reselect listener + bottom-tabs popToTopOnBlur.
            const previous = tabs.routes[tabs.index];
            const reset = name === previous.name ? target : previous;
            if (reset.state?.type === 'stack' && reset.state.index) dispatch({ type: 'POP_TO_TOP', target: reset.state.key });
            dispatch({ type: 'JUMP_TO', payload: { name }, target: tabs.key });
        }
        function allNames(current = state) { return current.routes.flatMap(r => [r.name, ...(r.state ? allNames(r.state) : [])]); }
        return { router, dispatch, select, chain, current: () => chain().at(-1), state: () => state, tabState, allNames };
    }
    return { history, parse, tree, config };
};
