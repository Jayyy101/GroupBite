// Date-only round trips and actual form composition; all native/network boundaries are offline.
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {runtime,fixture,response,screen,click,enter,button,nodes,textOf} = require('./personal-places.cjs');
const {model,posts} = require('./unified-add.cjs');
let passed=0;
async function test(label,fn){await fn();passed++;console.log('PASS '+label);}
const calendar=r=>nodes(r.output).find(n=>n.type==='DateTimePicker');
async function choose(r,rt,value){
    calendar(r).props.onChange({type:'set'},rt.load('@/lib/visit-date').visitDateToLocal(value));
    await r.settle();
}
(async()=>{
    await test('Calendar dates round-trip unchanged across DST, UTC boundaries and distant timezones',()=>{
        const code=`const assert=require('node:assert/strict');const d=require('./tests/personal-places.cjs').runtime().load('@/lib/visit-date');
        for(const value of ['0001-01-01','1985-12-31','2000-02-29','2024-02-29','2026-03-08','2026-11-01','2026-12-31']){
            const date=d.visitDateToLocal(value);assert(date);assert.equal(date.getHours(),12);assert.equal(d.localToday(date),value);
            assert(d.visitDateLabel(value).includes(String(Number(value.slice(0,4)))));
        }
        for(const value of [null,'','2026-02-30','0000-01-01','2026-13-01'])assert.equal(d.visitDateToLocal(value),null);
        assert.equal(d.localToday(new Date('2026-01-01T00:30:00Z')),process.env.EXPECTED_LOCAL_DATE);`;
        for(const [zone,date] of [['America/Los_Angeles','2025-12-31'],['America/New_York','2025-12-31'],['UTC','2026-01-01'],['Pacific/Kiritimati','2026-01-01'],['Asia/Kathmandu','2026-01-01']]){
            const r=spawnSync(process.execPath,['-e',code],{cwd:process.cwd(),env:{...process.env,TZ:zone,EXPECTED_LOCAL_DATE:date},encoding:'utf8'});
            assert.equal(r.status,0,zone+': '+r.stderr);
        }
    });
    await test('Native calendar opens without a keyboard input; selection and clear preserve other memory fields',async()=>{
        const rt=runtime({platform:'ios'});let value={visited_on:'2024-02-29',rating:4,would_go_again:false,notes:'Keep this memory'};
        const react=rt.load('react'),VisitFields=rt.load('@/components/visit-fields').VisitFields;
        const r=rt.render(()=>{const [state,set]=react.useState(value);value=state;return {type:VisitFields,props:{value:state,onChange:set,disabled:false}};});await r.settle();
        assert(!nodes(r.output).some(n=>n.type==='TextInput'&&n.props.accessibilityLabel==='Visit date'));
        await click(r,'Visit date');assert.equal(rt.world.keyboardDismissals,1);assert.equal(calendar(r).props.display,'inline');
        assert.equal(rt.load('@/lib/visit-date').localToday(calendar(r).props.value),'2024-02-29');
        assert.equal(calendar(r).props.timeZoneOffsetInMinutes,undefined);assert.equal(calendar(r).props.minimumDate,undefined);
        calendar(r).props.onChange({type:'dismissed'},new Date());await r.settle();assert.equal(value.visited_on,'2024-02-29');
        await choose(r,rt,'1985-12-31');assert.equal(value.visited_on,'1985-12-31');assert.equal(value.notes,'Keep this memory');assert.equal(value.rating,4);assert.equal(value.would_go_again,false);
        await click(r,'Done choosing visit date');assert(!calendar(r));await click(r,'Remove visit date');assert.equal(value.visited_on,null);
        await click(r,'Visit date');await click(r,'Visit date');assert.equal(value.visited_on,null,'Opening/closing must not fill a missing edit date');
        await click(r,'Visit date');await click(r,"Use today's date");assert.equal(value.visited_on,rt.load('@/lib/visit-date').localToday());r.unmount();
    });
    await test('Busy fields disable date changes and hide the calendar without changing the selected date',async()=>{
        const rt=runtime({platform:'ios'});let disabled=false,changes=0;
        const Field=rt.load('@/components/visit-date-field').VisitDateField;
        const r=rt.render(()=>({type:Field,props:{value:'2000-02-29',disabled,onChange:()=>changes++}}));await r.settle();
        await click(r,'Visit date');assert(calendar(r));disabled=true;r.dirty=true;await r.settle();
        assert(!calendar(r));assert(button(r,'Visit date').props.disabled);assert(button(r,'Remove visit date').props.disabled);assert.equal(changes,0);r.unmount();
    });
    await test('Unified Add keeps selected historical dates and explicit null dates in its existing save payload',async()=>{
        for(const date of ['2024-02-29',null]){
            const f=model({platform:'ios'}),r=f.render();await r.settle();
            assert.equal(button(r,'Visit date').props.accessibilityValue.text,f.rt.load('@/lib/visit-date').visitDateLabel(f.rt.load('@/lib/visit-date').localToday()));
            await enter(r,'Restaurant name','Offline date fixture');await enter(r,'Restaurant address','Offline fixture address');
            await enter(r,'Private notes','Preserve private notes');
            if(date){await click(r,'Visit date');await choose(r,f.rt,date);await click(r,'Done choosing visit date');}else await click(r,'Remove visit date');
            await click(r,'My Places');await click(r,'Save Visit');assert.equal(posts(f).length,1);assert.equal(posts(f)[0].body.visit_date,date);assert.equal(posts(f)[0].body.visit_notes,'Preserve private notes');r.unmount();
        }
    });
    await test('Personal edits retain saved or absent dates; choosing a date triggers the existing dirty Back guard',async()=>{
        for(const date of ['1985-12-31',null]){
            const rt=runtime({platform:'ios'}),id='55555555-5555-5555-5555-555555555555';rt.world.params={id:fixture().id,visitId:id};rt.world.rows=[fixture()];
            rt.world.visits=[{id,personal_place_id:fixture().id,owner_user_id:'a',revision:1,origin:'visit',visited_on:date,rating:4,would_go_again:false,notes:'Keep original'}];
            const r=screen(rt,'personal-visit-form');await r.settle();
            assert.equal(button(r,'Visit date').props.accessibilityValue.text,date?rt.load('@/lib/visit-date').visitDateLabel(date):'No date');
            await click(r,'Visit date');await click(r,'Visit date');await click(r,'Back');assert(!textOf(r.output).includes('Discard Changes?'));
            // Reopen as a new route instance; the unchanged Back must not send a mutation.
            assert(!rt.world.requests.some(c=>c.url.pathname.endsWith('/manage_personal_visit')));r.unmount();
            const changed=screen(rt,'personal-visit-form');await changed.settle();await click(changed,'Visit date');await choose(changed,rt,'2000-02-29');
            await click(changed,'Done choosing visit date');await click(changed,'Back');assert(textOf(changed.output).includes('Discard'));
            await click(changed,'Stay');assert.equal(button(changed,'Visit date').props.accessibilityValue.text,rt.load('@/lib/visit-date').visitDateLabel('2000-02-29'));
            assert(!rt.world.requests.some(c=>c.url.pathname.endsWith('/manage_personal_visit')));changed.unmount();
        }
    });
    await test('Group edits use the same calendar, retain their dirty Cancel guard and send only the chosen date',async()=>{
        for(const date of ['2000-02-29',null]){
            const rt=runtime({platform:'ios',fetch:call=>{
                assert(call.url.pathname.endsWith('/update_group_visit'));return response(null);
            }}),Manager=rt.load('@/components/visit-management').VisitManagement;
            const props={visit:{id:'visit',visited_on:'1985-12-31',rating:4,would_go_again:false,notes:'Original memory'},
                scope:{target_group_id:'group',target_group_restaurant_id:'entry',target_visit_id:'visit'},action:'edit',
                onCancel(){},onBusyChange(){},onComplete(){}};
            const r=rt.render(()=>({type:Manager,props}));await r.settle();
            assert.equal(button(r,'Edit visit date').props.accessibilityValue.text,rt.load('@/lib/visit-date').visitDateLabel('1985-12-31'));
            if(date){await click(r,'Edit visit date');await choose(r,rt,date);await click(r,'Done choosing visit date');}else await click(r,'Remove visit date');
            await click(r,'Cancel');assert(textOf(r.output).includes('Discard'));await click(r,'Stay');
            await click(r,'Save Changes');assert.equal(rt.world.requests.length,1);assert.equal(rt.world.requests[0].body.visit_date,date);
            assert.equal(rt.world.requests[0].body.visit_notes,'Original memory');assert.equal(rt.world.requests[0].body.visit_rating,4);r.unmount();
        }
    });
    console.log(`${passed} focused visit-date checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
