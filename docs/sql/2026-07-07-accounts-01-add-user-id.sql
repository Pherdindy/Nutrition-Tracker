-- Accounts migration 1/2: add nullable user_id columns.
-- Safe to run while the current (pre-auth) app is live: RLS stays "Allow all",
-- columns are nullable, nothing else changes. Run in the Supabase SQL editor.

alter table food_entries add column if not exists user_id uuid references auth.users(id);
alter table days         add column if not exists user_id uuid references auth.users(id);
alter table profile      add column if not exists user_id uuid references auth.users(id);
alter table assessments  add column if not exists user_id uuid references auth.users(id);
alter table settings     add column if not exists user_id uuid references auth.users(id);
