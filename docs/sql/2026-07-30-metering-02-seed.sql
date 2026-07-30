-- Metering migration 2: hardening (from Task 1 review) + config seed + owner entitlement.

-- Hardening: TRUNCATE is not governed by RLS, only by grants — blanket-revoke
-- and re-grant SELECT only. Also close the default PUBLIC execute on the RPC.
revoke all on ai_usage from public, anon, authenticated;
grant select on ai_usage to authenticated;
revoke all on entitlements from public, anon, authenticated;
grant select on entitlements to authenticated;
revoke execute on function ai_usage_summary() from public, anon;
grant execute on function ai_usage_summary() to authenticated;

-- Hardened RPC: allowance sanity guard (a misconfigured plan must surface as
-- an error JSON, not a fake 100% bar), explicit UTC window cast, pg_temp last.
create or replace function ai_usage_summary()
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  plan_name text; cfg jsonb; allowance numeric; lifetime bool; used numeric;
begin
  if uid is null then return json_build_object('error', 'unauthenticated'); end if;
  select plan into plan_name from entitlements where user_id = uid;
  plan_name := coalesce(plan_name, 'free');
  if plan_name = 'owner' then
    return json_build_object('plan', 'owner', 'pct_used', 0, 'exhausted', false);
  end if;
  select value into cfg from ai_config where id = 1;
  allowance := (cfg->'plans'->plan_name->>'allowance_usd')::numeric;
  if allowance is null or allowance <= 0 then
    return json_build_object('error', 'misconfigured', 'plan', plan_name);
  end if;
  lifetime := coalesce((cfg->'plans'->plan_name->>'lifetime')::bool, false);
  if lifetime then
    select coalesce(sum(cost_usd), 0) into used from ai_usage where user_id = uid;
  else
    select coalesce(sum(cost_usd), 0) into used from ai_usage
      where user_id = uid
        and created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc');
  end if;
  return json_build_object(
    'plan', plan_name,
    'pct_used', least(100, floor(used / allowance * 100)::int),
    'exhausted', used >= allowance);
end $$;

-- Config seed: plan ladder + model prices.
-- Anthropic ids/prices from the claude-api skill (models table, cached 2026-06-24):
--   claude-haiku-4-5 $1/$5, claude-sonnet-5 $3/$15 (sticker; intro $2/$10 ends
--   2026-08-31 — seeding sticker so costs are never under-counted), claude-opus-5 $5/$25.
-- OpenAI ids/prices from developers.openai.com/api/docs/pricing (fetched 2026-07-30):
--   gpt-5.6-luna $1/$6, gpt-5.6-terra $2.50/$15, gpt-5.6-sol $5/$30 — the current
--   generation; all three take text+image input (vision), per the models docs.
--   (App's gpt-5-mini / gpt-5.2 are prior generations; luna/terra/sol are the
--   modern equivalents.)
insert into ai_config (id, value) values (1, '{
  "enabled": true,
  "rate_per_min": 10,
  "merge": { "widen_threshold": 0.4 },
  "plans": {
    "free": { "allowance_usd": 1.00, "lifetime": true,
      "models": { "estimate": ["claude-haiku-4-5", "gpt-5.6-luna"],
                  "photo":    ["claude-haiku-4-5", "gpt-5.6-luna"],
                  "assess":   ["claude-haiku-4-5", "gpt-5.6-luna"] } },
    "t3":  { "allowance_usd": 1.20,
      "models": { "estimate": ["claude-sonnet-5", "gpt-5.6-terra"],
                  "photo":    ["claude-sonnet-5", "gpt-5.6-terra"],
                  "assess":   ["claude-sonnet-5", "gpt-5.6-terra"] } },
    "t5":  { "allowance_usd": 2.25,
      "models": { "estimate": ["claude-sonnet-5", "gpt-5.6-terra"],
                  "photo":    ["claude-sonnet-5", "gpt-5.6-terra"],
                  "assess":   ["claude-opus-5", "gpt-5.6-sol"] } },
    "t10": { "allowance_usd": 5.00,
      "models": { "estimate": ["claude-opus-5", "gpt-5.6-sol"],
                  "photo":    ["claude-opus-5", "gpt-5.6-sol"],
                  "assess":   ["claude-opus-5", "gpt-5.6-sol"] } }
  },
  "prices": {
    "claude-haiku-4-5": { "in_per_mtok": 1.00, "out_per_mtok": 5.00 },
    "claude-sonnet-5":  { "in_per_mtok": 3.00, "out_per_mtok": 15.00 },
    "claude-opus-5":    { "in_per_mtok": 5.00, "out_per_mtok": 25.00 },
    "gpt-5.6-luna":     { "in_per_mtok": 1.00, "out_per_mtok": 6.00 },
    "gpt-5.6-terra":    { "in_per_mtok": 2.50, "out_per_mtok": 15.00 },
    "gpt-5.6-sol":      { "in_per_mtok": 5.00, "out_per_mtok": 30.00 }
  }
}'::jsonb)
on conflict (id) do update set value = excluded.value;

insert into entitlements (user_id, plan)
values ('092efd1b-aa72-4e09-b680-bc4b4d41d19f', 'owner')
on conflict (user_id) do update set plan = 'owner';
