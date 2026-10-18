-- PREPARED ONLY. Compact deterministic request identities; no Auth users, groups,
-- memberships or ownership are created/changed. No automatic hosted invocation.
-- Operator supplies groupbite.m18.jay_id, group_a, group_b and explicit approval.
-- Native-verified Apple IDs may optionally be supplied as apple_mowry/apple_auto.
begin;
do $$
declare jay uuid := current_setting('groupbite.m18.jay_id',false)::uuid;
begin
    if current_setting('groupbite.m18.approved_operation',true) is distinct from 'm18-fixtures-v1' then
        raise exception 'Explicit target/scoped fixture approval is required.'; end if;
    if not exists(select 1 from auth.users where id=jay and email='machaojie0611@gmail.com') then
        raise exception 'Jay identity was not verified.'; end if;
    if nullif(current_setting('groupbite.m18.apple_auto',true),'') is not null
        and nullif(current_setting('groupbite.m18.apple_auto_address',true),'') is null then
        raise exception 'Supply the native-verified address with the second Apple ID.'; end if;
    if current_setting('groupbite.m18.group_a',false)::uuid = current_setting('groupbite.m18.group_b',false)::uuid then
        raise exception 'Choose two distinct explicitly approved existing groups.'; end if;
end;
$$;
select set_config('request.jwt.claim.sub',current_setting('groupbite.m18.jay_id'),true);
set local role authenticated;
do $$
declare f record; target_group uuid; admission uuid;
begin
    for f in select * from (values
       ('manual-1','M18_TEST Manual Cafe','100 M18 Fixture Road',null::text,date '2026-10-01',5,true,'M18_TEST private first','M18_TEST group first'),
       ('manual-2','M18_TEST Manual Cafe','100 M18 Fixture Road',null::text,date '2026-10-12',2,false,'M18_TEST private repeat','M18_TEST group repeat'),
       ('mowry','M18_TEST Chipotle Mowry','2760 Mowry Avenue, Fremont, CA 94538',nullif(current_setting('groupbite.m18.apple_mowry',true),''),date '2026-10-14',4,true,'M18_TEST private Mowry','M18_TEST group Mowry'),
       ('auto','M18_TEST Chipotle Auto Mall',coalesce(nullif(current_setting('groupbite.m18.apple_auto_address',true),''),'400 M18 Fixture Road'),nullif(current_setting('groupbite.m18.apple_auto',true),''),date '2026-10-15',3,null,null,null),
       ('optional','M18_TEST Optional Cafe','200 M18 Fixture Road',null::text,null::date,null::integer,null::boolean,null::text,null::text)
    ) as fixture(key,name,address,apple,visited_on,rating,again,private_notes,group_notes) loop
        perform public.save_personal_visit('m18-fixture-v1-personal-'||f.key,f.name,f.address,
            visit_date=>f.visited_on,visit_rating=>f.rating,visit_would_go_again=>f.again,visit_notes=>f.private_notes,restaurant_apple_place_id=>f.apple);
        -- Only three visits per group: repeat history and a second location.
        if f.key in ('manual-1','manual-2','mowry') then
            foreach target_group in array array[current_setting('groupbite.m18.group_a')::uuid,current_setting('groupbite.m18.group_b')::uuid] loop
                select membership_id into strict admission from public.group_memberships where group_id=target_group and user_id=auth.uid();
                perform public.save_group_visit_destination('m18-fixture-v1-group-'||target_group::text||'-'||f.key,target_group,f.name,f.address,
                    visit_date=>f.visited_on,visit_rating=>f.rating,visit_would_go_again=>f.again,visit_notes=>f.group_notes,
                    restaurant_apple_place_id=>f.apple,expected_membership_id=>admission);
            end loop;
        end if;
    end loop;
end;
$$;
commit;
