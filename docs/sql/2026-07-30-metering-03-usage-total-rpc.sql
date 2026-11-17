-- Metering migration 3: server-side usage sum (the JS-side row fetch silently
-- truncated at PostgREST max-rows, breaking the lifetime cap after ~1000 rows).
create or replace function ai_usage_total(p_user uuid, p_since timestamptz default null)
returns numeric language sql security definer set search_path = public, pg_temp as $$
  select coalesce(sum(cost_usd), 0) from ai_usage
   where user_id = p_user and (p_since is null or created_at >= p_since);
$$;
revoke execute on function ai_usage_total(uuid, timestamptz) from public, anon, authenticated;
