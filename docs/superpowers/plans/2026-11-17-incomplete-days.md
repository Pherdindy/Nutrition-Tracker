# Incomplete-Log Day Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user tag a day as "incomplete log" so it shows a badge and is excluded from averages and AI assessments.

**Architecture:** A boolean `incomplete` on each day entry (new `days.incomplete` column, carried through the row mappers and `Targets.migrateDay`). A pure helper `Targets.excludeIncompleteDays` strips tagged dates; `buildRangeData()` in `app.js` (the single funnel for all averages + AI assessment payloads) calls it. UI: checkbox in the Edit Day modal, pills in the desktop tracker table, mobile day cards, and assessment meta.

**Tech Stack:** Vanilla JS SPA (`www/`), UMD helpers tested with Node `--test`, Supabase (Postgres + PostgREST), Capacitor Android.

**Spec:** `docs/superpowers/specs/2026-11-17-incomplete-days-design.md`

**Branch:** `feat/incomplete-days` (already created off `feat/metering`). The working tree has pre-existing uncommitted metering changes (`supabase/functions/ai-proxy/index.ts`, `docs/sql/2026-07-30-metering-02-seed.sql`, `android/*.gradle`, `supabase/.temp/`) — **never `git add` those**; always add explicit paths.

---

## File map

| File | Change |
|---|---|
| `www/targets.js` | `migrateDay` keeps `incomplete`; new `excludeIncompleteDays` |
| `tests/targets.test.js` | update migrateDay test; new helper tests |
| `docs/sql/2026-11-17-incomplete-days-01.sql` | migration (create) |
| `www/app.js` | `dayRowToJs`/`dayJsToRow`; `openDayModal`/`saveDay`; tracker-table pill; `buildRangeData`; YoY pass-through; assessment meta pill; empty-range message |
| `www/index.html` | checkbox in `#day-modal` |
| `www/mobile-render.js` | pill in day-card header |
| `www/styles.css` | `.day-incomplete-pill`, `tr.day-incomplete`, `.form-check` |
| `docs/HANDOFF.md`, `CLAUDE.md` | session notes, test count |

---

### Task 1: `Targets` — keep the flag + exclusion helper (TDD)

**Files:**
- Modify: `www/targets.js:21-24` and `:80`
- Test: `tests/targets.test.js:19-22` (+ append new tests)

- [ ] **Step 1: Update the existing migrateDay test and add new failing tests**

Replace `tests/targets.test.js` lines 19-22 with:

```js
test("migrateDay keeps date/weight/activity/incomplete, strips age/deficit/protein", () => {
  const d = { id: 1, date: "2026-02-05", age: 32, weight: 166, activity: "Gym", deficit: 550, proteinTargetLow: 135, proteinTargetHigh: 150 };
  assert.deepEqual(T.migrateDay(d), { id: 1, date: "2026-02-05", weight: 166, activity: "Gym", incomplete: false });
});

test("migrateDay keeps incomplete:true; non-true values coerce to false", () => {
  const base = { id: 2, date: "2026-02-06", weight: 165, activity: "Gym" };
  assert.equal(T.migrateDay({ ...base, incomplete: true }).incomplete, true);
  assert.equal(T.migrateDay({ ...base, incomplete: "true" }).incomplete, false);
  assert.equal(T.migrateDay({ ...base, incomplete: 1 }).incomplete, false);
  assert.equal(T.migrateDay({ ...base, incomplete: null }).incomplete, false);
});
```

Append at the end of the file:

```js
test("excludeIncompleteDays drops food + day rows for tagged dates only", () => {
  const days = [
    { id: 1, date: "2026-03-01", incomplete: false },
    { id: 2, date: "2026-03-02", incomplete: true },
    { id: 3, date: "2026-03-03" },
  ];
  const food = [
    { id: 10, date: "2026-03-01" }, { id: 11, date: "2026-03-02" },
    { id: 12, date: "2026-03-02" }, { id: 13, date: "2026-03-03" },
    { id: 14, date: "2026-03-04" }, // food with no day row is kept
  ];
  const r = T.excludeIncompleteDays(food, days);
  assert.deepEqual(r.food.map((f) => f.id), [10, 13, 14]);
  assert.deepEqual(r.days.map((d) => d.id), [1, 3]);
  assert.deepEqual(r.excludedDates, ["2026-03-02"]);
});

test("excludeIncompleteDays: no tagged days -> same contents, empty excludedDates", () => {
  const days = [{ id: 1, date: "2026-03-01" }];
  const food = [{ id: 10, date: "2026-03-01" }];
  const r = T.excludeIncompleteDays(food, days);
  assert.deepEqual(r.food, food);
  assert.deepEqual(r.days, days);
  assert.deepEqual(r.excludedDates, []);
});

test("excludeIncompleteDays: all tagged -> empty food/days; excludedDates sorted", () => {
  const days = [{ id: 2, date: "2026-03-05", incomplete: true }, { id: 1, date: "2026-03-01", incomplete: true }];
  const food = [{ id: 10, date: "2026-03-01" }, { id: 11, date: "2026-03-05" }];
  const r = T.excludeIncompleteDays(food, days);
  assert.deepEqual(r.food, []);
  assert.deepEqual(r.days, []);
  assert.deepEqual(r.excludedDates, ["2026-03-01", "2026-03-05"]);
});

test("excludeIncompleteDays tolerates null/undefined inputs", () => {
  const r = T.excludeIncompleteDays(null, undefined);
  assert.deepEqual(r, { food: [], days: [], excludedDates: [] });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm test -- tests/targets.test.js`
Expected: FAIL — migrateDay deepEqual mismatch (missing `incomplete`) and `T.excludeIncompleteDays is not a function`.

- [ ] **Step 3: Implement**

In `www/targets.js` replace `migrateDay` (lines 21-24) with:

```js
  function migrateDay(day) {
    if (!day) return day;
    return { id: day.id, date: day.date, weight: day.weight, activity: day.activity, incomplete: day.incomplete === true };
  }

  // Drop tagged "incomplete log" days (and their food) before computing stats.
  // Food on dates with no day row is kept. Returns new arrays; inputs untouched.
  function excludeIncompleteDays(foodEntries, dayEntries) {
    const days = dayEntries || [];
    const food = foodEntries || [];
    const tagged = new Set(days.filter((d) => d && d.incomplete === true).map((d) => d.date));
    return {
      food: food.filter((f) => !tagged.has(f.date)),
      days: days.filter((d) => !tagged.has(d.date)),
      excludedDates: [...tagged].sort(),
    };
  }
```

Update the return statement (line 80) to:

```js
  return { GOALS, deficitForGoal, migrateDay, excludeIncompleteDays, migrateProfile, calDeltaDisplay, proteinStatusDisplay };
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test`
Expected: all tests PASS (previous count + 5 new).

- [ ] **Step 5: Commit**

```bash
git add www/targets.js tests/targets.test.js
git commit -m "feat(days): Targets keeps incomplete flag; excludeIncompleteDays helper"
```

---

### Task 2: Database column + row mappers

**Files:**
- Create: `docs/sql/2026-11-17-incomplete-days-01.sql`
- Modify: `www/app.js:108-118` (`dayRowToJs`, `dayJsToRow`)

- [ ] **Step 1: Write the migration file**

`docs/sql/2026-11-17-incomplete-days-01.sql`:

```sql
-- incomplete_days_01: per-day "incomplete log" tag.
-- Tagged days are excluded client-side from averages + AI assessments.
-- Covered by the existing per_user_all RLS policy on public.days (no policy change).
-- Old clients omit the column on upsert; PostgREST only updates supplied columns,
-- so they never clobber the flag. New rows from old clients get the default.
alter table public.days add column if not exists incomplete boolean not null default false;
```

- [ ] **Step 2: Apply it to production**

Use the Supabase MCP tool `apply_migration` with name `incomplete_days_01` and the SQL above (the `alter table` line). If the MCP isn't authenticated, ask the user to run `/mcp` first.

Verify with `execute_sql`:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'days' and column_name = 'incomplete';
```

Expected: one row — `incomplete | boolean | NO | false`.

Then `get_advisors` (security) — expected: no new findings.

- [ ] **Step 3: Update the mappers**

In `www/app.js`, replace `dayRowToJs` (lines 108-110):

```js
function dayRowToJs(r) {
  return Targets.migrateDay({ id: r.id, date: r.date, weight: Number(r.weight), activity: r.activity, incomplete: r.incomplete === true });
}
```

In `dayJsToRow` (lines 111-118), change the return's first line from
`return { id: e.id, date: e.date, weight: e.weight, activity: e.activity,`
to
`return { id: e.id, date: e.date, weight: e.weight, activity: e.activity, incomplete: !!e.incomplete,`
(leave the rest of the object unchanged).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS (no app.js unit tests; this guards against syntax breaks in shared modules).
Also: `node --check www/app.js` — expected no output.

- [ ] **Step 5: Commit**

```bash
git add docs/sql/2026-11-17-incomplete-days-01.sql www/app.js
git commit -m "feat(days): days.incomplete column + row mapping"
```

---

### Task 3: Edit Day modal checkbox

**Files:**
- Modify: `www/index.html:247-251` (inside `#day-form`)
- Modify: `www/app.js` `openDayModal` (~line 697) and `saveDay` (~line 712)
- Modify: `www/styles.css` (after `.form-row-pair` block, ~line 355)

- [ ] **Step 1: Add the checkbox markup**

In `www/index.html`, after the Activity Type `form-row` (the `</div>` closing `<select id="day-activity">`'s row) and before `<div class="modal-actions">`, insert:

```html
          <div class="form-row form-check">
            <input type="checkbox" id="day-incomplete">
            <label for="day-incomplete">Incomplete log — I didn't record everything this day
              <span class="form-hint">Excluded from averages and AI assessments</span></label>
          </div>
```

- [ ] **Step 2: Add CSS**

In `www/styles.css`, after the `.form-row-pair { ... }` block, add:

```css
.form-row.form-check { display: flex; align-items: flex-start; gap: 10px; }
.form-row.form-check input[type="checkbox"] { width: 18px; height: 18px; margin-top: 2px; flex: none; accent-color: var(--primary); cursor: pointer; }
.form-row.form-check label { margin: 0; color: var(--text); cursor: pointer; }
.form-row.form-check .form-hint { display: block; font-size: 0.75rem; color: var(--text-dim); font-weight: 400; margin-top: 2px; }
```

(`.form-row input { width: 100% }` would otherwise stretch the checkbox — the `width: 18px` rule above has higher specificity and overrides it.)

- [ ] **Step 3: Wire open/save**

In `openDayModal(entry)`, after `document.getElementById("day-activity").value = entry.activity;` add:

```js
  document.getElementById("day-incomplete").checked = entry.incomplete === true;
```

In `saveDay(e)`, replace the `entries[idx] = { ... }` line with:

```js
  entries[idx] = { ...entries[idx], weight: parseFloat(document.getElementById("day-weight").value), activity: document.getElementById("day-activity").value, incomplete: document.getElementById("day-incomplete").checked };
```

- [ ] **Step 4: Verify in browser**

Run: `npx http-server www -p 8080 -c-1`, open `http://localhost:8080`, sign in, Daily Tracker → Edit a day: checkbox renders at checkbox size with label + hint beside it (desktop and ≤720px width). Check it, Save, re-open Edit → still checked. Reload page → still checked (round-trips via Supabase/localStorage).

- [ ] **Step 5: Commit**

```bash
git add www/index.html www/app.js www/styles.css
git commit -m "feat(days): incomplete-log checkbox in Edit Day modal"
```

---

### Task 4: Badges — desktop table + mobile cards

**Files:**
- Modify: `www/app.js` `renderCalorieTracker` (~lines 447-448)
- Modify: `www/mobile-render.js` `renderDayCards` (~lines 94-96)
- Modify: `www/styles.css` (append near `.day-card-date`, ~line 1670)

- [ ] **Step 1: Desktop table**

In `renderCalorieTracker`, replace:

```js
    html += `<tr class="day-summary">
      <td>${formatDate(day.date)}</td>
```

with:

```js
    const incPill = day.incomplete ? ` <span class="day-incomplete-pill" title="Excluded from averages and AI assessments">Incomplete</span>` : "";
    html += `<tr class="day-summary${day.incomplete ? " day-incomplete" : ""}">
      <td>${formatDate(day.date)}${incPill}</td>
```

- [ ] **Step 2: Mobile card**

In `renderDayCards`, replace:

```js
    html += `<div class="day-card">
      <button class="day-card-head" data-id="${day.id}">
        <span class="day-card-date">${formatDate(day.date)}</span>
```

with:

```js
    html += `<div class="day-card${day.incomplete ? " day-incomplete" : ""}">
      <button class="day-card-head" data-id="${day.id}">
        <span class="day-card-date">${formatDate(day.date)}</span>${day.incomplete ? `<span class="day-incomplete-pill">Incomplete</span>` : ""}
```

- [ ] **Step 3: CSS**

Append to `www/styles.css` after the `.day-card-date` rule:

```css
.day-incomplete-pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 600;
  background: var(--surface2); border: 1px solid var(--border); color: var(--text-dim); vertical-align: middle; white-space: nowrap; }
tr.day-summary.day-incomplete td { opacity: 0.6; }
tr.day-summary.day-incomplete td:first-child { opacity: 1; }
.day-card.day-incomplete .day-card-kcal { opacity: 0.6; }
```

- [ ] **Step 4: Verify in browser**

With the server from Task 3: tag a day → desktop row dimmed, date cell shows "Incomplete" pill; resize to ≤720px → day card header shows the pill while collapsed, no wrap/overflow at 360px width; untag → pill gone. Check light and dark theme both legible.

- [ ] **Step 5: Commit**

```bash
git add www/app.js www/mobile-render.js www/styles.css
git commit -m "feat(days): Incomplete pill on tracker rows and day cards"
```

---

### Task 5: Exclude tagged days from stats + assessment meta

**Files:**
- Modify: `www/app.js` `buildRangeData` (~lines 1013-1064), YoY return in `getAssessmentData` (~lines 1084-1101), `renderAssessmentDataSummary` (~line 1390), empty-range guard (~line 1245)

- [ ] **Step 1: Filter in `buildRangeData`**

Replace the first two lines of `buildRangeData`:

```js
  const filteredFood = foodEntries.filter(f => f.date >= startDate && f.date <= endDate);
  const filteredDays = dayEntries.filter(d => d.date >= startDate && d.date <= endDate);
```

with:

```js
  const inRange = Targets.excludeIncompleteDays(
    foodEntries.filter(f => f.date >= startDate && f.date <= endDate),
    dayEntries.filter(d => d.date >= startDate && d.date <= endDate));
  const filteredFood = inRange.food;
  const filteredDays = inRange.days;
```

In the returned object, change `startDate, endDate, dates, numDays,` to:

```js
    startDate, endDate, dates, numDays,
    excludedIncompleteDays: inRange.excludedDates.length,
```

- [ ] **Step 2: YoY pass-through**

In `getAssessmentData`'s YoY return object, after `totalEntries: currentYear.totalEntries,` add:

```js
      excludedIncompleteDays: currentYear.excludedIncompleteDays,
```

- [ ] **Step 3: Meta pill**

In `renderAssessmentDataSummary`, after the `... days</span>` line add:

```js
  if (data.excludedIncompleteDays > 0) {
    const n = data.excludedIncompleteDays;
    html += `<span class="meta-pill"><strong>${n}</strong> incomplete day${n === 1 ? "" : "s"} excluded</span>`;
  }
```

- [ ] **Step 4: Clearer empty-range message**

At the guard `if (data.totalEntries === 0) {` (~line 1245), replace the `setAssessmentStatus(...)` line inside it with:

```js
    setAssessmentStatus(data.excludedIncompleteDays > 0
      ? "Every logged day in this period is tagged incomplete. Untag a day or pick a different period."
      : "No food entries found for this period. Add food entries first.", true);
```

(Keep whatever follows it in that block — e.g. `return;` — unchanged.)

- [ ] **Step 5: Verify**

Run: `npm test` → all PASS; `node --check www/app.js` → no output.
In the browser (DevTools console, signed in, with at least one tagged day inside the last 7 days — note the `"week"` range ends YESTERDAY, so don't tag today for this check):

```js
const a = getAssessmentData("week"); [a.numDays, a.excludedIncompleteDays, a.dates]
```

Expected: tagged date absent from `a.dates`; `excludedIncompleteDays` ≥ 1; untag and re-run → `numDays` goes up by the count (if the tagged day had food). Do NOT run a paid AI assessment here — that's Task 6.

- [ ] **Step 6: Commit**

```bash
git add www/app.js
git commit -m "feat(days): exclude incomplete days from averages and assessments"
```

---

### Task 6: Device verification + docs

**Files:**
- Modify: `docs/HANDOFF.md`, `CLAUDE.md` (test count line)

- [ ] **Step 1: Sync + install**

```powershell
npx cap sync android
cd android; .\gradlew.bat installDebug; cd ..
```

Emulator per memory recipe (cold boot `-no-snapshot-load`, WHPX). Launch the app.

- [ ] **Step 2: Live checks (CDP or by hand)**

1. Daily tab → expand a day → Edit → tick Incomplete → Save → pill appears in collapsed card header.
2. Force-stop + relaunch → pill persists.
3. Server check via MCP `execute_sql`:
   `select date, incomplete from public.days where incomplete order by date desc limit 5;` → the tagged date appears.
4. Assessment tab → run one short-period assessment (one paid call, ~$0.03–0.33) whose range includes the tagged day → meta shows "1 incomplete day excluded" and the day count is one lower than before tagging.
5. Untag the test day afterwards (unless the user wants it kept).

- [ ] **Step 3: Docs**

- `docs/HANDOFF.md`: add an entry for the incomplete-days feature (branch `feat/incomplete-days` off `feat/metering`, migration `incomplete_days_01` APPLIED, verification results, merge order: after metering).
- `CLAUDE.md`: update the `npm test` line's test count to the actual count from `npm test` output.

- [ ] **Step 4: Commit**

```bash
git add docs/HANDOFF.md CLAUDE.md
git commit -m "docs: HANDOFF + CLAUDE.md — incomplete-log day tag"
```
