do $$ begin
    if current_setting('groupbite.local_validation',true) is distinct from 'visit-photos' then
        raise exception 'Requires disposable --visit-photos runner'; end if;
end $$;
begin;
create or replace function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Test failed: %',label;end if;end $$;
create or replace function pg_temp.expect_error(statement text,expected_state text) returns void language plpgsql as $$
begin execute statement;raise exception 'Expected SQLSTATE %',expected_state;
exception when others then if sqlstate<>expected_state then raise;end if;end $$;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
set local role authenticated;
select set_config('vp.group',(public.create_group('Photo SQL')).id::text,true);
select set_config('vp.admission',(select membership_id::text from public.group_memberships where group_id=current_setting('vp.group')::uuid and user_id=auth.uid()),true);
select set_config('vp.personal',public.save_personal_visit('vp-personal','Photo cafe','Photo address')::text,true);
select set_config('vp.pvisit',(select visit_id::text from public.get_add_destination_result('vp-personal')),true);
select set_config('vp.entry',public.save_group_visit_destination('vp-group',current_setting('vp.group')::uuid,'Photo cafe','Photo address',expected_membership_id=>current_setting('vp.admission')::uuid)::text,true);
select set_config('vp.gvisit',(select visit_id::text from public.get_add_destination_result('vp-group')),true);
select * from public.visit_photo_command('reserve','personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid,
    photo_id=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',image_width=>1600,image_height=>1200,image_size=>100,thumbnail_size=>20);
select * from public.visit_photo_command('reserve','personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid,
    photo_id=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',image_width=>1600,image_height=>1200,image_size=>100,thumbnail_size=>20);
select pg_temp.assert_true((select count(*)=1 and min(state)='pending' from public.get_visit_photos('personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid)),'Reservation retry is one pending attachment');
select pg_temp.expect_error($q$select * from public.visit_photo_command('reserve','personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid,photo_id=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',image_width=>1400,image_height=>1200,image_size=>100,thumbnail_size=>20)$q$,'22023');
insert into storage.objects(bucket_id,name,metadata) values('visit-photos',auth.uid()::text||'/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/image.jpg','{"mimetype":"image/jpeg","size":100}');
select pg_temp.assert_true((select state='pending' from public.get_visit_photos('personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid)),'Partial bytes remain pending');
savepoint wrong_size;
insert into storage.objects(bucket_id,name,metadata) values('visit-photos',auth.uid()::text||'/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/thumbnail.jpg','{"mimetype":"image/jpeg","size":21}');
select pg_temp.assert_true((select state='pending' from public.get_visit_photos('personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid)),'Wrong stored byte count cannot confirm completion');
rollback to savepoint wrong_size;
release savepoint wrong_size;
savepoint storage_preflight;
insert into storage.objects(bucket_id,name,metadata) values('visit-photos',auth.uid()::text||'/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/thumbnail.jpg','{"mimetype":"image/jpeg","contentLength":20}');
rollback to savepoint storage_preflight;
release savepoint storage_preflight;
insert into storage.objects(bucket_id,name,metadata) values('visit-photos',auth.uid()::text||'/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/thumbnail.jpg','{"mimetype":"image/jpeg","size":20}');
select pg_temp.assert_true((select state='ready' from public.get_visit_photos('personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid)),'Both variants confirm readiness');
select pg_temp.assert_true((select count(*)=2 from storage.objects where name like '%/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%'),'Owner can read both private variants');
update storage.objects set metadata='{}' where name like '%/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%';
select pg_temp.assert_true((select count(*)=2 from storage.objects where metadata->>'mimetype'='image/jpeg' and name like '%/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%'),'Storage updates have no policy');
select pg_temp.expect_error('select * from public.visit_photos','42501');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
select pg_temp.assert_true((select count(*)=0 from storage.objects where name like '%/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%'),'Known private path denied to other account');
select pg_temp.expect_error($q$select * from public.get_visit_photos('personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid)$q$,'42501');
reset role;
insert into public.group_memberships(group_id,user_id) values(current_setting('vp.group')::uuid,'33333333-3333-3333-3333-333333333333');
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select set_config('vp.member',(select membership_id::text from public.group_memberships where group_id=current_setting('vp.group')::uuid and user_id=auth.uid()),true);
select pg_temp.expect_error($q$select * from public.visit_photo_command('reserve','group',current_setting('vp.entry')::uuid,current_setting('vp.gvisit')::uuid,current_setting('vp.group')::uuid,current_setting('vp.member')::uuid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1600,1200,100,20)$q$,'42501');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select * from public.visit_photo_command('reserve','group',current_setting('vp.entry')::uuid,current_setting('vp.gvisit')::uuid,current_setting('vp.group')::uuid,current_setting('vp.admission')::uuid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1600,1200,100,20);
insert into storage.objects(bucket_id,name,metadata) values
    ('visit-photos',auth.uid()::text||'/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/image.jpg','{"mimetype":"image/jpeg","size":100}'),
    ('visit-photos',auth.uid()::text||'/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/thumbnail.jpg','{"mimetype":"image/jpeg","size":20}');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select pg_temp.assert_true((select count(*)=2 from storage.objects where name like '%/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/%'),'Member can read shared photos');
select pg_temp.assert_true((select count(*)=1 from public.get_visit_photos('group',current_setting('vp.entry')::uuid,current_setting('vp.gvisit')::uuid,current_setting('vp.group')::uuid,current_setting('vp.member')::uuid)),'Member sees completed group photo metadata');
select pg_temp.expect_error($q$select * from public.visit_photo_command('remove','group',current_setting('vp.entry')::uuid,current_setting('vp.gvisit')::uuid,current_setting('vp.group')::uuid,current_setting('vp.member')::uuid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expected_revision=>1)$q$,'42501');
reset role;
delete from public.group_memberships where group_id=current_setting('vp.group')::uuid and user_id='33333333-3333-3333-3333-333333333333';
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from storage.objects where name like '%/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/%'),'Departure revokes object reads');
reset role;
insert into public.group_memberships(group_id,user_id) values(current_setting('vp.group')::uuid,'33333333-3333-3333-3333-333333333333');
set local role authenticated;
select pg_temp.expect_error($q$select * from public.get_visit_photos('group',current_setting('vp.entry')::uuid,current_setting('vp.gvisit')::uuid,current_setting('vp.group')::uuid,current_setting('vp.member')::uuid)$q$,'42501');
select pg_temp.assert_true((select count(*)=2 from storage.objects where name like '%/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/%'),'Rejoined current member may read old shared photos');
select set_config('vp.currentmember',(select membership_id::text from public.group_memberships where group_id=current_setting('vp.group')::uuid and user_id=auth.uid()),true);
select set_config('vp.memberentry',public.save_group_visit_destination('vp-member',current_setting('vp.group')::uuid,'Member photo cafe','Member photo address',expected_membership_id=>current_setting('vp.currentmember')::uuid)::text,true);
select set_config('vp.membervisit',(select visit_id::text from public.get_add_destination_result('vp-member')),true);
select set_config('vp.memberpersonal',public.save_personal_visit('vp-member-private','Member private cafe','Member private address')::text,true);
select set_config('vp.memberprivatevisit',(select visit_id::text from public.get_add_destination_result('vp-member-private')),true);
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.expect_error($q$select * from public.get_visit_photos('personal',current_setting('vp.memberpersonal')::uuid,current_setting('vp.memberprivatevisit')::uuid)$q$,'42501');
select * from public.visit_photo_command('reserve','group',current_setting('vp.memberentry')::uuid,current_setting('vp.membervisit')::uuid,current_setting('vp.group')::uuid,current_setting('vp.admission')::uuid,'cccccccc-cccc-4ccc-8ccc-cccccccccccc',100,100,100,20);
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',true);
select * from public.visit_photo_command('remove','group',current_setting('vp.memberentry')::uuid,current_setting('vp.membervisit')::uuid,current_setting('vp.group')::uuid,current_setting('vp.currentmember')::uuid,'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expected_revision=>1);
select pg_temp.assert_true((select state='removed' from public.get_visit_photos('group',current_setting('vp.memberentry')::uuid,current_setting('vp.membervisit')::uuid,current_setting('vp.group')::uuid,current_setting('vp.currentmember')::uuid)),'Owner can attach to member visit; creator can manage that attachment');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.expect_error($q$select * from public.visit_photo_command('remove','personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid,photo_id=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expected_revision=>9)$q$,'40001');
select * from public.visit_photo_command('remove','personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid,photo_id=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expected_revision=>1);
select * from public.visit_photo_command('remove','personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid,photo_id=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expected_revision=>1);
select pg_temp.assert_true((select state='removed' and revision=2 from public.get_visit_photos('personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid)),'Tombstone confirms response loss without resurrection');
select pg_temp.assert_true((select count(*)=0 from storage.objects where name like '%/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%'),'Removal immediately hides bytes');
select * from public.visit_photo_command('reserve','personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid,photo_id=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',image_width=>1600,image_height=>1200,image_size=>100,thumbnail_size=>20);
select pg_temp.assert_true(not public.can_access_visit_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true),'Retried reservation cannot unlock removed bytes');
-- Pending reservations count toward the cap, serialized by the parent lock.
do $$ begin for i in 1..12 loop
    perform public.visit_photo_command('reserve','personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid,
        photo_id=>('dddddddd-dddd-4ddd-8ddd-'||lpad(i::text,12,'0'))::uuid,image_width=>100,image_height=>100,image_size=>100,thumbnail_size=>20);
end loop; end $$;
select pg_temp.expect_error($q$select * from public.visit_photo_command('reserve','personal',current_setting('vp.personal')::uuid,current_setting('vp.pvisit')::uuid,photo_id=>'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',image_width=>100,image_height=>100,image_size=>100,thumbnail_size=>20)$q$,'22023');
select public.delete_group_visit(current_setting('vp.group')::uuid,current_setting('vp.entry')::uuid,current_setting('vp.gvisit')::uuid);
select pg_temp.assert_true((select count(*)=0 from storage.objects where name like '%/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/%'),'Visit deletion revokes photo reads');
select pg_temp.assert_true(not has_function_privilege('anon','public.get_visit_photos(text,uuid,uuid,uuid,uuid)','execute'),'Anonymous photo RPC denied');
reset role;
select pg_temp.assert_true((select not public and allowed_mime_types=array['image/jpeg'] from storage.buckets where id='visit-photos'),'Bucket is private and JPEG-only');
rollback;
