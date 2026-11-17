-- incomplete_days_01: per-day "incomplete log" tag. (APPLIED to production 2026-11-17.)
-- Tagged days are excluded client-side from averages + AI assessments.
-- Covered by the existing per_user_all RLS policy on public.days (no policy change).
-- Old clients omit the column on upsert; PostgREST only updates supplied columns,
-- so they never clobber the flag. New rows from old clients get the default.
-- Known limitation: a NEW client with a stale cache (e.g. a second device loaded
-- before the tag was set) re-sends incomplete=false on its next full-table upsert —
-- same last-write-wins behavior weight/activity already have.
alter table public.days add column if not exists incomplete boolean not null default false;
