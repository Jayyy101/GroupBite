// Actual Home route/scaffold, navigation reducers and (for privacy cases) the
// dashboard hook/read client. HTTP/native boundaries are offline; no hosted I/O.
const assert = require('node:assert/strict');
const { runtime, response, screen, click, button, nodes, textOf } = require('./personal-places.cjs');
const routing = require('./router-fixture.cjs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const metric = (n, status = 'ready') => ({ status, value: status === 'ready' ? n : null, knownCount: n, unresolvedRecords: 0, reason: null });
const metrics = (snap) => { const status = snap.places.status; return { placesSaved: metric(snap.places.data, status), yourVisits: metric(snap.visits.data, snap.visits.status), citiesExplored: metric(status === 'ready' ? 4 : null, status), groupsJoined: metric(snap.groups.data?.count ?? null, snap.groups.status) }; };
const ready = data => ({ status: 'ready', data, error: null });
const error = () => ({ status: 'error', data: null, error: 'Unavailable' });
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const styleOf = node => flat(typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style);
const personal = { kind: 'personal', origin: 'legacy', visitId: id(1), entryId: id(101), name: 'Private Cafe', address: 'Personal address',
    visited_on: '2026-01-01', created_at: '2026-10-20T12:00:00Z', rating: null };
const groupVisit = { kind: 'group', visitId: id(1), entryId: id(102), restaurantId: id(202), name: 'Shared Cafe', address: 'Group address',
    groupId: id(21), groupName: 'Dinner friends', membershipId: id(31), visited_on: null, created_at: '2026-10-19T12:00:00Z', rating: 5 };
const preview = [
    { id: id(21), name: 'Dinner friends', membershipId: id(31), role: 'Owner' },
    { id: id(22), name: 'Lunch friends', membershipId: id(32), role: 'Member' },
    { id: id(23), name: 'Weekend friends', membershipId: id(33), role: 'Member' },
];
const snapshot = () => ({ places: ready(9), visits: ready(12), groups: ready({ count: 4, preview }),
    personalRecent: ready([personal]), groupRecent: ready([groupVisit]) });
const recentCards = r => nodes(r.output).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.endsWith(', restaurant history'));
const groupCards = r => nodes(r.output).filter(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Open group '));

function model(options = {}) {
    let view, r, refreshes = 0, collectionStatistics;
    const rt = runtime({ ...options, mocks: { ...options.mocks,
        '@/hooks/use-home-dashboard': { useHomeDashboard: () => ({ ...view, collectionStatistics, refresh() {
            refreshes++; collectionStatistics = metrics(lib.emptyHomeDashboard()); view = lib.homeDashboardView(lib.emptyHomeDashboard()); r.dirty = true;
        } }) },
    } });
    const lib = rt.load('@/lib/home-dashboard'); view = lib.homeDashboardView(options.snapshot ?? snapshot()); collectionStatistics = options.statistics ?? metrics(options.snapshot ?? snapshot());
    r = screen(rt, options.tabs ? '(app)/(tabs)/_layout' : 'index');
    if (options.tabs) rt.world.tabsScreen = rt.load('app/index').default;
    return { rt, r, lib, get refreshes() { return refreshes; }, update(next) { collectionStatistics = metrics(next); view = lib.homeDashboardView(next); r.dirty = true; } };
}

// Minimal RLS-like HTTP fixture for the rendered hook integration. The larger
// query/cancellation matrix remains in home-dashboard.cjs; these tests assert DOM
// content and labels, including what is hidden before effect cleanup.
function liveModel() {
    const db = {
        personal_places: [
            { id: id(101), owner_user_id: 'a', name: 'A private cafe', address: 'A address' },
            { id: id(103), owner_user_id: 'b', name: 'B private cafe', address: 'B address' },
        ],
        personal_place_locations: [], group_restaurant_locations: [], personal_mapkit_locations: [], group_mapkit_locations: [],
        personal_visits: [
            { id: id(1), personal_place_id: id(101), owner_user_id: 'a', origin: 'visit', visited_on: null, rating: null, created_at: personal.created_at },
            { id: id(2), personal_place_id: id(103), owner_user_id: 'b', origin: 'visit', visited_on: null, rating: null, created_at: personal.created_at },
        ],
        groups: [{ id: id(21), name: 'A shared table', owner_user_id: 'a' }],
        group_memberships: [{ group_id: id(21), user_id: 'a', membership_id: id(31), joined_at: personal.created_at }],
        group_restaurants: [{ id: id(102), group_id: id(21), restaurant_id: id(202) }],
        restaurants: [{ id: id(202), name: 'A shared cafe', address: 'Group address' }],
        visits: [{ id: id(1), group_restaurant_id: id(102), visited_on: null, rating: 5, created_at: groupVisit.created_at }],
    };
    let override;
    const rt = runtime({ fetch: call => {
        const { url, method, user, headers } = call;
        if (url.pathname.endsWith('/get_my_visit_event_summary')) return response([{linked_events: 0, linked_records: 0, unlinked_records: 1}]);
        assert(['GET', 'HEAD'].includes(method));
        const table = url.pathname.split('/').at(-1); assert(db[table]);
        const selected = url.searchParams.get('select').split(','); assert(!selected.includes('notes') && !selected.includes('*'));
        const member = groupId => db.group_memberships.some(m => m.user_id === user && m.group_id === groupId);
        let rows = db[table].filter(row => {
            if (['personal_places', 'personal_visits'].includes(table)) return row.owner_user_id === user;
            if (table === 'group_memberships') return row.user_id === user;
            if (table === 'groups') return member(row.id);
            if (table === 'group_restaurants') return member(row.group_id);
            if (table === 'restaurants') return db.group_restaurants.some(e => e.restaurant_id === row.id && member(e.group_id));
            return db.group_restaurants.some(e => e.id === row.group_restaurant_id && member(e.group_id));
        });
        for (const [key, value] of url.searchParams) {
            if (value.startsWith('eq.')) rows = rows.filter(row => row[key] === value.slice(3));
            if (value.startsWith('in.(')) rows = rows.filter(row => value.slice(4, -1).split(',').includes(row[key]));
        }
        const count = rows.length;
        rows = rows.slice(0, Number(url.searchParams.get('limit') ?? rows.length));
        const resultHeaders = { 'Content-Type': 'application/json' };
        if (headers.get('Prefer')?.includes('count=exact')) resultHeaders['Content-Range'] = `*/${count}`;
        const normal = () => new Response(method === 'HEAD' ? null : JSON.stringify(rows.map(row => Object.fromEntries(selected.map(key => [key, row[key]])))),
            { status: 200, headers: resultHeaders });
        return override?.(call, normal) ?? normal();
    } });
    return { rt, db, r: screen(rt, 'index'), set override(next) { override = next; } };
}

let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
    await test('Home shows the greeting, exact qualified counts, private/group labels and recorded visit dates', async () => {
        const f = model(); await f.r.settle(); const text = textOf(f.r.output);
        for (const label of ['Welcome back!', 'Your food memories', 'Recent saves', 'Your groups', 'My Places · Private', 'Group · Dinner friends', 'Imported saved memory']) assert(text.includes(label));
        for (const label of ['Places saved, Across your collections, 9', 'Your visits, Dining occasions you recorded, 12', 'Groups joined, Including groups you own, 4']) assert.equal(button(f.r, label).props.disabled, false);
        assert.equal(recentCards(f.r).length, 2); assert.equal(groupCards(f.r).length, 3);
        assert(textOf(recentCards(f.r)[0]).includes('2026')); assert(!textOf(recentCards(f.r)[0]).includes('Oct'));
        assert(textOf(recentCards(f.r)[1]).includes('Date not recorded'));
        assert(!text.includes('View all recent')); assert(!nodes(f.r.output).some(n => n.type === 'Pressable' && /add/i.test(n.props.accessibilityLabel ?? textOf(n))));
        assert.equal(f.rt.world.requests.length, 0); f.r.unmount();
    });

    await test('Incomplete city coverage and unlinked historical visits have honest distinct labels', async () => {
        const stats=metrics(snapshot());
        stats.yourVisits={...metric(null,'incomplete'),reason:'history',knownCount:3,unresolvedRecords:12};
        stats.citiesExplored={...metric(null,'incomplete'),reason:'city',knownCount:4,unresolvedRecords:3};
        stats.placesSaved={...metric(null,'incomplete'),reason:'identity',knownCount:null,unresolvedRecords:3};
        const f=model({statistics:stats});await f.r.settle();
        assert(button(f.r,'Cities explored, From saved restaurant locations, 4 identified'));
        assert(button(f.r,'Your visits, Dining occasions you recorded, Unavailable'));
        const text=textOf(f.r.output);assert(text.includes('Older records have no shared visit identity.'));
        assert(text.includes('3 saved entries need city details.'));assert(!text.includes('12 visits'));assert(!text.includes('3 dining occasions'));
        assert(text.includes('Latest destination saves. One occasion can appear in several collections.'));f.r.unmount();
    });
    await test('Home statistics and existing shortcut preserve the map Home-origin navigation', async () => {
        const f=model({development:true,platform:'ios'});await f.r.settle();
        for(const label of ['Places saved, Across your collections, 9','Cities explored, From saved restaurant locations, 4','Open Saved Map']) {
            await click(f.r,label);const last=f.rt.world.navigation.at(-1);assert.equal(last,'/home/saved-map');
        }f.r.unmount();
    });
    await test('Loading uses placeholders and disabled accessible Refresh, without zeros or empty-state claims', async () => {
        const f = model(); f.update(f.lib.emptyHomeDashboard()); await f.r.settle();
        for (const label of ['Places saved, Across your collections, Loading', 'Your visits, Dining occasions you recorded, Loading', 'Groups joined, Including groups you own, Loading']) assert(button(f.r, label).props.disabled);
        const refresh = button(f.r, 'Refresh dashboard'); assert(refresh.props.disabled); assert(refresh.props.accessibilityState.busy);
        assert(textOf(f.r.output).includes('Loading recent visits')); assert(textOf(f.r.output).includes('Loading your groups'));
        assert(!textOf(f.r.output).includes('No visits yet')); assert(!textOf(f.r.output).includes('No groups yet'));
        assert.equal(recentCards(f.r).length, 0); assert.equal(groupCards(f.r).length, 0); f.r.unmount();
    });

    await test('Successful empty accounts show true zero counts and compact friendly empty sections', async () => {
        const f = model({ snapshot: { places: ready(0), visits: ready(0), groups: ready({ count: 0, preview: [] }), personalRecent: ready([]), groupRecent: ready([]) } });
        await f.r.settle();
        for (const label of ['Places saved, Across your collections, 0', 'Your visits, Dining occasions you recorded, 0', 'Groups joined, Including groups you own, 0']) assert(button(f.r, label));
        assert(textOf(f.r.output).includes('No visits yet')); assert(textOf(f.r.output).includes('No groups yet'));
        assert(!textOf(f.r.output).includes('unavailable')); assert(!button(f.r, 'Refresh dashboard').props.disabled); f.r.unmount();
    });

    await test('Unavailable totals and failed sections expose retry without showing false empty states', async () => {
        const f = model({ snapshot: Object.fromEntries(Object.keys(snapshot()).map(key => [key, error()])) }); await f.r.settle();
        for (const label of ['Places saved, Across your collections, Unavailable', 'Your visits, Dining occasions you recorded, Unavailable', 'Groups joined, Including groups you own, Unavailable']) assert.equal(button(f.r, label).props.disabled, false);
        const text = textOf(f.r.output); assert(text.includes('Some totals are unavailable')); assert(text.includes('Recent saves are unavailable'));
        assert(text.includes('Your groups are unavailable')); assert(!text.includes('No visits yet')); assert(!text.includes('No groups yet'));
        await click(f.r, 'Refresh dashboard'); assert.equal(f.refreshes, 1); assert(button(f.r, 'Refresh dashboard').props.disabled); f.r.unmount();
    });

    await test('Partial activity identifies either missing stream, including when the successful stream is empty', async () => {
        for (const kind of ['group', 'personal']) for (const empty of [false, true]) {
            const next = snapshot(); next[kind === 'group' ? 'groupRecent' : 'personalRecent'] = error();
            if (empty) next[kind === 'group' ? 'personalRecent' : 'groupRecent'] = ready([]);
            if (kind === 'group') next.groups = error();
            const f = model({ snapshot: next }); await f.r.settle(); const text = textOf(f.r.output);
            assert(text.includes(`Recent activity is incomplete: ${kind} visits couldn’t load.`));
            assert(!text.includes('No visits yet')); assert.equal(recentCards(f.r).length, empty ? 0 : 1);
            if (kind === 'group') { assert(!text.includes('Dinner friends')); assert(!text.includes('Shared Cafe')); assert.equal(groupCards(f.r).length, 0); }
            else assert(!text.includes('Private Cafe'));
            f.r.unmount();
        }
    });

    await test('Refresh clears displayed cards while loading and accepts the next successful hook snapshot', async () => {
        const f = model(); await f.r.settle(); await click(f.r, 'Refresh dashboard');
        assert.equal(f.refreshes, 1); assert.equal(recentCards(f.r).length, 0); assert.equal(groupCards(f.r).length, 0);
        assert(!textOf(f.r.output).includes('Dinner friends')); f.update(snapshot()); await f.r.settle();
        assert.equal(recentCards(f.r).length, 2); assert(!button(f.r, 'Refresh dashboard').props.disabled); f.r.unmount();
    });

    await test('Home browsing retains its own stack and exact destination IDs; root actions open collection tabs', async () => {
        const { history } = await routing(), h = history('/'), pushes = [];
        const f = model({ router: { ...h.router, push(href, options) { pushes.push({ href, options }); h.router.push(href, options); } } }); await f.r.settle();
        await click(f.r, recentCards(f.r)[0].props.accessibilityLabel);
        assert.equal(pushes.at(-1).href.pathname, '/home/personal-place/[id]'); assert.equal(pushes.at(-1).href.params.id, personal.entryId);
        assert(pushes.at(-1).options.withAnchor); assert.equal(h.current().params.id, personal.entryId);
        h.router.back(); assert.equal(h.chain()[2].name, '(home)'); assert.equal(h.current().name, 'index'); h.select('(home)');
        await click(f.r, recentCards(f.r)[1].props.accessibilityLabel);
        assert.equal(pushes.at(-1).href.pathname, '/home/group/[id]/restaurant/[entryId]');
        assert.deepEqual(JSON.parse(JSON.stringify(pushes.at(-1).href.params)), { id: groupVisit.groupId, entryId: groupVisit.entryId });
        assert(pushes.at(-1).options.withAnchor); h.router.back(); assert.equal(h.chain()[2].name, '(home)'); assert.equal(h.current().name, 'index'); h.select('(home)');
        await click(f.r, 'Open group Dinner friends, Owner'); assert.equal(h.current().params.id, id(21)); assert(pushes.at(-1).options.withAnchor);
        h.select('(home)'); await click(f.r, 'View all groups'); assert.equal(h.current().name, 'groups');
        for (const [label, root] of [['Places saved, Across your collections, 9', 'my-places'], ['Groups joined, Including groups you own, 4', 'groups']]) {
            h.select('(home)'); await click(f.r, label); assert.equal(h.current().name, root);
        }
        assert(pushes.every(p => !JSON.stringify(p.href).includes('notes') && !JSON.stringify(p.href).includes('created_at'))); f.r.unmount();
    });

    await test('Five recent rows, source-qualified keys, three group previews and View all remain distinct', async () => {
        const next = snapshot(); next.personalRecent = ready([personal, { ...personal, visitId: id(2) }, { ...personal, visitId: id(3) }]);
        next.groupRecent = ready([groupVisit, { ...groupVisit, visitId: id(4) }, { ...groupVisit, visitId: id(5) }]);
        const f = model({ snapshot: next }); await f.r.settle();
        assert.equal(recentCards(f.r).length, 2); await click(f.r, 'See more recent saves');
        assert.equal(recentCards(f.r).length, 5); assert.equal(new Set(recentCards(f.r).map(n => n.key)).size, 5);
        await click(f.r, 'Show fewer recent saves'); assert.equal(recentCards(f.r).length, 2);
        assert.equal(groupCards(f.r).length, 3); assert(button(f.r, 'View all groups')); assert.equal(button(f.r, 'Groups joined, Including groups you own, 4').props.disabled, false); f.r.unmount();
    });

    await test('Safe areas, long names and large text retain one scroll, wrapping text and reachable controls', async () => {
        for (const safeAreaInsets of [{ top: 62, left: 0, right: 0, bottom: 34 }, { top: 0, left: 59, right: 59, bottom: 21 }]) {
            const next = snapshot(), long = 'A very long restaurant and group name '.repeat(5);
            next.personalRecent = ready([{ ...personal, name: long }]); next.groupRecent = ready([{ ...groupVisit, groupName: long }]);
            next.groups = ready({ count: 1, preview: [{ ...preview[0], name: long }] });
            const f = model({ snapshot: next, platform: 'ios', safeAreaInsets, windowDimensions: { width: 320, height: 568, scale: 2, fontScale: 2 } }); await f.r.settle();
            const scrolls = nodes(f.r.output).filter(n => n.type === 'ScrollView'); assert.equal(scrolls.length, 1);
            const content = flat(scrolls[0].props.contentContainerStyle); assert.equal(content.paddingLeft, Math.max(24, safeAreaInsets.left));
            assert.equal(content.paddingTop, 24); assert.equal(styleOf(f.r.output).paddingTop, safeAreaInsets.top);
            assert.equal(scrolls[0].props.contentInsetAdjustmentBehavior, 'never'); assert.equal(styleOf(scrolls[0]).height, undefined);
            for (const text of nodes(f.r.output).filter(n => n.type === 'Text')) { assert.equal(text.props.numberOfLines, undefined); assert.notEqual(text.props.allowFontScaling, false); }
            for (const label of ['Refresh dashboard', 'View all groups']) { const style = styleOf(button(f.r, label)); assert(style.minWidth >= 44 && style.minHeight >= 44); }
            const summaryParent = nodes(f.r.output).find(n => n.type === 'View' && styleOf(n).flexDirection === 'row' && nodes(n).filter(n => n.type === 'Pressable' && /^(Places saved|Your visits|Cities explored|Groups joined),/.test(n.props.accessibilityLabel ?? '')).length === 4);
            assert(summaryParent); assert.equal(styleOf(summaryParent).flexWrap, "wrap");
            for (const card of nodes(summaryParent).filter(n => n.type === "Pressable")) assert.equal(styleOf(card).width, "100%");
            for (const card of recentCards(f.r)) assert.equal(styleOf(card).height, undefined);
            assert(!nodes(f.r.output).some(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Back')); f.r.unmount();
        }
    });

    await test('Home leaves all five existing tabs and their navigation behavior available', async () => {
        const f = model({ tabs: true }); await f.r.settle();
        assert.deepEqual(nodes(f.r.output).filter(n => n.type === 'TabScreen').map(n => n.props.options.title), ['Home', 'My Places', 'Add', 'Groups', 'Account']);
        assert(textOf(f.r.output).includes('Your food memories'));
        const tabs = nodes(f.r.output).find(n => n.type === 'Tabs');
        assert.equal(tabs.props.screenOptions({ route: { name: '(home)' } }).popToTopOnBlur, true);
        assert.equal(tabs.props.screenOptions({ route: { name: '(home)' } }).tabBarHideOnKeyboard, false); f.r.unmount();
    });

    await test('Rendered hook removes group names/cards on revoked membership or failed access checks and retries safely', async () => {
        for (const reason of ['removed', 'unavailable', 'rejoined']) {
            const f = liveModel(); await f.r.settle(); assert(textOf(f.r.output).includes('A shared table'));
            if (reason === 'removed') f.db.group_memberships = [];
            if (reason === 'rejoined') f.db.group_memberships[0].membership_id = id(999);
            if (reason === 'unavailable') f.override = call => call.url.pathname.endsWith('/group_memberships') ? response({}, 503) : null;
            f.rt.poll(); await f.r.settle(); const text = textOf(f.r.output);
            assert(!text.includes('A shared table')); assert(!text.includes('A shared cafe')); assert(text.includes('A private cafe'));
            assert(button(f.r, 'Groups joined, Including groups you own, Unavailable')); assert(text.includes('Recent activity is incomplete'));
            f.override = null; button(f.r, 'Refresh dashboard').props.onPress(); f.r.draw();
            assert(!textOf(f.r.output).includes('A shared table')); await f.r.settle();
            if (reason === 'removed') { assert(button(f.r, 'Groups joined, Including groups you own, 0')); assert.equal(groupCards(f.r).length, 0); }
            else assert(textOf(f.r.output).includes('A shared table'));
            f.r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
        }
    });

    await test('Rendered hook hides data on account replacement, sign-out, blur and background; late reads cannot flash it', async () => {
        for (const boundary of ['account', 'signout', 'blur', 'background']) {
            const f = liveModel(); await f.r.settle(); assert(textOf(f.r.output).includes('A private cafe'));
            const gate = defer(); let blocked = false;
            f.override = (call, normal) => {
                if (!blocked && call.url.pathname.endsWith('/personal_places') && call.method === 'HEAD') { blocked = true; return gate.promise.then(normal); }
                return null;
            };
            const refresh = button(f.r, 'Refresh dashboard'); refresh.props.onPress(); await f.r.settle();
            if (boundary === 'account') f.rt.switch('b', f.r);
            if (boundary === 'signout') f.rt.switch(null, f.r);
            if (boundary === 'blur') { f.rt.world.focused = false; f.r.dirty = true; }
            if (boundary === 'background') f.rt.emit('background');
            f.r.draw(); assert(!textOf(f.r.output).includes('A private cafe')); assert(!textOf(f.r.output).includes('A shared table'));
            gate.resolve(); await f.r.settle();
            assert(!textOf(f.r.output).includes('A private cafe')); assert(!textOf(f.r.output).includes('A shared table'));
            if (boundary === 'account') assert(textOf(f.r.output).includes('B private cafe'));
            if (boundary === 'blur' || boundary === 'background') {
                if (boundary === 'blur') { f.rt.world.focused = true; f.r.dirty = true; } else f.rt.emit('active');
                await f.r.settle(); assert(textOf(f.r.output).includes('A private cafe'));
            }
            f.r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
        }
    });
    console.log(`${passed} Home dashboard UI checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
