# Project Handoff — state as of 2026-11-23

Cross-machine session state. **Agent: read this before doing anything; update
it at the end of each working session.**

## Food/day sync data-loss bugs — FIXED 2026-11-23 (on `main`)

**Any tab, phone or emulator still running an older build keeps deleting rows it
does not know about: reload every open tab, pull on the laptop, reinstall every
device.** (Pixel_7 emulator: sync fix installed 2026-11-23, date fix below not yet;
`android/` assets are git-ignored, so run `npx cap sync android` after pulling.)

1. **Rejected saves.** `food_entries.cal_low/cal_high/pro_low/pro_high` were NOT
   NULL, so an entry without numbers (estimate pending/failed, credit exhausted)
   was refused and took the whole-table save with it: 15 rejections in 24 h.
   Migration `food_nullable_macros_01` APPLIED
   (`docs/sql/2026-11-23-food-nullable-macros-01.sql`); the identical insert fails
   before and succeeds after (rolled-back transactions as the test2 account).
2. **The local list was taken to be the whole table.** Every save upserted all
   rows and deleted every server row not in the list, with `max + 1` ids and an
   unpaginated load. Two devices destroyed each other's entries; an app that
   started while the server was unreachable wiped the account on its first save
   (reproduced in the harness); anything logged offline was dropped at the next
   online start; past 1,000 rows the oldest would have been deleted.

**How sync works now** — `www/sync.js` (pure logic, `window.Sync`) plus the
"Food + day sync" block in `www/app.js`:
- A save puts only the rows that changed into an outbox: one localStorage entry
  per change, per account (`nt_u<uid8>_outbox:<table>:<key>`). A flush sends them
  and clears each only if that row has not changed again since (token). Failures
  retry on a timer, when the connection or app comes back, and at the next start.
  At load the outbox is laid over the cloud rows.
- Only `removeFoodEntry`/`removeDayEntry` delete. Absence never means deletion.
- Ids come from `newId()` (seconds since 2026 × 2^23 + 23 random bits), not
  `max + 1`. Days are keyed by date (`on_conflict=user_id,date`); an auto-created
  day is sent add-if-absent.
- **AI results are conditional updates** (`saveEstimates` → `outbox.update`): they
  fill in a row only while it is still pending with the same food/qty/unit, so
  they cannot resurrect a deleted entry or undo an edit made on another device.
  A start resumes only estimates this device itself left unfinished
  (`markResumable`). An answer for a food renamed meanwhile is discarded.
- Loads and sends are pinned to the account's token (`sessionFor`/`asAccount`):
  without a session supabase-js silently uses the public key, and the server then
  answers "no rows" to a read and "done" to a delete of nothing.
- A row the server refuses (4xx) does not hold back the others.
  `Sync.fetchAll` pages until the exact count.
- Sign-out sends first, asks before discarding unsent changes, and wipes only if
  Supabase really signed out (it keeps the session when offline). Another account
  signing in from another tab reloads the app.

**Verified:** `tests/sync.test.js` + `tests/food-sync.test.js` run the real
`www/app.js` in a Node vm against a fake server that enforces production's keys,
NOT NULLs, read cap and sessions (`tests/helpers/app-harness.js`); 45 of the
66 app tests fail on the old code (a few only for lack of the new API); every
protection was mutation-checked.
Headless Chrome with the real supabase-js against a stand-in PostgREST (11
scenarios, incl. two tabs and Web Locks). A random multi-device fuzzer (not in the
repo): the old code lost data in every session; the final code lost nothing in
22,113 sessions with guaranteed-unique ids. With real ids it lost one entry in
~7,700 sessions, not reproducible and put down to an id collision: the fuzzer packs
hours of use into one second, while real use needs two devices adding in the same
second and a 1-in-8-million draw. The
by-date upsert SQL ran against production under RLS (rolled back). On the
emulator with the owner's session: 5 no-op changes queued in airplane mode, app
killed, relaunched offline, delivered when back online, all rows byte-identical
before and after; the update filters matched exactly one row for all 99 distinct
food names. **Not yet seen:** a real new entry from the owner (expect POST 201
then PATCH 204 in the edge log, and no 400).

**Known limits:** two devices editing the *same row* is last-write-wins; profile,
settings and assessments are still fire-and-forget (an offline change to those is
lost at the next online start, and the sign-out prompt does not count them); a
permanently refused row is only logged in the console; on Android a change is on
disk within ~2 s, or at once when the app goes to the background, so a hard kill
inside that window loses it (WebView localStorage; measured); two open tabs do not
refresh each other's lists; an entry deleted on one device while another has not yet
confirmed creating it can reappear (seen once by the fuzzer; needs tombstones).

**Noticed, not fixed:** (a) picking a previous food after a reload autofills
qty/unit from the *oldest* match, not the latest (verified: "Eggs" gives 111 g from
February) — the nutrition-details spec fixes it; (b) if the startup load fails on a
device with no local profile, onboarding is shown to an existing user and would
overwrite their cloud profile; (c) the profile form accepts cleared fields; (d) the
finance app's new-transaction date has the UTC bug described next
(`finance/app.js`, `txnDateInput.value`).

## Date bug — FIXED 2026-11-23 (on `main`)

"Today" was the UTC date everywhere: in UTC+8 anything logged between midnight and
8 AM was filed under the previous day; in the Americas, evening meals went to
tomorrow; assessment periods were off by a day at the same hours. Now
`localDate()` in `www/app.js`. `tests/local-date.test.js` runs the real app at a
fixed instant in Manila and New York. The one entry misfiled so far (id 174, the
01:04 shake of Nov 23, under Nov 22) was left as it is.

## In design: macro override, label photo, macro set, AI explanation

User request 2026-11-23; **user chose option C** (a correction is remembered for
the food, and AI estimates are remembered too), with a visible "from <date>" tag
and an "Ask AI again" button as requirements. **Design approved 2026-11-23**; spec
on branch `feat/nutrition-details`:
`docs/superpowers/specs/2026-11-23-nutrition-details-design.md` (awaiting the
user's review; then the plan). Label photo is a later spec of its own.

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

**Incomplete-log day tag — DONE + emulator-verified 2026-11-17** on branch
`feat/incomplete-days` (cut from `feat/metering`; **merge after metering**).
Spec `docs/superpowers/specs/2026-11-17-incomplete-days-design.md`, plan
`docs/superpowers/plans/2026-11-17-incomplete-days.md`. Edit Day modal checkbox
→ `days.incomplete`; "Incomplete" pill on tracker row / day card; tagged days
excluded from averages + AI assessments via `Targets.excludeIncompleteDays` in
`buildRangeData()` (no ai-proxy change); assessment meta + history show the
excluded count. Migration `incomplete_days_01` APPLIED (column
`incomplete boolean not null default false`). Verified live: tag via real
modal → server row `incomplete=true`; survives force-stop/relaunch; all-tagged
week → new early-return message; year range 12→11 days with "1 incomplete day
excluded" pill. Test tag removed afterwards (server: 0 tagged / 11 days).
Known limitation: stale-cache second device re-sends
`incomplete=false` on its next full upsert (same last-write-wins as weight).

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
3. **Finance app sign-in — BUILT 2026-07-29, awaiting the user's recovery
   run.** The finance app is `finance/` in this repo (tracked). Discovered
   during diagnosis: (a) its adds since the lock only exist in the browser's
   localStorage (server still had 402 rows, last insert 2026-07-26); (b) the
   `stock_trades` table it syncs to NEVER existed — Stock Journal data is
   localStorage-only since forever (table now created, migration
   `create_stock_trades_owner_only`, owner-scoped like transactions); (c) its
   init overwrites localStorage with server-preferred data, so the resync
   snapshots localStorage BEFORE init. What was added: `finance/sync.js`
   (UMD `FinanceSync.planResync`, 7 tests in `tests/finance-sync.test.js`,
   suite now 77), auth gate in `finance/index.html`/`styles.css`, gate wiring
   + `resyncOfflineData` in `finance/app.js` (server-only rows are reported in
   console, never deleted; `window.financeSignOut()` helper).
   ✅ **RECOVERY RUN DONE 2026-07-29:** user signed in in their usual browser;
   resync pushed all 6 offline entries (server 402 → 408, verified row-by-row
   against the user's screenshot). stock_trades synced 0 — Stock Journal was
   locally empty; table ready for future use. The finance app is fully
   operational again, authenticated as the owner.
4. ✅ **DONE 2026-07-29 — Emulator back to signed-in-as-owner** (via the
   Resend-delivered code; 126 entries re-downloaded through per-user RLS).
5. **Finance app 2026-07-30 — Stock Journal REMOVED, Monthly Breakdown +
   CSV export ADDED** (committed on `feat/metering` AND cherry-picked to
   `main` as `2a0a2ec`, both pushed — main got only the finance work, the
   metering changes stay on the branch pending verification). The
   Stock Journal tab/modal and all `stock_trades` client code are gone from
   `finance/` (the owner-scoped `stock_trades` table + any `ft_stock_trades`
   localStorage were left untouched — data preserved, just no UI). New
   "Monthly Breakdown" tab: year/type/category filters → per-month cards
   listing EVERY transaction grouped by category with subtotals; "Export CSV"
   there exports the filtered set, and a second "Export CSV" on the
   Transactions tab exports ALL transactions (columns
   Date,Type,Category,Subcategory,Description,Amount,Notes; UTF-8 BOM for
   Excel). `fmtPct` + trade-only CSS removed; the stock-flavored
   `finance-sync` test retitled (suite still 120). Verified via Node DOM-stub
   smoke (render, filters, totals, CSV escaping) — not yet clicked through in
   a live browser.

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
