# Project Handoff — state as of 2026-11-27

Cross-machine session state. **Agent: read this before doing anything; update
it at the end of each working session.** Claude's own memory stays on the machine
that wrote it: anything the other machine needs goes in this file.

## Open items (checked 2026-11-27)

Everything was pushed (`main` = `origin/main`) and 644 tests passed; production was
checked read-only the same day (see "Supabase production state").

- **Every machine and device, before use:** pull, `npm install`, `npx cap sync android`,
  reload open tabs, reinstall on the phone/emulator. Older builds drop typed numbers and
  ignore workouts; an older finance app rewrites, on the server, the transactions of a
  category it doesn't know (e.g. Travel) to "Uncategorized".
- **A browser or device with no local copy yet:** if the first load fails, the app shows
  onboarding to the existing account. Don't fill it in, reload: submitting it overwrites
  the cloud profile (noticed, not fixed).
- **Metering checks never done live** (plan Tasks 8 and 9, open since the 2026-11-17
  merge): running out of credit for real, and the emulator kill/relaunch + airplane-mode
  pass. See "AI proxy + metering + plans".
- **Not seen yet:** a workout logged by the owner (`workouts` had 0 rows on 2026-11-27).
- **Next spec:** nutrition-label photo (with upload/paste too: the owner logs from desktop
  Chrome, where camera capture is unavailable). Then charts, then Phase C (see "After
  that").
- **Before launch:** Google OAuth consent screen Testing → Production; hard budget alerts
  at OpenAI and Anthropic; Phase C.

## Food/day sync data-loss bugs — FIXED 2026-11-23 (on `main`)

**Any tab, phone or emulator still running an older build keeps deleting rows it
does not know about: reload every open tab, pull on the laptop, reinstall every
device.** (Pixel_7 emulator: the workouts build installed 2026-11-24;
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
food names. **Seen 2026-11-24:** the owner's first real entries after the fix (POST 201
or 200, PATCH 204, no 4xx; see "Nutrition details").

**Known limits:** two devices editing the *same row* is last-write-wins; profile,
settings and assessments are still fire-and-forget (an offline change to those is
lost at the next online start, and the sign-out prompt does not count them); a
permanently refused row is only logged in the console; on Android a change is on
disk within ~2 s, or at once when the app goes to the background, so a hard kill
inside that window loses it (WebView localStorage; measured); two open tabs do not
refresh each other's lists (food entries: they do since nutrition details); an
entry deleted on one device while another has not yet
confirmed creating it can reappear (seen once by the fuzzer; needs tombstones).

**Noticed, not fixed:** (a) if the startup load fails on a
device with no local profile, onboarding is shown to an existing user and would
overwrite their cloud profile; (b) the profile form accepts cleared fields. (Autofill
from the oldest match was fixed with nutrition details.)

## Date bug — FIXED 2026-11-23 (on `main`)

"Today" was the UTC date everywhere: in UTC+8 anything logged between midnight and
8 AM was filed under the previous day; in the Americas, evening meals went to
tomorrow; assessment periods were off by a day at the same hours. Now
`localDate()` in `www/app.js`. `tests/local-date.test.js` runs the real app at a
fixed instant in Manila and New York. The one entry misfiled so far (id 174, the
01:04 shake of Nov 23, under Nov 22) was left as it is. The finance app's Add dialog
had the same bug (early on the 1st, a new transaction landed in last month); it now
uses its own `currentDateValue()`.

## Nutrition details — LIVE since 2026-11-23

User request 2026-11-23: correct the AI's numbers, photograph a label, which
nutrients, how the numbers were worked out. **User chose option C** (corrections and
AI estimates are both remembered), with a visible "from <date>" tag and an "Ask AI
again" button as requirements. Design approved; the user waived review of the spec
and the plan ("proceed to implementation, I won't look through it anymore").
Spec `docs/superpowers/specs/2026-11-23-nutrition-details-design.md` (describes the
final behaviour), plan `docs/superpowers/plans/2026-11-23-nutrition-details.md` (the
first version of the code; see its "After the plan"). Label photo is a later spec.

**Deployed 2026-11-23 on the user's "Yes to all"**, in this order:
1. Migration `food_nutrition_01` (`docs/sql/2026-11-23-food-nutrition-01.sql`): one
   nullable column, `food_entries.nutrition jsonb`. All 176 rows identical before and
   after; RLS, policies and grants unchanged.
2. `feat/nutrition-details` merged into `main` (fast-forward) and pushed; Pixel_7
   emulator reinstalled. With the owner's session: for all 176 entries what the app would
   save equals the row on the server; one entry saved as it is (POST 200, conditional
   PATCH 204 with count 1) left every row identical.
3. `ai-proxy` **v13** (v12, then references cut at a word instead of in one; deployed
   with the Supabase CLI, `--use-api`; equal to the repo). Four estimates on the owner's
   plan, $0.116 in all: both models answer with a reference, a weight and eight nutrients;
   `known` totals are kept exactly, a known weight is used.

**Still to do (user):** reload every open tab, pull on the laptop, reinstall on the phone
BEFORE typing numbers: an older build that changes an amount drops them.
**Seen 2026-11-24:** the owner's first real entries (3 new, 2 asked again): POST 201 or 200,
PATCH 204, no 4xx, eight nutrients, whole references, and no row from:
`select id from food_entries where nutrition ? 'of' and (nutrition->'of'->>'food' is
distinct from food or (nutrition->'of'->>'qty')::numeric is distinct from qty::numeric or
nutrition->'of'->>'unit' is distinct from unit);`
**Rollback:** `supabase functions deploy ai-proxy` from `829279f` (= v11 but for line
ends); revert the merge; leave the column (older builds do not touch it).

**What it does:** Edit (and Add, behind "Enter numbers yourself") has a Nutrition
section: one field per nutrient, "These numbers are for 56 g" for labels, "Ask AI
again", "How was this worked out?" with the assumed weight and a correction for it.
Typed numbers are marked yours and no AI answer ever changes them. The same food in a
convertible amount reuses its latest numbers without an AI call and says "from Nov 20".
Changing an amount scales instead of asking again. All eight nutrients are saved; fiber
is on by default (the owner has a saved choice and is not affected). Assessments send
only what their prompt reads (about 1,440 entries fit instead of 926).

**How it works:** `www/nutrition.js` (pure, `window.Nutrition`) decides everything about
an entry's numbers; `numbersFor` in `www/app.js` is the only way a save gets numbers;
`entry.macros` is always the total eaten; per nutrient `{ low, high, mine?, basis? }`;
everything else about the numbers is in `entry.nutrition` (in the column with `of`: the
food and amount it is about; ignored if the row is no longer that, which an older build
can cause). An AI answer, and a retry, is applied only while the entry is as it was when
asked (food, amount, unit, **macros**, status), here and in the conditional update
(`macros=eq.<json>`).

**Sync changed with it** (`www/sync.js`, `takeOver`/`follow` in `app.js`): conditional
updates ask for the row count; one that changed nothing makes this device take over the
server's row (or that it is gone) instead of keeping a refused answer that its next edit
would put over another device's typed numbers. Two conditional changes to a row are sent
in order (`op.then`). A tab follows what another tab of the browser stores, and looks up
what it sent if it has something else itself.

**Verified before that:** 500 unit and app tests; about 390 mutations of the final code, all noticed by
a test but two that change nothing; an independent reviewer in three rounds (each finding
reproduced, then fixed with a test or listed below; the last ones two-tab corner cases);
random sessions with late, lost, partial and failing answers (not in the repo), on the
final code without a failure: 3,142 nutrition and 2,883 sync sessions on several devices,
1,100 with lost answers, 900 with two tabs and a second device, 60,000 of the form alone;
22 scenarios in headless Chrome with the real supabase-js, mouse, keyboard and two real
tabs, plus the 13 sync ones; layout at 320–1280 px, 125% and 150% scaling, larger text,
both themes; the live build against the new column and the new proxy's answer; the whole
proxy handler run locally against the live version (20 scenarios: only the intended parts
differ). On the real server (read-only or no-op, all
rows' fingerprint unchanged): `macros=eq.<json>` matches exactly, an update reports count
0 or 1, a missing row reads as null. On the emulator with the owner's 176 entries, look
only: saving unchanged changes nothing, doubling doubles every number, and 73 of the past
logs (41%) would have been reused had they been complete.

**Known limits:** two devices changing the same entry is last-write-wins, as before (a
device or tab left open for long shows old rows until it is reloaded); a device still on
an older build that changes an amount asks the AI and drops typed numbers, and its
answers do not know about them; nothing saved before this feature is reused until it was
asked about once more; 4 pcs → 48 g → 4 pcs asks the AI; photo entries are never reused;
an entry that is reused with gaps leaves the others blank; asking again on one device
while another fills a gap has to be repeated; an entry taken over as pending waits for the
other device or the next start; a row that cannot be read holds back later unsent changes
until it can.

## Column headers — FIXED 2026-11-23 (`a8bd585`)

Headers of number columns were left-aligned over right-aligned values in six tables (user
screenshot of Diet Assessment). `th.num`; `tests/table-headers.test.js` compares every
table’s header with its cells.

## Workouts — LIVE since 2026-11-24

User: no place in the activity list for 90 minutes of zone 2 cardio. They chose a mix of
one-tap choices and logged workouts whose calories the AI works out, approved the design
and said "Build straight through it like last time". Spec
`docs/superpowers/specs/2026-11-23-workouts-design.md`, plan
`docs/superpowers/plans/2026-11-23-workouts.md`.

**Deployed 2026-11-24 on the user's "Yes to all"**, in this order:
1. Table `workouts` (migration `workouts_01`, `docs/sql/2026-11-23-workouts-01.sql`). Row
   security checked in a rolled-back transaction: the owner saves and reads, another account
   sees and changes nothing, signed out is refused.
2. `ai-proxy` **v14** (feature `workout`; deployed from the branch, equal to the repo). Both
   models answer: 90 min zone 2 bike 5–6.9 METs, "Yoga" without minutes 60 min, 10,000
   steps 98 min. A food estimate as before. About $0.015–0.02 per workout.
3. `feat/workouts` merged into `main` (fast-forward) and pushed; Pixel_7 reinstalled. With the
   owner's session: the same total for all 18 days as before, 179 of 179 entries would be
   saved as they are, one test workout on a date without an entry POST 201, PATCH 204 (one
   row), DELETE 204. All other data identical before and after; $0.09 in all.

**Still to do (user):** reload every open tab, pull on the laptop, reinstall on the phone
BEFORE using it: older builds count the new list choices as "Sat all day" and ignore
workouts.
**Rollback:** proxy from `ae8476e` (= v13); revert the merge; leave the table.

**What it does:** Calorie Tracker has "+ Add Workout"; Edit Day lists the day's workouts
(what, minutes as 90 / 1:30 / 1h30, calories optional). The AI says how hard it is in METs,
the app works out the extra calories from that day's weight (which the AI is not told).
Typed calories are the user's and never changed; the same words again reuse the last answer
("from Nov 20"); other minutes scale; "Ask AI again"; "How was this worked out?". The list
has three more choices (zone 2 about 45 min 1.4, hard cardio about 45 min 1.5, zone 2 90 min
or more 1.6). With workouts the list is about the rest of the day, so nothing counts twice.
A new day starts with the last "Sat all day" or "Light activity", never with a workout.

**How it works:** `www/workouts.js` (pure, `window.Workouts`): the list, calories, a day's
total, saving, answers, explanation. Table `workouts`, one row each, synced like food.
`app.js`: estimates and their sync work for a *spec* (`FOOD_SYNC`, `WORKOUT_SYNC`) and the
AI queue for a *kind* (`FOOD`, `WORKOUT`); `dayEnergy` is the only way to a day's total;
`_dayForm` keeps what is typed in the day form until Save.

**Verified:** 644 unit and app tests; about 250 mutations of this feature, all noticed but a
few that change nothing; an independent review (8 findings, the serious one: Save with an
empty workout left open replaced the day’s activity; all fixed with a test); random sessions
on the final code without a failure (two tabs and a second device, lost and late answers,
kills), for workouts and again for food; 18 scenarios in headless Chrome with real clicks,
keys and two real tabs, plus the 22 of food and the 13 of sync; layout at 320–1280 px, 125%
and 150%, large text, both themes; the proxy handler against v13 (20 scenarios identical, 18
for workouts). **Not seen yet:** a workout of the owner's own (none on 2026-11-27: `workouts`
had 0 rows).

**Known limits:** two devices changing the same workout or day is last-write-wins; a day's
row is not followed between tabs (food entries and workouts are); typed calories are not
remembered for the next time; `calcBMR` is the male formula for everyone (noticed, not new).

## AI proxy + metering + plans (Spec B) — LIVE since 2026-11-17

Merged into `main` 2026-11-17 (`ce82312`). Spec
`docs/superpowers/specs/2026-07-30-ai-metering-plans-design.md`, plan
`docs/superpowers/plans/2026-07-30-ai-metering-plans.md` (both amended during the work;
the amendments are canon).

**How it works:** every AI call is `callAi(feature, payload)` in `www/app.js` → Edge
Function `ai-proxy` (`supabase/functions/ai-proxy/index.ts`, shared code in
`supabase/functions/_shared/`). No provider key reaches the client: the proxy has
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` as secrets, and the app deletes the old
bring-your-own keys (`nt_key_*`) at startup. Each call asks one Claude and one GPT model,
picked by the account's plan, and logs its cost in `ai_usage` (budget check through the
`ai_usage_total` RPC, failing closed). The plan is in `entitlements` (a new account gets
`free` on its first call; the owner's is `owner`, never capped). Config is the single
`ai_config` row, which clients cannot read: kill switch `enabled`, `rate_per_min` 10,
plans, prices. The credit bar shows percent used only (`ai_usage_summary` RPC); a 402 from
the proxy opens the paywall.

Live config on 2026-11-27, the same as `docs/sql/2026-07-30-metering-02-seed.sql`
(paid allowances are per calendar month, UTC):

| Plan | Allowance | Estimate + photo | Assessment |
|---|---|---|---|
| free | $1.00 lifetime | claude-haiku-4-5 + gpt-5.6-luna | same |
| t3 | $1.20 | claude-sonnet-5-5 + gpt-5.6-terra | same |
| t5 | $2.25 | claude-sonnet-5-5 + gpt-5.6-terra | claude-opus-5-5 + gpt-5.6-sol |
| t10 | $5.00 | claude-opus-5-5 + gpt-5.6-sol | same |

⚠️ Re-applying that seed file RESETS live config edits (warning in the file).

**Verified live 2026-07-31** (owner, emulator, both providers): estimate, photo, month and
year assessments, credit bar, paywall, failure metering, removal of the old keys; about
$0.85 in all.

**Open (none recorded as done since the merge):**
- Plan Task 8: run out of credit for real (`+test2` on a tiny allowance → 402 → paywall,
  then restore the config), and Task 9: emulator kill/relaunch + airplane mode.
- The second assessment round (both models answer and disagree) is only unit-tested.
- Year assessments: gpt-5.6-sol hits the 90 s per-provider timeout and Claude's answer
  carries it; consider a longer assessment timeout.
- Hard budget alerts at OpenAI and Anthropic.

**Deploying `ai-proxy`** (the user's explicit yes every time): from the tree that holds
the code to go live (a 400 "unknown feature" means the wrong tree), `supabase functions
deploy ai-proxy --project-ref wcbpvvyhswaricoadqbb --use-api`; `verify_jwt` stays on.
Check: MCP `get_edge_function`, compare each `files[].content` with the file on disk
(names there lack the `supabase/` prefix). Smoke: in the running app,
`callAi("estimate", { food, qty, unit })` returns an answer and saves nothing
($0.02–0.045 on the owner's plan, logged in `ai_usage`). A deploy leaves
`supabase/.temp/`, which is not git-ignored: don't commit it. Live: **v14** (2026-11-27).

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

**Incomplete-log day tag — LIVE since 2026-11-17** (merged into `main` as `3e663b6`,
right after metering; emulator-verified).
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
  `092efd1b-aa72-4e09-b680-bc4b4d41d19f`, plan `owner`. On 2026-11-27: 192
  food_entries (latest dated 2026-11-27) / 21 days / 0 workouts / 5 assessments /
  1 profile / 6 settings, and 101 `ai_usage` rows. Test account
  `robertmessi123456+test2@gmail.com` (UID `f9da59c4…`, 1 day + 1 profile) still
  exists; keep it for plan Task 8, delete it after. No other accounts.
- Edge Functions: only `ai-proxy`, **v14** ACTIVE on 2026-11-27, `verify_jwt` on.
- Tables (public, all with RLS): this app's `food_entries`, `days`, `workouts`,
  `profile`, `assessments`, `settings`; metering's `ai_usage`, `entitlements`,
  `ai_config`. Not this app: `transactions` + `stock_trades` (the finance app, below)
  and `workout_records` (the separate Workout Tracker app, see "Dev environment notes").
  The owner's 6 `settings` rows: `theme`, `macros_enabled`, the finance app's
  `ft_categories`, and three that nothing reads any more (`anthropic_mode`,
  `anthropic_primary`, `openai_mode`, from the bring-your-own-key days).
- Migrations applied (Supabase migration history on 2026-11-27; the SQL is in
  `docs/sql/` except for the three `transactions`/`stock_trades` ones):
  - `accounts_01_add_user_id` — nullable `user_id uuid` on the 5 app tables
  - `accounts_02_finalize` — backfill to owner, `default auth.uid()` +
    not-null, PKs `(user_id, id)` / settings `(user_id, key)` / profile
    `(user_id)`, **`days` date-unique is per-user `(user_id, date)`** (was a
    global unique — plan gap found live), `per_user_all` RLS on all 5 tables
  - `lock_transactions_table` then `reopen_transactions_owner_only` — see below
  - `create_stock_trades_owner_only` (finance app)
  - `metering_01_tables`, `metering_02_seed_and_hardening`, `metering_03_usage_total_rpc`
  - `incomplete_days_01`, `food_nullable_macros_01`, `food_nutrition_01`, `workouts_01`
- Security advisors on 2026-11-27: only the three expected notes. `ai_config` has no
  policies (only the proxy reads it); `ai_usage_summary()` is security definer for
  signed-in users (the credit bar; it returns only the caller's own percentage);
  leaked-password protection is off (there are no passwords: OTP and Google only).
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
   `main` as `2a0a2ec`, both pushed; metering itself reached `main` with the
   2026-11-17 merge). The
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
6. **Finance app 2026-11-20 — new-row Edit/Delete fix + "Travel" category**
   (committed and pushed 2026-11-23). Bug: a transaction added in the current page
   session could not be edited or deleted until a refresh. Cause:
   `saveTransaction` renders the row under a temporary `Date.now()` id, then
   the background insert swaps the cached row to the server's sequential id —
   the rendered Edit/Del buttons and any open dialog kept addressing an id
   that no longer existed (silent no-op, locally and on the server). Fix in
   `finance/app.js`: `_serverIds` (temporary → server id) and
   `_insertSettled`; lookups go through `resolveTxnId`, server writes
   through `serverTxnId` (waits for an insert still in flight), and the swap
   keeps local fields so an edit made mid-insert is not overwritten.
   "Travel" is now a built-in expense category: in `DEFAULT_CATEGORIES` and
   added once per device to an existing saved list
   (`addNewDefaultCategories`, localStorage marker
   `ft_added_default_categories`, runs before reconcile). It has to be added
   client-side — a SQL edit of the `ft_categories` settings row is reverted
   on the next load by the local-wins category resync.
   Tests: `tests/finance-app.test.js` (13) run the real `finance/app.js` in a
   Node `vm` against a fake DOM + fake Supabase
   (`tests/helpers/finance-app-harness.js`); suite now 138. Also driven in
   headless Chrome against a fake server (HEAD: Edit/Del dead on a new row;
   fixed: all checks pass). Not clicked through against production data.
   Same day: the Transactions header is pinned while the list scrolls so
   "+ New Transaction" (and the month filter) is always reachable —
   `#transactions .page-header` is `position: sticky` in
   `finance/styles.css`; `.main` padding now comes from
   `--main-pad-x`/`--main-pad-y` so the header can span it. Other tabs are
   unchanged. Checked in headless Chrome at five window sizes (incl. laptop
   125%/150% scaling): button in view and clickable at any scroll position,
   resting layout pixel-identical to before.
   ⚠️ **Known hazard, pre-existing, NOT fixed:** the category resync is
   local-wins per browser. A browser holding an older category list
   overwrites the server list when it loads, and reconcile then rewrites
   transactions of any category missing from that list to "Uncategorized"
   **on the server**. Travel itself is protected once a machine runs this
   code, so pull before opening the finance app on the other machine.

Known minor (accepted): offline onboarding has no retry; `AuthView.route()`
is exported but unused (documentation value only). The dev machine still has
legacy pre-accounts `nt_food`/`nt_days`/… localStorage keys — harmless
residue, fresh installs won't have them.

## After that (approved roadmap)

Done: accounts (A); AI proxy + metering + plans (B, 2026-11-17); then the
incomplete-day tag, the sync rewrite, nutrition details and workouts. Queue: the
nutrition-label photo spec (from the 2026-11-23 request), then charts (approved
2026-07-07; wishlist: protein per day with the target line, weight per day, calories
per day vs target), then Phase C: Play Billing subscriptions + entitlements, privacy
policy, in-app account deletion, Play Data Safety, store listing. Pricing decided:
$1 lifetime free cap; $3/$5/$10 tiers. Also before launch: check the domain/socials
and the trademark (USPTO/IPOPHL) for "Lazy Macros".

## Dev environment notes (machine-specific bits may differ on the laptop)

- **Supabase MCP:** `.mcp.json` is committed at repo root. Run `/mcp` →
  supabase → Authenticate (browser OAuth) to enable `execute_sql` /
  `apply_migration` / `get_advisors` against production.
- **Not in git (copy by hand when needed):** the release keystore
  `lazy-macros-release.keystore` + `android/key.properties`, only for signed release
  builds (see `BUILD.md`). `android/local.properties` is per machine (Android Studio
  writes it).
- **Supabase CLI** (for `ai-proxy` deploys): `~/bin/supabase.exe` on the desktop, logged in
  as the user; on another machine install it and run `supabase login` first.
- **Opening the app:** on the desktop, the Desktop shortcut `Open Nutrition Tracker`
  starts `http-server www -p 8080` if needed and opens http://localhost:8080; elsewhere
  run `npx http-server www -p 8080 -c-1`.
- **Other apps in the same Supabase project:** the finance app (`finance/` in this repo;
  `transactions`, `stock_trades`) and the Workout Tracker (`Desktop\Workout Tracker` on
  the desktop, its own folder and Claude sessions; `workout_records`). Its "Train" tab,
  "Discard workout", Routines and Coach are not this app: bug reports about them belong
  there.
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
