/* global __dirname */
// Actual job coordinator and native adapter with synthetic boundaries; no .env,
// device storage, Storage service, user data or hosted writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks={}) {
    const module={exports:{}};
    const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,require:name=>{assert(name in mocks,'Unexpected dependency '+name);return mocks[name];},console});
    return module.exports;
}
const {PhotoJobs}=load('lib/visit-photo-jobs.ts');
const id=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
const asset={id:id(1),image:id(1)+'-image.jpg',thumbnail:id(1)+'-thumbnail.jpg',width:1600,height:1200,bytes:100,thumbnailBytes:20};
const personal={kind:'personal',entryId:id(2),visitId:id(3)};
const group={kind:'group',entryId:id(4),visitId:id(5),groupId:id(6),membershipId:id(7)};
function fixture(overrides={}) {
    let next=100;
    const w={journal:null,events:[],photos:[],receipt:null,active:true};
    const deps={read:async()=>w.journal,write:async value=>{w.events.push('journal');w.journal=value;},uuid:()=>id(next++),
        receipt:async()=>{w.events.push('receipt');return w.receipt;},list:async()=>{w.events.push('list');return w.photos;},
        reserve:async(job,can)=>{assert(can());assert(w.journal.includes(job.id));assert(w.journal.includes('uploading'));w.events.push('reserve');},
        upload:async(job,variant,can)=>{assert(can());w.events.push(variant);if(variant==='thumbnail')w.photos=[{id:job.id,state:'ready'}];},...overrides};
    const jobs=new PhotoJobs(deps);return {w,deps,jobs,can:()=>w.active};
}
const submission=(target,request)=>({args:{client_request_id:request},destination:{kind:target.kind,groupId:target.groupId,membershipId:target.membershipId}});
let passed=0;
async function test(label,run){await run();passed++;console.log('PASS '+label);}
(async()=>{
    await test('Explicit photo consent creates only personal and checked group jobs; visit payload stays untouched',async()=>{
        const {jobs}=fixture();await jobs.restore();
        const other={...group,groupId:id(8)};
        const s=[submission(personal,'p'),submission(group,'g'),submission(other,'other')],before=JSON.stringify(s);
        await jobs.stageAdd([asset],s,[group.groupId]);
        assert.equal(jobs.jobs.length,2);assert.deepEqual(Array.from(jobs.jobs,j=>j.requestId),['p','g']);assert.equal(JSON.stringify(s),before);
        assert.notEqual(jobs.jobs[0].id,jobs.jobs[1].id);
    });
    await test('No receipt means no upload, reservation or new visit write',async()=>{
        const {jobs,w,can}=fixture();await jobs.restore();await jobs.stageAdd([asset],[submission(personal,'p')],[]);await jobs.run(can);
        assert(!w.events.includes('reserve'));assert(!w.events.includes('image'));assert.equal(jobs.jobs[0].target,undefined);
    });
    await test('Only matching available destination receipt with an exact visit ID permits upload',async()=>{
        for(const receipt of [null,{available:false},{available:true,destination_kind:'group',group_id:null,entry_id:id(2),visit_id:id(3)},
            {available:true,destination_kind:'personal',group_id:null,entry_id:id(2),visit_id:null}]) {
            const {jobs,w,can}=fixture();w.receipt=receipt;await jobs.restore();await jobs.stageAdd([asset],[submission(personal,'p')],[]);await jobs.run(can);assert(!w.events.includes('reserve'));
        }
        const {jobs,w,can}=fixture();w.receipt={available:true,destination_kind:'personal',group_id:null,entry_id:personal.entryId,visit_id:personal.visitId};
        await jobs.restore();await jobs.stageAdd([asset],[submission(personal,'p')],[]);await jobs.run(can);
        assert.equal(jobs.jobs[0].target.visitId,personal.visitId);assert.equal(jobs.jobs[0].status,'done');
        assert(w.events.indexOf('receipt')<w.events.indexOf('reserve'));assert(w.events.indexOf('reserve')<w.events.indexOf('image'));
    });
    await test('Lost upload response retains its identity; checking is read-only and a new save cannot replay it',async()=>{
        const {jobs,w,can}=fixture({upload:async()=>{throw Error('response lost');}});await jobs.restore();await jobs.stageVisit([asset],personal);await jobs.run(can);
        const photoId=jobs.jobs[0].id;assert.equal(jobs.jobs[0].status,'review');
        w.events=[];await jobs.run(can);await jobs.run(can,'check');assert.deepEqual(w.events,['list']);
        w.photos=[{id:photoId,state:'ready'}];await jobs.run(can,'check');assert.equal(jobs.jobs[0].status,'done');assert.equal(jobs.jobs[0].id,photoId);
    });
    await test('Restart restores every unfinished stage for review without uploading',async()=>{
        const {jobs,w,deps,can}=fixture();await jobs.restore();await jobs.stageVisit([asset],personal);
        for(const status of ['waiting','uploading','review']){
            const raw=JSON.parse(w.journal);raw[0].status=status;w.journal=JSON.stringify(raw);
            const restored=new PhotoJobs(deps);w.events=[];await restored.restore();await restored.run(can);
            assert.equal(restored.jobs[0].status,'review');assert.deepEqual(w.events,[]);
        }
    });
    await test('Explicit continue uses immutable IDs after a partial upload; tombstones end recovery',async()=>{
        let fail=true;
        const f=fixture({upload:async(job,variant)=>{f.w.events.push(variant);if(variant==='thumbnail'&&fail)throw Error();if(!fail)f.w.photos=[{id:job.id,state:'ready'}];}});
        await f.jobs.restore();await f.jobs.stageVisit([asset],personal);await f.jobs.run(f.can);const photoId=f.jobs.jobs[0].id;
        fail=false;await f.jobs.run(f.can,'continue');assert.equal(f.jobs.jobs[0].id,photoId);assert.equal(f.jobs.jobs[0].status,'done');
        const t=fixture();await t.jobs.restore();await t.jobs.stageVisit([asset],personal);t.w.photos=[{id:t.jobs.jobs[0].id,state:'removed'}];await t.jobs.run(t.can,'continue');assert(!t.w.events.includes('reserve'));
    });
    await test('Backgrounding between upload variants stops dispatch; replacement account ignores old callbacks',async()=>{
        const f=fixture({upload:async()=>{f.w.active=false;}});await f.jobs.restore();await f.jobs.stageVisit([asset],personal);await f.jobs.run(f.can);assert.equal(f.jobs.jobs[0].status,'uploading');
        f.w.active=true;f.jobs.dispose();f.w.events=[];await f.jobs.run(f.can,'continue');assert.deepEqual(f.w.events,[]);
    });
    await test('Corrupt recovery and failed durable writes fail closed without erasing evidence',async()=>{
        const f=fixture();f.w.journal='private corrupted evidence';await f.jobs.restore();assert.equal(f.jobs.ready,false);assert.equal(f.w.journal,'private corrupted evidence');
        await assert.rejects(f.jobs.stageVisit([asset],personal));assert(!f.w.events.includes('reserve'));
        const b=fixture({write:async()=>{throw Error('disk');}});await b.jobs.restore();await assert.rejects(b.jobs.stageVisit([asset],personal));assert.equal(b.jobs.jobs.length,0);await b.jobs.run(b.can);assert(!b.w.events.includes('reserve'));
    });
    await test('Concurrent upload taps dispatch one operation and revoked group reads dispatch no bytes',async()=>{
        let release;const wait=new Promise(r=>release=r);
        const f=fixture({reserve:async()=>{f.w.events.push('reserve');await wait;}});await f.jobs.restore();await f.jobs.stageVisit([asset],personal);
        const running=f.jobs.run(f.can);await new Promise(r=>setImmediate(r));await f.jobs.run(f.can,'continue');release();await running;assert.equal(f.w.events.filter(e=>e==='reserve').length,1);
        const r=fixture({list:async()=>{throw Error('revoked admission');}});await r.jobs.restore();await r.jobs.stageVisit([asset],group);await r.jobs.run(r.can);assert(!r.w.events.includes('image'));
    });
    await test('Native adapter uses limited image-only selection and re-encodes resized JPEG plus thumbnail',async()=>{
        const operations=[],files=new Map();
        class File { constructor(...parts){this.uri=parts.map(p=>p.uri??p).join('/');this.size=100;} write(bytes){files.set(this.uri,bytes);} async arrayBuffer(){return new Uint8Array([255,216,255,217]).buffer;} }
        class Directory {constructor(...parts){this.uri=parts.map(p=>p.uri??p).join('/');}create(options){assert(options.intermediates&&options.idempotent);}}
        let options;
        const adapter=load('lib/visit-photo-files.ts',{'@/lib/photo-jpeg':load('lib/photo-jpeg.ts'),'expo-crypto':{randomUUID:()=>id(1)},'expo-file-system':{Directory,File,Paths:{document:{uri:'file:///new-sandbox/Documents'}}},
            'expo-image-picker':{UIImagePickerPreferredAssetRepresentationMode:{Compatible:'compatible'},launchImageLibraryAsync:async opts=>{options=opts;return {canceled:false,assets:[{uri:'file:///input.heic',width:4000,height:3000}]};}},
            'expo-image-manipulator':{SaveFormat:{JPEG:'jpeg'},ImageManipulator:{manipulate(uri){let size;return {resize(s){size=s;operations.push(s);},async renderAsync(){return {async saveAsync(opts){assert.equal(opts.format,'jpeg');assert(!opts.exif);return {uri:'file:///output-'+operations.length+'.jpg',...size};},release(){}};},release(){}};}}}});
        const photos=await adapter.selectVisitPhotos(id(9),2);assert.equal(options.selectionLimit,2);assert.equal(options.exif,false);assert.equal(options.base64,false);assert(options.allowsMultipleSelection);
        assert.equal(operations[0].width,1600);assert.equal(operations[0].height,1200);assert.equal(operations[1].width,480);assert.equal(operations[1].height,360);
        assert.equal(photos[0].image,asset.image);assert(!photos[0].image.includes('sandbox'));assert.equal(files.size,2);
    });
    await test('JPEG metadata stripping removes EXIF/XMP/IPTC/comments while retaining ICC and scan bytes',async()=>{
        const {stripJpegMetadata}=load('lib/photo-jpeg.ts');
        const segment=(marker,body)=>[255,marker,0,body.length+2,...body];
        const start=[255,216],end=[255,218,0,2,99,100,255,217];
        const icc=segment(226,[73,67,67]),tables=segment(219,[1,2,3]);
        const result=stripJpegMetadata(new Uint8Array([...start,...segment(225,[69,120,105,102,0]),...icc,...segment(237,[9,8]),...segment(254,[7]),...tables,...end]));
        assert.deepEqual(Array.from(result),[...start,...icc,...tables,...end]);
        assert.throws(()=>stripJpegMetadata(new Uint8Array([255,216,255,225,0,40])));
    });
    await test('Prepared copies release only after all destinations sharing the asset are durably confirmed',async()=>{
        let fail=true,released=0;
        const f=fixture({releaseAsset:async()=>{released++;},upload:async(job,variant)=>{
            if(job.target.kind==='group'&&fail)throw Error('offline');if(variant==='thumbnail')f.w.photos=[{id:job.id,state:'ready'}];
        }});
        await f.jobs.restore();await f.jobs.stageVisit([asset],personal);await f.jobs.stageVisit([asset],group);await f.jobs.run(f.can);
        assert.equal(released,0);assert.equal(f.jobs.jobs[0].status,'done');assert.equal(f.jobs.jobs[1].status,'review');
        fail=false;await f.jobs.run(f.can,'continue');assert.equal(released,1);assert(f.jobs.jobs.every(j=>j.status==='done'));
    });
    console.log(`${passed} photo client/native checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
