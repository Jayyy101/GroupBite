// Production native adapter, Add selection/form/coordinator and recovery code.
// Only native, HTTP and storage boundaries are synthetic. SQL has its own suite.
const assert=require('node:assert/strict');
const {response,click,enter,fixture,textOf}=require('./personal-places.cjs');
const {model,fields,destinations,posts}=require('./unified-add.cjs');
const address={street:'10 Native Street',city:'Native City',region:'CA',postal_code:'94538',country:'United States',country_code:'US'};
const native={id:'1:0',name:'Native Cafe',address:'Independent display text',latitude:37.55,longitude:-122.12,kind:'business',source:'apple-maps-preview',structuredAddress:address};
function setup(result=native){return model({development:true,platform:'ios',mocks:{expo:{requireOptionalNativeModule:()=>({isAvailable:()=>true,
    search:async()=>[result],resolve:async()=>[result],complete:async()=>[],reset:async()=>{},cancel:async()=>{}})}}});}
const input=()=>({...fields(),restaurant:{name:native.name,address:native.address,cuisine:null,apple_place_id:null,
    mapkit_point:{name:native.name,address:native.address,latitude:native.latitude,longitude:native.longitude,structured_address:{...address}}}});
const plain=value=>JSON.parse(JSON.stringify(value));
let passed=0;
async function test(label,fn){await fn();passed++;console.log('PASS '+label);}
(async()=>{
    for(const id of [undefined,'Opaque Apple ID'])await test(`Native selection through actual form persists components and coordinates for personal/groups ${id?'with':'without'} Apple ID`,async()=>{
        const f=setup({...native,...(id?{placeId:id}:{})});let route='app/add',coordinator;
        const r=f.rt.render(()=>{coordinator=f.rt.load('@/providers/unified-add').useUnifiedAdd().coordinator;return {type:f.rt.load(route).default,props:{}};});
        await r.settle();await enter(r,'Search restaurants','Native Cafe');await click(r,'Search');
        await click(r,`Choose restaurant: ${native.name}, ${native.address}`);
        assert.deepEqual(plain(coordinator.state.restaurant.mapkit_point.structured_address),address);
        route='app/add-visit';r.dirty=true;await r.settle();
        for(const label of ['My Places','Dinner','Lunch'])await click(r,label);
        await click(r,'Save Visit');
        assert.equal(posts(f).length,3);assert.equal(f.state.points.length,3);
        for(const call of posts(f)){
            assert.deepEqual(call.body.selected_address,address);assert.equal(call.body.selected_latitude,native.latitude);
            assert.equal(call.body.selected_longitude,native.longitude);assert.equal(call.body.restaurant_address,native.address);
            assert.equal(call.body.restaurant_apple_place_id,id??null);
        }
        assert(coordinator.state.attempts.every(a=>a.status==='saved'));r.unmount();
    });
    await test('Frozen components cannot change after submission; recovery storage contains no location or notes',async()=>{
        const f=model({development:true}),value=input(),s=f.api.freezeAddSubmissions('a',value,destinations());
        assert(Object.isFrozen(s[0].mapkitPoint.structured_address));value.restaurant.mapkit_point.structured_address.city='Changed';
        assert(s.every(v=>v.mapkitPoint.structured_address.city==='Native City'));
        const c=await f.coordinator();await c.start(input(),destinations(),()=>true);
        const stored=JSON.stringify([...f.store.values]);for(const secret of ['Native City','Native Street',native.address,'PRIVATE','SHARED','37.55'])assert(!stored.includes(secret));
    });
    await test('Malformed components fail before sending; partial and old-native selections stay valid',async()=>{
        const f=model({development:true});for(const value of [[],42,{city:42},{country_code:'usa'},{city:'bad\ncity'},{city:'x'.repeat(201)},{notes:'PRIVATE'},{toString:'unexpected'}]){
            const v=input();v.restaurant.mapkit_point.structured_address=value;
            assert.throws(()=>f.api.freezeAddSubmissions('a',v,destinations()));
        }
        assert.equal(posts(f).length,0);
        const partial=input();partial.restaurant.mapkit_point.structured_address={city:'Native City'};
        assert.deepEqual(plain(f.api.freezeAddSubmissions('a',partial,destinations())[1].mapkitPoint.structured_address),{street:null,city:'Native City',region:null,postal_code:null,country:null,country_code:null});
        const old=input();delete old.restaurant.mapkit_point.structured_address;
        await f.api.sendAddSubmission(f.api.freezeAddSubmissions('a',old,destinations())[1],()=>true);
        assert.equal(posts(f)[0].body.selected_address,null);assert.equal(posts(f)[0].body.selected_latitude,native.latitude);
    });
    await test('Native adapter rejects malformed optional components rather than dropping them',async()=>{
        const f=setup({...native,structuredAddress:{city:42}});
        await assert.rejects(f.rt.load('@/lib/apple-map-search').searchApplePlaces('Native Cafe','business',new AbortController().signal));
    });
    await test('Lost group response reconciles an atomic receipt after restart without replay',async()=>{
        const f=model({development:true}),c=await f.coordinator();f.state.override=call=>{
            if(!(call.url.pathname.endsWith('/save_group_visit_with_mapkit_location') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'group')))return null;
            f.commit(call);return response({},503);
        };
        await c.start(input(),destinations().slice(1,2),()=>true);assert.equal(c.state.attempts[0].status,'uncertain');
        await c.sendPending(()=>true);assert.equal(posts(f).length,1);
        f.state.override=null;const restored=await f.coordinator();await restored.reconcile(()=>true);
        assert.equal(restored.state.attempts[0].status,'saved');assert.equal(posts(f).length,1);assert.equal(f.state.visits.length,1);
        assert.deepEqual(f.state.points[0].structured_address,address);
    });
    await test('Missing group backend or permission/conflict rejection is explicit, with no metadata-dropping fallback',async()=>{
        for(const [code,message] of [['PGRST202','pending backend update'],['GB001','different Apple Maps details'],['GB002','only the group Owner']]){
            const f=model({development:true}),c=await f.coordinator();f.state.override=()=>response({code},400);
            await c.start(input(),destinations().slice(1,2),()=>true);
            assert.equal(c.state.attempts[0].status,'failed');assert(c.state.attempts[0].message.includes(message));assert.equal(posts(f).length,1);assert.equal(f.state.visits.length,0);
        }
    });
    await test('Recent deduplication preserves selected metadata and keeps differing snapshots distinct',async()=>{
        const f=model(),recent=f.rt.load('@/lib/recent-restaurants').recentRestaurantChoices;
        const a={...input().restaurant,destination_kind:'personal',entry_id:'one'},b={...input().restaurant,destination_kind:'group',entry_id:'two'};
        const merged=recent([a,b]);assert.equal(merged.length,1);assert.equal(merged[0].entry_id,undefined);assert.deepEqual(plain(merged[0].mapkit_point.structured_address),address);
        b.mapkit_point={...b.mapkit_point,latitude:38};assert.equal(recent([a,b]).length,2);
    });
    await test('Saved source revalidation retains metadata when copying a recent personal restaurant into a group',async()=>{
        for(const failRead of [false,true]){
            const place=fixture(),recent={name:place.name,address:place.address,cuisine:place.cuisine,destination_kind:'personal',entry_id:place.id};
            const f=model({development:true,recent:[recent]});let route='app/add';
            f.state.points.push({id:place.id,name:place.name,address:place.address,latitude:native.latitude,longitude:native.longitude,structured_address:address});
            const r=f.rt.render(()=>({type:f.rt.load(route).default,props:{}}));await r.settle();
            await click(r,`${place.name}, ${place.address}`);
            if(failRead)f.state.override=call=>call.url.pathname.endsWith('/get_saved_mapkit_location')?response({},503):null;
            route='app/add-visit';r.dirty=true;await r.settle();
            if(failRead){assert(textOf(r.output).includes('Could not verify destinations'));assert.equal(posts(f).length,0);}
            else {await click(r,'Dinner');await click(r,'Save Visit');assert.deepEqual(posts(f)[0].body.selected_address,address);assert.equal(posts(f)[0].body.selected_latitude,native.latitude);}
            r.unmount();
        }
    });
    await test('Name/address editing clears the entire native snapshot; cuisine editing retains it',async()=>{
        for(const label of ['Restaurant name','Restaurant address','Cuisine']){
            const f=setup();let route='app/add';
            const form=f.rt.render(()=>({type:f.rt.load(route).default,props:{}}));await form.settle();
            await enter(form,'Search restaurants','Native Cafe');await click(form,'Search');
            await click(form,`Choose restaurant: ${native.name}, ${native.address}`);
            route='app/add-visit';form.dirty=true;await form.settle();
            await enter(form,label,'Changed');await click(form,'My Places');await click(form,'Save Visit');
            assert.equal(posts(f).length,1);
            if(label==='Cuisine')assert.deepEqual(posts(f)[0].body.selected_address,address);
            else assert.equal(posts(f)[0].body.selected_address,null);
            form.unmount();
        }
    });
    console.log(`${passed} structured MapKit client checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
