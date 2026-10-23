// Actual screens, MapKit adapter and read clients. All native/HTTP boundaries
// are offline; no hosted data, native app launch or .env is used.
const assert = require('node:assert/strict');
const {runtime,fixture,response,screen,click,enter,button,nodes,textOf} = require('./personal-places.cjs');
const {model,destinations} = require('./unified-add.cjs');
const groupId=destinations()[1].groupId,entryId='55555555-5555-5555-5555-555555555555';
const uuid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const flatten=style=>Object.assign({},...[style].flat(Infinity).filter(Boolean));
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let passed=0;
async function test(label,fn){await fn();passed++;console.log('PASS '+label);}

(async()=>{
    await test('Add offers full-address MapKit cards in one keyboard-friendly page scroll, without inline maps',async()=>{
        const address='123 Main Street, Suite 456, Long Neighborhood, Fremont, California 94538, United States';
        const candidates=Object.freeze(Array.from({length:5},(_,i)=>Object.freeze({id:`1:${i}`,name:'Restaurant '+i,address:address+' '+i,
            placeId:'Opaque:Apple/'+i,latitude:37.5555437394246+i/1000,longitude:-121.982959052141,kind:'business',source:'apple-maps-preview'})));
        const original=JSON.stringify(candidates),native={isAvailable:()=>true,complete:async()=>[],resolve:async()=>candidates,
            search:async()=>candidates,reset:async()=>{},cancel:async()=>{}};
        const f=model({platform:'ios',development:true,mocks:{expo:{requireOptionalNativeModule:()=>native}}});let selected,route='app/add';
        function Host(){selected=f.rt.load('@/providers/unified-add').useUnifiedAdd().state.restaurant;return {type:f.rt.load(route).default,props:{}};}
        const r=f.rt.render(Host);await r.settle();
        assert(textOf(r.output).includes('Choose a restaurant to start adding a visit.'));
        assert.equal(flatten(button(r,'Search').props.style).backgroundColor,'#C9472C');
        assert.equal(flatten(button(r,'Enter Restaurant Manually').props.style).borderColor,'#E85D3F');
        await enter(r,'Search restaurants','Restaurant Fremont');await click(r,'Search');
        const scrolls=nodes(r.output).filter(n=>n.type==='ScrollView');assert.equal(scrolls.length,1);
        assert.equal(scrolls[0].props.keyboardShouldPersistTaps,'handled');assert.equal(scrolls[0].props.keyboardDismissMode,'on-drag');
        assert.equal(nodes(r.output).filter(n=>['MapView','Marker'].includes(n.type)).length,0);
        for(const c of candidates){const card=button(r,`Choose restaurant: ${c.name}, ${c.address}`);assert(textOf(card).includes(c.address));
            assert.equal(flatten(card.props.style).flex,undefined);for(const t of nodes(card).filter(n=>n.type==='Text'))assert.equal(t.props.numberOfLines,undefined);}
        const actions=nodes(r.output).filter(n=>n.type==='Pressable');
        assert.equal(actions.indexOf(button(r,'Enter Restaurant Manually')),actions.indexOf(button(r,'Search'))+1);
        assert(actions.indexOf(button(r,'Enter Restaurant Manually'))<actions.indexOf(button(r,`Choose restaurant: ${candidates[0].name}, ${candidates[0].address}`)));
        assert(textOf(r.output).indexOf('Recently saved restaurants')>textOf(r.output).indexOf(address+' 4'));
        await click(r,`Choose restaurant: ${candidates[4].name}, ${candidates[4].address}`);
        assert.equal(selected.apple_place_id,candidates[4].placeId);assert.equal(selected.address,candidates[4].address);
        // Coordinates and optional opaque IDs remain exact through selection.
        assert.equal(selected.mapkit_point.latitude,candidates[4].latitude);
        assert.equal(selected.mapkit_point.longitude,candidates[4].longitude);
        const locations=await f.rt.load('@/lib/apple-map-search').searchApplePlaces('Restaurant Fremont','business',new AbortController().signal);
        assert.equal(locations[4].latitude,candidates[4].latitude);assert.equal(locations[4].longitude,candidates[4].longitude);
        assert.equal(locations[4].placeId,candidates[4].placeId);assert.equal(JSON.stringify(candidates),original);
        assert.equal(f.rt.world.navigation.at(-1),'/add-visit');route='app/add-visit';r.dirty=true;await r.settle();
        assert.equal(nodes(r.output).find(n=>n.props?.accessibilityLabel==='Restaurant address').props.value,candidates[4].address);
        assert(nodes(r.output).filter(n=>n.props?.accessibilityRole==='checkbox').every(n=>!n.props.accessibilityState.checked));
        assert.equal(f.state.visits.length,0);r.unmount();
    });
    await test('Add keeps manual entry and accessible Refresh above recent cards through loading, error and empty states',async()=>{
        const f=model(),r=f.render('add');await r.settle();
        const recent=Array.from({length:12},(_,i)=>({name:'Recent Cafe '+i,address:'Address '+i,cuisine:null}));
        const assertActions=()=>{
            const all=nodes(r.output),manual=button(r,'Enter Restaurant Manually'),refresh=button(r,'Refresh Recent Restaurants');
            const heading=all.find(n=>n.type==='Text'&&textOf(n)==='Recently saved restaurants');
            assert(all.indexOf(manual)<all.indexOf(heading));
            assert(all.some(n=>n.type==='View'&&n.props.children?.includes?.(heading)&&n.props.children.includes(refresh)));
            assert.equal(all.filter(n=>n.type==='Pressable'&&textOf(n)==='Enter Restaurant Manually').length,1);
            assert.equal(all.filter(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='Refresh Recent Restaurants').length,1);
            const style=flatten(refresh.props.style);assert(style.minWidth>=44&&style.minHeight>=44);
            assert(nodes(refresh).some(n=>n.type==='Icon'&&n.props.name==='refresh-outline'&&n.props.accessible===false));
            assert.equal(all.filter(n=>n.type==='ScrollView'&&!n.props.horizontal).length,1);
            return {all,manual,refresh};
        };
        assertActions();assert(textOf(r.output).includes('No saved restaurants yet.'));
        const gate=defer();f.state.override=c=>/\/get_recent_add_restaurants(?:_with_mapkit)?$/.test(c.url.pathname)?gate.promise:null;
        await click(r,'Refresh Recent Restaurants');
        const loading=assertActions();assert(loading.refresh.props.disabled);assert(loading.refresh.props.accessibilityState.disabled);
        assert(textOf(r.output).includes('Loading recent restaurants...'));assert(!loading.manual.props.disabled);
        gate.resolve(response(recent));await r.settle();
        const populated=assertActions();assert.equal(populated.refresh.props.disabled,false);
        for(const restaurant of recent){const card=button(r,restaurant.name+' '+restaurant.address);
            assert(populated.all.indexOf(populated.refresh)<populated.all.indexOf(card));}
        assert(textOf(r.output).includes('Swipe to browse · Tap to add another visit'));
        assert(!textOf(r.output).includes('Choosing a restaurant does not select where to save your next visit.'));
        f.state.override=c=>/\/get_recent_add_restaurants(?:_with_mapkit)?$/.test(c.url.pathname)?response({},503):null;
        await click(r,'Refresh Recent Restaurants');assertActions();
        assert(textOf(r.output).includes('Could not load recent restaurants.'));assert(!textOf(r.output).includes('Recent Cafe'));
        f.state.override=null;await click(r,'Refresh Recent Restaurants');assertActions();assert(textOf(r.output).includes('No saved restaurants yet.'));
        assert.equal(f.rt.world.requests.filter(c=>/\/get_recent_add_restaurants(?:_with_mapkit)?$/.test(c.url.pathname)).length,4);
        await click(r,'Enter Restaurant Manually');assert.equal(f.rt.world.navigation.at(-1),'/add-visit');assert.equal(f.state.visits.length,0);r.unmount();
    });
    await test('Live suggestions resolve cached completions before opening the chosen restaurant in unified Add',async()=>{
        let cached=false,route='app/add',selected;
        const candidates=[{id:'1:0',name:'Cafe North',address:'10 Main Street, North City',latitude:37,longitude:-122},
            {id:'1:1',name:'Cafe South',address:'20 Main Street, South City',latitude:37.5,longitude:-121.5}]
            .map(item=>({...item,placeId:'Opaque:'+item.name,kind:'business',source:'apple-maps-preview'}));
        const native={isAvailable:()=>true,complete:async(q,m,id)=>{cached=true;return [{id:id+':0',title:'Cafe',subtitle:'Main Street'}];},
            resolve:async()=>{assert(cached);return candidates;},search:async()=>assert.fail('Suggestions must resolve their cached completion'),
            reset:async()=>{cached=false;},cancel:async()=>{}};
        const f=model({platform:'ios',development:true,mocks:{expo:{requireOptionalNativeModule:()=>native}}});
        const r=f.rt.render(()=>{selected=f.rt.load('@/providers/unified-add').useUnifiedAdd().state.restaurant;return {type:f.rt.load(route).default,props:{}};});
        await r.settle();await enter(r,'Search restaurants','Cafe');await new Promise(resolve=>setTimeout(resolve,420));await r.settle();
        await click(r,'Cafe Main Street');assert.equal(f.rt.world.navigation.length,0);
        await click(r,'Choose restaurant: Cafe South, 20 Main Street, South City');
        assert.equal(f.rt.world.navigation.at(-1),'/add-visit');assert.equal(selected.apple_place_id,candidates[1].placeId);
        assert.equal(selected.mapkit_point.latitude,candidates[1].latitude);assert.equal(selected.mapkit_point.longitude,candidates[1].longitude);
        route='app/add-visit';r.dirty=true;await r.settle();
        assert.equal(nodes(r.output).find(n=>n.props?.accessibilityLabel==='Restaurant name').props.value,candidates[1].name);
        assert.equal(nodes(r.output).find(n=>n.props?.accessibilityLabel==='Restaurant address').props.value,candidates[1].address);
        assert(nodes(r.output).filter(n=>n.props?.accessibilityRole==='checkbox').every(n=>!n.props.accessibilityState.checked));
        assert.equal(f.state.visits.length,0);r.unmount();
    });
    await test('Recent restaurants scroll horizontally with a half-card preview and retain full accessible identity on selection',async()=>{
        const recent=Array.from({length:4},(_,i)=>({name:'Recent restaurant '+i,address:`${i} Main Street, Suite 123, Long Neighborhood, Test City, California 90000`,
            cuisine:'Italian',apple_place_id:'Opaque:'+i,destination_kind:'group',group_id:groupId,entry_id:uuid(i+1)}));
        const f=model({recent});let selected;
        const r=f.rt.render(()=>{selected=f.rt.load('@/providers/unified-add').useUnifiedAdd().state.restaurant;return {type:f.rt.load('app/add').default,props:{}};});
        await r.settle();const list=()=>nodes(r.output).find(n=>n.type==='ScrollView'&&n.props.horizontal);
        assert(list());assert.equal(list().props.keyboardShouldPersistTaps,'handled');assert(list().props.directionalLockEnabled);assert(list().props.nestedScrollEnabled);
        assert.equal(flatten(list().props.style).flexGrow,0);assert.equal(nodes(list()).filter(n=>n.type==='Pressable').length,4);
        for(const width of [272,342,700]){
            list().props.onLayout({nativeEvent:{layout:{width}}});await r.settle();
            const card=button(r,recent[0].name+', '+recent[0].address),cardStyle=flatten(card.props.style);
            assert(Math.abs(cardStyle.width*1.5+flatten(list().props.contentContainerStyle).gap-width)<0.01);
            assert(cardStyle.minHeight>=44);assert(nodes(list()).includes(card));
            assert(nodes(card).some(n=>n.type==='Icon'&&n.props.name==='chevron-forward'&&n.props.accessible===false));
            const address=nodes(card).find(n=>n.type==='Text'&&textOf(n)===recent[0].address);
            assert.equal(address.props.numberOfLines,2);assert.equal(address.props.ellipsizeMode,'tail');
        }
        assert.equal(nodes(r.output).filter(n=>n.type==='Text'&&textOf(n)==='Swipe to browse · Tap to add another visit').length,1);
        const last=recent[3];await click(r,last.name+', '+last.address);
        assert.equal(JSON.stringify(selected),JSON.stringify(last));assert.equal(f.rt.world.navigation.at(-1),'/add-visit');assert.equal(f.state.visits.length,0);r.unmount();
    });
    await test('Destination cards highlight independently, show a checkmark and retain accessible checked state',async()=>{
        const f=model(),r=f.render();await r.settle();
        const card=label=>button(r,label);
        for(const label of ['My Places','Dinner','Lunch'])assert.equal(card(label).props.accessibilityState.checked,false);
        await click(r,'My Places');await click(r,'Dinner');
        for(const label of ['My Places','Dinner']){const node=card(label),style=flatten(node.props.style);assert.equal(style.backgroundColor,'#FFF0E8');
            assert.equal(style.borderColor,'#C9472C');assert(node.props.accessibilityState.checked);assert(nodes(node).some(n=>n.type==='Icon'&&n.props.name==='checkmark-circle'));}
        assert.equal(card('Lunch').props.accessibilityState.checked,false);await click(r,'Dinner');
        assert.equal(card('Dinner').props.accessibilityState.checked,false);assert.equal(card('My Places').props.accessibilityState.checked,true);
        assert.equal(flatten(card('Dinner').props.style).backgroundColor,'#FFFFFF');r.unmount();
    });
    await test('My Places cards average only rated history and count every real visit, including undated legacy visits',async()=>{
        const rt=runtime();rt.world.rows=[fixture({rating:5}),fixture({id:uuid(2),name:'Empty Cafe',rating:null}),fixture({id:uuid(3),name:'Unrated Cafe',rating:null}),fixture({id:uuid(4),owner_user_id:'b',name:'Foreign Cafe'})];
        rt.world.visits=[{id:uuid(11),personal_place_id:fixture().id,owner_user_id:'a',rating:1,origin:'legacy',visited_on:null},
            {id:uuid(12),personal_place_id:fixture().id,owner_user_id:'a',rating:3}, {id:uuid(13),personal_place_id:fixture().id,owner_user_id:'a',rating:null},
            {id:uuid(14),personal_place_id:uuid(3),owner_user_id:'a',rating:null}, {id:uuid(15),personal_place_id:uuid(4),owner_user_id:'b',rating:5}];
        const r=screen(rt,'my-places');await r.settle();
        const cards=nodes(r.output).filter(n=>n.type==='Pressable'&&nodes(n).some(n=>n.type==='Icon'&&n.props.name==='chevron-forward'));
        assert.equal(cards.length,3);assert(cards[0].props.accessibilityLabel.includes('Average 2.0/5 · 2 rated / 3 total visits'));
        assert(cards[1].props.accessibilityLabel.includes('No ratings yet · 0 rated / 0 total visits'));assert(cards[2].props.accessibilityLabel.includes('No ratings yet · 0 rated / 1 total visits'));
        assert(!textOf(r.output).includes('Foreign Cafe'));assert(!textOf(r.output).includes('Latest rating'));
        for(const c of rt.world.requests.filter(c=>c.url.pathname==='/rest/v1/personal_visits')){
            assert.equal(c.url.searchParams.get('select'),'id,personal_place_id,rating');assert.equal(c.url.searchParams.get('owner_user_id'),'eq.a');assert.equal(c.user,'a');}
        assert(rt.world.requests.every(c=>c.method==='GET'));r.unmount();
    });
    await test('Live large text remeasures My Places without remounting its private read controller',async()=>{
        const rt=runtime();rt.world.rows=[fixture()];const r=screen(rt,'my-places');await r.settle();const reads=rt.world.requests.length;
        rt.world.windowDimensions={...rt.world.windowDimensions,fontScale:2.143};r.dirty=true;await r.settle();
        const title=nodes(r.output).find(n=>n.props?.accessibilityRole==='header'&&textOf(n)==='My Places');
        assert.equal(flatten(title.props.style).fontSize,30);assert.equal(title.props.allowFontScaling,undefined);
        assert(textOf(r.output).includes('Private Cafe'));assert.equal(rt.world.requests.length,reads);assert.equal(nodes(r.output).filter(n=>n.type==='ScrollView').length,1);r.unmount();
    });
    await test('History summaries page past server row caps using only owner-scoped rating facts',async()=>{
        const history=Array.from({length:5},(_,i)=>({id:uuid(i+10),personal_place_id:fixture().id,rating:i===4?null:i+1}));
        const rt=runtime({fetch:call=>{
            assert.equal(call.method,'GET');assert.equal(call.user,'a');assert.equal(call.url.searchParams.get('owner_user_id'),'eq.a');
            if(call.url.pathname==='/rest/v1/personal_places')return response([fixture()]);
            assert.equal(call.url.pathname,'/rest/v1/personal_visits');const after=call.url.searchParams.get('id')?.slice(3);
            return response(history.filter(v=>!after||v.id>after).slice(0,2)); // smaller than requested page size
        }});
        const rows=await rt.load('@/lib/personal-places').listPersonalPlaces('a');assert.equal(rows[0].average_rating,2.5);assert.equal(rows[0].rated_visit_count,4);assert.equal(rows[0].total_visit_count,5);
        assert.equal(rt.world.requests.filter(c=>c.url.pathname==='/rest/v1/personal_visits').length,4);
    });
    await test('My Places refresh preserves errors, guides empty lists to the Add tab and restores populated cards',async()=>{
        const rt=runtime();rt.world.rows=[fixture()];rt.world.override=c=>c.url.pathname==='/rest/v1/personal_visits'?response({message:'offline'},503):null;
        const r=screen(rt,'my-places');await r.settle();assert(!textOf(r.output).includes('Private Cafe'));assert(!textOf(r.output).includes('0 total visits'));
        assert(!textOf(r.output).includes('Tap the Add tab'));
        rt.world.override=null;rt.world.rows=[];await click(r,'Refresh My Places');
        assert(textOf(r.output).includes('Your collection starts with a visit. Use Add to save your first restaurant to My Places.'));
        assert(!textOf(r.output).includes('Add a Restaurant'));
        rt.world.rows=[fixture()];await click(r,'Refresh My Places');assert(nodes(r.output).some(n=>n.props?.accessibilityLabel?.includes('No ratings yet · 0 rated / 0 total visits')));
        assert(!textOf(r.output).includes('Tap the Add tab'));assert(!textOf(r.output).includes('Add a Restaurant'));r.unmount();
    });
    await test('Account replacement hides pending history summaries and stops the old account paging',async()=>{
        const gate=defer(),rt=runtime();rt.world.rows=[fixture({name:'A-only restaurant'})];
        rt.world.override=c=>c.url.pathname==='/rest/v1/personal_visits'?gate.promise:null;
        const r=screen(rt,'my-places');await r.settle();rt.switch('b',r);await r.settle();gate.resolve(response([{id:uuid(10),personal_place_id:fixture().id,rating:5}]));await r.settle();
        assert(!textOf(r.output).includes('A-only restaurant'));assert(!textOf(r.output).includes('Average 5.0'));assert.equal(rt.world.lateUpdates,0);
        assert.equal(rt.world.requests.filter(c=>c.url.pathname==='/rest/v1/personal_visits').length,1);r.unmount();
    });
    await test('Personal and group details label the verified collection on browsing and Saved-result routes',async()=>{
        for(const fromAdd of [false,true]){
            const rt=runtime();rt.world.params={id:fixture().id};rt.world.rows=[fixture()];
            const r=screen(rt,fromAdd?'add/personal-place/[id]':'personal-place/[id]');await r.settle();assert(textOf(r.output).includes('My Places · Private'));r.unmount();
            let allowed=true;const groupName='Date Nights with a long group name that can wrap';
            const gr=runtime({fetch:call=>{
                if(call.url.pathname==='/rest/v1/groups')return response(allowed?{id:groupId,name:groupName,owner_user_id:'a'}:null);
                if(call.url.pathname==='/rest/v1/group_memberships')return response(allowed?{membership_id:'member'}:null);
                if(call.url.pathname.endsWith('/get_group_restaurants'))return response([{id:entryId,name:'Cafe',address:'Address',average_rating:null,rated_visit_count:0,total_visit_count:0}]);
                if(call.url.pathname.endsWith('/get_group_restaurant_visits'))return response([]);assert.fail(call.url.pathname);
            }});gr.world.params={id:groupId,entryId};
            const view=screen(gr,fromAdd?'add/group/[id]/restaurant/[entryId]':'group/[id]/restaurant/[entryId]');await view.settle();assert(textOf(view.output).replace(/\s+/g,' ').includes('Group · '+groupName));
            allowed=false;gr.poll();await view.settle();assert(!textOf(view.output).includes(groupName));view.unmount();
        }
    });
    await test('Full-screen Add and personal editors respect safe areas and keyboard insets while retaining edge-to-edge scrolling',async()=>{
        for(const insets of [{top:62,left:0,right:0,bottom:34},{top:0,left:59,right:59,bottom:21}])for(const route of ['add-visit','personal-place-form','personal-visit-form']){
            const f=model({platform:'ios',safeAreaInsets:insets}),rt=route==='add-visit'?f.rt:runtime({platform:'ios',safeAreaInsets:insets});
            rt.world.params={id:fixture().id,visitId:entryId};rt.world.rows=[fixture()];rt.world.visits=[{id:entryId,personal_place_id:fixture().id,owner_user_id:'a',rating:null,visited_on:null,would_go_again:null,notes:null,revision:1}];
            const r=screen(rt,route);await r.settle();const scroll=nodes(r.output).find(n=>n.type==='ScrollView'),content=flatten(scroll.props.contentContainerStyle);
            assert.equal(nodes(r.output).filter(n=>n.type==='ScrollView').length,1);assert.equal(content.paddingTop,insets.top+4+44+8);
            assert.equal(content.paddingLeft,Math.max(24,insets.left));assert.equal(content.paddingRight,Math.max(24,insets.right));assert.equal(content.paddingBottom,32+insets.bottom);
            assert.equal(scroll.props.keyboardShouldPersistTaps,'handled');assert.equal(scroll.props.automaticallyAdjustKeyboardInsets,true);
            assert.equal(scroll.props.contentInsetAdjustmentBehavior,'never');assert.equal(flatten(scroll.props.style).flex,1);
            assert(!nodes(scroll).includes(button(r,'Back')));assert.equal(flatten(scroll.props.style).height,undefined);r.unmount();
        }
    });
    console.log(`${passed} Milestone 18 UI usability checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
