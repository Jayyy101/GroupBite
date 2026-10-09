// Actual screen handlers drive the installed stack reducer, offline. Expo's
// stack override delegates POP_TO (dismissTo), REPLACE and POP to this reducer.
const assert = require('node:assert/strict');
const { runtime, fixture, response, screen, click, enter, fill, nodes, textOf } = require('./personal-places.cjs');

const groupId = '22222222-2222-2222-2222-222222222222';
const otherGroupId = '33333333-3333-3333-3333-333333333333';
const restaurantId = '44444444-4444-4444-4444-444444444444';
const entryId = '55555555-5555-5555-5555-555555555555';
const personalDetail = id => ({ pathname: '/personal-place/[id]', params: { id } });
const groupDetail = id => ({ pathname: '/group/[id]', params: { id } });
const restaurantDetail = { pathname: '/group/[id]/restaurant/[entryId]', params: { id: groupId, entryId } };
const form = id => ({ pathname: '/personal-place-form', params: { id } });
let passed = 0;

async function main() {
    const { StackRouter } = await import('@react-navigation/routers');
    function history(initial) {
        const reducer = StackRouter({});
        const routeNames = ['index', 'my-places', 'personal-place-form', 'personal-place/[id]', 'groups', 'group/[id]',
            'group/[id]/restaurant/[entryId]', 'add-visit', 'saved-places', 'place/[id]', 'add-place'];
        const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
        const route = href => {
            const pathname = typeof href === 'string' ? href : href.pathname;
            return { name: pathname === '/' ? 'index' : pathname.slice(1), params: typeof href === 'string' ? undefined : href.params };
        };
        let state = { ...reducer.getInitialState(options), index: initial.length - 1,
            routes: initial.map((href, i) => ({ ...route(href), key: `initial-${i}` })) };
        function dispatch(type, href) {
            const next = reducer.getStateForAction(state, { type, payload: href ? route(href) : { count: 1 }, target: state.key }, options);
            assert(next, 'Unhandled stack action ' + type);
            state = next;
        }
        return {
            router: { push: href => dispatch('PUSH', href), replace: href => dispatch('REPLACE', href), dismissTo: href => dispatch('POP_TO', href),
                canGoBack: () => state.index > 0, back: () => dispatch('POP') },
            paths: () => state.routes.map(r => r.name), current: () => state.routes[state.index],
        };
    }
    async function test(label, fn) { await fn(); passed++; console.log('PASS ' + label); }
    function noForms(h) {
        assert(!h.paths().some(p => ['personal-place-form', 'add-visit', 'add-place'].includes(p)), 'A finished/abandoned form remains in history');
    }

    await test('Personal create removes the form before detail and both Back controls reach My Places', async () => {
        for (const systemBack of [false, true]) {
            const h = history(['/', '/my-places', '/personal-place-form']);
            const rt = runtime({ router: h.router }), r = screen(rt, 'personal-place-form');
            await r.settle(); await fill(r); await click(r, 'Save Personal Place'); r.unmount();
            noForms(h); assert.equal(h.current().params.id, rt.world.rows[0].id);
            rt.world.params = h.current().params;
            const detail = screen(rt, 'personal-place/[id]'); await detail.settle();
            if (systemBack) h.router.back(); else await click(detail, 'Back');
            assert.deepEqual(h.paths(), ['index', 'my-places']); detail.unmount();
        }
    });
    await test('Personal edit returns to the existing detail without duplicate details or the completed form', async () => {
        const place = fixture(), h = history(['/', '/my-places', personalDetail(place.id)]);
        const rt = runtime({ router: h.router }); rt.world.rows = [place]; rt.world.params = { id: place.id };
        const detail = screen(rt, 'personal-place/[id]'); await detail.settle(); await click(detail, 'Edit Personal Place'); detail.unmount();
        const r = screen(rt, 'personal-place-form'); await r.settle(); await enter(r, 'Personal notes', 'Edited'); await click(r, 'Save Changes'); r.unmount();
        assert.deepEqual(h.paths(), ['index', 'my-places', 'personal-place/[id]']); noForms(h);
        const refreshed = screen(rt, 'personal-place/[id]'); await refreshed.settle(); assert(textOf(refreshed.output).includes('Edited'));
        h.router.back(); assert.equal(h.current().name, 'my-places'); refreshed.unmount();
    });
    await test('Personal direct-entry save and edit replace the form; detail Back has a parent fallback', async () => {
        for (const editing of [false, true]) {
            const place = fixture(), h = history([editing ? form(place.id) : '/personal-place-form']);
            const rt = runtime({ router: h.router });
            if (editing) { rt.world.rows = [place]; rt.world.params = { id: place.id }; }
            const r = screen(rt, 'personal-place-form'); await r.settle();
            if (!editing) await fill(r);
            await click(r, editing ? 'Save Changes' : 'Save Personal Place'); r.unmount(); noForms(h);
            rt.world.params = h.current().params;
            const detail = screen(rt, 'personal-place/[id]'); await detail.settle(); await click(detail, 'Back');
            assert.deepEqual(h.paths(), ['my-places']); detail.unmount();
        }
    });
    await test('Reconciled personal save removes the uncertain form with no mutation replay', async () => {
        const h = history(['/', '/my-places', '/personal-place-form']), rt = runtime({ router: h.router });
        rt.world.override = call => call.method === 'POST' ? response({ message: 'Lost response' }, 400) : null;
        const r = screen(rt, 'personal-place-form'); await r.settle(); await fill(r); await click(r, 'Save Personal Place');
        assert.equal(h.current().name, 'personal-place-form');
        rt.world.rows.push(fixture({ ...rt.world.requests.find(c => c.method === 'POST').body }));
        await click(r, 'Check Saved Result'); noForms(h);
        assert.equal(rt.world.requests.filter(c => c.method === 'POST').length, 1); r.unmount();
        h.router.back(); assert.equal(h.current().name, 'my-places');
    });
    await test('Personal failed edit retains the form; cancellation returns to its parent', async () => {
        const place = fixture(), h = history(['/', '/my-places', personalDetail(place.id), form(place.id)]);
        const rt = runtime({ router: h.router }); rt.world.rows = [place]; rt.world.params = { id: place.id };
        rt.world.override = call => call.method === 'PATCH' ? response([], 200) : null;
        const r = screen(rt, 'personal-place-form'); await r.settle(); await click(r, 'Save Changes');
        assert.equal(h.current().name, 'personal-place-form'); await click(r, 'Cancel and Refresh Place'); noForms(h); r.unmount();
        h.router.back(); assert.equal(h.current().name, 'my-places');
    });
    await test('Personal delete returns to My Places without a stale detail or form in history', async () => {
        const place = fixture(), h = history(['/', '/my-places', personalDetail(place.id)]);
        const rt = runtime({ router: h.router }); rt.world.rows = [place]; rt.world.params = { id: place.id };
        const r = screen(rt, 'personal-place/[id]'); await r.settle();
        await click(r, 'Delete Personal Place'); await click(r, 'Cancel'); assert.equal(h.current().name, 'personal-place/[id]');
        await click(r, 'Delete Personal Place'); await click(r, 'Confirm Delete'); r.unmount();
        assert.deepEqual(h.paths(), ['index', 'my-places']); noForms(h); h.router.back(); assert.equal(h.current().name, 'index');
    });

    function visitRuntime(h, available = [groupId], saveError = null) {
        return runtime({ router: h.router, fetch: call => {
            const single = call.headers.get('Accept')?.includes('vnd.pgrst.object');
            switch (call.url.pathname) {
                case '/rest/v1/groups': {
                    const rows = available.map(id => ({ id, name: id === groupId ? 'Dinner' : 'Lunch', owner_user_id: 'a' }));
                    return response(single ? rows.find(g => call.url.searchParams.get('id') === 'eq.' + g.id) ?? null : rows);
                }
                case '/rest/v1/restaurants': return response({ id: restaurantId, name: 'Existing Cafe', address: 'Existing Address', cuisine: null });
                case '/rest/v1/group_memberships': return response({ membership_id: 'admission' });
                case '/rest/v1/rpc/save_restaurant_visit': return saveError ? response(saveError, 403) : response(restaurantId);
                case '/rest/v1/rpc/get_group_restaurants': return response([{ id: entryId, restaurant_id: restaurantId, name: 'Existing Cafe', address: 'Existing Address', visit_count: 1, rated_visit_count: 0, average_rating: null }]);
                case '/rest/v1/rpc/get_group_restaurant_visits': return response([]);
                default: assert.fail('Unexpected group request: ' + call.url.pathname);
            }
        } });
    }
    async function select(r, name) {
        const checkbox = nodes(r.output).find(n => n.type === 'Pressable' && n.props.accessibilityRole === 'checkbox' && textOf(n.props.children).endsWith(name));
        assert(checkbox); checkbox.props.onPress(); await r.settle();
    }
    await test('Single-group Visit saves from Home, Groups, group and restaurant remove the form', async () => {
        for (const prefix of [['/'], ['/', '/groups'], ['/', '/groups', groupDetail(groupId)], ['/', '/groups', groupDetail(groupId), restaurantDetail]]) {
            const existing = prefix.at(-1) === restaurantDetail;
            const h = history([...prefix, { pathname: '/add-visit', params: { groupId, ...(existing ? { restaurantId } : {}) } }]);
            const rt = visitRuntime(h); rt.world.params = h.current().params;
            const r = screen(rt, 'add-visit'); await r.settle();
            if (!existing) { await enter(r, 'Restaurant name', 'New Cafe'); await enter(r, 'Restaurant address', 'New Address'); }
            await click(r, 'Save Visit'); r.unmount(); noForms(h);
            assert.equal(h.current().name, 'group/[id]'); assert.equal(h.current().params.id, groupId);
            h.router.push(restaurantDetail); rt.world.params = h.current().params;
            const detail = screen(rt, 'group/[id]/restaurant/[entryId]'); await detail.settle(); await click(detail, 'Back'); detail.unmount();
            assert.equal(h.current().name, 'group/[id]'); noForms(h);
            h.router.back(); noForms(h); assert.equal(h.current().name, prefix.length === 1 ? 'index' : 'groups');
            assert.equal(rt.world.localWrites, 0);
        }
    });
    await test('Multi-group Visit pops to existing Groups and replaces the form when Groups is absent', async () => {
        for (const prefix of [['/'], ['/', '/groups', groupDetail(groupId), restaurantDetail]]) {
            const h = history([...prefix, '/add-visit']), rt = visitRuntime(h, [groupId, otherGroupId]);
            const r = screen(rt, 'add-visit'); await r.settle(); await enter(r, 'Restaurant name', 'Cafe'); await enter(r, 'Restaurant address', 'Address');
            await select(r, 'Dinner'); await select(r, 'Lunch'); await click(r, 'Save Visit'); r.unmount();
            assert.deepEqual(h.paths(), ['index', 'groups']); noForms(h); h.router.back(); assert.equal(h.current().name, 'index');
        }
    });
    await test('Visit failure retains the form and Back cancels without saving again', async () => {
        const h = history(['/', '/groups', groupDetail(groupId), { pathname: '/add-visit', params: { groupId } }]);
        const rt = visitRuntime(h, [groupId], { code: '42501', message: 'Access denied' }); rt.world.params = { groupId };
        const r = screen(rt, 'add-visit'); await r.settle(); await enter(r, 'Restaurant name', 'Cafe'); await enter(r, 'Restaurant address', 'Address');
        await click(r, 'Save Visit'); assert.equal(h.current().name, 'add-visit'); await click(r, 'Back'); r.unmount();
        assert.equal(h.current().name, 'group/[id]'); assert.equal(rt.world.requests.filter(c => c.method === 'POST').length, 1);
    });
    await test('Direct-entry Visit save replaces the form, and cancellation uses Groups fallback', async () => {
        for (const saving of [false, true]) {
            const h = history([{ pathname: '/add-visit', params: { groupId } }]), rt = visitRuntime(h);
            rt.world.params = { groupId };
            const r = screen(rt, 'add-visit'); await r.settle();
            if (saving) {
                await enter(r, 'Restaurant name', 'Cafe'); await enter(r, 'Restaurant address', 'Address'); await click(r, 'Save Visit');
                assert.equal(h.current().name, 'group/[id]'); assert.equal(h.current().params.id, groupId);
            } else {
                await click(r, 'Back'); assert.equal(h.current().name, 'groups'); assert.equal(rt.world.requests.filter(c => c.method === 'POST').length, 0);
            }
            r.unmount(); noForms(h); assert.equal(h.paths().length, 1);
        }
    });
    await test('Create / Join a Group leaves no Visit form underneath Groups or a later saved visit', async () => {
        for (const prefix of [['/'], ['/', '/groups']]) {
            const h = history([...prefix, '/add-visit']), rt = visitRuntime(h, []);
            const r = screen(rt, 'add-visit'); await r.settle(); await click(r, 'Create / Join a Group'); r.unmount();
            assert.deepEqual(h.paths(), ['index', 'groups']); noForms(h);
            h.router.push({ pathname: '/add-visit', params: { groupId } });
            const later = visitRuntime(h); later.world.params = { groupId };
            const next = screen(later, 'add-visit'); await next.settle(); await enter(next, 'Restaurant name', 'Cafe'); await enter(next, 'Restaurant address', 'Address');
            await click(next, 'Save Visit'); next.unmount(); noForms(h);
            h.router.back(); assert.equal(h.current().name, 'groups'); h.router.back(); assert.equal(h.current().name, 'index');
        }
    });
    await test('Legacy edit preserves storage behavior and pops to its detail without a completed form', async () => {
        const h = history(['/', '/saved-places', { pathname: '/place/[id]', params: { id: 'legacy' } }, { pathname: '/add-place', params: { id: 'legacy' } }]);
        const rt = runtime({ router: h.router }); rt.world.params = { id: 'legacy' };
        const r = screen(rt, 'add-place'); await r.settle(); await click(r, 'Save Changes'); r.unmount(); noForms(h);
        assert.equal(rt.world.localWrites, 1); assert.equal(h.current().name, 'place/[id]');
        const detail = screen(rt, 'place/[id]'); await detail.settle(); await click(detail, 'Back'); detail.unmount();
        assert.equal(h.current().name, 'saved-places'); assert.equal(rt.world.requests.length, 0);
    });
    console.log(`${passed} navigation regression checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
