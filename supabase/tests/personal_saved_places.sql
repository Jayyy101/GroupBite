-- Run after migrations 1–7 with three synthetic local test accounts. Fixtures roll back.
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
select pg_temp.assert_true((select count(*) >= 3 from public.profiles), 'Three accounts are required');
do $$
begin
    perform set_config('personal.a', (select id::text from public.profiles order by id limit 1), true);
    perform set_config('personal.b', (select id::text from public.profiles order by id limit 1 offset 1), true);
    perform set_config('personal.c', (select id::text from public.profiles order by id limit 1 offset 2), true);
    perform set_config('personal.global_before', (select jsonb_build_object(
        'restaurants', (select coalesce(jsonb_agg(to_jsonb(r) order by id), '[]') from public.restaurants r),
        'entries', (select coalesce(jsonb_agg(to_jsonb(gr) order by id), '[]') from public.group_restaurants gr),
        'visits', (select coalesce(jsonb_agg(to_jsonb(v) order by id), '[]') from public.visits v),
        'receipts', (select coalesce(jsonb_agg(to_jsonb(s) order by user_id, request_id), '[]') from public.visit_save_requests s)
    )::text), true);
end;
$$;
select pg_temp.assert_true((select relrowsecurity from pg_class where oid = 'public.personal_places'::regclass), 'RLS enabled');
select pg_temp.assert_true((select count(*) = 4 from pg_policy where polrelid = 'public.personal_places'::regclass), 'Four operation-specific policies');
select pg_temp.assert_true(not has_table_privilege('anon', 'public.personal_places', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'Anonymous has no table grants');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.personal_places', 'TRUNCATE,TRIGGER,REFERENCES'), 'No administrative client privileges');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'public.prepare_personal_place()', 'EXECUTE'), 'Trigger function not client-callable');

set local role authenticated;
do $$
begin
    perform set_config('request.jwt.claim.sub', current_setting('personal.c'), true);
    -- Remove this test account's existing memberships administratively below so
    -- the zero-groups requirement is exercised even in a populated local harness.
end;
$$;
reset role;
delete from public.group_memberships where user_id = current_setting('personal.c')::uuid
    and group_id not in (select id from public.groups where owner_user_id = current_setting('personal.c')::uuid);
-- c owns no groups in the synthetic local harness; assert the fixture explicitly.
select pg_temp.assert_true(not exists(select 1 from public.group_memberships where user_id = current_setting('personal.c')::uuid), 'Zero-group fixture');
set local role authenticated;
do $$
declare saved public.personal_places;
begin
    insert into public.personal_places(name,address,cuisine,visited_on,rating,would_go_again,notes,client_request_id)
        values (' Personal Only Cafe ', ' Private address ', ' Italian ', '2026-10-07', 5, false, ' Private memory ', 'personal-first')
        returning * into saved;
    perform set_config('personal.id', saved.id::text, true);
    perform set_config('personal.created', saved.created_at::text, true);
    perform pg_temp.assert_true(saved.owner_user_id = auth.uid(), 'Owner derives from auth.uid');
    perform pg_temp.assert_true(saved.name = 'Personal Only Cafe' and saved.address = 'Private address'
        and saved.cuisine = 'Italian' and saved.notes = 'Private memory', 'Server trims fields');
    perform pg_temp.assert_true(saved.would_go_again = false and saved.rating = 5 and saved.revision = 1, 'False preference and initial revision');
end;
$$;
select pg_temp.assert_true((select count(*) = 1 from public.personal_places where id = current_setting('personal.id')::uuid), 'User without groups reads own Place');
-- A deliberate new save of the identical memory is independent.
insert into public.personal_places(name,address,cuisine,visited_on,rating,would_go_again,notes,client_request_id)
    values ('Personal Only Cafe','Private address','Italian','2026-10-07',5,false,'Private memory','personal-intentional-duplicate');
select pg_temp.assert_true((select count(*) = 2 from public.personal_places where name = 'Personal Only Cafe'), 'Intentional duplicates allowed');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values('Changed retry','Other address','personal-first')$q$, '23505');
select pg_temp.assert_true((select notes = 'Private memory' and revision = 1 from public.personal_places where id = current_setting('personal.id')::uuid), 'Duplicate retry never overwrites memory');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id,owner_user_id) values('Spoof','Address','spoof',current_setting('personal.a')::uuid)$q$, '42501');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id,id) values('Spoof','Address','spoof-id',gen_random_uuid())$q$, '42501');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id,created_at) values('Spoof','Address','spoof-time',now())$q$, '42501');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id,revision) values('Spoof','Address','spoof-revision',99)$q$, '42501');
select pg_temp.expect_error($q$update public.personal_places set owner_user_id = current_setting('personal.a')::uuid$q$, '42501');
select pg_temp.expect_error($q$update public.personal_places set id = gen_random_uuid()$q$, '42501');
select pg_temp.expect_error($q$update public.personal_places set created_at = now()$q$, '42501');
select pg_temp.expect_error($q$update public.personal_places set updated_at = now()$q$, '42501');
select pg_temp.expect_error($q$update public.personal_places set client_request_id = 'replacement'$q$, '42501');
select pg_temp.expect_error($q$update public.personal_places set revision = 99$q$, '42501');

-- Direct API inputs are validated even without the app form.
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values(' ','Address','bad-name')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values('Name',' ','bad-address')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values(repeat('n',101),'Address','long-name')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values('Name',repeat('a',301),'long-address')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,cuisine,client_request_id) values('Name','Address',repeat('c',101),'long-cuisine')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,notes,client_request_id) values('Name','Address',repeat('n',4001),'long-notes')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,rating,client_request_id) values('Name','Address',0,'bad-rating')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,rating,client_request_id) values('Name','Address',6,'bad-rating-six')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,visited_on,client_request_id) values('Name','Address','2026-02-30','bad-date')$q$, '22008');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,visited_on,client_request_id) values('Name','Address','0001-01-01 BC','bc-date')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,visited_on,client_request_id) values('Name','Address','10000-01-01','large-year')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values('Name','Address','')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values('Name','Address',repeat('r',121))$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values(null,'Address','null-name')$q$, '23502');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values('Name',null,'null-address')$q$, '23502');
insert into public.personal_places(name,address,cuisine,notes,client_request_id) values('Nullable','Address',' ',' ','nullable');
select pg_temp.assert_true((select cuisine is null and notes is null and visited_on is null and rating is null and would_go_again is null from public.personal_places where client_request_id='nullable'), 'Empty optional strings normalize to null');
insert into public.personal_places(name,address,cuisine,notes,rating,visited_on,client_request_id)
    values(repeat('🍕',100),repeat('a',300),repeat('c',100),repeat('n',4000),1,'2024-02-29','boundary');
select pg_temp.assert_true((select char_length(name)=100 from public.personal_places where client_request_id='boundary'), 'Unicode lengths and leap date accepted');

update public.personal_places set name='Edited private cafe', address='Edited private address', cuisine='', visited_on=null, rating=null, would_go_again=null, notes=''
    where id=current_setting('personal.id')::uuid and revision=1;
select pg_temp.assert_true((select name='Edited private cafe' and address='Edited private address' and cuisine is null
    and visited_on is null and rating is null and would_go_again is null and notes is null and revision=2
    and created_at=current_setting('personal.created')::timestamptz and updated_at>=created_at
    and client_request_id='personal-first' from public.personal_places where id=current_setting('personal.id')::uuid), 'Edit facts, clear optional fields, preserve attribution and increment revision');
do $$
declare affected integer;
begin
    update public.personal_places set notes='Stale overwrite' where id=current_setting('personal.id')::uuid and revision=1;
    get diagnostics affected = row_count;
    perform pg_temp.assert_true(affected=0, 'Stale edit affects zero rows');
    delete from public.personal_places where id=current_setting('personal.id')::uuid and revision=1;
    get diagnostics affected = row_count;
    perform pg_temp.assert_true(affected=0, 'Stale deletion affects zero rows');
end;
$$;

-- a and b share a group, while c's personal record remains inaccessible to both.
do $$
begin
    perform set_config('request.jwt.claim.sub',current_setting('personal.a'),true);
    perform set_config('personal.group',(public.create_group('Personal privacy group')).id::text,true);
end;
$$;
reset role;
insert into public.group_memberships(group_id,user_id) values(current_setting('personal.group')::uuid,current_setting('personal.b')::uuid);
set local role authenticated;
do $$
begin
    perform set_config('request.jwt.claim.sub',current_setting('personal.b'),true);
    insert into public.personal_places(name,address,client_request_id) values('Personal Only Cafe','Private address','personal-first');
    perform set_config('personal.b_id',(select id::text from public.personal_places where client_request_id='personal-first'),true);
end;
$$;
select pg_temp.assert_true(not exists(select 1 from public.personal_places where id=current_setting('personal.id')::uuid), 'Other account cannot read by known ID');
select pg_temp.assert_true(not exists(select 1 from public.personal_places where owner_user_id=current_setting('personal.c')::uuid), 'Owner filters do not bypass RLS');
do $$
declare affected integer;
begin
    update public.personal_places set notes='Foreign edit' where id=current_setting('personal.id')::uuid;
    get diagnostics affected = row_count;
    perform pg_temp.assert_true(affected=0, 'Foreign update blocked');
    delete from public.personal_places where id=current_setting('personal.id')::uuid;
    get diagnostics affected = row_count;
    perform pg_temp.assert_true(affected=0, 'Foreign delete blocked');
end;
$$;
select pg_temp.assert_true((select owner_user_id=auth.uid() from public.personal_places where id=current_setting('personal.b_id')::uuid), 'Same request ID can be used independently by another account');
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('personal.a'),true); end; $$;
select pg_temp.assert_true(not exists(select 1 from public.personal_places where id=current_setting('personal.b_id')::uuid), 'Group Owner cannot read member personal Place');
do $$
declare affected integer;
begin
    update public.personal_places set notes='Owner edit' where id=current_setting('personal.b_id')::uuid;
    get diagnostics affected=row_count; perform pg_temp.assert_true(affected=0,'Group Owner cannot edit member personal Place');
    delete from public.personal_places where id=current_setting('personal.b_id')::uuid;
    get diagnostics affected=row_count; perform pg_temp.assert_true(affected=0,'Group Owner cannot delete member personal Place');
end;
$$;
select pg_temp.assert_true(not exists(select 1 from public.get_group_restaurants(current_setting('personal.group')::uuid)), 'Personal Place absent from group summary');
-- b keeps their personal Place through transfer, departure and rejoin.
select public.transfer_group_ownership(current_setting('personal.group')::uuid,current_setting('personal.b')::uuid,
    (select membership_id from public.get_group_membership_targets(current_setting('personal.group')::uuid) where user_id=current_setting('personal.b')::uuid));
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('personal.b'),true); end; $$;
select pg_temp.assert_true(exists(select 1 from public.personal_places where id=current_setting('personal.b_id')::uuid), 'Ownership transfer preserves Places');
select public.transfer_group_ownership(current_setting('personal.group')::uuid,current_setting('personal.a')::uuid,
    (select membership_id from public.get_group_membership_targets(current_setting('personal.group')::uuid) where user_id=current_setting('personal.a')::uuid));
select public.leave_group(current_setting('personal.group')::uuid,
    (select membership_id from public.group_memberships where group_id=current_setting('personal.group')::uuid));
select pg_temp.assert_true(exists(select 1 from public.personal_places where id=current_setting('personal.b_id')::uuid), 'Departure preserves Places');
reset role;
insert into public.group_memberships(group_id,user_id) values(current_setting('personal.group')::uuid,current_setting('personal.b')::uuid);
set local role authenticated;
select pg_temp.assert_true(exists(select 1 from public.personal_places where id=current_setting('personal.b_id')::uuid), 'Rejoin preserves Places');
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('personal.a'),true); end; $$;
select public.remove_group_member(current_setting('personal.group')::uuid,current_setting('personal.b')::uuid,
    (select membership_id from public.get_group_membership_targets(current_setting('personal.group')::uuid) where user_id=current_setting('personal.b')::uuid));
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('personal.b'),true); end; $$;
select pg_temp.assert_true(exists(select 1 from public.personal_places where id=current_setting('personal.b_id')::uuid), 'Removal preserves Places');

do $$ begin perform set_config('request.jwt.claim.sub','',true); end; $$;
select pg_temp.assert_true(not exists(select 1 from public.personal_places), 'Authenticated role with no identity cannot read');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values('No auth','Address','no-auth')$q$, '42501');
do $$
declare affected integer;
begin
    update public.personal_places set notes='No auth'; get diagnostics affected=row_count;
    perform pg_temp.assert_true(affected=0,'No identity cannot update');
    delete from public.personal_places; get diagnostics affected=row_count;
    perform pg_temp.assert_true(affected=0,'No identity cannot delete');
end;
$$;
set local role anon;
select pg_temp.expect_error($q$select * from public.personal_places$q$, '42501');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id) values('Anon','Address','anon')$q$, '42501');
select pg_temp.expect_error($q$update public.personal_places set notes='Anon'$q$, '42501');
select pg_temp.expect_error($q$delete from public.personal_places$q$, '42501');

reset role;
select pg_temp.assert_true((select jsonb_build_object(
    'restaurants', (select coalesce(jsonb_agg(to_jsonb(r) order by id), '[]') from public.restaurants r),
    'entries', (select coalesce(jsonb_agg(to_jsonb(gr) order by id), '[]') from public.group_restaurants gr),
    'visits', (select coalesce(jsonb_agg(to_jsonb(v) order by id), '[]') from public.visits v),
    'receipts', (select coalesce(jsonb_agg(to_jsonb(s) order by user_id, request_id), '[]') from public.visit_save_requests s)
) = current_setting('personal.global_before')::jsonb), 'Personal CRUD never changes global Restaurant/group Visit/receipt data');
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('personal.c'),true); end; $$;
delete from public.personal_places where id=current_setting('personal.id')::uuid and revision=2;
select pg_temp.assert_true(not exists(select 1 from public.personal_places where id=current_setting('personal.id')::uuid), 'Owner delete succeeds');
select pg_temp.assert_true(exists(select 1 from public.personal_places where client_request_id='personal-intentional-duplicate'), 'Delete preserves independent save');
-- No tombstones/receipts are promised: clients must reconcile missing saves and
-- never automatically replay them after deletion.
reset role;
delete from auth.users where id=current_setting('personal.c')::uuid;
select pg_temp.assert_true(not exists(select 1 from public.personal_places where owner_user_id=current_setting('personal.c')::uuid), 'Profile deletion cascades personal data');
select pg_temp.assert_true(exists(select 1 from public.personal_places where id=current_setting('personal.b_id')::uuid), 'Account cascade preserves other users data');
rollback;
