-- Synthetic SQL fixtures only, after migrations 1–13 in the disposable runner.
-- This guard prevents accidentally running this write-based test in Dashboard.
do $$
begin
    if current_setting('groupbite.local_validation', true) is distinct from 'personal-apple-place-ids' then
        raise exception 'Requires the disposable local Apple Place ID runner';
    end if;
end;
$$;

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

select pg_temp.assert_true((select atttypid = 'text'::regtype and not attnotnull and not atthasdef
    from pg_attribute where attrelid = 'public.personal_places'::regclass and attname = 'apple_place_id'),
    'Optional text reference without a default or required backfill');
select pg_temp.assert_true(has_column_privilege('authenticated', 'public.personal_places', 'apple_place_id', 'INSERT')
    and not has_column_privilege('authenticated', 'public.personal_places', 'apple_place_id', 'UPDATE'),
    'Client may insert a reference but may not replace or clear it directly');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.personal_places',
    'INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'), 'No broad client write or administrative grants');
select pg_temp.assert_true(not has_table_privilege('anon', 'public.personal_places',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    and not has_any_column_privilege('anon', 'public.personal_places', 'SELECT,INSERT,UPDATE,REFERENCES'),
    'Anonymous has no table or column privileges');
select pg_temp.assert_true(not has_function_privilege('public', 'public.prepare_personal_place()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.prepare_personal_place()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.prepare_personal_place()', 'EXECUTE'), 'No new callable mutation API');
select pg_temp.assert_true((select not prosecdef and proconfig = array['search_path=""']
    from pg_proc where oid = 'public.prepare_personal_place()'::regprocedure), 'Existing invoker security and empty search path');
select pg_temp.assert_true((select convalidated from pg_constraint
    where conrelid = 'public.personal_places'::regclass and conname = 'personal_places_apple_place_id_check'),
    'Identifier check is validated');

select set_config('apple.a', (select id::text from public.profiles order by id limit 1), true);
select set_config('apple.b', (select id::text from public.profiles order by id limit 1 offset 1), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('apple.a'), true);
do $$
declare saved public.personal_places;
begin
    insert into public.personal_places(name,address,cuisine,visited_on,rating,would_go_again,notes,client_request_id,apple_place_id)
        values (' User nickname ', ' 10 Fixture Road ', ' Italian ', '2026-10-13', 4, false, ' User memory ', 'apple-linked', 'Opaque-α:MiXeD/Id')
        returning * into saved;
    perform set_config('apple.id', saved.id::text, true);
    perform set_config('apple.created', saved.created_at::text, true);
    perform pg_temp.assert_true(saved.apple_place_id = 'Opaque-α:MiXeD/Id' and saved.revision = 1
        and saved.owner_user_id = auth.uid(), 'Opaque reference preserved exactly with owner and initial revision');
    perform pg_temp.assert_true(saved.name = 'User nickname' and saved.address = '10 Fixture Road'
        and saved.cuisine = 'Italian' and saved.notes = 'User memory' and saved.would_go_again = false,
        'Independent user fields retain existing normalization and false preference');
end;
$$;

-- Existing callers may omit the field or send NULL. Reference values are not
-- unique: two intentional saves may refer to the same location independently.
insert into public.personal_places(name,address,client_request_id) values ('Legacy','Address','apple-omitted');
insert into public.personal_places(name,address,client_request_id,apple_place_id) values ('Manual','Address','apple-null',null);
insert into public.personal_places(name,address,client_request_id,apple_place_id)
    values ('Second memory','Address','apple-duplicate','Opaque-α:MiXeD/Id');
insert into public.personal_places(name,address,client_request_id,apple_place_id)
    values ('Unicode boundary','Address','apple-boundary',repeat('🍕',300));
insert into public.personal_places(name,address,client_request_id,apple_place_id)
    values ('Opaque spacing','Address','apple-inner-space','Opaque inner space');
select pg_temp.assert_true((select count(*) = 2 from public.personal_places
    where client_request_id in ('apple-omitted','apple-null') and apple_place_id is null), 'NULL compatibility');
select pg_temp.assert_true((select count(*) = 2 from public.personal_places where apple_place_id = 'Opaque-α:MiXeD/Id'),
    'Intentional duplicate references do not merge records');
select pg_temp.assert_true((select char_length(apple_place_id) = 300 from public.personal_places where client_request_id='apple-boundary'),
    'Length counts Unicode code points, not bytes');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id,apple_place_id)
    values ('Invalid','Address','apple-invalid','')$q$, '23514');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id,apple_place_id)
    values ('Invalid','Address','apple-invalid',repeat('i',301))$q$, '23514');
do $$
declare code integer; padding text;
begin
    -- All non-NUL C0/C1 controls are rejected even inside an otherwise valid ID.
    for code in select generate_series(1,31) union all select generate_series(127,159) loop
        perform pg_temp.expect_error(format('insert into public.personal_places(name,address,client_request_id,apple_place_id)
            values (''Invalid'',''Address'',''apple-invalid'',%L)', 'in' || chr(code) || 'side'), '23514');
    end loop;
    -- Match the adapter's ECMAScript trim characters independently of DB locale.
    foreach code in array array[32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279] loop
        padding := chr(code);
        perform pg_temp.expect_error(format('insert into public.personal_places(name,address,client_request_id,apple_place_id)
            values (''Invalid'',''Address'',''apple-invalid'',%L)', padding || 'Opaque'), '23514');
        perform pg_temp.expect_error(format('insert into public.personal_places(name,address,client_request_id,apple_place_id)
            values (''Invalid'',''Address'',''apple-invalid'',%L)', 'Opaque' || padding), '23514');
    end loop;
end;
$$;

select pg_temp.expect_error($q$update public.personal_places set apple_place_id='Replacement'$q$, '42501');
select pg_temp.expect_error($q$update public.personal_places set apple_place_id=null$q$, '42501');
select pg_temp.expect_error($q$update public.personal_places set address='Other',apple_place_id=null$q$, '42501');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id,apple_place_id,owner_user_id)
    values ('Spoof','Address','apple-spoof','Opaque',current_setting('apple.b')::uuid)$q$, '42501');

update public.personal_places set name='New nickname',cuisine='',notes='',visited_on=null,rating=null,would_go_again=null
    where id=current_setting('apple.id')::uuid and revision=1;
select pg_temp.assert_true((select apple_place_id='Opaque-α:MiXeD/Id' and revision=2 and cuisine is null
    and notes is null and rating is null and visited_on is null and would_go_again is null
    and created_at=current_setting('apple.created')::timestamptz and updated_at>=created_at
    and owner_user_id=auth.uid() and client_request_id='apple-linked'
    from public.personal_places where id=current_setting('apple.id')::uuid), 'Ordinary edits preserve reference and immutable metadata');
update public.personal_places set address=' 10 Fixture Road '
    where id=current_setting('apple.id')::uuid and revision=2;
select pg_temp.assert_true((select apple_place_id='Opaque-α:MiXeD/Id' and address='10 Fixture Road' and revision=3
    from public.personal_places where id=current_setting('apple.id')::uuid), 'Compare after address normalization');

-- Existing Geoapify RPC still canonicalizes/attaches its own verified result.
-- Its unchanged address preserves the separate Apple reference, not verification.
set local role service_role;
select pg_temp.assert_true(public.attach_geoapify_personal_place_location(
    current_setting('apple.a')::uuid,current_setting('apple.id')::uuid,3,'10 Fixture Road',
    37.7,-122.4,'synthetic-geoapify',clock_timestamp()+interval '1 minute'), 'Existing Geoapify attachment succeeds');
reset role;
select pg_temp.assert_true((select apple_place_id='Opaque-α:MiXeD/Id' and revision=4
    from public.personal_places where id=current_setting('apple.id')::uuid), 'Geoapify preserves ID and existing revision increment');
select pg_temp.assert_true((select resolution_provider='geoapify' and resolution_status='resolved'
    from public.personal_place_locations where personal_place_id=current_setting('apple.id')::uuid), 'Geoapify location remains independently verified');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('apple.a'), true);
savepoint address_edit;
update public.personal_places set address=' 20 Fixture Road '
    where id=current_setting('apple.id')::uuid and revision=4;
select pg_temp.assert_true((select apple_place_id is null and address='20 Fixture Road' and revision=5
    from public.personal_places where id=current_setting('apple.id')::uuid), 'Older caller address edit clears stale ID in one revision increment');
select pg_temp.assert_true(not exists(select 1 from public.personal_place_locations
    where personal_place_id=current_setting('apple.id')::uuid), 'Existing AFTER trigger invalidates Geoapify location');
rollback to savepoint address_edit;
select pg_temp.assert_true((select apple_place_id='Opaque-α:MiXeD/Id' and address='10 Fixture Road' and revision=4
    from public.personal_places where id=current_setting('apple.id')::uuid)
    and exists(select 1 from public.personal_place_locations where personal_place_id=current_setting('apple.id')::uuid),
    'Rollback restores ID, address, revision and location together');
select pg_temp.expect_error($q$update public.personal_places set address=' ' where id=current_setting('apple.id')::uuid$q$, '23514');
select pg_temp.assert_true((select apple_place_id='Opaque-α:MiXeD/Id' and revision=4
    from public.personal_places where id=current_setting('apple.id')::uuid), 'Invalid edit leaves linked record intact');
do $$
declare affected integer;
begin
    update public.personal_places set address='Stale edit' where id=current_setting('apple.id')::uuid and revision=3;
    get diagnostics affected=row_count;
    perform pg_temp.assert_true(affected=0, 'Stale optimistic edit cannot clear the ID');
end;
$$;
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id,apple_place_id)
    values ('Retry overwrite','Other','apple-linked','Different ID')$q$, '23505');
select pg_temp.assert_true((select apple_place_id='Opaque-α:MiXeD/Id' and revision=4
    from public.personal_places where id=current_setting('apple.id')::uuid), 'Duplicate retry never overwrites the reference');

-- Sharing a group does not grant access to a personal reference.
select set_config('apple.group',(public.create_group('Apple privacy group')).id::text,true);
reset role;
insert into public.group_memberships(group_id,user_id)
    values (current_setting('apple.group')::uuid,current_setting('apple.b')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('apple.b'), true);
select pg_temp.assert_true(not exists(select 1 from public.personal_places where id=current_setting('apple.id')::uuid),
    'Other group member cannot read personal reference by known UUID');
do $$
declare affected integer;
begin
    update public.personal_places set address='Foreign edit' where id=current_setting('apple.id')::uuid;
    get diagnostics affected=row_count;
    perform pg_temp.assert_true(affected=0, 'Other member cannot clear reference through address edit');
    delete from public.personal_places where id=current_setting('apple.id')::uuid;
    get diagnostics affected=row_count;
    perform pg_temp.assert_true(affected=0, 'Other member cannot delete linked record');
end;
$$;
insert into public.personal_places(name,address,client_request_id,apple_place_id)
    values ('Other account','Address','apple-linked','Opaque-α:MiXeD/Id');
select set_config('request.jwt.claim.sub', current_setting('apple.a'), true);
select pg_temp.assert_true(not exists(select 1 from public.personal_places where owner_user_id=current_setting('apple.b')::uuid),
    'Group owner cannot read another account reference; retry identity remains account-scoped');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.assert_true(not exists(select 1 from public.personal_places), 'Authenticated role without identity sees no personal records');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id,apple_place_id)
    values ('No identity','Address','apple-no-auth','Opaque')$q$, '42501');
set local role anon;
select pg_temp.expect_error($q$select apple_place_id from public.personal_places$q$, '42501');
select pg_temp.expect_error($q$insert into public.personal_places(name,address,client_request_id,apple_place_id)
    values ('Anonymous','Address','apple-anon','Opaque')$q$, '42501');

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('apple.a'),true);
delete from public.personal_places where id=current_setting('apple.id')::uuid and revision=4;
select pg_temp.assert_true(not exists(select 1 from public.personal_places where id=current_setting('apple.id')::uuid)
    and not exists(select 1 from public.personal_place_locations where personal_place_id=current_setting('apple.id')::uuid),
    'Owner deletion retains location cascade');
select pg_temp.assert_true(exists(select 1 from public.personal_places where client_request_id='apple-duplicate'),
    'Deleting one memory does not delete an independent reference');
reset role;
rollback;
