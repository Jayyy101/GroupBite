// Actual repair UI/client/MapKit adapter with offline HTTP/native fixtures only.
// These coordinates are synthetic test data, never a repair source.
const assert = require('node:assert/strict');
const {runtime,fixture,response,screen,click,enter,button,nodes,textOf} = require('./personal-places.cjs');
let passed=0;
const test=async(label,fn)=>{await fn();passed++;console.log('PASS '+label);};
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const has=(r,label)=>nodes(r.output).some(n=>n.type==='Pressable'&&textOf(n.props.children)===label);
const writes=f=>f.rt.world.requests.filter(c=>c.url.pathname.endsWith('/set_personal_mapkit_location'));
const nativeAddress='123 Fixture Avenue, Test City, CA 90000';
function clock(){
    let now=0,id=0;const timers=new Map();
    return {setTimeout(fn,ms){const handle=++id;timers.set(handle,{fn,at:now+ms});return handle;},clearTimeout(handle){timers.delete(handle);},
        async advance(ms,r){const end=now+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
            if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await r.settle();}now=end;await r.settle();}};
}
function setup(options={}) {
    const state={points:[],verified:[],onWrite:null};
    const native={isAvailable:()=>true,search:async(query,mode,id)=>[{id:id+':0',name:'Fixture Burger',address:nativeAddress,
        latitude:37.123456789,longitude:-121.123456789,kind:'business',source:'apple-maps-preview',...options.nativeRow}],
        complete:async()=>[],resolve:async()=>[],cancel:async()=>{},reset:async()=>{}};
    const rt=runtime({development:true,platform:'ios',...options,
        mocks:{expo:{requireOptionalNativeModule:()=>options.unavailable?null:native},...options.mocks}});
    rt.world.rows=[fixture({apple_place_id:null,...options.row})];rt.world.params={id:fixture().id};
    rt.world.visits=[{id:'22222222-2222-2222-2222-222222222222',personal_place_id:fixture().id,owner_user_id:'a',
        visited_on:'2026-10-17',rating:5,would_go_again:true,notes:'Original single visit',origin:'visit',revision:3,created_at:'2026-10-17',updated_at:'2026-10-17'}];
    function commit(call) {
        const p=rt.world.rows.find(p=>p.id===call.body.target_personal_place_id&&p.owner_user_id===call.user);
        assert(p);assert.equal(p.revision,call.body.expected_revision);assert.equal(p.address,call.body.expected_address);
        if(!state.points.some(row=>row.id===p.id))state.points.push({id:p.id,owner_user_id:p.owner_user_id,name:p.name,address:p.address,
            latitude:call.body.selected_latitude,longitude:call.body.selected_longitude});
    }
    rt.world.override=call=>{
        if(call.url.pathname.endsWith('/get_saved_locations'))return response(state.verified);
        if(call.url.pathname.endsWith('/get_personal_mapkit_locations'))return response(state.points.filter(p=>p.owner_user_id===call.user));
        if(call.url.pathname.endsWith('/set_personal_mapkit_location')) {
            if(state.onWrite)return state.onWrite(call);
            commit(call);return response(true);
        }
        return options.read?.(call)??null;
    };
    return {rt,state,commit,render:()=>screen(rt,'personal-place/[id]')};
}
async function select(f,r) {
    await click(r,'Add missing map location');await enter(r,'Search restaurants','Fixture Burger Test City');await click(r,'Search Apple Maps');
    await click(r,'Choose restaurant: Fixture Burger, '+nativeAddress);
}
function facts(f){return JSON.stringify({rows:f.rt.world.rows,visits:f.rt.world.visits,receipts:[...f.rt.world.receipts]});}
async function baseline(f){return (await f.rt.load('@/lib/personal-location-repair').reviewPersonalLocationRepair('a',f.rt.world.rows[0])).snapshot;}
function selection(overrides={}){return {name:'Fixture Burger',address:nativeAddress,cuisine:null,mapkit_point:{name:'Fixture Burger',address:nativeAddress,latitude:37.123456789,longitude:-121.123456789,...overrides}};}

(async()=>{
    await test('Repair is absent in release builds, unsupported platforms and missing native builds; release helper cannot write',async()=>{
        for(const options of [{development:false},{platform:'android'},{unavailable:true}]){
            const f=setup(options),r=f.render();await r.settle();assert(!has(r,'Add missing map location'));
            assert.equal(writes(f).length,0);assert.equal(f.rt.world.requests.filter(c=>c.url.pathname.includes('/rpc/')).length,0);r.unmount();
            if(options.development===false)await assert.rejects(()=>f.rt.load('@/lib/personal-location-repair').attachPersonalMapkitLocation('a',{},selection(),()=>true));
        }
    });
    await test('Only an authorized owner with neither verified nor MapKit location sees the control, independent of Apple ID',async()=>{
        for(const kind of ['missing','apple-id','native','verified','foreign']){
            const f=setup(kind==='apple-id'?{row:{apple_place_id:'Existing opaque ID'}}:kind==='foreign'?{row:{owner_user_id:'b'}}:{});
            if(kind==='native')f.state.points=[{id:fixture().id,owner_user_id:'a',name:'Private Cafe',address:'Private Address',latitude:37,longitude:-121}];
            if(kind==='verified')f.state.verified=[{saved_kind:'personal',saved_id:fixture().id,restaurant_id:null,group_id:null,group_name:null,
                name:'Private Cafe',address:'Private Address',latitude:37,longitude:-121,resolution_status:'resolved',standardized_address:'Private Address',resolution_accuracy:'address'}];
            const r=f.render();await r.settle();assert.equal(has(r,'Add missing map location'),['missing','apple-id'].includes(kind),kind);
            assert.equal(writes(f).length,0);
            for(const call of f.rt.world.requests.filter(c=>c.url.pathname==='/rest/v1/personal_places'||c.url.pathname==='/rest/v1/personal_visits')){
                assert.equal(call.url.searchParams.get('owner_user_id'),'eq.a');assert.equal(call.user,'a');
            }r.unmount();
        }
    });
    await test('Native selection shows saved and selected addresses together; cancel and stale confirmation never write',async()=>{
        const f=setup(),before=facts(f),r=f.render();await r.settle();await select(f,r);
        const scrolls=nodes(r.output).filter(n=>n.type==='ScrollView');assert.equal(scrolls.length,1);
        assert.equal(scrolls[0].props.automaticallyAdjustKeyboardInsets,true);assert.equal(scrolls[0].props.keyboardDismissMode,'on-drag');
        assert(textOf(r.output).includes('Existing My Places restaurant'));assert(textOf(r.output).includes('Private Address'));
        assert(textOf(r.output).includes('Selected Apple Maps result'));assert(textOf(r.output).includes(nativeAddress));
        assert(button(r,'Add Another Visit').props.disabled);assert(button(r,'Edit Personal Place').props.disabled);
        assert(button(r,'Delete Personal Place').props.disabled);assert(button(r,'Refresh Place').props.disabled);
        const stale=button(r,'Attach location only').props.onPress;await click(r,'Cancel location repair');await stale();await r.settle();
        assert.equal(writes(f).length,0);assert.equal(facts(f),before);assert(!button(r,'Edit Personal Place').props.disabled);r.unmount();
    });
    await test('Location-read failure never offers repair; recovery is explicitly read-only',async()=>{
        const f=setup(),original=f.rt.world.override;let fail=true;
        f.rt.world.override=call=>fail&&call.url.pathname.endsWith('/get_personal_mapkit_locations')?response({message:'private map failure'},503):original(call);
        const r=f.render();await r.settle();assert(!has(r,'Add missing map location'));assert(textOf(r.output).includes('Could not verify'));
        assert(!textOf(r.output).includes('private map failure'));fail=false;await click(r,'Check saved location');
        assert(has(r,'Add missing map location'));assert.equal(writes(f).length,0);r.unmount();
    });
    await test('Confirmed location-only RPC preserves every original field and visit; optional provider ID is not written; map survives remount',async()=>{
        const f=setup(),before=facts(f),r=f.render();await r.settle();await select(f,r);await click(r,'Attach location only');
        assert.equal(writes(f).length,1);const call=writes(f)[0];assert.equal(call.user,'a');
        assert.deepEqual(call.body,{target_personal_place_id:fixture().id,expected_revision:1,expected_address:'Private Address',
            selected_latitude:37.123456789,selected_longitude:-121.123456789});
        assert.equal(facts(f),before);assert(textOf(r.output).includes('Location attachment verified'));
        assert.equal(f.rt.world.requests.filter(c=>c.method!=='GET'&&!c.url.pathname.endsWith('/get_saved_locations')&&!c.url.pathname.endsWith('/get_personal_mapkit_locations')).length,1);
        const pins=await f.rt.load('@/lib/personal-map').listPersonalMapPins('a',new AbortController().signal);
        assert.equal(pins.length,1);assert.equal(pins[0].id,fixture().id);assert.equal(pins[0].latitude,37.123456789);
        r.unmount();const reloaded=f.render();await reloaded.settle();assert(!has(reloaded,'Add missing map location'));
        assert(textOf(reloaded.output).includes('Location attachment verified'));assert.equal(facts(f),before);assert.equal(writes(f).length,1);reloaded.unmount();
    });
    await test('Revision, address, name and visit changes during selection stop before dispatch',async()=>{
        for(const change of ['revision','address','name','visit']){
            const f=setup(),r=f.render();await r.settle();await select(f,r);
            if(change==='visit')f.rt.world.visits[0].notes='Changed elsewhere';else f.rt.world.rows[0][change]=change==='revision'?2:'Changed elsewhere';
            await click(r,'Attach location only');assert.equal(writes(f).length,0);assert(textOf(r.output).includes('Repair is stopped'));r.unmount();
        }
    });
    await test('Database concurrency rejection is reconciled without replay or silently refreshing the expected revision',async()=>{
        const f=setup(),r=f.render();await r.settle();await select(f,r);
        f.state.onWrite=()=>{f.rt.world.rows[0].revision++;return response({code:'40001',message:'changed'},409);};
        await click(r,'Attach location only');assert.equal(writes(f).length,1);assert.equal(writes(f)[0].body.expected_revision,1);
        assert(textOf(r.output).includes('Repair is stopped'));await click(r,'Check saved location');assert.equal(writes(f).length,1);r.unmount();
    });
    await test('Double confirmation submits once and pending navigation cannot discard the repair',async()=>{
        const gate=defer(),f=setup(),r=f.render();await r.settle();await select(f,r);
        f.state.onWrite=call=>{f.commit(call);return gate.promise;};
        const handler=button(r,'Attach location only').props.onPress,task=handler();await handler();await r.settle();assert.equal(writes(f).length,1);
        assert(f.rt.attemptRemoval({type:'GO_BACK'}));await r.settle();assert(textOf(r.output).includes('Save in progress'));assert(!has(r,'Discard'));
        gate.resolve(response(true));await task;await r.settle();assert(textOf(r.output).includes('Location attachment verified'));r.unmount();
    });
    await test('Lost committed response is reconciled read-only and never creates another restaurant, visit or location',async()=>{
        const f=setup(),before=facts(f),r=f.render();await r.settle();await select(f,r);
        f.state.onWrite=call=>{f.commit(call);return response({message:'lost'},503);};await click(r,'Attach location only');
        assert(textOf(r.output).includes('Location attachment verified'));assert.equal(writes(f).length,1);assert.equal(f.state.points.length,1);assert.equal(facts(f),before);r.unmount();
    });
    await test('Uncommitted uncertainty survives unmount; only read checks remain until the exact point is observed',async()=>{
        const f=setup(),r=f.render();await r.settle();await select(f,r);f.state.onWrite=()=>response({message:'unknown'},503);
        await click(r,'Attach location only');assert(textOf(r.output).includes('Only read-only checks'));assert(!has(r,'Add missing map location'));
        await click(r,'Check saved location');assert.equal(writes(f).length,1);r.unmount();const next=f.render();await next.settle();
        assert(!has(next,'Add missing map location'));await click(next,'Check saved location');assert.equal(writes(f).length,1);
        f.commit(writes(f)[0]);await click(next,'Check saved location');assert(textOf(next.output).includes('Location attachment verified'));
        assert.equal(writes(f).length,1);next.unmount();
    });
    await test('A write deadline releases busy state into read-only reconciliation; a late response cannot replay or clear uncertainty',async()=>{
        const time=clock(),gate=defer(),f=setup({setTimeout:time.setTimeout,clearTimeout:time.clearTimeout}),r=f.render();
        await r.settle();await select(f,r);f.state.onWrite=()=>gate.promise;
        const task=button(r,'Attach location only').props.onPress();await r.settle();assert.equal(writes(f).length,1);
        await time.advance(20000,r);await task;await r.settle();assert(textOf(r.output).includes('Only read-only checks'));
        assert(!button(r,'Check saved location').props.disabled);gate.resolve(response(true));await r.settle();
        assert(textOf(r.output).includes('Only read-only checks'));assert.equal(writes(f).length,1);
        f.commit(writes(f)[0]);await click(r,'Check saved location');assert(textOf(r.output).includes('Location attachment verified'));r.unmount();
    });
    await test('Readback failures retain uncertainty and sanitize errors; recovery checks do not write',async()=>{
        let fail=false;const f=setup({read:call=>fail&&call.url.pathname==='/rest/v1/personal_places'?response({message:'private backend text'},503):null});
        const r=f.render();await r.settle();await select(f,r);f.state.onWrite=call=>{f.commit(call);fail=true;return response(true);};
        await click(r,'Attach location only');assert(textOf(r.output).includes('Only read-only checks'));
        await click(r,'Check saved location');assert(textOf(r.output).includes('Could not verify'));assert(!textOf(r.output).includes('private backend text'));
        fail=false;await click(r,'Check saved location');assert(textOf(r.output).includes('Location attachment verified'));assert.equal(writes(f).length,1);r.unmount();
    });
    await test('Account, sign-out, background, blur and unmount during preflight prevent dispatch and ignore stale handlers',async()=>{
        for(const action of ['account','sign-out','background','blur','unmount']){
            const f=setup(),r=f.render();await r.settle();await select(f,r);const gate=defer();let held=false;
            const old=f.rt.world.override;f.rt.world.override=call=>{
                if(!held&&call.url.pathname==='/rest/v1/personal_places'){held=true;return gate.promise;}return old(call);
            };
            const stale=button(r,'Attach location only').props.onPress,task=stale();await r.settle();assert(held);
            if(action==='account'||action==='sign-out')f.rt.switch(action==='account'?'b':null,r);
            else if(action==='background')f.rt.emit('background');else if(action==='blur'){f.rt.world.focused=false;r.dirty=true;}else r.unmount();
            if(action!=='unmount')await r.settle();gate.resolve(response(fixture({apple_place_id:null})));await task;
            if(action!=='unmount')await r.settle();await stale();assert.equal(writes(f).length,0,action);assert.equal(f.rt.world.lateUpdates,0,action);
            if(action==='account'||action==='sign-out')assert(!textOf(r.output).includes('Private Address'));r.unmount();
        }
    });
    await test('Pending dispatched repair survives background/remount with no duplicate; explicit check resolves its result',async()=>{
        const gate=defer(),f=setup(),r=f.render();await r.settle();await select(f,r);
        f.state.onWrite=call=>{f.commit(call);return gate.promise;};const task=button(r,'Attach location only').props.onPress();await r.settle();
        f.rt.emit('background');await r.settle();f.rt.emit('active');await r.settle();assert(!has(r,'Add missing map location'));
        gate.resolve(response(true));await task;await r.settle();await click(r,'Check saved location');
        assert(textOf(r.output).includes('Location attachment verified'));assert.equal(writes(f).length,1);assert.equal(f.rt.world.lateUpdates,0);r.unmount();
    });
    await test('Account replacement after dispatch hides old data, retains owner-specific uncertainty and never adopts the new account token',async()=>{
        for(const account of ['b',null]){
            const gate=defer(),f=setup(),r=f.render();await r.settle();await select(f,r);
            f.state.onWrite=call=>{f.commit(call);return gate.promise;};const task=button(r,'Attach location only').props.onPress();await r.settle();
            f.rt.switch(account,r);await r.settle();assert(!textOf(r.output).includes('Private Address'));gate.resolve(response(true));await task;await r.settle();
            assert.equal(writes(f).length,1);assert.equal(writes(f)[0].user,'a');assert.equal(f.rt.world.lateUpdates,0);
            f.rt.switch('a',r);await r.settle();assert(textOf(r.output).includes('Location attachment verified'));
            assert(!has(r,'Add missing map location'));assert.equal(writes(f).length,1);r.unmount();
        }
    });
    await test('Invalid or disconnected coordinate selections fail before mutation, and switched-account helpers fail closed',async()=>{
        for(const point of [{latitude:NaN},{latitude:91},{longitude:Infinity},{latitude:0,longitude:0},{name:'Edited result'},{address:'Edited address'}]){
            const f=setup(),b=await baseline(f);
            await assert.rejects(()=>f.rt.load('@/lib/personal-location-repair').attachPersonalMapkitLocation('a',b,selection(point),()=>true));assert.equal(writes(f).length,0);
        }
        const f=setup(),b=await baseline(f);f.rt.switch('b');await assert.rejects(()=>f.rt.load('@/lib/personal-location-repair').attachPersonalMapkitLocation('a',b,selection(),()=>true));assert.equal(writes(f).length,0);
    });
    await test('Complete history is paged beyond the REST row cap and a late-page history change prevents dispatch',async()=>{
        const f=setup({read:call=>{
            if(call.url.pathname!=='/rest/v1/personal_visits')return null;
            const after=call.url.searchParams.get('id')?.slice(3);
            return response(f.rt.world.visits.filter(v=>!after||v.id>after).slice(0,1));
        }});
        f.rt.world.visits.push({...f.rt.world.visits[0],id:'33333333-3333-3333-3333-333333333333'});
        const b=await baseline(f);assert.equal(b.visits.length,2);f.rt.world.visits[1].rating=1;
        const result=await f.rt.load('@/lib/personal-location-repair').attachPersonalMapkitLocation('a',b,selection(),()=>true);
        assert.equal(result.status,'changed');assert.equal(writes(f).length,0);
    });
    await test('A competing first resolution is preserved and never mistaken for the selected repair',async()=>{
        const f=setup(),r=f.render();await r.settle();await select(f,r);
        f.state.onWrite=()=>{f.state.points=[{id:fixture().id,owner_user_id:'a',name:'Private Cafe',address:'Private Address',latitude:38,longitude:-122}];return response(false);};
        await click(r,'Attach location only');assert(textOf(r.output).includes('Only read-only checks'));
        await click(r,'Check saved location');assert.equal(writes(f).length,1);assert.equal(f.state.points[0].latitude,38);r.unmount();
    });
    console.log(`${passed} offline personal location repair checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
