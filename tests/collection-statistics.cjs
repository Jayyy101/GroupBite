// Actual collection calculations, Supabase queries and opt-in hook. Synthetic
// HTTP/RLS/lifecycle boundaries only; no .env, hosted data or geocoding provider.
const assert = require('node:assert/strict');
const { runtime, response } = require('./personal-places.cjs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const address = (street = '100 Main St', city = 'Springfield', region = 'IL', postal = '62704', country = 'United States') => `${street}, ${city}, ${region} ${postal}, ${country}`;
const place = (overrides = {}) => ({ kind: 'personal', sourceId: id(1), name: 'Cafe', address: address(), applePlaceId: null, verifiedAddress: address(), ...overrides });
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const fail = () => response({ message: 'PRIVATE SERVER DIAGNOSTICS' }, 503);
function clock() { const timers = new Map(); let n = 0; return { timers,
    options: { setTimeout(fn) { timers.set(++n, fn); return n; }, clearTimeout(i) { timers.delete(i); } },
    expire() { [...timers.values()].forEach(fn => fn()); } }; }
function fixture() {
    const db = {
        personal_places: [
            { id: id(1), owner_user_id: 'a', name: 'Cafe', address: address(), apple_place_id: 'opaque:one', notes: 'PRIVATE NOTE A' },
            { id: id(2), owner_user_id: 'a', name: 'Cafe', address: address('200 Main St'), apple_place_id: 'opaque:two' },
            { id: id(3), owner_user_id: 'b', name: 'B secret cafe', address: address('400 Main St'), apple_place_id: null, notes: 'PRIVATE NOTE B' },
        ],
        group_memberships: [
            { group_id: id(21), user_id: 'a', membership_id: id(31), joined_at: '2026-10-20' },
            { group_id: id(22), user_id: 'a', membership_id: id(32), joined_at: '2026-10-19' },
            { group_id: id(23), user_id: 'b', membership_id: id(33), joined_at: '2026-10-18' },
        ],
        groups: [
            { id: id(21), name: 'Dinner', owner_user_id: 'a' }, { id: id(22), name: 'Lunch', owner_user_id: 'b' }, { id: id(23), name: 'B secret group', owner_user_id: 'b' },
        ],
        group_restaurants: [
            { id: id(51), group_id: id(21), restaurant_id: id(41), apple_place_id: 'opaque:one', created_by: 'b' },
            { id: id(52), group_id: id(22), restaurant_id: id(42), apple_place_id: null, created_by: 'b' },
            { id: id(53), group_id: id(22), restaurant_id: id(43), apple_place_id: 'opaque:three', created_by: 'b' },
            { id: id(54), group_id: id(23), restaurant_id: id(44), apple_place_id: null },
        ],
        restaurants: [
            { id: id(41), name: 'Cafe', address: address() }, { id: id(42), name: 'Cafe', address: address() },
            { id: id(43), name: 'Cafe', address: address('300 Main St', 'Springfield', 'MA', '01103') },
            { id: id(44), name: 'B secret cafe', address: address('400 Main St') },
        ],
        personal_place_locations: [], group_restaurant_locations: [], personal_mapkit_locations: [], group_mapkit_locations: [], personal_visits: [], visits: [],
    };
    for (const row of db.personal_places) db.personal_place_locations.push({ personal_place_id: row.id, address_snapshot: row.address, resolution_status: 'resolved', standardized_address: row.address });
    for (const entry of db.group_restaurants) {
        const row = db.restaurants.find(r => r.id === entry.restaurant_id);
        db.group_restaurant_locations.push({ group_restaurant_id: entry.id, address_snapshot: row.address, resolution_status: 'resolved', standardized_address: row.address });
    }
    return db;
}
function model(options = {}) {
    const db = fixture(); let override, latest;
    function answer(call) {
        const { url, method, user, headers } = call, table = url.pathname.split('/').at(-1);
        if (table === 'get_my_visit_event_summary') return response([{linked_events: 0, linked_records: 0, unlinked_records: 0}]);
        assert(Object.hasOwn(db, table), 'Unexpected table/RPC ' + table);
        assert(['GET', 'HEAD'].includes(method));
        const columns = url.searchParams.get('select').split(','); assert(!columns.includes('notes') && !columns.includes('*'));
        if (!options.hook) assert(!['visits', 'personal_visits'].includes(table), 'Collection reads must not download histories');
        const member = groupId => db.group_memberships.some(m => m.user_id === user && m.group_id === groupId);
        const entryAllowed = entryId => db.group_restaurants.some(e => e.id === entryId && member(e.group_id));
        const placeAllowed = placeId => db.personal_places.some(p => p.id === placeId && p.owner_user_id === user);
        let rows = db[table].filter(row => {
            if (['personal_places', 'personal_visits'].includes(table)) return row.owner_user_id === user;
            if (table === 'group_memberships') return row.user_id === user;
            if (table === 'groups') return member(row.id);
            if (table === 'group_restaurants') return member(row.group_id);
            if (['personal_place_locations', 'personal_mapkit_locations'].includes(table)) return placeAllowed(row.personal_place_id);
            if (['group_restaurant_locations', 'group_mapkit_locations'].includes(table)) return entryAllowed(row.group_restaurant_id);
            if (table === 'visits') return entryAllowed(row.group_restaurant_id);
            return db.group_restaurants.some(e => e.restaurant_id === row.id && member(e.group_id));
        });
        if (['personal_places', 'personal_visits'].includes(table)) assert.equal(url.searchParams.get('owner_user_id'), 'eq.' + user);
        if (table === 'group_memberships') assert.equal(url.searchParams.get('user_id'), 'eq.' + user);
        for (const [key, value] of url.searchParams) {
            if (value.startsWith('eq.')) rows = rows.filter(row => row[key] === value.slice(3));
            if (value.startsWith('gt.')) rows = rows.filter(row => row[key] > value.slice(3));
            if (value.startsWith('in.(')) rows = rows.filter(row => value.slice(4, -1).split(',').includes(row[key]));
        }
        const count = rows.length;
        const orders = (url.searchParams.get('order') ?? '').split(',').filter(Boolean);
        rows.sort((a, b) => { for (const order of orders) { const [key, direction] = order.split('.'); const diff = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; if (diff) return direction === 'desc' ? -diff : diff; } return 0; });
        if (method === 'GET') { assert(Number(url.searchParams.get('limit')) <= 200); assert(Number(url.searchParams.get('limit')) > 0); }
        rows = rows.slice(0, Math.min(Number(url.searchParams.get('limit') ?? rows.length), options.rowCap ?? 1000));
        const resultHeaders = { 'Content-Type': 'application/json' };
        if (headers.get('Prefer')?.includes('count=exact')) resultHeaders['Content-Range'] = `*/${count}`;
        return new Response(method === 'HEAD' ? null : JSON.stringify(rows.map(row => Object.fromEntries(columns.map(key => [key, row[key]])))), { status: 200, headers: resultHeaders });
    }
    const rt = runtime({ ...options, fetch: call => override?.(call, () => answer(call)) ?? answer(call) });
    const lib = rt.load('@/lib/collection-statistics'), identity = rt.load('@/lib/collection-identity');
    const load = (userId = 'a', signal = new AbortController().signal) => lib.readCollectionStatistics({ userId, signal });
    const render = (includeCollections = true) => rt.render(function Probe() { latest = rt.load('@/hooks/use-home-dashboard').useHomeDashboard({ includeCollections }); return null; }, false);
    return { db, rt, lib, identity, load, render, get latest() { return latest; }, set override(next) { override = next; }, answer };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
    await test('Consistent IDs and complete manual copies across collections count one venue without modifying input', async () => {
        const f = model(), values = [place({ applePlaceId: 'Opaque:ONE' }), place({ kind: 'group', sourceId: id(2), applePlaceId: 'Opaque:ONE' }), place({ kind: 'group', sourceId: id(3) })];
        const before = JSON.stringify(values), stats = f.identity.calculateCollectionLocations(values);
        assert.equal(stats.placesSaved.value, 1); assert.equal(stats.citiesExplored.value, 1); assert.equal(JSON.stringify(values), before);
    });
    await test('Different chain branches, street directions, units and postal codes remain separate', async () => {
        const f = model();
        const locations = ['100 East Main St', '100 West Main St', '100 Main St Suite 1', '100 Main St Suite 2', '200 Main St'].map((street, i) => place({ sourceId: id(i + 1), address: address(street), verifiedAddress: address(street) }));
        assert.equal(f.identity.calculateCollectionLocations(locations).placesSaved.value, 5);
        const otherPostal = address('100 Main St', 'Springfield', 'IL', '62705');
        assert.equal(f.identity.calculateCollectionLocations([place(), place({ address: otherPostal, verifiedAddress: otherPostal })]).placesSaved.value, 2);
    });
    await test('Apple identity never overrides conflicting current saved street wording', async () => {
        const f = model();
        const stats = f.identity.calculateCollectionLocations([place({ applePlaceId: 'opaque:one' }),
            place({ kind: 'group', applePlaceId: 'opaque:one', address: address('100 Main Street'), verifiedAddress: address() })]);
        assert.equal(stats.placesSaved.value, null); assert.equal(stats.citiesExplored.value, null);
        for (const verifiedAddress of [address('999 Main St'), address('100 Main St', 'Springfield', 'MA', '01103')]) {
            assert.equal(f.identity.calculateCollectionLocations([place({ verifiedAddress })]).placesSaved.value, null);
        }
    });
    await test('Conflicting IDs/addresses/names and NULL-ID bridges never claim an exact venue total', async () => {
        const f = model();
        for (const values of [
            [place({ applePlaceId: 'one' }), place({ applePlaceId: 'two' }), place()],
            [place({ applePlaceId: 'one' }), place({ applePlaceId: 'one', address: address('900 Main St'), verifiedAddress: address('900 Main St') })],
            [place({ applePlaceId: 'one' }), place({ applePlaceId: 'one', name: 'Other brand' })],
            [place({ applePlaceId: 'ONE' }), place({ applePlaceId: 'one' })],
            [place(), place({ name: 'Possible renamed venue' })],
        ]) { const stats = f.identity.calculateCollectionLocations(values); assert.equal(stats.placesSaved.status, 'incomplete'); assert.equal(stats.placesSaved.value, null); assert.equal(stats.placesSaved.knownCount, null); }
    });
    await test('Name, city, coordinates and incomplete addresses never establish venue identity', async () => {
        const f = model();
        assert.equal(f.identity.calculateCollectionLocations([place({name:'  '})]).placesSaved.value,null);
        for (const incomplete of ['', 'Main Street', 'Springfield, IL', '100 Main St, Springfield, IL 62704', 'Unknown']) {
            const result = f.identity.calculateCollectionLocations([place({ address: incomplete, verifiedAddress: null, latitude: 37, longitude: -122 })]);
            assert.equal(result.placesSaved.value, null); assert.equal(result.citiesExplored.value, null);
        }
        const manual = f.identity.calculateCollectionLocations([place({ verifiedAddress: null })]);
        assert.equal(manual.placesSaved.value, 1); assert.equal(manual.citiesExplored.status, 'incomplete'); assert.equal(manual.citiesExplored.knownCount, 0);
    });
    await test('Cities distinguish state/country and recognize supported combined/split postal formats', async () => {
        const f = model(), addresses = [address(), address('100 Main St', 'Springfield', 'MA', '01103'), address('100 Main St', 'Springfield', 'ON', 'K1A 0B1', 'Canada')];
        const stats = f.identity.calculateCollectionLocations(addresses.map((value, i) => place({ sourceId: id(i), address: value, verifiedAddress: value })));
        assert.equal(stats.citiesExplored.value, 3); assert.equal(stats.placesSaved.value, 3);
        const split = f.identity.identifyCollectionAddress(address());
        const combined = f.identity.identifyCollectionAddress('100 Main St, Springfield IL 62704, USA');
        assert.equal(split.cityKey, combined.cityKey); assert.equal(split.addressKey, combined.addressKey);
    });
    await test('Missing, unparseable, unsupported and sentinel cities remain incomplete, never zero success', async () => {
        const f = model();
        for (const value of ['100 Main St, Unknown, IL 62704, United States', '100 Main St, N/A, IL 62704, United States', '100 Main St, Springfield, XX 62704, United States', '100 Main St, Springfield, IL, United States', '100 Main St, Paris, 75001, France']) {
            const stats = f.identity.calculateCollectionLocations([place({ address: value, verifiedAddress: value })]);
            assert.equal(stats.citiesExplored.status, 'incomplete'); assert.equal(stats.citiesExplored.value, null);
        }
        const partial = f.identity.calculateCollectionLocations([place(), place({ address: address('200 Main St'), verifiedAddress: null })]);
        assert.equal(partial.citiesExplored.value, null); assert.equal(partial.citiesExplored.knownCount, 1); assert.equal(partial.citiesExplored.unresolvedRecords, 1);
        assert.equal(f.identity.calculateCollectionLocations([]).citiesExplored.value, 0);
    });
    await test('Current structured Apple cities work without provider verification and preserve branch identity', async () => {
        const f = model(), structured = {street: '100 Main St', city: 'Fremont', region: 'CA', postal_code: '94538', country: 'United States', country_code: 'US'};
        const values = [place({address: 'Apple display', verifiedAddress: null, structured, applePlaceId: 'apple-fremont'}),
            place({sourceId: id(2), kind: 'group', address: 'Apple display', verifiedAddress: null, structured, applePlaceId: 'apple-fremont'})];
        const result = f.identity.calculateCollectionLocations(values);
        assert.equal(result.placesSaved.value, 1); assert.equal(result.citiesExplored.value, 1);
        const other = {...values[0], sourceId: id(3), applePlaceId: 'another-branch', structured: {...structured, street: '200 Main St'}};
        assert.equal(f.identity.calculateCollectionLocations([...values, other]).placesSaved.value, 2);
        assert.equal(f.identity.calculateCollectionLocations([...values, other]).citiesExplored.value, 1);
    });
    await test('Apple/verified locality conflicts are unresolved and missing components never borrow a city', async () => {
        const f = model(), structured = {street: null, city: 'Fremont', region: 'CA', postal_code: null, country: null, country_code: 'US'};
        assert.equal(f.identity.calculateCollectionLocations([place({structured})]).citiesExplored.knownCount, 0);
        for (const partial of [{city:'Fremont'}, {country_code:'CA'}, {region:'CA'}]) {
            const result=f.identity.calculateCollectionLocations([place({structured:{street:null,city:null,region:null,postal_code:null,country:null,country_code:null,...partial}})]);
            assert.equal(result.citiesExplored.value,null); assert.equal(result.citiesExplored.knownCount,0);
        }
        const partial = f.identity.calculateCollectionLocations([place({address: 'Native display', verifiedAddress: null, structured})]);
        assert.equal(partial.citiesExplored.value, 1); assert.equal(partial.placesSaved.value, null);
        for (const patch of [{city: null}, {city: 'Unknown'}, {region: null}, {country_code: null}])
            assert.equal(f.identity.calculateCollectionLocations([place({address: 'Native display', verifiedAddress: null, structured: {...structured, ...patch}})]).citiesExplored.value, null);
        const different = {...structured, region: 'Ontario', country_code: 'CA'};
        assert.equal(f.identity.calculateCollectionLocations([place({address: 'Native display', verifiedAddress: null, structured}), place({sourceId: id(2),address: 'Other native display',verifiedAddress:null,structured:different})]).citiesExplored.value, 2);
    });
    await test('Apple metadata is read per destination and stale snapshots are ignored', async () => {
        const f = model(); f.db.personal_place_locations = []; f.db.group_restaurant_locations = [];
        const row = f.db.personal_places[0];
        f.db.personal_mapkit_locations.push({personal_place_id:row.id,address_snapshot:row.address,latitude:37,longitude:-122,
            structured_address:{street:'100 Main St',city:'Springfield',region:'IL',postal_code:'62704',country_code:'US'}});
        let result = await f.load(); assert.equal(result.statistics.citiesExplored.knownCount,1);
        f.db.personal_mapkit_locations[0].address_snapshot = 'Old address';
        result = await f.load(); assert.equal(result.statistics.citiesExplored.knownCount,0);
        assert(f.rt.world.requests.some(c=>c.url.pathname.endsWith('/personal_mapkit_locations')));
        assert(f.rt.world.requests.some(c=>c.url.pathname.endsWith('/group_mapkit_locations')));
    });
    await test('Conflicting coordinates use the same conservative splitter as Saved Map', async () => {
        const f = model(); const values=[place({applePlaceId:'same',coordinate:{latitude:37,longitude:-122,quality:'apple'}}),
            place({sourceId:id(2),applePlaceId:'same',coordinate:{latitude:38,longitude:-122,quality:'apple'}})];
        assert.equal(f.identity.calculateCollectionLocations(values).placesSaved.status,'incomplete');
    });
    await test('Unique visits use server event summary, never destination counts or coincident dates', async () => {
        const f = model(); f.override = call => call.url.pathname.endsWith('/get_my_visit_event_summary') ? response([{linked_events:2,linked_records:6,unlinked_records:0}]) : null;
        assert.equal((await f.load()).statistics.yourVisits.value,2);
        f.override = call => call.url.pathname.endsWith('/get_my_visit_event_summary') ? response([{linked_events:2,linked_records:6,unlinked_records:3}]) : null;
        const metric=(await f.load()).statistics.yourVisits; assert.equal(metric.value,null);assert.equal(metric.reason,'history');assert.equal(metric.knownCount,2);assert.equal(metric.unresolvedRecords,3);
    });
    await test('Missing backend, failed and malformed summary affect only visit coverage', async () => {
        for(const [payload,status,reason] of [[{code:'PGRST202'},404,'backend'],[{},503,'read'],[[{linked_events:7,linked_records:2,unlinked_records:0}],200,'read'],[[{linked_events:-1,linked_records:2,unlinked_records:0}],200,'read']]) {
            const f=model(); f.override=call=>call.url.pathname.endsWith('/get_my_visit_event_summary')?response(payload,status):null;
            const result=await f.load();assert.equal(result.statistics.yourVisits.reason,reason);assert.equal(result.statistics.yourVisits.value,null);assert.equal(result.statistics.groupsJoined.value,2);assert.equal(result.statistics.placesSaved.value,3);
        }
    });
    await test('Authorized inventory includes other members’ contributions and excludes unrelated/private data and histories', async () => {
        const f = model(), before = JSON.stringify(f.db), result = await f.load();
        assert.deepEqual(Object.fromEntries(Object.entries(result.statistics).map(([key, metric]) => [key, metric.value])), { placesSaved: 3, citiesExplored: 2, yourVisits: 0, groupsJoined: 2 });
        assert.equal(result.memberships.length, 2); assert.equal(JSON.stringify(f.db), before);
        assert(!JSON.stringify(result).includes('Cafe')); assert(!JSON.stringify(result).includes('SECRET')); assert(!JSON.stringify(result).includes('NOTE'));
        assert.equal(f.rt.world.localReads, 0); assert.equal(f.rt.world.localWrites, 0);
        assert(f.rt.world.requests.every(call => !/visits/.test(call.url.pathname)));
    });
    await test('Empty authorized collections produce true zeros with no location-table or history scans', async () => {
        const f = model(); f.rt.switch('empty'); const result = await f.load('empty');
        assert(Object.values(result.statistics).every(metric => metric.status === 'ready' && metric.value === 0));
        assert.equal(f.rt.world.requests.length, 4); assert.equal(result.memberships.length, 0);
    });
    await test('Keyset/count paging passes short server caps without silently truncating metadata', async () => {
        const f = model({ rowCap: 17 });
        for (let n = 100; n < 350; n++) {
            const value = address(`${n} Side St`);
            f.db.personal_places.push({ id: id(n), owner_user_id: 'a', name: 'Cafe', address: value, apple_place_id: null });
            f.db.personal_place_locations.push({ personal_place_id: id(n), address_snapshot: value, resolution_status: 'resolved', standardized_address: value });
        }
        const result = await f.load(); assert.equal(result.statistics.placesSaved.value, 253); assert.equal(result.statistics.citiesExplored.value, 2);
        assert(f.rt.world.requests.some(call => call.url.searchParams.get('id')?.startsWith('gt.')));
        assert(f.rt.world.requests.some(call => call.url.searchParams.getAll('personal_place_id').some(value => value.startsWith('gt.'))));
        assert(f.rt.world.requests.length < 80);
    });
    await test('Row budget, absent count headers and truncated later pages never produce exact subtotals', async () => {
        const f = model(); for (let n = 100; n < 2100; n++) f.db.personal_places.push({ id: id(n), owner_user_id: 'a', name: 'Cafe', address: address(), apple_place_id: null });
        const limited = await f.load(); assert.equal(limited.statistics.placesSaved.status, 'incomplete'); assert.equal(limited.statistics.placesSaved.reason, 'limit'); assert.equal(limited.statistics.placesSaved.value, null);
        assert.equal(limited.statistics.groupsJoined.value, 2);
        const missing = model(); missing.override = call => call.url.pathname.endsWith('/personal_places') ? response([]) : null;
        assert.equal((await missing.load()).statistics.placesSaved.status, 'error');
        const short = model({ rowCap: 1 }); short.override = call => call.url.pathname.endsWith('/personal_places') && call.url.searchParams.has('id') ? response([]) : null;
        const result = await short.load(); assert.equal(result.statistics.placesSaved.value, null); assert.equal(result.statistics.groupsJoined.value, 2);
    });
    await test('Metadata/parent failures discard collective subtotals while preserving a successfully verified membership count', async () => {
        for (const table of ['personal_places', 'group_restaurants', 'restaurants', 'personal_place_locations', 'group_restaurant_locations']) {
            const f = model(); f.override = call => call.url.pathname.endsWith('/' + table) ? fail() : null;
            const result = await f.load(); assert.equal(result.statistics.placesSaved.value, null); assert.equal(result.statistics.citiesExplored.value, null); assert.equal(result.statistics.groupsJoined.value, 2);
        }
        const f = model(); f.db.restaurants = f.db.restaurants.filter(row => row.id !== id(43));
        assert.equal((await f.load()).statistics.placesSaved.value, null);
    });
    await test('Failed/ambiguous and stale address metadata cannot invent a city', async () => {
        for (const state of ['failed', 'ambiguous', 'stale', 'missing']) {
            const f = model(); const row = f.db.personal_place_locations[0];
            if (state === 'missing') f.db.personal_place_locations = [];
            else if (state === 'stale') row.address_snapshot = 'An old address'; else row.resolution_status = state;
            const result = await f.load(); assert.equal(result.statistics.citiesExplored.value, null); assert.equal(result.statistics.citiesExplored.status, 'incomplete');
        }
    });
    await test('Missing membership incarnations fail closed instead of validating an undefined admission', async () => {
        const f = model(); delete f.db.group_memberships[0].membership_id;
        const result = await f.load(); assert.equal(result.memberships, null); assert(Object.values(result.statistics).every(metric => metric.value === null));
    });
    await test('Removal/rejoining mid-read fail closed, then a fresh admission recomputes authorized collections', async () => {
        for (const change of ['remove', 'rejoin']) {
            const f = model(); let changed = false;
            f.override = call => {
                if (!changed && call.url.pathname.endsWith('/restaurants')) {
                    changed = true;
                    if (change === 'remove') f.db.group_memberships = f.db.group_memberships.filter(m => m.user_id !== 'a' || m.group_id !== id(22));
                    else f.db.group_memberships.find(m => m.user_id === 'a' && m.group_id === id(22)).membership_id = id(999);
                }
                return null;
            };
            const before = await f.load(); assert(Object.values(before.statistics).every(metric => metric.value === null));
            f.override = null; const after = await f.load();
            assert.equal(after.statistics.placesSaved.value, change === 'remove' ? 2 : 3);
            assert.equal(after.statistics.groupsJoined.value, change === 'remove' ? 1 : 2);
            if (change === 'rejoin') assert(after.memberships.some(m => m.membershipId === id(999)));
        }
    });
    await test('Opt-in hook revalidates unshown/empty groups using only bounded membership metadata', async () => {
        const f = model({ hook: true });
        for (const n of [24, 25]) { f.db.groups.push({ id: id(n), name: 'Extra group', owner_user_id: 'a' }); f.db.group_memberships.push({ group_id: id(n), user_id: 'a', membership_id: id(n + 100), joined_at: n === 24 ? '2000-01-01' : '2026-10-20' }); }
        const r = f.render(); await r.settle(); assert.equal(f.latest.collectionStatistics.groupsJoined.value, 4);
        const before = f.rt.world.requests.length; f.rt.poll(); await r.settle();
        assert(f.rt.world.requests.slice(before).every(call => /\/(groups|group_memberships)$/.test(call.url.pathname)));
        f.db.group_memberships = f.db.group_memberships.filter(m => m.group_id !== id(24));
        f.rt.poll(); await r.settle(); assert(Object.values(f.latest.collectionStatistics).every(metric => metric.value === null));
        f.latest.refresh(); await r.settle(); assert.equal(f.latest.collectionStatistics.groupsJoined.value, 3); assert.equal(f.latest.collectionStatistics.placesSaved.value, 3);
        r.unmount(); assert.equal(f.rt.world.intervals.size, 0); assert.equal(f.rt.world.lateUpdates, 0);
    });
    await test('Failed access checks cannot retain contributions and overlapping polls are suppressed', async () => {
        const f = model({ hook: true }), r = f.render(); await r.settle();
        const gate = defer(); f.override = call => call.url.pathname.endsWith('/group_memberships') ? gate.promise : null;
        const before = f.rt.world.requests.length; f.rt.poll(); await r.settle(); f.rt.poll(); await r.settle();
        assert.equal(f.rt.world.requests.length - before, 3); gate.resolve(fail()); await r.settle();
        assert(Object.values(f.latest.collectionStatistics).every(metric => metric.value === null));
        const stopped = f.rt.world.requests.length; f.rt.poll(); await r.settle(); assert.equal(f.rt.world.requests.length, stopped);
        r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
    });
    await test('A late inventory result cannot publish an earlier Home group snapshot after revocation', async () => {
        const f = model({ hook: true }), gate = defer();
        let blocked = false;
        f.override = (call, normal) => {
            if (!blocked && call.url.pathname.endsWith('/personal_place_locations')) { blocked = true; return gate.promise.then(normal); }
            return null;
        };
        const r = f.render(); await r.settle(); assert.equal(f.latest.status, 'loading');
        f.db.group_memberships = f.db.group_memberships.filter(m => m.group_id !== id(22));
        gate.resolve(); await r.settle();
        assert.equal(f.latest.groups.status, 'error'); assert.equal(f.latest.groups.data, null);
        assert(Object.values(f.latest.collectionStatistics).every(metric => metric.value === null));
        assert.equal(f.latest.counts.places.data, 2); r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
    });
    await test('Account/background boundaries suppress old collective values and late authorization results', async () => {
        for (const boundary of ['account', 'background', 'blur']) {
            const c = clock(), f = model({ ...c.options, hook: true }), r = f.render(); await r.settle();
            assert.equal(f.latest.collectionStatistics.placesSaved.value, 3);
            const gate = defer(), oldSession = f.rt.world.auth.session, getSession = f.rt.supabase.auth.getSession;
            let stall = true; f.rt.supabase.auth.getSession = () => stall ? gate.promise : getSession();
            f.latest.refresh(); await r.settle();
            if (boundary === 'account') f.rt.switch('b', r);
            else if (boundary === 'blur') { f.rt.world.focused = false; r.dirty = true; }
            else f.rt.emit('background');
            r.draw(); assert(Object.values(f.latest.collectionStatistics).every(metric => metric.value === null));
            stall = false; c.expire(); await r.settle();
            if (boundary === 'account') assert.equal(f.latest.collectionStatistics.placesSaved.value, 1);
            else {
                assert.equal(f.latest.collectionStatistics.placesSaved.value, null);
                if (boundary === 'blur') { f.rt.world.focused = true; r.dirty = true; } else f.rt.emit('active');
                await r.settle(); assert.equal(f.latest.collectionStatistics.placesSaved.value, 3);
            }
            const requests = f.rt.world.requests.length; gate.resolve({ data: { session: oldSession }, error: null }); await r.settle(); assert.equal(f.rt.world.requests.length, requests);
            r.unmount(); assert.equal(f.rt.world.lateUpdates, 0);
        }
    });
    await test('Whole-inventory deadlines cover stalled auth and a later load can recover without late dispatch', async () => {
        const c = clock(), f = model(c.options), gate = defer(), oldSession = f.rt.world.auth.session, getSession = f.rt.supabase.auth.getSession;
        f.rt.supabase.auth.getSession = () => gate.promise;
        const pending = f.load(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.rt.world.requests.length, 0);
        c.expire(); const result = await pending; assert(Object.values(result.statistics).every(metric => metric.value === null));
        gate.resolve({ data: { session: oldSession }, error: null }); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.rt.world.requests.length, 0);
        f.rt.supabase.auth.getSession = getSession; assert.equal((await f.load()).statistics.placesSaved.value, 3);
        const controller = new AbortController(); controller.abort(); await assert.rejects(f.load('a', controller.signal));
    });
    await test('Default Home remains unchanged and does not fetch collection inventory before opt-in', async () => {
        const f = model({ hook: true }), r = f.render(false); await r.settle();
        assert.equal(f.latest.collectionStatistics, null); assert.equal(f.latest.counts.places.data, 2);
        assert(!f.rt.world.requests.some(call => /locations|group_restaurants/.test(call.url.pathname))); r.unmount();
    });
    console.log(`${passed} collection statistics checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
