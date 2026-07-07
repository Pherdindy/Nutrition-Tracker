# Accounts & Per-User Data (Spec A of 3) — Design

**Date:** 2026-07-07
**Status:** Approved
**Series:** Spec A of the SaaS-launch sequence: **A — Accounts** (this doc) → **B — AI proxy + metering** → **C — Google Play Billing**.

## Umbrella architecture (context for all three specs)

Lazy Macros is becoming a paid SaaS. Decisions locked 2026-07-07:

- **A — Accounts (this spec):** Supabase Auth (Google + email OTP), `user_id` on every table, per-user RLS, existing single-user data migrated to the owner's account. App behavior otherwise unchanged; BYOK API keys keep working during this phase.
- **B — AI proxy + metering:** a Supabase Edge Function holds the provider API keys and makes every AI call (text estimate, vision, assessment). BYOK removed from the client. The **server** picks providers/models (cheapest adequate model; dual-AI reconcile becomes a server-controlled paid feature). Per-user usage log stores real provider cost (from the providers' usage objects) as ground truth. Quota check before each call, reconcile after. **Free tier: $1.00 of provider cost, lifetime**, then a paywall prompt. **Paid tiers: $3/$5/$10 per month** → monthly allowances of roughly $1.20/$2.25/$5.00 provider cost (tunable in a config row, ~60% margin). Per-minute rate limit per user; hard budget alerts in the OpenAI/Anthropic dashboards as the fuse. UI shows a **credit bar** ("AI usage: 63% used"), not raw dollars or action counts.
- **C — Billing:** Google Play Billing subscriptions → an entitlements table that spec B's quota check reads. Until C ships, the paywall reads "paid plans coming soon."

Build order is forced: metering needs identity (A), paid upgrades need billing (C reads B's entitlements).

## Spec A problem

The app is single-user: Supabase RLS is "Allow all", there is no sign-in, and all rows are global. Metering, billing, and any second user are impossible.

## Requirements

1. **Sign-in required at launch.** A sign-in screen gates the app whenever no Supabase session exists. Sessions persist and auto-refresh, so sign-in is effectively one-time per device. Sign-out control in the Targets/Settings area.
2. **Two auth methods, no passwords:**
   - **Google OAuth** — opens an in-app browser and returns via the `com.lazymacros.app://auth-callback` deep link (Capacitor App plugin handles the intent; AndroidManifest gains the intent filter).
   - **Email OTP** — user enters email, receives a 6-digit code, enters it (codes beat magic links on mobile).
3. **Per-user schema.** All five tables (`food_entries`, `days`, `profile`, `assessments`, `settings`) gain `user_id uuid not null default auth.uid() references auth.users(id)`. `settings` PK becomes `(user_id, key)`. `profile` becomes one row per user. Because of the column default, existing insert/upsert client code needs minimal change.
4. **RLS.** Replace every "Allow all" policy with `auth.uid() = user_id` for SELECT/INSERT/UPDATE/DELETE on all five tables.
5. **Owner data migration.** One-time SQL (run manually in the Supabase SQL editor, like previous schema migrations) backfills `user_id` on all existing rows to the owner's auth user id after his first sign-in.
6. **New-user onboarding, no seed data.** Remove `SEED_FOOD`/`SEED_DAYS` seeding. When `profile` has no row for the signed-in user, run a first-run profile setup (reusing the existing Targets form fields: height, age, weight, activity, weight-loss goal, protein target) before showing the main UI.
7. **Offline behavior.** localStorage fallback cache is **namespaced by user id** and cleared on sign-out/account switch (no cross-account bleed on a shared device). Offline with a cached session → app runs from cache as today. Offline with no session → sign-in screen with a retry affordance.
8. **Out of scope for A:** removing BYOK keys (spec B), any metering/limits (B), billing (C), web deployment.

## Architecture

- **Auth client:** the vendored `supabase-js` v2 already includes Auth; no new client library. `sb.auth.getSession()` gates startup; `onAuthStateChange` drives sign-in/out transitions.
- **Sign-in screen:** a new full-screen view in `www/index.html` + `www/auth-view.js` (UMD module `window.AuthView` for the pure parts: state routing, OTP input validation, error mapping — unit-tested). Google button + email/OTP form.
- **Startup flow:** `session? → initFromSupabase() → profile row exists? → main UI : onboarding` ; `no session → sign-in screen`.
- **Data layer:** `bgWrite()`/mappers unchanged except: rely on the `user_id` column default for inserts; `settings` upserts use the composite key; localStorage keys become `nt_<uid8>_<key>` via a small pure namespacing helper (unit-tested). API-key settings (`nt_key_openai`/`nt_key_anthropic`) stay device-local and un-namespaced (they die in spec B anyway).
- **Manual setup steps (documented in the plan):** create Google Cloud OAuth clients (web + Android with SHA-1), enable Google provider + email OTP in Supabase dashboard, add the deep-link intent filter, run the schema/RLS SQL, run the backfill SQL after first owner sign-in.

## Error handling

- OAuth cancelled/failed → stay on sign-in screen with a friendly message; OTP wrong/expired → inline error, allow resend.
- Supabase unreachable at launch with cached session → offline mode from namespaced cache (existing fallback path).
- RLS-denied writes (should not happen post-migration) → surface via the existing `[Supabase bgWrite]` console path, data persists locally.

## Testing

- Unit tests (house style, `node --test`): `AuthView` pure logic (state routing given session/profile/offline combinations, OTP validation, error mapping) and the cache-namespacing helper.
- Emulator verification with two accounts: owner signs in → sees all migrated historical data; fresh test account → sees onboarding, empty tracker, and (checked via a direct query) cannot read the owner's rows. Sign-out clears the namespaced cache; relaunch offline with a session works from cache.

## Risks / notes

- Google OAuth on Android requires correct SHA-1 fingerprints for BOTH debug and release (Play App Signing) keystores — a classic silent-failure point; the plan includes verifying each.
- The `days`/`profile` legacy denormalized columns (age/deficit/protein written for back-compat) are unaffected; they ride along with `user_id` like every other column.
- Existing installs (the owner's device) will have a stale un-namespaced localStorage cache; first signed-in launch migrates/ignores it in favor of Supabase, then writes namespaced keys.
