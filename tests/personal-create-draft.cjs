// Real form/helpers, offline HTTP and native lifecycle boundary from the client harness.
// No persistent drafts, Expo CLI, .env, external network or hosted Supabase.
const assert = require('node:assert/strict');
const { runtime, fixture, response, screen, click, enter, fill, button, nodes, textOf } = require('./personal-places.cjs');
let passed = 0;
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function input(r, label) { return nodes(r.output).find(n => n.type === 'TextInput' && n.props.accessibilityLabel === label); }
function posts(rt) { return rt.world.requests.filter(c => c.method === 'POST'); }
function empty(r) { assert(nodes(r.output).filter(n => n.type === 'TextInput').every(n => n.props.value === '')); }
async function background(rt, r) {
    rt.emit('inactive'); await r.settle(); assert.equal(r.output, null);
    rt.emit('background'); await r.settle(); assert.equal(r.output, null);
}
async function foreground(rt, r) { rt.emit('active'); await r.settle(); }
async function setup(options = {}) {
    const rt = runtime(options), r = screen(rt, 'personal-place-form'); await r.settle(); return { rt, r };
}
async function pendingCreate() {
    const { rt, r } = await setup(), task = deferred();
    rt.world.override = call => call.method === 'POST' ? task.promise : null;
    await fill(r);
    const save = button(r, 'Save Personal Place').props.onPress;
    const pending = save(); await r.settle();
    const commit = () => {
        const saved = fixture({ ...posts(rt)[0].body }); rt.world.rows.push(saved); task.resolve(response(saved, 201));
    };
    return { rt, r, task, save, pending, commit };
}
function checkRequest(rt, requestId) {
    const read = rt.world.requests.at(-1);
    assert.equal(read.method, 'GET'); assert.equal(read.user, 'a');
    assert.equal(read.url.searchParams.get('owner_user_id'), 'eq.a');
    assert.equal(read.url.searchParams.get('client_request_id'), 'eq.' + requestId);
}
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }

(async () => {
    await test('All create fields survive repeated inactive/background and focus-gate remounts unchanged', async () => {
        const { rt, r } = await setup(); await fill(r);
        await enter(r, 'Cuisine', 'Italian'); await enter(r, 'Visit date', '2026-10-09'); await click(r, '4'); await click(r, 'No');
        const before = nodes(r.output).filter(n => n.type === 'TextInput').map(n => [n.props.accessibilityLabel, n.props.value]);
        for (let i = 0; i < 3; i++) { await background(rt, r); await foreground(rt, r); }
        rt.world.focused = false; r.dirty = true; await r.settle(); assert.equal(r.output, null);
        rt.world.focused = true; r.dirty = true; await r.settle();
        assert.deepEqual(nodes(r.output).filter(n => n.type === 'TextInput').map(n => [n.props.accessibilityLabel, n.props.value]), before);
        assert.equal(rt.world.requests.length, 0);
        await click(r, 'Save Personal Place');
        const { client_request_id: requestId, ...saved } = posts(rt)[0].body;
        assert(requestId); assert.deepEqual(saved, { name: 'New Cafe', address: 'New Address', cuisine: 'Italian', visited_on: '2026-10-09', rating: 4, would_go_again: false, notes: 'New memory' });
        assert.equal(rt.world.localWrites, 0); r.unmount();
    });
    await test('Client validation errors and editable manual draft survive backgrounding without HTTP', async () => {
        const { rt, r } = await setup(); await fill(r); await enter(r, 'Visit date', '2026-02-30'); await click(r, 'Save Personal Place');
        await background(rt, r); await foreground(rt, r);
        assert(textOf(r.output).includes('real visit date')); assert.equal(input(r, 'Visit date').props.value, '2026-02-30');
        assert(!button(r, 'Save Personal Place').props.disabled); assert.equal(rt.world.requests.length, 0); r.unmount();
    });
    await test('Pending save survives foreground remount; stale/double taps cannot issue another POST', async () => {
        const f = await pendingCreate(); const requestId = posts(f.rt)[0].body.client_request_id;
        await background(f.rt, f.r); await foreground(f.rt, f.r);
        assert(button(f.r, 'Saving...').props.disabled); assert(button(f.r, 'Back').props.disabled);
        assert(!input(f.r, 'Restaurant name').props.editable); await f.save(); assert.equal(posts(f.rt).length, 1);
        f.commit(); await f.pending; await f.r.settle();
        empty(f.r); assert.equal(f.rt.world.navigation.length, 0); assert(button(f.r, 'Save Personal Place').props.disabled);
        await click(f.r, 'Check Saved Result'); checkRequest(f.rt, requestId);
        assert.equal(f.rt.world.navigation.at(-1).params.id, fixture().id); assert.equal(posts(f.rt).length, 1); f.r.unmount();
    });
    await test('Confirmed hidden save clears typed draft and offers explicit read-only result review', async () => {
        const f = await pendingCreate(); await background(f.rt, f.r); f.commit(); await f.pending; await f.r.settle();
        assert.equal(f.r.output, null); assert.equal(f.rt.world.navigation.length, 0); await foreground(f.rt, f.r);
        empty(f.r); assert(textOf(f.r.output).includes('This place was saved')); assert(button(f.r, 'Save Personal Place').props.disabled);
        assert.equal(f.rt.world.requests.length, 1, 'Foreground must not read or resubmit automatically');
        await click(f.r, 'Check Saved Result'); assert.equal(posts(f.rt).length, 1); assert.equal(f.rt.world.lateUpdates, 0); f.r.unmount();
    });
    await test('Batched inactive/active transition invalidates late save navigation without losing its identity', async () => {
        const f = await pendingCreate(); f.rt.emit('inactive'); f.rt.emit('active'); await f.r.settle();
        f.commit(); await f.pending; await f.r.settle(); assert.equal(f.rt.world.navigation.length, 0); empty(f.r);
        await click(f.r, 'Check Saved Result'); checkRequest(f.rt, posts(f.rt)[0].body.client_request_id); f.r.unmount();
    });
    await test('Hidden failed save preserves typed fields and original request for reconciliation', async () => {
        const f = await pendingCreate(); await background(f.rt, f.r);
        f.task.resolve(response({ code: '', message: 'lost response' }, 400)); await f.pending; await f.r.settle(); await foreground(f.rt, f.r);
        assert.equal(input(f.r, 'Restaurant name').props.value, ' New Cafe '); assert.equal(input(f.r, 'Restaurant address').props.value, ' New Address ');
        assert(button(f.r, 'Save Personal Place').props.disabled); const requestId = posts(f.rt)[0].body.client_request_id;
        await click(f.r, 'Check Saved Result'); checkRequest(f.rt, requestId); assert.equal(posts(f.rt).length, 1); assert.equal(f.rt.world.navigation.length, 0); f.r.unmount();
    });
    await test('Uncertain save stays blocked across remounts, missing/deleted results and stale handlers', async () => {
        const { rt, r } = await setup(); await fill(r); const staleSave = button(r, 'Save Personal Place').props.onPress;
        rt.world.override = c => c.method === 'POST' ? response({ code: '', message: 'lost response' }, 400) : null;
        await staleSave(); await r.settle(); const requestId = posts(rt)[0].body.client_request_id;
        for (let i = 0; i < 2; i++) {
            await background(rt, r); await foreground(rt, r); assert(button(r, 'Save Personal Place').props.disabled);
            await staleSave(); await click(r, 'Check Saved Result'); checkRequest(rt, requestId);
            assert(textOf(r.output).includes('may still finish')); assert.equal(posts(rt).length, 1);
        }
        rt.world.rows = [fixture({ ...posts(rt)[0].body })];
        await rt.load('@/lib/personal-places').deletePersonalPlace('a', rt.world.rows[0]);
        await background(rt, r); await foreground(rt, r); await click(r, 'Check Saved Result'); checkRequest(rt, requestId);
        assert(button(r, 'Save Personal Place').props.disabled); assert.equal(rt.world.rows.length, 0); assert.equal(posts(rt).length, 1); r.unmount();
    });
    await test('In-flight reconciliation remains busy across remounts and cannot navigate late or replay', async () => {
        const { rt, r } = await setup(); await fill(r);
        rt.world.override = c => c.method === 'POST' ? response({ code: '', message: 'lost response' }, 400) : null;
        await click(r, 'Save Personal Place'); const saved = fixture({ ...posts(rt)[0].body }), task = deferred();
        rt.world.rows = [saved]; rt.world.override = c => c.method === 'GET' ? task.promise : null;
        const check = button(r, 'Check Saved Result').props.onPress, pending = check(); await r.settle();
        const before = rt.world.requests.length; await background(rt, r); await foreground(rt, r);
        assert(button(r, 'Check Saved Result').props.disabled); await check(); assert.equal(rt.world.requests.length, before);
        task.resolve(response(saved)); await pending; await r.settle(); empty(r); assert.equal(rt.world.navigation.length, 0);
        rt.world.override = null; await click(r, 'Check Saved Result'); assert.equal(rt.world.navigation.at(-1).params.id, saved.id); assert.equal(posts(rt).length, 1); r.unmount();
    });
    await test('Known rejected create remains editable after background and permits an explicit new attempt', async () => {
        const f = await pendingCreate(); await background(f.rt, f.r);
        f.task.resolve(response({ code: '23514', message: 'validation rejected' }, 400)); await f.pending; await f.r.settle(); await foreground(f.rt, f.r);
        assert(!button(f.r, 'Save Personal Place').props.disabled); assert(input(f.r, 'Restaurant name').props.editable);
        f.rt.world.override = null; await click(f.r, 'Save Personal Place'); assert.equal(posts(f.rt).length, 2);
        assert.notEqual(posts(f.rt)[0].body.client_request_id, posts(f.rt)[1].body.client_request_id); assert.equal(f.rt.world.rows.length, 1); f.r.unmount();
    });
    await test('Account change/sign-out dispose pending drafts; late old-account result never updates new UI', async () => {
        for (const account of ['b', null]) {
            const f = await pendingCreate(); await background(f.rt, f.r); f.rt.switch(account, f.r); await f.r.settle();
            f.commit(); await f.pending; await f.r.settle(); await foreground(f.rt, f.r);
            assert.equal(f.rt.world.navigation.length, 0); assert.equal(f.rt.world.lateUpdates, 0); assert.equal(posts(f.rt)[0].user, 'a');
            if (account) { empty(f.r); assert(!button(f.r, 'Save Personal Place').props.disabled); }
            else assert(textOf(f.r.output).includes('Sign In / Sign Up'));
            f.rt.switch('a', f.r); await f.r.settle(); empty(f.r); assert(!button(f.r, 'Save Personal Place').props.disabled); f.r.unmount();
        }
    });
    await test('Uncertain-save lock and request identity never transfer to another account', async () => {
        const { rt, r } = await setup(); await fill(r);
        rt.world.override = c => c.method === 'POST' ? response({ code: '', message: 'lost response' }, 400) : null;
        await click(r, 'Save Personal Place'); const oldId = posts(rt)[0].body.client_request_id;
        rt.switch('b', r); await r.settle(); empty(r); assert(!textOf(r.output).includes('Check Saved Result'));
        rt.world.override = null; await fill(r); await click(r, 'Save Personal Place'); assert.equal(posts(rt)[1].user, 'b');
        assert.notEqual(posts(rt)[1].body.client_request_id, oldId); r.unmount();
    });
    await test('Same-account session refresh preserves draft, busy state and request identity', async () => {
        const f = await pendingCreate(); f.rt.world.auth.session = { user: { id: 'a' }, access_token: 'refreshed-a' }; f.r.dirty = true; await f.r.settle();
        assert.equal(input(f.r, 'Restaurant name').props.value, ' New Cafe '); assert(button(f.r, 'Saving...').props.disabled);
        await background(f.rt, f.r); await foreground(f.rt, f.r); f.commit(); await f.pending; await f.r.settle();
        // The harness's getSession uses its token; retain the pinned original HTTP assertion.
        assert.equal(posts(f.rt)[0].headers.get('Authorization'), 'Bearer fake-a'); assert.equal(posts(f.rt).length, 1); f.r.unmount();
    });
    await test('Explicit Back and Review My Places clear draft and preserve existing destinations', async () => {
        for (const exit of ['Back', 'Review My Places']) {
            const { rt, r } = await setup(); await fill(r);
            if (exit === 'Review My Places') {
                rt.world.override = c => c.method === 'POST' ? response({ code: '', message: 'lost response' }, 400) : null;
                await click(r, 'Save Personal Place');
            }
            await click(r, exit); empty(r); assert.equal(rt.world.navigation.at(-1), exit === 'Back' ? 'BACK' : '/my-places');
            assert.equal(rt.world.localWrites, 0); r.unmount(); const fresh = screen(rt, 'personal-place-form'); await fresh.settle(); empty(fresh); fresh.unmount();
        }
    });
    await test('Full route unmount discards in-memory draft and ignores pending callbacks without persistence', async () => {
        const f = await pendingCreate(); f.r.unmount(); f.commit(); await f.pending;
        const fresh = screen(f.rt, 'personal-place-form'); await fresh.settle(); empty(fresh);
        assert.equal(f.rt.world.navigation.length, 0); assert.equal(f.rt.world.lateUpdates, 0); assert.equal(f.rt.world.localWrites, 0);
        assert(!button(fresh, 'Save Personal Place').props.disabled); fresh.unmount();
    });
    await test('Edit forms keep existing background cleanup and fresh owner/revision read behavior', async () => {
        const rt = runtime(); rt.world.params = { id: fixture().id }; rt.world.rows = [fixture()]; const r = screen(rt, 'personal-place-form'); await r.settle();
        await enter(r, 'Restaurant name', 'Unsaved edit'); await background(rt, r);
        rt.world.rows[0].name = 'Newer server name'; rt.world.rows[0].revision = 2; await foreground(rt, r);
        assert.equal(input(r, 'Restaurant name').props.value, 'Newer server name'); await click(r, 'Save Changes');
        assert.equal(rt.world.requests.find(c => c.method === 'PATCH').url.searchParams.get('revision'), 'eq.2'); r.unmount();
    });
    console.log(passed + ' offline Personal Place create-draft regression checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
