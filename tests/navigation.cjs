// Actual screens and Expo route/action discovery, installed nested stack/tab
// reducers, synthetic auth and offline transport. Native event delivery is modeled.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { runtime, fixture, response, screen, click, enter, fill, nodes, textOf, button } = require('./personal-places.cjs');
const routing = require('./router-fixture.cjs');
const groupId = '22222222-2222-2222-2222-222222222222';
const otherGroupId = '33333333-3333-3333-3333-333333333333';
const restaurantId = '44444444-4444-4444-4444-444444444444';
const entryId = '55555555-5555-5555-5555-555555555555';
const restaurant = { id: entryId, restaurant_id: restaurantId, name: 'Cafe', address: 'Address', cuisine: null };
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let passed = 0;
async function test(label, fn) { await fn(); passed++; console.log('PASS ' + label); }
function noForms(h) { assert(!h.allNames().some(n => ['personal-place-form', 'add-visit', 'add-place'].includes(n))); }
function backend(call) {
    switch (call.url.pathname) {
        case '/rest/v1/groups': return response([{ id: groupId, name: 'Dinner', owner_user_id: 'a' }, { id: otherGroupId, name: 'Lunch', owner_user_id: 'a' }]);
        case '/rest/v1/join_requests': return response([]);
        case '/rest/v1/restaurants': return response({ id: restaurantId, name: 'Cafe', address: 'Address', cuisine: null });
        case '/rest/v1/rpc/save_restaurant_visit': return response(restaurantId);
        case '/rest/v1/rpc/get_group_restaurants': return response([restaurant]);
        default: assert.fail('Unexpected request: ' + call.url.pathname);
    }
}
function tabPress(r, h, name) {
    const tab = nodes(r.output).find(n => n.type === 'Tabs');
    const route = h.tabState().routes.find(r => r.name === name);
    const navigation = { getState: h.tabState, dispatch: h.dispatch };
    let prevented = false;
    tab.props.screenListeners({ navigation, route }).tabPress({ preventDefault() { prevented = true; } });
    if (!prevented) h.select(name);
    return prevented;
}
(async () => {
    const { history, parse } = await routing();
    await test('Every browsing URL has a unique native stack under its designated tab and a root anchor', () => {
        for (const [path, tab, root] of [
            ['/personal-place/a', '(my-places)', 'my-places'], ['/group/a', '(groups)', 'groups'],
            ['/group/a/restaurant/b', '(groups)', 'groups'], ['/saved-places', '(account)', 'account'], ['/place/a', '(account)', 'account'],
        ]) {
            const h = history(path); assert.deepEqual(h.chain().slice(0, 3).map(r => r.name), ['(app)', '(tabs)', tab]);
            const section = h.chain()[2].state; assert.equal(section.routes[0].name, root); assert(section.index > 0);
            const identity = h.current().params; h.router.back(); assert.equal(h.current().name, root);
            if (path.includes('/restaurant/')) { assert.equal(identity.id, 'a'); assert.equal(identity.entryId, 'b'); }
        }
        for (const path of ['/personal-place-form', '/add-visit', '/add-place?id=legacy']) {
            assert.equal(history(path).chain()[1].name, path.split('?')[0].slice(1));
        }
        assert(parse('/auth')); // Auth remains outside the gated tree.
    });
    await test('Styled tabs keep five labels/icons, show above the keyboard, and reset nested stacks on blur/reselect', async () => {
        const rt = runtime({ platform: 'ios' }), r = screen(rt, '(app)/(tabs)/_layout'); await r.settle();
        const tabs = nodes(r.output).find(n => n.type === 'Tabs');
        assert.equal(nodes(r.output).find(n => n.type === 'KeyboardAvoidingView').props.behavior, 'padding');
        assert.deepEqual(nodes(r.output).filter(n => n.type === 'TabScreen').map(n => n.props.options.title), ['Home', 'My Places', 'Add', 'Groups', 'Account']);
        assert(tabs.props.screenOptions({ route: { name: 'index' } }).popToTopOnBlur);
        assert.equal(tabs.props.screenOptions({ route: { name: 'index' } }).tabBarHideOnKeyboard, false);
        for (const [path, section, root] of [['/personal-place/a', '(my-places)', 'my-places'], ['/group/a/restaurant/b', '(groups)', 'groups'], ['/place/a', '(account)', 'account']]) {
            const h = history(path); h.select(section); assert.equal(h.current().name, root);
            h.router.push(path, { withAnchor: true }); h.select('index'); h.select(section); assert.equal(h.current().name, root);
        }
        r.unmount();
    });
    await test('Installed Expo native-stack reselect listener pops its own tab and respects prevented presses', () => {
        for (const prevented of [false, true]) {
            const h = history('/personal-place/a'); let listener; const frames = [];
            const state = h.chain()[2].state;
            const navigation = { isFocused: () => true, dispatch: h.dispatch,
                addListener(type, callback) { assert.equal(type, 'tabPress'); listener = callback; return () => {}; } };
            const file = require.resolve('expo-router/build/fork/native-stack/createNativeStackNavigator');
            const source = fs.readFileSync(file, 'utf8') + '\nexports.NativeStackNavigator = NativeStackNavigator;';
            const code = ts.transpileModule(source, { fileName: 'native-stack.tsx', compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
            const module = { exports: {} };
            vm.runInNewContext(code, { module, exports: module.exports, requestAnimationFrame: callback => frames.push(callback),
                require(name) {
                    if (name === 'react') return { useEffect: fn => fn(), useMemo: fn => fn(), useState: () => [null, () => {}] };
                    if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
                    if (name === '@react-navigation/native') return { StackActions: { popToTop: () => ({ type: 'POP_TO_TOP' }) },
                        useNavigationBuilder: () => ({ state, navigation, descriptors: {}, NavigationContent: () => null }) };
                    if (name === '@react-navigation/native-stack') return { NativeStackView: () => null };
                    if (name.endsWith('LinkPreviewContext')) return { useLinkPreviewContext: () => ({}) };
                    assert.fail('Unexpected native-stack import ' + name);
                } });
            module.exports.NativeStackNavigator({}); listener({ defaultPrevented: prevented }); frames.forEach(fn => fn());
            assert.equal(h.current().name, prevented ? 'personal-place/[id]' : 'my-places');
        }
    });
    await test('Groups stack hides native headers on every platform; no native material or reserved bar remains', async () => {
        for (const platform of ['ios', 'android', 'web']) {
            const rt = runtime({ platform }), r = screen(rt, '(app)/(tabs)/(groups)/_layout'); await r.settle();
            assert.equal(r.output.type, 'Stack');
            assert.equal(r.output.props.screenOptions.headerShown, false);
            assert.equal(r.output.props.screenOptions.headerBlurEffect, undefined);
            assert.equal(nodes(r.output).filter(n => n.type === 'StackScreen').length, 0);
            r.unmount();
        }
    });
    function restaurantBackend(call) {
        if (call.url.pathname.endsWith('/get_group_restaurants')) return response([{ ...restaurant, average_rating: null, rated_visit_count: 0, total_visit_count: 1 }]);
        if (call.url.pathname === '/rest/v1/groups') return response({ id: groupId, name: 'Dinner', owner_user_id: 'a' });
        if (call.url.pathname === '/rest/v1/group_memberships') return response({ membership_id: 'member' });
        if (call.url.pathname.endsWith('/get_group_restaurant_visits')) return response([
            { id: 'visit', creator_display_name: 'Member', can_manage: true, visited_on: null, rating: null, would_go_again: null, notes: 'Original' },
        ]);
        return backend(call);
    }
    const flatten = style => Object.assign({}, ...[typeof style === 'function' ? style({ pressed: false }) : style].flat(Infinity).filter(Boolean));
    const clipboard = { 'expo-clipboard': { setStringAsync: async () => true } };
    function groupBackend(call) {
        if (call.url.pathname === '/rest/v1/groups') return response({ id: groupId, name: 'Dinner', owner_user_id: 'b' });
        if (call.url.pathname.endsWith('/get_group_members')) return response([]);
        return restaurantBackend(call);
    }
    function assertScaffold(r, insets, hasBack, edgeToEdge = false) {
        const scroll = nodes(r.output).find(n => n.type === 'ScrollView');
        const root = flatten(r.output.props.style), content = flatten(scroll.props.contentContainerStyle);
        assert.equal(root.backgroundColor, '#FFF8F0');
        assert.equal(root.paddingTop, edgeToEdge ? undefined : insets.top, 'Detail viewport begins at screen top, not below a protected navigation row');
        assert.equal(root.paddingBottom, undefined, 'Tabs already own the bottom safe area');
        assert.equal(content.paddingLeft, Math.max(24, insets.left));
        assert.equal(content.paddingRight, Math.max(24, insets.right));
        if (edgeToEdge) {
            assert.equal(content.paddingTop, insets.top + 4 + 44 + 8, 'Title starts eight points below the stationary Back target');
            assert.equal(scroll.props.scrollIndicatorInsets.top, insets.top);
            assert.equal(flatten(scroll.props.style).marginTop, undefined);
            assert.equal(flatten(scroll.props.style).paddingTop, undefined);
            assert.equal(nodes(r.output).filter(n => n.type === 'StackScreen').length, 0, 'No native headerLeft or material remains');
        } else assert(content.paddingTop >= 12 && content.paddingTop <= 24, 'No duplicate top inset or large header spacer');
        assert.equal(content.paddingBottom, 32);
        assert.equal(flatten(scroll.props.style).flex, 1);
        assert.equal(flatten(scroll.props.style).overflow, 'hidden');
        assert.equal(scroll.props.contentInsetAdjustmentBehavior, 'never');
        assert.equal(scroll.props.automaticallyAdjustContentInsets, false);
        assert.equal(scroll.props.automaticallyAdjustsScrollIndicatorInsets, false);
        for (const node of nodes(r.output)) {
            const style = flatten(node.props?.style);
            assert.equal(style.backgroundImage, undefined);
            assert.equal(style.experimental_backgroundImage, undefined, 'No artificial fade remains');
        }
        if (hasBack) {
            const back = button(r, 'Back');
            const row = r.output.props.children[0];
            assert(nodes(row).includes(back), 'Back belongs to the header before the viewport');
            assert(!nodes(scroll).includes(back), 'Back must remain stationary while scrolling');
            if (edgeToEdge) {
                assert.equal(row.props.pointerEvents, 'box-none', 'Only the Back target intercepts touches');
                assert.equal(flatten(row.props.style).position, 'absolute');
                assert.equal(flatten(row.props.style).top, insets.top + 4, 'Back stays below the actual safe area');
                assert.equal(flatten(row.props.style).height, undefined, 'No fixed navigation row');
                assert.equal(flatten(row.props.style).paddingTop, undefined);
                assert.equal(flatten(row.props.style).left, content.paddingLeft);
                assert.equal(flatten(row.props.style).right, content.paddingRight);
                assert.equal(nodes(r.output).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Back').length, 1);
                const cap = nodes(r.output).find(n => n.props?.pointerEvents === 'none' && n.props.importantForAccessibility === 'no-hide-descendants');
                if (insets.top > 0) {
                    assert(cap); assert.equal(cap.props.accessible, false);
                    assert.equal(cap.props.importantForAccessibility, 'no-hide-descendants');
                    const capStyle = flatten(cap.props.style);
                    assert.equal(capStyle.position, 'absolute'); assert.equal(capStyle.top, 0);
                    assert.equal(capStyle.left, 0); assert.equal(capStyle.right, 0);
                    assert(capStyle.zIndex < flatten(row.props.style).zIndex, 'Back remains sharp above the status treatment');
                    assert.equal(capStyle.height, insets.top, 'Only the actual status safe area is protected');
                    assert.equal(capStyle.backgroundColor, '#FFF8F0');
                    assert.equal(cap.props.children, null, 'No fade or added band below the safe area');
                    assert(!nodes(scroll).includes(cap), 'Status cap never scrolls');
                } else assert.equal(cap, undefined, 'No artificial status strip when the top inset is zero');
            } else {
                assert.equal(flatten(row.props.style).height, 48);
                assert.equal(flatten(row.props.style).position, undefined);
                assert.equal(flatten(row.props.style).paddingLeft, content.paddingLeft);
            }
            const style = flatten(back.props.style);
            assert.equal(style.width, 44); assert.equal(style.height, 44);
            if (edgeToEdge) {
                assert.equal(style.backgroundColor, undefined, 'Visible circle is smaller than the accessible target');
                const circle = nodes(back).find(n => n.type === 'View');
                const circleStyle = flatten(circle.props.style);
                assert.equal(circleStyle.width, 40); assert.equal(circleStyle.height, 40);
                assert.equal(circleStyle.borderRadius, 20); assert.equal(circleStyle.borderWidth, 1);
                assert.equal(circleStyle.backgroundColor, '#FFFFFF');
            } else assert.equal(style.borderRadius, 22);
            assert.equal(back.props.accessibilityRole, 'button'); assert.equal(back.props.accessibilityLabel, 'Back');
            assert.equal(back.props.accessibilityState.disabled, !!back.props.disabled);
            assert.equal(textOf(back), '', 'No visible Back text');
            const icon = nodes(back).find(n => n.type === 'Icon');
            assert.equal(icon.props.name, 'chevron-back'); assert.equal(icon.props.size, edgeToEdge ? 20 : 22);
            assert.equal(icon.props.accessible, false);
            if (!edgeToEdge) assert.notEqual(flatten(back.props.style({ pressed: true })).backgroundColor, style.backgroundColor);
        } else {
            assert(!nodes(r.output).some(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Back'));
            assert.equal(r.output.props.children.filter(Boolean).length, 1, 'Tab roots have no empty navigation row');
        }
        return scroll;
    }
    await test('Both iOS details show full-width scrolling titles below unchanged Back and status protection in all states', async () => {
        for (const route of ['group/[id]', 'group/[id]/restaurant/[entryId]']) {
            for (const state of ['ready', 'invalid', 'restoring', 'signed-out', 'denied', 'error']) {
                const rt = runtime({ platform: 'ios', mocks: clipboard, fetch: call => {
                    if (state === 'denied' && call.url.pathname === '/rest/v1/group_memberships') return response(null);
                    if (state === 'error' && call.url.pathname === '/rest/v1/groups') return response({ message: 'Offline' }, 400);
                    return route === 'group/[id]' ? groupBackend(call) : restaurantBackend(call);
                } });
                rt.world.params = state === 'invalid' ? { id: 'invalid' } : { id: groupId, entryId };
                if (state === 'restoring') rt.world.auth.loading = true;
                if (state === 'signed-out') rt.world.auth.session = null;
                if (['invalid', 'restoring', 'signed-out'].includes(state)) rt.world.canGoBack = false;
                const r = screen(rt, route); await r.settle();
                for (const insets of [{ top: 62, left: 0, right: 0, bottom: 34 }, { top: 0, left: 62, right: 34, bottom: 21 }, { top: 20, left: 0, right: 0, bottom: 0 }]) {
                    rt.world.safeAreaInsets = insets; r.dirty = true; await r.settle();
                    const scroll = assertScaffold(r, insets, true, true);
                    const title = nodes(scroll).find(n => n.type === 'Text' && n.props.accessibilityRole === 'header');
                    assert(title, 'Title scrolls with content');
                    assert.equal(flatten(title.props.style).fontSize, 26);
                    assert.equal(title.props.numberOfLines, undefined); assert.equal(title.props.allowFontScaling, undefined);
                    assert.equal(scroll.props.children[0], title, 'Title is its own full-width line, not a row with a Back spacer');
                    assert.equal(flatten(title.props.style).marginLeft, undefined);
                    assert.equal(flatten(title.props.style).paddingLeft, undefined);
                    assert.equal(flatten(title.props.style).flex, undefined);
                    assert.equal(title.props.onTextLayout, undefined, 'Title metrics cannot move stationary Back');
                    assert.equal(scroll.props.keyboardShouldPersistTaps, route.includes('restaurant') ? 'handled' : undefined);
                }
                if (state === 'ready') assert(textOf(r.output).includes(route.includes('restaurant') ? 'Original' : 'Saved restaurants'));
                if (state === 'denied') assert(textOf(r.output).includes(route.includes('restaurant') ? 'do not have access' : 'no longer a member'));
                if (state === 'error') assert(textOf(r.output).includes('Could not verify group access'));
                await click(r, 'Back');
                const fallback = ['invalid', 'restoring', 'signed-out'].includes(state);
                assert.deepEqual(JSON.parse(JSON.stringify(rt.world.navigation.at(-1))), route === 'group/[id]' || fallback
                    ? '/groups' : { pathname: '/group/[id]', params: { id: groupId } });
                r.unmount();
            }
        }
        // Non-iOS retains the previous protected-viewport treatment.
        const rt = runtime(), r = screen(rt, 'group/[id]/restaurant/[entryId]'); await r.settle();
        assertScaffold(r, rt.world.safeAreaInsets, true); r.unmount();
    });
    await test('Long titles wrap without a side spacer; measured Back height provides a compact gap without moving Back', async () => {
        for (const route of ['group/[id]', 'group/[id]/restaurant/[entryId]']) {
            const longName = 'A very long restaurant or group name that wraps onto several lines';
            const rt = runtime({ platform: 'ios', mocks: clipboard, safeAreaInsets: { top: 62, left: 0, right: 0, bottom: 34 }, fetch: call => {
                if (call.url.pathname === '/rest/v1/groups') return response({ id: groupId, name: longName, owner_user_id: 'b' });
                if (call.url.pathname.endsWith('/get_group_restaurants')) return response([{ ...restaurant, name: longName, average_rating: null, rated_visit_count: 0, total_visit_count: 1 }]);
                return groupBackend(call);
            } });
            rt.world.params = { id: groupId, entryId };
            const r = screen(rt, route); await r.settle();
            const scroll = () => nodes(r.output).find(n => n.type === 'ScrollView');
            const title = () => nodes(scroll()).find(n => n.props?.accessibilityRole === 'header');
            assert.equal(textOf(title()), longName);
            for (const measuredBack of [44, 52]) {
                button(r, 'Back').props.onLayout({ nativeEvent: { layout: { width: measuredBack, height: measuredBack } } });
                await r.settle();
                assert.equal(scroll().props.children[0], title());
                assert.equal(flatten(r.output.props.children[0].props.style).top, 66, 'Back retains its safe-area position independently of the title');
                assert.equal(flatten(scroll().props.contentContainerStyle).paddingLeft, 24);
                assert.equal(flatten(scroll().props.contentContainerStyle).paddingRight, 24);
                assert.equal(flatten(scroll().props.contentContainerStyle).paddingTop, 66 + measuredBack + 8);
                const titleStyle = flatten(title().props.style);
                assert.equal(titleStyle.fontSize, 26); assert.equal(titleStyle.marginBottom, 16);
                for (const prop of ['marginLeft', 'marginRight', 'paddingLeft', 'paddingRight', 'width', 'height', 'maxHeight']) assert.equal(titleStyle[prop], undefined);
                assert.equal(title().props.maxFontSizeMultiplier, undefined);
                assert.equal(title().props.ellipsizeMode, undefined);
                assert.equal(title().props.numberOfLines, undefined);
                assert.equal(title().props.allowFontScaling, undefined);
                assert.equal(title().props.onTextLayout, undefined);
            }
            rt.world.pressed = true; r.dirty = true; await r.settle();
            assert.equal(flatten(nodes(button(r, 'Back')).find(n => n.type === 'View').props.style).backgroundColor, '#F3E7DC');
            rt.world.pressed = false; r.dirty = true; await r.settle();
            assert.equal(flatten(nodes(button(r, 'Back')).find(n => n.type === 'View').props.style).backgroundColor, '#FFFFFF');
            r.unmount();
        }
    });
    await test('Five landing screens use safe-area viewports without Back rows and preserve keyboard handling', async () => {
        for (const route of ['index', 'my-places', 'add', 'groups', 'account']) {
            const insets = { top: 62, left: 0, right: 0, bottom: 34 };
            const rt = runtime({ platform: 'ios', safeAreaInsets: insets, ...(route === 'groups' ? { fetch: backend } : {}) });
            const r = screen(rt, route); await r.settle();
            const scroll = assertScaffold(r, insets, false);
            assert.equal(scroll.props.keyboardShouldPersistTaps, route === 'groups' ? 'handled' : undefined);
            r.unmount();
        }
        for (const route of ['groups', 'my-places']) {
            const rt = runtime({ safeAreaInsets: { top: 62, left: 0, right: 0, bottom: 34 } });
            rt.world.auth.loading = true;
            const r = screen(rt, route); await r.settle();
            assertScaffold(r, rt.world.safeAreaInsets, false);
            assert(textOf(r.output).includes('Restoring your session')); r.unmount();
        }
    });
    await test('Group Back stays disabled during membership mutation and the confirmation retains its scroll ref', async () => {
        const pending = defer();
        const rt = runtime({ platform: 'ios', mocks: clipboard, fetch: call => call.url.pathname.endsWith('/leave_group') ? pending.promise : groupBackend(call) });
        rt.world.params = { id: groupId };
        const r = screen(rt, 'group/[id]'); await r.settle();
        let scrolled;
        nodes(r.output).find(n => n.type === 'ScrollView').props.ref.current = { scrollTo: options => { scrolled = options; } };
        await click(r, 'Leave Group'); assert.equal(scrolled.y, 0); assert.equal(scrolled.animated, true);
        const saving = button(r, 'Confirm Leave Group').props.onPress(); await r.settle();
        assert.equal(button(r, 'Back').props.disabled, true);
        assert.equal(button(r, 'Back').props.accessibilityState.disabled, true);
        pending.resolve(response({ code: '22023', message: 'Rejected for test' }, 400)); await saving; await r.settle();
        assert.equal(button(r, 'Back').props.disabled, false);
        await click(r, 'Back'); assert.equal(rt.world.navigation.at(-1), '/groups'); r.unmount();
    });
    await test('Disclosure cards keep full-card navigation and unrestricted metadata wrapping', async () => {
        for (const route of ['groups', 'group/[id]', 'my-places']) {
            const rt = runtime({ mocks: clipboard, ...(route === 'groups' ? { fetch: backend } : route === 'group/[id]' ? { fetch: groupBackend } : {}) });
            rt.world.params = { id: groupId }; rt.world.rows = [fixture()];
            const r = screen(rt, route); await r.settle();
            const card = nodes(r.output).find(n => n.type === 'Pressable' && nodes(n).some(c => c.type === 'Icon' && c.props.name === 'chevron-forward'));
            assert(card); assert.equal(card.props.accessibilityRole, 'button');
            assert.equal(nodes(card).filter(n => n.type === 'Pressable').length, 1, 'Chevron is not a separate target');
            const icon = nodes(card).find(n => n.type === 'Icon'); assert.equal(icon.props.accessible, false);
            for (const text of nodes(card).filter(n => n.type === 'Text')) {
                assert.equal(text.props.numberOfLines, undefined); assert.equal(text.props.allowFontScaling, undefined);
            }
            await card.props.onPress(); await r.settle();
            const target = rt.world.navigation.at(-1);
            assert.equal(target.pathname, route === 'groups' ? '/group/[id]' : route === 'group/[id]' ? '/group/[id]/restaurant/[entryId]' : '/personal-place/[id]');
            assert.equal(target.params.id, route === 'my-places' ? fixture().id : groupId);
            if (route === 'group/[id]') assert.equal(target.params.entryId, entryId);
            r.unmount();
        }
    });
    await test('Stationary restaurant Back preserves inline dirty/swipe guards and active-save disabling', async () => {
        let rt; const pending = defer();
        rt = runtime({ platform: 'ios', fetch: c => c.url.pathname.endsWith('/update_group_visit') ? pending.promise : restaurantBackend(c),
            router: { dismissTo: href => rt.attemptRemoval({ type: 'BACK', payload: href }, () => rt.world.navigation.push(href)) },
        });
        rt.world.params = { id: groupId, entryId };
        const r = screen(rt, 'group/[id]/restaurant/[entryId]'); await r.settle();
        await click(r, 'Edit Visit'); await enter(r, 'Edit visit notes', 'Dirty');
        await click(r, 'Back'); assert(textOf(r.output).includes('Discard unsaved changes?'));
        assert.equal(rt.world.navigation.length, 0); await click(r, 'Stay');
        assert(rt.attemptRemoval({ type: 'POP', payload: { count: 1 } })); await r.settle();
        assert(textOf(r.output).includes('Discard unsaved changes?')); await click(r, 'Stay');
        const saving = button(r, 'Save Changes').props.onPress(); await r.settle();
        assert.equal(button(r, 'Back').props.disabled, true);
        assert.equal(button(r, 'Back').props.accessibilityState.disabled, true);
        assert(rt.attemptRemoval({ type: 'POP' })); await r.settle();
        assert(textOf(r.output).includes('Save in progress')); await click(r, 'Stay');
        pending.resolve(response({ code: '22023', message: 'Rejected for test' }, 400)); await saving; await r.settle();
        assert.equal(button(r, 'Back').props.disabled, false); r.unmount();
    });
    await test('Personal saves from Add, My Places and direct entry remove the form and anchor My Places', async () => {
        for (const origin of ['/add', '/my-places', '/personal-place-form']) {
            const h = history(origin); if (origin !== '/personal-place-form') h.router.push('/personal-place-form');
            const rt = runtime({ router: h.router }), r = screen(rt, 'personal-place-form');
            await r.settle(); await fill(r); await click(r, 'Save Personal Place'); noForms(h);
            assert.equal(h.chain()[2].name, '(my-places)'); assert.equal(h.current().params.id, rt.world.rows[0].id);
            h.router.back(); assert.equal(h.current().name, 'my-places'); r.unmount();
        }
    });
    await test('Personal edit returns to its existing detail and failed saves retain the draft until Discard', async () => {
        const place = fixture(), h = history('/personal-place/' + place.id), rt = runtime({ router: h.router });
        rt.world.rows = [place]; rt.world.params = { id: place.id }; h.router.push({ pathname: '/personal-place-form', params: rt.world.params });
        const r = screen(rt, 'personal-place-form'); await r.settle(); await enter(r, 'Personal notes', 'Edited');
        rt.world.override = call => call.method === 'PATCH' ? response([], 200) : null;
        await click(r, 'Save Changes'); assert.equal(h.current().name, 'personal-place-form');
        await click(r, 'Cancel and Refresh Place'); await click(r, 'Stay'); assert.equal(h.current().name, 'personal-place-form');
        await click(r, 'Cancel and Refresh Place'); await click(r, 'Discard'); noForms(h); assert.equal(h.current().params.id, place.id); r.unmount();
        h.router.push({ pathname: '/personal-place-form', params: rt.world.params }); rt.world.override = null;
        const edit = screen(rt, 'personal-place-form'); await edit.settle(); await enter(edit, 'Personal notes', 'Saved edit'); await click(edit, 'Save Changes');
        noForms(h); assert.equal(h.chain()[2].state.routes.length, 2); h.router.back(); assert.equal(h.current().name, 'my-places'); edit.unmount();
    });
    await test('Reconciled personal save dismisses the uncertain form without another mutation', async () => {
        const h = history('/personal-place-form'), rt = runtime({ router: h.router });
        rt.world.override = call => call.method === 'POST' ? response({ message: 'Lost response' }, 400) : null;
        const r = screen(rt, 'personal-place-form'); await r.settle(); await fill(r); await click(r, 'Save Personal Place');
        rt.world.rows.push(fixture(rt.world.requests.find(c => c.method === 'POST').body));
        await click(r, 'Check Saved Result'); noForms(h); assert.equal(h.current().name, 'personal-place/[id]');
        assert.equal(rt.world.requests.filter(c => c.method === 'POST').length, 1); r.unmount();
    });
    await test('Dirty personal and visit forms guard Back/removal; unchanged direct forms close immediately', async () => {
        for (const name of ['personal-place-form', 'add-visit', 'add-place']) {
            const rt = runtime({ fetch: name === 'add-visit' ? backend : undefined });
            if (name === 'add-place') rt.world.params = { id: 'legacy' };
            const r = screen(rt, name); await r.settle();
            await click(r, 'Back'); assert.equal(rt.world.navigation.at(-1), 'BACK'); rt.world.navigation.length = 0;
            await enter(r, name === 'personal-place-form' ? 'Personal notes' : name === 'add-visit' ? 'Visit notes' : 'Place name', 'Dirty');
            const action = { type: 'POP', payload: { count: 1 } };
            assert(rt.attemptRemoval(action)); await r.settle(); assert.equal(rt.world.navigation.length, 0);
            await click(r, 'Stay'); await click(r, 'Back'); await click(r, 'Discard');
            assert.equal(rt.world.navigation.at(-1), 'BACK'); assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, 0);
            assert.equal(rt.world.localWrites, 0); r.unmount();
        }
    });
    await test('Single-group saves open the correct entry history with tabs and remove completed forms', async () => {
        for (const origin of ['/add', '/groups', '/group/' + groupId, `/group/${groupId}/restaurant/${entryId}`, '/add-visit']) {
            const h = history(origin), rt = runtime({ router: h.router, fetch: backend });
            if (origin !== '/add-visit') h.router.push('/add-visit'); rt.world.params = { groupId };
            const r = screen(rt, 'add-visit'); await r.settle(); await enter(r, 'Restaurant name', 'Cafe'); await enter(r, 'Restaurant address', 'Address');
            await click(r, 'Save Visit'); noForms(h); assert.equal(h.chain()[2].name, '(groups)');
            assert.equal(h.current().name, 'group/[id]/restaurant/[entryId]'); assert.equal(h.current().params.entryId, entryId);
            assert.equal(h.current().params.id, groupId); assert.notEqual(entryId, restaurantId);
            h.router.back(); noForms(h); r.unmount();
        }
    });
    await test('Failed destination read keeps a completed save locked; Continue only retries the read', async () => {
        let fail = true;
        const h = history('/add-visit'), rt = runtime({ router: h.router, fetch: c => c.url.pathname.endsWith('get_group_restaurants') && fail ? response({ message: 'Offline' }, 503) : backend(c) });
        rt.world.params = { groupId }; const r = screen(rt, 'add-visit'); await r.settle();
        await enter(r, 'Restaurant name', 'Cafe'); await enter(r, 'Restaurant address', 'Address'); const save = button(r, 'Save Visit').props.onPress;
        await click(r, 'Save Visit'); assert(textOf(r.output).includes('Visit saved. Could not open')); await save();
        fail = false; await click(r, 'Continue to Groups'); noForms(h);
        assert.equal(rt.world.requests.filter(c => c.url.pathname.endsWith('save_restaurant_visit')).length, 1); r.unmount();
    });
    await test('Multi-group saves return to Groups root with no form in either stack', async () => {
        const h = history(`/group/${groupId}/restaurant/${entryId}`), rt = runtime({ router: h.router, fetch: backend });
        h.router.push('/add-visit'); rt.world.params = { groupId }; const r = screen(rt, 'add-visit'); await r.settle();
        await enter(r, 'Restaurant name', 'Cafe'); await enter(r, 'Restaurant address', 'Address');
        const checkbox = nodes(r.output).find(n => n.props?.accessibilityRole === 'checkbox' && textOf(n.props.children).endsWith('Lunch'));
        checkbox.props.onPress(); await r.settle(); await click(r, 'Save Visit'); noForms(h); assert.equal(h.current().name, 'groups'); r.unmount();
    });
    await test('Paused-before-sending visit retains the exact submission and guards removal', async () => {
        const rt = runtime({ fetch: backend }); rt.world.params = { groupId }; const r = screen(rt, 'add-visit'); await r.settle();
        await enter(r, 'Restaurant name', 'Cafe'); await enter(r, 'Restaurant address', 'Address');
        const session = defer(); rt.supabase.auth.getSession = () => session.promise;
        const pending = button(r, 'Save Visit').props.onPress(); await r.settle(); rt.emit('background'); await r.settle();
        session.resolve({ data: { session: rt.world.auth.session }, error: null }); await pending; await r.settle();
        assert(textOf(r.output).includes('paused before sending')); assert.equal(rt.world.requests.filter(c => c.method === 'POST').length, 0);
        assert(rt.attemptRemoval({ type: 'POP' })); await r.settle(); await click(r, 'Stay and Keep Submission');
        rt.emit('active'); await r.settle(); await click(r, 'Retry Same Visit Save'); assert.equal(rt.world.requests.filter(c => c.url.pathname.endsWith('save_restaurant_visit')).length, 1); r.unmount();
    });
    await test('Inline Create/Join blocks tab blur/reselect, clears only on Discard, and blocks active submissions', async () => {
        for (const name of ['index', '(groups)']) {
            const h = history('/groups'), rt = runtime({ fetch: backend, navigation: { getState: h.tabState, dispatch: h.dispatch } });
            rt.world.tabsScreen = rt.load('app/groups').default;
            const r = screen(rt, '(app)/(tabs)/_layout'); await r.settle();
            assert.equal(tabPress(r, h, 'index'), false); h.select('(groups)');
            await enter(r, 'New group name', 'Unsaved'); assert(tabPress(r, h, name)); await r.settle();
            assert.equal(h.current().name, 'groups'); await click(r, 'Stay'); assert(textOf(r.output).includes('Groups'));
            await enter(r, 'Invite code', 'code'); assert(tabPress(r, h, name)); await r.settle(); await click(r, 'Discard');
            assert.equal(nodes(r.output).find(n => n.props?.accessibilityLabel === 'New group name').props.value, '');
            assert.equal(nodes(r.output).find(n => n.props?.accessibilityLabel === 'Invite code').props.value, '');
            h.select('(groups)'); await enter(r, 'New group name', 'Pending');
            const pending = defer(); rt.supabase.auth.getSession = () => pending.promise;
            const saving = button(r, 'Create Group').props.onPress(); await r.settle(); assert(tabPress(r, h, 'index')); await r.settle();
            assert(textOf(r.output).includes('Save in progress')); assert(!nodes(r.output).some(n => n.type === 'Pressable' && textOf(n.props.children) === 'Discard'));
            await click(r, 'Stay'); pending.resolve({ data: { session: null }, error: null }); await saving; await r.settle();
            assert.equal(h.current().name, 'groups'); assert.equal(rt.world.requests.filter(c => c.method === 'POST').length, 0); r.unmount();
        }
    });
    await test('Inline Visit Discard never saves/deletes; uncertain results lock retries and reconcile read-only', async () => {
        for (const action of ['edit', 'delete']) {
            const mutation = defer();
            const h = history(`/group/${groupId}/restaurant/${entryId}`); let completed = 0, canceled = 0, uncertain = false;
            const visit = { id: 'visit', visited_on: null, rating: null, would_go_again: null, notes: 'Original' };
            const rt = runtime({ navigation: { getState: h.tabState, dispatch: h.dispatch }, fetch: c => {
                if (c.url.pathname.endsWith('update_group_visit') || c.url.pathname.endsWith('delete_group_visit')) { uncertain = true; return mutation.promise; }
                if (c.url.pathname.endsWith('get_group_restaurant_visits')) return response(action === 'delete' ? [] : [{ ...visit, notes: 'Edited' }]);
                return backend(c);
            } });
            const Visit = rt.load('@/components/visit-management').VisitManagement;
            function Editor() { return { type: Visit, props: { action, visit,
                scope: { target_group_id: groupId, target_group_restaurant_id: entryId, target_visit_id: visit.id },
                onCancel() { canceled++; }, onBusyChange() {}, onComplete() { completed++; } } }; }
            rt.world.tabsScreen = Editor; const r = screen(rt, '(app)/(tabs)/_layout'); await r.settle();
            if (action === 'edit') {
                await enter(r, 'Edit visit notes', 'Abandoned'); assert(tabPress(r, h, 'index')); await r.settle();
                await click(r, 'Stay'); await click(r, 'Cancel'); await click(r, 'Discard'); assert.equal(canceled, 1); assert.equal(rt.world.requests.length, 0);
                // Remount to represent the parent's onCancel closing the editor.
                r.unmount(); const clean = screen(rt, '(app)/(tabs)/_layout'); await clean.settle(); clean.unmount();
            } else r.unmount();
            const edit = screen(rt, '(app)/(tabs)/_layout'); await edit.settle();
            if (action === 'edit') await enter(edit, 'Edit visit notes', 'Edited');
            const staleSave = button(edit, action === 'edit' ? 'Save Changes' : 'Confirm Delete Visit').props.onPress;
            const pending = staleSave(); await edit.settle();
            assert(tabPress(edit, h, 'index')); await edit.settle();
            assert(textOf(edit.output).includes('Save in progress'));
            assert(!nodes(edit.output).some(n => n.type === 'Pressable' && textOf(n.props.children) === 'Discard'));
            await click(edit, 'Stay'); mutation.resolve(response({ message: 'Lost response' }, 503));
            await pending; await edit.settle(); assert(uncertain); await staleSave();
            assert(tabPress(edit, h, 'index')); await edit.settle(); assert(textOf(edit.output).includes('Review this save'));
            assert(!nodes(edit.output).some(n => n.type === 'Pressable' && textOf(n.props.children) === 'Discard'));
            await click(edit, 'Stay'); await click(edit, 'Check Saved Visit'); assert.equal(completed, 1);
            assert.equal(rt.world.requests.filter(c => /(?:update|delete)_group_visit$/.test(c.url.pathname)).length, 1); edit.unmount();
        }
    });
    await test('Inline Group local exits confirm, and shared stale Discard cannot navigate a replacement account', async () => {
        const rt = runtime({ fetch: backend }), r = screen(rt, 'groups'); await r.settle();
        await enter(r, 'Invite code', 'Unsaved invite'); await click(r, 'Add Restaurant / Visit');
        assert.equal(rt.world.navigation.length, 0); await click(r, 'Stay');
        await click(r, 'Add Restaurant / Visit'); const staleDiscard = button(r, 'Discard').props.onPress;
        rt.switch('b', r); await r.settle(); await staleDiscard();
        assert.equal(rt.world.navigation.length, 0); assert.equal(rt.world.lateUpdates, 0);
        assert.equal(nodes(r.output).find(n => n.props?.accessibilityLabel === 'Invite code').props.value, '');
        assert(!nodes(r.output).some(n => n.type === 'Modal')); r.unmount();
    });
    await test('Full-screen archive edit keeps storage-only behavior and returns to Account detail', async () => {
        const h = history('/place/legacy'), rt = runtime({ router: h.router }); rt.world.params = { id: 'legacy' };
        h.router.push({ pathname: '/add-place', params: rt.world.params });
        const r = screen(rt, 'add-place'); await r.settle(); await click(r, 'Save Changes'); noForms(h);
        assert.equal(h.chain()[2].name, '(account)'); assert.equal(h.current().params.id, 'legacy');
        assert.equal(rt.world.localWrites, 1); assert.equal(rt.world.requests.length, 0); r.unmount();
    });
    console.log(`${passed} nested navigation/leave-safety checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
