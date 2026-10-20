// Actual native adapter, selection, Add provider/form, save client and map.
// Only native/HTTP/storage boundaries are synthetic; SQL tests cover real storage.
const assert=require('node:assert/strict');
const {response,click,enter,button,nodes,textOf}=require('./personal-places.cjs');
const {model,fields,destinations,posts}=require('./unified-add.cjs');
const result={id:'1:0',name:'Synthetic Burger',address:'50 Fixture Ranch Dr, Milpitas, CA 95035',latitude:37.5555437394246,
    longitude:-121.982959052141,kind:'business',source:'apple-maps-preview'};
function nativeModel(placeId){
    const item={...result,...(placeId?{placeId}:{})};
    return model({development:true,platform:'ios',mocks:{expo:{requireOptionalNativeModule:()=>({isAvailable:()=>true,
        complete:async()=>[],search:async()=>[item],resolve:async()=>[item],reset:async()=>{},cancel:async()=>{}})}}});
}
async function selectedForm(placeId){
    const f=nativeModel(placeId);let route='app/add',coordinator;
    const r=f.rt.render(()=>{
        coordinator=f.rt.load('@/providers/unified-add').useUnifiedAdd().coordinator;
        return {type:f.rt.load(route).default,props:{}};
    });
    await r.settle();await enter(r,'Search restaurants','Synthetic Burger Milpitas');await click(r,'Search');
    await click(r,`Choose restaurant: ${result.name}, ${result.address}`);
    assert.equal(coordinator.state.restaurant.mapkit_point.latitude,result.latitude);
    route='app/add-visit';r.dirty=true;await r.settle();
    return {...f,r,coordinator};
}
const nativeFields=()=>({...fields(),restaurant:{name:result.name,address:result.address,cuisine:null,apple_place_id:null,
    mapkit_point:{name:result.name,address:result.address,latitude:result.latitude,longitude:result.longitude}}});
let passed=0;
async function test(label,fn){await fn();passed++;console.log('PASS '+label);}
(async()=>{
    for(const placeId of [undefined,'Opaque:Apple/ID'])await test(`MapKit selection through actual Add form persists exact point ${placeId?'with':'without'} Apple ID and renders a private pin`,async()=>{
        const f=await selectedForm(placeId);await click(f.r,'My Places');await click(f.r,'Save Visit');
        const sent=posts(f);assert.equal(sent.length,1);assert(sent[0].url.pathname.endsWith('/save_personal_visit_with_mapkit_point'));
        assert.equal(sent[0].body.selected_latitude,result.latitude);assert.equal(sent[0].body.selected_longitude,result.longitude);
        assert.equal(sent[0].body.restaurant_apple_place_id,placeId??null);assert.equal(f.state.visits.length,1);
        const journal=JSON.stringify([...f.store.values]);assert(!journal.includes(String(result.latitude))&&!journal.includes(result.address));
        f.r.unmount();const map=f.render('dev-map');await map.settle();
        const marker=nodes(map.output).find(n=>n.type==='Marker');assert(marker);assert.equal(marker.props.coordinate.latitude,result.latitude);
        assert.equal(marker.props.coordinate.longitude,result.longitude);assert.equal(marker.props.title,result.name);assert.equal(marker.props.description,result.address);map.unmount();
    });
    await test('Cuisine-only changes retain native point and available Apple ID',async()=>{
        const f=await selectedForm('Opaque ID');await enter(f.r,'Cuisine','Burgers');await click(f.r,'My Places');await click(f.r,'Save Visit');
        assert.equal(posts(f)[0].body.restaurant_apple_place_id,'Opaque ID');assert.equal(posts(f)[0].body.selected_latitude,result.latitude);
        assert.equal(posts(f)[0].body.restaurant_cuisine,'Burgers');f.r.unmount();
    });
    for(const label of ['Restaurant name','Restaurant address'])await test(`Editing ${label} invalidates original point and Apple ID without inventing replacement coordinates`,async()=>{
        const f=await selectedForm('Opaque ID');await enter(f.r,label,'Changed facts');await click(f.r,'My Places');await click(f.r,'Save Visit');
        assert(posts(f)[0].url.pathname.endsWith('/save_personal_visit'));assert.equal(posts(f)[0].body.restaurant_apple_place_id,null);
        assert(!('selected_latitude'in posts(f)[0].body));assert.equal(f.state.points.length,0);f.r.unmount();
    });
    await test('Native personal point stays out of group payloads and recovery storage',async()=>{
        const f=model({development:true}),c=await f.coordinator();await c.start(nativeFields(),destinations(),()=>true);
        assert.deepEqual(c.state.attempts.map(a=>a.status),['saved','saved','saved']);assert.equal(f.state.points.length,1);
        for(const call of posts(f).slice(1))assert(!('selected_latitude'in call.body)&&!('selected_longitude'in call.body));
        assert.equal(posts(f)[0].body.visit_notes,'PRIVATE');assert.equal(posts(f)[1].body.visit_notes,'SHARED');
        const journal=[...f.store.values.values()][0];assert(!journal.includes(String(result.latitude))&&!journal.includes('mapkit')&&!journal.includes('PRIVATE'));
    });
    await test('Malformed, stale, nonfinite, out-of-range and sentinel native points dispatch nothing',async()=>{
        const f=model({development:true});for(const patch of [{name:'Other'},{address:'Other'},{latitude:NaN},{longitude:Infinity},
            {latitude:91},{longitude:-181},{latitude:'37'},{latitude:0,longitude:0}]){
            const input=nativeFields();Object.assign(input.restaurant.mapkit_point,patch);
            assert.throws(()=>f.api.freezeAddSubmissions('a',input,destinations()));
        }assert.equal(posts(f).length,0);
    });
    await test('Selected point is frozen independently before dispatch; release/manual/recent paths do not infer points',async()=>{
        const f=model({development:true}),input=nativeFields(),submission=f.api.freezeAddSubmissions('a',input,destinations().slice(0,1))[0];
        assert(Object.isFrozen(submission.mapkitPoint));input.restaurant.mapkit_point.latitude=1;await f.api.sendAddSubmission(submission,()=>true);
        assert.equal(posts(f)[0].body.selected_latitude,result.latitude);
        const release=model();assert.equal(release.api.freezeAddSubmissions('a',nativeFields(),destinations().slice(0,1))[0].mapkitPoint,undefined);
        assert.equal(f.api.freezeAddSubmissions('a',fields(),destinations().slice(0,1))[0].mapkitPoint,undefined);
    });
    await test('Missing point RPC is a visible definitive failure, with no silent coordinate-dropping fallback',async()=>{
        const f=model({development:true}),c=await f.coordinator();f.state.override=call=>call.url.pathname.endsWith('/save_personal_visit_with_mapkit_point')?response({code:'PGRST202'},404):null;
        await c.start(nativeFields(),destinations().slice(0,1),()=>true);assert.equal(c.state.attempts[0].status,'failed');
        assert(c.state.attempts[0].message.includes('pending backend update'));assert.equal(posts(f).length,1);assert.equal(f.state.visits.length,0);
    });
    await test('Lost native-save response reconciles an atomic receipt without replaying or adding another visit',async()=>{
        const f=model({development:true}),c=await f.coordinator();f.state.override=call=>{
            if(!call.url.pathname.endsWith('/save_personal_visit_with_mapkit_point'))return null;f.commit(call);return response({},503);
        };
        await c.start(nativeFields(),destinations().slice(0,1),()=>true);assert.equal(c.state.attempts[0].status,'uncertain');
        await c.sendPending(()=>true);assert.equal(posts(f).length,1);f.state.override=null;
        const restored=await f.coordinator();await restored.reconcile(()=>true);assert.equal(restored.state.attempts[0].status,'saved');
        assert.equal(posts(f).length,1);assert.equal(f.state.visits.length,1);assert.equal(f.state.points.length,1);
    });
    await test('An account change rejects a retained native submission before any mutation',async()=>{
        const f=model({development:true}),submission=f.api.freezeAddSubmissions('a',nativeFields(),destinations().slice(0,1))[0];
        f.rt.switch('b');await assert.rejects(()=>f.api.sendAddSubmission(submission,()=>true));assert.equal(posts(f).length,0);
    });
    console.log(`${passed} MapKit location persistence checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
