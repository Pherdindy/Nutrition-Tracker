-- Accounts migration 2/2: backfill owner, defaults, per-user keys, per-user RLS.
-- RUN AFTER: migration 1, code deploy, and the owner's first sign-in.
-- REPLACE <OWNER_UID> with the owner's auth.users id before running.
--
-- PREFLIGHT (verified against the live db 2026-07-27): days.id and
-- food_entries.id are already bigint, so no id-widening is needed. (Client ids
-- come from Date.now() (~1.75e12), which would overflow int4.) PK constraint
-- names below were also verified against pg_constraint on the live db.

-- 1) Backfill: everything unowned belongs to the owner (includes any rows
--    written between deploy and this migration).
update food_entries set user_id = '<OWNER_UID>' where user_id is null;
update days         set user_id = '<OWNER_UID>' where user_id is null;
update profile      set user_id = '<OWNER_UID>' where user_id is null;
update assessments  set user_id = '<OWNER_UID>' where user_id is null;
update settings     set user_id = '<OWNER_UID>' where user_id is null;

-- 2) Defaults + not null: future inserts self-own via auth.uid().
alter table food_entries alter column user_id set default auth.uid(), alter column user_id set not null;
alter table days         alter column user_id set default auth.uid(), alter column user_id set not null;
alter table profile      alter column user_id set default auth.uid(), alter column user_id set not null;
alter table assessments  alter column user_id set default auth.uid(), alter column user_id set not null;
alter table settings     alter column user_id set default auth.uid(), alter column user_id set not null;

-- 3) Per-user keys. Client ids are Date.now() values generated per device, so
--    they must only be unique per user, not globally.
-- If a drop fails on a constraint name, find the real one with:
--   select conname from pg_constraint where conrelid = 'days'::regclass;
alter table food_entries drop constraint food_entries_pkey, add primary key (user_id, id);
alter table days         drop constraint days_pkey,         add primary key (user_id, id);
alter table settings     drop constraint settings_pkey,     add primary key (user_id, key);
-- profile: one row per user; keep legacy id column but key on user_id.
alter table profile      drop constraint profile_pkey,      add primary key (user_id);

-- 3b) days.date had a GLOBAL unique constraint (days_date_key) — found on the
--     live db 2026-07-27, missed by the original plan. Left as-is, two users
--     could never log the same calendar date. Make it per-user.
alter table days drop constraint days_date_key;
alter table days add constraint days_user_date_key unique (user_id, date);

-- 4) Per-user RLS replacing "Allow all". Policy names may differ; drop
--    whatever exists (check: select policyname from pg_policies where schemaname='public').
do $$
declare t text; p record;
begin
  foreach t in array array['food_entries','days','profile','assessments','settings'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format('create policy per_user_all on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
