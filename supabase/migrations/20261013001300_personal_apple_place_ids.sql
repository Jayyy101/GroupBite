begin;

-- An optional, untrusted Apple reference, separate from user-authored facts and
-- verified provider locations. Existing rows remain NULL; no map data is stored.
alter table public.personal_places
    add column apple_place_id text,
    add constraint personal_places_apple_place_id_check check (
        apple_place_id is null or (
            char_length(apple_place_id) between 1 and 300
            -- Match the adapter's whitespace/control checks regardless of locale.
            -- PostgreSQL text already rejects NUL. Never normalize an opaque ID.
            and apple_place_id collate "C" = btrim(apple_place_id,
                U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
            and apple_place_id collate "C" !~ U&'[\0001-\001F\007F-\009F]'
        )
    );

-- Reuse owner-only RLS, SELECT and deletion. No table-wide write grant, ID UPDATE
-- grant, new RPC, deduplication index or location-verification privilege.
grant insert (apple_place_id) on public.personal_places to authenticated;

-- CREATE OR REPLACE preserves this function's owner, ACL and trigger identity.
-- Keep trimming, timestamps and optimistic revision behavior exactly as before.
create or replace function public.prepare_personal_place()
returns trigger language plpgsql set search_path = ''
as $$
begin
    new.name := btrim(new.name);
    new.address := btrim(new.address);
    new.cuisine := nullif(btrim(new.cuisine), '');
    new.notes := nullif(btrim(new.notes), '');
    if tg_op = 'UPDATE' then
        -- Compare after normalization, including edits from older app binaries.
        -- A display-name/notes change does not change the linked location.
        if new.address is distinct from old.address then
            new.apple_place_id := null;
        end if;
        new.updated_at := clock_timestamp();
        new.revision := old.revision + 1;
    end if;
    return new;
end;
$$;

commit;
