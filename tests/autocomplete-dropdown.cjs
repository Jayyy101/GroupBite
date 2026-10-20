// Actual Add/search screens with offline native/HTTP boundaries. Touch bubbling
// is modeled here; native nested gestures, keyboard geometry and VoiceOver need iOS checks.
const assert = require('node:assert/strict');
const { enter, click, button, nodes, textOf } = require('./personal-places.cjs');
const { model } = require('./unified-add.cjs');
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const defer = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise,resolve,reject }; };
function clock() {
    let now=0,id=0; const timers=new Map();
    return { setTimeout(fn,ms) { const key=++id; timers.set(key,{fn,at:now+ms}); return key; }, clearTimeout(key) { timers.delete(key); },
        async advance(ms,r) { const end=now+ms; while(true) {
            const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]; if(!next||next[1].at>end)break;
            now=next[1].at;timers.delete(next[0]);next[1].fn();await r.settle();
        } now=end;await r.settle(); } };
}
const exact = { id:'1:0', name:'Exact Restaurant', address:'123 Correct Street, Test City', placeId:'Opaque/Exact',
    latitude:37.1234567, longitude:-121.9876543, kind:'business', source:'apple-maps-preview' };
function rows(id,title='Suggestion') { return Array.from({length:5},(_,i)=>({id:id+':'+i,title:title+' '+i,subtitle:'Description '+i})); }
function setup(options={}) {
    const time=clock(),calls=[],resets=[],cancels=[];let route='app/add',selected;
    const native={isAvailable:()=>true,
        complete:async(q,m,id)=>{calls.push({action:'complete',query:q,id});return options.complete?options.complete(q,id):rows(id);},
        search:async(q,m,id)=>{calls.push({action:'search',query:q,id});return options.search?options.search(q,id):[exact];},
        resolve:async(s,id)=>{calls.push({action:'resolve',suggestion:s,id});return [exact];},
        reset:async()=>{resets.push(true);},cancel:async id=>{cancels.push(id);}};
    const f=model({platform:'ios',development:true,setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,
        windowDimensions:options.windowDimensions,safeAreaInsets:options.safeAreaInsets,
        mocks:{expo:{requireOptionalNativeModule:()=>native}}});
    const r=f.rt.render(()=>{
        selected=f.rt.load('@/providers/unified-add').useUnifiedAdd().state.restaurant;
        return options.defaultPresentation?{type:f.rt.load('@/components/restaurant-search').RestaurantSearch,props:{onSelect:()=>{}}}
            :{type:f.rt.load(route).default,props:{}};
    });
    return {...f,r,time,calls,resets,cancels,selected:()=>selected,
        async keyboard(event,screenY) {
            f.rt.world.keyboardMetrics=event==='keyboardDidHide'?undefined:{screenY};
            for(const listener of f.rt.world.keyboardListeners.get(event)??[]) listener({endCoordinates:{screenY}});
            await r.settle();
        },async form(){route='app/add-visit';r.dirty=true;await r.settle();}};
}
const input=f=>nodes(f.r.output).find(n=>n.type==='TextInput'&&n.props.accessibilityLabel==='Search restaurants');
const dropdown=f=>nodes(f.r.output).find(n=>n.type==='ScrollView'&&n.props.accessibilityLabel==='Restaurant suggestions');
async function type(f,query='McDonalds') { await enter(f.r,'Search restaurants',query);await f.time.advance(400,f.r); }
async function measureRows(f,heights) {
    nodes(dropdown(f)).filter(n=>n.type==='Pressable').forEach((row,index)=>row.props.onLayout({nativeEvent:{layout:{height:heights[index]}}}));
    await f.r.settle();
}
function pathTo(node,target,path=[]) {
    if(node===target)return [...path,node];
    if(Array.isArray(node)){for(const child of node){const found=pathTo(child,target,path);if(found)return found;}return null;}
    if(!node||typeof node!=='object')return null;
    return pathTo(node.props.children,target,[...path,node]);
}
async function touch(f,target) {
    let stopped=false;const path=pathTo(f.r.output,target);assert(path);
    const event={stopPropagation(){stopped=true;},preventDefault(){assert.fail('Outside dismissal must not consume the press');}};
    for(const node of [...path].reverse()){node.props?.onTouchStart?.(event);if(stopped)break;}
    await f.r.settle();return stopped;
}
async function outside(f) { await touch(f,nodes(f.r.output).find(n=>n.type==='Text'&&textOf(n)==='Save a restaurant')); }
let passed=0;
async function test(label,run){await run();passed++;console.log('PASS '+label);}
(async()=>{
    await test('Input and compact suggestions share one rounded border, with Search and manual entry below',async()=>{
        const f=setup();try{
            await f.r.settle();assert(!dropdown(f));await type(f);
            const area=nodes(f.r.output).find(n=>n.type==='View'&&[n.props.children].flat(Infinity).includes(input(f)));
            const field=nodes(f.r.output).find(n=>n.type==='View'&&[n.props.children].flat(Infinity).includes(area)&&[n.props.children].flat(Infinity).includes(dropdown(f)));
            assert(field);const border=flat(field.props.style);assert.equal(border.borderWidth,1);assert.equal(border.borderRadius,12);assert(!border.gap);
            const icon=nodes(area).find(n=>n.type==='Icon'&&n.props.name==='search-outline');assert(icon);assert.equal(icon.props.accessible,false);
            const decoration=nodes(area).find(n=>n.type==='View'&&n.props.pointerEvents==='none');assert(decoration);
            const iconStyle=flat(decoration.props.style);assert.equal(iconStyle.position,'absolute');assert(flat(input(f).props.style).paddingLeft>iconStyle.left+iconStyle.width);
            assert.equal(nodes(dropdown(f)).filter(n=>n.type==='Icon').length,0);
            assert.equal(flat(input(f).props.style).borderWidth,0);assert.equal(flat(input(f).props.style).marginBottom,0);
            assert.equal(flat(dropdown(f).props.style).borderTopWidth,1);assert(input(f).props.accessibilityState.expanded);
            const actions=nodes(f.r.output).filter(n=>n.type==='Pressable');assert(actions.indexOf(button(f.r,'Search'))>actions.indexOf(button(f.r,'Suggestion 4, Description 4')));
            assert.equal(actions.indexOf(button(f.r,'Enter Restaurant Manually')),actions.indexOf(button(f.r,'Search'))+1);
        }finally{f.r.unmount();}
    });
    await test('Suggestion area is bounded, scrolls internally and lets large text wrap without truncation',async()=>{
        const f=setup({complete:async(q,id)=>rows(id,'A very long restaurant or nearby search suggestion that should wrap')});try{
            await f.r.settle();await type(f);const list=dropdown(f),style=flat(list.props.style);
            assert.equal(style.maxHeight,280);assert.equal(style.flexGrow,0);assert.equal(style.height,undefined);assert(!list.props.horizontal);
            assert(list.props.nestedScrollEnabled);assert(list.props.directionalLockEnabled);assert.equal(list.props.keyboardShouldPersistTaps,'handled');assert.equal(list.props.keyboardDismissMode,'none');
            assert.equal(list.props.bounces,false);assert.equal(nodes(list).filter(n=>n.type==='Pressable').length,5);
            for(const row of nodes(list).filter(n=>n.type==='Pressable')){
                assert(flat(row.props.style).minHeight>=44);assert.equal(flat(row.props.style).height,undefined);
                assert.equal(row.props.accessibilityRole,'button');assert(row.props.accessibilityLabel.includes('Description'));
                const title=nodes(row).find(n=>n.type==='Text'&&textOf(n).startsWith('A very long'));
                const secondary=nodes(row).find(n=>n.type==='Text'&&textOf(n).startsWith('Description'));
                assert.equal(flat(title.props.style).fontSize,16);assert.equal(flat(title.props.style).lineHeight,22);
                assert.equal(flat(secondary.props.style).fontSize,14);assert.equal(flat(secondary.props.style).lineHeight,20);
                for(const text of nodes(row).filter(n=>n.type==='Text')){assert.equal(text.props.numberOfLines,undefined);assert.notEqual(text.props.allowFontScaling,false);}
            }
            assert.equal(nodes(list).filter(n=>n.type==='TextInput').length,0);
            await measureRows(f,[84,84,84,84,84]);
            assert.equal(flat(dropdown(f).props.style).maxHeight,253,'Three full wrapped rows fit without clipping the third address');
        }finally{f.r.unmount();}
    });
    await test('One or two suggestions shrink naturally rather than reserving an empty 280-point list',async()=>{
        for(const count of [1,2]){
            const f=setup({complete:async(q,id)=>rows(id).slice(0,count)});try{
                await f.r.settle();await type(f);await measureRows(f,Array(count).fill(64));
                const style=flat(dropdown(f).props.style);assert.equal(style.maxHeight,count*64+1);
                assert.equal(style.height,undefined);assert.equal(style.minHeight,undefined);assert.equal(style.flexGrow,0);
                assert.equal(nodes(dropdown(f)).filter(n=>n.type==='Pressable').length,count);
            }finally{f.r.unmount();}
        }
    });
    await test('Keyboard geometry reduces the list on small screens without restarting search or hiding actions',async()=>{
        const f=setup({windowDimensions:{width:375,height:667,scale:2,fontScale:1},safeAreaInsets:{top:20,bottom:0,left:0,right:0}});try{
            await f.r.settle();await type(f);await measureRows(f,[72,72,72,72,72]);
            const calls=f.calls.length,resets=f.resets.length,cancels=f.cancels.length;
            const expanded=flat(dropdown(f).props.style).maxHeight;assert(expanded>196&&expanded<=280);
            await f.keyboard('keyboardWillChangeFrame',367);
            const compact=flat(dropdown(f).props.style).maxHeight;assert.equal(compact,145);
            assert(compact<expanded);assert.equal(input(f).props.value,'McDonalds');
            const page=nodes(f.r.output).find(n=>n.type==='ScrollView'&&n.props.accessibilityLabel!=='Restaurant suggestions'&&!n.props.horizontal);
            assert.equal(page.props.automaticallyAdjustKeyboardInsets,true);assert.equal(page.props.keyboardShouldPersistTaps,'handled');
            assert(button(f.r,'Search'));assert(button(f.r,'Enter Restaurant Manually'));
            assert.equal(f.calls.length,calls);assert.equal(f.resets.length,resets);assert.equal(f.cancels.length,cancels);
            await f.keyboard('keyboardDidHide',667);assert.equal(flat(dropdown(f).props.style).maxHeight,expanded);
            f.r.unmount();assert([...f.rt.world.keyboardListeners.values()].every(listeners=>listeners.size===0));
        }finally{f.r.unmount();}
    });
    await test('A phone-sized viewport with the keyboard open still shows three complete wrapped suggestions',async()=>{
        const f=setup({windowDimensions:{width:402,height:874,scale:3,fontScale:1},safeAreaInsets:{top:62,bottom:34,left:0,right:0}});try{
            await f.r.settle();await f.keyboard('keyboardDidShow',530);await type(f);await measureRows(f,[84,84,84,84,84]);
            assert.equal(flat(dropdown(f).props.style).maxHeight,253);
            assert(button(f.r,'Search'));assert(button(f.r,'Enter Restaurant Manually'));
        }finally{f.r.unmount();}
    });
    await test('An already open keyboard, rotation and large rows retain a bounded internally scrollable list',async()=>{
        const f=setup({safeAreaInsets:{top:59,bottom:34,left:0,right:0}});try{
            await f.r.settle();await f.keyboard('keyboardDidShow',500);await type(f);
            assert(flat(dropdown(f).props.style).maxHeight<280,'Initial sizing reads the keyboard already open before suggestions arrived');
            await measureRows(f,[130,130,130,130,130]);assert.equal(flat(dropdown(f).props.style).maxHeight,131);
            f.rt.world.windowDimensions={width:844,height:390,scale:3,fontScale:2};f.r.dirty=true;
            await f.keyboard('keyboardWillChangeFrame',210);
            const style=flat(dropdown(f).props.style);assert(style.maxHeight>=44&&style.maxHeight<130);
            assert.equal(style.height,undefined);assert.equal(dropdown(f).props.scrollEnabled,undefined);
            assert.equal(dropdown(f).props.nestedScrollEnabled,true);
            assert.equal(nodes(dropdown(f)).filter(n=>n.type==='Pressable').length,5);
        }finally{f.r.unmount();}
    });
    await test('Outside taps hide suggestions without erasing text or native completions; input focus reopens them',async()=>{
        const f=setup();try{
            await f.r.settle();await type(f);const count=f.calls.length,resets=f.resets.length;
            await outside(f);assert(!dropdown(f));assert.equal(input(f).props.value,'McDonalds');assert.equal(f.rt.world.keyboardDismissals,1);
            input(f).props.onFocus();await f.r.settle();assert(dropdown(f));assert.equal(f.calls.length,count);assert.equal(f.resets.length,resets);
        }finally{f.r.unmount();}
    });
    await test('A pending suggestion reply stays dismissed after an outside tap and reopens only on focus',async()=>{
        const pending=defer();const f=setup({complete:()=>pending.promise});try{
            await f.r.settle();await type(f);await outside(f);pending.resolve(rows(f.calls[0].id));await f.r.settle();assert(!dropdown(f));
            input(f).props.onFocus();await f.r.settle();assert(dropdown(f));assert.equal(f.calls.length,1);
        }finally{f.r.unmount();}
    });
    await test('First Search with a visible dropdown survives keyboard hide and unchanged input; full results stay separate',async()=>{
        const pending=defer();const f=setup({search:()=>pending.promise});try{
            await f.r.settle();await f.keyboard('keyboardDidShow',500);await type(f);assert(await touch(f,button(f.r,'Search')));assert(dropdown(f));
            await click(f.r,'Search');assert(!dropdown(f));assert.equal(f.calls.filter(c=>c.action==='search').length,1);
            const resets=f.resets.length,cancels=f.cancels.length;
            assert.equal(f.rt.world.keyboardDismissals,1);await f.keyboard('keyboardDidHide',844);await enter(f.r,'Search restaurants','McDonalds');
            assert.equal(f.resets.length,resets);assert.equal(f.cancels.length,cancels);assert(textOf(f.r.output).includes('Searching Apple Maps...'));
            pending.resolve([exact]);await f.r.settle();assert(button(f.r,'Choose restaurant: '+exact.name+', '+exact.address));assert(!dropdown(f));
            input(f).props.onFocus();await f.r.settle();assert(!dropdown(f));assert.equal(f.calls.filter(c=>c.action==='complete').length,1);
            await click(f.r,'Choose restaurant: '+exact.name+', '+exact.address);assert.equal(f.rt.world.navigation.at(-1),'/add-visit');
        }finally{f.r.unmount();}
    });
    await test('Changed and cleared queries invalidate old suggestion rows and responses',async()=>{
        const f=setup();try{
            await f.r.settle();await type(f);const stale=button(f.r,'Suggestion 0, Description 0').props.onPress;
            await enter(f.r,'Search restaurants','Chipotle');assert(!dropdown(f));stale();await f.r.settle();assert(!f.calls.some(c=>c.action==='resolve'));
            await f.time.advance(400,f.r);assert.equal(f.calls.at(-1).query,'Chipotle');assert(dropdown(f));
            await enter(f.r,'Search restaurants','');assert(!dropdown(f));const count=f.calls.length;await f.time.advance(400,f.r);assert.equal(f.calls.length,count);
            input(f).props.onFocus();await f.r.settle();assert(!dropdown(f));
        }finally{f.r.unmount();}
    });
    await test('Generic completions resolve before an exact restaurant can open unified Add with unchecked destinations',async()=>{
        const f=setup({complete:async(q,id)=>[{id:id+':0',title:'Search Nearby',subtitle:'Test City'}]});try{
            await f.r.settle();await type(f);const selectedId=f.calls[0].id+':0';
            await touch(f,button(f.r,'Search Nearby, Test City'));await click(f.r,'Search Nearby, Test City');
            assert.equal(f.calls.at(-1).suggestion,selectedId);assert.equal(f.calls.at(-1).action,'resolve');assert.equal(f.rt.world.navigation.length,0);
            assert(!dropdown(f));assert(textOf(f.r.output).includes('Choose a restaurant'));
            await click(f.r,'Choose restaurant: '+exact.name+', '+exact.address);assert.equal(f.selected().address,exact.address);
            assert.equal(f.selected().apple_place_id,exact.placeId);assert.equal(f.selected().mapkit_point.latitude,exact.latitude);assert.equal(f.selected().mapkit_point.longitude,exact.longitude);
            await f.form();assert(nodes(f.r.output).filter(n=>n.props?.accessibilityRole==='checkbox').every(n=>!n.props.accessibilityState.checked));assert.equal(f.state.visits.length,0);
        }finally{f.r.unmount();}
    });
    await test('Empty and failed completion feedback stays usable and focus can explicitly request fresh suggestions',async()=>{
        for(const failure of [false,true]){
            let retry=false;const f=setup({complete:async(q,id)=>{if(retry)return rows(id);if(failure)throw {code:'ERR_UNAVAILABLE'};return [];}});try{
                await f.r.settle();await type(f);assert(!dropdown(f));assert(textOf(f.r.output).includes(failure?'Apple search is unavailable.':'No restaurants found.'));
                assert(button(f.r,'Search'));assert(button(f.r,'Enter Restaurant Manually'));await outside(f);retry=true;input(f).props.onFocus();await f.r.settle();assert(dropdown(f));
            }finally{f.r.unmount();}
        }
    });
    await test('An old account cannot restore pending dropdown suggestions or retain its dismissal callback',async()=>{
        const pending=defer();const f=setup({complete:()=>pending.promise});try{
            await f.r.settle();await type(f);const id=f.calls[0].id;f.rt.switch('b',f.r);await f.r.settle();pending.resolve(rows(id));await f.r.settle();
            assert(!dropdown(f));assert.equal(input(f).props.value,'');assert.equal(f.rt.world.lateUpdates,0);
        }finally{f.r.unmount();}
    });
    await test('Other RestaurantSearch consumers retain standalone input and original vertical suggestion cards',async()=>{
        const f=setup({defaultPresentation:true});try{
            await f.r.settle();await type(f);assert(!dropdown(f));assert(textOf(f.r.output).includes('Suggestions — tap to see restaurants'));
            assert.equal(flat(input(f).props.style).borderWidth,1);assert(button(f.r,'Search Apple Maps'));assert.equal(nodes(f.r.output).filter(n=>n.type==='ScrollView').length,0);
            assert.equal(nodes(f.r.output).filter(n=>n.type==='Icon').length,0);assert.equal(flat(input(f).props.style).paddingLeft,undefined);
        }finally{f.r.unmount();}
    });
    console.log(`${passed} offline connected autocomplete checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
