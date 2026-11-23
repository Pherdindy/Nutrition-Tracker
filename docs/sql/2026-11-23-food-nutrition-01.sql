-- food_nutrition_01: what an entry's numbers are based on (see
-- docs/superpowers/specs/2026-11-23-nutrition-details-design.md, "Data model").
-- Nullable and without a default: existing rows and older builds are unaffected.
-- Must be applied BEFORE a build with www/nutrition.js is used: PostgREST refuses a
-- save that names a column it does not know.
alter table public.food_entries add column if not exists nutrition jsonb;
