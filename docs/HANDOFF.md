# Project Handoff — state as of 2026-07-29

Cross-machine session state. **Agent: read this before doing anything; update
it at the end of each working session.**

## Where things stand

**Accounts + per-user data (Spec A) is COMPLETE and live-verified** (emulator,
two real accounts, 2026-07-27). `feat/accounts` merged to `main` 2026-07-28.
Spec: `docs/superpowers/specs/2026-07-07-accounts-per-user-data-design.md`
(also holds the SaaS umbrella: A accounts → B proxy+metering → C Play Billing).

Verified end-to-end on the emulator: sign-in gate → email OTP through the real
UI → owner data loads (126 entries); kill/relaunch keeps the session;
airplane-mode relaunch serves the namespaced offline cache; sign-out
double-wipes (theme/API keys kept); fresh `+test2` account → onboarding →
empty app, sees 0 owner rows (client RLS probe + server ledger both checked).

## Supabase production state (project `wcbpvvyhswaricoadqbb`)

- Owner: `robertmessi123456@gmail.com` = UID
  `092efd1b-aa72-4e09-b680-bc4b4d41d19f` — owns 126 food_entries / 11 days /
  1 profile. Test account `robertmessi123456+test2@gmail.com` (UID `f9da59c4…`,
  1 day + 1 profile) may be deleted once no longer useful.
- Migrations applied (tracked in Supabase migration history):
  - `accounts_01_add_user_id` — nullable `user_id uuid` on the 5 app tables
  - `accounts_02_finalize` — backfill to owner, `default auth.uid()` +
    not-null, PKs `(user_id, id)` / settings `(user_id, key)` / profile
    `(user_id)`, **`days` date-unique is per-user `(user_id, date)`** (was a
    global unique — plan gap found live), `per_user_all` RLS on all 5 tables
  - `lock_transactions_table` then `reopen_transactions_owner_only` — see below
- Security advisors: clean (only the intentional notes).
- Email auth: Supabase issues **8-digit** OTP codes here; BOTH templates
  ("Confirm signup" — used for first-time addresses — AND "Magic Link")
  contain `{{ .Token }}`. Do not revert either.
- ~~LAUNCH BLOCKER: built-in mailer rate limit~~ **RESOLVED 2026-07-29:**
  custom SMTP via Resend is live (verified domain, delivery tested); email
  rate limit raised in Authentication → Rate Limits.

## `transactions` table (NOT part of this app)

402 rows of the user's **separate personal finance app** sharing this Supabase
project (staying until nutrition launch revenue). It is now **owner-scoped**:
`owner_only` policy (`auth.uid() = 092efd1b…`), grants to `authenticated`
only, nothing for `anon`. The finance app is cut off until it signs in as the
owner — user agreed; wiring sign-in into it is a pending task (user will point
the agent at its code).

## Immediate next steps (user chose "do all of these")

1. ✅ **DONE 2026-07-29 — Custom SMTP via Resend.** Domain verified in
   Resend, API key wired into Supabase SMTP settings, OTP tested end-to-end
   (code delivered via Resend, owner signed in on the emulator with it). The
   per-project mailer rate-limit launch blocker is RESOLVED. If auth emails
   ever misbehave: Resend dashboard → Emails shows delivery logs.
2. ✅ **DONE 2026-07-29 — Google OAuth live + emulator-verified end-to-end**
   (button → Custom Tab → account select → consent → deep-link return →
   signed in as the SAME owner UID; `app_metadata.providers` now
   `["email","google"]` — email-linking confirmed). Google Cloud project
   "Lazy Macros" holds the Web client; redirect URLs configured in Supabase.
   ⚠️ LAUNCH CHECKLIST: the OAuth consent screen is in **Testing** status —
   only listed test users can use Google sign-in until it's published to
   **Production** (Google Auth Platform → Audience → Publish). Do this before
   real users; basic scopes need no Google verification review.
3. **Finance app sign-in** — reuse the OTP pattern from `www/app.js`
   (`signInWithOtp`/`verifyOtp`); user will provide the code location.
4. ✅ **DONE 2026-07-29 — Emulator back to signed-in-as-owner** (via the
   Resend-delivered code; 126 entries re-downloaded through per-user RLS).

Known minor (accepted): offline onboarding has no retry; `AuthView.route()`
is exported but unused (documentation value only). The dev machine still has
legacy pre-accounts `nt_food`/`nt_days`/… localStorage keys — harmless
residue, fresh installs won't have them.

## After that (approved roadmap)

Metering/plans spec next, then charts. Pricing decided: $1 lifetime free cap;
$3/$5/$10 tiers. Then Phase B (server-side AI proxy Edge Function so API keys
never ship in the app) and Phase C (Play Billing, privacy policy, account
deletion, store listing).

## Dev environment notes (machine-specific bits may differ on the laptop)

- **Supabase MCP:** `.mcp.json` is committed at repo root. Run `/mcp` →
  supabase → Authenticate (browser OAuth) to enable `execute_sql` /
  `apply_migration` / `get_advisors` against production.
- **Emulator recipes (verified on the desktop):** cold-boot with
  `emulator.exe -avd Pixel_7 -no-snapshot-load` (quickboot snapshot corruption
  history); drive the live WebView via CDP: `adb forward tcp:9222
  localabstract:webview_devtools_remote_<PID>` then `Runtime.evaluate` over
  WebSocket (see `adb shell cat /proc/net/unix | grep webview_devtools`);
  screenshots from Git Bash via `adb exec-out screencap -p > file.png`.
- **Gotchas:** `navigator.onLine` reports true in the WebView even in airplane
  mode (check `settings get global airplane_mode_on`); 3× "Error injecting
  safe area CSS" logcat lines at startup are a benign upstream Capacitor race;
  a dev reinstall (`installDebug`) can lose the last localStorage writes of
  the killed process — sign-in state may not survive reinstalls (normal
  force-stop/relaunch is safe, verified).
- Windows env for Android builds: `ANDROID_HOME`/`ANDROID_SDK_ROOT` =
  `%LOCALAPPDATA%\Android\Sdk`, `JAVA_HOME` = Android Studio's `jbr`.
