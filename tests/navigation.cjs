// Actual screens and Expo route/action discovery, installed nested stack/tab
// reducers, synthetic auth and offline transport. Native event delivery is modeled.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { runtime, fixture, response, screen, click, enter, nodes, textOf, button } = require('./personal-places.cjs');
const routing = require('./router-fixture.cjs');
const groupId = '22222222-2222-2222-2222-222222222222';
const otherGroupId = '33333333-3333-3333-3333-333333333333';
const restaurantId = '44444444-4444-4444-4444-444444444444';
const entryId = '55555555-5555-5555-5555-555555555555';
const restaurant = { id: entryId, restaurant_id: restaurantId, name: 'Cafe', address: 'Address', cuisine: null };
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let passed = 0;
async function test(label, fn) { await fn(); passed++; console.log('PASS ' + label); }
const inputValue = (r, label) => nodes(r.output).find(n => n.type === 'TextInput' && n.props.accessibilityLabel === label).props.value;
function noForms(h) { assert(!h.allNames().some(n => ['add-place'].includes(n))); }
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
        for (const path of ['/create-group', '/join-group', '/personal-place-form', '/add-visit', '/add-place?id=legacy']) {
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
    await test('Result-opened details stay inside Add and custom/native Back return to its summary', async () => {
        for (const kind of ['personal', 'group']) for (const nativeBack of [false,true]) {
            const h=history('/group/'+otherGroupId);h.router.push('/add');
            const href=kind==='personal'?{pathname:'/add/personal-place/[id]',params:{id:fixture().id}}
                :{pathname:'/add/group/[id]/restaurant/[entryId]',params:{id:groupId,entryId}};
            h.router.push(href);const rt=runtime({router:h.router,...(kind==='group'?{fetch:restaurantBackend}:{})});
            rt.world.rows=[fixture()];rt.world.params=href.params;
            const r=screen(rt,kind==='personal'?'add/personal-place/[id]':'add/group/[id]/restaurant/[entryId]');await r.settle();
            assert(textOf(r.output).includes(kind==='personal'?'Private Cafe':'Cafe'));
            assert.equal(h.chain()[2].name,'add');assert.equal(h.chain()[2].state.routes[0].name,'index');
            if(nativeBack)h.router.back();else await click(r,'Back');
            assert.equal(h.chain()[2].name,'add');assert.equal(h.current().name,'index');r.unmount();
        }
    });
    await test('Normal detail Back returns to My Places or its own group after browsing another group', async () => {
        for (const kind of ['personal','group']) {
            const h=history('/group/'+otherGroupId);
            if(kind==='personal'){h.router.push('/my-places');h.router.push({pathname:'/personal-place/[id]',params:{id:fixture().id}});}
            else {h.router.push({pathname:'/group/[id]',params:{id:groupId}});h.router.push({pathname:'/group/[id]/restaurant/[entryId]',params:{id:groupId,entryId}});}
            const rt=runtime({router:h.router,...(kind==='group'?{fetch:restaurantBackend}:{})});rt.world.rows=[fixture()];rt.world.params={id:kind==='personal'?fixture().id:groupId,entryId};
            const r=screen(rt,kind==='personal'?'personal-place/[id]':'group/[id]/restaurant/[entryId]');await r.settle();await click(r,'Back');
            assert.equal(h.current().name,kind==='personal'?'my-places':'group/[id]');if(kind==='group')assert.equal(h.current().params.id,groupId);r.unmount();
        }
    });
    await test('Result-opened group edits keep dirty-form protection for both Back and native removal', async () => {
        const h=history('/add');h.router.push({pathname:'/add/group/[id]/restaurant/[entryId]',params:{id:groupId,entryId}});
        let rt;rt=runtime({fetch:restaurantBackend,router:{...h.router,back:()=>rt.attemptRemoval({type:'POP'},h.router.back)}});
        rt.world.params={id:groupId,entryId};const r=screen(rt,'add/group/[id]/restaurant/[entryId]');await r.settle();
        await click(r,'Edit Visit');await enter(r,'Edit visit notes','Unsent change');await click(r,'Back');
        assert(textOf(r.output).includes('Discard unsaved changes?'));await click(r,'Stay');assert.equal(h.current().params.entryId,entryId);
        assert(rt.attemptRemoval({type:'POP'},h.router.back));await r.settle();await click(r,'Stay');
        assert.equal(h.chain()[2].name,'add');assert.equal(rt.world.requests.filter(c=>/(update|delete)_group_visit$/.test(c.url.pathname)).length,0);r.unmount();
    });
    await test('Personal facts and visit editors retain the Saved-summary return path', async () => {
        for (const editor of ['personal-place-form','personal-visit-form']) {
            const h=history('/add');h.router.push({pathname:'/add/personal-place/[id]',params:{id:fixture().id}});
            const rt=runtime({router:h.router});rt.world.params={id:fixture().id};rt.world.rows=[fixture()];
            rt.world.visits=[{id:entryId,personal_place_id:fixture().id,owner_user_id:'a',revision:1,origin:'visit',visited_on:null,rating:null,would_go_again:null,notes:'Original'}];
            const details=screen(rt,'add/personal-place/[id]');await details.settle();await click(details,editor==='personal-place-form'?'Edit Personal Place':'Edit Visit');
            assert.equal(h.current().params.fromAdd,'1');rt.world.params=h.current().params;details.unmount();
            const r=screen(rt,editor);await r.settle();await click(r,'Back');
            assert.equal(h.chain()[2].name,'add');assert.equal(h.current().name,'personal-place/[id]');h.router.back();assert.equal(h.current().name,'index');r.unmount();
        }
    });
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
                assert.equal(row.props.pointerEvents, 'box-none', 'Only Back intercepts touches; surrounding content remains usable');
                assert.equal(flatten(row.props.style).position, 'absolute');
                assert.equal(flatten(row.props.style).top, insets.top + 4, 'Back stays below the actual safe area');
                assert.equal(flatten(row.props.style).height, undefined, 'No fixed navigation row');
                assert.equal(flatten(row.props.style).paddingTop, undefined);
                assert.equal(flatten(row.props.style).left, content.paddingLeft);
                assert.equal(flatten(row.props.style).right, content.paddingRight);
                assert.equal(nodes(r.output).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Back').length, 1);
                const children = r.output.props.children.filter(Boolean);
                assert.equal(children.length, 2, 'No navigation surface or status-area mask clips scrolling content');
                assert.equal(children[0], row); assert.equal(children[1], scroll);
                const rowStyle = flatten(row.props.style);
                assert.equal(rowStyle.backgroundColor, undefined, 'The floating Back row remains transparent');
                assert(rowStyle.zIndex > (flatten(scroll.props.style).zIndex ?? 0), 'Back stays above scrolling content');
                assert.equal(rowStyle.opacity, undefined);
                assert.equal(row.props.onStartShouldSetResponder, undefined, 'No full-width touch interceptor remains');
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
                assert.equal(circleStyle.backgroundColor, 'rgba(255,248,240,0.88)', 'Only the cream fill is translucent');
                assert.equal(circleStyle.borderColor, 'rgba(191,169,155,0.6)');
                assert.equal(circleStyle.shadowColor, '#2D1F1A');
                assert.equal(circleStyle.shadowOffset.width, 0); assert.equal(circleStyle.shadowOffset.height, 2);
                assert.equal(circleStyle.shadowOpacity, 0.15); assert.equal(circleStyle.shadowRadius, 4);
                assert.equal(circleStyle.overflow, undefined, 'The soft shadow is not clipped by the circle');
                assert.equal(circleStyle.opacity, undefined);
                assert.equal(style.opacity, undefined, 'The button and icon stay opaque even while busy');
            } else assert.equal(style.borderRadius, 22);
            assert.equal(back.props.accessibilityRole, 'button'); assert.equal(back.props.accessibilityLabel, 'Back');
            assert.equal(back.props.accessibilityState.disabled, !!back.props.disabled);
            assert.equal(textOf(back), '', 'No visible Back text');
            const icon = nodes(back).find(n => n.type === 'Icon');
            assert.equal(icon.props.name, 'chevron-back'); assert.equal(icon.props.size, edgeToEdge ? 20 : 22);
            assert.equal(icon.props.accessible, false);
            if (edgeToEdge) assert.equal(icon.props.color, back.props.disabled ? '#79665E' : '#C9472C', 'Busy state uses a readable muted icon rather than whole-button opacity');
            if (!edgeToEdge) assert.notEqual(flatten(back.props.style({ pressed: true })).backgroundColor, style.backgroundColor);
        } else {
            assert(!nodes(r.output).some(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Back'));
            assert.equal(r.output.props.children.filter(Boolean).length, 1, 'Tab roots have no empty navigation row');
        }
        return scroll;
    }
    await test('Both iOS details allow scrolling under stationary Back and the status area without masks in all states', async () => {
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
        for (const platform of ['android', 'web']) {
            const rt = runtime({ platform }), r = screen(rt, 'group/[id]/restaurant/[entryId]'); await r.settle();
            assertScaffold(r, rt.world.safeAreaInsets, true);
            assert(!nodes(r.output).some(n => n.props?.onStartShouldSetResponder), 'No iOS overlay is added on other platforms');
            r.unmount();
        }
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
            for (const measuredBack of [44, 52, 36]) {
                button(r, 'Back').props.onLayout({ nativeEvent: { layout: { width: measuredBack, height: measuredBack } } });
                await r.settle();
                assert.equal(scroll().props.children[0], title());
                assert.equal(flatten(r.output.props.children[0].props.style).top, 66, 'Back retains its safe-area position independently of the title');
                assert.equal(flatten(scroll().props.contentContainerStyle).paddingLeft, 24);
                assert.equal(flatten(scroll().props.contentContainerStyle).paddingRight, 24);
                const contentTop = 66 + Math.max(44, measuredBack) + 8;
                assert.equal(flatten(scroll().props.contentContainerStyle).paddingTop, contentTop);
                assert.equal(r.output.props.children.filter(Boolean).length, 2, 'Measuring Back must not add a top mask');
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
            assert.equal(flatten(nodes(button(r, 'Back')).find(n => n.type === 'View').props.style).backgroundColor, 'rgba(243,231,220,0.94)');
            rt.world.pressed = false; r.dirty = true; await r.settle();
            assert.equal(flatten(nodes(button(r, 'Back')).find(n => n.type === 'View').props.style).backgroundColor, 'rgba(255,248,240,0.88)');
            r.unmount();
        }
    });
    await test('Five landing screens use safe-area viewports without Back rows and preserve keyboard handling', async () => {
        for (const route of ['index', 'my-places', 'add', 'groups', 'account']) {
            const insets = { top: 62, left: 0, right: 0, bottom: 34 };
            const rt = runtime({ platform: 'ios', safeAreaInsets: insets, ...(route === 'groups' ? { fetch: backend } : {}) });
            const r = screen(rt, route); await r.settle();
            const scroll = assertScaffold(r, insets, false);
            assert.equal(scroll.props.keyboardShouldPersistTaps, ['groups','add'].includes(route) ? 'handled' : undefined);
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
        assertScaffold(r, rt.world.safeAreaInsets, true, true);
        assert.equal(flatten(button(r, 'Back').props.style).opacity, undefined, 'Busy Back remains legible without whole-button opacity');
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
    await test('Legacy archive form guards Back/removal; unchanged direct forms close immediately', async () => {
        for (const name of ['add-place']) {
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
    // Model route mount/unmount under the real account-scoped provider and use
    // installed Router actions/reducers for destinations. Native events are synthetic.
    async function groupsFlow(fetch = backend) {
        const h = history('/groups'); let r, creation;
        const update = fn => (...args) => { fn(...args); r.dirty = true; };
        const rt = runtime({ fetch, platform: 'ios',
            router: Object.fromEntries(Object.entries(h.router).map(([key, fn]) => [key, key === 'canGoBack' ? fn : update(fn)])),
            navigation: { getState: h.tabState, dispatch: update(action => {
                if (action.type === 'GO_BACK') h.router.back(); else h.dispatch(action);
            }) } });
        const Groups = rt.load('app/groups').default, Create = rt.load('app/create-group').default, Join = rt.load('app/join-group').default;
        const Tabs = rt.load('app/(app)/(tabs)/_layout').default;
        const { useGroupCreation } = rt.load('@/providers/group-creation');
        rt.world.tabsScreen = Groups;
        function Route() { creation = useGroupCreation(); return { type: h.current().name === 'create-group' ? Create : h.current().name === 'join-group' ? Join : Tabs, props: {} }; }
        r = rt.render(Route); await r.settle();
        return { h, rt, r, creation: () => creation };
    }
    await test('Create Group is a parent-stack form; clean Back/Cancel and confirmed saves return to Groups', async () => {
        for (const exit of ['Back', 'Cancel', 'native', 'save', 'direct']) {
            const { h, rt, r } = await groupsFlow(call => call.url.pathname.endsWith('/create_group')
                ? response({ id: groupId, name: 'Dinner', owner_user_id: 'a' }) : backend(call));
            assert(!nodes(r.output).some(n => n.props?.accessibilityLabel === 'New group name'));
            await click(r, 'Create a Group');
            assert.equal(h.chain()[1].name, 'create-group');
            assert(!nodes(r.output).some(n => n.type === 'Tabs'));
            const scroll = nodes(r.output).find(n => n.type === 'ScrollView');
            assert.equal(scroll.props.automaticallyAdjustKeyboardInsets, true);
            assert.equal(scroll.props.keyboardDismissMode, 'on-drag');
            assert.equal(flatten(scroll.props.contentContainerStyle).paddingBottom, 32 + rt.world.safeAreaInsets.bottom);
            assert.equal(flatten(r.output.props.children[0].props.style).position, 'absolute');
            assert.equal(flatten(nodes(button(r, 'Back')).find(n => n.type === 'View').props.style).backgroundColor, 'rgba(255,248,240,0.88)');
            if (exit === 'direct') {
                const direct = history('/create-group');
                direct.router.dismissTo('/groups', { withAnchor: true });
                assert.equal(direct.current().name, 'groups');
                await click(r, 'Cancel');
            } else if (exit === 'save') {
                await enter(r, 'New group name', 'Dinner'); const submit = button(r, 'Create Group').props.onPress;
                await submit(); await submit(); await r.settle();
            } else if (exit === 'native') {
                assert.equal(rt.attemptRemoval({ type: 'GO_BACK' }), false); await r.settle();
            } else await click(r, exit);
            assert.equal(h.current().name, 'groups'); assert(!nodes(r.output).some(n => n.type === 'Modal'));
            assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, exit === 'save' ? 1 : 0);
            assert.equal(tabPress(r, h, 'index'), false); h.select('(groups)');
            await click(r, 'Dinner Owner'); assert.equal(h.current().params.id, groupId);
            r.unmount();
        }
    });
    await test('Create Group unsent names exit immediately with Back/Cancel/native removal and are discarded on remount', async () => {
        for (const exit of ['Back', 'Cancel', 'native']) {
            const { h, rt, r } = await groupsFlow(); await click(r, 'Create a Group');
            await enter(r, 'New group name', 'Unsaved');
            const staleSubmit = button(r, 'Create Group').props.onPress, staleCancel = button(r, 'Cancel').props.onPress;
            if (exit === 'native') { assert.equal(rt.attemptRemoval({ type: 'GO_BACK' }), false); await r.settle(); }
            else await click(r, exit);
            assert.equal(h.current().name, 'groups'); assert(!nodes(r.output).some(n => n.type === 'Modal'));
            await click(r, 'Create a Group');
            assert.equal(nodes(r.output).find(n => n.props?.accessibilityLabel === 'New group name').props.value, '');
            await staleSubmit(); await staleCancel(); await r.settle(); assert.equal(h.current().name, 'create-group');
            assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, 0); r.unmount();
        }
    });
    await test('Create Group blocks busy exits and duplicate taps, including token preflight and native removal', async () => {
        for (const phase of ['preflight', 'rpc']) {
            const task = defer(); const { h, rt, r } = await groupsFlow(call => call.url.pathname.endsWith('/create_group') ? task.promise : backend(call));
            await click(r, 'Create a Group'); await enter(r, 'New group name', 'Pending');
            const original = rt.supabase.auth.getSession;
            if (phase === 'preflight') rt.supabase.auth.getSession = () => task.promise;
            const submit = button(r, 'Create Group').props.onPress, pending = submit(); await r.settle(); await submit();
            assert(button(r, 'Back').props.disabled); assert(button(r, 'Cancel').props.disabled);
            assert(rt.attemptRemoval({ type: 'GO_BACK' })); await r.settle();
            assert(textOf(r.output).includes('Save in progress')); assert(!nodes(r.output).some(n => n.type === 'Pressable' && textOf(n.props.children) === 'Discard'));
            await click(r, 'Stay');
            task.resolve(phase === 'preflight' ? { data: { session: null }, error: null } : response({ code: '22023', message: 'Rejected' }, 400));
            await pending; await r.settle(); rt.supabase.auth.getSession = original;
            assert.equal(h.current().name, 'create-group');
            assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, phase === 'rpc' ? 1 : 0); r.unmount();
        }
    });
    await test('Join is a parent-stack form; clean/unsent codes exit immediately and are discarded on remount', async () => {
        for (const hasDraft of [false, true]) for (const exit of ['Back', 'Cancel', 'native']) {
            const { h, rt, r } = await groupsFlow();
            assert(!nodes(r.output).some(n => n.type === 'TextInput'));
            await click(r, 'Join a Group'); assert.equal(h.chain()[1].name, 'join-group');
            assert(!nodes(r.output).some(n => n.type === 'Tabs'));
            const scroll = nodes(r.output).find(n => n.type === 'ScrollView');
            assert.equal(scroll.props.automaticallyAdjustKeyboardInsets, true);
            assert.equal(scroll.props.keyboardDismissMode, 'on-drag');
            assert.equal(flatten(scroll.props.contentContainerStyle).paddingBottom, 32 + rt.world.safeAreaInsets.bottom);
            assert.equal(flatten(r.output.props.children[0].props.style).position, 'absolute');
            if (hasDraft) await enter(r, 'Invite code', 'Unsaved');
            const staleSubmit = button(r, 'Request Access').props.onPress, staleCancel = button(r, 'Cancel').props.onPress;
            if (exit === 'native') { assert.equal(rt.attemptRemoval({ type: 'GO_BACK' }), false); await r.settle(); }
            else await click(r, exit);
            assert.equal(h.current().name, 'groups'); assert(!nodes(r.output).some(n => n.type === 'Modal'));
            await click(r, 'Join a Group'); assert.equal(inputValue(r, 'Invite code'), '');
            await staleSubmit(); await staleCancel(); await r.settle(); assert.equal(h.current().name, 'join-group');
            assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, 0); r.unmount();
        }
        const direct = history('/join-group'); direct.router.dismissTo('/groups', { withAnchor: true });
        assert.equal(direct.current().name, 'groups');
    });
    await test('Join blocks duplicate requests and busy exits during token preflight and submission', async () => {
        for (const phase of ['preflight', 'rpc']) {
            const task = defer(); const { h, rt, r } = await groupsFlow(call => call.url.pathname.endsWith('/request_group_access') ? task.promise : backend(call));
            await click(r, 'Join a Group'); await enter(r, 'Invite code', 'Pending');
            const original = rt.supabase.auth.getSession;
            if (phase === 'preflight') rt.supabase.auth.getSession = () => task.promise;
            const submit = button(r, 'Request Access').props.onPress, pending = submit(); await r.settle(); await submit();
            assert(button(r, 'Back').props.disabled); assert(button(r, 'Cancel').props.disabled);
            assert(rt.attemptRemoval({ type: 'GO_BACK' })); await r.settle();
            assert(textOf(r.output).includes('Save in progress')); assert(!nodes(r.output).some(n => n.type === 'Pressable' && textOf(n.props.children) === 'Discard'));
            await click(r, 'Stay');
            task.resolve(phase === 'preflight' ? { data: { session: null }, error: null } : response(null));
            await pending; await r.settle(); rt.supabase.auth.getSession = original;
            assert.equal(h.current().name, 'join-group');
            assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, phase === 'rpc' ? 1 : 0);
            if (phase === 'rpc') { assert(textOf(r.output).includes('Owner must approve')); await click(r, 'Return to Groups'); assert.equal(h.current().name, 'groups'); }
            r.unmount();
        }
    });
    await test('Uncertain creation exits retain identity on Groups and rearm tab switch/reselect warnings', async () => {
        for (const exit of ['Back', 'Cancel', 'native', 'Review Groups After Creation']) for (const target of ['index', '(groups)']) {
            const { h, rt, r, creation } = await groupsFlow(call => call.url.pathname.endsWith('/create_group')
                ? response({ message: 'Lost creation response' }, 503) : backend(call));
            await click(r, 'Create a Group'); await enter(r, 'New group name', 'Unconfirmed dinner');
            const staleCreate = button(r, 'Create Group').props.onPress;
            await click(r, 'Create Group'); const attempt = creation().attempt;
            assert.equal(attempt.status, 'uncertain');
            async function leave() {
                if (exit === 'native') { assert(rt.attemptRemoval({ type: 'GO_BACK' })); await r.settle(); }
                else await click(r, exit);
            }
            await leave(); assert(textOf(r.output).includes('Review this save before leaving'));
            assert(textOf(r.output).includes('Leaving does not cancel the request or unlock another creation.'));
            assert(!textOf(r.output).includes('Discard unsaved changes?'));
            await click(r, 'Stay'); assert.equal(creation().attempt, attempt);
            await leave(); await click(r, 'Leave Anyway'); assert.equal(h.current().name, 'groups');
            assert.equal(creation().attempt, attempt); assert(textOf(r.output).includes('is unconfirmed.'));
            // Repeated root reselect does not blur Groups; its guard must still rearm.
            for (let i = 0; i < 2; i++) {
                assert(tabPress(r, h, target)); await r.settle(); assert(textOf(r.output).includes('Review this save before leaving'));
                await click(r, 'Leave Anyway'); assert.equal(creation().attempt, attempt);
                if (target === 'index') { rt.world.focused = false; r.dirty = true; await r.settle(); h.select('(groups)'); rt.world.focused = true; r.dirty = true; await r.settle(); }
            }
            await click(r, 'Create a Group'); await click(r, 'Leave Anyway');
            assert.equal(h.current().name, 'create-group'); assert(button(r, 'Create Group').props.disabled);
            assert.equal(nodes(r.output).find(n => n.props?.accessibilityLabel === 'New group name').props.value, '');
            await staleCreate(); await r.settle(); assert.equal(creation().attempt, attempt);
            await click(r, 'Back'); await click(r, 'Leave Anyway');
            await click(r, 'Review Groups After Creation'); assert(button(r, 'Start a Separate Group'));
            assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, 1); r.unmount();
        }
    });
    await test('Groups pending creation remains discoverable and recovery keeps native/local exit protection', async () => {
        for (const exit of ['native', 'local']) {
            const { rt, r, creation } = await groupsFlow();
            const pending = creation().begin('Pending dinner'); r.dirty = true; await r.settle();
            assert(textOf(r.output).includes('is in progress')); assert(button(r, 'Create a Group').props.disabled);
            creation().settle(pending, true); r.dirty = true; await r.settle(); const attempt = creation().attempt;
            if (exit === 'native') { assert(rt.attemptRemoval({ type: 'POP', payload: { count: 1 } })); await r.settle(); }
            else await click(r, 'Dinner Owner');
            assert(textOf(r.output).includes('Review this save before leaving')); await click(r, 'Stay');
            assert.equal(creation().attempt, attempt); assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, 0); r.unmount();
        }
    });
    await test('Unlocking creation sends nothing and leaves the dedicated creation action available', async () => {
        const { h, rt, r, creation } = await groupsFlow(call => call.url.pathname.endsWith('/create_group')
            ? response({ message: 'Lost' }, 503) : backend(call));
        await click(r, 'Create a Group'); await enter(r, 'New group name', 'Dinner'); await click(r, 'Create Group');
        await click(r, 'Cancel'); await click(r, 'Leave Anyway');
        await click(r, 'Review Groups After Creation');
        await click(r, 'Start a Separate Group'); await click(r, 'I Understand — Unlock Creation');
        assert.equal(creation().attempt, null); assert.equal(h.current().name, 'groups');
        await click(r, 'Create a Group'); assert.equal(h.current().name, 'create-group');
        assert(!button(r, 'Create Group').props.disabled);
        assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, 1); r.unmount();
    });
    await test('Groups home orders its count/cards/actions, preserves roles, and refreshes/retries without an Add CTA', async () => {
        let rows = [{ id: groupId, name: 'Dinner', owner_user_id: 'a' }, { id: otherGroupId, name: 'Lunch', owner_user_id: 'b' }], failed = false;
        const { rt, r } = await groupsFlow(call => call.url.pathname === '/rest/v1/groups'
            ? failed ? response({ message: 'Read failed' }, 400) : response(rows) : backend(call));
        const text = textOf(r.output);
        const labels = ['Groups', 'Your shared restaurant memories, all in one place.', 'Your Groups (2)', 'Dinner Owner', 'Lunch Member', 'Create a Group', 'Join a Group'];
        for (let i = 1; i < labels.length; i++) assert(text.indexOf(labels[i]) > text.indexOf(labels[i - 1]));
        assert(!text.includes('Add Restaurant / Visit')); assert(!text.includes('Your join requests'));
        assert(!nodes(r.output).some(n => n.type === 'TextInput'));
        const refresh = button(r, 'Refresh Groups'); assert.equal(refresh.props.accessibilityRole, 'button');
        assert(flatten(refresh.props.style).minWidth >= 44); assert(flatten(refresh.props.style).minHeight >= 44);
        assert(button(r, 'Dinner Owner')); assert(button(r, 'Lunch Member'));
        assert.equal(flatten(button(r, 'Create a Group').props.style).backgroundColor, '#C9472C');
        assert.equal(flatten(button(r, 'Join a Group').props.style).borderColor, '#E85D3F');
        failed = true; await click(r, 'Refresh Groups'); assert(textOf(r.output).includes('Could not load your groups.'));
        assert(!textOf(r.output).includes('Your Groups (0)')); assert(!textOf(r.output).includes('Dinner'));
        failed = false; rows = []; await click(r, 'Refresh Groups');
        assert(textOf(r.output).includes('Your Groups (0)')); assert(textOf(r.output).includes('No groups yet.'));
        rows = [{ id: groupId, name: 'Dinner', owner_user_id: 'a' }]; rt.poll(); await r.settle();
        assert(textOf(r.output).includes('Your Groups (1)'));
        rt.emit('inactive'); await r.settle(); assert(!textOf(r.output).includes('Dinner'));
        rt.emit('active'); await r.settle(); assert(button(r, 'Dinner Owner'));
        assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, 0);
        assert(rt.world.requests.every(c => c.url.pathname === '/rest/v1/groups')); r.unmount();
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
    await test('Stale one-field exit/submit callbacks cannot affect a replacement account', async () => {
        for (const route of ['create-group', 'join-group']) {
            const rt = runtime({ fetch: backend }), r = screen(rt, route); await r.settle();
            const label = route === 'create-group' ? 'New group name' : 'Invite code';
            await enter(r, label, 'Unsent draft');
            const staleBack = button(r, 'Back').props.onPress, staleCancel = button(r, 'Cancel').props.onPress;
            const staleSubmit = button(r, route === 'create-group' ? 'Create Group' : 'Request Access').props.onPress;
            rt.switch('b', r); await r.settle(); await staleBack(); await staleCancel(); await staleSubmit(); await r.settle();
            assert.equal(rt.world.navigation.length, 0); assert.equal(rt.world.lateUpdates, 0);
            assert.equal(inputValue(r, label), ''); assert(!nodes(r.output).some(n => n.type === 'Modal'));
            assert.equal(rt.world.requests.filter(c => c.method !== 'GET').length, 0); r.unmount();
        }
    });
    await test('Full-screen archive edit keeps storage-only behavior and returns to Account detail', async () => {
        const h = history('/place/legacy'), rt = runtime({ router: h.router }); rt.world.params = { id: 'legacy' };
        h.router.push({ pathname: '/add-place', params: rt.world.params });
        const r = screen(rt, 'add-place'); await r.settle(); await click(r, 'Save Changes'); noForms(h);
        assert.equal(h.chain()[2].name, '(account)'); assert.equal(h.current().params.id, 'legacy');
        assert.equal(rt.world.localWrites, 1); assert.equal(rt.world.requests.length, 0); r.unmount();
    });
    await require('./unified-add.cjs').run('navigation');
    console.log(`${passed} nested navigation/leave-safety checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
