// Account-switch mutation regressions using the installed Supabase client and
// actual forms/components. Synthetic sessions and mocked transport only.
const assert = require('node:assert/strict');
const { runtime, response, screen, enter, nodes, textOf } = require('./personal-places.cjs');
const groupId = '22222222-2222-2222-2222-222222222222';
const group = { id: groupId, name: 'Fixture group', owner_user_id: 'a', created_at: '2026-10-11' };
const defer = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; };
const handler = (r,label) => {
    const node=nodes(r.output).find(n=>n.type==='Pressable' && textOf(n.props.children)===label);
    assert(node && !node.props.disabled, label); return node.props.onPress;
};
let checks=0;
async function test(label,fn) { await fn(); checks++; console.log('PASS '+label); }
(async()=>{
    await test('Group save is pinned to A, deduplicates taps, and cannot navigate after switching to B',async()=>{
        const pending=defer();
        const rt=runtime({ fetch(call) {
            if(call.url.pathname==='/rest/v1/groups') return response(call.user==='a'?[group]:[]);
            if(call.url.pathname==='/rest/v1/rpc/save_restaurant_visit') return pending.promise;
            assert.fail('Unexpected request '+call.url.pathname);
        } });
        rt.world.params={groupId}; const r=screen(rt,'add-visit'); await r.settle();
        await enter(r,'Restaurant name','A draft'); await enter(r,'Restaurant address','A address');
        const save=handler(r,'Save Visit'), attempt=save(); await save(); await r.settle();
        const mutations=rt.world.requests.filter(c=>c.method==='POST'); assert.equal(mutations.length,1); assert.equal(mutations[0].user,'a');
        rt.switch('b',r); await r.settle(); pending.resolve(response('44444444-4444-4444-4444-444444444444')); await attempt; await r.settle();
        assert.equal(rt.world.navigation.length,0); assert.equal(rt.world.lateUpdates,0);
        assert(!textOf(r.output).includes('A draft')); await save(); assert.equal(rt.world.requests.filter(c=>c.method==='POST').length,1); r.unmount();
    });
    await test('An account change during the save preflight dispatches no old draft under B',async()=>{
        const rt=runtime({fetch:call=>{assert.equal(call.url.pathname,'/rest/v1/groups');return response([group]);}});
        rt.world.params={groupId}; const r=screen(rt,'add-visit'); await r.settle();
        await enter(r,'Restaurant name','Old draft'); await enter(r,'Restaurant address','Old address');
        const pending=defer(); rt.supabase.auth.getSession=()=>pending.promise;
        const attempt=handler(r,'Save Visit')(); rt.switch('b',r); await r.settle();
        pending.resolve({data:{session:rt.world.auth.session},error:null}); await attempt; await r.settle();
        assert.equal(rt.world.requests.filter(c=>c.method==='POST').length,0); assert.equal(rt.world.lateUpdates,0); r.unmount();
    });
    await test('A completed background save keeps the current draft screen and does not navigate invisibly',async()=>{
        const pending=defer(); const rt=runtime({fetch:call=>call.method==='POST'?pending.promise:response([group])});
        rt.world.params={groupId}; const r=screen(rt,'add-visit'); await r.settle();
        await enter(r,'Restaurant name','Background draft'); await enter(r,'Restaurant address','Background address');
        const attempt=handler(r,'Save Visit')(); await r.settle(); rt.emit('background'); await r.settle();
        pending.resolve(response('44444444-4444-4444-4444-444444444444')); await attempt; await r.settle();
        assert.equal(rt.world.navigation.length,0); assert.equal(rt.world.requests.filter(c=>c.method==='POST').length,1); r.unmount();
    });
    for(const [label,input,value,rpc] of [['Create Group','New group name','A-only group','create_group'],['Request Access','Invite code','a'.repeat(64),'request_group_access']]) {
        await test(`${label} ignores late results and old handlers after account replacement`,async()=>{
            const pending=defer();const rt=runtime({fetch(call){
                if(call.method==='GET') return response([]);
                assert.equal(call.url.pathname,'/rest/v1/rpc/'+rpc);assert.equal(call.user,'a');return pending.promise;
            }});
            const r=screen(rt,'groups');await r.settle();await enter(r,input,value);
            const action=handler(r,label), attempt=action();await action();await r.settle();
            assert.equal(rt.world.requests.filter(c=>c.method==='POST').length,1);
            rt.switch('b',r);await r.settle();pending.resolve(response('fixture-result'));await attempt;await r.settle();await action();
            assert.equal(rt.world.lateUpdates,0);assert.equal(rt.world.requests.filter(c=>c.method==='POST').length,1);r.unmount();
        });
    }
    await test('Disposed Visit edit/delete callbacks cannot issue a mutation for a replacement account',async()=>{
        for(const action of ['edit','delete']) {
            const rt=runtime();const Component=rt.load('@/components/visit-management').VisitManagement;
            const callbacks=[];
            function Harness(){return {type:Component,key:rt.world.auth.session?.user.id,props:{action,
                visit:{id:'visit',visited_on:null,rating:null,would_go_again:null,notes:'A notes'},
                scope:{target_group_id:groupId,target_group_restaurant_id:'entry',target_visit_id:'visit'},
                onCancel(){},onBusyChange:value=>callbacks.push(value),onComplete(){assert.fail('Unexpected completion');}}};}
            const r=rt.render(Harness);await r.settle();const submit=handler(r,action==='edit'?'Save Changes':'Confirm Delete Visit');
            rt.switch('b',r);await r.settle();await submit();assert.equal(rt.world.requests.length,0);assert.equal(callbacks.length,0);r.unmount();
        }
    });
    console.log(`${checks} offline stabilization checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
