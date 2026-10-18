// Actual route controllers, real client helpers, synthetic accounts and offline HTTP.
const assert = require('node:assert/strict');
const { runtime, fixture, response, screen, click, enter, button, nodes, textOf } = require('./personal-places.cjs');
const groupId = '22222222-2222-2222-2222-222222222222';
const entryId = '55555555-5555-5555-5555-555555555555';
const restaurantId = '44444444-4444-4444-4444-444444444444';
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const input = (r, label) => nodes(r.output).find(n => n.type === 'TextInput' && n.props.accessibilityLabel === label);
const mutations = rt => rt.world.requests.filter(c => /\/(?:update|delete)_group_visit$/.test(c.url.pathname));
const creations = rt => rt.world.requests.filter(c => c.url.pathname.endsWith('/create_group'));
const personalWrites = rt => rt.world.requests.filter(c => c.url.pathname.endsWith('/update_personal_place'));
let passed = 0;
async function test(label, fn) { await fn(); passed++; console.log('PASS ' + label); }
async function pause(rt, r) { rt.emit('inactive'); await r.settle(); rt.emit('background'); await r.settle(); }
async function resume(rt, r) { rt.emit('active'); await r.settle(); }

async function restaurantSetup(options = {}) {
    const state = { membership: 'original-membership', owner: 'a', accessFailure: false, accessGate: null,
        detailFailure: false, visitGate: null, exists: true, mutation: null, visits: [
            { id: 'visit', creator_display_name: 'Member', can_manage: true, visited_on: null, rating: null, would_go_again: false, notes: 'Original private note' },
        ] };
    const rt = runtime({ ...options, platform: 'ios', fetch: call => {
        if (call.url.pathname === '/rest/v1/groups') {
            if (state.accessGate) return state.accessGate.promise;
            return state.accessFailure ? response({ message: 'offline' }, 400) : response({ id: groupId, owner_user_id: state.owner, name: 'Private group' });
        }
        if (call.url.pathname === '/rest/v1/group_memberships') return response(state.membership ? { membership_id: state.membership } : null);
        if (call.url.pathname.endsWith('/get_group_restaurants')) return state.detailFailure ? response({ message: 'offline' }, 400)
            : response(state.exists ? [{ id: entryId, restaurant_id: restaurantId, name: 'Private cafe', address: 'Private address', cuisine: null, average_rating: null, total_visit_count: state.visits.length, rated_visit_count: 0 }] : []);
        if (call.url.pathname.endsWith('/get_group_restaurant_visits')) return state.visitGate?.promise ?? response(state.visits);
        if (/\/(?:update|delete)_group_visit$/.test(call.url.pathname)) {
            assert.equal(call.user, 'a'); return state.mutation?.promise ?? response(null);
        }
        assert.fail('Unexpected request ' + call.url.pathname);
    } });
    rt.world.params = { id: groupId, entryId };
    const r = screen(rt, 'group/[id]/restaurant/[entryId]'); await r.settle();
    return { rt, r, state };
}
async function edit(f) { await click(f.r, 'Edit Visit'); await enter(f.r, 'Edit visit notes', 'Retained draft'); }
function hiddenVisit(r) {
    assert(!textOf(r.output).includes('Private cafe')); assert(!textOf(r.output).includes('Private address'));
    assert(!textOf(r.output).includes('Original private note')); assert(!input(r, 'Edit visit notes'));
}
async function personalSetup() {
    const rt = runtime({ platform: 'ios' }); rt.world.params = { id: fixture().id }; rt.world.rows = [fixture()];
    const r = screen(rt, 'personal-place-form'); await r.settle(); return { rt, r };
}
async function groupSetup(result, options = {}) {
    const state = { rows: [], failure: false, result };
    const rt = runtime({ ...options, fetch: call => {
        if (call.url.pathname === '/rest/v1/groups') return state.failure ? response({ message: 'offline' }, 400) : response(state.rows);
        if (call.url.pathname === '/rest/v1/join_requests') return response([]);
        if (call.url.pathname.endsWith('/create_group')) return state.result(call, state);
        assert.fail('Unexpected request ' + call.url.pathname);
    } });
    const Groups = rt.load('app/groups').default;
    rt.world.showGroups = true;
    function Route() { return rt.world.showGroups ? { type: Groups, props: {} } : null; }
    const r = rt.render(Route); await r.settle(); return { rt, r, state };
}

function deadlines() {
    const pending = new Set();
    return { options: {
        setTimeout(fn, delay) { if (delay !== 20000) return setTimeout(fn, delay); const timer = { fn }; pending.add(timer); return timer; },
        clearTimeout(timer) { if (!pending.delete(timer)) clearTimeout(timer); },
    }, expire() { const timers = [...pending]; assert(timers.length); pending.clear(); timers.forEach(timer => timer.fn()); } };
}

(async () => {
    await test('Actual restaurant retains dirty Visit fields but hides them until delayed access revalidation finishes', async () => {
        const f = await restaurantSetup(); await edit(f); const staleSave = button(f.r, 'Save Changes').props.onPress;
        await pause(f.rt, f.r); hiddenVisit(f.r);
        const gate = defer(); f.state.accessGate = gate; await resume(f.rt, f.r); hiddenVisit(f.r);
        await staleSave(); assert.equal(mutations(f.rt).length, 0);
        f.state.accessGate = null; gate.resolve(response({ id: groupId, owner_user_id: 'a', name: 'Private group' })); await f.r.settle();
        assert.equal(input(f.r, 'Edit visit notes').props.value, 'Retained draft');
        f.rt.emit('inactive'); f.rt.emit('active'); await f.r.settle();
        assert.equal(input(f.r, 'Edit visit notes').props.value, 'Retained draft');
        assert(f.rt.attemptRemoval({ type: 'POP' })); await f.r.settle(); await click(f.r, 'Stay');
        await click(f.r, 'Cancel'); await click(f.r, 'Discard'); assert.equal(mutations(f.rt).length, 0); f.r.unmount();
    });
    await test('Transient access polling and detail-read failures retain the editor for a successful explicit refresh', async () => {
        const f = await restaurantSetup(); await edit(f); f.state.accessFailure = true; f.rt.poll(); await f.r.settle(); hiddenVisit(f.r);
        f.state.accessFailure = false; f.state.detailFailure = true; await click(f.r, 'Refresh Restaurant'); hiddenVisit(f.r);
        f.state.detailFailure = false; await click(f.r, 'Refresh Restaurant');
        assert.equal(input(f.r, 'Edit visit notes').props.value, 'Retained draft'); assert.equal(mutations(f.rt).length, 0); f.r.unmount();
    });
    for (const action of ['edit', 'delete']) for (const outcome of ['success', 'lost']) {
        await test(`Actual restaurant preserves pending ${action} and hidden ${outcome} outcome for read-only reconciliation`, async () => {
            const f = await restaurantSetup(); f.state.mutation = defer();
            if (action === 'edit') await edit(f); else await click(f.r, 'Delete Visit');
            const submit = button(f.r, action === 'edit' ? 'Save Changes' : 'Confirm Delete Visit').props.onPress;
            const pending = submit(); await f.r.settle(); assert.equal(mutations(f.rt).length, 1);
            await pause(f.rt, f.r); hiddenVisit(f.r); await submit(); assert.equal(mutations(f.rt).length, 1);
            if (action === 'edit') f.state.visits[0].notes = 'Retained draft'; else { f.state.visits = []; f.state.exists = false; }
            f.state.mutation.resolve(outcome === 'lost' ? response({ message: 'Lost response' }, 503) : response(action === 'delete' ? true : null));
            await pending; await f.r.settle(); assert.equal(f.rt.world.navigation.length, 0);
            await resume(f.rt, f.r); assert(button(f.r, 'Check Saved Visit')); await submit(); assert.equal(mutations(f.rt).length, 1);
            await click(f.r, 'Check Saved Visit'); assert.equal(mutations(f.rt).length, 1);
            if (action === 'delete') assert.equal(f.rt.world.navigation.at(-1).pathname, '/group/[id]');
            else assert(textOf(f.r.output).includes('Visit updated.'));
            assert(f.rt.world.requests.filter(c => c.url.pathname.includes('/rpc/')).every(c => c.user === 'a'));
            assert.equal(f.rt.world.lateUpdates, 0); f.r.unmount();
        });
    }
    await test('A still-pending Visit stays busy after foregrounding and does not permit another submission', async () => {
        const f = await restaurantSetup(); await edit(f); f.state.mutation = defer();
        const submit = button(f.r, 'Save Changes').props.onPress, pending = submit(); await f.r.settle();
        await pause(f.rt, f.r); await resume(f.rt, f.r); assert(button(f.r, 'Saving...').props.disabled);
        await submit(); assert.equal(mutations(f.rt).length, 1);
        f.state.mutation.resolve(response({ message: 'lost' }, 503)); await pending; await f.r.settle(); assert(button(f.r, 'Check Saved Visit')); f.r.unmount();
    });
    await test('A pending Visit completed after blur/refocus requires explicit review instead of navigating automatically', async () => {
        const f = await restaurantSetup(); await edit(f); f.state.mutation = defer();
        const pending = button(f.r, 'Save Changes').props.onPress(); await f.r.settle();
        f.rt.world.focused = false; f.r.dirty = true; await f.r.settle(); hiddenVisit(f.r);
        f.rt.world.focused = true; f.r.dirty = true; await f.r.settle();
        f.state.visits[0].notes = 'Retained draft'; f.state.mutation.resolve(response(null)); await pending; await f.r.settle();
        assert.equal(f.rt.world.navigation.length, 0); assert(button(f.r, 'Check Saved Visit'));
        await click(f.r, 'Check Saved Visit'); assert.equal(mutations(f.rt).length, 1); f.r.unmount();
    });
    await test('Visit preflight interrupted by inactivity dispatches nothing and retains editable fields', async () => {
        const f = await restaurantSetup(); await edit(f); const task = defer(), original = f.rt.supabase.auth.getSession;
        f.rt.supabase.auth.getSession = () => task.promise;
        const pending = button(f.r, 'Save Changes').props.onPress(); await f.r.settle();
        await pause(f.rt, f.r); f.rt.supabase.auth.getSession = original; await resume(f.rt, f.r);
        task.resolve(await original()); await pending; await f.r.settle();
        assert.equal(mutations(f.rt).length, 0); assert.equal(input(f.r, 'Edit visit notes').props.value, 'Retained draft');
        assert(!button(f.r, 'Save Changes').props.disabled); f.r.unmount();
    });
    await test('Uncommitted uncertainty remains locked after mismatching reads but warned abandonment never retries', async () => {
        const f = await restaurantSetup(); await edit(f); f.state.mutation = defer();
        const staleSave = button(f.r, 'Save Changes').props.onPress, pending = staleSave(); await f.r.settle();
        f.state.mutation.resolve(response({ message: 'Not confirmed' }, 503)); await pending; await f.r.settle();
        await pause(f.rt, f.r); await resume(f.rt, f.r); await click(f.r, 'Check Saved Visit');
        assert(textOf(f.r.output).includes('does not confirm')); assert(button(f.r, 'Save Changes').props.disabled);
        await click(f.r, 'Cancel'); assert(textOf(f.r.output).includes('does not undo')); await click(f.r, 'Stay');
        await click(f.r, 'Cancel'); await click(f.r, 'Leave Anyway'); await staleSave(); assert.equal(mutations(f.rt).length, 1);
        await edit(f); await staleSave(); assert.equal(mutations(f.rt).length, 1); f.r.unmount();
    });
    for (const change of ['account', 'sign-out', 'entry', 'group', 'membership', 'owner', 'revoked']) {
        await test(`Restaurant ${change} change disposes old drafts, pending results and retained callbacks`, async () => {
            const f = await restaurantSetup(); await edit(f); f.state.mutation = defer();
            const staleSave = button(f.r, 'Save Changes').props.onPress, pending = staleSave(); await f.r.settle();
            if (change === 'account' || change === 'sign-out') f.rt.switch(change === 'account' ? 'b' : null, f.r);
            else if (change === 'entry' || change === 'group') { f.rt.world.params = { id: groupId, entryId, [change === 'entry' ? 'entryId' : 'id']: '66666666-6666-6666-6666-666666666666' }; f.r.dirty = true; }
            else {
                if (change === 'membership') f.state.membership = 'replacement-membership';
                if (change === 'owner') f.state.owner = 'b';
                if (change === 'revoked') f.state.membership = null;
                f.rt.poll();
            }
            await f.r.settle(); assert(!input(f.r, 'Edit visit notes'));
            f.state.mutation.resolve(response(null)); await pending; await f.r.settle(); await staleSave();
            assert.equal(mutations(f.rt).length, 1); assert.equal(f.rt.world.navigation.length, 0); assert.equal(f.rt.world.lateUpdates, 0);
            if (change === 'revoked') {
                f.state.membership = 'rejoined-membership'; f.rt.poll(); await f.r.settle(); await click(f.r, 'Edit Visit');
                assert.equal(input(f.r, 'Edit visit notes').props.value, 'Original private note');
            }
            f.r.unmount();
        });
    }
    await test('A reconciliation read interrupted by inactivity never completes navigation or replays a mutation', async () => {
        const f = await restaurantSetup(); await edit(f); f.state.mutation = defer();
        const pending = button(f.r, 'Save Changes').props.onPress(); await f.r.settle();
        f.state.mutation.resolve(response({ message: 'Lost' }, 503)); await pending; await f.r.settle();
        const read = defer(); f.state.visitGate = read;
        const checking = button(f.r, 'Check Saved Visit').props.onPress(); await f.r.settle(); await pause(f.rt, f.r);
        read.resolve(response([{ ...f.state.visits[0], notes: 'Retained draft' }])); await checking; await f.r.settle();
        f.state.visitGate = null; await resume(f.rt, f.r);
        assert(button(f.r, 'Check Saved Visit')); assert.equal(f.rt.world.navigation.length, 0); assert.equal(mutations(f.rt).length, 1); f.r.unmount();
    });

    await test('Visit mutation and reconciliation deadlines release busy state, retain uncertainty and ignore late results', async () => {
        const clock = deadlines(), f = await restaurantSetup(clock.options); await edit(f); f.state.mutation = defer();
        const submit = button(f.r, 'Save Changes').props.onPress, pending = submit(); await f.r.settle(); clock.expire(); await pending; await f.r.settle();
        assert(button(f.r, 'Check Saved Visit')); await submit(); assert.equal(mutations(f.rt).length, 1);
        f.state.mutation.resolve(response(null)); await f.r.settle(); assert.equal(f.rt.world.navigation.length, 0);
        f.state.visitGate = defer(); const checking = button(f.r, 'Check Saved Visit').props.onPress(); await f.r.settle(); clock.expire(); await checking; await f.r.settle();
        assert(!button(f.r, 'Check Saved Visit').props.disabled); await click(f.r, 'Cancel'); await click(f.r, 'Leave Anyway');
        f.state.visitGate.resolve(response([{ ...f.state.visits[0], notes: 'Retained draft' }])); await f.r.settle();
        assert.equal(f.rt.world.navigation.length, 0); assert.equal(mutations(f.rt).length, 1); f.r.unmount();
    });
    await test('Refreshed Visit permissions block retained mutation callbacks without exposing editable fields', async () => {
        const f = await restaurantSetup(); await edit(f); const stale = button(f.r, 'Save Changes').props.onPress;
        await pause(f.rt, f.r); f.state.visits[0].can_manage = false; await resume(f.rt, f.r);
        assert(!input(f.r, 'Edit visit notes')); assert(button(f.r, 'Save Changes').props.disabled); await stale();
        assert.equal(mutations(f.rt).length, 0); await click(f.r, 'Cancel'); await click(f.r, 'Discard'); f.r.unmount();
    });

    await test('Offline access verification still exposes warned navigation without exposing the Visit draft', async () => {
        const f = await restaurantSetup(); await edit(f); f.state.mutation = defer();
        const pending = button(f.r, 'Save Changes').props.onPress(); await f.r.settle(); f.state.mutation.resolve(response({ message: 'Lost' }, 503));
        await pending; await f.r.settle(); await pause(f.rt, f.r); f.state.accessFailure = true; await resume(f.rt, f.r); hiddenVisit(f.r);
        assert(f.rt.attemptRemoval({ type: 'POP' })); await f.r.settle(); assert(textOf(f.r.output).includes('does not undo'));
        await click(f.r, 'Stay'); assert(f.rt.attemptRemoval({ type: 'POP' })); await f.r.settle(); await click(f.r, 'Leave Anyway');
        assert.equal(f.rt.world.navigation.at(-1).type, 'POP'); assert.equal(mutations(f.rt).length, 1); f.r.unmount();
    });

    await test('Personal Edit preserves all fields, hides them during owner verification, and uses the original revision', async () => {
        const { rt, r } = await personalSetup(); await enter(r, 'Restaurant name', 'Draft name'); await enter(r, 'Cuisine', 'Draft notes');
        const before = nodes(r.output).filter(n => n.type === 'TextInput').map(n => [n.props.accessibilityLabel, n.props.value]);
        const save = button(r, 'Save Changes').props.onPress; await pause(rt, r); assert.equal(r.output, null);
        const read = defer(); rt.world.override = c => c.method === 'GET' ? read.promise : null; await resume(rt, r);
        assert(!input(r, 'Cuisine')); await save(); assert.equal(personalWrites(rt).length, 0);
        rt.world.override = null; read.resolve(response(fixture())); await r.settle();
        assert.deepEqual(nodes(r.output).filter(n => n.type === 'TextInput').map(n => [n.props.accessibilityLabel, n.props.value]), before);
        await click(r, 'Save Changes'); assert.equal(personalWrites(rt)[0].body.expected_revision, 1);
        assert.equal(personalWrites(rt)[0].user, 'a'); assert.equal(rt.world.rows[0].cuisine, 'Draft notes'); r.unmount();
    });
    await test('Personal Edit retains its draft through read failures; missing/foreign records never expose it', async () => {
        const { rt, r } = await personalSetup(); await enter(r, 'Cuisine', 'Retained edit'); await pause(rt, r);
        rt.world.override = () => response({ message: 'offline' }, 400); await resume(rt, r); assert(!input(r, 'Cuisine'));
        rt.world.override = null; await click(r, 'Refresh Place'); assert.equal(input(r, 'Cuisine').props.value, 'Retained edit');
        await pause(rt, r); rt.world.rows = []; await resume(rt, r); assert(!input(r, 'Cuisine'));
        rt.switch('b', r); rt.world.rows = [fixture({ owner_user_id: 'b', cuisine: 'B memory' })]; await r.settle();
        assert.equal(input(r, 'Cuisine').props.value, 'B memory'); assert.equal(personalWrites(rt).length, 0); r.unmount();
    });
    await test('Personal Edit pending success and uncertainty remain locked across foregrounding without a second PATCH', async () => {
        for (const success of [true, false]) {
            const { rt, r } = await personalSetup(); await enter(r, 'Cuisine', 'Pending edit'); const task = defer();
            rt.world.override = c => c.url.pathname.endsWith('/update_personal_place') ? task.promise : null;
            const submit = button(r, 'Save Changes').props.onPress, pending = submit(); await r.settle(); await pause(rt, r);
            if (success) Object.assign(rt.world.rows[0], { cuisine: 'Pending edit', revision: 2 });
            task.resolve(success ? response([rt.world.rows[0]]) : response({ message: 'Lost' }, 503)); await pending; await r.settle();
            await resume(rt, r); assert(button(r, 'Save Changes').props.disabled); await submit();
            assert.equal(personalWrites(rt).length, 1); assert.equal(rt.world.navigation.length, 0); r.unmount();
        }
    });
    await test('Personal Edit preflight interrupted by a batched lifecycle change never sends the old draft', async () => {
        const { rt, r } = await personalSetup(); await enter(r, 'Cuisine', 'Paused edit'); const task = defer(), original = rt.supabase.auth.getSession;
        rt.supabase.auth.getSession = () => task.promise; const pending = button(r, 'Save Changes').props.onPress(); await r.settle();
        rt.supabase.auth.getSession = original; rt.emit('inactive'); rt.emit('active'); await r.settle();
        task.resolve(await original()); await pending; await r.settle(); assert.equal(personalWrites(rt).length, 0);
        assert.equal(input(r, 'Cuisine').props.value, 'Paused edit'); r.unmount();
    });

    await test('Lost committed Group creation locks duplicates across lifecycle, tab blur and route remounts', async () => {
        const f = await groupSetup((call, state) => {
            state.rows.push({ id: groupId, owner_user_id: 'a', name: call.body.group_name }); return response({ message: 'Lost' }, 503);
        });
        await enter(f.r, 'New group name', 'Dinner'); const staleCreate = button(f.r, 'Create Group').props.onPress;
        await staleCreate(); await f.r.settle(); assert(button(f.r, 'Create Group').props.disabled); await staleCreate();
        await pause(f.rt, f.r); await resume(f.rt, f.r);
        f.rt.world.focused = false; f.r.dirty = true; await f.r.settle(); f.rt.world.focused = true; f.r.dirty = true; await f.r.settle();
        f.rt.world.showGroups = false; f.r.dirty = true; await f.r.settle(); f.rt.world.showGroups = true; f.r.dirty = true; await f.r.settle();
        assert(button(f.r, 'Create Group').props.disabled); await staleCreate(); assert.equal(creations(f.rt).length, 1); assert.equal(f.state.rows.length, 1);
        assert(textOf(f.r.output).includes('unconfirmed')); f.r.unmount();
    });
    await test('Group review failure or an empty successful list never silently unlocks creation; acknowledgement sends nothing', async () => {
        const f = await groupSetup(() => response({ message: 'Unknown result' }, 503)); await enter(f.r, 'New group name', 'Dinner'); await click(f.r, 'Create Group');
        f.state.failure = true; await click(f.r, 'Review Groups After Creation'); assert(!textOf(f.r.output).includes('Start a Separate Group'));
        f.state.failure = false; await click(f.r, 'Review Groups After Creation'); assert(button(f.r, 'Create Group').props.disabled);
        await click(f.r, 'Start a Separate Group'); assert(textOf(f.r.output).includes('cannot prove')); await click(f.r, 'Keep Creation Locked');
        assert(button(f.r, 'Create Group').props.disabled); await click(f.r, 'Start a Separate Group'); await click(f.r, 'I Understand — Start a New Group');
        assert.equal(creations(f.rt).length, 1); assert(!button(f.r, 'Create Group').props.disabled);
        f.state.result = (call, state) => { const row = { id: groupId, owner_user_id: 'a', name: call.body.group_name }; state.rows.push(row); return response(row); };
        await enter(f.r, 'New group name', 'Intentional new group'); await click(f.r, 'Create Group'); assert.equal(creations(f.rt).length, 2); f.r.unmount();
    });
    await test('Stalled Group creation becomes uncertain and ignores a late success without unlocking or replaying', async () => {
        const clock = deadlines(), task = defer(), f = await groupSetup(() => task.promise, clock.options);
        await enter(f.r, 'New group name', 'Dinner'); const stale = button(f.r, 'Create Group').props.onPress, pending = stale(); await f.r.settle();
        clock.expire(); await pending; await f.r.settle(); assert(button(f.r, 'Create Group').props.disabled);
        task.resolve(response({ id: groupId, name: 'Dinner', owner_user_id: 'a' })); await f.r.settle(); await stale();
        assert(button(f.r, 'Create Group').props.disabled); assert.equal(creations(f.rt).length, 1); f.r.unmount();
    });
    await test('Retained Group acknowledgement cannot clear another account or a later uncertain attempt', async () => {
        const f = await groupSetup(() => response({ message: 'Lost' }, 503));
        await enter(f.r, 'New group name', 'First'); await click(f.r, 'Create Group'); await click(f.r, 'Review Groups After Creation'); await click(f.r, 'Start a Separate Group');
        const stale = button(f.r, 'I Understand — Start a New Group').props.onPress;
        await click(f.r, 'I Understand — Start a New Group'); await enter(f.r, 'New group name', 'Second'); await click(f.r, 'Create Group');
        await stale(); await f.r.settle(); assert(button(f.r, 'Create Group').props.disabled); assert(textOf(f.r.output).includes('Second'));
        f.rt.switch('b', f.r); await f.r.settle(); await stale(); await f.r.settle();
        assert.equal(f.rt.world.lateUpdates, 0); assert(!textOf(f.r.output).includes('Second')); f.r.unmount();
    });
    await test('Known Group rejection permits correction; missing success identity remains uncertain', async () => {
        const f = await groupSetup(() => response({ code: '22023', message: 'Rejected' }, 400));
        await enter(f.r, 'New group name', 'Bad'); await click(f.r, 'Create Group'); assert(!button(f.r, 'Create Group').props.disabled);
        f.state.result = () => response(null); await enter(f.r, 'New group name', 'Corrected'); await click(f.r, 'Create Group');
        assert(button(f.r, 'Create Group').props.disabled); assert.equal(creations(f.rt).length, 2); f.r.unmount();
    });
    await test('Account replacement disposes the Group creation lock and ignores old pending results and handlers', async () => {
        const task = defer(), f = await groupSetup(() => task.promise); await enter(f.r, 'New group name', 'A group');
        const stale = button(f.r, 'Create Group').props.onPress, pending = stale(); await f.r.settle(); assert(button(f.r, 'Creating...').props.disabled);
        f.rt.switch('b', f.r); await f.r.settle(); task.resolve(response({ message: 'Lost' }, 503)); await pending; await f.r.settle(); await stale();
        assert(!button(f.r, 'Create Group').props.disabled); assert(!textOf(f.r.output).includes('A group')); assert.equal(creations(f.rt).length, 1);
        assert.equal(f.rt.world.lateUpdates, 0); f.r.unmount();
    });
    console.log(`${passed} Milestone 17 safety regression checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
