-- READ ONLY. Run only against an explicitly selected, authorized environment.
-- No names imply disposability. Account/group/row approval comes from the owner.
begin read only;
select to_regclass('public.personal_visits') is not null has_history,
    to_regclass('public.add_destination_requests') is not null has_receipts \gset
select id, email from auth.users where email = 'machaojie0611@gmail.com';
select p.id, p.display_name,
    (select count(*) from public.personal_places x where x.owner_user_id=p.id) personal_cards,
    (select count(*) from public.visits x where x.created_by=p.id) group_visits
from public.profiles p order by p.id;
select g.id,g.name,g.owner_user_id,m.user_id,m.membership_id from public.groups g
join public.group_memberships m on m.group_id=g.id order by g.id,m.user_id;
select p.id,p.owner_user_id,p.name,p.address,p.apple_place_id,p.revision,
    md5(to_jsonb(p)::text) row_hash
from public.personal_places p order by p.owner_user_id,p.id;
select v.id,gr.group_id,gr.id entry_id,v.created_by,r.name,r.address,md5(to_jsonb(v)::text) row_hash
from public.visits v join public.group_restaurants gr on gr.id=v.group_restaurant_id
join public.restaurants r on r.id=gr.restaurant_id order by gr.group_id,gr.id,v.id;
select owner_user_id,name,address,count(*) duplicate_cards from public.personal_places
    group by owner_user_id,name,address having count(*)>1;
select gr.group_id,r.name,r.address,count(*) duplicate_cards from public.group_restaurants gr
    join public.restaurants r on r.id=gr.restaurant_id group by gr.group_id,r.name,r.address having count(*)>1;
select owner_user_id,apple_place_id,count(*) duplicate_apple_references from public.personal_places
    where apple_place_id is not null group by owner_user_id,apple_place_id having count(*)>1;
select gr.group_id,gr.apple_place_id,count(*) duplicate_apple_references from public.group_restaurants gr
    where gr.apple_place_id is not null group by gr.group_id,gr.apple_place_id having count(*)>1;
select conrelid::regclass child,confrelid::regclass parent,pg_get_constraintdef(oid) definition
from pg_constraint where contype='f' and (conrelid::regclass::text like '%personal%'
    or conrelid in ('public.visits'::regclass,'public.group_restaurants'::regclass,
        'public.visit_save_requests'::regclass,'public.visit_save_location_bindings'::regclass,to_regclass('public.add_destination_requests')));
\if :has_history
select owner_user_id,personal_place_id,count(*) personal_visits from public.personal_visits group by owner_user_id,personal_place_id;
\endif
\if :has_receipts
select 'add_destination_requests' receipt_table,count(*) receipts from public.add_destination_requests;
\endif
select 'visit_save_requests' receipt_table,count(*) from public.visit_save_requests
union all select 'visit_save_location_bindings',count(*) from public.visit_save_location_bindings;
rollback;
