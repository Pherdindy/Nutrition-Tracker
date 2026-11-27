# Lazy Macros (Nutrition Tracker)

Single-page web app in `www/` (`index.html`, `app.js`, `styles.css`, UMD helper
modules), wrapped as the Android app **"Lazy Macros"** (`com.lazymacros.app`)
with Capacitor 8 (`android/`, `webDir: www`). Backend is **Supabase**
(project `wcbpvvyhswaricoadqbb`): Supabase Auth (email OTP + Google OAuth),
per-user RLS on all app tables, localStorage as the offline cache
(per-user namespaced keys via `AuthView.nsKey`).

## Current status & next steps

**Read `docs/HANDOFF.md` first** — it carries the live project state across
machines/sessions (what's deployed, production DB facts, pending user actions).
Update it at the end of each working session.

## Commands

- `npm test` — Node `--test` unit suite over `tests/` (644 tests)
- `npx http-server www -p 8080 -c-1` — browser preview (mobile layout ≤720px)
- After editing anything in `www/`: `npx cap sync android`
- Debug install: `cd android; .\gradlew.bat installDebug` (see `BUILD.md` for
  release/signing; keystore + `android/key.properties` are git-ignored)

## Key facts

- Supabase client is `sb` (never `supabase` — avoids CDN global collision),
  PKCE flow; vendored at `www/vendor/supabase.min.js`
- Data reads are synchronous from in-memory `_cache`. Food and day writes go
  cache → localStorage + a persistent per-account outbox (`www/sync.js`) → Supabase,
  row by row; a save never implies a delete (use `removeFoodEntry`/
  `removeDayEntry`/`removeWorkout`), new ids come from `newId()`, AI results go through
  `saveEstimates`. Profile, settings and assessments still use `bgWrite()`
- An entry's numbers are decided in `www/nutrition.js` (pure) and reach a save only
  through `numbersFor()`. `entry.macros` is always the total eaten; a nutrient with
  `mine: true` was typed by the user and no AI answer may change it; the rest
  (explanation, assumed weight, source) is in `entry.nutrition`
- What a day burns comes only from `dayEnergy()` (`www/workouts.js`, pure): the rest of
  the day plus its workouts, never a list choice that already includes one. Typed calories
  and minutes are never changed by an AI answer
- "Today" is `localDate()`, never `toISOString().slice(0, 10)` (that is the UTC
  date, a different day for part of every day)
- Every AI call goes through `callAi(feature, payload)` to the `ai-proxy` Edge
  Function (`supabase/functions/`), which picks the models by plan and meters the cost
  in `ai_usage` (config: the `ai_config` row). No provider key is ever on the client;
  the old bring-your-own keys (`nt_key_*`) are deleted at startup. Deploying the proxy
  needs the user's yes each time (recipe in `docs/HANDOFF.md`)
- The six data keys (`CACHE_BASES`: `food`, `days`, `workouts`, `profile`,
  `assessments`, `version`) and the sync outbox are per-user namespaced. Settings
  (`theme`, `macros_enabled`, `value_format`) sync per user to `settings` but are
  cached under device-wide `nt_<key>`; `nt_tutorial_seen` is device-only
- Other apps share this Supabase project: `transactions`, `stock_trades` and the
  `ft_categories` row of `settings` belong to the finance app (`finance/`),
  `workout_records` to the separate Workout Tracker app
- Supabase email OTP codes are 8 digits for this project (client accepts 6–10);
  both the "Confirm signup" AND "Magic Link" templates must contain
  `{{ .Token }}` — first-time addresses get the *Confirm signup* template
- `.mcp.json` (repo root) configures the Supabase MCP server — run `/mcp` and
  authenticate to get `execute_sql`/`apply_migration` against production
