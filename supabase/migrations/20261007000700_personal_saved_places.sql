begin;

-- Personal facts stay here: creating a private memory must never publish a
-- Restaurant to the authenticated shared catalog or create a group Visit.
create table public.personal_places (
    id uuid primary key default gen_random_uuid(),
    owner_user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
    name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
    address text not null check (address = btrim(address) and char_length(address) between 1 and 300),
    cuisine text check (cuisine = nullif(btrim(cuisine), '') and char_length(cuisine) between 1 and 100),
    visited_on date check (visited_on between date '0001-01-01' and date '9999-12-31'),
    rating integer check (rating between 1 and 5),
    would_go_again boolean,
    notes text check (notes = nullif(btrim(notes), '') and char_length(notes) between 1 and 4000),
    client_request_id text not null check (char_length(client_request_id) between 1 and 120),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    revision integer not null default 1 check (revision > 0),
    -- Only retries are deduplicated. Intentional saves at the same location are independent.
    unique (owner_user_id, client_request_id)
);
create index personal_places_owner_created_idx on public.personal_places(owner_user_id, created_at desc, id);

create function public.prepare_personal_place()
returns trigger language plpgsql set search_path = ''
as $$
begin
    new.name := btrim(new.name);
    new.address := btrim(new.address);
    new.cuisine := nullif(btrim(new.cuisine), '');
    new.notes := nullif(btrim(new.notes), '');
    if tg_op = 'UPDATE' then
        new.updated_at := clock_timestamp();
        new.revision := old.revision + 1;
    end if;
    return new;
end;
$$;
revoke all on function public.prepare_personal_place() from public, anon, authenticated;
create trigger prepare_personal_place before insert or update on public.personal_places
    for each row execute function public.prepare_personal_place();

alter table public.personal_places enable row level security;
revoke all on public.personal_places from public, anon, authenticated;
grant select, delete on public.personal_places to authenticated;
grant insert (name, address, cuisine, visited_on, rating, would_go_again, notes, client_request_id)
    on public.personal_places to authenticated;
grant update (name, address, cuisine, visited_on, rating, would_go_again, notes)
    on public.personal_places to authenticated;

create policy personal_places_read_own on public.personal_places
    for select to authenticated using (owner_user_id = (select auth.uid()));
create policy personal_places_insert_own on public.personal_places
    for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy personal_places_update_own on public.personal_places
    for update to authenticated using (owner_user_id = (select auth.uid()))
    with check (owner_user_id = (select auth.uid()));
create policy personal_places_delete_own on public.personal_places
    for delete to authenticated using (owner_user_id = (select auth.uid()));

commit;
