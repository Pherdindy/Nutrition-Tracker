# Global Targets + Auto-Created Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make deficit, protein target, and age global (on the Targets tab) instead of per-day, and remove the manual "Add Day" so days auto-create from food logging.

**Architecture:** A new pure UMD module `www/targets.js` (`window.Targets`) owns the goal→deficit lookup and the profile/day migration helpers (Node-testable). `www/app.js` moves age/deficit/protein into the global profile, shrinks the Day model to `{date,weight,activity}`, hardens `saveDayEntries`, and points the calorie tracker + assessment at the global values. `www/mobile-render.js` updates day cards. Reuses the existing profile store and `WEIGHT_LOSS_GOALS`.

**Tech Stack:** Vanilla JS (no bundler), UMD modules, Node built-in test runner, Supabase + localStorage.

**Reference spec:** `docs/superpowers/specs/2026-06-04-global-targets-auto-days-design.md`

**Conventions:** Commit after each task. Already on branch `feat/global-targets`. `npm test` for units; emulator checks via the WebView DevTools recipe in project memory.

**Current facts (verified):**
- `dayRowToJs`/`dayJsToRow` (app.js:52-57) map `{id,date,age,weight,activity,deficit,proteinTargetLow,proteinTargetHigh}` ↔ snake_case.
- `profileRowToJs`/`profileJsToRow` (app.js:59-63) map `{height,proteinLow,proteinHigh}`. `DEFAULT_PROFILE` (app.js:89).
- `WEIGHT_LOSS_GOALS` (app.js:82-87): 0.25/0.50/0.75/1.00 kg/week → 275/550/825/1100.
- `calcBMR(weightLbs, heightCm, age)` (app.js:449).
- `saveDayEntries` (app.js:142) is **destructive** (delete-all then upsert) — must be hardened.
- `renderCalorieTracker` (app.js:570) renders per-row Age/Deficit/ProteinTargetLow/High columns and uses `day.deficit`/`day.proteinTarget*`/`day.age`; empty-state `colspan="19"`.
- Day modal (`openDayModal`/`saveDay`, app.js:859-934) has age/deficit/protein-target fields + an add path with a duplicate-date check.
- `saveProfileForm` (app.js:954) reads height + protein low/high.
- `ensureDayExists` sets deficit/protein/age (per earlier reads ~line 717).
- Assessment reads `day.deficit`/`day.proteinTarget*`/`day.age` in `buildRangeData`/`buildAssessmentPrompt`/`renderAssessmentResults`.

---

## Phase 1 — `www/targets.js` pure module (TDD)

**Files:** Create `www/targets.js`, `tests/targets.test.js`.

UMD like `macros.js` (no deps):
```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Targets = api;
})(typeof self !== "undefined" ? self : this, function () { /* ... */ return {...}; });
```

### Task 1.1: GOALS + deficitForGoal

- [ ] **Step 1: Write failing test** — `tests/targets.test.js`
```js
const test = require("node:test");
const assert = require("node:assert");
const T = require("../www/targets.js");

test("GOALS includes Maintain and the four weight-loss goals", () => {
  const labels = T.GOALS.map((g) => g.goal);
  assert.deepEqual(labels, ["Maintain", "0.25 kg/week", "0.50 kg/week", "0.75 kg/week", "1.00 kg/week"]);
  assert.equal(T.GOALS[0].daily, 0);
});

test("deficitForGoal maps label to daily deficit; unknown/blank -> 550", () => {
  assert.equal(T.deficitForGoal("Maintain"), 0);
  assert.equal(T.deficitForGoal("0.50 kg/week"), 550);
  assert.equal(T.deficitForGoal("1.00 kg/week"), 1100);
  assert.equal(T.deficitForGoal("bogus"), 550);
  assert.equal(T.deficitForGoal(null), 550);
});
```

- [ ] **Step 2: Run → FAIL.** `npm test`.

- [ ] **Step 3: Implement** `www/targets.js`
```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Targets = api;
})(typeof self !== "undefined" ? self : this, function () {
  const GOALS = [
    { goal: "Maintain", daily: 0 },
    { goal: "0.25 kg/week", daily: 275 },
    { goal: "0.50 kg/week", daily: 550 },
    { goal: "0.75 kg/week", daily: 825 },
    { goal: "1.00 kg/week", daily: 1100 },
  ];
  function deficitForGoal(label) {
    const g = GOALS.find((x) => x.goal === label);
    return g ? g.daily : 550;
  }
  return { GOALS, deficitForGoal };
});
```

- [ ] **Step 4: Run → PASS.** `npm test` (existing 35 still pass).

- [ ] **Step 5: Commit**
```bash
git add www/targets.js tests/targets.test.js
git commit -m "feat(targets): goal list + deficitForGoal lookup"
```

### Task 1.2: migrateDay + migrateProfile

- [ ] **Step 1: Write failing test** (append)
```js
test("migrateDay keeps date/weight/activity, strips age/deficit/protein", () => {
  const d = { id: 1, date: "2026-02-05", age: 32, weight: 166, activity: "Gym", deficit: 550, proteinTargetLow: 135, proteinTargetHigh: 150 };
  assert.deepEqual(T.migrateDay(d), { id: 1, date: "2026-02-05", weight: 166, activity: "Gym" });
});

test("migrateProfile seeds age/weightLossGoal from days when missing; leaves populated profile", () => {
  const days = [{ age: 30, deficit: 825 }, { age: 30, deficit: 825 }];
  const seeded = T.migrateProfile({ height: 170, proteinLow: 135, proteinHigh: 150 }, days);
  assert.equal(seeded.age, 30);
  assert.equal(seeded.weightLossGoal, "0.75 kg/week");
  const already = T.migrateProfile({ height: 170, age: 40, proteinLow: 135, proteinHigh: 150, weightLossGoal: "Maintain" }, days);
  assert.equal(already.age, 40);
  assert.equal(already.weightLossGoal, "Maintain");
});

test("migrateProfile falls back to age 32 / 0.50 goal with no days", () => {
  const p = T.migrateProfile({ height: 170, proteinLow: 135, proteinHigh: 150 }, []);
  assert.equal(p.age, 32);
  assert.equal(p.weightLossGoal, "0.50 kg/week");
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (add inside factory; extend exports). Note `deficit→goal` reverse map uses `GOALS`:
```js
  function migrateDay(day) {
    if (!day) return day;
    return { id: day.id, date: day.date, weight: day.weight, activity: day.activity };
  }
  function goalForDeficit(daily) {
    const g = GOALS.find((x) => x.daily === Number(daily));
    return g ? g.goal : "0.50 kg/week";
  }
  function migrateProfile(profile, days) {
    const out = { ...profile };
    if (out.age == null) {
      const d = (days || []).find((x) => x.age != null);
      out.age = d ? Number(d.age) : 32;
    }
    if (out.weightLossGoal == null) {
      const d = (days || []).find((x) => x.deficit != null);
      out.weightLossGoal = d ? goalForDeficit(d.deficit) : "0.50 kg/week";
    }
    return out;
  }
```
Exports add: `migrateDay, migrateProfile`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**
```bash
git add www/targets.js tests/targets.test.js
git commit -m "feat(targets): day + profile migration helpers"
```

---

## Phase 2 — Data model: profile, mappers, hardened day save, seed-on-load

**Files:** `www/index.html` (script tag), `www/app.js`, Supabase (user SQL).

### Task 2.0: Supabase schema (USER ACTION — run once)
```sql
alter table profile add column if not exists age integer;
alter table profile add column if not exists weight_loss_goal text;
```
Reads tolerate absence (seed-on-load); the `days` table is unchanged.

### Task 2.1: Load module, profile model + mappers + getDeficit

- [ ] **Step 1:** In `www/index.html`, add `<script src="targets.js"></script>` after `macros.js`/`photo.js` and before `app.js`.

- [ ] **Step 2:** In `www/app.js`, update `DEFAULT_PROFILE` (line 89) and the mappers:
```js
const DEFAULT_PROFILE = { height: 170.1, age: 32, proteinLow: 135, proteinHigh: 150, weightLossGoal: "0.50 kg/week" };
```
```js
function profileRowToJs(r) {
  return { height: Number(r.height), age: r.age != null ? Number(r.age) : null, proteinLow: Number(r.protein_low), proteinHigh: Number(r.protein_high), weightLossGoal: r.weight_loss_goal || null };
}
function profileJsToRow(p) {
  return { id: 1, height: p.height, age: p.age, protein_low: p.proteinLow, protein_high: p.proteinHigh, weight_loss_goal: p.weightLossGoal };
}
function dayRowToJs(r) {
  return Targets.migrateDay({ id: r.id, date: r.date, weight: Number(r.weight), activity: r.activity });
}
function dayJsToRow(e) {
  // Keep legacy columns populated from the current global profile so old rows stay valid
  // (no days-table schema change) and reads ignore them.
  const p = (typeof loadProfile === "function") ? loadProfile() : {};
  return { id: e.id, date: e.date, weight: e.weight, activity: e.activity,
    age: p.age != null ? p.age : 32, deficit: Targets.deficitForGoal(p.weightLossGoal),
    protein_target_low: p.proteinLow != null ? p.proteinLow : 135, protein_target_high: p.proteinHigh != null ? p.proteinHigh : 150 };
}
```

- [ ] **Step 3:** Add a `getDeficit()` helper near `loadProfile`:
```js
function getDeficit() { return Targets.deficitForGoal(loadProfile().weightLossGoal); }
```

- [ ] **Step 4: Verify.** `node --check www/app.js` exit 0; `npm test` 37→ (35 + 2 new files' tests already counted; expect all pass). Report numbers.

- [ ] **Step 5: Commit**
```bash
git add www/index.html www/app.js
git commit -m "feat(targets): global profile (age, weight-loss goal) + day mappers + getDeficit"
```

### Task 2.2: Harden saveDayEntries + seed profile on load

- [ ] **Step 1:** Replace the `bgWrite` body of `saveDayEntries` (app.js:145) with the non-destructive upsert-before-delete pattern (mirror `saveFoodEntries`):
```js
  bgWrite(async () => {
    if (entries.length === 0) {
      const { error } = await sb.from('days').delete().gte('id', 0);
      if (error) throw error;
      return;
    }
    const rows = entries.map(dayJsToRow);
    const { error: upErr } = await sb.from('days').upsert(rows);
    if (upErr) throw upErr; // table untouched — no rows deleted
    const ids = entries.map((e) => e.id);
    const { error: delErr } = await sb.from('days').delete().not('id', 'in', `(${ids.join(',')})`);
    if (delErr) throw delErr;
  });
```

- [ ] **Step 2:** Migrate days on load + seed the profile. Where `_cache.days` is populated (`initFromSupabase` ~line 290, `initFromLocalStorage`), map days through `Targets.migrateDay` and seed the profile via `Targets.migrateProfile`. In `loadDayEntries`, also migrate on read:
```js
function loadDayEntries() {
  if (_cache.ready && _cache.days) return _cache.days.map(Targets.migrateDay);
  const saved = localStorage.getItem("nt_days");
  return saved ? JSON.parse(saved).map(Targets.migrateDay) : [];
}
```
In both init paths, after `_cache.days` and `_cache.profile` are set, add:
```js
  _cache.profile = Targets.migrateProfile(_cache.profile, _cache.days || []);
```
(Place it after the raw `_cache.days` assignment. `initFromSupabase` already migrates days via the now-migrating `dayRowToJs`; ensure `_cache.days` is the migrated form before seeding, or pass the raw rows' age/deficit — simplest: seed from `_cache.days` BEFORE migrateDay strips fields. So: seed profile from the RAW day rows first, then migrate days. Implementer: in `initFromSupabase`, compute `const rawDays = foodRes... daysRes.data.map(dayRowToJsRaw)`? To keep it simple, seed from `daysRes.data` mapped to `{age:r.age, deficit:r.deficit}` BEFORE `dayRowToJs`. Concretely: `_cache.profile = Targets.migrateProfile(_cache.profile, daysRes.data.map(r => ({age:r.age, deficit:r.deficit})));` and for localStorage use the parsed pre-migration objects.)

- [ ] **Step 3:** Persist the seeded profile once if it changed: after seeding in the init paths, call `saveProfile(_cache.profile)` only if age/goal were newly added (guard to avoid needless writes). Simplest: always `saveProfile(_cache.profile)` after seeding (idempotent upsert).

- [ ] **Step 4: Verify.** `node --check www/app.js`; `npm test` all pass. On emulator (after SQL): `loadProfile()` shows `age` + `weightLossGoal`; `loadDayEntries()[0]` is `{id,date,weight,activity}` only; `getDeficit()` returns a number.

- [ ] **Step 5: Commit**
```bash
git add www/app.js
git commit -m "feat(targets): harden saveDayEntries; migrate days + seed profile on load"
```

---

## Phase 3 — Targets tab UI (age + goal)

**Files:** `www/index.html` (profile form), `www/app.js` (`saveProfileForm`, profile form population).

### Task 3.1: Profile form gains Age + Weight-loss goal

- [ ] **Step 1:** In `www/index.html`, find the Profile form (contains `#profile-height`, `#profile-protein-low`, `#profile-protein-high`). Add an Age input and a goal select:
```html
          <div class="form-row">
            <label for="profile-age">Age</label>
            <input type="number" id="profile-age" required>
          </div>
          <div class="form-row">
            <label for="profile-goal">Weight-loss goal</label>
            <select id="profile-goal"></select>
          </div>
```
(Place after the height row, before/after protein rows — keep within the same `<form>`.)

- [ ] **Step 2:** In `www/app.js`, populate the goal select + age wherever the profile form is rendered/opened (find where `#profile-height`/`#profile-protein-low` are set, ~line 644). Add:
```js
  const _gsel = document.getElementById("profile-goal");
  if (_gsel) _gsel.innerHTML = Targets.GOALS.map((g) => `<option value="${escapeHtml(g.goal)}" ${profile.weightLossGoal === g.goal ? "selected" : ""}>${escapeHtml(g.goal)}</option>`).join("");
  const _age = document.getElementById("profile-age");
  if (_age) _age.value = profile.age != null ? profile.age : 32;
```

- [ ] **Step 3:** Update `saveProfileForm` (app.js:954):
```js
function saveProfileForm(e) {
  e.preventDefault();
  const profile = {
    height: parseFloat(document.getElementById("profile-height").value),
    age: parseInt(document.getElementById("profile-age").value),
    proteinLow: parseFloat(document.getElementById("profile-protein-low").value),
    proteinHigh: parseFloat(document.getElementById("profile-protein-high").value),
    weightLossGoal: document.getElementById("profile-goal").value,
  };
  saveProfile(profile);
  renderCalorieTracker();
  alert("Profile saved!");
}
```

- [ ] **Step 4: Verify.** `node --check`; `npm test`. On emulator: Targets shows Age + goal select; saving persists them (`loadProfile()`).

- [ ] **Step 5: Commit**
```bash
git add www/index.html www/app.js
git commit -m "feat(targets): age + weight-loss goal in the profile form"
```

---

## Phase 4 — Days flow: remove Add Day, shrink modal, global tracker

**Files:** `www/index.html` (button, day modal, tracker thead), `www/app.js` (`ensureDayExists`, `openDayModal`, `saveDay`, `renderCalorieTracker`, wiring), `www/mobile-render.js` (`renderDayCards`).

### Task 4.1: ensureDayExists + day modal shrink + remove Add Day

- [ ] **Step 1:** Rewrite `ensureDayExists` to create only `{id,date,weight,activity}`:
```js
function ensureDayExists(date) {
  const days = loadDayEntries();
  if (days.some((d) => d.date === date)) return;
  const sorted = [...days].sort((a, b) => (a.date < b.date ? 1 : -1));
  const prev = sorted[0];
  const maxId = days.length ? Math.max(...days.map((d) => d.id)) : 0;
  days.push({ id: maxId + 1, date, weight: prev ? prev.weight : 168, activity: prev ? prev.activity : ACTIVITY_TYPES[0].label });
  saveDayEntries(days);
}
```

- [ ] **Step 2:** In `www/index.html`, remove the `#add-day-btn` button. In `www/app.js`, remove its listener (`getElementById("add-day-btn")...`).

- [ ] **Step 3:** In `www/index.html` day modal, remove the Age, Deficit, Protein-target-low, Protein-target-high `.form-row`s (keep date, weight, activity). Rewrite `openDayModal` to edit-only (it's only reached via `editDay` now):
```js
function openDayModal(entry) {
  const modal = document.getElementById("day-modal");
  document.getElementById("day-modal-title").textContent = "Edit Day";
  populateActivitySelect();
  document.getElementById("day-id").value = entry.id;
  document.getElementById("day-date").value = entry.date;
  document.getElementById("day-weight").value = entry.weight;
  document.getElementById("day-activity").value = entry.activity;
  modal.classList.remove("hidden");
}
```
And `saveDay` (edit-only path; entries always have an id now):
```js
function saveDay(e) {
  e.preventDefault();
  const entries = loadDayEntries();
  const id = document.getElementById("day-id").value;
  const idx = entries.findIndex((x) => x.id === parseInt(id));
  if (idx === -1) { console.warn("saveDay: day not found", id); return; }
  entries[idx] = { ...entries[idx],
    weight: parseFloat(document.getElementById("day-weight").value),
    activity: document.getElementById("day-activity").value };
  saveDayEntries(entries);
  closeDayModal();
  renderCalorieTracker();
}
```

- [ ] **Step 4: Verify.** `node --check`; `npm test`. Grep app.js for `day-age`/`day-deficit`/`day-protein-target` — only remaining refs should be gone (no live references). Report.

- [ ] **Step 5: Commit**
```bash
git add www/index.html www/app.js
git commit -m "feat(days): auto-create only; edit weight/activity; remove Add Day"
```

### Task 4.2: renderCalorieTracker + thead → global, drop columns

- [ ] **Step 1:** In `www/index.html`, in the `#calorie-tracker-table` `<thead>`, remove the **Age**, **Deficit**, **Protein target (low)**, **Protein target (high)** header cells (4 columns). Leave Date, Weight, BMR, Activity, TDEE, Target, Cal↓, Cal↑, Cal+/-↓, Cal+/-↑, Protein↓, Protein↑, Pro+/-↓, Pro+/-↑, Actions.

- [ ] **Step 2:** Rewrite the row body of `renderCalorieTracker` (app.js:580-616) to use global values and drop the 4 cells:
```js
  const deficit = getDeficit();
  for (const day of days) {
    const bmr = calcBMR(day.weight, profile.height, profile.age);
    const tdee = calcTDEE(bmr, day.activity);
    const target = tdee - deficit;
    const totals = getDailyFoodTotals(day.date, food);
    const surpLow = totals.calLow - target, surpHigh = totals.calHigh - target;
    const proSurpLow = totals.proLow - profile.proteinLow, proSurpHigh = totals.proHigh - profile.proteinHigh;
    html += `<tr class="day-summary">
      <td>${formatDate(day.date)}</td>
      <td class="num">${day.weight}</td>
      <td class="num">${renderNum(bmr, 1)}</td>
      <td>${escapeHtml(day.activity)}</td>
      <td class="num">${renderNum(tdee, 1)}</td>
      <td class="num">${renderNum(target, 0)}</td>
      <td class="num">${renderNum(totals.calLow, 1)}</td>
      <td class="num">${renderNum(totals.calHigh, 1)}</td>
      <td class="num ${surplusClass(surpLow)}">${renderNum(surpLow, 1)}</td>
      <td class="num ${surplusClass(surpHigh)}">${renderNum(surpHigh, 1)}</td>
      <td class="num">${renderNum(totals.proLow, 1)}</td>
      <td class="num">${renderNum(totals.proHigh, 1)}</td>
      <td class="num ${surplusClass(-proSurpLow)}">${renderNum(proSurpLow, 1)}</td>
      <td class="num ${surplusClass(-proSurpHigh)}">${renderNum(proSurpHigh, 1)}</td>
      <td><div class="actions">
        <button class="btn-icon" onclick="editDay(${day.id})" title="Edit">&#9998;</button>
        <button class="btn-icon delete" onclick="deleteDay(${day.id})" title="Delete">&#10005;</button>
      </div></td>
    </tr>`;
  }
```
Update the empty-state `colspan` from `19` to `15`, and change its message from `Click "+ Add Day" to start.` to `Log food to start tracking days.`

- [ ] **Step 3: Verify.** `node --check`; `npm test`. On emulator: tracker shows 15 columns; Target = TDEE − global deficit; protein surplus uses global protein target.

- [ ] **Step 4: Commit**
```bash
git add www/index.html www/app.js
git commit -m "feat(days): calorie tracker uses global targets; drop per-day columns"
```

### Task 4.3: Mobile day cards → global

- [ ] **Step 1:** In `www/mobile-render.js` `renderDayCards`, replace `day.deficit`/`day.proteinTargetLow`/`day.proteinTargetHigh`/`day.age` with the global profile values. Read `const profile = loadProfile();` and `const deficit = Targets.deficitForGoal(profile.weightLossGoal);` (already loads profile). Use `calcBMR(day.weight, profile.height, profile.age)`, `target = tdee - deficit`, and protein vs `profile.proteinLow/High`. Remove the per-day "Deficit / Target" and protein-target detail rows that referenced removed fields (keep Weight, BMR/TDEE, Activity, Target, Cal +/-, Protein vs target using globals).

- [ ] **Step 2: Verify.** `node --check www/mobile-render.js`; `npm test`. On emulator (mobile width): day cards render with no per-day deficit/protein-target, BMR uses global age.

- [ ] **Step 3: Commit**
```bash
git add www/mobile-render.js
git commit -m "feat(days): mobile day cards use global targets"
```

---

## Phase 5 — Assessment reads global targets

**Files:** `www/app.js` (`buildRangeData`, `buildAssessmentPrompt`, `renderAssessmentResults`).

### Task 5.1: Switch assessment day-context to global

- [ ] **Step 1:** Grep `www/app.js` for `day.deficit`, `\.deficit`, `proteinTarget`, `day.age`, `\.age` within the assessment functions (`buildRangeData` ~line 1700s, `buildAssessmentPrompt`, `renderAssessmentResults` daily-context). Replace:
  - `day.deficit` / `ctx.deficit` source → `getDeficit()` (compute once: `const deficit = getDeficit();`).
  - `day.proteinTargetLow/High` → `profile.proteinLow/High` (the functions already `loadProfile()` or have `profile` available; if not, load it).
  - `calcBMR(..., day.age)` / `ctx` age → `profile.age`.
  Any `dailyContext[date]` object that stored `deficit` per day now stores the global `deficit`/`calorieTarget` computed from `getDeficit()` + `profile.age`.

- [ ] **Step 2:** After edits, grep the assessment functions again to confirm no `day.deficit`/`day.proteinTarget*`/`day.age` reads remain (only `getDeficit()`/`profile.*`). Report the grep.

- [ ] **Step 3: Verify.** `node --check`; `npm test`. On emulator: the assessment summary "Target"/"vs TDEE" columns and the prompt use the global deficit + protein target + age (non-zero, consistent for all days).

- [ ] **Step 4: Commit**
```bash
git add www/app.js
git commit -m "feat(targets): diet assessment reads global deficit/protein/age"
```

---

## Phase 6 — Build + verification + finish

### Task 6.1: Emulator verification

- [ ] **Step 1:** `npx cap sync android`; `cd android; .\\gradlew.bat installDebug`; relaunch.

- [ ] **Step 2:** Verify (DevTools + UI; run the profile SQL first for cloud persistence):
  - **No "+ Add Day" button** anywhere.
  - Logging a food on a NEW date auto-creates a `{date,weight,activity}` day (check `loadDayEntries()`); editing that day changes only weight/activity.
  - Targets tab shows **Age** + **Weight-loss goal**; saving persists (`loadProfile()` has age + weightLossGoal); changing the goal changes every day's **Target** (= TDEE − deficit) in the tracker.
  - Calorie tracker has 15 columns (no Age/Deficit/Protein-target columns); protein surplus uses the global protein target.
  - Diet Assessment data uses the global values (non-zero, correct).
  - Mobile day cards render without per-day deficit/protein-target.

- [ ] **Step 3:** Use `superpowers:verification-before-completion` to confirm each with evidence.

- [ ] **Step 4:** Finish with `superpowers:finishing-a-development-branch`.

---

## Self-Review (completed by plan author)

- **Spec coverage:** auto-create + remove Add Day → Task 4.1; deficit+protein+age global → Tasks 1.1/2.1/3.1; Day shrink → 1.2/2.1/4.1; consumers (tracker/cards/assessment) → 4.2/4.3/5.1; profile schema + seed-on-load + day migration → 2.0/2.1/2.2; harden saveDayEntries → 2.2; goal selector + Maintain → 1.1/3.1; testing → Phase 1 + 6.1. All covered.
- **Type consistency:** `profile {height,age,proteinLow,proteinHigh,weightLossGoal}`; `day {id,date,weight,activity}`; `Targets.{GOALS,deficitForGoal,migrateDay,migrateProfile}`; `getDeficit()` in app.js; `dayJsToRow` denormalizes globals into legacy columns. Consistent across phases.
- **Placeholders:** none — code shown for each code step. Open Decisions defaulted (no new goal-summary widget; age not shown per-day).
- **Safety:** `saveDayEntries` hardened before the day-write changes land; `dayJsToRow` keeps legacy day columns populated so no NOT-NULL/wipe risk and no days-table schema change.
