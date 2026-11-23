-- food_nullable_macros_01: let a food entry exist before its numbers are known.
-- (APPLIED to production 2026-11-23.)
-- An entry has no calories/protein while its estimate is pending, after a failed
-- estimate, and when AI credit is exhausted. These legacy columns were NOT NULL
-- with no default, so such a row was rejected (23502) and, because the client
-- upserted the whole table in one statement, took every other change with it.
-- Additive: relaxes a constraint, changes no data. The columns are only read as
-- a fallback for rows without `macros`, and every row written since 2026-06 has
-- `macros`, so a null here is never shown to a user.
alter table public.food_entries
  alter column cal_low  drop not null,
  alter column cal_high drop not null,
  alter column pro_low  drop not null,
  alter column pro_high drop not null;
