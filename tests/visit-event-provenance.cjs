// Actual coordinator and HTTP boundary. SQL authority/concurrency is separately
// exercised by the explicitly disposable --visit-events database runner.
const assert = require('node:assert/strict');
const {model,fields,destinations,posts}=require('./unified-add.cjs');
const {response}=require('./personal-places.cjs');
let passed=0;
async function test(label,fn){await fn();passed++;console.log('PASS '+label);}
(async()=>{
    await test('One frozen action shares an opaque event while every destination retains a unique request',async()=>{
        const f=model(),a=f.api.freezeAddSubmissions('a',fields(),destinations()),b=f.api.freezeAddSubmissions('a',fields(),destinations());
        assert.equal(new Set(a.map(s=>s.eventId)).size,1);assert(a.every(s=>/^[a-zA-Z0-9-]{1,100}$/.test(s.eventId)));
        assert.equal(new Set(a.map(s=>s.args.client_request_id)).size,3);assert.notEqual(a[0].eventId,b[0].eventId);
        assert.equal(a[0].args.visit_notes,'PRIVATE');assert(a.slice(1).every(s=>s.args.visit_notes==='SHARED'));
    });
    await test('Partial retry retains event and destination identity without replaying confirmed saves',async()=>{
        const f=model(),c=await f.coordinator();let rejected=false;
        f.state.override=call=>{if(call.body?.destination_kind==='group'&&!rejected){rejected=true;return response({code:'42501'},403);}return null;};
        await c.start(fields(),destinations(),()=>true);assert.deepEqual(c.state.attempts.map(a=>a.status),['saved','failed','saved']);
        const previous=posts(f).map(p=>p.body),failed=c.state.attempts[1];f.state.override=null;
        await c.sendPending(()=>true,failed.requestId);assert.equal(posts(f).length,4);assert.deepEqual(posts(f)[3].body,previous[1]);
        assert(posts(f).every(p=>p.url.pathname.endsWith('/save_visit_event_destination')));
        assert.equal(new Set(posts(f).map(p=>p.body.client_event_id)).size,1);assert.equal(f.state.visits.length,3);
    });
    await test('Restart preserves event proof but sends only receipt reads after an uncertain response',async()=>{
        const f=model(),c=await f.coordinator();f.state.override=call=>{if(call.body?.destination_kind==='personal'){f.commit(call);return response({},503);}return null;};
        await c.start(fields(),destinations().slice(0,1),()=>true);assert.equal(c.state.attempts[0].status,'uncertain');
        const event=c.state.attempts[0].eventId,journal=JSON.stringify([...f.store.values]);
        assert(journal.includes(event));for(const secret of ['PRIVATE','SHARED','client_event_id','restaurant_address','fake-a'])assert(!journal.includes(secret));
        f.state.override=null;const restored=await f.coordinator();assert.equal(restored.state.attempts[0].eventId,event);
        assert.equal(restored.state.attempts[0].submission,undefined);await restored.sendPending(()=>true);await restored.reconcile(()=>true);
        assert.equal(restored.state.attempts[0].status,'saved');assert.equal(posts(f).length,1);assert.equal(f.state.visits.length,1);
    });
    await test('A pending backend blocks a new linked save explicitly, with no legacy downgrade',async()=>{
        const f=model(),c=await f.coordinator();f.state.override=call=>call.url.pathname.endsWith('/save_visit_event_destination')?response({code:'PGRST202'},404):null;
        await c.start(fields(),destinations().slice(0,1),()=>true);assert.equal(c.state.attempts[0].status,'failed');
        assert(c.state.attempts[0].message.includes('pending backend update'));assert.equal(posts(f).length,1);assert.equal(f.state.visits.length,0);
    });
    await test('A legacy frozen submission keeps its original RPC and cannot fabricate shared provenance',async()=>{
        const f=model(),{eventId,...old}=f.api.freezeAddSubmissions('a',fields(),destinations().slice(0,1))[0];
        await f.api.sendAddSubmission(old,()=>true);assert(posts(f)[0].url.pathname.endsWith('/save_personal_visit'));
        assert.equal(posts(f)[0].body.client_event_id,undefined);assert.equal(f.state.visits.length,1);assert(eventId);
    });
    console.log(`${passed} visit-event client checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
