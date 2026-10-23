// Actual screens, provider and installed Supabase client; synthetic accounts,
// offline HTTP and modeled native lifecycle/navigation events only.
const assert = require('node:assert/strict');
const { runtime, response, screen, click, enter, button, nodes, textOf } = require('./personal-places.cjs');
const groupId = '22222222-2222-2222-2222-222222222222';
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const input = r => nodes(r.output).find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Invite code');
const writes = rt => rt.world.requests.filter(c => c.method !== 'GET');
const request = (id, status) => ({ id, group_id: id, status, requested_at: '2026-10-18T12:00:00Z' });
let passed = 0;
async function test(label, fn) { await fn(); passed++; console.log('PASS ' + label); }
async function setup(options = {}) {
    const state = { rows: [], groups: [], readError: false, readGate: null, groupGate: null, mutation: null };
    const rt = runtime({ ...options, platform: 'ios', fetch: call => {
        if (call.url.pathname === '/rest/v1/groups') return state.groupGate?.promise ?? response(state.groups);
        if (call.url.pathname === '/rest/v1/join_requests') {
            assert.equal(call.url.searchParams.get('user_id'), 'eq.' + call.user, 'Status reads are account-scoped');
            return state.readGate?.promise ?? (state.readError ? response({ message: 'Read failed' }, 400) : response(state.rows));
        }
        assert.equal(call.url.pathname, '/rest/v1/rpc/request_group_access', 'No membership-grant or unrelated mutation');
        return state.mutation?.(call) ?? response(null);
    } });
    const Join = rt.load('app/join-group').default, { useJoinRequest } = rt.load('@/providers/join-request');
    let join, show = true;
    function Route() { join = useJoinRequest(); return show ? { type: Join, props: {} } : null; }
    const r = rt.render(Route); await r.settle();
    return { rt, r, state, join: () => join, async remount() {
        show = false; r.dirty = true; await r.settle(); show = true; r.dirty = true; await r.settle();
    } };
}

function deadlines() {
    const timers = new Set();
    return { options: {
        setTimeout(fn, delay) { assert.equal(delay, 20000); const timer = { fn }; timers.add(timer); return timer; },
        clearTimeout(timer) { timers.delete(timer); },
    }, expire() { assert(timers.size, 'Expected a pending request deadline'); const pending = [...timers]; timers.clear(); pending.forEach(timer => timer.fn()); } };
}

async function uncertain(f, result = () => response({ message: 'Response lost' }, 503)) {
    f.state.mutation = result;
    await enter(f.r, 'Invite code', 'Retained invite'); await click(f.r, 'Request Access');
    assert.equal(f.join().attempt.status, 'uncertain');
    return f.join().attempt;
}

(async () => {
    await test('Join validates empty codes, trims submissions, blocks double taps and returns only on user action', async () => {
        const { rt, r, state } = await setup();
        await click(r, 'Request Access'); assert(textOf(r.output).includes('Please enter an invite code.'));
        await enter(r, 'Invite code', '   '); await click(r, 'Request Access'); assert.equal(writes(rt).length, 0);
        state.mutation = call => { assert.equal(call.body.invite_code, 'invite'); assert.equal(call.user, 'a'); state.rows = [request('pending-group', 'pending')]; return response(null); };
        await enter(r, 'Invite code', ' invite '); const submit = button(r, 'Request Access').props.onPress;
        const pending = submit(); await submit(); await pending; await r.settle();
        assert.equal(writes(rt).length, 1); assert.equal(input(r).props.value, '');
        assert(textOf(r.output).includes('Owner must approve')); assert(textOf(r.output).includes('Pending approval'));
        assert.equal(rt.world.navigation.length, 0); assert.deepEqual(state.groups, []);
        await submit(); await r.settle(); assert.equal(writes(rt).length, 1, 'Retained draft callback cannot resend');
        await click(r, 'Return to Collections'); assert.equal(rt.world.navigation.at(-1), '/groups');
        assert.equal(rt.world.localReads, 0); assert.equal(rt.world.localWrites, 0); r.unmount();
    });
    await test('Join preserves safe invalid/pending/member errors and never exposes raw database diagnostics', async () => {
        for (const [message, expected] of [
            ['Invalid, revoked, or expired invite code.', 'Ask the Owner for a new code.'],
            ['You already have a pending request for this group.', 'You already have a pending request'],
            ['You are already a member of this group.', 'You are already a member'],
            ['Synthetic private database diagnostic', 'Could not complete this action.'],
        ]) {
            const { rt, r, state } = await setup(); state.mutation = () => response({ message, code: '22023' }, 400);
            await enter(r, 'Invite code', 'Rejected invite'); await click(r, 'Request Access');
            assert(textOf(r.output).includes(expected)); assert(!textOf(r.output).includes('Synthetic private database diagnostic'));
            assert.equal(input(r).props.value, 'Rejected invite'); assert(!button(r, 'Request Access').props.disabled);
            await click(r, 'Cancel'); assert.equal(rt.world.navigation.at(-1), '/groups');
            assert(!nodes(r.output).some(n => n.type === 'Modal'));
            assert.equal(writes(rt).length, 1); r.unmount();
        }
    });
    await test('Join shows pending/denied/current and past approvals; failures clear stale statuses and can retry', async () => {
        const { rt, r, state } = await setup();
        state.rows = [request('pending', 'pending'), request('denied', 'denied'), request('old', 'approved'), request(groupId, 'approved')];
        state.groups = [{ id: groupId }]; await click(r, 'Refresh Requests');
        for (const label of ['Pending approval', 'Denied', 'Previously approved', 'Approved', 'This group is available in Collections.', 'does not grant current access']) assert(textOf(r.output).includes(label));
        assert(!nodes(r.output).some(n => n.type === 'Pressable' && /^(Approve|Deny)$/.test(textOf(n.props.children))));
        state.groups = []; rt.poll(); await r.settle(); assert(!textOf(r.output).includes('This group is available in Collections.'));
        state.readError = true; await click(r, 'Refresh Requests');
        assert(textOf(r.output).includes('Could not load your join requests.')); assert(!textOf(r.output).includes('Pending approval'));
        state.readError = false; await click(r, 'Refresh Requests'); assert(textOf(r.output).includes('Pending approval'));
        rt.emit('inactive'); await r.settle(); assert(!textOf(r.output).includes('Pending approval'));
        state.rows = [request('denied', 'denied')]; rt.emit('active'); await r.settle();
        assert(textOf(r.output).includes('Denied')); assert(!textOf(r.output).includes('Pending approval'));
        assert.equal(writes(rt).length, 0); r.unmount();
    });
    await test('Join preflight interrupted by a batched background/return or blur sends nothing and keeps its draft', async () => {
        for (const lifecycle of ['background', 'blur']) {
            const { rt, r } = await setup(); await enter(r, 'Invite code', 'Retained invite');
            const gate = defer(), original = rt.supabase.auth.getSession;
            rt.supabase.auth.getSession = () => gate.promise;
            const pending = button(r, 'Request Access').props.onPress(); await r.settle();
            if (lifecycle === 'background') { rt.emit('inactive'); rt.emit('active'); }
            else rt.world.focused = false;
            r.dirty = true; await r.settle(); gate.resolve(await original()); await pending; await r.settle();
            assert.equal(writes(rt).length, 0); assert.equal(input(r).props.value, 'Retained invite'); r.unmount();
        }
    });
    await test('Join remains busy across backgrounding; a delayed response never redirects or grants membership', async () => {
        const { rt, r, state } = await setup(), gate = defer(); state.mutation = () => gate.promise;
        await enter(r, 'Invite code', 'Invite'); const submit = button(r, 'Request Access').props.onPress, pending = submit(); await r.settle();
        rt.emit('inactive'); await r.settle(); rt.emit('active'); await r.settle(); await submit();
        assert(button(r, 'Back').props.disabled); assert(button(r, 'Cancel').props.disabled);
        assert(rt.attemptRemoval({ type: 'POP' })); await r.settle(); assert(textOf(r.output).includes('Save in progress')); await click(r, 'Stay');
        state.rows = [request('pending-group', 'pending')]; gate.resolve(response(null)); await pending; await r.settle();
        assert(!textOf(r.output).includes('Request sent.')); assert(textOf(r.output).includes('Request Access is locked'));
        await click(r, 'Review Request Statuses'); assert(textOf(r.output).includes('Pending approval'));
        assert.equal(rt.world.navigation.length, 0); assert.equal(writes(rt).length, 1); assert.deepEqual(state.groups, []); r.unmount();
    });
    await test('Join account replacement/sign-out rejects stale preflight, responses and saved callbacks', async () => {
        for (const next of ['b', null]) for (const phase of ['preflight', 'sent']) for (const success of [true, false]) {
            const { rt, r, state } = await setup(), gate = defer();
            await enter(r, 'Invite code', 'A-only invite');
            const original = rt.supabase.auth.getSession;
            if (phase === 'preflight') rt.supabase.auth.getSession = () => gate.promise;
            else state.mutation = () => gate.promise;
            const submit = button(r, 'Request Access').props.onPress, pending = submit(); await r.settle();
            rt.supabase.auth.getSession = original; rt.switch(next, r); await r.settle();
            gate.resolve(phase === 'preflight' ? { data: { session: { user: { id: 'a' }, access_token: 'fake-a' } }, error: null }
                : success ? response(null) : response({ message: 'Rejected' }, 400));
            await pending; await r.settle(); await submit();
            assert(!textOf(r.output).includes('A-only invite')); assert(!textOf(r.output).includes('Request sent.'));
            assert.equal(writes(rt).length, phase === 'sent' ? 1 : 0); assert.equal(rt.world.navigation.length, 0);
            assert.equal(rt.world.lateUpdates, 0); if (next) assert.equal(input(r).props.value, ''); r.unmount();
        }
    });
    await test('Late status reads cannot expose a previous account or repopulate a hidden Join route', async () => {
        for (const change of ['account', 'sign-out', 'background']) {
            const { rt, r, state } = await setup(), gate = defer(); state.readGate = gate;
            const refreshing = button(r, 'Refresh Requests').props.onPress(); await r.settle();
            state.readGate = null;
            if (change === 'account') rt.switch('b', r);
            else if (change === 'sign-out') rt.switch(null, r);
            else rt.emit('inactive');
            await r.settle(); gate.resolve(response([request('old-private-request', 'pending')])); await refreshing; await r.settle();
            assert(!textOf(r.output).includes('Pending approval')); assert.equal(rt.world.lateUpdates, 0); r.unmount();
        }
    });
    await test('Same-account token refresh retains the invite draft without submitting', async () => {
        const { rt, r } = await setup(); await enter(r, 'Invite code', 'Retained invite');
        rt.world.auth = { ...rt.world.auth, session: { ...rt.world.auth.session, access_token: 'fake-a-refreshed' } }; r.dirty = true; await r.settle();
        assert.equal(input(r).props.value, 'Retained invite'); assert.equal(writes(rt).length, 0); r.unmount();
    });
    await test('Never-settling Join authentication times out safely; late tokens cannot dispatch or replace the draft', async () => {
        const clock = deadlines(), f = await setup(clock.options), gate = defer();
        await enter(f.r, 'Invite code', 'Retained invite');
        const original = f.rt.supabase.auth.getSession;
        f.rt.supabase.auth.getSession = () => gate.promise;
        const pending = button(f.r, 'Request Access').props.onPress(); await f.r.settle();
        assert(button(f.r, 'Back').props.disabled); clock.expire(); await pending; await f.r.settle();
        assert(!button(f.r, 'Back').props.disabled); assert(!button(f.r, 'Cancel').props.disabled);
        assert(!button(f.r, 'Request Access').props.disabled); assert.equal(f.join().attempt, null);
        assert.equal(input(f.r).props.value, 'Retained invite'); assert.equal(writes(f.rt).length, 0);
        gate.resolve(await original()); await f.r.settle(); assert.equal(writes(f.rt).length, 0);
        await click(f.r, 'Cancel'); assert.equal(f.rt.world.navigation.at(-1), '/groups');
        assert(!nodes(f.r.output).some(n => n.type === 'Modal')); f.r.unmount();
    });
    await test('Never-settling status auth/groups/requests release loading, permit retry and ignore late data', async () => {
        for (const phase of ['auth', 'groups', 'requests']) {
            const clock = deadlines(), f = await setup(clock.options), gate = defer();
            const original = f.rt.supabase.auth.getSession;
            if (phase === 'auth') f.rt.supabase.auth.getSession = () => gate.promise;
            else f.state[phase === 'groups' ? 'groupGate' : 'readGate'] = gate;
            await click(f.r, 'Refresh Requests'); assert(button(f.r, 'Refresh Requests').props.disabled);
            assert(!button(f.r, 'Cancel').props.disabled); clock.expire(); await f.r.settle();
            assert(textOf(f.r.output).includes('Could not load your join requests.'));
            assert(!button(f.r, 'Refresh Requests').props.disabled); assert(!button(f.r, 'Request Access').props.disabled);
            const calls = f.rt.world.requests.length;
            gate.resolve(phase === 'auth' ? await original() : response([request('late', 'pending')])); await f.r.settle();
            assert.equal(f.rt.world.requests.length, calls); assert(!textOf(f.r.output).includes('Pending approval'));
            f.rt.supabase.auth.getSession = original; f.state.groupGate = null; f.state.readGate = null;
            await click(f.r, 'Refresh Requests'); assert(textOf(f.r.output).includes('No join requests yet.'));
            assert.equal(writes(f.rt).length, 0); f.r.unmount();
        }
    });
    await test('RPC deadline bounds abort-ignoring transport and preserves an uncertain lock despite late success/error', async () => {
        for (const success of [true, false]) {
            const clock = deadlines(), f = await setup(clock.options), gate = defer(); f.state.mutation = () => gate.promise;
            let signal;
            const rpc = f.rt.supabase.rpc.bind(f.rt.supabase);
            f.rt.supabase.rpc = (...args) => {
                const builder = rpc(...args), abortSignal = builder.abortSignal.bind(builder);
                builder.abortSignal = value => { signal = value; return abortSignal(value); };
                return builder;
            };
            await enter(f.r, 'Invite code', 'Retained invite'); const submit = button(f.r, 'Request Access').props.onPress, pending = submit(); await f.r.settle();
            clock.expire(); await pending; await f.r.settle(); const attempt = f.join().attempt;
            assert.equal(signal.aborted, true, 'AbortSignal reaches the actual RPC builder');
            assert.equal(attempt.status, 'uncertain'); assert(button(f.r, 'Request Access').props.disabled);
            assert(!button(f.r, 'Back').props.disabled); assert(!button(f.r, 'Cancel').props.disabled);
            assert(writes(f.rt)[0].headers.get('Authorization').endsWith('fake-a'));
            await submit(); await f.r.settle(); assert.equal(writes(f.rt).length, 1);
            gate.resolve(success ? response(null) : response({ code: '22023', message: 'Rejected' }, 400)); await f.r.settle();
            assert.equal(f.join().attempt, attempt); assert(!textOf(f.r.output).includes('Request sent.')); assert.equal(writes(f.rt).length, 1); f.r.unmount();
        }
    });
    await test('Ambiguous failures lock submission; empty, failed and matching status reads never unlock automatically', async () => {
        for (const mode of ['empty', 'failed', 'pending', 'approved']) {
            const f = await setup(), attempt = await uncertain(f);
            if (mode === 'failed') f.state.readError = true;
            else if (mode !== 'empty') f.state.rows = [request(groupId, mode)];
            if (mode === 'approved') f.state.groups = [{ id: groupId }];
            await click(f.r, 'Review Request Statuses'); assert.equal(f.join().attempt, attempt); assert(button(f.r, 'Request Access').props.disabled);
            if (mode === 'failed') {
                assert(!textOf(f.r.output).includes('Review Retry Risk'));
                f.state.readError = false; await click(f.r, 'Review Request Statuses');
            }
            await click(f.r, 'Review Retry Risk'); const staleAcknowledge = button(f.r, 'I Understand — Unlock Request').props.onPress;
            await click(f.r, 'Keep Request Locked'); await staleAcknowledge(); await f.r.settle();
            assert.equal(f.join().attempt, attempt);
            await click(f.r, 'Review Retry Risk'); await click(f.r, 'I Understand — Unlock Request');
            assert.equal(f.join().attempt, null); assert(!button(f.r, 'Request Access').props.disabled);
            assert.equal(writes(f.rt).length, 1, 'Acknowledgement is local and sends nothing'); f.r.unmount();
        }
    });
    await test('Timed-out recovery review retains uncertainty and rejects old acknowledgement and late status rows', async () => {
        const clock = deadlines(), f = await setup(clock.options), attempt = await uncertain(f);
        await click(f.r, 'Review Request Statuses'); await click(f.r, 'Review Retry Risk');
        const acknowledge = button(f.r, 'I Understand — Unlock Request').props.onPress; await click(f.r, 'Keep Request Locked');
        const gate = defer(); f.state.readGate = gate; await click(f.r, 'Review Request Statuses');
        clock.expire(); await f.r.settle(); await acknowledge(); await f.r.settle();
        assert.equal(f.join().attempt, attempt); assert(button(f.r, 'Request Access').props.disabled);
        assert(textOf(f.r.output).includes('Could not load your join requests.')); assert(!textOf(f.r.output).includes('Review Retry Risk'));
        gate.resolve(response([request('late', 'pending')])); await f.r.settle();
        assert(!textOf(f.r.output).includes('Pending approval')); assert.equal(writes(f.rt).length, 1); f.r.unmount();
    });
    await test('Uncertain Back/Cancel/native exits warn without trapping and retain identity through route remounts', async () => {
        for (const exit of ['Back', 'Cancel', 'native']) {
            const f = await setup(), attempt = await uncertain(f);
            async function leave() {
                if (exit === 'native') { assert(f.rt.attemptRemoval({ type: 'POP' })); await f.r.settle(); }
                else await click(f.r, exit);
            }
            await leave(); assert(textOf(f.r.output).includes('Review this save before leaving'));
            assert(textOf(f.r.output).includes('Leaving does not cancel it or unlock another submission.'));
            await click(f.r, 'Stay'); assert.equal(f.join().attempt, attempt);
            await leave(); await click(f.r, 'Leave Anyway'); assert.equal(f.rt.world.navigation.length, 1);
            await f.remount(); assert.equal(f.join().attempt, attempt); assert(button(f.r, 'Request Access').props.disabled);
            assert.equal(input(f.r).props.value, ''); await leave(); await click(f.r, 'Stay');
            assert.equal(writes(f.rt).length, 1); f.r.unmount();
        }
    });
    await test('A pending Join route remount releases to uncertainty on deadline and cannot submit a second request', async () => {
        const clock = deadlines(), f = await setup(clock.options), gate = defer(); f.state.mutation = () => gate.promise;
        await enter(f.r, 'Invite code', 'Retained invite'); const pending = button(f.r, 'Request Access').props.onPress(); await f.r.settle();
        const attempt = f.join().attempt; await f.remount(); assert.equal(f.join().attempt, attempt);
        assert(button(f.r, 'Back').props.disabled); clock.expire(); await pending; await f.r.settle();
        assert.equal(f.join().attempt.status, 'uncertain'); assert(!button(f.r, 'Back').props.disabled);
        assert(button(f.r, 'Request Access').props.disabled); assert.equal(writes(f.rt).length, 1);
        assert.equal(f.rt.world.lateUpdates, 0); f.r.unmount();
    });
    await test('Old responses, acknowledgements and submit/exit handlers cannot change a newer uncertain attempt', async () => {
        const clock = deadlines(), f = await setup(clock.options), gate = defer(); f.state.mutation = () => gate.promise;
        await enter(f.r, 'Invite code', 'Retained invite'); const oldSubmit = button(f.r, 'Request Access').props.onPress, pending = oldSubmit(); await f.r.settle();
        clock.expire(); await pending; await f.r.settle();
        await click(f.r, 'Cancel'); const oldExit = button(f.r, 'Leave Anyway').props.onPress; await click(f.r, 'Stay');
        await click(f.r, 'Review Request Statuses'); await click(f.r, 'Review Retry Risk');
        const oldAcknowledge = button(f.r, 'I Understand — Unlock Request').props.onPress; await click(f.r, 'I Understand — Unlock Request');
        await oldSubmit(); await f.r.settle(); assert.equal(writes(f.rt).length, 1);
        f.state.mutation = () => response({ message: 'Lost response' }, 503);
        await click(f.r, 'Request Access'); const current = f.join().attempt;
        await oldAcknowledge(); await oldExit(); gate.resolve(response(null)); await f.r.settle();
        assert.equal(f.join().attempt, current); assert.equal(current.status, 'uncertain');
        assert.equal(writes(f.rt).length, 2); assert.equal(f.rt.world.navigation.length, 0); f.r.unmount();
    });
    await test('Account replacement/sign-out disposes uncertainty and rejects old acknowledgement', async () => {
        for (const next of ['b', null]) {
            const f = await setup(); await uncertain(f); await click(f.r, 'Review Request Statuses'); await click(f.r, 'Review Retry Risk');
            const acknowledge = button(f.r, 'I Understand — Unlock Request').props.onPress;
            f.rt.switch(next, f.r); await f.r.settle(); await acknowledge(); await f.r.settle();
            assert.equal(f.join().attempt, null); assert(!textOf(f.r.output).includes('Request Access is locked'));
            assert.equal(f.rt.world.navigation.length, 0); assert.equal(f.rt.world.lateUpdates, 0); assert.equal(writes(f.rt).length, 1); f.r.unmount();
        }
    });
    await test('Backgrounded timeouts retain uncertainty and require fresh visible review before acknowledgement', async () => {
        const clock = deadlines(), f = await setup(clock.options), gate = defer(); f.state.mutation = () => gate.promise;
        await enter(f.r, 'Invite code', 'Invite'); const pending = button(f.r, 'Request Access').props.onPress(); await f.r.settle();
        f.rt.emit('inactive'); await f.r.settle(); clock.expire(); await pending; await f.r.settle();
        assert.equal(f.join().attempt.status, 'uncertain'); f.rt.emit('active'); await f.r.settle();
        assert(!button(f.r, 'Back').props.disabled); assert(!textOf(f.r.output).includes('Review Retry Risk'));
        await click(f.r, 'Review Request Statuses'); await click(f.r, 'Review Retry Risk');
        const acknowledge = button(f.r, 'I Understand — Unlock Request').props.onPress;
        f.rt.emit('inactive'); await f.r.settle(); await acknowledge(); await f.r.settle();
        assert.equal(f.join().attempt.status, 'uncertain');
        f.rt.emit('active'); await f.r.settle(); await acknowledge(); await f.r.settle();
        assert.equal(f.join().attempt.status, 'uncertain'); assert(!textOf(f.r.output).includes('Review Retry Risk'));
        assert.equal(writes(f.rt).length, 1); f.r.unmount();
    });
    await test('Group details keep decisions Owner-only; Members and revoked accounts cannot see request controls', async () => {
        for (const role of ['owner', 'member', 'revoked']) for (const decision of role === 'owner' ? ['approved', 'denied'] : [null]) {
            let decided = false;
            const rt = runtime({ mocks: { 'expo-clipboard': { setStringAsync: async () => true } }, fetch: call => {
                const path = call.url.pathname;
                if (path === '/rest/v1/groups') return response(role === 'revoked' ? null : { id: groupId, name: 'Dinner', owner_user_id: role === 'owner' ? 'a' : 'b' });
                if (path === '/rest/v1/group_memberships') return response(role === 'revoked' ? null : { membership_id: 'current-membership' });
                if (path === '/rest/v1/group_invites') { assert.equal(role, 'owner'); return response(null); }
                if (path.endsWith('/get_pending_join_requests')) { assert.equal(role, 'owner'); return response(decided ? [] : [{ id: 'join-request', display_name: 'Requesting Friend', requested_at: '2026-10-18' }]); }
                if (path.endsWith('/get_group_membership_targets')) { assert.equal(role, 'owner'); return response([{ user_id: 'b', membership_id: 'target-membership', display_name: 'Friend', is_owner: false }]); }
                if (path.endsWith('/decide_join_request')) {
                    assert.equal(role, 'owner'); assert.equal(call.user, 'a'); assert.deepEqual(call.body, { target_request_id: 'join-request', decision }); decided = true; return response(null);
                }
                if (path.endsWith('/get_group_members')) return response([
                    { user_id: role === 'owner' ? 'a' : 'b', display_name: 'Owner', is_owner: true },
                    { user_id: role === 'owner' ? 'b' : 'a', display_name: 'Friend', is_owner: false },
                ]);
                assert.equal(path, '/rest/v1/rpc/get_group_restaurants'); return response([]);
            } });
            rt.world.params = { id: groupId }; const r = screen(rt, 'group/[id]'); await r.settle();
            assert(!textOf(r.output).includes('Add Restaurant / Visit'));
            assert(!textOf(r.output).includes('Add your first visit above!'));
            if (role !== 'revoked') {
                assert(textOf(r.output).includes('Use Add to share a visit with this group.')); assert(!textOf(r.output).includes('Current members')); await click(r, 'People & settings');
                assert(textOf(r.output).replace(/\s+/g,' ').includes(role === 'owner' ? 'You are the Owner' : 'You are a Member'));
                assert.equal(button(r, 'Leave Group').props.disabled, role === 'owner');
                assert(!button(r, 'Refresh Group').props.disabled);
                if (role === 'owner') {
                    for (const label of ['Generate / Reset Invite Code', 'Remove Friend from group', 'Transfer ownership to Friend', 'Approve Requesting Friend', 'Deny Requesting Friend']) assert(!button(r, label).props.disabled);
                    assert(button(r, 'Revoke Invite').props.disabled); // No active invite in this fixture.
                } else {
                    assert(!textOf(r.output).includes('Generate / Reset Invite Code'));
                    assert(!textOf(r.output).includes('Remove Member')); assert(!textOf(r.output).includes('Transfer Ownership'));
                }
            } else assert(!textOf(r.output).includes('No restaurants yet.'));
            if (role === 'owner') { await click(r, decision === 'approved' ? 'Approve Requesting Friend' : 'Deny Requesting Friend'); assert.equal(writes(rt).filter(c => c.url.pathname.endsWith('/decide_join_request')).length, 1); }
            else { assert(!textOf(r.output).includes('Requesting Friend')); assert(!textOf(r.output).includes('Pending join requests')); assert.equal(writes(rt).filter(c => c.url.pathname.endsWith('/decide_join_request')).length, 0); }
            r.unmount();
        }
    });
    console.log(`${passed} Join/group authorization checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
