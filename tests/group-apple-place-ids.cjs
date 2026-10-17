// Actual group form/detail screens, Supabase client, shared picker/lookup and map.
// Synthetic HTTP/native boundaries only: no .env, hosted data or Apple requests.
const assert = require('node:assert/strict');
const { runtime, response, screen, click, enter, button, nodes, textOf } = require('./personal-places.cjs');
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
const suggestions=r=>nodes(r.output).filter(n=>n.props?.accessibilityLabel?.startsWith('Select Apple suggestion:'));
const candidates=r=>nodes(r.output).filter(n=>n.props?.accessibilityLabel?.startsWith('Preview Apple location:'));
const posts=f=>f.rt.world.requests.filter(c=>c.url.pathname.includes('/rpc/save_restaurant_visit'));
async function fill(r){await enter(r,'Restaurant name',' User Cafe ');await enter(r,'Restaurant address',' User Address ');await enter(r,'Cuisine',' User Cuisine ');await enter(r,'Visit date','2026-10-13');await enter(r,'Visit notes',' User memory ');}
async function choose(f,r){await click(r,'Choose Apple Maps place (optional)');await enter(r,'Apple Maps search','Public address, San Jose');await f.time.advance(400,r);await suggestions(r)[0].props.onPress();await r.settle();candidates(r)[0].props.onPress();await r.settle();}
let passed=0;async function test(label,fn){await fn();passed++;console.log('PASS '+label);}
(async()=>{
    const { StackRouter } = await import('@react-navigation/routers');
    // Actual installed stack reducer; the offline hook boundary models removal
    // prevention and native iOS's cancelled-dismiss -> POP request contract.
    function navigationFixture(direct=false) {
        const reducer=StackRouter({}),options={routeNames:['groups','add-visit','group/[id]','group/[id]/restaurant/[entryId]'],routeParamList:{},routeGetIdList:{}};
        let state=reducer.getInitialState(options),f;
        const initial=direct?['add-visit']:['groups','add-visit'];
        state={...state,index:initial.length-1,routes:initial.map((name,i)=>({name,key:'fixture-'+i}))};
        const dispatched=[];
        const apply=action=>{const next=reducer.getStateForAction(state,action,options);assert(next,'Handled navigation action');state=reducer.getRehydratedState(next,options);dispatched.push(action);};
        const request=action=>f.rt.attemptRemoval(action,()=>apply(action));
        const route=href=>({name:typeof href==='string'?href.slice(1):href.pathname.slice(1),params:typeof href==='string'?undefined:href.params});
        const router={canGoBack:()=>state.index>0,back:()=>request({type:'POP',payload:{count:1}}),
            replace:href=>request({type:'REPLACE',payload:route(href)}),dismissTo:href=>request({type:'POP_TO',payload:route(href)}),
            push:href=>apply({type:'PUSH',payload:route(href)})};
        f=setup({router,navigationDispatch:apply});
        return {f,router,request,dispatched,current:()=>state.routes[state.index]};
    }
    await test('Group picker preserves user facts; only explicit ID enters a new atomic save',async()=>{
        const f=setup(),r=f.render();await r.settle();await fill(r);await choose(f,r);
        assert.equal(markers(r).length,1);assert.equal(f.rt.world.requests.filter(c=>c.method==='POST').length,0);
        const map=nodes(r.output).find(n=>n.type==='MapView');assert.equal(map.props.showsUserLocation,false);assert.equal(map.props.showsMyLocationButton,false);
        assert(textOf(r.output).includes('group visit in development'));await click(r,'Save Visit');
        const call=posts(f)[0];assert.equal(call.user,'a');assert.equal(call.url.pathname,'/rest/v1/rpc/save_restaurant_visit_with_apple_place_id');
        assert.deepEqual(Object.keys(call.body).sort(),['client_request_id','target_group_ids','restaurant_name','restaurant_address','restaurant_cuisine','visit_date','visit_rating','visit_would_go_again','visit_notes','restaurant_apple_place_id'].sort());
        assert.equal(call.body.restaurant_apple_place_id,'Opaque Apple ID');assert.equal(call.body.restaurant_name,'User Cafe');assert.equal(call.body.restaurant_address,'User Address');
        assert.equal(call.body.visit_notes,'User memory');assert.equal(f.visits.length,1);assert(!JSON.stringify(call.body).includes('Transient'));assert.equal(f.rt.world.localWrites,0);r.unmount();
    });
    await test('Unselected candidates and results without IDs retain the exact legacy RPC and fields',async()=>{
        for(const select of [false,true]){
            const f=setup({resolve:id=>Promise.resolve([{...location(id+':0'),placeId:undefined}])}),r=f.render();await r.settle();await fill(r);
            await click(r,'Choose Apple Maps place (optional)');await enter(r,'Apple Maps search','Public address');await f.time.advance(400,r);await suggestions(r)[0].props.onPress();await r.settle();
            if(select){candidates(r)[0].props.onPress();await r.settle();}await click(r,'Save Visit');
            assert.equal(posts(f)[0].url.pathname,'/rest/v1/rpc/save_restaurant_visit');assert(!('restaurant_apple_place_id'in posts(f)[0].body));r.unmount();
        }
    });
    await test('Existing restaurant Add Another Visit keeps locked facts and exposes the reused picker',async()=>{
        const f=setup({existing:true}),r=f.render();await r.settle();assert.equal(nodes(r.output).find(n=>n.props?.accessibilityLabel==='Restaurant address').props.editable,false);
        await choose(f,r);await click(r,'Save Visit');assert.equal(posts(f)[0].body.restaurant_name,'User Cafe');assert.equal(posts(f)[0].body.restaurant_apple_place_id,'Opaque Apple ID');r.unmount();
    });
    await test('Uncertain committed or uncommitted multi-group saves freeze ALL data across lifecycle resets and retry exactly',async()=>{
        for(const committed of [true,false]){
            const f=setup(),r=f.render();await r.settle();await fill(r);
            const checkbox=nodes(r.output).find(n=>n.props?.accessibilityRole==='checkbox'&&textOf(n.props.children).trim()==='Dinner B');checkbox.props.onPress();await r.settle();await choose(f,r);
            let attempt=0;f.rt.world.override=call=>{if(!call.url.pathname.includes('/rpc/save_restaurant_visit'))return null;
                if(++attempt===1){if(committed)f.commit(call);return response({code:'',message:'Lost response'},503);}return null;};
            const save=button(r,'Save Visit').props.onPress;await save();await r.settle();assert.equal(posts(f).length,1);const initial=JSON.stringify(posts(f)[0].body);
            assert(textOf(r.output).includes('uncertain'));assert(nodes(r.output).filter(n=>n.type==='TextInput').every(n=>n.props.editable===false));
            assert(nodes(r.output).filter(n=>n.props?.accessibilityRole==='checkbox').every(n=>n.props.disabled));
            f.rt.emit('inactive');f.rt.emit('active');await r.settle();f.rt.world.focused=false;r.dirty=true;await r.settle();f.rt.world.focused=true;r.dirty=true;await r.settle();
            await click(r,'Refresh Groups');assert.equal(markers(r).length,0);assert.equal(f.nativeCalls.filter(c=>c.action==='lookup').length,0);
            await click(r,'Retry Same Visit Save');assert.equal(posts(f).length,2);assert.equal(JSON.stringify(posts(f)[1].body),initial);assert.equal(posts(f)[1].user,'a');
            assert.equal(posts(f)[1].url.pathname,posts(f)[0].url.pathname);assert.equal(f.visits.length,2);assert.equal(f.rt.world.navigation.at(-1),'/groups');await save();assert.equal(posts(f).length,2);r.unmount();
        }
    });
    await test('Stalled save deadline locks the frozen submission, ignores late success and permits only exact retry',async()=>{
        const task=defer(),f=setup(),r=f.render();await r.settle();await fill(r);await choose(f,r);
        let attempts=0;f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')&&++attempts===1?task.promise:null;
        const pending=button(r,'Save Visit').props.onPress();await r.settle();await f.time.advance(19999,r);assert(textOf(r.output).includes('Saving...'));
        await f.time.advance(1,r);await pending;await r.settle();assert(textOf(r.output).includes('Retry Same Visit Save'));
        const first=posts(f)[0];task.resolve(f.commit(first));await r.settle();assert.equal(f.rt.world.navigation.length,0);
        await click(r,'Retry Same Visit Save');assert.deepEqual(posts(f)[1].body,first.body);assert.equal(f.visits.length,1);r.unmount();
    });
    await test('Lost response after commit: Back, iOS swipe and navigation removal can stay and retry without duplicate visits',async()=>{
        for(const action of ['back','fallback','ios-swipe','replace','reset']){
            const h=navigationFixture(action==='fallback'),{f}=h,r=f.render();await r.settle();await fill(r);await choose(f,r);
            let n=0;f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')&&++n===1?(f.commit(c),response({code:'',message:'Lost committed response'},503)):null;
            await click(r,'Save Visit');const original=posts(f)[0];assert.equal(f.visits.length,1);
            if(action==='back'||action==='fallback')await click(r,'Back');
            else h.request(action==='replace'?{type:'REPLACE',payload:{name:'groups'}}:action==='reset'?{type:'RESET',payload:{index:0,routes:[{name:'groups'}]}}:{type:'POP',payload:{count:1},source:h.current().key});
            await r.settle();assert.equal(h.current().name,'add-visit');assert(textOf(r.output).includes('may already have been saved'));assert(textOf(r.output).includes('reopening cannot safely retry'));
            assert.equal(nodes(r.output).filter(n=>n.type==='Modal').length,1);h.request({type:'POP',payload:{count:1}});await r.settle();assert.equal(nodes(r.output).filter(n=>n.type==='Modal').length,1);
            await click(r,'Stay and Keep Submission');assert.equal(nodes(r.output).filter(n=>n.type==='Modal').length,0);assert.equal(posts(f).length,1);
            await click(r,'Retry Same Visit Save');assert.deepEqual(posts(f)[1].body,original.body);assert.equal(posts(f)[1].url.pathname,original.url.pathname);
            assert.equal(f.visits.length,1);assert.equal(h.current().name,'group/[id]/restaurant/[entryId]');r.unmount();
        }
    });
    await test('In-flight Back can stay without replay; explicit abandonment ignores late results and old callbacks',async()=>{
        for(const abandon of [false,true]){
            const h=navigationFixture(),{f}=h,r=f.render(),task=defer();await r.settle();await fill(r);await choose(f,r);
            f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')?task.promise:null;
            const save=button(r,'Save Visit').props.onPress,pending=save();await r.settle();await click(r,'Back');assert(textOf(r.output).includes('Leave this save?'));
            await click(r,abandon?'Leave Anyway':'Stay and Keep Submission');assert.equal(posts(f).length,1);
            if(abandon){assert.equal(h.current().name,'groups');r.unmount();}
            else assert.equal(h.current().name,'add-visit');
            task.resolve(f.commit(posts(f)[0]));await pending;if(!abandon)await r.settle();await save();
            assert.equal(posts(f).length,1);assert.equal(f.visits.length,1);assert.equal(h.current().name,abandon?'groups':'group/[id]/restaurant/[entryId]');assert.equal(f.rt.world.lateUpdates,0);r.unmount();
        }
        // A confirmed outcome while the warning is open makes the warning stale.
        for(const outcome of ['success','rollback']){
            const h=navigationFixture(),{f}=h,r=f.render(),task=defer();await r.settle();await fill(r);
            f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')?task.promise:null;
            const pending=button(r,'Save Visit').props.onPress();await r.settle();await click(r,'Back');assert(textOf(r.output).includes('Leave this save?'));
            if(outcome==='success'){f.rt.emit('background');await r.settle();}
            task.resolve(outcome==='success'?f.commit(posts(f)[0]):response({code:'40001',message:'Confirmed rollback'},500));await pending;await r.settle();
            assert.equal(nodes(r.output).filter(n=>n.type==='Modal').length,0);assert.equal(h.current().name,'add-visit');
            if(outcome==='success'){f.rt.emit('active');await r.settle();await click(r,'Continue to Groups');assert.equal(f.visits.length,1);}
            else{await enter(r,'Visit notes','Correction after rollback');await click(r,'Back');await click(r,'Discard');assert.equal(h.current().name,'groups');}
            assert.equal(posts(f).length,1);r.unmount();
        }
    });
    await test('Intentional abandonment dispatches the exact pending removal; reentry never automatically retries the discarded identity',async()=>{
        for(const action of ['back','ios-swipe','replace','reset']){
            const h=navigationFixture(),{f}=h,r=f.render();await r.settle();await fill(r);await choose(f,r);
            f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')?(f.commit(c),response({code:'',message:'Lost response'},503)):null;
            await click(r,'Save Visit');const original=posts(f)[0],staleRetry=button(r,'Retry Same Visit Save').props.onPress;
            const removal=action==='replace'?{type:'REPLACE',payload:{name:'groups'}}:action==='reset'?{type:'RESET',payload:{index:0,routes:[{name:'groups'}]}}:{type:'POP',payload:{count:1},source:h.current().key};
            if(action==='back')await click(r,'Back');else h.request(removal);await r.settle();await click(r,'Leave Anyway');
            if(action!=='back')assert.equal(h.dispatched.at(-1),removal,'Replay the exact approved navigation action');
            assert.equal(h.current().name,'groups');r.unmount();await staleRetry();assert.equal(posts(f).length,1);
            f.rt.world.override=null;h.router.push('/add-visit');const reopened=f.render();await reopened.settle();assert.equal(posts(f).length,1);assert.equal(f.visits.length,1);assert(!textOf(reopened.output).includes('Retry Same Visit Save'));
            // A deliberate NEW save, after reviewing the existing group visits,
            // is distinct from a retry and receives a fresh request identity.
            await fill(reopened);await choose(f,reopened);await click(reopened,'Save Visit');assert.notEqual(posts(f)[1].body.client_request_id,original.body.client_request_id);assert.equal(f.visits.length,2);reopened.unmount();
        }
    });
    await test('Account changes/sign-out dispose the guard and confirmation; stale confirmation callbacks cannot navigate the replacement account',async()=>{
        for(const account of ['b',null]){
            const h=navigationFixture(),{f}=h,r=f.render();await r.settle();await fill(r);
            f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')?response({code:'',message:'Lost response'},503):null;
            await click(r,'Save Visit');await click(r,'Back');const staleLeave=button(r,'Leave Anyway').props.onPress;
            f.rt.switch(account,r);await r.settle();assert.equal(nodes(r.output).filter(n=>n.type==='Modal').length,0);await staleLeave();assert.equal(h.current().name,'add-visit');
            assert.equal(h.request({type:'POP',payload:{count:1}}),false);assert.equal(h.current().name,'groups');assert.equal(f.rt.world.lateUpdates,0);r.unmount();
        }
    });
    await test('Server-returned 40P01/40001/57014 initially confirm rollback and permit corrected fields with a fresh intentional request',async()=>{
        for(const code of ['40P01','40001','57014']){
            const f=setup(),r=f.render();await r.settle();await fill(r);await choose(f,r);let n=0;
            f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')&&++n===1?response({code,message:'Database rollback'},500):null;
            await click(r,'Save Visit');assert.equal(f.visits.length,0);assert(textOf(r.output).includes('rolled back without saving'));const original=posts(f)[0];
            assert([...f.rt.world.removalGuards].some(g=>g.current.enabled), 'Corrected dirty draft is guarded after rollback');await enter(r,'Visit notes','Corrected intentional visit');await click(r,'Close Apple Maps picker');await choose(f,r);await click(r,'Save Visit');
            assert.equal(f.visits.length,1);assert.notEqual(posts(f)[1].body.client_request_id,original.body.client_request_id);assert.equal(posts(f)[1].body.visit_notes,'Corrected intentional visit');r.unmount();
        }
    });
    await test('An earlier uncertain commit remains frozen and guarded after a later server-returned rollback',async()=>{
        for(const code of ['40P01','40001','57014']){
            const f=setup(),r=f.render();await r.settle();await fill(r);await choose(f,r);let n=0;
            f.rt.world.override=c=>{if(!c.url.pathname.includes('/rpc/save_restaurant_visit'))return null;if(++n===1){f.commit(c);return response({code:'',message:'Lost response'},503);}return n===2?response({code,message:'Confirmed later rollback'},500):null;};
            await click(r,'Save Visit');await click(r,'Retry Same Visit Save');assert(textOf(r.output).includes('uncertain'));assert(nodes(r.output).filter(n=>n.type==='TextInput').every(n=>n.props.editable===false));
            await click(r,'Back');assert(textOf(r.output).includes('Leave this save?'));await click(r,'Stay and Keep Submission');await click(r,'Retry Same Visit Save');
            assert.equal(f.visits.length,1);assert.deepEqual(posts(f)[1].body,posts(f)[0].body);assert.deepEqual(posts(f)[2].body,posts(f)[0].body);r.unmount();
        }
    });
    await test('Local aborts/transport errors with PostgreSQL-looking codes remain uncertain; only actual HTTP rejections can confirm rollback',async()=>{
        for(const code of ['40P01','40001','57014']){
            for(const name of ['AbortError','TypeError']){
                const f=setup(),r=f.render();await r.settle();await fill(r);let n=0;
                const local=Object.assign(new Error('Synthetic local cancellation'),{code,name,status:500});
                const api=f.rt.load('@/lib/group-visit-save');assert.equal(api.isDefinitiveVisitRejection(local),false);assert.equal(api.isDefinitiveVisitRejection({code,status:500,message:'Imitation server error'}),false);
                f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')&&++n===1?Promise.reject(local):null;
                await click(r,'Save Visit');assert(textOf(r.output).includes('uncertain'));assert([...f.rt.world.removalGuards].some(g=>g.current.enabled));await click(r,'Retry Same Visit Save');
                assert.deepEqual(posts(f)[1].body,posts(f)[0].body);assert.equal(f.visits.length,1);r.unmount();
            }
        }
    });
    await test('A local save deadline is uncertain even when a genuine rollback response arrives later',async()=>{
        const f=setup(),r=f.render(),task=defer();await r.settle();await fill(r);let n=0;
        f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')&&++n===1?task.promise:null;
        const pending=button(r,'Save Visit').props.onPress();await r.settle();await f.time.advance(20000,r);await pending;await r.settle();
        task.resolve(response({code:'57014',message:'Late server cancellation'},500));await r.settle();assert(textOf(r.output).includes('uncertain'));await click(r,'Retry Same Visit Save');
        assert.deepEqual(posts(f)[1].body,posts(f)[0].body);assert.equal(f.visits.length,1);r.unmount();
    });
    await test('Background success remains completed; Continue never resends and uses frozen destinations',async()=>{
        const task=defer(),f=setup(),r=f.render();await r.settle();await fill(r);await choose(f,r);
        f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')?task.promise:null;
        const save=button(r,'Save Visit').props.onPress,pending=save();await r.settle();f.rt.emit('background');await r.settle();task.resolve(f.commit(posts(f)[0]));await pending;await r.settle();
        assert.equal(f.rt.world.navigation.length,0);f.rt.emit('active');await r.settle();await save();assert.equal(posts(f).length,1);
        await click(r,'Continue to Groups');assert.equal(f.rt.world.navigation.at(-1).params.id,ga);assert.equal(posts(f).length,1);r.unmount();
    });
    await test('Definitive initial rejection permits correction; rejection after uncertainty keeps the original save locked',async()=>{
        for(const uncertain of [false,true]){
            const f=setup(),r=f.render();await r.settle();await fill(r);await choose(f,r);
            let n=0;f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')?response({code:uncertain&&++n===1?'':'42501',message:'You must be a current member of every selected group.'},403):null;
            await click(r,'Save Visit');if(uncertain)await click(r,'Retry Same Visit Save');
            const input=nodes(r.output).find(n=>n.props?.accessibilityLabel==='Visit notes');assert.equal(input.props.editable,!uncertain);
            if(uncertain){assert.equal(posts(f).length,2);assert.deepEqual(posts(f)[0].body,posts(f)[1].body);assert(textOf(r.output).includes('Retry Same Visit Save'));}r.unmount();
        }
    });
    await test('Preflight account switch dispatches no Apple save; late account response never navigates or leaks',async()=>{
        for(const beforeDispatch of [true,false]){
            const f=setup(),r=f.render();await r.settle();await fill(r);await choose(f,r);const task=defer();
            if(beforeDispatch)f.rt.supabase.auth.getSession=()=>task.promise;
            else f.rt.world.override=c=>c.url.pathname.includes('/rpc/save_restaurant_visit')?task.promise:null;
            const save=button(r,'Save Visit').props.onPress,pending=save();await r.settle();f.rt.switch('b',r);await r.settle();
            task.resolve(beforeDispatch?{data:{session:f.rt.world.auth.session},error:null}:response([{restaurant_id:restaurantId,bindings_recorded:true}]));await pending;await r.settle();await save();
            assert.equal(posts(f).length,beforeDispatch?0:1);assert.equal(f.rt.world.navigation.length,0);assert.equal(f.rt.world.lateUpdates,0);assert(!textOf(r.output).includes('Transient Apple'));r.unmount();
        }
    });
    await test('Address/name/destination edits, blur, background and access refresh discard picker IDs and stale callbacks',async()=>{
        for(const action of ['address','name','group','blur','background','refresh','access']){
            const f=setup(),r=f.render();await r.settle();await fill(r);await choose(f,r);const stale=candidates(r)[0].props.onPress;
            if(action==='address')await enter(r,'Restaurant address','Changed address');else if(action==='name')await enter(r,'Restaurant name','Changed name');
            else if(action==='group'){nodes(r.output).find(n=>n.props?.accessibilityRole==='checkbox'&&textOf(n.props.children).trim()==='Dinner B').props.onPress();await r.settle();}
            else if(action==='blur'){f.rt.world.focused=false;r.dirty=true;await r.settle();f.rt.world.focused=true;r.dirty=true;}
            else if(action==='background'){f.rt.emit('inactive');f.rt.emit('active');}
            else {if(action==='access')f.state.groups=[];await click(r,'Refresh Groups');}
            await r.settle();stale();await r.settle();assert.equal(markers(r).length,0);
            if(action==='access'){f.state.groups=[group];await click(r,'Refresh Groups');nodes(r.output).find(n=>n.props?.accessibilityRole==='checkbox').props.onPress();await r.settle();}
            await click(r,'Save Visit');assert.equal(posts(f)[0].url.pathname,'/rest/v1/rpc/save_restaurant_visit');r.unmount();
        }
    });
    await test('Release builds omit Apple IDs even with injected retained selection; unavailable native builds save normally',async()=>{
        for(const options of [{development:false},{missing:true},{platform:'android'}]){
            const f=setup(options),r=f.render();await r.settle();await fill(r);
            if(options.development===false)assert(!textOf(r.output).includes('Choose Apple Maps place'));else await click(r,'Choose Apple Maps place (optional)');
            await click(r,'Save Visit');assert(!('restaurant_apple_place_id'in posts(f)[0].body));assert.equal(f.nativeCalls.length,0);r.unmount();
        }
        const f=setup({development:false}),api=f.rt.load('@/lib/group-visit-save');const fields={target_group_ids:[gb,ga,ga],restaurant_name:' Cafe ',restaurant_address:' Address '};
        const frozen=api.freezeGroupVisitSubmission('a',fields,'Injected ID');fields.target_group_ids[0]='changed';fields.restaurant_name='changed';
        assert(Object.isFrozen(frozen)&&Object.isFrozen(frozen.args)&&Object.isFrozen(frozen.args.target_group_ids));assert.deepEqual([...frozen.args.target_group_ids],[ga,gb]);assert.equal(frozen.args.restaurant_name,'Cafe');assert.equal(frozen.rpc,'save_restaurant_visit');assert(!('restaurant_apple_place_id'in frozen.args));
    });
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
