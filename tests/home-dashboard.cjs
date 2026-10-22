// Actual read helpers/hook and Supabase client, with offline HTTP and lifecycle
// boundaries. This fixture models RLS; it does not establish hosted acceptance.
const assert = require('node:assert/strict');
const { runtime, response } = require('./personal-places.cjs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = n => `2026-10-${String(n).padStart(2, '0')}T12:00:00Z`;
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const plain = value => JSON.parse(JSON.stringify(value));
const fail = () => response({ message: 'Sensitive server diagnostics must not escape' }, 503);
function deadlineClock() {
    const timers = new Map(), durations = [];
    let index = 0;
    return { timers, durations,
        options: {
            setTimeout(fn, duration) { durations.push(duration); timers.set(++index, fn); return index; },
            clearTimeout(timer) { timers.delete(timer); },
        },
        expire() { [...timers.values()].forEach(fn => fn()); },
    };
}

function fixture() {
    return {
        personal_places: [
            { id: id(1), owner_user_id: 'a', name: 'Private Cafe', address: 'Personal address', notes: 'PERSONAL SECRET' },
            { id: id(2), owner_user_id: 'a', name: 'No history', address: 'Empty address' },
            { id: id(3), owner_user_id: 'b', name: 'B private', address: 'B address', notes: 'FOREIGN SECRET' },
        ],
        personal_visits: [
            { id: id(11), personal_place_id: id(1), owner_user_id: 'a', origin: 'legacy', visited_on: null, rating: null, created_at: stamp(17), notes: 'PERSONAL SECRET' },
            { id: id(12), personal_place_id: id(1), owner_user_id: 'a', origin: 'visit', visited_on: '2026-01-01', rating: 4, created_at: stamp(20), notes: 'PERSONAL SECRET' },
            { id: id(13), personal_place_id: id(3), owner_user_id: 'b', origin: 'visit', visited_on: null, rating: 1, created_at: stamp(21), notes: 'FOREIGN SECRET' },
        ],
        groups: [
            { id: id(21), name: 'Dinner', owner_user_id: 'a' },
            { id: id(22), name: 'Lunch', owner_user_id: 'b' },
            { id: id(23), name: 'Unrelated', owner_user_id: 'b' },
        ],
        group_memberships: [
            { group_id: id(21), user_id: 'a', membership_id: id(31), joined_at: stamp(20) },
            { group_id: id(22), user_id: 'a', membership_id: id(32), joined_at: stamp(19) },
            { group_id: id(22), user_id: 'b', membership_id: id(33), joined_at: stamp(19) },
            { group_id: id(23), user_id: 'b', membership_id: id(34), joined_at: stamp(20) },
        ],
        restaurants: [
            { id: id(41), name: 'Same Cafe', address: 'Same address' },
            { id: id(42), name: 'Same Cafe', address: 'Same address' },
            { id: id(43), name: 'Unrelated Cafe', address: 'Unrelated address' },
        ],
        group_restaurants: [
            { id: id(51), group_id: id(21), restaurant_id: id(41) },
            { id: id(52), group_id: id(22), restaurant_id: id(42) },
            { id: id(53), group_id: id(23), restaurant_id: id(43) },
        ],
        visits: [
            { id: id(61), group_restaurant_id: id(51), created_by: 'b', visited_on: null, rating: 5, created_at: stamp(19), notes: 'GROUP NOTE' },
            { id: id(62), group_restaurant_id: id(52), created_by: 'a', visited_on: '2026-01-01', rating: 3, created_at: stamp(18), notes: 'GROUP NOTE' },
            { id: id(63), group_restaurant_id: id(53), created_by: 'b', visited_on: null, rating: 2, created_at: stamp(22), notes: 'UNRELATED NOTE' },
        ],
    };
}

function model(options = {}) {
    const db = fixture();
    let override = null, latest;
    function answer(call) {
        const { url, method, user, headers } = call;
        const table = url.pathname.replace('/rest/v1/', '');
        assert(Object.hasOwn(db, table), `Unexpected table/RPC ${table}`);
        assert(['GET', 'HEAD'].includes(method), 'Dashboard must never write');
        const selected = url.searchParams.get('select').split(',');
        assert(!selected.includes('*') && !selected.includes('notes'), 'Dashboard must not fetch notes');
        if (['personal_places', 'personal_visits'].includes(table)) assert.equal(url.searchParams.get('owner_user_id'), `eq.${user}`);
        if (table === 'group_memberships') assert.equal(url.searchParams.get('user_id'), `eq.${user}`);
        if (method === 'GET') {
            const limit = Number(url.searchParams.get('limit'));
            assert(limit > 0 && limit <= 8, 'Every row read must be bounded');
        }
        const member = groupId => db.group_memberships.some(m => m.group_id === groupId && m.user_id === user);
        const accessibleEntry = entryId => db.group_restaurants.some(e => e.id === entryId && member(e.group_id));
        let values = db[table].filter(row => {
            if (['personal_places', 'personal_visits'].includes(table)) return row.owner_user_id === user;
            if (table === 'group_memberships') return row.user_id === user;
            if (table === 'groups') return member(row.id);
            if (table === 'group_restaurants') return member(row.group_id);
            if (table === 'visits') return accessibleEntry(row.group_restaurant_id);
            return db.group_restaurants.some(e => e.restaurant_id === row.id && member(e.group_id));
        });
        for (const [key, filter] of url.searchParams) {
            if (filter.startsWith('eq.')) values = values.filter(row => row[key] === filter.slice(3));
            if (filter.startsWith('in.(')) {
                const ids = filter.slice(4, -1).split(',');
                values = values.filter(row => ids.includes(row[key]));
            }
        }
        const count = values.length;
        const orders = (url.searchParams.get('order') ?? '').split(',').filter(Boolean);
        values.sort((a, b) => {
            for (const order of orders) {
                const [key, direction] = order.split('.');
                const aValue = key === 'created_at' ? Date.parse(a[key]) : a[key];
                const bValue = key === 'created_at' ? Date.parse(b[key]) : b[key];
                const diff = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
                if (diff) return direction === 'desc' ? -diff : diff;
            }
            return 0;
        });
        values = values.slice(0, Number(url.searchParams.get('limit') ?? values.length));
        const resultHeaders = { 'Content-Type': 'application/json' };
        if (headers.get('Prefer')?.includes('count=exact')) resultHeaders['Content-Range'] = `*/${count}`;
        return new Response(method === 'HEAD' ? null : JSON.stringify(values.map(row => Object.fromEntries(selected.map(key => [key, row[key]])))),
            { status: 200, headers: resultHeaders });
    }
    const rt = runtime({ ...options, fetch: call => override?.(call) ?? answer(call) });
    const lib = rt.load('@/lib/home-dashboard');
    const load = async (userId = 'a', signal = new AbortController().signal) => lib.readHomeDashboard({ userId, signal });
    function render() {
        const { useHomeDashboard } = rt.load('@/hooks/use-home-dashboard');
        const r = rt.render(function DashboardProbe() { latest = useHomeDashboard(); return null; }, false);
        return r;
    }
    return { db, rt, lib, load, render, answer, set override(value) { override = value; }, get latest() { return latest; } };
}

let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
    await test('Exact account counts, independent destinations and authorized destination mapping', async () => {
        const f = model(), snapshot = await f.load(), view = f.lib.homeDashboardView(snapshot);
        assert.equal(view.status, 'ready');
        assert.equal(view.counts.places.data, 2); assert.equal(view.counts.visits.data, 2); assert.equal(view.counts.groups.data, 2);
        assert.deepEqual(plain(view.groups.data.map(g => [g.id, g.role])), [[id(21), 'Owner'], [id(22), 'Member']]);
        assert.deepEqual(plain(view.recent.entries.map(v => v.visitId)), [id(12), id(61), id(62), id(11)]);
        const personal = view.recent.entries.find(v => v.visitId === id(12));
        assert.equal(personal.kind, 'personal'); assert.equal(personal.entryId, id(1)); assert.equal(personal.address, 'Personal address');
        assert.equal(personal.visited_on, '2026-01-01'); assert.equal(personal.created_at, stamp(20));
        const legacy = view.recent.entries.find(v => v.visitId === id(11));
        assert.equal(legacy.origin, 'legacy'); assert.equal(legacy.visited_on, null);
        for (const [visitId, entryId, restaurantId, groupId, name] of [[61, 51, 41, 21, 'Dinner'], [62, 52, 42, 22, 'Lunch']]) {
            const v = view.recent.entries.find(v => v.visitId === id(visitId));
            assert.deepEqual([v.kind, v.entryId, v.restaurantId, v.groupId, v.groupName], ['group', id(entryId), id(restaurantId), id(groupId), name]);
            assert.equal(v.name, 'Same Cafe'); assert.equal(v.address, 'Same address');
        }
        const text = JSON.stringify(view);
        for (const privateText of ['SECRET', 'NOTE', 'Unrelated', 'B private']) assert(!text.includes(privateText));
        assert.equal(f.rt.world.localReads, 0); assert.equal(f.rt.world.localWrites, 0);
        assert.equal(f.rt.world.requests.length, 14, 'Nonempty load has a fixed bounded request budget');
    });

    await test('Empty accounts return real zeros and empty lists without device archive reads', async () => {
        const f = model(); f.rt.switch('new');
        const view = f.lib.homeDashboardView(await f.load('new'));
        assert.equal(view.status, 'ready');
        for (const part of Object.values(view.counts)) assert.equal(part.data, 0);
        assert.equal(view.groups.data.length, 0); assert.equal(view.recent.entries.length, 0);
        assert.equal(f.rt.world.requests.length, 5); assert.equal(f.rt.world.localReads, 0);
    });

    await test('Group-only histories do not manufacture personal places/visits; total failures remain unavailable', async () => {
        const f = model(); f.db.personal_visits = []; f.db.personal_places = [];
        const view = f.lib.homeDashboardView(await f.load());
        assert.equal(view.counts.places.data, 0); assert.equal(view.counts.visits.data, 0); assert.equal(view.counts.groups.data, 2);
        assert.equal(view.recent.entries.length, 2); assert(view.recent.entries.every(v => v.kind === 'group'));
        f.override = () => fail();
        const failed = f.lib.homeDashboardView(await f.load());
        assert.equal(failed.status, 'error'); assert.equal(failed.recent.status, 'error');
        for (const count of Object.values(failed.counts)) { assert.equal(count.status, 'error'); assert.equal(count.data, null); }
        assert.equal(failed.recent.entries.length, 0);
    });

    await test('Counts are exact beyond REST row caps; preview is capped at three memberships', async () => {
        const f = model();
        for (let n = 100; n < 1210; n++) {
            f.db.personal_places.push({ id: id(n), owner_user_id: 'a', name: 'Place', address: 'Address' });
            f.db.personal_visits.push({ id: id(n + 2000), owner_user_id: 'a', personal_place_id: id(n), origin: 'visit', visited_on: null, rating: null, created_at: stamp(1) });
        }
        for (let n = 70; n < 75; n++) {
            f.db.groups.push({ id: id(n), name: 'Group ' + n, owner_user_id: 'a' });
            f.db.group_memberships.push({ group_id: id(n), user_id: 'a', membership_id: id(n + 10000), joined_at: stamp(21) });
        }
        const view = f.lib.homeDashboardView(await f.load());
        assert.equal(view.counts.places.data, 1112); assert.equal(view.counts.visits.data, 1112); assert.equal(view.counts.groups.data, 7);
        assert.equal(view.groups.data.length, 3); assert.equal(view.recent.entries.length, 5);
    });

    await test('Newest five merge by creation instant with deterministic ID/source ties, without deduplication', async () => {
        const f = model(); f.db.personal_visits = []; f.db.visits = [];
        for (let n = 1; n <= 7; n++) {
            f.db.personal_visits.push({ id: id(100 + n), personal_place_id: id(1), owner_user_id: 'a', origin: 'visit', visited_on: '2020-01-01', rating: null, created_at: stamp(n + 10) });
            f.db.visits.push({ id: id(200 + n), group_restaurant_id: id(51), created_by: 'b', visited_on: '2030-01-01', rating: null, created_at: stamp(n + 10) });
        }
        // Same ID in separate tables is legitimate. Equivalent timestamps must
        // compare as instants, and source breaks the final tie deterministically.
        f.db.personal_visits.at(-1).id = id(207);
        f.db.personal_visits.at(-1).created_at = '2026-10-17T05:00:00-07:00';
        const view = f.lib.homeDashboardView(await f.load());
        assert.deepEqual(plain(view.recent.entries.map(v => [v.kind, v.visitId])), [
            ['group', id(207)], ['personal', id(207)], ['group', id(206)], ['personal', id(106)], ['group', id(205)],
        ]);
        const reads = f.rt.world.requests.filter(c => ['personal_visits', 'visits'].some(t => c.url.pathname.endsWith('/' + t)) && c.method === 'GET' && c.url.searchParams.has('order'));
        assert.equal(reads.length, 2);
        for (const call of reads) { assert.equal(call.url.searchParams.get('limit'), '5'); assert.equal(call.url.searchParams.get('order'), 'created_at.desc,id.desc'); }
    });

    await test('Creation ordering preserves PostgreSQL microseconds ahead of deterministic ID ties', async () => {
        const f = model();
        f.db.personal_visits.find(v => v.id === id(12)).created_at = '2026-10-20T12:00:00.123455Z';
        const group = f.db.visits.find(v => v.id === id(61));
        group.id = id(4); group.created_at = '2026-10-20T05:00:00.123456-07:00';
        const view = f.lib.homeDashboardView(await f.load());
        assert.deepEqual(plain(view.recent.entries.slice(0, 2).map(v => v.visitId)), [id(4), id(12)]);
    });

    await test('Independent count/feed failures report partial success and never fabricate zero counts', async () => {
        const f = model();
        f.override = call => call.method === 'HEAD' && call.url.pathname.endsWith('/personal_places') ? fail()
            : call.url.pathname.endsWith('/visits') && call.url.searchParams.has('order') ? fail() : null;
        const view = f.lib.homeDashboardView(await f.load());
        assert.equal(view.status, 'partial'); assert.equal(view.counts.places.status, 'error'); assert.equal(view.counts.places.data, null);
        assert.equal(view.counts.visits.data, 2); assert.equal(view.groups.status, 'ready'); assert.equal(view.recent.status, 'partial');
        assert(view.recent.entries.every(v => v.kind === 'personal')); assert(view.recent.groupError);
        assert(!JSON.stringify(view).includes('Sensitive'));
        f.override = call => call.method === 'HEAD' ? new Response(null, { status: 200 }) : null;
        const missing = f.lib.homeDashboardView(await f.load());
        assert.equal(missing.counts.places.status, 'error'); assert.equal(missing.counts.visits.status, 'error');
    });

    await test('Unavailable parents and changed entry mappings fail the affected stream closed', async () => {
        for (const table of ['personal_places', 'group_restaurants', 'restaurants', 'groups']) {
            const f = model();
            f.override = call => call.method === 'GET' && call.url.pathname.endsWith('/' + table) ? response([]) : null;
            const snapshot = await f.load();
            assert.equal(table === 'personal_places' ? snapshot.personalRecent.status : snapshot.groupRecent.status, 'error');
            assert.equal(snapshot.places.data, 2);
        }
        const f = model();
        f.override = call => call.url.pathname.endsWith('/visits') && !call.url.searchParams.has('order')
            ? response(f.db.visits.slice(0, 2).map(v => ({ ...v, group_restaurant_id: id(53) }))) : null;
        assert.equal((await f.load()).groupRecent.status, 'error');
    });

    await test('Removal/leave and rejoining during reads invalidate the original admission', async () => {
        for (const action of ['remove', 'rejoin']) {
            const f = model(); let changed = false;
            f.override = call => {
                if (!changed && call.url.pathname.endsWith('/restaurants')) {
                    changed = true;
                    if (action === 'remove') f.db.group_memberships = f.db.group_memberships.filter(m => m.user_id !== 'a' || m.group_id !== id(21));
                    else f.db.group_memberships.find(m => m.user_id === 'a' && m.group_id === id(21)).membership_id = id(999);
                }
                return null;
            };
            const first = await f.load(); assert.equal(first.groups.status, 'error'); assert.equal(first.groupRecent.status, 'error');
            assert.equal(first.personalRecent.status, 'ready');
            f.override = null;
            const next = f.lib.homeDashboardView(await f.load()); assert.equal(next.groups.status, 'ready');
            if (action === 'remove') {
                assert.equal(next.counts.groups.data, 1); assert(!JSON.stringify(next).includes('Dinner'));
            } else assert.equal(next.groups.data.find(g => g.id === id(21)).membershipId, id(999));
        }
    });

    await test('Failed final authorization checks hide all group content without retaining a fallback', async () => {
        const f = model(); let membershipChecks = 0;
        f.override = call => {
            if (call.url.pathname.endsWith('/group_memberships') && call.url.searchParams.has('group_id')) {
                if (++membershipChecks === 2) return fail();
            }
            return null;
        };
        const snapshot = await f.load(), view = f.lib.homeDashboardView(snapshot);
        assert.equal(view.counts.groups.data, null); assert.equal(view.groups.data, null);
        assert(view.recent.entries.every(v => v.kind === 'personal')); assert.equal(view.recent.status, 'partial');
    });

    await test('Hook exposes explicit loading and serializes repeated newer refreshes', async () => {
        const f = model(), gate = defer(); let blocked = false;
        f.override = call => {
            if (!blocked && call.method === 'HEAD' && call.url.pathname.endsWith('/personal_places')) {
                blocked = true; return gate.promise;
            }
            return null;
        };
        const r = f.render(); await r.settle();
        assert.equal(f.latest.status, 'loading'); assert.equal(f.latest.counts.places.data, null);
        f.latest.refresh(); await r.settle(); f.latest.refresh(); await r.settle();
        assert.equal(f.rt.world.requests.filter(c => c.method === 'HEAD' && c.url.pathname.endsWith('/personal_places')).length, 1);
        gate.resolve(new Response(null, { status: 200, headers: { 'Content-Range': '*/999' } })); await r.settle();
        assert.equal(f.latest.status, 'ready'); assert.equal(f.latest.counts.places.data, 2);
        assert.equal(f.rt.world.requests.filter(c => c.method === 'HEAD' && c.url.pathname.endsWith('/personal_places')).length, 2);
        r.unmount(); assert.equal(f.rt.world.intervals.size, 0); assert.equal(f.rt.world.lateUpdates, 0);
    });

    await test('Account replacement/sign-out hide data before effects and reject old-account callbacks', async () => {
        const f = model(), r = f.render(); await r.settle(); assert.equal(f.latest.counts.visits.data, 2);
        const gate = defer(); let blocked = false;
        f.override = call => {
            if (!blocked && call.user === 'a' && call.url.pathname.endsWith('/personal_places') && call.method === 'HEAD') { blocked = true; return gate.promise; }
            return null;
        };
        f.latest.refresh(); await r.settle(); f.rt.switch('b', r); r.draw();
        assert.equal(f.latest.counts.places.data, null); assert.equal(f.latest.recent.entries.length, 0);
        await r.settle(); const boundary = f.rt.world.requests.length;
        gate.resolve(new Response(null, { status: 200, headers: { 'Content-Range': '*/999' } })); await r.settle();
        assert.equal(f.latest.status, 'ready'); assert.equal(f.latest.counts.places.data, 1);
        assert(f.rt.world.requests.slice(boundary).every(c => c.user === 'b'));
        assert(!JSON.stringify(f.latest).includes('Private Cafe'));
        f.rt.switch(null, r); r.draw(); assert.equal(f.latest.recent.entries.length, 0); assert.equal(f.latest.counts.groups.data, null);
        await r.settle(); r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
    });

    await test('Blur, background and rapid background/return discard pending content and reload on return', async () => {
        for (const transition of ['blur', 'background', 'rapid']) {
            const f = model(), r = f.render(); await r.settle();
            const gate = defer(); let blocked = false;
            f.override = call => {
                if (!blocked && call.url.pathname.endsWith('/personal_visits') && call.method === 'HEAD') { blocked = true; return gate.promise; }
                return null;
            };
            f.latest.refresh(); await r.settle();
            if (transition === 'blur') { f.rt.world.focused = false; r.dirty = true; }
            else { f.rt.emit('background'); if (transition === 'rapid') f.rt.emit('active'); }
            r.draw(); assert.equal(f.latest.recent.entries.length, 0);
            await r.settle();
            gate.resolve(new Response(null, { status: 200, headers: { 'Content-Range': '*/999' } })); await r.settle();
            if (transition !== 'rapid') {
                assert.equal(f.latest.counts.visits.data, null);
                if (transition === 'blur') { f.rt.world.focused = true; r.dirty = true; } else f.rt.emit('active');
                await r.settle();
            }
            assert.equal(f.latest.status, 'ready'); assert.equal(f.latest.counts.visits.data, 2);
            r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
        }
    });

    await test('Focused access polling is bounded, nonoverlapping, and hides revoked/replaced/uncertain groups', async () => {
        for (const change of ['leave', 'rejoin', 'denied', 'missing-group', 'owner']) {
            const f = model(), r = f.render(); await r.settle();
            const before = f.rt.world.requests.length;
            f.rt.poll(); await r.settle();
            assert.equal(f.rt.world.requests.length - before, 2);
            assert(f.rt.world.requests.slice(before).every(c => /\/(groups|group_memberships)$/.test(c.url.pathname)));
            const gate = defer(); let blocked = false;
            f.override = call => {
                if (!blocked && call.url.pathname.endsWith('/group_memberships')) { blocked = true; return gate.promise; }
                return null;
            };
            const start = f.rt.world.requests.length; f.rt.poll(); await r.settle(); f.rt.poll(); await r.settle();
            assert.equal(f.rt.world.requests.length - start, 2, 'Pending access checks must not overlap');
            const call = f.rt.world.requests.slice(start).find(c => c.url.pathname.endsWith('/group_memberships'));
            if (change === 'leave') f.db.group_memberships = f.db.group_memberships.filter(m => m.user_id !== 'a' || m.group_id !== id(21));
            if (change === 'rejoin') f.db.group_memberships.find(m => m.user_id === 'a' && m.group_id === id(21)).membership_id = id(999);
            if (change === 'missing-group') f.db.groups = f.db.groups.filter(g => g.id !== id(21));
            if (change === 'owner') {
                f.db.groups.find(g => g.id === id(21)).owner_user_id = 'b';
                // Metadata was already read when the pending check began. A
                // subsequent check observes ownership changes.
            }
            gate.resolve(change === 'denied' ? fail() : f.answer(call)); await r.settle();
            if (change === 'owner') { f.rt.poll(); await r.settle(); }
            if (change === 'missing-group') { f.rt.poll(); await r.settle(); }
            assert.equal(f.latest.groups.status, 'error'); assert.equal(f.latest.counts.groups.data, null);
            assert(f.latest.recent.entries.every(v => v.kind === 'personal')); assert.equal(f.latest.counts.visits.data, 2);
            const stopped = f.rt.world.requests.length; f.rt.poll(); await r.settle(); assert.equal(f.rt.world.requests.length, stopped);
            f.override = null; f.latest.refresh(); await r.settle();
            if (change !== 'missing-group') assert.equal(f.latest.groups.status, 'ready');
            r.unmount(); assert.equal(f.rt.world.intervals.size, 0);
        }
    });

    await test('Late access checks cannot hide newer refreshed content or publish after unmount', async () => {
        const f = model(), r = f.render(); await r.settle();
        const gate = defer(); let blocked = false;
        f.override = call => {
            if (!blocked && call.url.pathname.endsWith('/group_memberships')) { blocked = true; return gate.promise; }
            return null;
        };
        f.rt.poll(); await r.settle(); f.latest.refresh(); await r.settle();
        assert.equal(f.latest.status, 'loading'); gate.resolve(fail()); await r.settle();
        assert.equal(f.latest.status, 'ready'); assert.equal(f.latest.groups.data.length, 2);
        const second = defer(); blocked = false;
        f.override = call => {
            if (!blocked && call.url.pathname.endsWith('/group_memberships')) { blocked = true; return second.promise; }
            return null;
        };
        f.rt.poll(); await r.settle(); r.unmount(); second.resolve(fail()); await r.settle();
        assert.equal(f.rt.world.lateUpdates, 0); assert.equal(f.rt.world.intervals.size, 0);
    });

    await test('Canceled reads, token mismatch and request deadlines cannot publish account data', async () => {
        const f = model(), controller = new AbortController(); controller.abort();
        await assert.rejects(f.load('a', controller.signal)); assert.equal(f.rt.world.requests.length, 0);
        f.rt.switch('b'); const mismatch = await f.load('a');
        assert(Object.values(mismatch).every(part => part.status === 'error')); assert.equal(f.rt.world.requests.length, 0);
        const timers = new Map(); let index = 0;
        const timed = model({ setTimeout: fn => { timers.set(++index, fn); return index; }, clearTimeout: n => timers.delete(n) });
        timed.override = call => call.method === 'HEAD' ? new Promise(() => {}) : null;
        const r = timed.render(); await r.settle(); assert.equal(timed.latest.status, 'loading');
        [...timers.values()].forEach(fn => fn()); await r.settle();
        assert.equal(timed.latest.status, 'partial'); assert.equal(timed.latest.counts.places.data, null);
        assert.equal(timed.latest.counts.visits.data, null); assert.equal(timed.latest.groups.status, 'ready');
        r.unmount(); assert.equal(timed.rt.world.lateUpdates, 0);
    });
    await test('Stalled authorization expires at the dashboard deadline; late tokens cannot dispatch and Refresh recovers', async () => {
        const clock = deadlineClock(), f = model(clock.options), gate = defer();
        const session = f.rt.world.auth.session, getSession = f.rt.supabase.auth.getSession;
        f.rt.supabase.auth.getSession = () => gate.promise;
        const r = f.render(); await r.settle();
        assert.equal(f.latest.status, 'loading'); assert.equal(f.rt.world.requests.length, 0);
        assert.equal(clock.timers.size, 5, 'Every stalled preflight must already have a deadline');
        assert(clock.durations.every(duration => duration === 20000));
        clock.expire(); await r.settle();
        assert.equal(f.latest.status, 'error'); assert.equal(f.latest.recent.entries.length, 0);
        for (const count of Object.values(f.latest.counts)) { assert.equal(count.status, 'error'); assert.equal(count.data, null); }
        assert.equal(clock.timers.size, 0); assert.equal(f.rt.world.requests.length, 0);
        gate.resolve({ data: { session }, error: null }); await r.settle();
        assert.equal(f.rt.world.requests.length, 0, 'A late verified token must not start a timed-out query');
        assert.equal(f.latest.status, 'error');
        f.rt.supabase.auth.getSession = getSession; f.latest.refresh(); await r.settle();
        assert.equal(f.latest.status, 'ready'); assert.equal(f.latest.counts.places.data, 2);
        assert.equal(clock.timers.size, 0); r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
    });

    await test('A newer serialized refresh proceeds after a canceled authorization preflight times out', async () => {
        const clock = deadlineClock(), f = model(clock.options), gate = defer();
        const session = f.rt.world.auth.session, getSession = f.rt.supabase.auth.getSession;
        let preflights = 0;
        f.rt.supabase.auth.getSession = () => ++preflights <= 5 ? gate.promise : getSession();
        const r = f.render(); await r.settle();
        f.latest.refresh(); await r.settle();
        assert.equal(preflights, 5); assert.equal(f.rt.world.requests.length, 0);
        assert.equal(f.latest.status, 'loading');
        clock.expire(); await r.settle();
        assert.equal(f.latest.status, 'ready'); assert.equal(f.latest.counts.visits.data, 2);
        const requests = f.rt.world.requests.length;
        assert.equal(requests, 14); assert(f.rt.world.requests.every(call => call.user === 'a'));
        gate.resolve({ data: { session }, error: null }); await r.settle();
        assert.equal(f.rt.world.requests.length, requests); assert.equal(f.latest.status, 'ready');
        assert.equal(clock.timers.size, 0); r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
    });

    await test('Account switching during authorization cannot send or publish a captured old-account token', async () => {
        for (const expire of [false, true]) {
            const clock = deadlineClock(), f = model(clock.options), gate = defer();
            const oldSession = f.rt.world.auth.session, getSession = f.rt.supabase.auth.getSession;
            let preflights = 0;
            f.rt.supabase.auth.getSession = () => ++preflights <= 5 ? gate.promise : getSession();
            const r = f.render(); await r.settle(); assert.equal(f.rt.world.requests.length, 0);
            f.rt.switch('b', r); r.draw(); await r.settle();
            assert.equal(f.latest.counts.places.data, null); assert.equal(f.latest.recent.entries.length, 0);
            if (expire) { clock.expire(); await r.settle(); }
            else { gate.resolve({ data: { session: oldSession }, error: null }); await r.settle(); }
            assert.equal(f.latest.status, 'ready'); assert.equal(f.latest.counts.places.data, 1);
            assert(f.rt.world.requests.every(call => call.user === 'b'));
            assert(!JSON.stringify(f.latest).includes('Private Cafe'));
            const requests = f.rt.world.requests.length;
            gate.resolve({ data: { session: oldSession }, error: null }); await r.settle();
            assert.equal(f.rt.world.requests.length, requests); assert.equal(f.latest.counts.places.data, 1);
            assert.equal(clock.timers.size, 0); r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
        }
    });

    await test('Authorization and HTTP share one deadline rather than restarting the timeout after preflight', async () => {
        const clock = deadlineClock(), f = model(clock.options), auth = defer(), http = defer();
        const session = f.rt.world.auth.session, getSession = f.rt.supabase.auth.getSession;
        let first = true;
        f.rt.supabase.auth.getSession = () => {
            if (first) { first = false; return auth.promise; }
            return getSession();
        };
        f.override = call => call.method === 'HEAD' && call.url.pathname.endsWith('/personal_places') ? http.promise : null;
        const r = f.render(); await r.settle();
        assert.equal(clock.timers.size, 1); const timer = [...clock.timers.keys()][0];
        assert.equal(f.rt.world.requests.filter(call => call.method === 'HEAD' && call.url.pathname.endsWith('/personal_places')).length, 0);
        auth.resolve({ data: { session }, error: null }); await r.settle();
        assert.deepEqual([...clock.timers.keys()], [timer], 'HTTP must use the preflight deadline already in progress');
        clock.expire(); await r.settle();
        assert.equal(f.latest.status, 'partial'); assert.equal(f.latest.counts.places.status, 'error');
        assert.equal(f.latest.counts.places.data, null); assert.equal(f.latest.counts.visits.data, 2);
        http.resolve(new Response(null, { status: 200, headers: { 'Content-Range': '*/999' } })); await r.settle();
        assert.equal(f.latest.counts.places.data, null); assert.equal(clock.timers.size, 0);
        r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
    });
    console.log(`${passed} Home dashboard checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
