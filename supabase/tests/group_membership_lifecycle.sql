-- Run after migrations 1–6 with three test accounts. All fixtures/helpers roll back.
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
select pg_temp.assert_true((select attnotnull from pg_attribute where attrelid='public.group_memberships'::regclass
    and attname='membership_id' and atttypid='uuid'::regtype), 'Membership incarnation is a required UUID');
do $$
begin
    perform set_config('groupbite.owner', (select id::text from public.profiles order by id limit 1), true);
    perform set_config('groupbite.member', (select id::text from public.profiles order by id limit 1 offset 1), true);
    perform set_config('groupbite.other', (select id::text from public.profiles order by id limit 1 offset 2), true);
end;
$$;
set local role authenticated;
do $$
begin
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.owner'),true);
    perform set_config('groupbite.a',(public.create_group('Lifecycle A')).id::text,true);
    perform set_config('groupbite.sole',(public.create_group('Lifecycle sole Owner')).id::text,true);
    perform set_config('groupbite.owner_token',(select membership_id::text from public.group_memberships
        where group_id=current_setting('groupbite.a')::uuid and user_id=auth.uid()),true);
    perform set_config('groupbite.sole_token',(select membership_id::text from public.group_memberships
        where group_id=current_setting('groupbite.sole')::uuid and user_id=auth.uid()),true);
    perform set_config('groupbite.code',public.generate_group_invite(current_setting('groupbite.a')::uuid),true);
    perform set_config('groupbite.restaurant',public.save_restaurant_visit('lifecycle-owner',array[current_setting('groupbite.a')::uuid],
        'Lifecycle Cafe','Lifecycle address','Italian','2026-10-06',5,true,'Owner history')::text,true);
    perform set_config('groupbite.entry',(select id::text from public.group_restaurants
        where group_id=current_setting('groupbite.a')::uuid and restaurant_id=current_setting('groupbite.restaurant')::uuid),true);
    perform set_config('groupbite.owner_visit',(select id::text from public.visits where group_restaurant_id=current_setting('groupbite.entry')::uuid),true);
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.member'),true);
    perform set_config('groupbite.first_request',public.request_group_access(current_setting('groupbite.code'))::text,true);
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.owner'),true);
    perform public.decide_join_request(current_setting('groupbite.first_request')::uuid,'approved');
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.member'),true);
    perform set_config('groupbite.old_token',(select membership_id::text from public.group_memberships
        where group_id=current_setting('groupbite.a')::uuid and user_id=auth.uid()),true);
    perform public.save_restaurant_visit('lifecycle-member',array[current_setting('groupbite.a')::uuid],
        'Lifecycle Cafe','Lifecycle address',visit_rating => 3,visit_notes => 'Member history');
    perform set_config('groupbite.member_visit',(select id::text from public.visits
        where group_restaurant_id=current_setting('groupbite.entry')::uuid and created_by=auth.uid()),true);
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.other'),true);
    perform set_config('groupbite.pending',public.request_group_access(current_setting('groupbite.code'))::text,true);
    perform set_config('groupbite.pending_snapshot',(select to_jsonb(r)::text from public.join_requests r
        where id=current_setting('groupbite.pending')::uuid),true);
    perform set_config('groupbite.b',(public.create_group('Lifecycle isolated B')).id::text,true);
    perform public.save_restaurant_visit('lifecycle-other',array[current_setting('groupbite.b')::uuid],
        'Lifecycle Cafe','Lifecycle address',visit_rating => 1,visit_notes => 'Other group history');
end;
$$;
reset role;
create function pg_temp.history_snapshot()
returns jsonb language sql as $$
    select jsonb_build_object(
        'restaurant', (select to_jsonb(r) from public.restaurants r where id=current_setting('groupbite.restaurant')::uuid),
        'entries', (select jsonb_agg(to_jsonb(gr) order by gr.id) from public.group_restaurants gr where restaurant_id=current_setting('groupbite.restaurant')::uuid),
        'visits', (select jsonb_agg(to_jsonb(v) order by v.id) from public.visits v join public.group_restaurants gr on gr.id=v.group_restaurant_id
            where gr.restaurant_id=current_setting('groupbite.restaurant')::uuid),
        'receipts', (select jsonb_agg(to_jsonb(s) order by s.user_id,s.request_id) from public.visit_save_requests s where restaurant_id=current_setting('groupbite.restaurant')::uuid),
        'profiles', (select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p where id in
            (current_setting('groupbite.owner')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.other')::uuid))
    );
$$;
select set_config('groupbite.history',pg_temp.history_snapshot()::text,true);
-- Uniqueness and defaults apply to existing as well as new membership rows.
select pg_temp.assert_true((select count(*)=count(distinct membership_id) and bool_and(membership_id is not null)
    from public.group_memberships), 'All incarnations are populated and unique');
select pg_temp.expect_error($q$update public.group_memberships set membership_id=current_setting('groupbite.old_token')::uuid
    where group_id=current_setting('groupbite.a')::uuid and user_id=current_setting('groupbite.owner')::uuid$q$,'23505');
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.member'),true); end; $$;
select pg_temp.expect_error($q$select public.get_group_membership_targets(current_setting('groupbite.a')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.owner')::uuid,current_setting('groupbite.owner_token')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.leave_group(current_setting('groupbite.b')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.leave_group(current_setting('groupbite.a')::uuid,null)$q$,'22023');
select pg_temp.expect_error($q$select public.leave_group(current_setting('groupbite.a')::uuid,current_setting('groupbite.owner_token')::uuid)$q$,'22023');
select pg_temp.expect_error($q$delete from public.group_memberships where group_id=current_setting('groupbite.a')::uuid and user_id=auth.uid()$q$,'42501');
select pg_temp.expect_error($q$update public.group_memberships set membership_id=gen_random_uuid()$q$,'42501');
select pg_temp.expect_error($q$insert into public.group_memberships(group_id,user_id) values(current_setting('groupbite.b')::uuid,auth.uid())$q$,'42501');
select pg_temp.assert_true((select count(*)=1 from public.group_memberships where group_id=current_setting('groupbite.a')::uuid), 'Direct membership visibility remains self-only');
select pg_temp.assert_true((select membership_id=current_setting('groupbite.old_token')::uuid
    from public.group_memberships where group_id=current_setting('groupbite.a')::uuid),
    'Ordinary Member can retrieve their current leave token through direct SELECT and RLS');
select pg_temp.assert_true(not exists(select 1 from public.group_memberships
    where group_id=current_setting('groupbite.a')::uuid and membership_id=current_setting('groupbite.owner_token')::uuid),
    'Knowing another members incarnation ID does not expose their membership row');

do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.other'),true); end; $$;
select pg_temp.expect_error($q$select public.get_group_membership_targets(current_setting('groupbite.a')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.leave_group(current_setting('groupbite.a')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'42501');
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.owner'),true); end; $$;
select pg_temp.assert_true((select count(*)=1 and bool_and(user_id=current_setting('groupbite.member')::uuid
    and membership_id=current_setting('groupbite.old_token')::uuid) from public.get_group_membership_targets(current_setting('groupbite.a')::uuid)), 'Owner can read only current non-Owner targets');
select pg_temp.assert_true((select bool_and(to_jsonb(t)-array['user_id','membership_id','display_name']='{}'::jsonb)
    from public.get_group_membership_targets(current_setting('groupbite.a')::uuid) t), 'Target RPC exposes only scoped minimal fields');
select pg_temp.assert_true((select count(*)=0 from public.get_group_membership_targets(current_setting('groupbite.sole')::uuid)), 'Sole Owner has no transfer/removal targets');
select pg_temp.expect_error($q$select public.leave_group(current_setting('groupbite.a')::uuid,current_setting('groupbite.owner_token')::uuid)$q$,'22023');
select pg_temp.expect_error($q$select public.leave_group(current_setting('groupbite.sole')::uuid,current_setting('groupbite.sole_token')::uuid)$q$,'22023');
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.owner')::uuid,current_setting('groupbite.owner_token')::uuid)$q$,'22023');
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.owner')::uuid,current_setting('groupbite.owner_token')::uuid)$q$,'22023');
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.other')::uuid,gen_random_uuid())$q$,'22023');
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,null)$q$,'22023');
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,null)$q$,'22023');
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,null,null)$q$,'22023');
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,null,null)$q$,'22023');
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.sole')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'22023');
select pg_temp.expect_error($q$update public.groups set owner_user_id=current_setting('groupbite.member')::uuid$q$,'42501');
select pg_temp.expect_error($q$delete from public.groups where id=current_setting('groupbite.sole')::uuid$q$,'42501');

-- Leaving revokes group content access, including the caller's historical Visits.
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.member'),true); end; $$;
select public.leave_group(current_setting('groupbite.a')::uuid,
    (select membership_id from public.group_memberships where group_id=current_setting('groupbite.a')::uuid));
select pg_temp.assert_true(not exists(select 1 from public.groups where id=current_setting('groupbite.a')::uuid)
    and not exists(select 1 from public.visits where group_restaurant_id=current_setting('groupbite.entry')::uuid)
    and not exists(select 1 from public.group_restaurants where id=current_setting('groupbite.entry')::uuid), 'RLS immediately denies former-member private reads');
select pg_temp.expect_error($q$select public.get_group_members(current_setting('groupbite.a')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.get_group_restaurants(current_setting('groupbite.a')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.get_group_restaurant_visits(current_setting('groupbite.entry')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.save_restaurant_visit('lifecycle-member',array[current_setting('groupbite.a')::uuid],
    'Lifecycle Cafe','Lifecycle address',visit_rating => 3,visit_notes => 'Member history')$q$,'42501');
select pg_temp.expect_error($q$select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry')::uuid,current_setting('groupbite.member_visit')::uuid,null,1,null,null)$q$,'42501');
select pg_temp.expect_error($q$select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry')::uuid,current_setting('groupbite.member_visit')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.leave_group(current_setting('groupbite.a')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'42501');
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.owner'),true); end; $$;
select public.decide_join_request(current_setting('groupbite.first_request')::uuid,'approved');
select pg_temp.assert_true((select count(*)=1 from public.get_group_members(current_setting('groupbite.a')::uuid)), 'Replay of old approval does not resurrect membership');
do $$
begin
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.member'),true);
    perform set_config('groupbite.rejoin',public.request_group_access(current_setting('groupbite.code'))::text,true);
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.owner'),true);
    perform public.decide_join_request(current_setting('groupbite.rejoin')::uuid,'approved');
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.member'),true);
    perform set_config('groupbite.new_token',(select membership_id::text from public.group_memberships where group_id=current_setting('groupbite.a')::uuid and user_id=auth.uid()),true);
end;
$$;
select pg_temp.assert_true(current_setting('groupbite.new_token')<>current_setting('groupbite.old_token'), 'Rejoining creates a new incarnation');
select pg_temp.expect_error($q$select public.leave_group(current_setting('groupbite.a')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'22023');
select pg_temp.assert_true((select can_manage from public.get_group_restaurant_visits(current_setting('groupbite.entry')::uuid)
    where id=current_setting('groupbite.member_visit')::uuid), 'Same account regains management of historical Visits');
select pg_temp.assert_true((select not can_manage from public.get_group_restaurant_visits(current_setting('groupbite.entry')::uuid)
    where id=current_setting('groupbite.owner_visit')::uuid), 'Rejoining does not grant Owner rights');
savepoint historical_visit_management;
select public.update_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry')::uuid,current_setting('groupbite.member_visit')::uuid,'2026-10-05',4,false,'Rejoined edit');
select pg_temp.assert_true((select created_by=auth.uid() and notes='Rejoined edit' from public.visits where id=current_setting('groupbite.member_visit')::uuid), 'Rejoined creator can edit their original Visit');
select public.delete_group_visit(current_setting('groupbite.a')::uuid,current_setting('groupbite.entry')::uuid,current_setting('groupbite.member_visit')::uuid);
rollback to savepoint historical_visit_management;
release savepoint historical_visit_management;

do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.owner'),true); end; $$;
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'22023');
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'22023');
select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.new_token')::uuid);
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.new_token')::uuid)$q$,'22023');
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.member'),true); end; $$;
select pg_temp.expect_error($q$select public.get_group_restaurant_visits(current_setting('groupbite.entry')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.get_group_membership_targets(current_setting('groupbite.a')::uuid)$q$,'42501');
do $$
begin
    perform set_config('groupbite.second_rejoin',public.request_group_access(current_setting('groupbite.code'))::text,true);
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.owner'),true);
    perform public.decide_join_request(current_setting('groupbite.second_rejoin')::uuid,'approved');
    perform set_config('groupbite.latest_token',(select membership_id::text from public.get_group_membership_targets(current_setting('groupbite.a')::uuid)
        where user_id=current_setting('groupbite.member')::uuid),true);
end;
$$;
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.new_token')::uuid)$q$,'22023');
reset role;
select pg_temp.assert_true(pg_temp.history_snapshot()=current_setting('groupbite.history')::jsonb, 'Leaving, removal and rejoining preserve all history, profiles and receipts');
select set_config('groupbite.memberships_before_transfer',(select jsonb_agg(to_jsonb(m) order by user_id)::text from public.group_memberships m where group_id=current_setting('groupbite.a')::uuid),true);

-- Owner authorization requires current membership even with a deferred FK.
savepoint owner_membership_required;
delete from public.group_memberships where group_id=current_setting('groupbite.a')::uuid and user_id=current_setting('groupbite.owner')::uuid;
set local role authenticated;
select pg_temp.expect_error($q$select public.get_group_membership_targets(current_setting('groupbite.a')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.latest_token')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.latest_token')::uuid)$q$,'42501');
rollback to savepoint owner_membership_required;
release savepoint owner_membership_required;
set local role authenticated;
select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.latest_token')::uuid);
select pg_temp.assert_true((select owner_user_id=current_setting('groupbite.member')::uuid from public.groups where id=current_setting('groupbite.a')::uuid), 'Ownership transferred to an existing member');
select pg_temp.assert_true((select count(*)=2 from public.get_group_members(current_setting('groupbite.a')::uuid)), 'Previous Owner stays a Member');
select pg_temp.assert_true((select is_owner=false from public.get_group_members(current_setting('groupbite.a')::uuid) where user_id=auth.uid()), 'Previous Owner is demoted');
select pg_temp.assert_true((select membership_id=current_setting('groupbite.owner_token')::uuid
    from public.group_memberships where group_id=current_setting('groupbite.a')::uuid),
    'Previous Owner can still retrieve their own current leave token after transfer');
select pg_temp.expect_error($q$select public.get_group_membership_targets(current_setting('groupbite.a')::uuid)$q$,'42501');
select pg_temp.assert_true((select not can_manage from public.get_group_restaurant_visits(current_setting('groupbite.entry')::uuid) where id=current_setting('groupbite.member_visit')::uuid), 'Former Owner loses management of other creators Visits');
select pg_temp.expect_error($q$select public.get_pending_join_requests(current_setting('groupbite.a')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.generate_group_invite(current_setting('groupbite.a')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.revoke_group_invite(current_setting('groupbite.a')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.latest_token')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.latest_token')::uuid)$q$,'42501');
reset role;
select pg_temp.assert_true((select jsonb_agg(to_jsonb(m) order by user_id)=current_setting('groupbite.memberships_before_transfer')::jsonb
    from public.group_memberships m where group_id=current_setting('groupbite.a')::uuid), 'Transfer preserves both membership incarnations and join dates');
select pg_temp.assert_true(not exists(select 1 from public.group_invites where group_id=current_setting('groupbite.a')::uuid and revoked_at is null), 'Transfer revokes active invite records');
select pg_temp.assert_true((select to_jsonb(r)=current_setting('groupbite.pending_snapshot')::jsonb from public.join_requests r where id=current_setting('groupbite.pending')::uuid), 'Pending request and its metadata survive transfer unchanged');
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.other'),true); end; $$;
select pg_temp.expect_error($q$select public.request_group_access(current_setting('groupbite.code'))$q$,'22023');
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.member'),true); end; $$;
select pg_temp.assert_true((select count(*)=1 from public.get_pending_join_requests(current_setting('groupbite.a')::uuid)), 'New Owner can review the preserved pending request');
select pg_temp.assert_true((select bool_and(can_manage) from public.get_group_restaurant_visits(current_setting('groupbite.entry')::uuid)), 'New Owner can manage all group Visits');
select public.decide_join_request(current_setting('groupbite.pending')::uuid,'approved');
do $$
begin
    perform set_config('groupbite.new_code',public.generate_group_invite(current_setting('groupbite.a')::uuid),true);
    perform set_config('groupbite.other_token',(select membership_id::text from public.get_group_membership_targets(current_setting('groupbite.a')::uuid)
        where user_id=current_setting('groupbite.other')::uuid),true);
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.owner'),true);
end;
$$;
select public.leave_group(current_setting('groupbite.a')::uuid,
    (select membership_id from public.group_memberships where group_id=current_setting('groupbite.a')::uuid));
select pg_temp.assert_true(not exists(select 1 from public.group_memberships where group_id=current_setting('groupbite.a')::uuid),
    'Previous Owner can leave with a freshly retrieved token and loses membership visibility');
select pg_temp.expect_error($q$select public.get_group_restaurants(current_setting('groupbite.a')::uuid)$q$,'42501');
do $$
begin
    perform set_config('groupbite.owner_rejoin',public.request_group_access(current_setting('groupbite.new_code'))::text,true);
    perform set_config('request.jwt.claim.sub',current_setting('groupbite.member'),true);
    perform public.decide_join_request(current_setting('groupbite.owner_rejoin')::uuid,'approved');
end;
$$;

-- Inject failures after ownership changes, and during membership deletion.
reset role;
create function pg_temp.fail_lifecycle()
returns trigger language plpgsql as $$
begin
    if tg_op='UPDATE' then
        if old.group_id=current_setting('groupbite.a')::uuid and old.revoked_at is null then
            raise exception 'Simulated invite-revocation failure' using errcode='23514';
        end if;
    elsif old.group_id=current_setting('groupbite.a')::uuid then
        raise exception 'Simulated membership-delete failure' using errcode='23514';
    end if;
    return old;
end;
$$;
create trigger test_fail_transfer before update on public.group_invites for each row execute function pg_temp.fail_lifecycle();
create trigger test_fail_departure before delete on public.group_memberships for each row execute function pg_temp.fail_lifecycle();
set local role authenticated;
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.other')::uuid,current_setting('groupbite.other_token')::uuid)$q$,'23514');
select pg_temp.assert_true((select owner_user_id=auth.uid() from public.groups where id=current_setting('groupbite.a')::uuid), 'Revocation failure rolls back ownership transfer');
select pg_temp.assert_true(exists(select 1 from public.group_invites where group_id=current_setting('groupbite.a')::uuid and revoked_at is null), 'Failed transfer leaves the invite active');
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.other')::uuid,current_setting('groupbite.other_token')::uuid)$q$,'23514');
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('groupbite.other'),true); end; $$;
select pg_temp.expect_error($q$select public.leave_group(current_setting('groupbite.a')::uuid,current_setting('groupbite.other_token')::uuid)$q$,'23514');
select pg_temp.assert_true(exists(select 1 from public.group_memberships where group_id=current_setting('groupbite.a')::uuid and membership_id=current_setting('groupbite.other_token')::uuid), 'Failed removal and leave preserve membership');
reset role;
drop trigger test_fail_transfer on public.group_invites;
drop trigger test_fail_departure on public.group_memberships;
select pg_temp.assert_true(pg_temp.history_snapshot()=current_setting('groupbite.history')::jsonb, 'Ownership changes and rollback preserve all historical records and other groups');
select pg_temp.assert_true(not exists(select 1 from public.groups g where not exists(select 1 from public.group_memberships m
    where m.group_id=g.id and m.user_id=g.owner_user_id)), 'Every group still has its Owner membership');
set constraints groups_owner_membership_fk immediate;

set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub','',true); end; $$;
select pg_temp.expect_error($q$select public.get_group_membership_targets(current_setting('groupbite.a')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.leave_group(current_setting('groupbite.a')::uuid,current_setting('groupbite.old_token')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.remove_group_member(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.latest_token')::uuid)$q$,'42501');
select pg_temp.expect_error($q$select public.transfer_group_ownership(current_setting('groupbite.a')::uuid,current_setting('groupbite.member')::uuid,current_setting('groupbite.latest_token')::uuid)$q$,'42501');
set local role anon;
select pg_temp.expect_error($q$select public.get_group_membership_targets(null)$q$,'42501');
select pg_temp.expect_error($q$select public.leave_group(null,null)$q$,'42501');
select pg_temp.expect_error($q$select public.remove_group_member(null,null,null)$q$,'42501');
select pg_temp.expect_error($q$select public.transfer_group_ownership(null,null,null)$q$,'42501');
reset role;
select pg_temp.assert_true((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in
    ('public.get_group_membership_targets(uuid)'::regprocedure,'public.leave_group(uuid,uuid)'::regprocedure,
     'public.remove_group_member(uuid,uuid,uuid)'::regprocedure,'public.transfer_group_ownership(uuid,uuid,uuid)'::regprocedure)), 'Lifecycle RPCs have an empty search_path');
select pg_temp.assert_true(to_regprocedure('public.delete_group(uuid)') is null, 'No group deletion RPC is introduced');
rollback;
