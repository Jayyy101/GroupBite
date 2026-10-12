-- Disposable local database only, after migrations 1–12. Fixtures roll back.
begin;
create function pg_temp.check_private(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Privacy regression: %', message; end if; end; $$;
create function pg_temp.denied(statement text, expected text default '42501') returns void language plpgsql as $$
begin execute statement; raise exception 'Expected denial';
exception when others then if sqlstate <> expected then raise; end if; end; $$;
select set_config('privacy.a', (select id::text from public.profiles order by id limit 1), true);
select set_config('privacy.b', (select id::text from public.profiles order by id limit 1 offset 1), true);
select set_config('privacy.c', (select id::text from public.profiles order by id limit 1 offset 2), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('privacy.a'), true);
select set_config('privacy.ga', (public.create_group('Privacy A')).id::text, true);
select set_config('privacy.gc', (public.create_group('Privacy C')).id::text, true);
select set_config('privacy.invite', public.generate_group_invite(current_setting('privacy.ga')::uuid), true);
select set_config('privacy.ra', public.save_restaurant_visit('privacy-a', array[current_setting('privacy.ga')::uuid],
    'Private restaurant', 'Private address', 'Secret cuisine', null, 5, true, 'A secret memory')::text, true);
select set_config('privacy.ea', (select id::text from public.group_restaurants where group_id=current_setting('privacy.ga')::uuid), true);
select set_config('privacy.va', (select id::text from public.visits where group_restaurant_id=current_setting('privacy.ea')::uuid), true);

select set_config('request.jwt.claim.sub', current_setting('privacy.b'), true);
select set_config('privacy.gb', (public.create_group('Privacy B')).id::text, true);
select pg_temp.check_private(not exists(select 1 from public.restaurants where id=current_setting('privacy.ra')::uuid), 'outsider ID lookup');
select pg_temp.check_private(not exists(select 1 from public.restaurants where name='Private restaurant' or cuisine='Secret cuisine'), 'outsider name/address/filter/count');
select pg_temp.check_private(not exists(select 1 from public.group_restaurants where group_id=current_setting('privacy.ga')::uuid), 'outsider joined entry read');
select pg_temp.check_private(not exists(select 1 from public.visits where group_restaurant_id=current_setting('privacy.ea')::uuid), 'outsider visit read');
select pg_temp.check_private(not exists(select 1 from public.get_saved_locations() where restaurant_id=current_setting('privacy.ra')::uuid), 'all-map RPC');
select pg_temp.denied($q$select * from public.get_group_restaurants(current_setting('privacy.ga')::uuid)$q$);
select pg_temp.denied($q$select * from public.get_group_restaurant_visits(current_setting('privacy.ea')::uuid)$q$);
select pg_temp.denied($q$select * from public.get_saved_locations('group',current_setting('privacy.ga')::uuid)$q$);
select pg_temp.denied($q$select * from public.visit_save_requests$q$);
select pg_temp.denied($q$select * from public.visit_save_location_bindings$q$);
select pg_temp.check_private(not exists(select 1 from public.get_visit_save_location_targets('privacy-a')), 'foreign receipt ID');
select pg_temp.denied($q$select public.attach_verified_restaurant_location(auth.uid(),current_setting('privacy.ga')::uuid,current_setting('privacy.ra')::uuid,current_setting('privacy.ea')::uuid,'Private address',1,1,'geoapify','id','Private address','building')$q$);
select pg_temp.denied($q$select public.save_restaurant_visit('privacy-denied',array[current_setting('privacy.gb')::uuid,current_setting('privacy.ga')::uuid],'Unauthorized','Unauthorized')$q$);

-- Deliberately guessing the exact hidden facts cannot reveal its UUID or cuisine.
select set_config('privacy.rb', public.save_restaurant_visit('privacy-b', array[current_setting('privacy.gb')::uuid],
    'Private restaurant', 'Private address', 'B supplied cuisine')::text, true);
select pg_temp.check_private(current_setting('privacy.rb')<>current_setting('privacy.ra'), 'save-time UUID existence oracle removed');
select pg_temp.check_private((select cuisine='B supplied cuisine' from public.restaurants where id=current_setting('privacy.rb')::uuid), 'hidden first-writer cuisine not inherited');
select pg_temp.check_private(not exists(select 1 from public.restaurants where id=current_setting('privacy.ra')::uuid), 'own save does not grant access to hidden row');
select pg_temp.check_private((select count(*)=1 from public.restaurants where name='Private restaurant'), 'only own matching row visible');

-- Pending, approved and former membership boundaries use the current admission.
select set_config('request.jwt.claim.sub', current_setting('privacy.c'), true);
select set_config('privacy.request', public.request_group_access(current_setting('privacy.invite'))::text, true);
select pg_temp.check_private(not exists(select 1 from public.restaurants where id=current_setting('privacy.ra')::uuid), 'pending applicant cannot read facts');
select set_config('request.jwt.claim.sub', current_setting('privacy.a'), true);
select public.decide_join_request(current_setting('privacy.request')::uuid,'approved');
select set_config('request.jwt.claim.sub', current_setting('privacy.c'), true);
select pg_temp.check_private((select cuisine='Secret cuisine' from public.restaurants where id=current_setting('privacy.ra')::uuid), 'current Member can read group facts');
select pg_temp.check_private((select total_visit_count=1 from public.get_group_restaurants(current_setting('privacy.ga')::uuid)), 'member summary access preserved');
select pg_temp.check_private((select not can_manage from public.get_group_restaurant_visits(current_setting('privacy.ea')::uuid)), 'Member cannot manage another creator Visit');
select pg_temp.denied($q$select public.update_group_visit(current_setting('privacy.ga')::uuid,current_setting('privacy.ea')::uuid,current_setting('privacy.va')::uuid,null,1,null,'forged')$q$);
select pg_temp.check_private(public.save_restaurant_visit('privacy-member',array[current_setting('privacy.ga')::uuid],'Private restaurant','Private address','Other cuisine')=current_setting('privacy.ra')::uuid, 'same-group exact reuse');
select set_config('privacy.vc',(select id::text from public.visits where group_restaurant_id=current_setting('privacy.ea')::uuid and created_by=auth.uid()),true);
select public.update_group_visit(current_setting('privacy.ga')::uuid,current_setting('privacy.ea')::uuid,current_setting('privacy.vc')::uuid,null,3,null,'Member edit');
select pg_temp.check_private((select notes='Member edit' from public.visits where id=current_setting('privacy.vc')::uuid), 'Member edits own Visit');
select set_config('privacy.mc', (select membership_id::text from public.group_memberships where group_id=current_setting('privacy.ga')::uuid), true);
select public.leave_group(current_setting('privacy.ga')::uuid,current_setting('privacy.mc')::uuid);
select pg_temp.check_private(not exists(select 1 from public.restaurants where id=current_setting('privacy.ra')::uuid), 'departure immediately removes catalog access');
select pg_temp.denied($q$select * from public.get_group_restaurants(current_setting('privacy.ga')::uuid)$q$);
select pg_temp.denied($q$select public.update_group_visit(current_setting('privacy.ga')::uuid,current_setting('privacy.ea')::uuid,current_setting('privacy.vc')::uuid,null,1,null,'Former Member edit')$q$);

-- Owners retain the pre-existing manage-any-Visit permission.
select set_config('request.jwt.claim.sub', current_setting('privacy.a'), true);
select public.update_group_visit(current_setting('privacy.ga')::uuid,current_setting('privacy.ea')::uuid,current_setting('privacy.vc')::uuid,null,2,null,'Owner moderation');
select pg_temp.check_private((select notes='Owner moderation' and created_by=current_setting('privacy.c')::uuid from public.visits where id=current_setting('privacy.vc')::uuid), 'Owner can manage another creator without rewriting attribution');
select public.update_group_visit(current_setting('privacy.ga')::uuid,current_setting('privacy.ea')::uuid,current_setting('privacy.va')::uuid,null,4,false,'Updated owner memory');
select pg_temp.check_private((select rating=4 and can_manage from public.get_group_restaurant_visits(current_setting('privacy.ea')::uuid) where id=current_setting('privacy.va')::uuid), 'Owner edit and flags unchanged');
select set_config('privacy.rc',public.save_restaurant_visit('privacy-c',array[current_setting('privacy.gc')::uuid],'Private restaurant','Private address','C supplied cuisine')::text,true);
select * from public.save_restaurant_visit_with_location_bindings('privacy-multi',array[current_setting('privacy.gc')::uuid,current_setting('privacy.ga')::uuid],
    'Private restaurant','Private address',null,null,3,null,'Independent copies');
select pg_temp.check_private((select count(*)=2 and count(distinct restaurant_id)=2 from public.get_visit_save_location_targets('privacy-multi')), 'bindings refer to each actual group restaurant');
select * from public.save_restaurant_visit_with_location_bindings('privacy-multi',array[current_setting('privacy.ga')::uuid,current_setting('privacy.gc')::uuid],
    'Private restaurant','Private address',null,null,3,null,'Independent copies');
select pg_temp.check_private((select count(*)=2 from public.visits where notes='Independent copies'), 'multi-group retry creates no duplicate Visits');
select pg_temp.denied($q$select public.save_restaurant_visit('privacy-multi',array[current_setting('privacy.ga')::uuid],'Changed','Private address')$q$,'22023');
select pg_temp.check_private((select count(*)=1 from public.group_restaurants where group_id=current_setting('privacy.gc')::uuid), 'multi-save reuses group entry without duplicating cards');
select pg_temp.check_private(not exists(select 1 from public.restaurants where id=current_setting('privacy.rb')::uuid), 'another Owner still cannot read unrelated row');
select pg_temp.denied($q$insert into public.restaurants(name,address) values('Direct','Direct')$q$);
select pg_temp.denied($q$update public.restaurants set cuisine='Bypass'$q$);
select pg_temp.denied($q$delete from public.restaurants$q$);

-- Orphaned historical facts do not become globally discoverable.
do $$ declare row record; begin
    for row in select gr.id as entry_id,v.id as visit_id from public.visits v join public.group_restaurants gr on gr.id=v.group_restaurant_id
        where gr.group_id=current_setting('privacy.gc')::uuid loop
        perform public.delete_group_visit(current_setting('privacy.gc')::uuid,row.entry_id,row.visit_id);
    end loop;
end; $$;
select pg_temp.check_private(not exists(select 1 from public.restaurants where id=current_setting('privacy.rc')::uuid), 'orphan facts hidden even from former saving Owner');
select pg_temp.check_private((select count(*)=1 from public.get_visit_save_location_targets('privacy-multi')), 'deleted exact binding never remains attachable');
select pg_temp.check_private(public.save_restaurant_visit('privacy-c',array[current_setting('privacy.gc')::uuid],'Private restaurant','Private address','C supplied cuisine')=current_setting('privacy.rc')::uuid, 'old receipt identity retained');
select pg_temp.check_private(not exists(select 1 from public.get_group_restaurants(current_setting('privacy.gc')::uuid)), 'old retry never resurrects deleted entry');
select * from public.save_restaurant_visit_with_location_bindings('privacy-recreated',array[current_setting('privacy.gc')::uuid],'Private restaurant','Private address');
select pg_temp.check_private((select restaurant_id<>current_setting('privacy.rc')::uuid from public.get_visit_save_location_targets('privacy-recreated')), 'new save gets new scoped facts');
select pg_temp.check_private((select count(*)=1 from public.get_visit_save_location_targets('privacy-multi')), 'historical binding never retargets recreated entry');
reset role;
select pg_temp.check_private(exists(select 1 from public.restaurants where id=current_setting('privacy.rc')::uuid), 'orphan historical facts preserved without disclosure');
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.check_private(not exists(select 1 from public.restaurants), 'role without user sees no catalog');
set local role anon;
select pg_temp.denied($q$select * from public.restaurants$q$);
select pg_temp.denied($q$select public.save_restaurant_visit('anon',array[current_setting('privacy.ga')::uuid],'A','A')$q$);
rollback;
