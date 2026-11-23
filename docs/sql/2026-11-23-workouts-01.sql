-- workouts_01: one row per workout (docs/superpowers/specs/2026-11-23-workouts-design.md).
-- Additive: builds before it do not know the table. Must be applied BEFORE a build with
-- www/workouts.js is used, because that build reads the table at every start.
create table if not exists public.workouts (
  id bigint not null,
  user_id uuid not null default auth.uid() references auth.users (id),
  date date not null,
  what text not null,
  minutes numeric not null default 0,
  kcal numeric,
  effort jsonb not null default '{}'::jsonb,
  estimate_status text,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.workouts enable row level security;
create policy per_user_all on public.workouts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.workouts from anon;
grant select, insert, update, delete on public.workouts to authenticated;
