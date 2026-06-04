# Lazy Macros — Android App (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing vanilla-JS calorie/macro tracker into an installable Android `.aab` (Capacitor) with phone-friendly card layouts, a bottom tab bar, and a simplified diet-assessment scorecard — all from one responsive codebase that still works on desktop.

**Architecture:** Capacitor wraps the existing web assets (moved into `www/`) in a native Android shell. The same HTML/CSS/JS serves desktop (tables) and mobile (cards), switched by CSS breakpoints + `matchMedia`. New, isolated, testable logic for the simplified assessment lives in `www/assessment-view.js` (UMD: works as a browser global and as a Node module for unit tests). New mobile renderers live in `www/mobile-render.js`. The rich dual-AI assessment is unchanged — only its mobile presentation is simplified.

**Tech Stack:** Vanilla JS (ES2015, classic `<script>` globals — no bundler), Capacitor 6 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/assets`), Supabase JS v2 (vendored locally), Node's built-in `node:test` runner, Android Studio + SDK + JDK.

**Spec:** `docs/superpowers/specs/2026-06-04-lazy-macros-android-design.md`

---

## File Structure

**Created:**
- `www/` — web root (Capacitor `webDir`); holds the moved app files
- `www/vendor/supabase.min.js` — vendored Supabase JS (replaces CDN `<script>`)
- `www/assessment-view.js` — pure functions that turn assessment data into the mobile scorecard view-model (UMD export for tests)
- `www/mobile-render.js` — mobile card/scorecard renderers + `matchMedia` wiring
- `capacitor.config.json` — Capacitor config (appId, appName, webDir)
- `package.json` — npm scripts + dev deps (Capacitor, test runner)
- `tests/assessment-view.test.js` — unit tests for `assessment-view.js`
- `assets/logo.svg` — source logo for icon/splash generation
- `BUILD.md` — how to run, rebuild, and produce a signed `.aab`
- `android/` — generated native project (created by `npx cap add android`)

**Moved (via `git mv`):**
- `index.html` → `www/index.html`
- `app.js` → `www/app.js`
- `styles.css` → `www/styles.css`

**Modified:**
- `www/index.html` — vendored Supabase tag, new script tags, mobile nav + mobile containers
- `www/app.js` — unified tab activation, responsive re-render hooks, mobile branch in `renderAssessmentResults`
- `www/styles.css` — responsive breakpoint, bottom-nav, card, scorecard, accordion styles

**Untouched:** `finance/` (separate app), `Calorie and Activity Tracker.html` (legacy export).

---

## Conventions used in this plan

- The repo root is `C:\Users\rober\Desktop\Nutrition Tracker`. All paths are relative to it.
- Work happens on the existing branch `lazy-macros-android`.
- "Mobile" = viewport width ≤ 720px. The single source of truth is `window.matchMedia("(max-width: 720px)")`.
- Commit after every task. Use the message shown in each task's final step.
- UI/native tasks are verified by observation (browser at phone width + Android emulator), since this project has no UI-test harness and adding one is out of scope. Pure logic (Task 9) uses real automated tests.

---

## Task 1: Restructure into `www/` and vendor Supabase

**Files:**
- Move: `index.html` → `www/index.html`, `app.js` → `www/app.js`, `styles.css` → `www/styles.css`
- Create: `www/vendor/supabase.min.js`
- Modify: `www/index.html` (Supabase script tag)

- [ ] **Step 1: Create folders and move the three web files (preserving history)**

```bash
mkdir -p www/vendor
git mv index.html www/index.html
git mv app.js www/app.js
git mv styles.css www/styles.css
```

- [ ] **Step 2: Vendor the Supabase library locally**

```bash
curl -L "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js" -o www/vendor/supabase.min.js
```

Verify the file is non-empty JS (not an HTML error page):

```bash
head -c 80 www/vendor/supabase.min.js
```
Expected: minified JS beginning (e.g. `!function(`...), NOT `<!DOCTYPE`.

- [ ] **Step 3: Point index.html at the vendored copy**

In `www/index.html`, replace the CDN script line:

```html
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
```
with:
```html
  <script src="vendor/supabase.min.js"></script>
```

(The `<link rel="stylesheet" href="styles.css">` and `<script src="app.js">` lines stay as-is — they remain correct because all files are siblings inside `www/`.)

- [ ] **Step 4: Verify the app still runs in a plain browser**

```bash
npx --yes http-server www -p 8080 -c-1
```
Open `http://localhost:8080`. Expected: the app loads exactly as before (Food Eaten tab visible, data loads). Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Move web app into www/ and vendor Supabase JS locally"
```

---

## Task 2: Initialize Capacitor and add the Android platform

**Files:**
- Create: `package.json`, `capacitor.config.json`, `android/` (generated)

- [ ] **Step 1: Initialize npm and install Capacitor**

```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/status-bar @capacitor/splash-screen
```

- [ ] **Step 2: Create `capacitor.config.json`**

```json
{
  "appId": "com.lazymacros.app",
  "appName": "Lazy Macros",
  "webDir": "www",
  "server": {
    "androidScheme": "https"
  },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 800,
      "backgroundColor": "#16324f",
      "showSpinner": false
    }
  }
}
```

- [ ] **Step 3: Add the Android platform**

```bash
npx cap add android
npx cap sync android
```
Expected: an `android/` directory is created and `sync` finishes with "Sync finished".

- [ ] **Step 4: Boot the app in the Android emulator**

Start an emulator (Android Studio → Device Manager → ▶), then:

```bash
npx cap run android
```
Expected: the app launches in the emulator and shows the current UI (Food Eaten tab, top tabs). Data may require the emulator to have network; the app shell must render regardless.

- [ ] **Step 5: Ignore generated/build artifacts**

Append to `.gitignore`:
```
node_modules/
android/app/build/
android/build/
android/.gradle/
android/local.properties
android/app/release/
*.keystore
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add Capacitor + Android platform (com.lazymacros.app)"
```

---

## Task 3: Set up the unit-test runner

**Files:**
- Modify: `package.json`
- Create: `tests/` (folder; first test added in Task 9)

- [ ] **Step 1: Add a test script using Node's built-in runner**

In `package.json`, add to the `"scripts"` object:
```json
    "test": "node --test"
```

- [ ] **Step 2: Add a temporary smoke test to prove the runner works**

Create `tests/smoke.test.js`:
```js
const { test } = require("node:test");
const assert = require("node:assert");

test("test runner works", () => {
  assert.strictEqual(1 + 1, 2);
});
```

- [ ] **Step 3: Run the tests**

```bash
npm test
```
Expected: output shows `tests 1` / `pass 1` / `fail 0`.

- [ ] **Step 4: Remove the smoke test**

```bash
rm tests/smoke.test.js
```

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "Add node:test test runner script"
```

---

## Task 4: Responsive foundation (breakpoint + mobile detection)

**Files:**
- Modify: `www/styles.css` (top of file), `www/app.js`

- [ ] **Step 1: Add the mobile-detection helper and a re-render registry to app.js**

At the very top of `www/app.js` (before `const _cache`), add:
```js
// ---- Responsive helpers (Phase 1 mobile) ----
const MOBILE_MQ = window.matchMedia("(max-width: 720px)");
function isMobile() { return MOBILE_MQ.matches; }

// Re-render whatever is currently on screen when the breakpoint flips
// (desktop tables <-> mobile cards). Renderers register themselves here.
const _responsiveRenderers = [];
function onBreakpointChange(fn) { _responsiveRenderers.push(fn); }
MOBILE_MQ.addEventListener("change", () => {
  _responsiveRenderers.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
});
```

- [ ] **Step 2: Add the responsive scaffolding CSS**

At the END of `www/styles.css`, add:
```css
/* ============================================================
   PHASE 1 — MOBILE (<= 720px)
   ============================================================ */

/* Mobile-only / desktop-only visibility helpers */
.mobile-only { display: none; }
@media (max-width: 720px) {
  .desktop-only { display: none !important; }
  .mobile-only { display: block; }

  body { -webkit-text-size-adjust: 100%; }
  .app { padding: 0 0 72px 0; }          /* leave room for the bottom nav */
  .table-wrapper { display: none; }       /* hide wide tables on phones */
  .toolbar { flex-wrap: wrap; gap: 8px; padding: 12px; }
}
```

- [ ] **Step 3: Verify nothing changed on desktop and tables still show**

Reload `http://localhost:8080` at full width. Expected: identical to before (no visual change above 720px).

- [ ] **Step 4: Verify the hooks exist (console check)**

In the browser devtools console:
```js
isMobile()
```
Expected: `false` at desktop width; resize to a narrow window and re-run → `true`.

- [ ] **Step 5: Commit**

```bash
git add www/app.js www/styles.css
git commit -m "Add responsive breakpoint + mobile-detection helpers"
```

---

## Task 5: Bottom tab navigation (mobile)

**Files:**
- Modify: `www/index.html`, `www/app.js`, `www/styles.css`

- [ ] **Step 1: Add the bottom nav markup**

In `www/index.html`, immediately before the closing `</div>` of `<div class="app">` (just before the `<!-- FOOD MODAL -->` block is fine too, as long as it's inside `.app`), add:
```html
    <!-- MOBILE BOTTOM NAV -->
    <nav class="bottom-nav mobile-only">
      <button class="bottom-nav-item active" data-tab="food-eaten">
        <span class="bn-icon">&#127869;</span><span class="bn-label">Food</span>
      </button>
      <button class="bottom-nav-item" data-tab="calorie-tracker">
        <span class="bn-icon">&#128197;</span><span class="bn-label">Days</span>
      </button>
      <button class="bottom-nav-item" data-tab="calorie-target">
        <span class="bn-icon">&#127919;</span><span class="bn-label">Targets</span>
      </button>
      <button class="bottom-nav-item" data-tab="diet-assessment">
        <span class="bn-icon">&#128202;</span><span class="bn-label">Assess</span>
      </button>
    </nav>
```

- [ ] **Step 2: Add bottom-nav styles**

At the end of `www/styles.css`, add:
```css
.bottom-nav {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
  display: none; justify-content: space-around; align-items: stretch;  /* hidden by default; shown only in the mobile media query below */
  background: var(--surface, #16324f);
  border-top: 1px solid rgba(255,255,255,.12);
  padding: 4px 0; padding-bottom: env(safe-area-inset-bottom, 4px);
}
.bottom-nav-item {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: none; border: none; color: rgba(255,255,255,.65);
  font-size: 11px; padding: 6px 0; cursor: pointer;
}
.bottom-nav-item .bn-icon { font-size: 20px; line-height: 1; }
.bottom-nav-item.active { color: #fff; }
@media (max-width: 720px) {
  header .tabs { display: none; }   /* hide top tabs on mobile; bottom nav replaces them */
  .bottom-nav { display: flex; }    /* show the bottom bar only on mobile (overrides base display:none) */
}
```

- [ ] **Step 3: Replace the tab handler with a unified activator in app.js**

In `www/app.js`, find the `// Tab switching` block inside `DOMContentLoaded` (currently lines ~3852-3860):
```js
  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab).classList.add("active");
    });
  });
```
Replace it with:
```js
  // Tab switching (top tabs + bottom nav share one activator)
  document.querySelectorAll(".tab, .bottom-nav-item").forEach((el) => {
    el.addEventListener("click", () => activateTab(el.dataset.tab));
  });
```

- [ ] **Step 4: Add the `activateTab` function (top-level, not inside DOMContentLoaded)**

In `www/app.js`, just after the responsive helpers added in Task 4, add:
```js
function activateTab(tabId) {
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === tabId));
  document.querySelectorAll(".bottom-nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab-content").forEach((c) =>
    c.classList.toggle("active", c.id === tabId));
}
```

- [ ] **Step 5: Verify in browser at phone width**

Reload at narrow width (≤720px). Expected: top tabs hidden, a fixed bottom bar with Food/Days/Targets/Assess; tapping each switches sections and highlights the active item. At desktop width the bottom bar is hidden and top tabs work.

- [ ] **Step 6: Commit**

```bash
git add www/index.html www/app.js www/styles.css
git commit -m "Add mobile bottom tab navigation"
```

---

## Task 6: Food Eaten — mobile cards

**Files:**
- Modify: `www/index.html`, `www/app.js`, `www/styles.css`
- Create: `www/mobile-render.js`

- [ ] **Step 1: Add a mobile container + FAB to the Food Eaten section**

In `www/index.html`, inside `<section id="food-eaten" ...>`, immediately after the closing `</div>` of `.table-wrapper`, add:
```html
      <div id="food-cards" class="cards-list mobile-only"></div>
      <button id="food-fab" class="fab mobile-only" aria-label="Add food">&#43;</button>
```

- [ ] **Step 2: Create `www/mobile-render.js` with the food-card renderer**

```js
// Mobile renderers. Loaded after app.js; relies on app.js globals
// (loadFoodEntries, getDailyFoodTotals, formatDate, formatTime, escapeHtml,
//  renderNum, isMobile, editFood, deleteFood).

function renderFoodCards() {
  const host = document.getElementById("food-cards");
  if (!host) return;

  const filterDate = document.getElementById("food-date-filter")?.value;
  let entries = loadFoodEntries();
  if (filterDate) entries = entries.filter((f) => f.date === filterDate);
  entries.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.time < b.time ? -1 : 1)));

  const groups = {};
  entries.forEach((e) => { (groups[e.date] ||= []).push(e); });
  const dates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));

  let html = "";
  for (const date of dates) {
    const totals = getDailyFoodTotals(date, loadFoodEntries());
    html += `<div class="cards-day-header">
      <span>${formatDate(date)}</span>
      <span class="cards-day-total">${renderNum(totals.calLow, 0)}–${renderNum(totals.calHigh, 0)} cal</span>
    </div>`;
    for (const e of groups[date]) {
      html += `<div class="food-card" data-id="${e.id}">
        <div class="food-card-main">
          <div class="food-card-name">${escapeHtml(e.food)}</div>
          <div class="food-card-cal">${renderNum(e.calLow, 0)}–${renderNum(e.calHigh, 0)} cal</div>
        </div>
        <div class="food-card-sub">${formatTime(e.time)} · ${e.qty} ${escapeHtml(e.unit)}</div>
        <div class="food-card-row"><span>Protein</span><b>${renderNum(e.proLow, 0)}–${renderNum(e.proHigh, 0)} g</b></div>
        <button class="card-menu-btn" data-id="${e.id}" aria-label="Actions">&#8942;</button>
      </div>`;
    }
  }
  if (!entries.length) {
    html = `<div class="cards-empty">No food entries yet. Tap + to add one.</div>`;
  }
  host.innerHTML = html;

  // Tap card body to edit
  host.querySelectorAll(".food-card").forEach((card) => {
    card.addEventListener("click", (ev) => {
      if (ev.target.closest(".card-menu-btn")) return; // handled below
      editFood(Number(card.dataset.id));
    });
  });
  // Overflow menu = delete (Phase 1: edit on tap, delete here)
  host.querySelectorAll(".card-menu-btn").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = Number(btn.dataset.id);
      if (confirm("Delete this food entry?")) deleteFood(id);
    });
  });
}
```

- [ ] **Step 3: Load the new script and wire the FAB + responsive hook**

In `www/index.html`, add the script tag AFTER `app.js`:
```html
  <script src="app.js"></script>
  <script src="mobile-render.js"></script>
```

In `www/app.js`, at the END of `renderFoodTable()` (just before its closing `}`), add:
```js
  if (typeof renderFoodCards === "function") renderFoodCards();
```

In `www/app.js` `DOMContentLoaded`, find the food modal wiring (`add-food-btn`) and add directly below it:
```js
  document.getElementById("food-fab").addEventListener("click", () => openFoodModal(null));
  onBreakpointChange(renderFoodTable);
```

- [ ] **Step 4: Add the card + FAB styles**

At the end of `www/styles.css`:
```css
.cards-list { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.cards-day-header { display: flex; justify-content: space-between; align-items: baseline;
  font-weight: 700; margin-top: 6px; color: var(--text, #1f2933); }
.cards-day-total { font-size: 12px; color: var(--text-dim, #6b7480); }
.food-card { position: relative; background: var(--card-bg, #fff); border-radius: 12px;
  padding: 12px 40px 12px 14px; box-shadow: 0 1px 4px rgba(0,0,0,.10); cursor: pointer; }
.food-card-main { display: flex; justify-content: space-between; gap: 8px; }
.food-card-name { font-weight: 700; }
.food-card-cal { font-weight: 600; white-space: nowrap; }
.food-card-sub { color: var(--text-dim, #6b7480); font-size: 12px; margin: 2px 0 6px; }
.food-card-row { display: flex; justify-content: space-between; font-size: 13px; }
.card-menu-btn { position: absolute; top: 8px; right: 6px; background: none; border: none;
  font-size: 20px; color: var(--text-dim, #6b7480); padding: 4px 8px; cursor: pointer; }
.cards-empty { text-align: center; color: var(--text-dim, #6b7480); padding: 40px 16px; }
.fab { position: fixed; right: 16px; bottom: 84px; z-index: 60; width: 56px; height: 56px;
  border-radius: 50%; border: none; background: #2bb673; color: #fff; font-size: 28px;
  box-shadow: 0 4px 12px rgba(0,0,0,.3); cursor: pointer; }
```

- [ ] **Step 5: Verify in browser at phone width**

Reload narrow. On Food tab expect: stacked cards grouped by date with day calorie totals, a green ＋ FAB bottom-right. Tap a card → edit modal opens. Tap ⋮ → confirm → entry deletes and the list updates. Add via FAB works. At desktop width the table shows instead.

- [ ] **Step 6: Commit**

```bash
git add www/index.html www/app.js www/mobile-render.js www/styles.css
git commit -m "Add mobile card layout for Food Eaten"
```

---

## Task 7: Calorie Tracker — mobile daily summary cards (expandable)

**Files:**
- Modify: `www/index.html`, `www/app.js`, `www/mobile-render.js`, `www/styles.css`

- [ ] **Step 1: Add a mobile container to the Calorie Tracker section**

In `www/index.html`, inside `<section id="calorie-tracker" ...>`, immediately after the `.table-wrapper` closing `</div>`, add:
```html
      <div id="day-cards" class="cards-list mobile-only"></div>
```

- [ ] **Step 2: Add the day-card renderer to `www/mobile-render.js`**

Append:
```js
function renderDayCards() {
  const host = document.getElementById("day-cards");
  if (!host) return;

  const profile = loadProfile();
  const food = loadFoodEntries();
  const days = loadDayEntries().slice().sort((a, b) => (a.date < b.date ? 1 : -1));

  let html = "";
  for (const day of days) {
    const bmr = calcBMR(day.weight, profile.height, day.age);
    const tdee = calcTDEE(bmr, day.activity);
    const target = tdee - day.deficit;
    const t = getDailyFoodTotals(day.date, food);
    const overLow = t.calLow - target, overHigh = t.calHigh - target;
    html += `<div class="day-card">
      <button class="day-card-head" data-id="${day.id}">
        <span class="day-card-date">${formatDate(day.date)}</span>
        <span class="day-card-kcal">${renderNum(t.calLow, 0)}–${renderNum(t.calHigh, 0)} / ${renderNum(target, 0)} cal</span>
        <span class="day-card-caret">&#9656;</span>
      </button>
      <div class="day-card-body">
        <div class="food-card-row"><span>Weight</span><b>${day.weight} lb</b></div>
        <div class="food-card-row"><span>BMR / TDEE</span><b>${renderNum(bmr,0)} / ${renderNum(tdee,0)}</b></div>
        <div class="food-card-row"><span>Activity</span><b>${escapeHtml(day.activity)}</b></div>
        <div class="food-card-row"><span>Deficit / Target</span><b>${day.deficit} / ${renderNum(target,0)}</b></div>
        <div class="food-card-row"><span>Cal +/-</span><b class="${surplusClass(overLow)}">${renderNum(overLow,0)} … ${renderNum(overHigh,0)}</b></div>
        <div class="food-card-row"><span>Protein</span><b>${renderNum(t.proLow,0)}–${renderNum(t.proHigh,0)} g (target ${day.proteinTargetLow}–${day.proteinTargetHigh})</b></div>
        <div class="day-card-actions">
          <button class="btn btn-secondary btn-sm" data-edit="${day.id}">Edit</button>
          <button class="btn btn-secondary btn-sm" data-del="${day.id}">Delete</button>
        </div>
      </div>
    </div>`;
  }
  if (!days.length) html = `<div class="cards-empty">No daily entries yet. Use + Add Day.</div>`;
  host.innerHTML = html;

  host.querySelectorAll(".day-card-head").forEach((h) => {
    h.addEventListener("click", () => h.parentElement.classList.toggle("expanded"));
  });
  host.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => editDay(Number(b.dataset.edit))));
  host.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => { if (confirm("Delete this day?")) deleteDay(Number(b.dataset.del)); }));
}
```

- [ ] **Step 3: Wire the renderer + add-day FAB-equivalent + responsive hook**

In `www/app.js`, at the END of `renderCalorieTracker()` (before its closing `}`), add:
```js
  if (typeof renderDayCards === "function") renderDayCards();
```
In `www/app.js` `DOMContentLoaded`, below the day-modal wiring (`add-day-btn`), add:
```js
  onBreakpointChange(renderCalorieTracker);
```
(The existing "+ Add Day" toolbar button remains visible on mobile via the `.toolbar`; no new FAB needed for this tab.)

- [ ] **Step 4: Add day-card styles**

At the end of `www/styles.css`:
```css
.day-card { background: var(--card-bg, #fff); border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.10); overflow: hidden; }
.day-card-head { width: 100%; display: flex; align-items: center; gap: 8px; background: none; border: none;
  padding: 12px 14px; cursor: pointer; text-align: left; }
.day-card-date { font-weight: 700; }
.day-card-kcal { margin-left: auto; font-size: 13px; color: var(--text-dim, #6b7480); }
.day-card-caret { transition: transform .15s; }
.day-card.expanded .day-card-caret { transform: rotate(90deg); }
.day-card-body { display: none; padding: 0 14px 12px; }
.day-card.expanded .day-card-body { display: block; }
.day-card-actions { display: flex; gap: 8px; margin-top: 10px; }
```

- [ ] **Step 5: Verify in browser at phone width**

On the Days tab expect: one collapsed card per day showing date + "eaten / target cal". Tapping expands to show weight, BMR/TDEE, activity, deficit, cal +/-, protein, and Edit/Delete. Edit opens the day modal; Delete removes the day. Desktop still shows the full table.

- [ ] **Step 6: Commit**

```bash
git add www/index.html www/app.js www/mobile-render.js www/styles.css
git commit -m "Add mobile expandable day cards for Calorie Tracker"
```

---

## Task 8: Calorie Target — mobile single-column + accordions

**Files:**
- Modify: `www/styles.css`

This tab is form/table content that only needs to reflow — no new renderer required.

- [ ] **Step 1: Add mobile reflow styles**

At the end of `www/styles.css`:
```css
@media (max-width: 720px) {
  #calorie-target .settings-grid { display: flex; flex-direction: column; gap: 14px; }
  #calorie-target .settings-card { width: 100%; }
  #calorie-target table { width: 100%; }
  #calorie-target .form-row { display: flex; flex-direction: column; align-items: stretch; }
  #calorie-target .form-row label { margin-bottom: 4px; }
  #calorie-target input,
  #calorie-target select,
  #calorie-target .btn { min-height: 44px; font-size: 16px; }  /* 16px avoids iOS/Android zoom; 44px tap target */
}
```

- [ ] **Step 2: Make the provider & validation settings collapsible on mobile**

`renderProviderSettings()` renders into `#provider-settings`. Wrap its content in a `<details>` on mobile via CSS-free markup is intrusive; instead add a CSS-only accordion using existing structure. At the end of `www/styles.css`:
```css
@media (max-width: 720px) {
  #provider-settings, #validation-settings { border: 1px solid var(--border, #d8dbe0); border-radius: 10px; }
  #provider-settings > *:first-child, #validation-settings > *:first-child { padding: 12px; }
}
```
(Full disclosure widgets are deferred; this keeps the dense settings visually contained on mobile without touching the JS renderers.)

- [ ] **Step 3: Verify in browser at phone width**

On the Targets tab expect: the three settings cards stack vertically, full width; inputs are large/tappable; the activity & goals tables fit; provider/validation blocks are visually contained. Desktop grid layout is unchanged.

- [ ] **Step 4: Commit**

```bash
git add www/styles.css
git commit -m "Reflow Calorie Target tab for mobile (single column, large taps)"
```

---

## Task 9: Assessment view-model (pure functions, TDD)

**Files:**
- Create: `www/assessment-view.js`, `tests/assessment-view.test.js`

The assessment data object (from `providerResult.data`) has this shape (subset we use):
```
{
  overall_score: number,
  calorie_assessment: { status: "deficit"|"on_target"|"surplus" },
  protein_assessment: { status: "deficient"|"adequate"|"good"|"excellent" },
  food_groups: { fruits:{status}, vegetables:{status}, whole_grains:{status},
                 lean_protein:{status}, dairy_calcium:{status}, healthy_fats:{status} },
  suggestions: [ { food, reason, when } ],
  action_plan: { stop_and_replace: [ { stop, why, replace_with } ] },
  reasoning: string
}
```
Status vocab for food groups: `missing | critically_low | low | adequate | good`.

- [ ] **Step 1: Write the failing tests**

Create `tests/assessment-view.test.js`:
```js
const { test } = require("node:test");
const assert = require("node:assert");
const AV = require("../www/assessment-view.js");

test("verdictLine maps score bands", () => {
  assert.strictEqual(AV.verdictLine(9.2), "Excellent week");
  assert.strictEqual(AV.verdictLine(7.5), "Solid week — a few gaps");
  assert.strictEqual(AV.verdictLine(6), "Decent — room to improve");
  assert.strictEqual(AV.verdictLine(4.5), "Needs work");
  assert.strictEqual(AV.verdictLine(2), "Rough week — let's reset");
});

test("calorieChip maps status to label + tone", () => {
  assert.deepStrictEqual(AV.calorieChip("on_target"), { label: "Calories on target", tone: "ok" });
  assert.deepStrictEqual(AV.calorieChip("surplus"), { label: "Calorie surplus", tone: "bad" });
  assert.deepStrictEqual(AV.calorieChip("deficit"), { label: "Under target", tone: "warn" });
});

test("proteinChip maps status to label + tone", () => {
  assert.deepStrictEqual(AV.proteinChip("excellent"), { label: "Protein excellent", tone: "ok" });
  assert.deepStrictEqual(AV.proteinChip("good"), { label: "Protein good", tone: "ok" });
  assert.deepStrictEqual(AV.proteinChip("adequate"), { label: "Protein adequate", tone: "warn" });
  assert.deepStrictEqual(AV.proteinChip("deficient"), { label: "Protein low", tone: "bad" });
});

test("varietyChip averages food-group statuses", () => {
  const allGood = { food_groups: { a:{status:"good"}, b:{status:"good"} } };
  assert.deepStrictEqual(AV.varietyChip(allGood), { label: "Great variety", tone: "ok" });
  const mixed = { food_groups: { a:{status:"good"}, b:{status:"low"}, c:{status:"missing"} } };
  assert.deepStrictEqual(AV.varietyChip(mixed), { label: "Low variety", tone: "bad" });
  const okish = { food_groups: { a:{status:"adequate"}, b:{status:"adequate"} } };
  assert.deepStrictEqual(AV.varietyChip(okish), { label: "Decent variety", tone: "warn" });
});

test("topActions takes suggestions then stop_and_replace, max n", () => {
  const data = {
    suggestions: [
      { food: "Spinach", reason: "more folate", when: "lunch" },
      { food: "Sardines", reason: "omega-3", when: "dinner" },
    ],
    action_plan: { stop_and_replace: [ { stop: "Instant noodles", replace_with: "Brown rice", why: "additives" } ] },
  };
  const out = AV.topActions(data, 3);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out[0], { kind: "add", text: "Add Spinach — more folate" });
  assert.deepStrictEqual(out[2], { kind: "stop", text: "Swap Instant noodles → Brown rice" });
});

test("topActions handles missing fields gracefully", () => {
  assert.deepStrictEqual(AV.topActions({}, 3), []);
  assert.deepStrictEqual(AV.topActions(null, 3), []);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../www/assessment-view.js'`.

- [ ] **Step 3: Implement `www/assessment-view.js`**

```js
// Pure view-model helpers for the simplified mobile diet assessment.
// UMD: usable as a browser global (window.AssessmentView) and a Node module.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssessmentView = api;
})(typeof self !== "undefined" ? self : this, function () {
  function verdictLine(score) {
    if (score >= 9) return "Excellent week";
    if (score >= 7.5) return "Solid week — a few gaps";
    if (score >= 6) return "Decent — room to improve";
    if (score >= 4) return "Needs work";
    return "Rough week — let's reset";
  }

  function calorieChip(status) {
    if (status === "on_target") return { label: "Calories on target", tone: "ok" };
    if (status === "surplus") return { label: "Calorie surplus", tone: "bad" };
    return { label: "Under target", tone: "warn" }; // deficit / unknown
  }

  function proteinChip(status) {
    if (status === "excellent") return { label: "Protein excellent", tone: "ok" };
    if (status === "good") return { label: "Protein good", tone: "ok" };
    if (status === "adequate") return { label: "Protein adequate", tone: "warn" };
    return { label: "Protein low", tone: "bad" }; // deficient / unknown
  }

  const _STATUS_SCORE = { good: 3, adequate: 2, low: 1, critically_low: 0.5, missing: 0 };

  function varietyChip(data) {
    const groups = (data && data.food_groups) || {};
    const vals = Object.values(groups).map((g) => _STATUS_SCORE[g && g.status] ?? 1);
    if (!vals.length) return { label: "Low variety", tone: "bad" };
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg >= 2.5) return { label: "Great variety", tone: "ok" };
    if (avg >= 1.5) return { label: "Decent variety", tone: "warn" };
    return { label: "Low variety", tone: "bad" };
  }

  function topActions(data, n) {
    if (!data) return [];
    const out = [];
    for (const s of data.suggestions || []) {
      if (s && s.food) out.push({ kind: "add", text: `Add ${s.food}${s.reason ? " — " + s.reason : ""}` });
    }
    const sr = (data.action_plan && data.action_plan.stop_and_replace) || [];
    for (const r of sr) {
      if (r && r.stop) out.push({ kind: "stop", text: `Swap ${r.stop}${r.replace_with ? " → " + r.replace_with : ""}` });
    }
    return out.slice(0, n || 3);
  }

  return { verdictLine, calorieChip, proteinChip, varietyChip, topActions };
});
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npm test
```
Expected: `pass 6` / `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add www/assessment-view.js tests/assessment-view.test.js
git commit -m "Add tested view-model for simplified mobile assessment"
```

---

## Task 10: Assessment — mobile scorecard render + hide AI machinery

**Files:**
- Modify: `www/index.html`, `www/app.js`, `www/mobile-render.js`, `www/styles.css`

- [ ] **Step 1: Load assessment-view.js before mobile-render.js**

In `www/index.html`, update the script tags so the order is:
```html
  <script src="app.js"></script>
  <script src="assessment-view.js"></script>
  <script src="mobile-render.js"></script>
```

- [ ] **Step 2: Add the scorecard renderer to `www/mobile-render.js`**

Append:
```js
// Renders the simplified mobile scorecard from the best available assessment data.
// `data` is a single provider's assessment object (result.round2[0].data or round1[0].data).
function renderAssessmentScorecard(data, fullResult) {
  const container = document.getElementById("assessment-results");
  if (!container || !data) return;
  const AV = window.AssessmentView;
  if (!AV) { container.innerHTML = '<p style="padding:16px;color:var(--text-dim)">Scorecard unavailable — assessment view module failed to load.</p>'; return; }

  const score = Number(data.overall_score) || 0;
  const pct = Math.max(0, Math.min(100, Math.round((score / 10) * 100)));
  const chips = [
    AV.calorieChip(data.calorie_assessment && data.calorie_assessment.status),
    AV.proteinChip(data.protein_assessment && data.protein_assessment.status),
    AV.varietyChip(data),
  ];
  const actions = AV.topActions(data, 3);

  let html = `<div class="score-card">
    <div class="score-ring" style="--pct:${pct}">
      <div class="score-ring-inner"><span class="score-num">${score}</span><span class="score-den">/10</span></div>
    </div>
    <div class="score-verdict">${escapeHtml(AV.verdictLine(score))}</div>
    <div class="score-chips">
      ${chips.map((c) => `<span class="chip chip-${c.tone}">${escapeHtml(c.label)}</span>`).join("")}
    </div>`;

  if (actions.length) {
    html += `<div class="score-section-label">Do this week</div>
      <div class="score-actions">
        ${actions.map((a) => `<div class="score-action">${escapeHtml(a.text)}</div>`).join("")}
      </div>`;
  }

  // Progressive disclosure — reuse existing detailed renderers inside <details>.
  html += `<details class="score-drill"><summary>Food groups</summary><div class="score-drill-body" id="drill-groups"></div></details>`;
  html += `<details class="score-drill"><summary>Full grocery &amp; sourcing plan</summary><div class="score-drill-body" id="drill-plan"></div></details>`;
  html += `<details class="score-drill"><summary>Why this score</summary><div class="score-drill-body">${escapeHtml(data.reasoning || "")}</div></details>`;
  container.innerHTML = html;

  // Populate drill-downs with the EXISTING desktop renderers (DRY).
  const groupsHost = document.getElementById("drill-groups");
  if (groupsHost && typeof renderFoodGroupsBlock === "function") {
    groupsHost.innerHTML = renderFoodGroupsBlock(data); // optional helper; see Step 3 fallback
  } else if (groupsHost) {
    groupsHost.innerHTML = Object.entries(data.food_groups || {})
      .map(([k, v]) => `<div class="food-card-row"><span>${escapeHtml(k.replace(/_/g, " "))}</span><b>${escapeHtml((v && v.status) || "")}</b></div>`)
      .join("");
  }
  const planHost = document.getElementById("drill-plan");
  if (planHost && typeof renderActionPlan === "function") {
    planHost.innerHTML = renderActionPlan(data);
  }
}
```

- [ ] **Step 3: Branch `renderAssessmentResults` to use the scorecard on mobile**

In `www/app.js`, at the very top of `renderAssessmentResults(result)` (right after `if (!container) return;`), add:
```js
  if (isMobile()) {
    const best = (result.round2 && result.round2[0] && result.round2[0].data)
      || (result.round1 && result.round1[0] && result.round1[0].data)
      || null;
    if (best && typeof renderAssessmentScorecard === "function") { renderAssessmentScorecard(best, result); return; }
  }
```
This makes mobile skip the dual-provider comparison, Round 1/Round 2 labels, and agreement summaries entirely — the AI machinery becomes invisible. Desktop falls through to the existing detailed render.

- [ ] **Step 4: Re-render assessment on breakpoint change (if a result is shown)**

In `www/app.js` `DOMContentLoaded`, after the assessment wiring, add:
```js
  onBreakpointChange(() => {
    // Re-render the last viewed assessment, if any, so layout matches the new width.
    const last = loadAssessments()[0];
    if (last && document.getElementById("assessment-results").children.length) {
      renderAssessmentResults(last);
    }
  });
```

- [ ] **Step 5: Add scorecard styles**

At the end of `www/styles.css`:
```css
.score-card { padding: 16px; display: flex; flex-direction: column; gap: 12px; align-items: stretch; }
.score-ring { width: 110px; height: 110px; border-radius: 50%; margin: 4px auto 0;
  background: conic-gradient(#2bb673 calc(var(--pct) * 1%), var(--border, #2e3345) 0);
  display: flex; align-items: center; justify-content: center; }
.score-ring-inner { width: 84px; height: 84px; border-radius: 50%; background: var(--card-bg,#fff);
  display: flex; flex-direction: column; align-items: center; justify-content: center; }
.score-num { font-size: 28px; font-weight: 800; line-height: 1; }
.score-den { font-size: 11px; color: var(--text-dim,#6b7480); }
.score-verdict { text-align: center; font-weight: 700; }
.score-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.chip { padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
.chip-ok { background: #d8f3e3; color: #1c7a4a; }
.chip-warn { background: #fde8c8; color: #9a6212; }
.chip-bad { background: #fbd9d9; color: #a32626; }
.score-section-label { font-size: 12px; text-transform: uppercase; letter-spacing: .04em;
  color: var(--text-dim,#6b7480); margin-top: 4px; }
.score-actions { display: flex; flex-direction: column; gap: 8px; }
.score-action { background: var(--card-bg,#fff); border-radius: 10px; padding: 11px 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.score-drill { background: var(--card-bg,#fff); border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.score-drill > summary { padding: 12px 14px; font-weight: 600; cursor: pointer; list-style: none; }
.score-drill > summary::after { content: "▼"; float: right; color: var(--text-dim,#6b7480); font-size: 11px; }
.score-drill[open] > summary::after { content: "▲"; }
.score-drill-body { padding: 0 14px 14px; }
```

- [ ] **Step 6: Verify in browser at phone width**

Run an assessment (needs a configured AI key + some logged food). On mobile expect: a score ring, one-line verdict, three colored chips (Calories/Protein/Variety), a "Do this week" list of up to 3 actions, and three tap-to-expand sections (Food groups / Full grocery & sourcing plan / Why this score). Confirm NO "Round 1/Round 2", provider names, or agreement counts appear. Switch to desktop width and re-run (or resize) → the original detailed view returns.

- [ ] **Step 7: Commit**

```bash
git add www/index.html www/app.js www/mobile-render.js www/styles.css
git commit -m "Add simplified mobile assessment scorecard with drill-downs"
```

---

## Task 11: App identity — icon, splash, status bar, name

**Files:**
- Create: `assets/logo.svg`
- Modify: `www/app.js` (status bar init), `package.json` (assets dep), generated `android/` resources

- [ ] **Step 1: Create a source logo**

Create `assets/logo.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="180" fill="#16324f"/>
  <text x="512" y="470" font-family="Arial, sans-serif" font-size="300" font-weight="800"
        fill="#2bb673" text-anchor="middle">LM</text>
  <text x="512" y="700" font-family="Arial, sans-serif" font-size="120" font-weight="600"
        fill="#ffffff" text-anchor="middle">Lazy</text>
  <text x="512" y="830" font-family="Arial, sans-serif" font-size="120" font-weight="600"
        fill="#ffffff" text-anchor="middle">Macros</text>
</svg>
```
(Owner can later replace with a designed mark and re-run Step 3.)

- [ ] **Step 2: Install the assets generator**

```bash
npm install -D @capacitor/assets
```

- [ ] **Step 3: Generate Android icons + splash**

```bash
npx @capacitor/assets generate --android --iconBackgroundColor "#16324f" --splashBackgroundColor "#16324f"
```
Expected: it writes adaptive icons and splash images into `android/app/src/main/res/...`.

- [ ] **Step 4: Initialize the status bar color at startup**

In `www/index.html`, add the StatusBar plugin import. Since the app uses classic scripts (no bundler), use the global Capacitor plugin object. In `www/app.js`, at the very end of the `DOMContentLoaded` handler (after the initial renders), add:
```js
  // Native status bar styling (no-op in a plain browser)
  if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.StatusBar) {
    Capacitor.Plugins.StatusBar.setBackgroundColor({ color: "#16324f" }).catch(() => {});
    Capacitor.Plugins.StatusBar.setStyle({ style: "DARK" }).catch(() => {});
  }
```

- [ ] **Step 5: Confirm the app name**

Open `android/app/src/main/res/values/strings.xml` and confirm `app_name` is `Lazy Macros` (Capacitor sets this from `capacitor.config.json`). If not, set:
```xml
    <string name="app_name">Lazy Macros</string>
```

- [ ] **Step 6: Sync and verify on the emulator**

```bash
npx cap sync android
npx cap run android
```
Expected: launcher shows the "Lazy Macros" icon and name; the splash uses the navy background; the status bar is navy. The home screen / app drawer label reads "Lazy Macros".

- [ ] **Step 7: Commit**

```bash
git add assets/logo.svg package.json package-lock.json www/app.js android
git commit -m "Add Lazy Macros app icon, splash, status bar, and name"
```

---

## Task 12: Produce a signed `.aab` and document the build

**Files:**
- Create: `BUILD.md`
- Create (local only, gitignored): `lazy-macros-release.keystore`

- [ ] **Step 1: Generate an upload keystore**

```bash
keytool -genkey -v -keystore lazy-macros-release.keystore -alias lazymacros -keyalg RSA -keysize 2048 -validity 10000
```
Record the keystore password and key password somewhere safe (a password manager). **Losing this keystore means you can never update the app on Play.**

- [ ] **Step 2: Wire signing config**

Create `android/key.properties` (gitignored — add `android/key.properties` to `.gitignore`):
```
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=lazymacros
storeFile=../../lazy-macros-release.keystore
```
In `android/app/build.gradle`, inside `android { ... }`, add a signing config (place `signingConfigs` before `buildTypes`):
```gradle
    def keystoreProps = new Properties()
    def keystoreFile = rootProject.file("key.properties")
    if (keystoreFile.exists()) { keystoreProps.load(new FileInputStream(keystoreFile)) }

    signingConfigs {
        release {
            if (keystoreFile.exists()) {
                storeFile file(keystoreProps['storeFile'])
                storePassword keystoreProps['storePassword']
                keyAlias keystoreProps['keyAlias']
                keyPassword keystoreProps['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
```

- [ ] **Step 3: Build the release `.aab`**

```bash
npx cap sync android
cd android
./gradlew bundleRelease
cd ..
```
On Windows PowerShell use `.\gradlew.bat bundleRelease` from inside `android`.
Expected output file: `android/app/build/outputs/bundle/release/app-release.aab`.

- [ ] **Step 4: Verify the artifact exists**

```bash
ls -lh android/app/build/outputs/bundle/release/app-release.aab
```
Expected: a file a few MB in size.

- [ ] **Step 5: Write `BUILD.md`**

```markdown
# Lazy Macros — Build & Run

## Prerequisites
- Node.js LTS
- Android Studio + Android SDK (Platform-Tools, a recent SDK Platform, an emulator image)
- JDK 17 (bundled with recent Android Studio)

## Develop / run
- Web only: `npx http-server www -p 8080 -c-1` → http://localhost:8080
- Android (emulator or attached device): `npx cap run android`
- After changing files in `www/`: `npx cap sync android`

## Tests
- `npm test` (runs `node --test` over `tests/`)

## Release build (.aab for Play Console)
1. Ensure `lazy-macros-release.keystore` and `android/key.properties` exist (see plan Task 12).
2. `npx cap sync android`
3. `cd android && ./gradlew bundleRelease` (Windows: `.\gradlew.bat bundleRelease`)
4. Artifact: `android/app/build/outputs/bundle/release/app-release.aab`

## App identity
- Name: Lazy Macros · Package: com.lazymacros.app
- Icon/splash source: `assets/logo.svg` → regenerate with
  `npx @capacitor/assets generate --android --iconBackgroundColor "#16324f" --splashBackgroundColor "#16324f"`

## Keystore safety
The upload keystore is the ONLY way to publish updates. Back it up. Never commit it.
```

- [ ] **Step 6: Commit (docs only; keystore stays out of git)**

```bash
git add BUILD.md .gitignore
git commit -m "Document build/run and signed .aab release process"
```

---

## Task 13: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 2: Desktop regression check**

```bash
npx http-server www -p 8080 -c-1
```
At full width verify each tab is visually unchanged vs. before: Food Eaten table, Calorie Tracker table, Calorie Target grid, detailed Diet Assessment.

- [ ] **Step 3: Mobile web check (narrow window)**

At ≤720px verify: bottom nav switches tabs; Food cards (tap=edit, ⋮=delete, FAB=add); Day cards expand/collapse with edit/delete; Targets stacked & tappable; running an assessment shows the scorecard with drill-downs and NO AI-reconciliation machinery.

- [ ] **Step 4: Emulator end-to-end**

```bash
npx cap sync android && npx cap run android
```
In the emulator verify: app name/icon, splash, navy status bar; add a food entry (card appears); Supabase write succeeds when online; AI estimation works with a key entered in Settings; an assessment renders the scorecard.

- [ ] **Step 5: Confirm the release artifact builds**

Re-run Task 12 Step 3 if any web files changed since; confirm `app-release.aab` is produced.

- [ ] **Step 6: Final commit (if anything was adjusted)**

```bash
git add -A
git commit -m "Phase 1 verification fixes" || echo "nothing to commit"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §2 Capacitor packaging → Tasks 1, 2, 11, 12 ✓
- §4 single responsive codebase / vendored Supabase / `www/` restructure → Tasks 1, 4 ✓
- §5 bottom tab bar (mobile) / top tabs (desktop) → Task 5 ✓
- §6.1 Food cards (tap-edit, menu-delete, FAB) → Task 6 ✓
- §6.2 Calorie Tracker daily summary cards + expand → Task 7 ✓
- §6.3 Calorie Target single-column + accordions → Task 8 ✓
- §6.4 / §7 simplified assessment scorecard (Option A), AI machinery hidden, keep rich analysis underneath → Tasks 9, 10 ✓
- §8 AI keys stay in localStorage (no change) → no task needed (explicitly unchanged) ✓
- §10 testing & build, prerequisites → Tasks 3, 12, 13 + BUILD.md ✓
- §11 brand name/package id → Tasks 2, 11 ✓
- Non-goals (accounts, AI backend, billing, iOS, swipe-to-delete) → intentionally excluded ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; verification steps state expected output. The `renderFoodGroupsBlock` reference in Task 10 Step 2 is guarded by `typeof ... === "function"` with an inline fallback that does not depend on it, so no undefined-symbol dependency exists.

**Type/name consistency:** `isMobile()`, `onBreakpointChange()`, `activateTab()`, `renderFoodCards()`, `renderDayCards()`, `renderAssessmentScorecard()`, and `window.AssessmentView` (`verdictLine`/`calorieChip`/`proteinChip`/`varietyChip`/`topActions`) are defined once and referenced consistently. Existing globals reused (`loadFoodEntries`, `getDailyFoodTotals`, `loadDayEntries`, `loadProfile`, `calcBMR`, `calcTDEE`, `surplusClass`, `formatDate`, `formatTime`, `escapeHtml`, `renderNum`, `editFood`, `deleteFood`, `editDay`, `deleteDay`, `openFoodModal`, `renderActionPlan`, `loadAssessments`) match `app.js`.
