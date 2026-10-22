// Actual client, coordinator, TSX routes and native adapter. Synthetic HTTP/native
// boundaries only. Database permissions/atomicity have separate SQL assertions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {runtime,fixture,response,screen,click,enter,button,nodes,textOf} = require('./personal-places.cjs');
const ga='22222222-2222-2222-2222-222222222222',gb='33333333-3333-3333-3333-333333333333';
const ma='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',mb='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const entry='55555555-5555-5555-5555-555555555555',vid='66666666-6666-6666-6666-666666666666';
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function storage(){const values=new Map();return {values,failRead:false,failWrite:false,failClear:false,
    async getItem(k){if(this.failRead)throw Error();return values.get(k)??null;},
    async setItem(k,v){if(this.failWrite)throw Error();values.set(k,v);},async removeItem(k){if(this.failClear)throw Error();values.delete(k);}};}
function model(options={}){
    const store=options.storage??storage();let sequence=10;
    const state={override:null,groups:[{id:ga,name:'Dinner',owner_user_id:'a'},{id:gb,name:'Lunch',owner_user_id:'b'}],
        memberships:[{group_id:ga,membership_id:ma},{group_id:gb,membership_id:mb}],cards:[],visits:[],points:[],receipts:new Map()};
    const uuid=()=>`00000000-0000-0000-0000-${String(sequence++).padStart(12,'0')}`;
    function commit(call){
        const a=call.body,kind=a.destination_kind ?? (/\/save_personal_visit(?:_with_mapkit_(?:point|location))?$/.test(call.url.pathname)?'personal':'group'),scope=kind==='personal'?call.user:a.target_group_id;
        if(kind==='group'&&(call.user!=='a'||!state.memberships.some(m=>m.group_id===scope&&m.membership_id===a.expected_membership_id)))return response({code:'42501'},403);
        const key=call.user+':'+a.client_request_id,old=state.receipts.get(key);
        if(old)return old.payload===JSON.stringify(a)?response(old.entry_id):response({code:'22023'},400);
        let card=state.cards.find(c=>c.kind===kind&&c.scope===scope&&c.name===a.restaurant_name&&c.address===a.restaurant_address);
        if(!card){card={id:uuid(),kind,scope,name:a.restaurant_name,address:a.restaurant_address};state.cards.push(card);}
        const visit={id:uuid(),card:card.id,kind,scope,date:a.visit_date,rating:a.visit_rating,again:a.visit_would_go_again,notes:a.visit_notes};state.visits.push(visit);
        if((/_with_mapkit_(?:point|location)$/.test(call.url.pathname)||a.selected_latitude!=null)&&!state.points.some(p=>p.id===card.id))state.points.push({id:card.id,owner_user_id:kind==='personal'?call.user:null,group_id:kind==='group'?scope:null,structured_address:a.selected_address??null,
            name:card.name,address:card.address,latitude:a.selected_latitude,longitude:a.selected_longitude});
        state.receipts.set(key,{payload:JSON.stringify(a),destination_kind:kind,group_id:kind==='group'?scope:null,entry_id:card.id,visit_id:visit.id,available:true});
        return response(card.id);
    }
    const rt=runtime({...options,mocks:{...options.mocks,'@react-native-async-storage/async-storage':{default:store}},fetch:call=>{
        const override=state.override?.(call);if(override)return override;
        const path=call.url.pathname;
        if(path==='/rest/v1/groups')return response(call.user==='a'?state.groups:[]);
        if(path==='/rest/v1/group_memberships')return response(call.user==='a'?state.memberships:[]);
        if(/\/get_recent_add_restaurants(?:_with_mapkit)?$/.test(path))return response(options.recent??[]);
        if(/\/(save_visit_event_destination|save_personal_visit(?:_with_mapkit_(?:point|location))?|save_group_visit_(?:destination|with_mapkit_location))$/.test(path))return commit(call);
        if(path.endsWith('/get_add_destination_result')){const r=state.receipts.get(call.user+':'+call.body.client_request_id);return response(r?[r]:[]);}
        if(path.endsWith('/get_saved_mapkit_location'))return response(state.points.find(p=>p.id===call.body.target_entry_id)??null);
        if(path.endsWith('/get_saved_locations'))return response([]);
        if(path.endsWith('/get_personal_mapkit_locations'))return response(state.points.filter(p=>p.owner_user_id===call.user).slice(call.body.page_offset,call.body.page_offset+call.body.page_size));
        if(path==='/rest/v1/personal_places')return response(fixture({owner_user_id:call.user}));
        if(path==='/rest/v1/personal_visits')return response([]);
        assert.fail('Unexpected request '+path);
    }});
    const api=rt.load('@/lib/unified-add');
    return {rt,state,store,api,commit,async coordinator(){const c=new api.AddCoordinator('a');await c.restore();return c;},
        render(name='add-visit'){return screen(rt,name);}};
}
const fields=()=>({restaurant:{name:' Cafe ',address:' 100 Main Street ',cuisine:null,apple_place_id:'Apple opaque'},
    visited_on:'2026-10-17',rating:4,would_go_again:false,privateNotes:' PRIVATE ',groupNotes:' SHARED '});
const destinations=()=>[{kind:'personal',label:'My Places'},{kind:'group',groupId:ga,membershipId:ma,label:'Dinner'},
    {kind:'group',groupId:gb,membershipId:mb,label:'Lunch'}];
const posts=f=>f.rt.world.requests.filter(c=>/\/(save_visit_event_destination|save_personal_visit(?:_with_mapkit_(?:point|location))?|save_group_visit_(?:destination|with_mapkit_location))$/.test(c.url.pathname));
async function toggle(r,label){const item=nodes(r.output).find(n=>n.props?.accessibilityRole==='checkbox'&&textOf(n.props.children).trim().replace(/^✓ /,'')===label);assert(item,'Missing '+label);item.props.onPress();await r.settle();}
async function fill(r){await enter(r,'Restaurant name','Cafe');await enter(r,'Restaurant address','100 Main Street');await enter(r,'Private notes','PRIVATE');await enter(r,'Group notes','SHARED');}
const nativeRestaurant=(overrides={})=>({id:'1:0',name:'Native Cafe',address:'100 Native Street',placeId:'Native ID',latitude:37,longitude:-122,kind:'business',source:'apple-maps-preview',...overrides});
function nativeSearch(options={}){
    const chosen=[],native={isAvailable:()=>true,complete:async()=>[],resolve:async()=>[],search:async()=>[nativeRestaurant()],reset:async()=>{},cancel:async()=>{},...options};
    const rt=runtime({development:true,platform:'ios',mocks:{expo:{requireOptionalNativeModule:()=>native}}});
    const Component=rt.load('@/components/restaurant-search').RestaurantSearch;
    const r=rt.render(()=>({type:Component,props:{onSelect:value=>chosen.push(value)}}));
    return {rt,r,chosen};
}
const tests=[];function test(category,label,fn){tests.push({category,label,fn});}

test('save','Frozen destination payloads isolate notes, IDs and nullable values; no destinations is rejected',async()=>{
    const f=model({development:true}),input=fields(),ds=destinations(),s=f.api.freezeAddSubmissions('a',input,ds);
    input.restaurant.name='Changed';input.privateNotes='Changed';ds[1].groupId=gb;
    assert(Object.isFrozen(s[0])&&Object.isFrozen(s[0].args)&&Object.isFrozen(s[0].destination));
    assert.equal(s[0].args.visit_notes,'PRIVATE');assert.equal(s[1].args.visit_notes,'SHARED');assert.equal(s[2].args.visit_notes,'SHARED');
    assert(s.every(x=>x.args.visit_would_go_again===false&&x.args.restaurant_name==='Cafe'));
    assert.equal(new Set(s.map(x=>x.args.client_request_id)).size,3);assert.throws(()=>f.api.freezeAddSubmissions('a',fields(),[]));
    assert.throws(()=>f.api.freezeAddSubmissions('a',fields(),[...destinations(),destinations()[0]]));
});
test('save','Existing entry references never propagate from My Places into groups or between groups',async()=>{
    const f=model(),v=fields();v.restaurant={...v.restaurant,destination_kind:'group',group_id:ga,entry_id:entry};
    const s=f.api.freezeAddSubmissions('a',v,destinations());assert.deepEqual(s.map(x=>x.args.target_entry_id),[null,entry,null]);
    assert(s.every(x=>x.args.restaurant_apple_place_id===null));
});
test('save','One action saves personal and multiple independent group visits without leaking private notes',async()=>{
    const f=model(),c=await f.coordinator();await c.start(fields(),destinations(),()=>true);
    assert(c.state.attempts.every(a=>a.status==='saved'));assert.equal(f.state.cards.length,3);assert.equal(f.state.visits.length,3);
    assert.deepEqual(f.state.visits.map(v=>v.notes),['PRIVATE','SHARED','SHARED']);
    const journal=[...f.store.values.values()][0];assert(!journal.includes('PRIVATE')&&!journal.includes('SHARED')&&!journal.includes('fake-a')&&!journal.includes('Apple'));
    await c.sendPending(()=>true);assert.equal(posts(f).length,3);
});
test('save','Fresh intentional repeat visits reuse each destination card and add independent visits',async()=>{
    const f=model(),c=await f.coordinator();for(let i=0;i<2;i++){await c.start(fields(),destinations(),()=>true);await c.clear();}
    assert.equal(f.state.cards.length,3);assert.equal(f.state.visits.length,6);assert.equal(f.state.receipts.size,6);
});
test('save','Partial rejection keeps confirmed successes and retries only the definitively failed destination',async()=>{
    const f=model(),c=await f.coordinator();f.state.override=call=>call.body?.target_group_id===ga?response({code:'42501'},403):null;
    await c.start(fields(),destinations(),()=>true);assert.deepEqual(c.state.attempts.map(a=>a.status),['saved','failed','saved']);
    const failed=c.state.attempts[1],body=posts(f)[1].body;f.state.override=null;await c.sendPending(()=>true,failed.requestId);
    assert.equal(posts(f).length,4);assert.deepEqual(posts(f)[3].body,body);assert.equal(f.state.visits.length,3);
});
for(const committed of [true,false])test('save',`Uncertain ${committed?'committed':'uncommitted'} save is never resent, including after later server rejection`,async()=>{
    const f=model(),c=await f.coordinator();f.state.override=call=>{if(!(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal')))return null;if(committed)f.commit(call);return response({message:'Lost'},503);};
    await c.start(fields(),destinations().slice(0,1),()=>true);assert.equal(c.state.attempts[0].status,'uncertain');
    await c.sendPending(()=>true,c.state.attempts[0].requestId);assert.equal(posts(f).length,1);
    f.state.override=null;await c.reconcile(()=>true);assert.equal(c.state.attempts[0].status,committed?'saved':'uncertain');assert.equal(posts(f).length,1);
});
test('save','A local exception with a database-looking error code is uncertain',async()=>{
    const f=model(),c=await f.coordinator();f.state.override=call=>{if((call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal')))throw Object.assign(new Error('local'),{code:'42501'});};
    await c.start(fields(),destinations().slice(0,1),()=>true);assert.equal(c.state.attempts[0].status,'uncertain');
});
test('save','Recovery markers restore after process loss using reads only, and missing/deleted/revoked results never recreate visits',async()=>{
    const f=model(),c=await f.coordinator();await c.start(fields(),destinations(),()=>true);c.dispose();
    const restored=await f.coordinator();assert(restored.state.attempts.every(a=>a.status==='uncertain'&&!a.submission));
    const receipt=[...f.state.receipts.values()][0];receipt.available=false;await restored.reconcile(()=>true);
    assert(restored.state.attempts.every(a=>a.status==='saved'));assert.equal(restored.state.attempts[0].result.available,false);
    await restored.sendPending(()=>true);assert.equal(posts(f).length,3);
});
test('save','Recovery reader pins accounts and rejects malformed results without unlocking an uncertain submission',async()=>{
    const f=model(),c=await f.coordinator();f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?response({},503):null;
    await c.start(fields(),destinations().slice(0,1),()=>true);
    f.state.override=call=>call.url.pathname.endsWith('/get_add_destination_result')?response([{destination_kind:'group',group_id:gb,entry_id:entry,visit_id:vid,available:true}]):null;
    await c.reconcile(()=>true);assert.equal(c.state.attempts[0].status,'uncertain');
    f.rt.switch('b');await c.reconcile(()=>true);assert.equal(c.state.attempts[0].status,'uncertain');assert.equal(posts(f).length,1);
});
test('save','Journal failures dispatch nothing; corrupt recovery fails closed and explicit clearing never mutates the server',async()=>{
    const f=model(),c=await f.coordinator();f.store.failWrite=true;await c.start(fields(),destinations(),()=>true);assert.equal(posts(f).length,0);assert(c.state.error);
    f.store.failWrite=false;await c.clear();f.store.values.set('groupbite:add-recovery:v1:a','bad JSON');const restored=await f.coordinator();
    assert(restored.state.error);await restored.start(fields(),destinations(),()=>true);assert.equal(posts(f).length,0);await restored.clear();assert.equal(posts(f).length,0);
});
test('save','Concurrent taps share one submission; backgrounding stops undispatched destinations',async()=>{
    const f=model(),c=await f.coordinator(),gate=defer();let visible=true;f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?gate.promise:null;
    const pending=c.start(fields(),destinations(),()=>visible);await new Promise(r=>setImmediate(r));await c.start(fields(),destinations(),()=>true);assert.equal(posts(f).length,1);
    visible=false;gate.resolve(f.commit(posts(f)[0]));await pending;assert.deepEqual(c.state.attempts.map(a=>a.status),['saved','pending','pending']);
    f.state.override=null;visible=true;await c.sendPending(()=>visible);assert.equal(posts(f).length,3);
});
test('save','Database migration encloses legacy group save and immutable receipt in one transaction without catching/committing intermediate errors',async()=>{
    const sql=fs.readFileSync('supabase/migrations/20261017001600_unified_add_destinations.sql','utf8');
    assert(sql.indexOf('perform public.save_restaurant_visit_with_apple_place_id')<sql.indexOf('insert into public.add_destination_requests'));
    assert(!/exception\s+when|\bcommit\b/i.test(sql.slice(sql.indexOf('create function'),sql.indexOf('create function public.get_add'))));
    assert(sql.includes('for update')&&sql.includes('m.membership_id = expected_membership_id'));
    const personal=fs.readFileSync('supabase/migrations/20261017001500_personal_visit_history.sql','utf8');
    assert(personal.includes('enable row level security'));assert(personal.includes('owner_user_id = (select auth.uid())'));
    assert(personal.includes('on delete cascade'));assert(personal.includes('revoke insert (name,address'));
});

test('draft','All destinations begin unchecked, including a group entry point; date defaults locally and clears',async()=>{
    const f=model();f.rt.world.params={groupId:ga};const r=f.render();await r.settle();
    assert(nodes(r.output).filter(n=>n.props?.accessibilityRole==='checkbox').every(n=>!n.props.accessibilityState.checked));
    assert(button(r,'Save Visit').props.disabled);const date=nodes(r.output).find(n=>n.props?.accessibilityLabel==='Visit date');
    assert.equal(date.props.value,f.rt.load('@/components/unified-add-form').localToday());await enter(r,'Visit date','');assert.equal(nodes(r.output).find(n=>n.props?.accessibilityLabel==='Visit date').props.value,'');r.unmount();
});
test('draft','Draft and independent notes survive background while private UI and late callbacks are hidden',async()=>{
    const f=model(),r=f.render();await r.settle();await fill(r);await toggle(r,'My Places');
    f.rt.emit('inactive');f.rt.emit('background');await r.settle();assert(!textOf(r.output).includes('PRIVATE'));
    f.rt.emit('active');await r.settle();assert.equal(nodes(r.output).find(n=>n.props?.accessibilityLabel==='Private notes').props.value,'PRIVATE');
    assert.equal(nodes(r.output).find(n=>n.props?.accessibilityLabel==='Group notes').props.value,'SHARED');
    assert(nodes(r.output).find(n=>n.props?.accessibilityRole==='checkbox').props.accessibilityState.checked);r.unmount();
});
test('draft','Dirty Back and swipe offer Stay/Discard, and active saving blocks abandonment',async()=>{
    const f=model(),r=f.render();await r.settle();await fill(r);assert(f.rt.attemptRemoval({type:'POP'}));await r.settle();await click(r,'Stay');
    await toggle(r,'My Places');const gate=defer();f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?gate.promise:null;
    const pending=button(r,'Save Visit').props.onPress();await r.settle();assert(f.rt.attemptRemoval({type:'POP'}));await r.settle();
    assert(textOf(r.output).includes('Save in progress'));assert(!nodes(r.output).some(n=>n.type==='Pressable'&&textOf(n.props.children)==='Discard'));
    gate.resolve(response({},503));await pending;await r.settle();r.unmount();
});
test('draft','Account replacement and stale submit handlers cannot send or navigate a previous account draft',async()=>{
    for(const phase of ['preflight','dispatched']){
        const f=model(),r=f.render();await r.settle();await fill(r);await toggle(r,'My Places');const gate=defer();
        if(phase==='preflight')f.rt.supabase.auth.getSession=()=>gate.promise;
        else f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?gate.promise:null;
        const save=button(r,'Save Visit').props.onPress,pending=save();await r.settle();f.rt.switch('b',r);await r.settle();
        gate.resolve(phase==='preflight'?{data:{session:f.rt.world.auth.session},error:null}:response(entry));await pending;await r.settle();await save();
        assert.equal(posts(f).length,phase==='preflight'?0:1);assert.equal(f.rt.world.navigation.length,0);assert.equal(f.rt.world.lateUpdates,0);r.unmount();
    }
});
test('draft','Confirmed background saves remain reviewable without automatic navigation or a second mutation',async()=>{
    const f=model(),r=f.render();await r.settle();await fill(r);await toggle(r,'My Places');const gate=defer();
    f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?gate.promise:null;const save=button(r,'Save Visit').props.onPress,pending=save();await r.settle();
    f.rt.emit('inactive');f.rt.emit('active');await r.settle();gate.resolve(f.commit(posts(f)[0]));await pending;await r.settle();
    assert.equal(f.rt.world.navigation.length,0);assert(textOf(r.output).includes('Confirmed saved'));await save();assert.equal(posts(f).length,1);r.unmount();
});
test('draft','Revoked or replaced membership is removed on refresh without selecting a replacement admission',async()=>{
    const f=model(),r=f.render();await r.settle();await toggle(r,'Dinner');f.state.memberships[0].membership_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await click(r,'Refresh Destinations');assert(!nodes(r.output).find(n=>n.props?.accessibilityRole==='checkbox'&&textOf(n.props.children).trim()==='Dinner').props.accessibilityState.checked);r.unmount();
});

test('personal','Personal RPC cutover changes restaurant facts without including or overwriting visit fields',async()=>{
    const rt=runtime();rt.world.rows=[fixture()];const api=rt.load('@/lib/personal-places');
    await api.updatePersonalPlace('a',fixture(),fixture({name:'Updated',notes:'Do not copy'}));
    const call=rt.world.requests.find(c=>c.url.pathname.endsWith('/update_personal_place'));assert.equal(call.body.expected_revision,1);
    assert(!('visit_notes'in call.body)&&!('notes'in call.body));assert.equal(rt.world.rows[0].notes,'Private memory');
});
test('personal','Personal history reads are owner/parent-scoped and preserve false and missing optional values',async()=>{
    const rt=runtime();rt.world.visits=[{id:vid,owner_user_id:'a',personal_place_id:entry,rating:null,visited_on:null,would_go_again:false,notes:null}];
    const rows=await rt.load('@/lib/personal-visits').listPersonalVisits('a',entry);assert.equal(rows[0].would_go_again,false);
    rt.switch('b');await assert.rejects(()=>rt.load('@/lib/personal-visits').listPersonalVisits('a',entry));assert.equal(rt.world.requests.length,1);
});
test('personal','Whole-card deletion uses the original revision and never retries a possibly committed delete',async()=>{
    const rt=runtime();rt.world.rows=[fixture({revision:2})];const api=rt.load('@/lib/personal-places');
    await assert.rejects(()=>api.deletePersonalPlace('a',fixture()));assert.equal(rt.world.rows.length,1);
    rt.world.override=call=>call.url.pathname.endsWith('/delete_personal_place')?response({},503):null;
    await assert.rejects(()=>api.deletePersonalPlace('a',fixture({revision:2})));assert.equal(rt.world.requests.length,2);
});
test('personal','Personal visit edits validate before HTTP, carry original revision and never mutate another destination',async()=>{
    const rt=runtime({fetch:call=>{assert.equal(call.url.pathname,'/rest/v1/rpc/manage_personal_visit');return response([{id:vid}]);}});
    const api=rt.load('@/lib/personal-visits'),visit={id:vid,personal_place_id:entry,revision:3};
    await assert.rejects(()=>api.managePersonalVisit('a',visit,{visited_on:'2026-02-30',rating:1,would_go_again:false,notes:null},false,()=>true));assert.equal(rt.world.requests.length,0);
    await api.managePersonalVisit('a',visit,{visited_on:null,rating:null,would_go_again:false,notes:'private'},false,()=>true);
    assert.equal(rt.world.requests[0].body.expected_revision,3);assert.equal(rt.world.requests[0].body.visit_would_go_again,false);assert(!('target_group_id'in rt.world.requests[0].body));
});
test('personal','Personal detail renders independent history and routes edit/delete by visit ID',async()=>{
    const rt=runtime();rt.world.rows=[fixture()];rt.world.visits=[{id:vid,personal_place_id:fixture().id,owner_user_id:'a',visited_on:null,rating:5,would_go_again:false,notes:'Private first',origin:'legacy',revision:1}];
    const r=screen(rt,'personal-place/[id]');rt.world.params={id:fixture().id};r.dirty=true;await r.settle();assert(textOf(r.output).includes('Personal visit history ( 1 )'));
    await click(r,'Edit Visit');assert.equal(rt.world.navigation.at(-1).params.visitId,vid);await click(r,'Delete Visit');assert.equal(rt.world.navigation.at(-1).params.action,'delete');r.unmount();
});

test('search','Debug restaurant search resolves cached native suggestions without resetting them and selects full identity',async()=>{
    let cached=false,chosen=null;const native={isAvailable:()=>true,
        complete:async(q,m,id)=>{cached=true;return [{id:id+':0',title:'Cafe',subtitle:'100 Main Street'}];},
        resolve:async(s,id)=>{assert(cached,'Native cached completions must survive selection');return [{id:id+':0',name:'Cafe',address:'100 Main Street',placeId:'Native ID',latitude:37,longitude:-122,kind:'business',source:'apple-maps-preview'}];},
        search:async()=>[],reset:async()=>{cached=false;},cancel:async()=>{}};
    const rt=runtime({development:true,platform:'ios',mocks:{expo:{requireOptionalNativeModule:()=>native}}});const Component=rt.load('@/components/restaurant-search').RestaurantSearch;
    const r=rt.render(()=>({type:Component,props:{onSelect:value=>chosen=value}}));await r.settle();await enter(r,'Search restaurants','Cafe');await new Promise(resolve=>setTimeout(resolve,420));await r.settle();
    await click(r,'Cafe 100 Main Street');await click(r,'Choose restaurant: Cafe, 100 Main Street');assert.equal(chosen.apple_place_id,'Native ID');assert.equal(chosen.name,'Cafe');assert(!('latitude'in chosen));r.unmount();
});
test('search','Unavailable/Expo Go/release builds explain native restriction and retain manual/recent entry',async()=>{
    for(const options of [{development:false},{development:true,platform:'ios'},{development:true,platform:'android'}]){
        const f=model(options),r=f.render('add');await r.settle();assert(button(r,'Enter Restaurant Manually'));assert(!nodes(r.output).some(n=>n.props?.accessibilityLabel==='Search restaurants'));
        if(options.development)assert(textOf(r.output).includes('debug development build'));r.unmount();
    }
});
test('search','Recent selection copies identity without notes or destination checkboxes',async()=>{
    const recent={name:'Saved Cafe',address:'100 Main Street',cuisine:null,destination_kind:'personal',group_id:null,entry_id:entry};
    const f=model({recent:[recent]}),r=f.render('add');await r.settle();await click(r,'Saved Cafe 100 Main Street');assert.equal(f.rt.world.navigation.at(-1),'/add-visit');r.unmount();
    // The form has no default selections even when the identity is provided.
    const g=model();g.rt.world.params={personalId:fixture().id};const form=g.render();await form.settle();assert(nodes(form.output).filter(n=>n.props?.accessibilityRole==='checkbox').every(n=>!n.props.accessibilityState.checked));form.unmount();
});

test('navigation','Single-destination saves remove completed forms and open exact personal/group entry IDs',async()=>{
    const {history}=await require('./router-fixture.cjs')();
    for(const destination of ['My Places','Dinner']){
        const h=history('/add');h.router.push('/add-visit');const f=model({router:h.router}),r=f.render();await r.settle();await fill(r);await toggle(r,destination);await click(r,'Save Visit');
        assert(!h.allNames().includes('add-visit'));assert.equal(h.current().name,destination==='My Places'?'personal-place/[id]':'group/[id]/restaurant/[entryId]');
        assert.equal(h.current().params[destination==='My Places'?'id':'entryId'],f.state.cards[0].id);r.unmount();
    }
});
test('navigation','Add Another Visit returns to its Home/map detail only for the original destination, without finished forms',async()=>{
    const {history}=await require('./router-fixture.cjs')();
    for(const origin of ['home','map'])for(const destination of ['My Places','Dinner']) {
        const h=history(origin==='home'?'/':'/saved-map');
        const detail={pathname:'/'+origin+'/personal-place/[id]',params:{id:fixture().id}};h.router.push(detail);const detailKey=h.current().key;
        const params={personalId:fixture().id,[origin==='home'?'fromHome':'fromMap']:'1'};
        h.router.push({pathname:'/add-visit',params});const f=model({router:h.router});f.rt.world.params=params;
        f.state.cards.push({id:fixture().id,kind:'personal',scope:'a',name:fixture().name,address:fixture().address});
        const r=f.render();await r.settle();await toggle(r,destination);await click(r,'Save Visit');
        assert.equal(posts(f).length,1);assert(!h.allNames().includes('add-visit'));
        if(destination==='My Places') {assert.equal(h.current().key,detailKey);h.router.back();assert.equal(h.current().name,origin==='home'?'index':'saved-map');}
        else {assert.equal(h.chain()[2].name,'(groups)');assert.equal(h.current().name,'group/[id]/restaurant/[entryId]');}
        r.unmount();
    }
});
test('navigation','Group Add Another Visit retains Home/map history without borrowing a different group destination',async()=>{
    const {history}=await require('./router-fixture.cjs')();
    for(const origin of ['home','map'])for(const destination of ['Dinner','Lunch']) {
        const h=history(origin==='home'?'/':'/saved-map');
        h.router.push({pathname:'/'+origin+'/group/[id]/restaurant/[entryId]',params:{id:ga,entryId:entry}});const previous=h.current().key;
        const params={groupId:ga,restaurantId:entry,[origin==='home'?'fromHome':'fromMap']:'1'};
        h.router.push({pathname:'/add-visit',params});const f=model({router:h.router});f.rt.world.params=params;
        f.state.cards.push({id:entry,kind:'group',scope:ga,name:'Cafe',address:'100 Main Street'});
        f.state.override=call=>call.url.pathname==='/rest/v1/group_restaurants'?response({id:entry,restaurant_id:entry,apple_place_id:null})
            :call.url.pathname==='/rest/v1/restaurants'?response({id:entry,name:'Cafe',address:'100 Main Street',cuisine:null}):null;
        const r=f.render();await r.settle();await toggle(r,destination);await click(r,'Save Visit');assert.equal(posts(f).length,1);assert(!h.allNames().includes('add-visit'));
        if(destination==='Dinner')assert.equal(h.current().key,previous);
        else {assert.equal(h.chain()[2].name,'(groups)');assert.equal(h.current().params.id,gb);}
        r.unmount();
    }
});
test('navigation','Multiple destinations replace the completed form with the Add summary',async()=>{
    const {history}=await require('./router-fixture.cjs')(),h=history('/add');h.router.push('/add-visit');const f=model({router:h.router}),r=f.render();
    await r.settle();await fill(r);await toggle(r,'My Places');await toggle(r,'Dinner');await toggle(r,'Lunch');await click(r,'Save Visit');
    assert(!h.allNames().includes('add-visit'));assert.equal(h.chain()[2].name,'add');assert.equal(h.current().name,'index');assert.equal(f.state.visits.length,3);r.unmount();
});
function deadlines(){const pending=new Set();return {setTimeout(fn,ms){if(ms!==20000)return setTimeout(fn,ms);const timer={fn};pending.add(timer);return timer;},
    clearTimeout(timer){if(!pending.delete(timer))clearTimeout(timer);},expire(){const timers=[...pending];assert(timers.length);pending.clear();timers.forEach(t=>t.fn());}};}
test('save','A stalled dispatched save becomes uncertain, ignores late success, and reconciles without replay',async()=>{
    const time=deadlines(),f=model(time),c=await f.coordinator(),gate=defer();f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?gate.promise:null;
    const pending=c.start(fields(),destinations().slice(0,1),()=>true);await new Promise(r=>setImmediate(r));assert.equal(posts(f).length,1);
    time.expire();await pending;assert.equal(c.state.busy,false);assert.equal(c.state.attempts[0].status,'uncertain');
    gate.resolve(f.commit(posts(f)[0]));await new Promise(r=>setImmediate(r));assert.equal(c.state.attempts[0].status,'uncertain');
    f.state.override=null;await c.reconcile(()=>true);assert.equal(c.state.attempts[0].status,'saved');assert.equal(posts(f).length,1);
});
test('save','A timed-out journal write cannot overwrite a later clear or permit an unjournaled mutation',async()=>{
    const time=deadlines(),store=storage(),gate=defer(),write=store.setItem.bind(store);
    store.setItem=async(k,v)=>{await gate.promise;await write(k,v);};const f=model({...time,storage:store}),c=await f.coordinator();
    const pending=c.start(fields(),destinations(),()=>true);await new Promise(r=>setImmediate(r));time.expire();await pending;
    assert.equal(posts(f).length,0);assert(c.state.error);const clear=c.clear();await new Promise(r=>setImmediate(r));time.expire();assert.equal(await clear,false);
    gate.resolve();await new Promise(r=>setImmediate(r));assert.equal(store.values.size,0);assert.equal(await c.clear(),true);assert.equal(posts(f).length,0);
});
test('draft','Leaving unresolved recovery warns and preserves every marker without a mutation',async()=>{
    const store=storage();store.values.set('groupbite:add-recovery:v1:a',JSON.stringify([{requestId:'restored-1',kind:'personal'}]));
    const f=model({storage:store}),r=f.render('add');await r.settle();assert(textOf(r.output).includes('Uncertain'));
    await click(r,'Finish Reviewing');assert(textOf(r.output).includes('does not undo'));await click(r,'Stay');assert.equal(store.values.size,1);
    await click(r,'Finish Reviewing');await click(r,'Leave Anyway');assert.equal(f.rt.world.navigation.at(-1),'/');assert.equal(posts(f).length,0);assert.equal(store.values.size,1);assert(textOf(r.output).includes('Uncertain'));r.unmount();
});
test('personal','Actual personal visit editor reconciles lost committed edits/deletes read-only across backgrounding',async()=>{
    for(const action of ['edit','delete']){
        let v={id:vid,personal_place_id:fixture().id,owner_user_id:'a',revision:1,origin:'visit',visited_on:null,rating:null,would_go_again:false,notes:'Before'},writes=0;
        const rt=runtime({fetch:call=>{
            if(call.url.pathname==='/rest/v1/personal_places')return response(fixture());
            if(call.url.pathname==='/rest/v1/personal_visits')return response(v?[v]:[]);
            if(call.url.pathname.endsWith('/manage_personal_visit')){writes++;const b=call.body;if(action==='delete')v=null;else v={...v,notes:b.visit_notes,revision:2};return response({},503);}
            assert.fail(call.url.pathname);
        }});rt.world.params={id:fixture().id,visitId:vid,action};const r=screen(rt,'personal-visit-form');await r.settle();
        if(action==='edit')await enter(r,'Private notes','After');const save=button(r,action==='edit'?'Save Changes':'Confirm Delete Visit').props.onPress;
        await save();await r.settle();assert(button(r,'Check Saved Visit'));rt.emit('inactive');rt.emit('active');await r.settle();
        await save();assert.equal(writes,1);await click(r,'Check Saved Visit');assert.equal(writes,1);assert.equal(rt.world.navigation.at(-1).pathname,'/personal-place/[id]');r.unmount();
    }
});
test('personal','Personal facts editing keeps visit memories out of the form and blocks stale revisions after revalidation',async()=>{
    const rt=runtime();rt.world.rows=[fixture()];rt.world.params={id:fixture().id};const r=screen(rt,'personal-place-form');await r.settle();
    assert(!nodes(r.output).some(n=>n.props?.accessibilityLabel==='Private notes'||n.props?.accessibilityLabel==='Visit date'));
    await enter(r,'Restaurant name','Retained facts');rt.emit('background');await r.settle();rt.world.rows[0].revision=2;rt.emit('active');await r.settle();
    assert(button(r,'Save Changes').props.disabled);assert.equal(nodes(r.output).find(n=>n.props?.accessibilityLabel==='Restaurant name').props.value,'Retained facts');r.unmount();
});
test('navigation','Completed form callbacks cannot resubmit after destination navigation and journal clearing',async()=>{
    const f=model(),r=f.render();await r.settle();await fill(r);await toggle(r,'My Places');const save=button(r,'Save Visit').props.onPress;
    await save();await r.settle();await save();assert.equal(posts(f).length,1);assert.equal(f.rt.world.navigation.at(-1).pathname,'/personal-place/[id]');r.unmount();
});
test('draft','Visit rating and would-go-again controls independently select and clear without changing either note scope',async()=>{
    const f=model(),r=f.render();await r.settle();await fill(r);await toggle(r,'My Places');await click(r,'4');await click(r,'No');
    await click(r,'4');await click(r,'No');await click(r,'Save Visit');assert.equal(posts(f)[0].body.visit_rating,null);assert.equal(posts(f)[0].body.visit_would_go_again,null);
    assert.equal(posts(f)[0].body.visit_notes,'PRIVATE');assert(!JSON.stringify(posts(f)[0].body).includes('SHARED'));r.unmount();
});
test('save','Mixed uncertain group outcome preserves other successes and never resends any destination during reconciliation',async()=>{
    const f=model(),c=await f.coordinator();f.state.override=call=>{
        if((call.url.pathname.endsWith('/save_group_visit_destination') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'group'))&&call.body.target_group_id===ga){f.commit(call);return response({},503);}return null;
    };
    await c.start(fields(),destinations(),()=>true);assert.deepEqual(c.state.attempts.map(a=>a.status),['saved','uncertain','saved']);
    f.state.override=null;await c.reconcile(()=>true);assert(c.state.attempts.every(a=>a.status==='saved'));assert.equal(posts(f).length,3);assert.equal(f.state.visits.length,3);
});
test('save','Retrying a failed destination does not also dispatch paused destinations',async()=>{
    const f=model(),c=await f.coordinator(),gate=defer();let visible=true;
    f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?gate.promise:null;
    const pending=c.start(fields(),destinations(),()=>visible);await new Promise(r=>setImmediate(r));visible=false;gate.resolve(response({code:'23514'},400));await pending;
    assert.deepEqual(c.state.attempts.map(a=>a.status),['failed','pending','pending']);visible=true;f.state.override=null;await c.sendPending(()=>visible,c.state.attempts[0].requestId);
    assert.deepEqual(c.state.attempts.map(a=>a.status),['saved','pending','pending']);assert.equal(posts(f).length,2);
});
test('navigation','Restored multiple successes list destination links and Done clears recovery without keeping a form',async()=>{
    const store=storage();store.values.set('groupbite:add-recovery:v1:a',JSON.stringify([{requestId:'summary-personal',kind:'personal'},{requestId:'summary-group',kind:'group',groupId:ga}]));
    const f=model({storage:store});f.state.receipts.set('a:summary-personal',{destination_kind:'personal',group_id:null,entry_id:entry,visit_id:vid,available:true});
    f.state.receipts.set('a:summary-group',{destination_kind:'group',group_id:ga,entry_id:vid,visit_id:entry,available:true});
    const r=f.render('add');await r.settle();await click(r,'Check Saved Results');assert(button(r,'Open My Places'));assert(button(r,'Open Dinner'));
    await click(r,'Open Dinner');assert.equal(f.rt.world.navigation.at(-1).params.entryId,vid);await click(r,'Done');assert(button(r,'Enter Restaurant Manually'));assert.equal(store.values.size,0);assert.equal(posts(f).length,0);r.unmount();
});
test('draft','Back and repeated submit callbacks before React rerenders cannot leave or duplicate an active save',async()=>{
    const f=model(),r=f.render();await r.settle();await fill(r);await toggle(r,'My Places');const gate=defer();
    f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?gate.promise:null;
    const save=button(r,'Save Visit').props.onPress,back=button(r,'Back').props.onPress;
    const first=save();await save();back();assert.equal(f.rt.world.navigation.length,0);await r.settle();assert.equal(posts(f).length,1);
    gate.resolve(f.commit(posts(f)[0]));await first;await r.settle();assert.equal(posts(f).length,1);assert.equal(f.rt.world.navigation.length,1);r.unmount();
});
test('save','Unified validation retains Unicode limits, real dates and private-field checks before any request',async()=>{
    const f=model(),valid=fields();
    for(const change of [{name:''},{name:'x'.repeat(101)},{address:''},{address:'x'.repeat(301)},{cuisine:'x'.repeat(101)}]){
        assert.throws(()=>f.api.freezeAddSubmissions('a',{...valid,restaurant:{...valid.restaurant,...change}},destinations()));
    }
    for(const change of [{visited_on:'2026-02-30'},{visited_on:'0000-01-01'},{rating:1.5},{rating:0},{rating:6},{would_go_again:'false'},{privateNotes:'x'.repeat(4001)},{groupNotes:'x'.repeat(4001)}]){
        assert.throws(()=>f.api.freezeAddSubmissions('a',{...valid,...change},destinations()));
    }
    const s=f.api.freezeAddSubmissions('a',{...valid,restaurant:{...valid.restaurant,name:'🍕'.repeat(100)},visited_on:'2024-02-29'},destinations());
    assert.equal(s[0].args.restaurant_name,'🍕'.repeat(100));assert.equal(f.rt.world.requests.length,0);
});
test('save','Invalid opaque IDs fail closed; native coordinates and extra row metadata never enter save payloads',async()=>{
    const f=model({development:true,platform:'ios'}),v=fields();
    for(const id of ['', ' padded','padded\u00a0','x'.repeat(301),'private\u0000id','private\u0085id',123,{}]){
        assert.throws(()=>f.api.freezeAddSubmissions('a',{...v,restaurant:{...v.restaurant,apple_place_id:id}},destinations()));
    }
    const s=f.api.freezeAddSubmissions('a',{...v,restaurant:{...v.restaurant,latitude:37,longitude:-122,owner_user_id:'b',revision:99}},destinations());
    assert(s.every(a=>!('latitude'in a.args)&&!('longitude'in a.args)&&!('owner_user_id'in a.args)&&!('revision'in a.args)));
    assert.equal(f.rt.world.requests.length,0);
});

test('save','Navigation completion refuses busy, partial, pending and uncertain recovery; reconciliation can unlock completion',async()=>{
    for(const outcome of ['failed','uncertain','pending']){
        const f=model(),c=await f.coordinator();let active=true;
        f.state.override=call=>{
            if(call.body?.target_group_id!==ga)return null;
            if(outcome==='pending'){active=false;return null;}
            return response({},outcome==='failed'?403:503);
        };
        // Use a definitive permission error for the failed destination.
        if(outcome==='failed')f.state.override=call=>call.body?.target_group_id===ga?response({code:'42501'},403):null;
        await c.start(fields(),destinations(),()=>active);
        const before=JSON.stringify(c.state.attempts),journal=[...f.store.values],sent=posts(f).length;
        assert.equal(await c.clearConfirmed(),false);assert.equal(JSON.stringify(c.state.attempts),before);assert.deepEqual([...f.store.values],journal);assert.equal(posts(f).length,sent);
    }
    const f=model(),c=await f.coordinator(),gate=defer();f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?gate.promise:null;
    const saving=c.start(fields(),destinations().slice(0,1),()=>true);await new Promise(r=>setImmediate(r));
    assert.equal(await c.clearConfirmed(),false);assert.equal(f.store.values.size,1);
    gate.resolve(response({},503));await saving;assert.equal(await c.clearConfirmed(),false);
    f.state.receipts.set('a:'+c.state.attempts[0].requestId,{destination_kind:'personal',group_id:null,entry_id:entry,visit_id:vid,available:true});f.state.override=null;
    await c.reconcile(()=>true);assert.equal(await c.clearConfirmed(),true);assert.equal(f.store.values.size,0);assert.equal(posts(f).length,1);
});
test('save','Failed journal removal retains confirmed results and blocks a navigation reset',async()=>{
    const f=model(),c=await f.coordinator();await c.start(fields(),destinations(),()=>true);f.store.failClear=true;
    assert.equal(await c.clearConfirmed(),false);assert.equal(c.state.attempts.length,3);assert(c.state.error);assert.equal(f.store.values.size,1);
    assert.equal(await c.clearConfirmed(),false);assert.equal(posts(f).length,3);
    f.store.failClear=false;assert.equal(await c.clearConfirmed(),true);assert.equal(f.store.values.size,0);
});

function summaryModel(options={}){
    const store=storage();store.values.set('groupbite:add-recovery:v1:a',JSON.stringify([{requestId:'summary-personal',kind:'personal'},{requestId:'summary-group',kind:'group',groupId:ga}]));
    const f=model({...options,storage:store});
    f.state.receipts.set('a:summary-personal',{destination_kind:'personal',group_id:null,entry_id:entry,visit_id:vid,available:true});
    f.state.receipts.set('a:summary-group',{destination_kind:'group',group_id:ga,entry_id:vid,visit_id:entry,available:true});
    return f;
}
test('navigation','Done clears a confirmed summary and the next visit starts with a fresh restaurant, fields and unchecked destinations',async()=>{
    const {history}=await require('./router-fixture.cjs')(),h=history('/add'),f=summaryModel({router:h.router});let route='add';
    const r=f.rt.render(()=>({type:f.rt.load('app/'+route).default,props:{}}));await r.settle();await click(r,'Check Saved Results');
    const staleOpen=button(r,'Open Dinner').props.onPress;await click(r,'Done');assert(button(r,'Enter Restaurant Manually'));assert.equal(f.store.values.size,0);
    staleOpen();assert.equal(h.current().name,'index');await click(r,'Enter Restaurant Manually');route='add-visit';r.dirty=true;await r.settle();
    for(const name of ['Restaurant name','Restaurant address','Private notes','Group notes'])assert.equal(nodes(r.output).find(n=>n.props?.accessibilityLabel===name).props.value,'');
    assert(nodes(r.output).filter(n=>n.props?.accessibilityRole==='checkbox').every(n=>!n.props.accessibilityState.checked));assert.equal(posts(f).length,0);r.unmount();
});
test('navigation','Done on an in-place confirmed form clears its journal and removes the completed form',async()=>{
    const {history}=await require('./router-fixture.cjs')(),h=history('/add');h.router.push('/add-visit');const f=model({router:h.router}),r=f.render();
    await r.settle();await fill(r);await toggle(r,'My Places');await toggle(r,'Dinner');const gate=defer();
    f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?gate.promise:null;
    const saving=button(r,'Save Visit').props.onPress();await r.settle();f.rt.emit('inactive');f.rt.emit('active');await r.settle();
    gate.resolve(f.commit(posts(f)[0]));await saving;await r.settle();f.state.override=null;await click(r,'Continue Unsent Destinations');await click(r,'Done');
    assert.equal(f.store.values.size,0);assert(!h.allNames().includes('add-visit'));assert.equal(h.current().name,'index');assert.equal(f.state.visits.length,2);r.unmount();
});
test('navigation','Add tab resets completed results after leaving or reselecting a result-opened detail',async()=>{
    const {history}=await require('./router-fixture.cjs')();
    for(const detail of [false,true]){
        const h=history('/add'),f=summaryModel({router:h.router,navigation:{getState:h.tabState,dispatch:h.dispatch}});
        f.rt.world.tabsScreen=f.rt.load('app/add').default;const r=f.render('(app)/(tabs)/_layout');await r.settle();await click(r,'Check Saved Results');
        if(detail)await click(r,'Open Dinner');else h.select('(home)');
        const tabs=nodes(r.output).find(n=>n.type==='Tabs'),route=h.tabState().routes.find(r=>r.name==='add');let prevented=false;
        tabs.props.screenListeners({navigation:{getState:h.tabState,dispatch:h.dispatch},route}).tabPress({preventDefault(){prevented=true;}});await r.settle();
        assert(prevented);assert.equal(h.chain()[2].name,'add');assert.equal(h.current().name,'index');assert(button(r,'Enter Restaurant Manually'));
        assert.equal(f.store.values.size,0);assert.equal(posts(f).length,0);r.unmount();
    }
});
test('navigation','Add tab preserves partially reconciled recovery and uses the existing leave confirmation',async()=>{
    const {history}=await require('./router-fixture.cjs')(),h=history('/add'),f=summaryModel({router:h.router,navigation:{getState:h.tabState,dispatch:h.dispatch}});
    f.state.receipts.delete('a:summary-group');f.rt.world.tabsScreen=f.rt.load('app/add').default;const r=f.render('(app)/(tabs)/_layout');await r.settle();await click(r,'Check Saved Results');
    const tabs=nodes(r.output).find(n=>n.type==='Tabs'),route=h.tabState().routes.find(r=>r.name==='add');let prevented=false;
    tabs.props.screenListeners({navigation:{getState:h.tabState,dispatch:h.dispatch},route}).tabPress({preventDefault(){prevented=true;}});await r.settle();
    assert(prevented);assert(textOf(r.output).includes('Review this save before leaving'));await click(r,'Leave Anyway');
    assert(button(r,'Open My Places'));assert(textOf(r.output).includes('Uncertain'));assert.equal(f.store.values.size,1);assert.equal(posts(f).length,0);r.unmount();
});
test('navigation','Summary destination links push exact IDs inside Add with the summary as their native Back anchor',async()=>{
    const {history}=await require('./router-fixture.cjs')();
    for(const destination of ['My Places','Dinner']){
        const h=history('/group/'+gb);h.router.push('/add');const f=summaryModel({router:h.router}),r=f.render('add');await r.settle();await click(r,'Check Saved Results');
        await click(r,'Open '+destination);assert.equal(h.chain()[2].name,'add');
        assert.equal(h.current().params[destination==='My Places'?'id':'entryId'],destination==='My Places'?entry:vid);
        const stack=h.chain()[2].state;assert.equal(stack.routes[stack.index-1].name,'index');h.router.back();assert.equal(h.chain()[2].name,'add');assert.equal(h.current().name,'index');
        assert.equal(f.store.values.size,1);assert.equal(posts(f).length,0);r.unmount();
    }
});
test('search','Recently saved deduplicates shared display choices without selecting an arbitrary underlying entry',async()=>{
    const facts={name:'Chick-fil-A',address:'100 Main Street',cuisine:null,apple_place_id:null};
    const rows=[{...facts,destination_kind:'personal',entry_id:entry,group_id:null},{...facts,destination_kind:'group',entry_id:vid,group_id:ga},{...facts,destination_kind:'group',entry_id:ma,group_id:gb}];
    const original=JSON.stringify(rows),f=model({recent:rows});let route='add';const r=f.rt.render(()=>({type:f.rt.load('app/'+route).default,props:{}}));await r.settle();
    assert.equal(nodes(r.output).filter(n=>n.type==='Pressable'&&textOf(n.props.children)==='Chick-fil-A 100 Main Street').length,1);
    await click(r,'Chick-fil-A 100 Main Street');route='add-visit';r.dirty=true;await r.settle();
    assert(nodes(r.output).filter(n=>n.props?.accessibilityRole==='checkbox').every(n=>!n.props.accessibilityState.checked));
    await toggle(r,'My Places');await toggle(r,'Dinner');await click(r,'Save Visit');
    assert(posts(f).every(p=>p.body.target_entry_id===null));assert.equal(posts(f).length,2);assert.equal(JSON.stringify(rows),original);r.unmount();
});
test('search','Display deduplication preserves different addresses, cuisine facts and distinct opaque identities',async()=>{
    const f=model(),dedupe=f.rt.load('@/lib/recent-restaurants').recentRestaurantChoices;
    const base=Object.freeze({name:'Cafe',address:'Main St',cuisine:null,apple_place_id:'opaque-A',entry_id:entry,destination_kind:'personal'});
    const rows=Object.freeze([base,Object.freeze({...base,address:'Other St'}),Object.freeze({...base,cuisine:'Cafe'}),Object.freeze({...base,apple_place_id:'opaque-B'})]);
    assert.equal(JSON.stringify(dedupe(rows)),JSON.stringify(rows));assert.equal(dedupe(rows)[0].entry_id,entry);
    const choices=dedupe([...rows,{...base,entry_id:vid}]);assert.equal(choices.length,4);assert.equal(choices[0].entry_id,undefined);assert.equal(choices[0].apple_place_id,'opaque-A');
});
test('personal','My Places empty/error refresh clears stale cards and never reads or writes the device archive',async()=>{
    const rt=runtime(),r=screen(rt,'my-places');await r.settle();assert(!textOf(r.output).includes('Private Cafe'));
    rt.world.rows=[fixture()];await click(r,'Refresh My Places');assert(textOf(r.output).includes('Private Cafe'));
    rt.world.override=()=>response({message:'Unavailable'},503);await click(r,'Refresh My Places');assert(!textOf(r.output).includes('Private Cafe'));
    assert.equal(rt.world.localReads,0);assert.equal(rt.world.localWrites,0);r.unmount();
});
test('personal','Personal card deletion stays cancellable and stale revisions require a fresh confirmation',async()=>{
    const rt=runtime();rt.world.params={id:fixture().id};rt.world.rows=[fixture()];const r=screen(rt,'personal-place/[id]');await r.settle();
    await click(r,'Delete Personal Place');await click(r,'Cancel');assert(!rt.world.requests.some(c=>c.url.pathname.endsWith('/delete_personal_place')));
    await click(r,'Delete Personal Place');rt.world.rows[0].revision=2;rt.world.rows[0].name='Newer Cafe';await click(r,'Confirm Delete');
    assert(textOf(r.output).includes('Newer Cafe'));assert(!nodes(r.output).some(n=>n.type==='Pressable'&&textOf(n.props.children)==='Confirm Delete'));assert.equal(rt.world.rows.length,1);
    await click(r,'Delete Personal Place');await click(r,'Confirm Delete');assert.equal(rt.world.rows.length,0);assert.equal(rt.world.navigation.at(-1),'BACK');r.unmount();
});
test('personal','Lost whole-card deletion reloads missing state and retained callbacks never resend',async()=>{
    const rt=runtime();rt.world.params={id:fixture().id};rt.world.rows=[fixture()];
    rt.world.override=call=>{if(!call.url.pathname.endsWith('/delete_personal_place'))return null;rt.world.rows=[];return response({},503);};
    const r=screen(rt,'personal-place/[id]');await r.settle();await click(r,'Delete Personal Place');const remove=button(r,'Confirm Delete').props.onPress;
    await remove();await r.settle();assert(textOf(r.output).includes('could not be found'));await remove();
    assert.equal(rt.world.requests.filter(c=>c.url.pathname.endsWith('/delete_personal_place')).length,1);r.unmount();
});
test('personal','Malformed and foreign card/visit route IDs expose no private data and offer no mutation',async()=>{
    for(const name of ['personal-place/[id]','personal-place-form','personal-visit-form'])for(const id of ['invalid',['one','two'],fixture().id]){
        const rt=runtime();rt.world.params={id,visitId:vid};rt.world.rows=[fixture({owner_user_id:'b'})];const r=screen(rt,name);await r.settle();
        assert(!textOf(r.output).includes('Private Cafe'));assert(!textOf(r.output).includes('Private memory'));
        assert(!nodes(r.output).some(n=>n.type==='Pressable'&&['Save Changes','Confirm Delete Visit','Delete Personal Place'].includes(textOf(n.props.children))));
        assert(!rt.world.requests.some(c=>c.url.pathname.startsWith('/rest/v1/rpc/')));r.unmount();
    }
});
test('personal','Private history hides on background, account change and sign-out; late reads cannot restore it',async()=>{
    const rt=runtime(),gate=defer();rt.world.params={id:fixture().id};rt.world.rows=[fixture()];
    rt.world.override=call=>call.url.pathname==='/rest/v1/personal_visits'?gate.promise:null;
    const r=screen(rt,'personal-place/[id]');await r.settle();rt.emit('background');await r.settle();assert.equal(r.output,null);
    rt.switch('b',r);rt.emit('active');await r.settle();gate.resolve(response([{id:vid,notes:'PRIVATE LATE'}]));await r.settle();
    assert(!textOf(r.output).includes('PRIVATE LATE'));assert(!textOf(r.output).includes('Private Cafe'));assert.equal(rt.world.lateUpdates,0);
    rt.switch(null,r);await r.settle();assert(textOf(r.output).includes('Sign in'));r.unmount();
});
test('personal','Personal visit drafts hide during access verification and newer revisions block retained submissions',async()=>{
    const rt=runtime();rt.world.params={id:fixture().id,visitId:vid};rt.world.rows=[fixture()];
    rt.world.visits=[{id:vid,personal_place_id:fixture().id,owner_user_id:'a',revision:1,visited_on:null,rating:null,would_go_again:false,notes:'Original private'}];
    const r=screen(rt,'personal-visit-form');await r.settle();await enter(r,'Private notes','Retained draft');const save=button(r,'Save Changes').props.onPress;
    rt.emit('background');await r.settle();assert(!textOf(r.output).includes('Retained draft'));
    const gate=defer();rt.world.override=call=>call.url.pathname==='/rest/v1/personal_visits'?gate.promise:null;
    rt.emit('active');await r.settle();assert(!nodes(r.output).some(n=>n.props?.accessibilityLabel==='Private notes'));
    await save();assert(!rt.world.requests.some(c=>c.url.pathname.endsWith('/manage_personal_visit')));
    gate.resolve(response([{...rt.world.visits[0],revision:2,notes:'Other device'}]));await r.settle();
    assert.equal(nodes(r.output).find(n=>n.props?.accessibilityLabel==='Private notes').props.value,'Retained draft');assert(button(r,'Save Changes').props.disabled);
    await save();assert(!rt.world.requests.some(c=>c.url.pathname.endsWith('/manage_personal_visit')));r.unmount();
});
test('personal','Personal visit mutations time out once, ignore late results and check uncertain edits without replay',async()=>{
    const time=deadlines(),rt=runtime(time),gate=defer();rt.world.params={id:fixture().id,visitId:vid};rt.world.rows=[fixture()];
    rt.world.visits=[{id:vid,personal_place_id:fixture().id,owner_user_id:'a',revision:1,visited_on:null,rating:null,would_go_again:false,notes:'Before'}];
    rt.world.override=call=>call.url.pathname.endsWith('/manage_personal_visit')?gate.promise:null;
    const r=screen(rt,'personal-visit-form');await r.settle();await enter(r,'Private notes','After');const save=button(r,'Save Changes').props.onPress;
    const pending=save();await r.settle();time.expire();await pending;await r.settle();assert(button(r,'Check Saved Visit'));assert(button(r,'Save Changes').props.disabled);
    gate.resolve(response([{...rt.world.visits[0],notes:'After',revision:2}]));await r.settle();assert.equal(rt.world.navigation.length,0);
    await save();await click(r,'Check Saved Visit');assert.equal(rt.world.requests.filter(c=>c.url.pathname.endsWith('/manage_personal_visit')).length,1);
    assert.equal(rt.world.navigation.length,0);assert(textOf(r.output).includes('does not confirm'));r.unmount();
});
test('personal','Account replacement disposes personal visit drafts and retained edit/delete callbacks',async()=>{
    for(const action of ['edit','delete']){
        const rt=runtime();rt.world.params={id:fixture().id,visitId:vid,action};rt.world.rows=[fixture()];
        rt.world.visits=[{id:vid,personal_place_id:fixture().id,owner_user_id:'a',revision:1,visited_on:null,rating:null,would_go_again:false,notes:'A only'}];
        const r=screen(rt,'personal-visit-form');await r.settle();const save=button(r,action==='edit'?'Save Changes':'Confirm Delete Visit').props.onPress;
        rt.switch('b',r);await r.settle();await save();assert(!textOf(r.output).includes('A only'));assert(!rt.world.requests.some(c=>c.url.pathname.endsWith('/manage_personal_visit')));
        assert.equal(rt.world.navigation.length,0);r.unmount();
    }
});
test('search','MapKit candidates use selectable full-address cards without maps or nested scrolling',async()=>{
    const f=nativeSearch({search:async()=>[nativeRestaurant(),nativeRestaurant({id:'1:1',address:'200 Native Street',placeId:null})]});
    await f.r.settle();await enter(f.r,'Search restaurants','Native Cafe');await click(f.r,'Search Apple Maps');assert.equal(f.chosen.length,0);
    assert.equal(nodes(f.r.output).filter(n=>n.type==='Marker'||n.type==='MapView'||n.type==='ScrollView').length,0);
    assert(textOf(f.r.output).includes('100 Native Street'));assert(textOf(f.r.output).includes('200 Native Street'));
    for(const node of nodes(f.r.output).filter(n=>n.type==='Text'))assert.equal(node.props.numberOfLines,undefined);
    await click(f.r,'Choose restaurant: Native Cafe, 200 Native Street');assert.equal(f.chosen.length,1);assert.equal(f.chosen[0].address,'200 Native Street');
    assert.equal(f.chosen[0].apple_place_id,null);assert(!('latitude'in f.chosen[0]));f.r.unmount();
});
test('search','Query changes invalidate late native results and retained candidate callbacks',async()=>{
    const gate=defer();let pending=false;const f=nativeSearch({search:()=>pending?gate.promise:Promise.resolve([nativeRestaurant()])});
    await f.r.settle();await enter(f.r,'Search restaurants','Native Cafe');await click(f.r,'Search Apple Maps');
    const choose=button(f.r,'Choose restaurant: Native Cafe, 100 Native Street').props.onPress;
    pending=true;const read=button(f.r,'Search Apple Maps').props.onPress();await f.r.settle();await enter(f.r,'Search restaurants','Changed query');choose();
    gate.resolve([nativeRestaurant()]);await read;await f.r.settle();assert.equal(f.chosen.length,0);assert(!textOf(f.r.output).includes('Use this restaurant'));f.r.unmount();
});
test('search','Background and unmount cancel native results and stale selections without navigation',async()=>{
    const gate=defer(),f=nativeSearch({search:()=>gate.promise});await f.r.settle();await enter(f.r,'Search restaurants','Native Cafe');
    const read=button(f.r,'Search Apple Maps').props.onPress();await f.r.settle();f.rt.emit('inactive');f.rt.emit('active');await f.r.settle();
    gate.resolve([nativeRestaurant()]);await read;await f.r.settle();assert(!textOf(f.r.output).includes('Use this restaurant'));assert.equal(f.chosen.length,0);
    f.r.unmount();assert.equal(f.rt.world.lateUpdates,0);
});
test('navigation','Repeated restaurant/manual selection callbacks open only one visit form',async()=>{
    const f=model(),r=f.render('add');await r.settle();const choose=button(r,'Enter Restaurant Manually').props.onPress;
    choose();choose();assert.equal(f.rt.world.navigation.length,1);r.unmount();
});
test('navigation','Done retains results on storage failure and a late completion cannot navigate a replacement account',async()=>{
    const f=summaryModel(),r=f.render('add');await r.settle();await click(r,'Check Saved Results');f.store.failClear=true;
    await click(r,'Done');assert(button(r,'Open My Places'));assert.equal(f.store.values.size,1);assert.equal(f.rt.world.navigation.length,0);
    f.store.failClear=false;const gate=defer(),remove=f.store.removeItem.bind(f.store);f.store.removeItem=async key=>{await gate.promise;await remove(key);};
    const done=button(r,'Done').props.onPress,pending=done();await r.settle();assert.equal(button(r,'Done').props.disabled,true);
    f.rt.switch('b',r);await r.settle();gate.resolve();await pending;await r.settle();await done();
    assert.equal(f.rt.world.navigation.length,0);assert.equal(f.rt.world.lateUpdates,0);assert.equal(posts(f).length,0);r.unmount();
});
async function run(category='save'){let passed=0;for(const t of tests.filter(t=>t.category===category)){await t.fn();passed++;console.log('PASS '+t.label);}console.log(`${passed} Milestone 18 ${category} checks passed.`);}
module.exports={run,model,fields,destinations,posts};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
