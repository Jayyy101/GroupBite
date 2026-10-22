// Offline recovery coordinator + actual TSX UI. No environment/network/native DB.
const assert=require('node:assert/strict');
const {model,fields,destinations,posts}=require('./unified-add.cjs');
const {response,click,button,nodes,textOf}=require('./personal-places.cjs');
const active='groupbite:add-recovery:v1:a',archive='groupbite:add-recovery-history:v1:a';
const marker={requestId:'old-request',kind:'personal'};
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function deadlines(){let id=0;const timers=new Map();return {setTimeout(fn){const handle=++id;timers.set(handle,fn);return handle;},
 clearTimeout(handle){timers.delete(handle);},expire(){for(const [handle,fn] of [...timers]){timers.delete(handle);fn();}}};}
const has=(r,label)=>nodes(r.output).some(n=>n.type==='Pressable'&&textOf(n.props.children)===label);
function storage(){return {values:new Map(),operations:[],failActiveRead:false,failArchiveRead:false,failArchiveWrite:false,failWrite:false,failRemove:false,holdArchive:null,
 async getItem(k){this.operations.push(['read',k]);if((k===active&&this.failActiveRead)||(k===archive&&this.failArchiveRead))throw Error('private raw storage failure');return this.values.get(k)??null;},
 async setItem(k,v){this.operations.push(['write',k]);if(this.failWrite||(k===archive&&this.failArchiveWrite))throw Error('private raw storage failure');
  if(k===archive&&this.holdArchive)await this.holdArchive.promise;this.values.set(k,v);},
 async removeItem(k){this.operations.push(['remove',k]);if(this.failRemove)throw Error('private raw storage failure');this.values.delete(k);}};}
function host(f,name='add'){let coordinator;const Provider=f.rt.load('@/providers/unified-add'),Screen=f.rt.load('app/'+name).default;
 const r=f.rt.render(()=>{coordinator=Provider.useUnifiedAdd().coordinator;return {type:Screen,props:{}};});return {r,get coordinator(){return coordinator;}};}
async function failed(f,c){f.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?response({code:'42501'},403):null;await c.start(fields(),destinations().slice(0,1),()=>true);}
async function uncertain(f,c,commit=false){f.state.override=call=>{if(!(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal')))return null;if(commit)f.commit(call);return response({},503);};await c.start(fields(),destinations().slice(0,1),()=>true);}
let passed=0;const test=async(label,fn)=>{await fn();passed++;console.log('PASS '+label);};

(async()=>{
 await test('Definite failure needs explicit confirmation; reset preserves markers and creates no mutation',async()=>{
  const store=storage(),f=model({storage:store}),h=host(f);await h.r.settle();await failed(f,h.coordinator);await h.r.settle();
  const original=posts(f).length;await click(h.r,'Start a separate Add');assert(textOf(h.r.output).includes('may already have succeeded'));
  assert(store.values.has(active));assert(!store.values.has(archive));await click(h.r,'Keep reviewing this save');assert(store.values.has(active));
  await click(h.r,'Start a separate Add');await click(h.r,'Confirm separate Add');assert.equal(posts(f).length,original);
  assert.equal(h.coordinator.state.attempts.length,0);assert(!h.coordinator.state.error);assert(!store.values.has(active));
  assert(has(h.r,'Enter Restaurant Manually'));assert(has(h.r,'Previous save recovery'));
  await click(h.r,'Previous save recovery');assert(textOf(h.r.output).includes('Confirmed not saved'));assert(!has(h.r,'Retry My Places'));h.r.unmount();
 });
 await test('Separate saves use independent identities and old callbacks cannot replay archived attempts',async()=>{
  const f=model({storage:storage()}),c=await f.coordinator();await uncertain(f,c);const old=c.state.attempts[0].requestId,expected=c.state;
  assert.equal(await c.startSeparate(expected,()=>true),'started');assert.equal(await c.startSeparate(expected,()=>true),'stale');
  await c.sendPending(()=>true,old);assert.equal(posts(f).length,1);f.state.override=null;
  await c.start(fields(),destinations().slice(0,1),()=>true);assert.equal(posts(f).length,2);assert.notEqual(posts(f)[1].body.client_request_id,old);
  assert.equal(c.state.previous[0].attempts[0].requestId,old);assert(!c.state.previous[0].attempts[0].submission);
 });
 await test('Mixed confirmed/uncertain results survive archive and restart; checking old receipts never resends',async()=>{
  const store=storage(),f=model({storage:store}),c=await f.coordinator();
  f.state.override=call=>{if((call.url.pathname.endsWith('/save_group_visit_destination') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'group'))){f.commit(call);return response({},503);}return null;};
  await c.start(fields(),destinations().slice(0,2),()=>true);assert.deepEqual(c.state.attempts.map(a=>a.status),['saved','uncertain']);
  await c.startSeparate(c.state,()=>true);assert.equal(c.state.previous[0].attempts.map(a=>a.status).join(','),'saved,uncertain');
  assert(c.state.previous[0].attempts[0].result);const bytes=store.values.get(archive);
  for(const privateValue of ['PRIVATE','SHARED','Cafe','fake-a','Apple opaque','mapkitPoint','submission'])assert(!bytes.includes(privateValue),privateValue);
  c.dispose();const restored=await f.coordinator();assert.equal(restored.state.previous[0].attempts.map(a=>a.status).join(','),'saved,uncertain');
  assert.equal(restored.state.attempts.length,0);await restored.checkPrevious(restored.state.previous[0].id,()=>true);
  assert(restored.state.previous[0].attempts.every(a=>a.status==='saved'));assert.equal(posts(f).length,2);
  const again=await f.coordinator();assert(again.state.previous[0].attempts.every(a=>a.status==='saved'));
 });
 await test('A missing old receipt stays uncertain and a later commit is discoverable alongside a newer workflow',async()=>{
  const f=model({storage:storage()}),c=await f.coordinator();await uncertain(f,c);const old=posts(f)[0];await c.startSeparate(c.state,()=>true);
  const id=c.state.previous[0].id;await c.checkPrevious(id,()=>true);assert.equal(c.state.previous[0].attempts[0].status,'uncertain');
  f.state.override=null;await c.start(fields(),destinations().slice(0,1),()=>true);const newer=c.state.attempts[0].requestId;
  f.commit(old);await c.checkPrevious(id,()=>true);assert.equal(c.state.previous[0].attempts[0].status,'saved');assert.equal(c.state.attempts[0].requestId,newer);
  assert.equal(posts(f).length,2);assert.equal(f.state.visits.length,2); // separate intentional save, not an automatic replay
 });
 await test('Journal write failure dispatches nothing and can move known-unsent markers into previous recovery',async()=>{
  const store=storage(),f=model({storage:store}),c=await f.coordinator();store.failWrite=true;
  await c.start(fields(),destinations().slice(0,1),()=>true);assert(c.state.error);assert.equal(posts(f).length,0);
  store.failWrite=false;assert.equal(await c.startSeparate(c.state,()=>true),'started');assert.equal(c.state.previous[0].attempts[0].status,'pending');
  await c.start(fields(),destinations().slice(0,1),()=>true);assert.equal(posts(f).length,1);
 });
 await test('Corrupt recovery is quarantined exactly; usable request IDs are salvaged and remain checkable after restart',async()=>{
  for(const raw of ['{broken',JSON.stringify([marker,{requestId:7,kind:'unknown'}])]){
   const store=storage();store.values.set(active,raw);const f=model({storage:store}),c=await f.coordinator();assert(c.state.error);
   assert.equal(await c.startSeparate(c.state,()=>true),'started');const records=JSON.parse(store.values.get(archive));assert.equal(records[0].raw,raw);
   assert(c.state.previous[0].unreadable);const restarted=await f.coordinator();assert(!restarted.state.error);assert.equal(restarted.state.previous[0].attempts.length,raw[0]==='['?1:0);
   await restarted.checkPrevious(restarted.state.previous[0].id,()=>true);assert.equal(posts(f).length,0);
  }
 });
 await test('Archive storage failure requires a second warning; temporary recovery keeps old evidence and blocks unsafe new writes',async()=>{
  const store=storage(),f=model({storage:store}),h=host(f);await h.r.settle();await uncertain(f,h.coordinator);await h.r.settle();const raw=store.values.get(active);
  store.failArchiveWrite=true;await click(h.r,'Start a separate Add');await click(h.r,'Confirm separate Add');
  assert(has(h.r,'Start with temporary recovery'));assert(textOf(h.r.output).includes('Restart or sign-out may lose'));
  assert(store.values.has(active));assert.equal(h.coordinator.state.attempts.length,1);assert(!textOf(h.r.output).includes('private raw storage failure'));
  await click(h.r,'Start with temporary recovery');assert(has(h.r,'Enter Restaurant Manually'));assert.equal(store.values.get(active),raw);
  assert.equal(h.coordinator.state.previous[0].durable,false);await h.coordinator.start(fields(),destinations().slice(0,1),()=>true);
  assert.equal(posts(f).length,1);assert.equal(store.values.get(active),raw);assert(h.coordinator.state.error);
  store.failArchiveWrite=false;await h.coordinator.startSeparate(h.coordinator.state,()=>true);f.state.override=null;
  await h.coordinator.start(fields(),destinations().slice(0,1),()=>true);assert.equal(posts(f).length,2);
  assert(h.coordinator.state.previous.every(record=>record.durable));h.r.unmount();
 });
 await test('Unreadable active storage can open a warned fresh draft; recovered storage captures original IDs before replacement',async()=>{
  const store=storage(),raw=JSON.stringify([marker]);store.values.set(active,raw);store.failActiveRead=true;
  const f=model({storage:store}),c=await f.coordinator();assert(c.state.error);
  assert.equal(await c.startSeparate(c.state,()=>true),'storage-unavailable');assert.equal(await c.startSeparate(c.state,()=>true,true),'started');
  assert.equal(store.values.get(active),raw);store.failActiveRead=false;await c.start(fields(),destinations().slice(0,1),()=>true);
  assert.equal(c.state.previous[0].attempts[0].requestId,marker.requestId);assert.equal(c.state.previous[0].durable,true);
  assert.equal(JSON.parse(store.values.get(archive))[0].raw,raw);assert.equal(posts(f).length,1);
 });
 await test('Interrupted archive-before-remove retains both copies; an explicit retry deduplicates the archive',async()=>{
  const store=storage(),f=model({storage:store}),c=await f.coordinator();await uncertain(f,c);store.failRemove=true;
  assert.equal(await c.startSeparate(c.state,()=>true),'storage-unavailable');assert(store.values.has(active));assert(store.values.has(archive));
  assert.equal(JSON.parse(store.values.get(archive)).length,1);store.failRemove=false;
  assert.equal(await c.startSeparate(c.state,()=>true),'started');assert.equal(JSON.parse(store.values.get(archive)).length,1);assert.equal(posts(f).length,1);
  const writes=store.operations.findIndex(([op,k])=>op==='write'&&k===archive),remove=store.operations.findIndex(([op])=>op==='remove');assert(writes<remove);
 });
 await test('Repeated confirm taps archive once; pending save and archive operations block normal navigation',async()=>{
  const store=storage(),f=model({storage:store}),h=host(f);await h.r.settle();await failed(f,h.coordinator);await h.r.settle();
  await click(h.r,'Start a separate Add');const handler=button(h.r,'Confirm separate Add').props.onPress;store.holdArchive=defer();
  const task=handler();await handler();await h.r.settle();assert(h.coordinator.state.busy);assert(f.rt.attemptRemoval({type:'GO_BACK'}));await h.r.settle();
  assert(textOf(h.r.output).includes('Save in progress'));assert(!has(h.r,'Leave Anyway'));store.holdArchive.resolve();await task;await h.r.settle();
  assert.equal(JSON.parse(store.values.get(archive)).length,1);assert.equal(posts(f).length,1);h.r.unmount();
  const other=model({storage:storage()}),c=await other.coordinator(),gate=defer();other.state.override=call=>(call.url.pathname.endsWith('/save_personal_visit') || (call.url.pathname.endsWith('/save_visit_event_destination') && call.body.destination_kind === 'personal'))?gate.promise:null;
  const pending=c.start(fields(),destinations().slice(0,1),()=>true);await new Promise(r=>setImmediate(r));
  assert.equal(await c.startSeparate(c.state,()=>true),'stale');gate.resolve(response({},503));await pending;
 });
 await test('Leaving an unconfirmed recovery prompt preserves markers and invalidates old confirmation callbacks',async()=>{
  const store=storage(),f=model({storage:store}),h=host(f);await h.r.settle();await uncertain(f,h.coordinator);await h.r.settle();
  await click(h.r,'Start a separate Add');const stale=button(h.r,'Confirm separate Add').props.onPress;
  await click(h.r,'Finish Reviewing');await click(h.r,'Leave Anyway');assert(store.values.has(active));assert(!store.values.has(archive));
  h.r.unmount();await stale();assert(!store.values.has(archive));assert.equal(posts(f).length,1);
 });
 await test('Account changes during confirmation/preflight/storage cannot reset or navigate another account',async()=>{
  for(const phase of ['confirmation','preflight','storage']){
   const store=storage(),f=model({storage:store}),h=host(f);await h.r.settle();await uncertain(f,h.coordinator);await h.r.settle();await click(h.r,'Start a separate Add');
   const handler=button(h.r,'Confirm separate Add').props.onPress,gate=defer();let task;
   if(phase==='preflight'){f.rt.supabase.auth.getSession=()=>gate.promise;task=handler();await h.r.settle();}
   if(phase==='storage'){store.holdArchive=gate;task=handler();await h.r.settle();}
   f.rt.switch('b',h.r);await h.r.settle();if(phase==='preflight')gate.resolve({data:{session:f.rt.world.auth.session},error:null});else gate.resolve();
   if(task)await task;await handler();await h.r.settle();assert.equal(f.rt.world.navigation.length,0);assert.equal(f.rt.world.lateUpdates,0);
   assert(!store.values.has('groupbite:add-recovery-history:v1:b'));assert(!textOf(h.r.output).includes('old-request'));assert.equal(posts(f).length,1);h.r.unmount();
  }
 });
 await test('Older confirmation snapshots cannot discard later results or a replacement workflow',async()=>{
  const f=model({storage:storage()}),c=await f.coordinator();await uncertain(f,c);const old=c.state;
  f.commit(posts(f)[0]);await c.reconcile(()=>true);assert.equal(await c.startSeparate(old,()=>true),'stale');assert.equal(c.state.attempts[0].status,'saved');
 });
 await test('Previous recovery reads fail visibly and retry without clearing active results; malformed archive bytes are retained',async()=>{
  const store=storage();store.values.set(archive,'{bad-history');const f=model({storage:store}),c=await f.coordinator();assert(c.state.previous[0].unreadable);
  await uncertain(f,c);await c.startSeparate(c.state,()=>true);assert(JSON.parse(store.values.get(archive)).some(row=>row.raw==='{bad-history'));
  store.failArchiveRead=true;const restarted=await f.coordinator();assert(restarted.state.historyError);assert(!restarted.state.attempts.length);
  store.failArchiveRead=false;await restarted.refreshPrevious(()=>true);assert.equal(restarted.state.previous.length,2);assert.equal(posts(f).length,1);
 });
 await test('User can re-read a transiently unreadable active journal without starting or retrying a write',async()=>{
  const store=storage();store.values.set(active,JSON.stringify([marker]));store.failActiveRead=true;
  const f=model({storage:store}),c=await f.coordinator();assert(c.state.error);store.failActiveRead=false;
  await c.reconcile(()=>true);assert(!c.state.error);assert.equal(c.state.attempts[0].requestId,marker.requestId);assert.equal(posts(f).length,0);
 });
 await test('Timed-out archive work finishes before a newer journal and cannot erase or overwrite the new save',async()=>{
  const time=deadlines(),store=storage(),f=model({...time,storage:store}),c=await f.coordinator();await uncertain(f,c);const oldId=c.state.attempts[0].requestId;
  store.holdArchive=defer();const separating=c.startSeparate(c.state,()=>true);for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  time.expire();assert.equal(await separating,'storage-unavailable');assert.equal(await c.startSeparate(c.state,()=>true,true),'started');
  f.state.override=null;const saving=c.start(fields(),destinations().slice(0,1),()=>true);await new Promise(r=>setImmediate(r));assert.equal(posts(f).length,1);
  store.holdArchive.resolve();await saving;assert.equal(posts(f).length,2);const newId=c.state.attempts[0].requestId;assert.notEqual(newId,oldId);
  assert.equal(JSON.parse(store.values.get(active))[0].requestId,newId);assert(JSON.parse(store.values.get(archive)).some(record=>record.markers.some(row=>row.requestId===oldId)));
 });
 await test('Restart during temporary separation restores old recovery conservatively; no old write is reconstructed',async()=>{
  const store=storage(),f=model({storage:store}),c=await f.coordinator();await uncertain(f,c);const oldId=c.state.attempts[0].requestId;store.failArchiveWrite=true;
  await c.startSeparate(c.state,()=>true);await c.startSeparate(c.state,()=>true,true);c.dispose();
  const restarted=await f.coordinator();assert.equal(restarted.state.attempts[0].requestId,oldId);assert.equal(restarted.state.attempts[0].status,'uncertain');
  assert(!restarted.state.attempts[0].submission);await restarted.sendPending(()=>true);assert.equal(posts(f).length,1);
 });
 await test('Root and full-screen result exits both reach clean Add and old form callbacks cannot submit again',async()=>{
  for(const route of ['add','add-visit']){
   const f=model({storage:storage()}),h=host(f,route);await h.r.settle();const oldSave=route==='add-visit'?button(h.r,'Save Visit').props.onPress:null;
   await uncertain(f,h.coordinator);await h.r.settle();await click(h.r,'Start a separate Add');await click(h.r,'Confirm separate Add');
   const target=f.rt.world.navigation.at(-1);assert.equal(typeof target==='string'?target:target.pathname,'/add');assert.equal(h.coordinator.state.attempts.length,0);
   if(oldSave){await oldSave();await h.r.settle();}assert.equal(posts(f).length,1);h.r.unmount();
  }
 });
 await test('Archived group results respect revoked availability; failed receipt reads never downgrade known successes or retry',async()=>{
  const f=model({storage:storage()}),c=await f.coordinator();await c.start(fields(),destinations(),()=>true);await c.startSeparate(c.state,()=>true);
  const id=c.state.previous[0].id;f.state.override=call=>{
   if(!call.url.pathname.endsWith('/get_add_destination_result'))return null;
   const receipt=f.state.receipts.get(call.user+':'+call.body.client_request_id);
   return receipt.destination_kind==='group'?response([{...receipt,available:false,entry_id:null,visit_id:null}]):response({},503);
  };
  await c.checkPrevious(id,()=>true);assert(c.state.previous[0].attempts.every(a=>a.status==='saved'));
  assert(c.state.previous[0].attempts.filter(a=>a.destination.kind==='group').every(a=>a.result.available===false));assert.equal(posts(f).length,3);
 });
 await test('A later journal-write failure cannot replace the original quarantined corrupt evidence',async()=>{
  const store=storage();store.values.set(active,'{original-corrupt-source');const f=model({storage:store}),c=await f.coordinator();
  store.failArchiveWrite=true;await c.startSeparate(c.state,()=>true);await c.startSeparate(c.state,()=>true,true);const first=c.state.previous[0].id;
  store.failArchiveWrite=false;const write=store.setItem.bind(store);let loseNewWrite=true;
  store.setItem=async(k,v)=>{await write(k,v);if(k===active&&loseNewWrite){loseNewWrite=false;throw Error('lost storage acknowledgement');}};
  await c.start(fields(),destinations().slice(0,1),()=>true);assert(c.state.error);assert.equal(posts(f).length,0);
  await c.startSeparate(c.state,()=>true);assert.equal(JSON.parse(store.values.get(archive)).find(row=>row.id===first).raw,'{original-corrupt-source');
  assert(c.state.previous.every(previous=>previous.durable));assert.equal(posts(f).length,0);
 });
 await test('An empty read after unreadable recovery does not silently authorize a new workflow',async()=>{
  const store=storage();store.failActiveRead=true;const f=model({storage:store}),c=await f.coordinator();assert(c.state.error);
  store.failActiveRead=false;await c.reconcile(()=>true);assert(c.state.error.includes('does not prove'));
  await c.start(fields(),destinations().slice(0,1),()=>true);assert.equal(posts(f).length,0);
  assert.equal(await c.startSeparate(c.state,()=>true),'started');assert.equal(posts(f).length,0);
 });
 console.log(`${passed} offline unified Add recovery completion checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
