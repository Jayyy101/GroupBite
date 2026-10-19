// Account-switch mutation regressions using the installed Supabase client and
// actual forms/components. Synthetic sessions and mocked transport only.
const assert = require('node:assert/strict');
const { runtime, response, screen, enter, nodes, textOf } = require('./personal-places.cjs');
const groupId = '22222222-2222-2222-2222-222222222222';
const defer = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; };
const handler = (r,label) => {
    const node=nodes(r.output).find(n=>n.type==='Pressable' && textOf(n.props.children)===label);
    assert(node && !node.props.disabled, label); return node.props.onPress;
};
let checks=0;
async function test(label,fn) { await fn(); checks++; console.log('PASS '+label); }
(async()=>{
    for(const [label,input,value,rpc] of [['Create Group','New group name','A-only group','create_group'],['Request Access','Invite code','a'.repeat(64),'request_group_access']]) {
        await test(`${label} ignores late results and old handlers after account replacement`,async()=>{
            const pending=defer();const rt=runtime({fetch(call){
                if(call.method==='GET') return response([]);
                assert.equal(call.url.pathname,'/rest/v1/rpc/'+rpc);assert.equal(call.user,'a');return pending.promise;
            }});
            const r=screen(rt,rpc==='create_group'?'create-group':'join-group');await r.settle();await enter(r,input,value);
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
