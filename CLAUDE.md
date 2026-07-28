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

- `npm test` — Node `--test` unit suite over `tests/` (70 tests)
- `npx http-server www -p 8080 -c-1` — browser preview (mobile layout ≤720px)
- After editing anything in `www/`: `npx cap sync android`
- Debug install: `cd android; .\gradlew.bat installDebug` (see `BUILD.md` for
  release/signing; keystore + `android/key.properties` are git-ignored)

## Key facts

- Supabase client is `sb` (never `supabase` — avoids CDN global collision),
  PKCE flow; vendored at `www/vendor/supabase.min.js`
- Data reads are synchronous from in-memory `_cache`; writes go cache →
  localStorage → fire-and-forget `bgWrite()` to Supabase
- AI provider API keys (`nt_key_openai`, `nt_key_anthropic`) live in
  localStorage ONLY — never sent to Supabase (server-side proxy is Phase B)
- Theme + API keys are device-global; the five data keys (`food`, `days`,
  `profile`, `assessments`, `version`) are per-user namespaced
- Supabase email OTP codes are 8 digits for this project (client accepts 6–10);
  both the "Confirm signup" AND "Magic Link" templates must contain
  `{{ .Token }}` — first-time addresses get the *Confirm signup* template
- `.mcp.json` (repo root) configures the Supabase MCP server — run `/mcp` and
  authenticate to get `execute_sql`/`apply_migration` against production
