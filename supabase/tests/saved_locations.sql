-- Disposable local PostgreSQL/PostGIS only; three synthetic accounts; fixtures roll back.
begin;
create function pg_temp.assert_true(ok boolean, description text)
returns void language plpgsql as $$
begin
    if ok is distinct from true then raise exception 'Test failed: %', description; end if;
end;
$$;
create function pg_temp.expect_error(statement text, expected_state text)
returns void language plpgsql as $$
begin
    execute statement;
    raise exception 'Expected SQLSTATE %, but the operation succeeded', expected_state;
exception when others then
    if sqlstate <> expected_state then raise; end if;
end;
$$;
select pg_temp.assert_true(current_setting('groupbite.local_validation', true) = 'saved-locations', 'Explicit local harness required');
select pg_temp.assert_true((select count(*) >= 3 from public.profiles), 'Three synthetic accounts required');
do $$
begin
    perform set_config('map.owner', (select id::text from public.profiles order by id limit 1), true);
    perform set_config('map.member', (select id::text from public.profiles order by id limit 1 offset 1), true);
    perform set_config('map.other', (select id::text from public.profiles order by id limit 1 offset 2), true);
end;
$$;
set local role authenticated;
do $$
declare private_id uuid;
begin
    perform set_config('request.jwt.claim.sub', current_setting('map.owner'), true);
    perform set_config('map.a', (public.create_group('Map A')).id::text, true);
    perform set_config('map.b', (public.create_group('Map B')).id::text, true);
    perform set_config('map.code', public.generate_group_invite(current_setting('map.a')::uuid), true);
    perform set_config('map.shared', public.save_restaurant_visit('map-initial',
        array[current_setting('map.a')::uuid, current_setting('map.b')::uuid], 'Map shared cafe', 'Map original address', visit_rating => 5)::text, true);
    perform public.save_restaurant_visit('map-b-rating', array[current_setting('map.b')::uuid], 'Map shared cafe', 'Map original address', visit_rating => 1);
    perform set_config('map.missing', public.save_restaurant_visit('map-no-coordinates', array[current_setting('map.a')::uuid],
        'Map unresolved cafe', 'Map unresolved address')::text, true);
    insert into public.personal_places(name,address,rating,client_request_id)
        values ('Map private cafe', 'Map private address', 2, 'map-personal') returning id into private_id;
    perform set_config('map.personal', private_id::text, true);
end;
$$;
select pg_temp.assert_true((select count(*) = 4 from public.get_saved_locations()
    where name like 'Map %'), 'Historical saves without coordinates remain listed');
select pg_temp.assert_true((select bool_and(latitude is null and longitude is null and resolution_status='unresolved')
    from public.get_saved_locations() where name like 'Map %'), 'No coordinates are invented');
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations(center_latitude=>0,center_longitude=>0,radius_meters=>1000)
    where name like 'Map %'), 'Unresolved records are excluded only when a radius is requested');

do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('map.member'), true);
    perform set_config('map.request', public.request_group_access(current_setting('map.code'))::text, true);
end;
$$;
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations() where name like 'Map %'), 'Pending requests confer no map access');
select pg_temp.expect_error($q$select public.get_saved_locations('group', current_setting('map.a')::uuid)$q$, '42501');
do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('map.owner'), true);
    perform public.decide_join_request(current_setting('map.request')::uuid, 'approved');
    perform set_config('request.jwt.claim.sub', current_setting('map.member'), true);
    perform public.save_restaurant_visit('map-member', array[current_setting('map.a')::uuid],
        'Map shared cafe', 'Map original address', visit_rating=>3);
    perform public.save_restaurant_visit('map-unrated', array[current_setting('map.a')::uuid],
        'Map shared cafe', 'Map original address');
    perform set_config('request.jwt.claim.sub', current_setting('map.other'), true);
    perform set_config('map.c', (public.create_group('Map hidden C')).id::text, true);
    perform set_config('map.hidden', public.save_restaurant_visit('map-hidden', array[current_setting('map.c')::uuid],
        'Map hidden restaurant', 'Map hidden address', visit_rating=>1)::text, true);
end;
$$;
insert into public.personal_places(name,address,rating,client_request_id)
    values ('Map other personal', 'Map other private address', 5, 'map-other-personal');
reset role;
select set_config('map.other_personal', (select id::text from public.personal_places where client_request_id='map-other-personal'), true);
select set_config('map.entry_a', (select id::text from public.group_restaurants where group_id=current_setting('map.a')::uuid and restaurant_id=current_setting('map.shared')::uuid), true);
select set_config('map.entry_b', (select id::text from public.group_restaurants where group_id=current_setting('map.b')::uuid and restaurant_id=current_setting('map.shared')::uuid), true);
select set_config('map.entry_missing', (select id::text from public.group_restaurants where restaurant_id=current_setting('map.missing')::uuid), true);
select set_config('map.entry_hidden', (select id::text from public.group_restaurants where restaurant_id=current_setting('map.hidden')::uuid), true);


set local role service_role;
select pg_temp.assert_true(public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid, current_setting('map.shared')::uuid,current_setting('map.entry_a')::uuid, 'Map original address',
    0, 0, 'synthetic-local', 'test-shared', 'Standardized map address', 'building'), 'Attach to reused Restaurant');
select pg_temp.assert_true(public.attach_verified_restaurant_location(current_setting('map.other')::uuid,
    current_setting('map.c')::uuid, current_setting('map.hidden')::uuid,current_setting('map.entry_hidden')::uuid, 'Map hidden address',
    0, 0, 'synthetic-local', 'test-hidden', 'Standardized hidden address', 'building'), 'Attach to unrelated fixture');
select pg_temp.assert_true(public.attach_verified_personal_place_location(current_setting('map.owner')::uuid,
    current_setting('map.personal')::uuid, 1, 'Map private address', 0, 0, 'synthetic-local', 'test-personal',
    'Standardized private address', 'address'), 'Attach to own Personal Place');
select pg_temp.assert_true(public.attach_verified_personal_place_location(current_setting('map.other')::uuid,
    current_setting('map.other_personal')::uuid, 1, 'Map other private address', 0, 0, 'synthetic-local', 'test-other-personal',
    'Standardized other address', 'address'), 'Attach other private fixture');
-- A's resolution must not become available by saving the catalog facts into C.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('map.other'), true);
select pg_temp.assert_true(exists(select 1 from public.restaurants where id=current_setting('map.shared')::uuid), 'Global catalog facts remain readable before reuse');
select pg_temp.assert_true(not exists(select 1 from public.group_restaurant_locations where group_restaurant_id in
    (current_setting('map.entry_a')::uuid,current_setting('map.entry_b')::uuid)), 'Known Restaurant and entry IDs do not expose unrelated coordinates or provenance');
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations() where restaurant_id=current_setting('map.shared')::uuid), 'No unrelated shared row before saving');
select pg_temp.assert_true(public.save_restaurant_visit('map-other-reuse', array[current_setting('map.c')::uuid],
    'Map shared cafe', 'Map original address', visit_rating=>1, visit_notes=>'Private hidden memory')=current_setting('map.shared')::uuid,
    'Unchanged save RPC reuses the resolved global Restaurant');
select set_config('map.entry_c', (select id::text from public.group_restaurants where group_id=current_setting('map.c')::uuid and restaurant_id=current_setting('map.shared')::uuid), true);
select pg_temp.assert_true(not exists(select 1 from public.group_restaurant_locations where group_restaurant_id in
    (current_setting('map.entry_a')::uuid,current_setting('map.entry_b')::uuid,current_setting('map.entry_c')::uuid)), 'Reuse exposes no location row or provider metadata');
select pg_temp.assert_true((select latitude is null and longitude is null and resolution_status='unresolved'
    and standardized_address is null and resolution_accuracy is null and distance_meters is null and group_average_rating=1
    from public.get_saved_locations(center_latitude=>0,center_longitude=>0) where restaurant_id=current_setting('map.shared')::uuid), 'All-saved query returns only C unresolved, without A coordinates or ratings');
select pg_temp.assert_true((select latitude is null and resolution_status='unresolved' from public.get_saved_locations('group',current_setting('map.c')::uuid)
    where restaurant_id=current_setting('map.shared')::uuid), 'Group query never inherits coordinates');
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations(center_latitude=>0,center_longitude=>0,radius_meters=>1000)
    where restaurant_id=current_setting('map.shared')::uuid), 'Radius query cannot infer A resolution through C');
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations('group',current_setting('map.c')::uuid,0,0,1000)
    where restaurant_id=current_setting('map.shared')::uuid), 'Group radius also excludes unresolved reused Restaurant');
select pg_temp.expect_error($q$select public.get_saved_locations('group',current_setting('map.a')::uuid)$q$, '42501');
select set_config('request.jwt.claim.sub', current_setting('map.owner'), true);
select pg_temp.assert_true((select latitude is null and resolution_status='unresolved' from public.get_saved_locations('group',current_setting('map.b')::uuid)
    where restaurant_id=current_setting('map.shared')::uuid), 'Even a dual-member keeps B unresolved until independently attached');
set local role service_role;
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.member')::uuid,
    current_setting('map.b')::uuid,current_setting('map.shared')::uuid,current_setting('map.entry_b')::uuid,'Map original address',0,0,'test','id','Address','building')$q$, '42501');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.hidden')::uuid,current_setting('map.entry_hidden')::uuid,'Map hidden address',0,0,'test','id','Address','building')$q$, '42501');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.missing')::uuid,current_setting('map.entry_missing')::uuid,'Wrong address',0,0,'test','id','Address','building')$q$, '40001');
select pg_temp.expect_error($q$select public.attach_verified_personal_place_location(current_setting('map.member')::uuid,
    current_setting('map.personal')::uuid,2,'Map private address',0,0,'test','id','Address','building')$q$, '42501');
select pg_temp.expect_error($q$select public.attach_verified_personal_place_location(current_setting('map.owner')::uuid,
    current_setting('map.personal')::uuid,1,'Map private address',0,0,'test','id','Address','building')$q$, '40001');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.missing')::uuid,current_setting('map.entry_missing')::uuid,'Map unresolved address',null,0,'test','id','Address','building')$q$, '23514');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.missing')::uuid,current_setting('map.entry_missing')::uuid,'Map unresolved address',91,0,'test','id','Address','building')$q$, '23514');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.missing')::uuid,current_setting('map.entry_missing')::uuid,'Map unresolved address',0,181,'test','id','Address','building')$q$, '23514');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.missing')::uuid,current_setting('map.entry_missing')::uuid,'Map unresolved address',0,0,'test','id','Address','city')$q$, '23514');
select pg_temp.assert_true(public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.b')::uuid,current_setting('map.shared')::uuid,current_setting('map.entry_b')::uuid,'Map original address',1,1,'test-b','result-b','Standardized B address','building'),
    'A different group resolves its own entry independently');
select pg_temp.assert_true(not public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.shared')::uuid,current_setting('map.entry_a')::uuid,'Map original address',2,2,'test','conflict','Other','building'),
    'Only the first verified resolution wins within one entry');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.shared')::uuid,current_setting('map.entry_b')::uuid,'Map original address',0,0,'test','id','Address','building')$q$, '42501');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.missing')::uuid,current_setting('map.entry_a')::uuid,'Map unresolved address',0,0,'test','id','Address','building')$q$, '42501');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(null,
    current_setting('map.a')::uuid,current_setting('map.shared')::uuid,current_setting('map.entry_a')::uuid,'Map original address',0,0,'test','id','Address','building')$q$, '42501');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.shared')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff','Map original address',0,0,'test','id','Address','building')$q$, '42501');
select pg_temp.assert_true(not public.attach_verified_personal_place_location(current_setting('map.owner')::uuid,
    current_setting('map.personal')::uuid,2,'Map private address',1,1,'test','conflict','Other','building'), 'Personal attachment retry does not overwrite');
select pg_temp.expect_error($q$update public.group_restaurant_locations set latitude=1$q$, '42501');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('map.member'), true);
select pg_temp.assert_true(exists(select 1 from public.restaurants where id=current_setting('map.hidden')::uuid), 'Old global facts remain readable');
select pg_temp.assert_true(not exists(select 1 from public.group_restaurant_locations where group_restaurant_id=current_setting('map.entry_hidden')::uuid), 'Known unrelated Restaurant ID cannot reveal coordinates');
select pg_temp.assert_true(not exists(select 1 from public.personal_place_locations where personal_place_id=current_setting('map.personal')::uuid), 'Group membership does not reveal personal coordinates');
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations() where name in ('Map hidden restaurant','Map private cafe','Map other personal')
    or group_id in (current_setting('map.b')::uuid,current_setting('map.c')::uuid)), 'Map API excludes unrelated groups and private places');
select pg_temp.assert_true((select group_average_rating=4 and personal_rating is null and rated_visit_count=2 and total_visit_count=3
    from public.get_saved_locations() where restaurant_id=current_setting('map.shared')::uuid), 'Only accessible group ratings are aggregated; unrated visits excluded');
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.member')::uuid,
    current_setting('map.a')::uuid,current_setting('map.shared')::uuid,current_setting('map.entry_a')::uuid,'Map original address',0,0,'test','id','Address','building')$q$, '42501');
select pg_temp.expect_error($q$insert into public.group_restaurant_locations(group_restaurant_id,address_snapshot)
    values(current_setting('map.entry_missing')::uuid,'Map unresolved address')$q$, '42501');
select pg_temp.expect_error($q$update public.group_restaurant_locations set latitude=1 where group_restaurant_id=current_setting('map.entry_a')::uuid$q$, '42501');
select pg_temp.expect_error($q$delete from public.personal_place_locations where personal_place_id=current_setting('map.personal')::uuid$q$, '42501');
select pg_temp.expect_error($q$select public.attach_verified_personal_place_location(current_setting('map.owner')::uuid,
    current_setting('map.personal')::uuid,2,'Map private address',0,0,'test','id','Address','building')$q$, '42501');

select set_config('request.jwt.claim.sub', current_setting('map.owner'), true);
select pg_temp.assert_true((select count(*)=2 and count(distinct saved_id)=2 and count(distinct group_id)=2
    from public.get_saved_locations() where restaurant_id=current_setting('map.shared')::uuid), 'Multiple accessible groups retain independent entry IDs');
select pg_temp.assert_true((select group_average_rating=3 from public.get_saved_locations('group',current_setting('map.b')::uuid)
    where restaurant_id=current_setting('map.shared')::uuid), 'A and C ratings do not affect B');
select pg_temp.assert_true((select latitude=0 and longitude=0 and standardized_address='Standardized map address' from public.get_saved_locations('group',current_setting('map.a')::uuid)
    where saved_id=current_setting('map.entry_a')::uuid), 'A retains its original resolution');
select pg_temp.assert_true((select latitude=1 and longitude=1 and standardized_address='Standardized B address' from public.get_saved_locations('group',current_setting('map.b')::uuid)
    where saved_id=current_setting('map.entry_b')::uuid), 'B has its own coordinates and standardized address');
select pg_temp.assert_true((select count(*)=2 and count(distinct standardized_address)=2 and count(distinct latitude)=2 from public.get_saved_locations()
    where restaurant_id=current_setting('map.shared')::uuid), 'All-saved preserves both independent resolutions');
select pg_temp.assert_true((select count(*)=1 and bool_and(saved_id=current_setting('map.entry_a')::uuid)
    from public.get_saved_locations(center_latitude=>0,center_longitude=>0,radius_meters=>1000)
    where restaurant_id=current_setting('map.shared')::uuid), 'Radius includes only A point, not B sharing Restaurant ID');
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations('group',current_setting('map.b')::uuid,0,0,1000)
    where restaurant_id=current_setting('map.shared')::uuid), 'B scope uses its own radius calculation');
select pg_temp.assert_true((select personal_rating=2 and group_average_rating is null and latitude=0 and longitude=0
    from public.get_saved_locations('personal') where saved_id=current_setting('map.personal')::uuid), 'Personal rating and real zero coordinates remain separate');
select pg_temp.assert_true((select count(*)=2 from public.get_saved_locations(center_latitude=>0,center_longitude=>0,radius_meters=>0)
    where name like 'Map %'), 'Zero-radius boundary includes exactly colocated records');
select pg_temp.assert_true((select revision=2 and address='Map private address' from public.personal_places
    where id=current_setting('map.personal')::uuid), 'Attachment increments revision but preserves entered address');
select pg_temp.assert_true((select address='Map original address' from public.restaurants where id=current_setting('map.shared')::uuid), 'Shared standardized metadata does not rewrite address');
select pg_temp.assert_true((select count(*)=1 from public.get_saved_locations(page_size=>1)), 'Page size is bounded');
select pg_temp.assert_true(not exists(select saved_id from public.get_saved_locations(page_size=>1)
    intersect select saved_id from public.get_saved_locations(page_size=>1,page_offset=>1)), 'Stable paging does not repeat entries');
select pg_temp.expect_error($q$select public.get_saved_locations('group',current_setting('map.c')::uuid)$q$, '42501');
select pg_temp.expect_error($q$select public.get_saved_locations('all',current_setting('map.a')::uuid)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations('invalid')$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(scope=>null)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations('group')$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(center_latitude=>0)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(center_latitude=>91,center_longitude=>0)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(center_latitude=>'NaN'::float8,center_longitude=>0)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(center_latitude=>0,center_longitude=>'Infinity'::float8)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(radius_meters=>1)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(center_latitude=>0,center_longitude=>0,radius_meters=>-1)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(center_latitude=>0,center_longitude=>0,radius_meters=>100001)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(center_latitude=>0,center_longitude=>0,radius_meters=>'NaN'::float8)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(page_size=>1001)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(page_size=>null)$q$, '22023');
select pg_temp.expect_error($q$select public.get_saved_locations(page_offset=>-1)$q$, '22023');

-- Personal address edits invalidate locations without changing the existing CRUD API.
update public.personal_places set notes='Notes only' where id=current_setting('map.personal')::uuid and revision=2;
select pg_temp.assert_true(exists(select 1 from public.personal_place_locations where personal_place_id=current_setting('map.personal')::uuid), 'Non-address edits retain coordinates');
update public.personal_places set address='Changed private address' where id=current_setting('map.personal')::uuid and revision=3;
select pg_temp.assert_true(not exists(select 1 from public.personal_place_locations where personal_place_id=current_setting('map.personal')::uuid), 'Address changes atomically clear stale coordinates');
select pg_temp.assert_true((select latitude is null and resolution_status='unresolved' from public.get_saved_locations('personal')
    where saved_id=current_setting('map.personal')::uuid), 'Edited address remains saveable and unresolved');

-- Geodesic fixtures: immediately inside/outside a 1000-meter boundary, generated
-- on the spheroid. 0m above tests exact inclusive boundaries without rounding.
reset role;
insert into public.personal_places(owner_user_id,name,address,client_request_id)
    values (current_setting('map.owner')::uuid,'Map inside','Inside address','map-inside'),
        (current_setting('map.owner')::uuid,'Map outside','Outside address','map-outside');
insert into public.personal_place_locations(personal_place_id,address_snapshot,latitude,longitude,
    resolution_status,resolution_provider,provider_location_id,standardized_address,resolution_accuracy,resolved_at)
select p.id,p.address,extensions.st_y(point::extensions.geometry),extensions.st_x(point::extensions.geometry),
    'resolved','synthetic-local',p.client_request_id,p.address,'building',now()
from public.personal_places p cross join lateral (select extensions.st_project(
    extensions.st_setsrid(extensions.st_makepoint(0,0),4326)::extensions.geography,
    case when p.client_request_id='map-inside' then 999.99 else 1000.01 end,0) as point) projected
where p.client_request_id in ('map-inside','map-outside');
-- Non-resolved statuses are legal, but cannot carry coordinates.
insert into public.group_restaurant_locations(group_restaurant_id,address_snapshot,resolution_status,resolution_provider)
    values(current_setting('map.entry_missing')::uuid,'Map unresolved address','failed','synthetic-local');
select pg_temp.expect_error($q$update public.group_restaurant_locations set latitude=0,longitude=0
    where group_restaurant_id=current_setting('map.entry_missing')::uuid$q$, '23514');
select pg_temp.expect_error($q$update public.group_restaurant_locations set latitude='NaN'::float8
    where group_restaurant_id=current_setting('map.entry_a')::uuid$q$, '23514');
select pg_temp.expect_error($q$update public.group_restaurant_locations set longitude='Infinity'::float8
    where group_restaurant_id=current_setting('map.entry_a')::uuid$q$, '23514');
select pg_temp.assert_true((select count(*)=2 from pg_indexes where schemaname='public'
    and indexname in ('group_restaurant_locations_location_idx','personal_place_locations_location_idx') and indexdef like '%USING gist%'), 'Both spatial indexes exist');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('map.owner'), true);
select pg_temp.assert_true(exists(select 1 from public.get_saved_locations('personal',center_latitude=>0,center_longitude=>0,radius_meters=>1000)
    where name='Map inside' and abs(distance_meters-999.99)<0.001), 'Inside geodesic radius and meters calculation');
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations('personal',center_latitude=>0,center_longitude=>0,radius_meters=>1000)
    where name='Map outside'), 'Outside geodesic radius excluded');
select pg_temp.assert_true((select resolution_status='failed' and latitude is null from public.get_saved_locations()
    where restaurant_id=current_setting('map.missing')::uuid), 'Failed resolution remains in ordinary saved list');

-- Removing one group's final Visit must not erase another group's location or
-- global facts/receipts, or permit an old attachment to enrich a new entry.
do $$
begin
    perform set_config('map.d', (public.create_group('Map lifecycle D')).id::text, true);
    perform set_config('map.e', (public.create_group('Map lifecycle E')).id::text, true);
    perform set_config('map.lifecycle', public.save_restaurant_visit('map-lifecycle',
        array[current_setting('map.d')::uuid,current_setting('map.e')::uuid],
        'Map lifecycle cafe','Map lifecycle address',visit_rating=>4)::text, true);
    perform public.save_restaurant_visit('map-lifecycle-extra',array[current_setting('map.d')::uuid],
        'Map lifecycle cafe','Map lifecycle address',visit_rating=>2);
    perform set_config('map.entry_d', (select id::text from public.group_restaurants
        where group_id=current_setting('map.d')::uuid and restaurant_id=current_setting('map.lifecycle')::uuid), true);
    perform set_config('map.entry_e', (select id::text from public.group_restaurants
        where group_id=current_setting('map.e')::uuid and restaurant_id=current_setting('map.lifecycle')::uuid), true);
end;
$$;
set local role service_role;
select pg_temp.assert_true(public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.d')::uuid,current_setting('map.lifecycle')::uuid,current_setting('map.entry_d')::uuid,
    'Map lifecycle address',4,4,'test-d','result-d','D address','building'), 'Resolve lifecycle D');
select pg_temp.assert_true(public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.e')::uuid,current_setting('map.lifecycle')::uuid,current_setting('map.entry_e')::uuid,
    'Map lifecycle address',5,5,'test-e','result-e','E address','building'), 'Resolve lifecycle E independently');
set local role authenticated;
select pg_temp.assert_true(not public.delete_group_visit(current_setting('map.d')::uuid,current_setting('map.entry_d')::uuid,
    (select id from public.visits where group_restaurant_id=current_setting('map.entry_d')::uuid and rating=2)), 'Nonfinal deletion retains entry');
select pg_temp.assert_true(exists(select 1 from public.group_restaurant_locations where group_restaurant_id=current_setting('map.entry_d')::uuid), 'Nonfinal deletion retains location');
select pg_temp.assert_true(public.delete_group_visit(current_setting('map.d')::uuid,current_setting('map.entry_d')::uuid,
    (select id from public.visits where group_restaurant_id=current_setting('map.entry_d')::uuid)), 'Final deletion removes entry');
select pg_temp.assert_true(not exists(select 1 from public.group_restaurant_locations where group_restaurant_id=current_setting('map.entry_d')::uuid), 'Removed entry has no readable location');
select pg_temp.assert_true((select latitude=5 and provider_location_id='result-e' from public.group_restaurant_locations
    where group_restaurant_id=current_setting('map.entry_e')::uuid), 'Other group resolution survives deletion');
select pg_temp.assert_true(public.save_restaurant_visit('map-lifecycle',array[current_setting('map.e')::uuid,current_setting('map.d')::uuid],
    'Map lifecycle cafe','Map lifecycle address',visit_rating=>4)=current_setting('map.lifecycle')::uuid, 'Original receipt still returns retained Restaurant');
select pg_temp.assert_true(not exists(select 1 from public.group_restaurants where id=current_setting('map.entry_d')::uuid
    or (group_id=current_setting('map.d')::uuid and restaurant_id=current_setting('map.lifecycle')::uuid)), 'Old receipt does not recreate deleted entry');
select pg_temp.assert_true(public.save_restaurant_visit('map-lifecycle-recreate',array[current_setting('map.d')::uuid],
    'Map lifecycle cafe','Map lifecycle address',visit_rating=>3)=current_setting('map.lifecycle')::uuid, 'New save reuses Restaurant');
select set_config('map.recreated_d', (select id::text from public.group_restaurants
    where group_id=current_setting('map.d')::uuid and restaurant_id=current_setting('map.lifecycle')::uuid), true);
select pg_temp.assert_true(current_setting('map.recreated_d')<>current_setting('map.entry_d'), 'Recreated entry has fresh ID');
select pg_temp.assert_true((select latitude is null and resolution_status='unresolved' from public.get_saved_locations('group',current_setting('map.d')::uuid)
    where saved_id=current_setting('map.recreated_d')::uuid), 'Recreated entry starts unresolved despite E resolution');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.group_restaurant_locations where group_restaurant_id=current_setting('map.entry_d')::uuid), 'Cascade physically removes old location');
select pg_temp.assert_true((select count(*)=2 from public.visit_save_requests where user_id=current_setting('map.owner')::uuid
    and request_id in ('map-lifecycle','map-lifecycle-extra')), 'Deletion preserves save receipts');
insert into public.group_memberships(group_id,user_id) values
    (current_setting('map.d')::uuid,current_setting('map.member')::uuid),
    (current_setting('map.e')::uuid,current_setting('map.member')::uuid);
select set_config('map.d_admission', (select membership_id::text from public.group_memberships
    where group_id=current_setting('map.d')::uuid and user_id=current_setting('map.member')::uuid), true);
set local role service_role;
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.d')::uuid,current_setting('map.lifecycle')::uuid,current_setting('map.entry_d')::uuid,
    'Map lifecycle address',4,4,'test','stale','D address','building')$q$, '42501');
select pg_temp.assert_true(public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.d')::uuid,current_setting('map.lifecycle')::uuid,current_setting('map.recreated_d')::uuid,
    'Map lifecycle address',4,4,'test-d','new-result-d','D address','building'), 'Fresh verified result attaches to recreated entry');
set local role authenticated;
select public.remove_group_member(current_setting('map.d')::uuid,current_setting('map.member')::uuid,current_setting('map.d_admission')::uuid);
select set_config('request.jwt.claim.sub', current_setting('map.member'), true);
select pg_temp.assert_true(not exists(select 1 from public.group_restaurant_locations where group_restaurant_id=current_setting('map.recreated_d')::uuid), 'Removal revokes D even with membership in E');
select pg_temp.assert_true((select count(*)=1 and bool_and(saved_id=current_setting('map.entry_e')::uuid and latitude=5)
    from public.get_saved_locations() where restaurant_id=current_setting('map.lifecycle')::uuid), 'Removed member sees only E independent location');
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations(center_latitude=>4,center_longitude=>4,radius_meters=>1000)
    where restaurant_id=current_setting('map.lifecycle')::uuid), 'Removal also revokes D nearby search');
select pg_temp.expect_error($q$select public.get_saved_locations('group',current_setting('map.d')::uuid)$q$, '42501');
set local role service_role;
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.member')::uuid,
    current_setting('map.d')::uuid,current_setting('map.lifecycle')::uuid,current_setting('map.recreated_d')::uuid,
    'Map lifecycle address',4,4,'test','removed','D address','building')$q$, '42501');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('map.owner'), true);

-- Ownership alone is insufficient: removing/transfer/leave use current membership.
select set_config('map.member_incarnation', (select membership_id::text from public.group_memberships
    where group_id=current_setting('map.a')::uuid and user_id=current_setting('map.owner')::uuid), true);
reset role;
select set_config('map.member_incarnation', (select membership_id::text from public.group_memberships
    where group_id=current_setting('map.a')::uuid and user_id=current_setting('map.member')::uuid), true);
set local role authenticated;
select public.transfer_group_ownership(current_setting('map.a')::uuid,current_setting('map.member')::uuid,current_setting('map.member_incarnation')::uuid);
select pg_temp.assert_true(exists(select 1 from public.get_saved_locations('group',current_setting('map.a')::uuid)), 'Old Owner remains readable as current Member');
select set_config('map.owner_incarnation', (select membership_id::text from public.group_memberships
    where group_id=current_setting('map.a')::uuid and user_id=auth.uid()), true);
select public.leave_group(current_setting('map.a')::uuid,current_setting('map.owner_incarnation')::uuid);
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations() where group_id=current_setting('map.a')::uuid), 'Former Owner loses departed group map access');
select pg_temp.assert_true(not exists(select 1 from public.group_restaurant_locations where group_restaurant_id=current_setting('map.entry_a')::uuid), 'Departure revokes A provenance despite B sharing Restaurant ID');
select pg_temp.assert_true((select latitude=1 and longitude=1 and provider_location_id='result-b' and resolution_provider='test-b'
    from public.group_restaurant_locations where group_restaurant_id=current_setting('map.entry_b')::uuid), 'Remaining group grants only its own resolution and provenance');
select pg_temp.assert_true((select count(*)=1 and bool_and(saved_id=current_setting('map.entry_b')::uuid and latitude=1)
    from public.get_saved_locations() where restaurant_id=current_setting('map.shared')::uuid), 'Revoked member sees only B independently resolved row');
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations(center_latitude=>0,center_longitude=>0,radius_meters=>1000)
    where restaurant_id=current_setting('map.shared')::uuid), 'Departure revokes A distance/radius access');
select pg_temp.expect_error($q$select public.get_saved_locations('group',current_setting('map.a')::uuid)$q$, '42501');
set local role service_role;
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.owner')::uuid,
    current_setting('map.a')::uuid,current_setting('map.shared')::uuid,current_setting('map.entry_a')::uuid,'Map original address',0,0,'test','id','Address','building')$q$, '42501');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('map.member'), true);
select pg_temp.assert_true(exists(select 1 from public.get_saved_locations('group',current_setting('map.a')::uuid)), 'New Owner has map access through membership');
reset role;
-- Temporarily violate the deferred owner-membership FK; map access must fail even
-- for an Owner without membership. The fixture is restored before rollback.
delete from public.group_memberships where group_id=current_setting('map.a')::uuid and user_id=current_setting('map.member')::uuid;
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from public.get_saved_locations() where restaurant_id=current_setting('map.shared')::uuid), 'Owner without membership cannot see coordinates or group rows');
select pg_temp.assert_true(not exists(select 1 from public.group_restaurant_locations where group_restaurant_id=current_setting('map.entry_a')::uuid), 'Location RLS also denies former Member/Owner');
set local role service_role;
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.member')::uuid,
    current_setting('map.a')::uuid,current_setting('map.shared')::uuid,current_setting('map.entry_a')::uuid,'Map original address',0,0,'test','id','Address','building')$q$, '42501');
reset role;
insert into public.group_memberships(group_id,user_id) values(current_setting('map.a')::uuid,current_setting('map.member')::uuid);
set local role authenticated;
select pg_temp.assert_true(exists(select 1 from public.get_saved_locations() where restaurant_id=current_setting('map.shared')::uuid), 'Re-admission restores existing history and coordinates');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error($q$select public.get_saved_locations()$q$, '42501');
select pg_temp.assert_true(not exists(select 1 from public.group_restaurant_locations), 'Missing user identity cannot read geographic facts');
set local role anon;
select pg_temp.expect_error($q$select public.get_saved_locations()$q$, '42501');
select pg_temp.expect_error($q$select * from public.group_restaurant_locations$q$, '42501');
select pg_temp.expect_error($q$select * from public.personal_place_locations$q$, '42501');
reset role;
-- A privileged shared-address correction invalidates every entry's metadata;
-- it never copies one group's resolution to another or alters visits/ratings.
update public.restaurants set address='Corrected map address' where id=current_setting('map.shared')::uuid;
select pg_temp.assert_true(not exists(select 1 from public.group_restaurant_locations where group_restaurant_id in
    (current_setting('map.entry_a')::uuid,current_setting('map.entry_b')::uuid,current_setting('map.entry_c')::uuid)), 'Shared address edit clears every scoped resolution');
select pg_temp.assert_true(exists(select 1 from public.group_restaurant_locations where group_restaurant_id=current_setting('map.entry_hidden')::uuid), 'Address invalidation leaves unrelated locations intact');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('map.member'), true);
select pg_temp.assert_true((select latitude is null and resolution_status='unresolved' and address='Corrected map address' and group_average_rating=4
    from public.get_saved_locations('group',current_setting('map.a')::uuid) where saved_id=current_setting('map.entry_a')::uuid), 'Address correction preserves saved entry/ratings and returns unresolved');
set local role service_role;
select pg_temp.expect_error($q$select public.attach_verified_restaurant_location(current_setting('map.member')::uuid,
    current_setting('map.a')::uuid,current_setting('map.shared')::uuid,current_setting('map.entry_a')::uuid,
    'Map original address',0,0,'test','old-address','Address','building')$q$, '40001');
reset role;
rollback;
