// Actual group form/detail screens, Supabase client, shared picker/lookup and map.
// Synthetic HTTP/native boundaries only: no .env, hosted data or Apple requests.
const assert = require('node:assert/strict');
const { runtime, response, screen, click, button, nodes, textOf } = require('./personal-places.cjs');
const ga='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', gb='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const entryId='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', restaurantId='dddddddd-dddd-dddd-dddd-dddddddddddd';
const group={id:ga,name:'Dinner A',owner_user_id:'a'}, second={id:gb,name:'Dinner B',owner_user_id:'b'};
const summary={id:entryId,restaurant_id:restaurantId,name:'User Cafe',address:'User Address',cuisine:'User Cuisine',average_rating:null,rated_visit_count:0,total_visit_count:1};
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function clock() {
    let now=0,seq=0; const tasks=new Map();
    return {setTimeout(fn,ms){const id=++seq;tasks.set(id,{fn,at:now+ms});return id;},clearTimeout(id){tasks.delete(id);},
        async advance(ms,r){const end=now+ms; while(true){const next=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end) break;
            now=next[1].at; tasks.delete(next[0]); next[1].fn(); await r.settle();}now=end;await r.settle();}};
}
const location=id=>({id,placeId:'Opaque Apple ID',name:'Transient Apple name',address:'Transient Apple address',latitude:37.33,longitude:-121.88,kind:'business',source:'apple-maps-preview'});
function setup(options={}) {
    const time=clock(), nativeCalls=[],cancel=[],receipts=new Map(),visits=[];
    const native={isAvailable:()=>true,supportsPlaceIdLookup:()=>options.supported!==false,
        complete(query,mode,id){nativeCalls.push({action:'complete',query,mode,id});return options.complete?options.complete(id):Promise.resolve([{id:id+':0',title:'Apple suggestion',subtitle:'Apple city'}]);},
        search(query,mode,id){nativeCalls.push({action:'search',query,mode,id});return Promise.resolve([location(id+':0')]);},
        resolve(suggestion,id){nativeCalls.push({action:'resolve',suggestion,id});return options.resolve?options.resolve(id):Promise.resolve([location(id+':0')]);},
        lookupPlace(placeId,mode,id){nativeCalls.push({action:'lookup',placeId,mode,id});return options.lookup?options.lookup(id):Promise.resolve([location(id+':0')]);},
        async cancel(id){cancel.push(id);},async reset(){}};
    let rt; const state={groups:[group,second],access:true,appleId:'Stored Apple ID',summary,entryId,lookupReads:0};
    function commit(call) {
        const key=call.user+':'+call.body.client_request_id,body=JSON.stringify(call.body);
        if(receipts.has(key)) assert.equal(receipts.get(key),body,'Retry must preserve the entire body');
        else {receipts.set(key,body); for(const groupId of call.body.target_group_ids) visits.push({groupId,body:call.body});}
        return response(call.url.pathname.endsWith('with_apple_place_id')?[{restaurant_id:restaurantId,bindings_recorded:true}]:restaurantId);
    }
    function backend(call) {
        if(rt.world.override){const result=rt.world.override(call);if(result)return result;}
        const p=call.url.pathname;
        if(p==='/rest/v1/groups') return response(call.url.searchParams.has('id')?(state.access&&call.user==='a'&&call.url.searchParams.get('id')==='eq.'+ga?group:null):call.user==='a'?state.groups:[]);
        if(p==='/rest/v1/group_memberships') return response(state.access&&call.user==='a'?{membership_id:'original-membership'}:null);
        if(p==='/rest/v1/restaurants') return response({id:restaurantId,name:summary.name,address:summary.address,cuisine:summary.cuisine});
        if(p==='/rest/v1/rpc/get_group_restaurants') return response(state.access&&call.user==='a'&&call.body.target_group_id===ga?[state.summary]:[]);
        if(p==='/rest/v1/rpc/get_group_restaurant_visits') return response([{id:'visit',creator_display_name:'Member',can_manage:false,rating:null,visited_on:null,would_go_again:null,notes:'User memory'}]);
        if(p==='/rest/v1/rpc/get_group_restaurant_apple_place_id') {
            state.lookupReads++;
            assert.equal(call.body.target_group_id,rt.world.params.id); assert.equal(call.body.target_group_restaurant_id,rt.world.params.entryId);
            if(!state.access||call.user!=='a')return response({code:'42501',message:'Private backend access message'},403);
            return response([{group_id:ga,group_restaurant_id:state.entryId,apple_place_id:state.appleId}]);
        }
        if(['/rest/v1/rpc/save_restaurant_visit','/rest/v1/rpc/save_restaurant_visit_with_apple_place_id'].includes(p)) return commit(call);
        assert.fail('Unexpected request '+p);
    }
    rt=runtime({development:true,platform:'ios',setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,
        ...options,fetch:backend,mocks:{expo:{requireOptionalNativeModule:()=>options.missing?null:native},
            'react-native-maps':{default:'MapView',Marker:'Marker',PROVIDER_DEFAULT:'default'},...options.mocks}});
    rt.world.params=options.detail?{id:ga,entryId}:{groupId:ga,...(options.existing?{restaurantId}:{})};
    return {rt,time,state,nativeCalls,cancel,receipts,visits,commit,render:()=>screen(rt,options.detail?'group/[id]/restaurant/[entryId]':'add-visit')};
}
const markers=r=>nodes(r.output).filter(n=>n.type==='Marker');
let passed=0;async function test(label,fn){await fn();passed++;console.log('PASS '+label);}
(async()=>{
    // New destination save/frozen recovery scenarios are in unified-add.cjs.
    await test('Authorized group detail uses explicit saved-ID lookup with both route IDs before AND after native, no writes',async()=>{
        const f=setup({detail:true}),r=f.render();await r.settle();assert.equal(f.nativeCalls.length,0);assert.equal(f.state.lookupReads,0);
        await click(r,'Look up saved Apple Place ID');assert.equal(f.state.lookupReads,2);assert.equal(f.nativeCalls.length,1);assert.equal(f.nativeCalls[0].placeId,'Stored Apple ID');assert.equal(markers(r).length,1);
        assert(textOf(r.output).includes('User Cafe'));assert(textOf(r.output).includes('User Address'));assert(textOf(r.output).includes('User memory'));
        assert(f.rt.world.requests.filter(c=>c.method==='POST').every(c=>c.url.pathname.startsWith('/rest/v1/rpc/get_')));assert.equal(f.rt.world.localReads,0);assert.equal(f.rt.world.localWrites,0);
        assert.equal(f.state.appleId,'Stored Apple ID');await click(r,'Add Another Visit');assert.equal(f.rt.world.navigation.at(-1).params.restaurantId,restaurantId);r.unmount();
    });
    await test('Lookup refuses missing/wrong entry, revoked membership and account change before native resolution',async()=>{
        for(const action of ['missing-id','wrong-entry','revoked','account','missing-detail','wrong-group']){
            const f=setup({detail:true}),r=f.render();
            if(action==='missing-detail')f.state.summary={...summary,id:'ffffffff-ffff-ffff-ffff-ffffffffffff'};
            if(action==='wrong-group')f.rt.world.params.id=gb;
            await r.settle();
            if(action==='missing-id')f.state.appleId=null;else if(action==='wrong-entry')f.state.entryId='ffffffff-ffff-ffff-ffff-ffffffffffff';else if(action==='revoked')f.state.access=false;
            else if(action==='account')f.rt.world.auth.session={user:{id:'b'},access_token:'fake-b'};
            if(['missing-detail','wrong-group'].includes(action))assert(!textOf(r.output).includes('Look up saved Apple Place ID'));
            else await click(r,'Look up saved Apple Place ID');assert.equal(f.nativeCalls.length,0);assert.equal(markers(r).length,0);assert(!textOf(r.output).includes('Private backend'));r.unmount();
        }
    });
    await test('Delayed scoped reads on blur/background/route/account changes never start native lookup or update disposed screens',async()=>{
        for(const action of ['blur','background','route','account','sign-out']){
            const task=defer(),f=setup({detail:true}),r=f.render();await r.settle();
            f.rt.world.override=c=>c.url.pathname==='/rest/v1/rpc/get_group_restaurant_apple_place_id'?task.promise:null;
            const stale=button(r,'Look up saved Apple Place ID').props.onPress,pending=stale();await r.settle();assert.equal(f.nativeCalls.length,0);
            if(action==='blur'){f.rt.world.focused=false;r.dirty=true;}else if(action==='background')f.rt.emit('background');
            else if(action==='route'){f.rt.world.params={id:gb,entryId};r.dirty=true;}else f.rt.switch(action==='account'?'b':null,r);
            await r.settle();task.resolve(response([{group_id:ga,group_restaurant_id:entryId,apple_place_id:'Stored Apple ID'}]));await pending;await r.settle();
            assert.equal(f.nativeCalls.length,0);assert.equal(f.rt.world.lateUpdates,0);assert.equal(markers(r).length,0);await stale();assert.equal(f.nativeCalls.length,0);r.unmount();
        }
    });
    await test('Access, ID invalidation or entry identity changes during native lookup discard all Apple data',async()=>{
        for(const action of ['revoked','id-cleared','entry-changed']){
            const task=defer(),f=setup({detail:true,lookup:()=>task.promise}),r=f.render();await r.settle();const pending=button(r,'Look up saved Apple Place ID').props.onPress();await r.settle();
            if(action==='revoked')f.state.access=false;else if(action==='id-cleared')f.state.appleId=null;else f.state.entryId='ffffffff-ffff-ffff-ffff-ffffffffffff';
            task.resolve([location('1:0')]);await pending;await r.settle();assert.equal(f.state.lookupReads,2);assert.equal(markers(r).length,0);assert(!textOf(r.output).includes('Transient Apple'));r.unmount();
        }
    });
    await test('Lookup double taps, blur, background, access loss, route and account changes cancel late transient data',async()=>{
        for(const action of ['blur','background','account','sign-out','route','refresh','access','unmount']){
            const task=defer(),f=setup({detail:true,lookup:()=>task.promise}),r=f.render();await r.settle();const stale=button(r,'Look up saved Apple Place ID').props.onPress,pending=stale();await stale();await r.settle();assert.equal(f.nativeCalls.length,1);
            if(action==='blur'){f.rt.world.focused=false;r.dirty=true;}else if(action==='background'){f.rt.emit('inactive');f.rt.emit('active');}
            else if(action==='account'||action==='sign-out')f.rt.switch(action==='account'?'b':null,r);
            else if(action==='route'){f.rt.world.params={id:gb,entryId};r.dirty=true;}
            else if(action==='refresh'||action==='access'){if(action==='access')f.state.access=false;await click(r,'Refresh Restaurant');}
            else r.unmount();if(action!=='unmount')await r.settle();task.resolve([location('1:0')]);await pending;
            if(action!=='unmount'){await r.settle();assert.equal(markers(r).length,0);assert(!textOf(r.output).includes('Transient Apple'));}
            assert.equal(f.cancel.length,1,action);assert.equal(f.rt.world.lateUpdates,0,action);await stale();assert.equal(f.nativeCalls.length,1);r.unmount();
        }
    });
    await test('Native timeout/offline/empty responses retain facts; release and unsupported builds never perform lookup',async()=>{
        for(const mode of ['timeout','empty','offline','release','unsupported','missing']){
            const task=defer(),f=setup({detail:true,development:mode!=='release',supported:mode!=='unsupported',missing:mode==='missing',lookup:id=>mode==='timeout'?task.promise:mode==='offline'?Promise.reject(new Error('Private native details')):Promise.resolve([])}),r=f.render();await r.settle();
            if(['release','unsupported','missing'].includes(mode)){assert(!textOf(r.output).includes('Look up saved Apple Place ID'));assert.equal(f.state.lookupReads,0);}
            else {const pending=button(r,'Look up saved Apple Place ID').props.onPress();await r.settle();if(mode==='timeout')await f.time.advance(10000,r);await pending;await r.settle();assert.equal(markers(r).length,0);assert(!textOf(r.output).includes('Private native details'));}
            assert(textOf(r.output).includes('User Cafe'));assert(textOf(r.output).includes('User Address'));r.unmount();
        }
    });
    console.log(`${passed} offline group Apple checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
