// Actual Unified Add and photo TSX composition. Native/HTTP boundaries are fake.
const assert=require('node:assert/strict');
const {model,posts}=require('./unified-add.cjs');
const {runtime,click,enter,button,nodes,textOf}=require('./personal-places.cjs');
const asset={id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',image:'draft-image.jpg',thumbnail:'draft-thumbnail.jpg',width:1600,height:1200,bytes:100,thumbnailBytes:20};
function setup(select=async()=>[asset]){
    const recorded=[],events=[];
    const jobs={ready:true,busy:false,error:'',jobs:[],async stageAdd(photos,submissions,shared){recorded.push({photos,submissions,shared});events.push('stage');},async run(){events.push('upload');}};
    const f=model({mocks:{'@/providers/visit-photos':{usePhotoJobs:()=>jobs},'@/lib/visit-photo-files':{MAX_PHOTO_SELECTION:6,
        MAX_VISIT_PHOTOS:12,photoFile:()=>({uri:'file:///synthetic-thumbnail.jpg'}),selectVisitPhotos:select}}});
    return {...f,jobs,recorded,events};
}
async function toggle(r,label){const n=nodes(r.output).find(n=>n.props?.accessibilityRole==='checkbox'&&n.props.accessibilityLabel===label);assert(n,'Missing checkbox '+label);n.props.onPress();await r.settle();}
async function fill(r){await enter(r,'Restaurant name','Photo cafe');await enter(r,'Restaurant address','Photo address');}
let passed=0;async function test(label,fn){await fn();passed++;console.log('PASS '+label);}
(async()=>{
    await test('Photo/calendar preview routes expose no UI or requests in production and cannot be auth return destinations',async()=>{
        const mocks=Object.fromEntries(['table','pizza','restaurant'].map(name=>[`@/assets/phase-g-preview/${name}.jpg`,1]));
        for(const route of ['dev-visit-photos','dev-visit-date']){
            const rt=runtime({development:false,mocks});
            const r=rt.render(rt.load('app/'+route).default,false);await r.settle();
            assert.equal(r.output,null);assert.equal(rt.world.requests.length,0);assert.equal(rt.world.localWrites,0);
            assert.equal(rt.load('@/lib/auth-navigation').safeAuthReturnTo('/'+route),'/');r.unmount();
        }
    });
    await test('Photo sharing starts unchecked for every selected group and deselection revokes consent',async()=>{
        const f=setup(),r=f.render();await r.settle();await toggle(r,'My Places');await toggle(r,'Dinner');await click(r,'Choose photos');
        let share=button(r,'Share photos with Dinner');assert.equal(share.props.accessibilityState.checked,false);
        await toggle(r,'Share photos with Dinner');assert.equal(button(r,'Share photos with Dinner').props.accessibilityState.checked,true);
        await toggle(r,'Dinner');assert(!textOf(r.output).includes('Share photos with Dinner'));
        await toggle(r,'Dinner');assert.equal(button(r,'Share photos with Dinner').props.accessibilityState.checked,false);r.unmount();
    });
    await test('Add stages exact photo consent before visit writes; visit save payload contains no photos',async()=>{
        const f=setup(),r=f.render();await r.settle();await fill(r);await toggle(r,'My Places');await toggle(r,'Dinner');await click(r,'Choose photos');
        const original=f.jobs.stageAdd;f.jobs.stageAdd=async(...args)=>{assert.equal(posts(f).length,0);await original(...args);};
        await click(r,'Save Visit');assert.equal(f.recorded.length,1);assert.equal(f.recorded[0].submissions.length,2);assert.equal(f.recorded[0].shared.length,0);
        assert.equal(posts(f).length,2);assert(posts(f).every(p=>!JSON.stringify(p.body).includes('draft-image')));assert.equal(f.events.at(-1),'upload');r.unmount();
    });
    await test('Group-only Add with photos requires explicit photo sharing before any visit write',async()=>{
        const f=setup(),r=f.render();await r.settle();await fill(r);await toggle(r,'Dinner');await click(r,'Choose photos');await click(r,'Save Visit');
        assert.equal(posts(f).length,0);assert(textOf(r.output).includes('explicitly share photos'));
        await toggle(r,'Share photos with Dinner');await click(r,'Save Visit');assert.equal(posts(f).length,1);assert.equal(f.recorded[0].shared.length,1);r.unmount();
    });
    await test('Photo journal failure prevents every destination save and preserves visit recovery',async()=>{
        const f=setup();f.jobs.stageAdd=async()=>{throw Error('disk');};const r=f.render();await r.settle();await fill(r);await toggle(r,'My Places');await click(r,'Choose photos');await click(r,'Save Visit');
        assert.equal(posts(f).length,0);assert(textOf(r.output).includes('Nothing was sent'));r.unmount();
    });
    await test('Native picker return during inactivity retains photos above the private gate without uploading',async()=>{
        let resolve;const pending=new Promise(r=>resolve=r);const f=setup(()=>pending),r=f.render();await r.settle();
        const choosing=button(r,'Choose photos').props.onPress();await r.settle();f.rt.emit('inactive');await r.settle();
        resolve([asset]);await choosing;await r.settle();assert(!textOf(r.output).includes('draft-image'));
        f.rt.emit('active');await r.settle();assert(button(r,'Remove selected photo 1'));assert.equal(posts(f).length,0);r.unmount();
    });
    await test('Account replacement ignores a late native picker result and leaves the new account untouched',async()=>{
        let resolve;const pending=new Promise(r=>resolve=r);const f=setup(()=>pending),r=f.render();await r.settle();
        const choosing=button(r,'Choose photos').props.onPress();await r.settle();f.rt.switch('b',r);await r.settle();
        resolve([asset]);await choosing;await r.settle();assert.equal(f.recorded.length,0);assert.equal(posts(f).length,0);assert.equal(f.rt.world.lateUpdates,0);r.unmount();
    });
    console.log(`${passed} photo UI integration checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
