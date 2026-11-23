# Lazy Macros (Nutrition Tracker)

Single-page web app in `www/` (`index.html`, `app.js`, `styles.css`, UMD helper
modules), wrapped as the Android app **"Lazy Macros"** (`com.lazymacros.app`)
with Capacitor 8 (`android/`, `webDir: www`). Backend is **Supabase**
(project `wcbpvvyhswaricoadqbb`): Supabase Auth (email OTP + Google planned),
per-user RLS on all app tables, localStorage as the offline cache
(per-user namespaced keys via `AuthView.nsKey`).

## Current status & next steps

**Read `docs/HANDOFF.md` first** — it carries the live project state across
machines/sessions (what's deployed, production DB facts, pending user actions).
Update it at the end of each working session.

## Commands

- `npm test` — Node `--test` unit suite over `tests/` (500 tests)
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
  `removeDayEntry`), new ids come from `newId()`, AI results go through
  `saveEstimates`. Profile, settings and assessments still use `bgWrite()`
- An entry's numbers are decided in `www/nutrition.js` (pure) and reach a save only
  through `numbersFor()`. `entry.macros` is always the total eaten; a nutrient with
  `mine: true` was typed by the user and no AI answer may change it; the rest
  (explanation, assumed weight, source) is in `entry.nutrition`
- "Today" is `localDate()`, never `toISOString().slice(0, 10)` (that is the UTC
  date, a different day for part of every day)
- AI provider API keys (`nt_key_openai`, `nt_key_anthropic`) live in
  localStorage ONLY — never sent to Supabase (server-side proxy is Phase B)
- Theme + API keys are device-global; the five data keys (`food`, `days`,
  `profile`, `assessments`, `version`) are per-user namespaced
- Supabase email OTP codes are 8 digits for this project (client accepts 6–10);
  both the "Confirm signup" AND "Magic Link" templates must contain
  `{{ .Token }}` — first-time addresses get the *Confirm signup* template
- `.mcp.json` (repo root) configures the Supabase MCP server — run `/mcp` and
  authenticate to get `execute_sql`/`apply_migration` against production
