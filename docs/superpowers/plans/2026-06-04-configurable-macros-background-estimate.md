# Configurable Macros + Background Auto-Estimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure which macros to track, auto-estimate blank macros in the background on Save, and hide the AI reasoning everywhere.

**Architecture:** A new pure UMD module `www/macros.js` (`window.Macros`, Node-testable like `assessment-view.js`) owns the macro catalog, the `{low,high}` data model, migration of legacy entries, display formatting, and the pure AI-aggregation helpers. `www/app.js` wires it into settings, the food modal, a small background estimation queue, the AI prompt/parse layer, and the table/day-total readers. `www/mobile-render.js` renders cards from the same model. The reasoning UI is deleted.

**Tech Stack:** Vanilla JS (no framework), UMD modules, Node built-in test runner (`node --test`), Supabase + localStorage data layer, Capacitor for Android.

**Reference spec:** `docs/superpowers/specs/2026-06-04-configurable-macros-background-estimate-design.md`

**Conventions:**
- Commit after each task. Branch first (not on `main`): `git checkout -b feat/configurable-macros`.
- Run unit tests with `npm test`.
- Behavioral checks on the Android emulator use the WebView DevTools recipe in project memory (forward `webview_devtools_remote_<PID>` → `Runtime.evaluate`).
- Internal macro value is **always** `{ low, high }`. Single-value display = rounded midpoint.

---

## Phase 1 — `www/macros.js` pure module (TDD)

**Files:**
- Create: `www/macros.js`
- Test: `tests/macros.test.js`

The module exposes `window.Macros` / `module.exports` via the same UMD wrapper as `assessment-view.js`.

### Task 1.1: Catalog + enabled resolution

- [ ] **Step 1: Write the failing test** — `tests/macros.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const M = require("../www/macros.js");

test("CATALOG has core macros locked and carbs/fat default-on", () => {
  const cal = M.byId("calories");
  assert.equal(cal.locked, true);
  assert.equal(cal.unit, "kcal");
  assert.equal(M.byId("protein").locked, true);
  assert.equal(M.byId("carbs").defaultOn, true);
  assert.equal(M.byId("fat").defaultOn, true);
  assert.equal(M.byId("sodium").unit, "mg");
  assert.equal(M.byId("sodium").defaultOn, false);
});

test("defaultEnabled is calories, protein, carbs, fat", () => {
  assert.deepEqual(M.defaultEnabled(), ["calories", "protein", "carbs", "fat"]);
});

test("resolveEnabled always includes locked macros, drops unknowns, orders by catalog", () => {
  assert.deepEqual(M.resolveEnabled(["fat", "sugar"]), ["calories", "protein", "fat", "sugar"]);
  assert.deepEqual(M.resolveEnabled(["bogus"]), ["calories", "protein"]);
  assert.deepEqual(M.resolveEnabled(null), M.defaultEnabled());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../www/macros.js'`.

- [ ] **Step 3: Write minimal implementation** — `www/macros.js`

```js
// Pure macro catalog + data-model helpers.
// UMD: usable as a browser global (window.Macros) and a Node module.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Macros = api;
})(typeof self !== "undefined" ? self : this, function () {
  const CATALOG = [
    { id: "calories", label: "Calories", unit: "kcal", locked: true, defaultOn: true },
    { id: "protein", label: "Protein", unit: "g", locked: true, defaultOn: true },
    { id: "carbs", label: "Carbs", unit: "g", locked: false, defaultOn: true },
    { id: "fat", label: "Fat", unit: "g", locked: false, defaultOn: true },
    { id: "fiber", label: "Fiber", unit: "g", locked: false, defaultOn: false },
    { id: "sugar", label: "Sugar", unit: "g", locked: false, defaultOn: false },
    { id: "saturatedFat", label: "Saturated fat", unit: "g", locked: false, defaultOn: false },
    { id: "sodium", label: "Sodium", unit: "mg", locked: false, defaultOn: false },
  ];
  const byId = (id) => CATALOG.find((m) => m.id === id);
  const defaultEnabled = () => CATALOG.filter((m) => m.defaultOn).map((m) => m.id);

  function resolveEnabled(stored) {
    if (!Array.isArray(stored)) return defaultEnabled();
    const set = new Set(stored.filter((id) => byId(id)));
    CATALOG.forEach((m) => { if (m.locked) set.add(m.id); });
    return CATALOG.filter((m) => set.has(m.id)).map((m) => m.id); // catalog order
  }

  return { CATALOG, byId, defaultEnabled, resolveEnabled };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (existing 6 assessment-view tests still pass too).

- [ ] **Step 5: Commit**

```bash
git add www/macros.js tests/macros.test.js
git commit -m "feat(macros): add catalog and enabled-set resolution"
```

### Task 1.2: Value helpers — getMacro/setMacro/midpoint/formatMacro

- [ ] **Step 1: Write the failing test** (append to `tests/macros.test.js`)

```js
test("getMacro returns {low,high} or null", () => {
  const e = { macros: { calories: { low: 100, high: 120 } } };
  assert.deepEqual(M.getMacro(e, "calories"), { low: 100, high: 120 });
  assert.equal(M.getMacro(e, "carbs"), null);
  assert.equal(M.getMacro({}, "calories"), null);
});

test("setMacro writes into macros map", () => {
  const e = {};
  M.setMacro(e, "carbs", 30, 35);
  assert.deepEqual(e.macros.carbs, { low: 30, high: 35 });
});

test("midpoint rounds to 1 decimal", () => {
  assert.equal(M.midpoint({ low: 100, high: 121 }), 110.5);
  assert.equal(M.midpoint(null), null);
});

test("formatMacro: single shows midpoint, range shows low–high (collapsed when equal)", () => {
  assert.equal(M.formatMacro({ low: 100, high: 120 }, "single"), "110");
  assert.equal(M.formatMacro({ low: 100, high: 120 }, "range"), "100–120");
  assert.equal(M.formatMacro({ low: 50, high: 50 }, "range"), "50");
  assert.equal(M.formatMacro(null, "single"), "—");
});
```

- [ ] **Step 2: Run to verify fail.** Run: `npm test` → FAIL (`getMacro is not a function`).

- [ ] **Step 3: Implement** (add inside the factory, before `return`; extend the returned object)

```js
  function getMacro(entry, id) {
    const m = entry && entry.macros && entry.macros[id];
    if (!m || m.low == null || m.high == null) return null;
    return { low: m.low, high: m.high };
  }
  function setMacro(entry, id, low, high) {
    if (!entry.macros) entry.macros = {};
    entry.macros[id] = { low: Number(low), high: Number(high) };
  }
  const round1 = (n) => Math.round(n * 10) / 10;
  function midpoint(v) {
    if (!v || v.low == null || v.high == null) return null;
    return round1((Number(v.low) + Number(v.high)) / 2);
  }
  function fmtNum(n) { return String(round1(n)).replace(/\.0$/, ""); }
  function formatMacro(v, format) {
    if (!v || v.low == null || v.high == null) return "—";
    if (format === "range") {
      if (Number(v.low) === Number(v.high)) return fmtNum(v.low);
      return `${fmtNum(v.low)}–${fmtNum(v.high)}`;
    }
    return fmtNum(midpoint(v)); // single (default)
  }
```

Add to the returned object: `getMacro, setMacro, midpoint, formatMacro`.

- [ ] **Step 4: Run to verify pass.** Run: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add www/macros.js tests/macros.test.js
git commit -m "feat(macros): add value getters and single/range formatting"
```

### Task 1.3: Migration of legacy entries

- [ ] **Step 1: Write the failing test** (append)

```js
test("needsMigration true when legacy fields present and no macros", () => {
  assert.equal(M.needsMigration({ calLow: 1, calHigh: 2 }), true);
  assert.equal(M.needsMigration({ macros: {} }), false);
});

test("migrateEntry maps legacy cal/protein into macros and drops legacy fields + aiThoughtProcess", () => {
  const e = { id: 1, food: "x", calLow: 100, calHigh: 120, proLow: 5, proHigh: 7, aiThoughtProcess: { foo: 1 } };
  const out = M.migrateEntry(e);
  assert.deepEqual(out.macros.calories, { low: 100, high: 120 });
  assert.deepEqual(out.macros.protein, { low: 5, high: 7 });
  assert.equal("calLow" in out, false);
  assert.equal("aiThoughtProcess" in out, false);
});

test("migrateEntry leaves already-migrated entries untouched", () => {
  const e = { id: 2, macros: { calories: { low: 1, high: 1 } } };
  assert.deepEqual(M.migrateEntry(e), e);
});
```

- [ ] **Step 2: Run to verify fail.** `npm test` → FAIL.

- [ ] **Step 3: Implement**

```js
  function needsMigration(entry) {
    if (!entry) return false;
    if (entry.macros) return false;
    return ["calLow", "calHigh", "proLow", "proHigh"].some((k) => entry[k] != null);
  }
  function migrateEntry(entry) {
    if (!needsMigration(entry)) return entry;
    const out = { ...entry };
    out.macros = {};
    if (entry.calLow != null || entry.calHigh != null) out.macros.calories = { low: Number(entry.calLow) || 0, high: Number(entry.calHigh) || 0 };
    if (entry.proLow != null || entry.proHigh != null) out.macros.protein = { low: Number(entry.proLow) || 0, high: Number(entry.proHigh) || 0 };
    delete out.calLow; delete out.calHigh; delete out.proLow; delete out.proHigh;
    delete out.aiThoughtProcess;
    return out;
  }
```

Add to returned object: `needsMigration, migrateEntry`.

- [ ] **Step 4: Run to verify pass.** `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add www/macros.js tests/macros.test.js
git commit -m "feat(macros): migrate legacy cal/protein entries to macros map"
```

### Task 1.4: blankEnabled + sumMacro

- [ ] **Step 1: Write the failing test** (append)

```js
test("blankEnabled lists enabled macros with no value", () => {
  const e = { macros: { calories: { low: 100, high: 120 } } };
  assert.deepEqual(M.blankEnabled(e, ["calories", "protein", "carbs"]), ["protein", "carbs"]);
  assert.deepEqual(M.blankEnabled(e, ["calories"]), []);
});

test("sumMacro totals low/high across entries", () => {
  const entries = [
    { date: "d", macros: { carbs: { low: 10, high: 12 } } },
    { date: "d", macros: { carbs: { low: 5, high: 5 } } },
    { date: "d", macros: {} },
  ];
  assert.deepEqual(M.sumMacro(entries, "carbs"), { low: 15, high: 17 });
});
```

- [ ] **Step 2: Run to verify fail.** `npm test` → FAIL.

- [ ] **Step 3: Implement**

```js
  function blankEnabled(entry, enabled) {
    return (enabled || []).filter((id) => getMacro(entry, id) === null);
  }
  function sumMacro(entries, id) {
    return (entries || []).reduce((acc, e) => {
      const m = getMacro(e, id);
      if (m) { acc.low += Number(m.low) || 0; acc.high += Number(m.high) || 0; }
      return acc;
    }, { low: 0, high: 0 });
  }
```

Add to returned object: `blankEnabled, sumMacro`.

- [ ] **Step 4: Run to verify pass.** `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add www/macros.js tests/macros.test.js
git commit -m "feat(macros): add blankEnabled and sumMacro helpers"
```

### Task 1.5: AI prompt fields, parse, spread, average (dynamic over macro set)

- [ ] **Step 1: Write the failing test** (append)

```js
test("macroFields returns flat lower/upper field names", () => {
  assert.deepEqual(M.macroFields(["calories", "carbs"]),
    ["calories_lower", "calories_upper", "carbs_lower", "carbs_upper"]);
});

test("parseMacros builds {low,high} map, tolerates missing keys", () => {
  const parsed = { calories_lower: 100, calories_upper: 120, carbs_lower: 30, carbs_upper: 33 };
  assert.deepEqual(M.parseMacros(parsed, ["calories", "carbs", "fat"]), {
    calories: { low: 100, high: 120 },
    carbs: { low: 30, high: 33 },
  });
});

test("spread is worst per-field percent across estimates", () => {
  const a = { calories_lower: 100, calories_upper: 100 };
  const b = { calories_lower: 120, calories_upper: 120 };
  assert.ok(Math.abs(M.spread([a, b], ["calories"]) - 18.18) < 0.1);
});

test("averageEstimates averages each field to 1 decimal", () => {
  const a = { calories_lower: 100, calories_upper: 110 };
  const b = { calories_lower: 120, calories_upper: 130 };
  assert.deepEqual(M.averageEstimates([a, b], ["calories"]),
    { calories_lower: 110, calories_upper: 120 });
});

test("promptFields renders JSON lines for requested macros", () => {
  const s = M.promptFields(["calories", "sodium"]);
  assert.match(s, /"calories_lower"/);
  assert.match(s, /"sodium_upper"/);
});
```

- [ ] **Step 2: Run to verify fail.** `npm test` → FAIL.

- [ ] **Step 3: Implement**

```js
  function macroFields(ids) {
    return (ids || []).flatMap((id) => [`${id}_lower`, `${id}_upper`]);
  }
  function parseMacros(parsed, ids) {
    const out = {};
    (ids || []).forEach((id) => {
      const lo = parsed[`${id}_lower`], hi = parsed[`${id}_upper`];
      if (lo != null && hi != null) out[id] = { low: Number(lo), high: Number(hi) };
    });
    return out;
  }
  function spread(results, ids) {
    let worst = 0;
    for (const field of macroFields(ids)) {
      const vals = results.map((r) => r[field]).filter((v) => v != null);
      if (vals.length < 2) continue;
      const min = Math.min(...vals), max = Math.max(...vals);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (avg === 0) continue;
      const s = ((max - min) / avg) * 100;
      if (s > worst) worst = s;
    }
    return worst;
  }
  function averageEstimates(results, ids) {
    const n = results.length, out = {};
    for (const field of macroFields(ids)) {
      out[field] = round1(results.reduce((s, r) => s + (Number(r[field]) || 0), 0) / n);
    }
    return out;
  }
  function promptFields(ids) {
    return (ids || []).map((id) => `  "${id}_lower": <number>,\n  "${id}_upper": <number>`).join(",\n");
  }
```

Add to returned object: `macroFields, parseMacros, spread, averageEstimates, promptFields`.

- [ ] **Step 4: Run to verify pass.** `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add www/macros.js tests/macros.test.js
git commit -m "feat(macros): add dynamic AI prompt/parse/spread/average helpers"
```

---

## Phase 2 — Wire module in + settings storage + data-layer migration

**Files:**
- Modify: `www/index.html` (add `<script src="macros.js">` before `app.js`)
- Modify: `www/app.js` (settings helpers, row mappers, migration on load, generalize `getDailyFoodTotals`)
- **Supabase schema:** add `macros jsonb` + `estimate_status text` columns to `food_entries` (USER ACTION — Task 2.0)

### Task 2.0: Supabase schema migration (USER ACTION — run once)

`food_entries` stores fixed `cal_low/cal_high/pro_low/pro_high` columns. Configurable macros + the background-estimate status need two new columns so they survive reload-from-Supabase. The user runs this once in the Supabase SQL editor (the app's anon key cannot `ALTER TABLE`):

```sql
alter table food_entries add column if not exists macros jsonb;
alter table food_entries add column if not exists estimate_status text;
```

The mapper code in Task 2.2 tolerates these columns being absent on READ (falls back to legacy cal/pro columns), so nothing crashes before the SQL runs — but new macros/status only persist to Supabase after it is applied. localStorage persistence works regardless.

### Task 2.1: Load macros.js and add generic setting helpers

- [ ] **Step 1:** In `www/index.html`, add the script tag immediately **before** the `assessment-view.js`/`app.js` includes (so `window.Macros` exists when app.js runs). Find the existing script includes near the end of `<body>` and add:

```html
<script src="macros.js"></script>
```

- [ ] **Step 2:** In `www/app.js`, add generic settings helpers next to `getSpreadThreshold` (~line 1202). These DRY the `_cache.settings` + localStorage + Supabase pattern:

```js
function getSetting(key, fallback) {
  if (_cache.settings[key] != null) return _cache.settings[key];
  const ls = localStorage.getItem(`nt_${key}`);
  return ls != null ? ls : fallback;
}
function setSetting(key, value) {
  const v = String(value);
  _cache.settings[key] = v;
  localStorage.setItem(`nt_${key}`, v);
  bgWrite(async () => {
    const { error } = await sb.from("settings").upsert({ key, value: v });
    if (error) throw error;
  });
}
// Macro-tracking settings
function getEnabledMacros() {
  const raw = getSetting("macros_enabled", null);
  try { return Macros.resolveEnabled(raw ? JSON.parse(raw) : null); }
  catch { return Macros.defaultEnabled(); }
}
function setEnabledMacros(ids) { setSetting("macros_enabled", JSON.stringify(Macros.resolveEnabled(ids))); }
function getValueFormat() { return getSetting("value_format", "single") === "range" ? "range" : "single"; }
function setValueFormat(fmt) { setSetting("value_format", fmt === "range" ? "range" : "single"); }
function getEstimationMode() { return getSetting("estimation_mode", "reconcile") === "single" ? "single" : "reconcile"; }
function setEstimationMode(mode) { setSetting("estimation_mode", mode === "single" ? "single" : "reconcile"); }
```

- [ ] **Step 3: Verify (browser preview).** Run: `npx http-server www -p 8080 -c-1`, open `http://localhost:8080`, in console check `Macros.defaultEnabled()` returns the 4 ids and `getEnabledMacros()` works. Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add www/index.html www/app.js
git commit -m "feat: load macros module and add macro/format/estimation settings"
```

### Task 2.2: Migrate entries on load + generalize day totals

- [ ] **Step 1:** Update the row mappers so entries carry a `macros` map + `estimateStatus` (sourced from the new columns, with a legacy fallback), and migrate at every point `_cache.food` is populated. In `www/app.js`:

Replace `foodRowToJs` (line 34) and `foodJsToRow` (line 37):

```js
function foodRowToJs(r) {
  const base = { id: r.id, date: r.date, time: r.time, food: r.food, qty: Number(r.qty), unit: r.unit,
    estimateStatus: r.estimate_status || null };
  if (r.macros) { base.macros = r.macros; return base; }
  // legacy fallback: build macros from cal/pro columns
  base.calLow = Number(r.cal_low); base.calHigh = Number(r.cal_high);
  base.proLow = Number(r.pro_low); base.proHigh = Number(r.pro_high);
  return Macros.migrateEntry(base);
}
function foodJsToRow(e) {
  const cal = Macros.getMacro(e, "calories") || { low: null, high: null };
  const pro = Macros.getMacro(e, "protein") || { low: null, high: null };
  return { id: e.id, date: e.date, time: e.time, food: e.food, qty: e.qty, unit: e.unit,
    macros: e.macros || {}, estimate_status: e.estimateStatus || null,
    cal_low: cal.low, cal_high: cal.high, pro_low: pro.low, pro_high: pro.high, // keep legacy columns populated
    ai_thought_process: null };
}
```

`initFromSupabase` already maps via `foodRowToJs` (now migration-aware), so `_cache.food` is migrated at cloud load. Make the localStorage paths migrate too — rewrite `loadFoodEntries` (line 97) and add `.map(Macros.migrateEntry)` where `initFromLocalStorage` sets `_cache.food` from `JSON.parse(localStorage...)`:

```js
function loadFoodEntries() {
  if (_cache.ready && _cache.food) return _cache.food.map(Macros.migrateEntry);
  const saved = localStorage.getItem("nt_food");
  return saved ? JSON.parse(saved).map(Macros.migrateEntry) : [];
}
```

(`migrateEntry` returns the same object reference when already migrated, so this preserves the existing copy-returning semantics with negligible overhead.)

- [ ] **Step 2:** Generalize `getDailyFoodTotals` (line 443) to keep returning `calLow/calHigh/proLow/proHigh` (so existing callers still work) but source them from the macro map, and add a generic per-macro total:

```js
function getDailyFoodTotals(date, foodEntries) {
  const dayFoods = foodEntries.filter((f) => f.date === date);
  const cal = Macros.sumMacro(dayFoods, "calories");
  const pro = Macros.sumMacro(dayFoods, "protein");
  return {
    calLow: cal.low, calHigh: cal.high,
    proLow: pro.low, proHigh: pro.high,
    macro: (id) => Macros.sumMacro(dayFoods, id),
  };
}
```

- [ ] **Step 3: Verify (unit + emulator).** Run `npm test` (still green). Then on the emulator (DevTools `Runtime.evaluate`): `loadFoodEntries()[0].macros` shows `{calories:{low,high},protein:{...}}` and `getDailyFoodTotals(loadFoodEntries()[0].date, loadFoodEntries()).calLow` is a number. Expected: migrated shape, totals unchanged from before.

- [ ] **Step 4: Commit**

```bash
git add www/app.js
git commit -m "feat: migrate food entries to macro map on load; generalize day totals"
```

---

## Phase 3 — Settings UI ("Macros & estimation")

**Files:**
- Modify: `www/index.html` (settings container in Targets tab) — or render from JS
- Modify: `www/app.js` (`renderProviderSettings` area, ~line 1577, add a sibling renderer `renderMacroSettings`)
- Modify: `www/styles.css` (checkbox list styling)

### Task 3.1: Render the macro settings panel

- [ ] **Step 1:** Add a host element in the Targets/settings area of `www/index.html` (next to `#provider-settings`):

```html
<div id="macro-settings"></div>
```

- [ ] **Step 2:** In `www/app.js`, add `renderMacroSettings()` and call it wherever `renderProviderSettings()` is called (search for `renderProviderSettings(`):

```js
function renderMacroSettings() {
  const c = document.getElementById("macro-settings");
  if (!c) return;
  const enabled = new Set(getEnabledMacros());
  const fmt = getValueFormat();
  const mode = getEstimationMode();
  let html = '<div class="settings-card"><h2>Macros &amp; estimation</h2>';
  html += '<h3 class="provider-name">Macros to track</h3><div class="macro-toggle-list">';
  for (const m of Macros.CATALOG) {
    const checked = enabled.has(m.id) ? "checked" : "";
    const lock = m.locked ? "disabled" : "";
    html += `<label class="macro-toggle"><input type="checkbox" data-macro="${m.id}" ${checked} ${lock}> ${escapeHtml(m.label)} <span class="macro-unit">(${m.unit})</span></label>`;
  }
  html += "</div>";
  html += `<div class="form-row"><label>Value format</label><select id="set-value-format">
    <option value="single" ${fmt === "single" ? "selected" : ""}>Single value</option>
    <option value="range" ${fmt === "range" ? "selected" : ""}>Low–high range</option></select></div>`;
  html += `<div class="form-row"><label>Estimation</label><select id="set-estimation-mode">
    <option value="reconcile" ${mode === "reconcile" ? "selected" : ""}>Dual-AI cross-check (accurate)</option>
    <option value="single" ${mode === "single" ? "selected" : ""}>Single fast call</option></select></div>`;
  html += "</div>";
  c.innerHTML = html;

  c.querySelectorAll("input[data-macro]").forEach((cb) => cb.addEventListener("change", () => {
    const ids = [...c.querySelectorAll("input[data-macro]:checked")].map((x) => x.dataset.macro);
    setEnabledMacros(ids);
    renderFoodTable(); // refresh columns/cards
  }));
  c.querySelector("#set-value-format").addEventListener("change", (e) => { setValueFormat(e.target.value); renderFoodTable(); });
  c.querySelector("#set-estimation-mode").addEventListener("change", (e) => setEstimationMode(e.target.value));
}
```

- [ ] **Step 3:** Add CSS to `www/styles.css`:

```css
.macro-toggle-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.macro-toggle { display: flex; align-items: center; gap: 8px; font-size: .9rem; }
.macro-unit { color: var(--text-dim); font-size: .8rem; }
```

- [ ] **Step 4: Verify (emulator/browser).** Open the Targets tab → the panel lists all macros (Calories/Protein checked+disabled, Carbs/Fat checked), plus the two selects. Toggling Sodium updates settings (`getEnabledMacros()` includes `sodium`). Expected: persists across reload.

- [ ] **Step 5: Commit**

```bash
git add www/index.html www/app.js www/styles.css
git commit -m "feat: add Macros & estimation settings panel"
```

---

## Phase 4 — Food modal: dynamic macro fields, remove button + reasoning panel

**Files:**
- Modify: `www/index.html` (modal markup, lines 207–240: remove estimate button row, `#validation-results`, and the fixed cal/protein pairs; add a dynamic host)
- Modify: `www/app.js` (`openFoodModal`, `saveFood`)

### Task 4.1: Replace fixed fields with a dynamic macro host

- [ ] **Step 1:** In `www/index.html`, replace the block from the estimate-button row through the protein pair (current lines ~216–240) with:

```html
          <div id="food-macro-fields"></div>
          <p class="modal-hint">Leave macros blank — we'll estimate them automatically after you save.</p>
```

(Keep date/time/food/qty/unit rows above, and the `.modal-actions` Cancel/Save below.)

- [ ] **Step 2:** In `www/app.js`, add a renderer for the macro inputs and call it from `openFoodModal`:

```js
function renderFoodMacroFields(entry) {
  const host = document.getElementById("food-macro-fields");
  if (!host) return;
  const fmt = getValueFormat();
  let html = "";
  for (const id of getEnabledMacros()) {
    const m = Macros.byId(id);
    const v = entry ? Macros.getMacro(entry, id) : null;
    if (fmt === "range") {
      html += `<div class="form-row-pair">
        <div class="form-row"><label>${escapeHtml(m.label)} lower (${m.unit})</label>
          <input type="number" step="any" data-macro-low="${id}" value="${v ? v.low : ""}"></div>
        <div class="form-row"><label>${escapeHtml(m.label)} upper (${m.unit})</label>
          <input type="number" step="any" data-macro-high="${id}" value="${v ? v.high : ""}"></div>
      </div>`;
    } else {
      html += `<div class="form-row"><label>${escapeHtml(m.label)} (${m.unit})</label>
        <input type="number" step="any" data-macro-single="${id}" value="${v != null ? Macros.midpoint(v) : ""}"></div>`;
    }
  }
  host.innerHTML = html;
}
```

- [ ] **Step 3:** In `openFoodModal` (line 641), delete the per-field population for cal/protein and the `_lastValidationData`/`renderValidationResults` blocks; replace with:

```js
function openFoodModal(entry) {
  const modal = document.getElementById("food-modal");
  document.getElementById("food-modal-title").textContent = entry ? "Edit Food Entry" : "Add Food Entry";
  document.getElementById("food-id").value = entry ? entry.id : "";
  document.getElementById("food-date").value = entry ? entry.date : new Date().toISOString().slice(0, 10);
  document.getElementById("food-time").value = entry ? entry.time
    : new Date().toTimeString().slice(0, 5);
  document.getElementById("food-name").value = entry ? entry.food : "";
  document.getElementById("food-qty").value = entry ? entry.qty : "";
  document.getElementById("food-unit").value = entry ? entry.unit : "";
  populateFoodSuggestions();
  renderFoodMacroFields(entry);
  modal.classList.remove("hidden");
}
```

- [ ] **Step 4: Verify (emulator).** Tap a migrated entry (e.g. id 113): modal opens with Food/qty/unit + Calories/Protein/Carbs/Fat inputs populated (single mode shows midpoints), NO estimate button, NO reasoning panel. Switching value format to range and reopening shows lower/upper pairs. Expected: clean modal, fields editable.

- [ ] **Step 5: Commit**

```bash
git add www/index.html www/app.js
git commit -m "feat: dynamic macro inputs in food modal; remove estimate button and reasoning panel"
```

### Task 4.2: Save reads macro inputs into the entry

- [ ] **Step 1:** Add a reader and rewrite `saveFood` (line 722) to build `macros` from the inputs, set `estimateStatus`, save immediately, then enqueue background estimate:

```js
function readMacroInputs() {
  const fmt = getValueFormat();
  const macros = {};
  document.querySelectorAll("#food-macro-fields [data-macro-single]").forEach((el) => {
    if (el.value !== "") { const n = parseFloat(el.value); macros[el.dataset.macroSingle] = { low: n, high: n }; }
  });
  if (fmt === "range") {
    document.querySelectorAll("#food-macro-fields [data-macro-low]").forEach((lo) => {
      const id = lo.dataset.macroLow;
      const hi = document.querySelector(`#food-macro-fields [data-macro-high="${id}"]`);
      if (lo.value !== "" && hi && hi.value !== "") macros[id] = { low: parseFloat(lo.value), high: parseFloat(hi.value) };
    });
  }
  return macros;
}

function saveFood(e) {
  e.preventDefault();
  const entries = loadFoodEntries();
  const id = document.getElementById("food-id").value;
  const base = {
    date: document.getElementById("food-date").value,
    time: document.getElementById("food-time").value,
    food: document.getElementById("food-name").value,
    qty: parseFloat(document.getElementById("food-qty").value),
    unit: document.getElementById("food-unit").value,
    macros: readMacroInputs(),
  };
  const blanks = Macros.blankEnabled(base, getEnabledMacros());
  base.estimateStatus = blanks.length ? "pending" : "manual";

  let saved;
  if (id) {
    const idx = entries.findIndex((x) => x.id === parseInt(id));
    if (idx !== -1) { saved = { ...entries[idx], ...base }; entries[idx] = saved; }
  } else {
    const maxId = entries.length ? Math.max(...entries.map((x) => x.id)) : 0;
    saved = { ...base, id: maxId + 1 };
    entries.push(saved);
  }
  saveFoodEntries(entries);
  ensureDayExists(base.date);
  closeFoodModal();
  renderFoodTable();
  renderCalorieTracker();
  if (saved && saved.estimateStatus === "pending") enqueueEstimate(saved.id); // defined in Phase 5
}
```

- [ ] **Step 2: Verify (emulator).** Add a food with only food/qty/unit (macros blank) → entry appears instantly with `estimateStatus:"pending"` (check via DevTools `loadFoodEntries().find(e=>e.food===...)`). Manually-typed macros are stored and the entry is `"manual"`. Expected: instant save, correct status. (`enqueueEstimate` is a no-op stub until Phase 5 — add `function enqueueEstimate(){}` temporarily so this task runs standalone, replaced in Phase 5.)

- [ ] **Step 3: Commit**

```bash
git add www/app.js
git commit -m "feat: save food entry from macro inputs with pending/manual status"
```

---

## Phase 5 — Background estimation manager + dynamic AI prompt/parse

**Files:**
- Modify: `www/app.js` (prompt builders, provider `call`/`callReconciliation` signatures, new `estimateEntry`, queue, resume sweep; replace the temporary `enqueueEstimate` stub)

### Task 5.1: Make the AI prompt + parse macro-aware

- [ ] **Step 1:** Replace the fixed `SYSTEM_PROMPT_ESTIMATE` / `SYSTEM_PROMPT_RECONCILE` constants (lines 935–955) with builders that take macro ids, using `Macros.promptFields`:

```js
function buildSystemPromptEstimate(ids) {
  return `You are a precise nutrition database assistant. You base estimates on USDA FoodData Central, nutrition labels, and established food composition databases. Be consistent and deterministic.

Respond with ONLY a JSON object (no markdown fences) in this exact format:
{
  "reasoning": "<step-by-step reasoning; not shown to the user>",
${Macros.promptFields(ids)}
}
Units: calories in kcal, sodium in mg, all other macros in grams.`;
}
function buildSystemPromptReconcile(ids) {
  return `You are a precise nutrition database assistant performing a reconciliation review. Two models disagreed. Analyze both, decide which is closer to database values, and return corrected values.

Respond with ONLY a JSON object (no markdown fences) in this exact format:
{
  "reasoning": "<analysis; not shown to the user>",
${Macros.promptFields(ids)}
}
Units: calories in kcal, sodium in mg, all other macros in grams.`;
}
```

- [ ] **Step 2:** Update `buildEstimatePrompt` and the two providers' `call`/`callReconciliation` to accept and pass `ids`, and use the builders + `parseAIResponse(content, ids)`. In each provider (lines ~990, ~1020, ~1050, ~1085), change the signature to `async (food, qty, unit, apiKey, model, ids)` and use `buildSystemPromptEstimate(ids)` / `buildSystemPromptReconcile(ids)` in the `system` message. Replace `parseAIResponse` (line 1146) to be macro-aware:

```js
function parseAIResponse(content, ids) {
  const cleaned = content.trim().replace(/```json?\s*/g, "").replace(/```/g, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) { throw new Error(`Invalid JSON from AI: ${e.message}`); }
  const flat = {};
  Macros.macroFields(ids).forEach((f) => { flat[f] = parsed[f]; });
  return flat; // {calories_lower, calories_upper, ...} for requested ids
}
```

(Provider `call` returns `parseAIResponse(content, ids)`. The flat object feeds `Macros.spread`/`averageEstimates`.)

- [ ] **Step 3: Verify (unit).** No new unit test (network code), but run `npm test` to ensure macros.js helpers still pass. Manually sanity-check the prompt string in DevTools: `buildSystemPromptEstimate(["calories","carbs"])` contains `"carbs_lower"`. Expected: PASS / correct string.

- [ ] **Step 4: Commit**

```bash
git add www/app.js
git commit -m "feat: macro-aware AI prompt and response parsing"
```

### Task 5.2: `estimateEntry` engine (reconcile + single modes)

- [ ] **Step 1:** Add `estimateEntry(entry, ids)` returning a `{id: {low,high}}` macros map for the requested ids. It reuses the provider calls and `Macros.spread`/`averageEstimates`:

```js
async function estimateEntry(entry, ids) {
  const active = PROVIDERS.filter((p) => getProviderSettings(p.id).apiKey.length > 0);
  if (!active.length) throw new Error("no-api-key");

  const round1 = await Promise.all(active.map(async (p) => {
    const s = getProviderSettings(p.id);
    try { return { providerId: p.id, data: await p.call(entry.food, entry.qty, entry.unit, s.apiKey, s.primaryModel, ids) }; }
    catch { return { providerId: p.id, data: null }; }
  }));
  let ok = round1.filter((r) => r.data);
  if (!ok.length) throw new Error("all-providers-failed");

  let flat;
  if (ok.length === 1 || getEstimationMode() === "single") {
    flat = Macros.averageEstimates(ok.map((r) => r.data), ids);
  } else if (Macros.spread(ok.map((r) => r.data), ids) <= getSpreadThreshold()) {
    flat = Macros.averageEstimates(ok.map((r) => r.data), ids);
  } else {
    // reconcile up to MAX rounds
    const MAX = 5; let prev = ok;
    for (let round = 2; round <= MAX; round++) {
      const recon = await Promise.all(active
        .filter((p) => prev.some((s) => s.providerId === p.id))
        .map(async (p) => {
          const s = getProviderSettings(p.id);
          try { return { providerId: p.id, data: await p.callReconciliation(entry.food, entry.qty, entry.unit, s.apiKey, s.secondaryModel, prev, ids) }; }
          catch { return { providerId: p.id, data: null }; }
        }));
      const rok = recon.filter((r) => r.data);
      if (!rok.length) break;
      prev = rok;
      if (Macros.spread(rok.map((r) => r.data), ids) <= getSpreadThreshold()) break;
    }
    flat = Macros.averageEstimates(prev.map((r) => r.data), ids);
  }
  return Macros.parseMacros(flat, ids); // {id:{low,high}}
}
```

- [ ] **Step 2: Verify (emulator, real API).** In DevTools: `await estimateEntry({food:"banana",qty:1,unit:"medium"}, ["calories","carbs"])` returns `{calories:{low,high},carbs:{low,high}}`. Expected: plausible numbers.

- [ ] **Step 3: Commit**

```bash
git add www/app.js
git commit -m "feat: estimateEntry engine with reconcile/single modes over macro set"
```

### Task 5.3: Queue, merge, persist, re-render, resume sweep, no-key handling

- [ ] **Step 1:** Replace the temporary `enqueueEstimate` stub with a real queue (limited concurrency 1):

```js
const _estimateQueue = [];
let _estimateRunning = false;

function enqueueEstimate(entryId) {
  if (!_estimateQueue.includes(entryId)) _estimateQueue.push(entryId);
  runEstimateQueue();
}
async function runEstimateQueue() {
  if (_estimateRunning) return;
  _estimateRunning = true;
  try {
    while (_estimateQueue.length) {
      const id = _estimateQueue.shift();
      const entries = loadFoodEntries();
      const entry = entries.find((e) => e.id === id);
      if (!entry || entry.estimateStatus !== "pending") continue;
      const ids = Macros.blankEnabled(entry, getEnabledMacros());
      if (!ids.length) { entry.estimateStatus = "manual"; saveFoodEntries(entries); continue; }
      try {
        const filled = await estimateEntry(entry, ids);
        for (const mid of ids) if (filled[mid]) entry.macros[mid] = filled[mid];
        entry.estimateStatus = "done";
      } catch (err) {
        entry.estimateStatus = err.message === "no-api-key" ? "manual" : "error";
      }
      saveFoodEntries(entries);
      renderFoodTable(); renderCalorieTracker();
    }
  } finally { _estimateRunning = false; }
}
function resumePendingEstimates() {
  loadFoodEntries().filter((e) => e.estimateStatus === "pending").forEach((e) => enqueueEstimate(e.id));
}
```

- [ ] **Step 2:** Call `resumePendingEstimates()` at the end of the `DOMContentLoaded` init (after data load, ~line 3879).

- [ ] **Step 3: Verify (emulator).** Add a food with blank macros → it shows pending, then within seconds flips to filled values + `estimateStatus:"done"` without blocking the UI. Force-stop mid-estimate and relaunch → the pending entry resumes. With no API key set, a blank entry becomes `"manual"` (no error spam). Expected: all three behaviors.

- [ ] **Step 4: Commit**

```bash
git add www/app.js
git commit -m "feat: background estimate queue with resume sweep and no-key handling"
```

---

## Phase 6 — Displays: cards, table, pending/error indicators

**Files:**
- Modify: `www/index.html` (table `<thead>` — make macro columns dynamic or render from JS)
- Modify: `www/app.js` (`renderFoodTable` rows/header)
- Modify: `www/mobile-render.js` (`renderFoodCards`)
- Modify: `www/styles.css` (pending/error styles)

### Task 6.1: Desktop table — dynamic macro columns + status

- [ ] **Step 1:** Rewrite `renderFoodTable` (line 489) to build header + rows from `getEnabledMacros()` and `Macros.formatMacro`, and show status. Replace the fixed `<thead>` in `index.html` with `<thead id="food-eaten-head"></thead>` and render it:

```js
function renderFoodTable() {
  const enabled = getEnabledMacros();
  const fmt = getValueFormat();
  const head = document.getElementById("food-eaten-head");
  if (head) head.innerHTML = `<tr><th>Date</th><th>Time</th><th>Food</th><th>Qty</th><th>Unit</th>`
    + enabled.map((id) => `<th class="num">${escapeHtml(Macros.byId(id).label)}</th>`).join("")
    + `<th>Actions</th></tr>`;
  // ... existing grouping/sort ...
  // date-group row totals:
  //   `<td colspan="5">…</td>` + enabled.map(id => { const t = totals.macro(id); return `<td class="num">${Macros.formatMacro(t, fmt)}</td>`; }).join("") + `<td></td>`
  // entry row:
  //   `<td>…date</td><td>…time</td><td>…food</td><td class="num">…qty</td><td>…unit</td>`
  //   + enabled.map(id => `<td class="num">${Macros.formatMacro(Macros.getMacro(entry,id), fmt)}</td>`).join("")
  //   + `<td><div class="actions">${statusBadge(entry)}<button class="btn-icon" onclick="editFood(${entry.id})">✎</button><button class="btn-icon delete" onclick="deleteFood(${entry.id})">✕</button></div></td>`
}
function statusBadge(entry) {
  if (entry.estimateStatus === "pending") return `<span class="est-badge est-pending" title="Estimating…">…</span>`;
  if (entry.estimateStatus === "error") return `<button class="est-badge est-error" title="Estimate failed — retry" onclick="retryEstimate(${entry.id})">!</button>`;
  return "";
}
function retryEstimate(id) {
  const entries = loadFoodEntries();
  const e = entries.find((x) => x.id === id);
  if (e) { e.estimateStatus = "pending"; saveFoodEntries(entries); renderFoodTable(); enqueueEstimate(id); }
}
```

(Keep the existing grouping/sort logic; only the header and the per-row/per-group cells change. Remove the old `thought-btn`/`viewThoughtProcess` button.)

- [ ] **Step 2:** Add CSS:

```css
.est-badge { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; border-radius:9px; font-size:.7rem; }
.est-pending { color: var(--text-dim); animation: pulse 1.2s infinite; }
.est-error { background:#7a2b2b; color:#fff; border:none; cursor:pointer; }
@keyframes pulse { 50% { opacity:.4; } }
```

- [ ] **Step 3: Verify (emulator/browser, desktop width).** Table shows a column per enabled macro; toggling Sodium in settings adds a Sodium column. Pending entries show "…", errors show a clickable "!". Expected: dynamic columns + status.

- [ ] **Step 4: Commit**

```bash
git add www/index.html www/app.js www/styles.css
git commit -m "feat: dynamic macro columns and estimate-status badges in food table"
```

### Task 6.2: Mobile cards — enabled macros + status

- [ ] **Step 1:** In `www/mobile-render.js` `renderFoodCards`, replace the fixed cal/protein lines with calories headline + a compact row per other enabled macro, plus pending/error state:

```js
const enabled = getEnabledMacros();
const fmt = getValueFormat();
// headline calories:
const cal = Macros.getMacro(e, "calories");
const calStr = Macros.formatMacro(cal, fmt);
// macro rows for the rest:
const rows = enabled.filter((id) => id !== "calories")
  .map((id) => `<div class="food-card-row"><span>${escapeHtml(Macros.byId(id).label)}</span><b>${Macros.formatMacro(Macros.getMacro(e, id), fmt)} ${Macros.byId(id).unit}</b></div>`)
  .join("");
const pending = e.estimateStatus === "pending" ? '<span class="est-badge est-pending">…</span>' : "";
// card template uses calStr (with " cal"), rows, and pending in the header area.
```

(Card body click still calls `editFood`; the overflow menu still calls `deleteFood`.)

- [ ] **Step 2: Verify (emulator, mobile width).** Cards show Calories + enabled macros; pending entries show "…". Toggling macros in settings changes the rows. Expected: correct compact display.

- [ ] **Step 3: Commit**

```bash
git add www/mobile-render.js
git commit -m "feat: mobile cards render enabled macros with estimate status"
```

---

## Phase 7 — Batch Add

**Files:**
- Modify: `www/index.html` (batch modal: remove estimate button + results reasoning)
- Modify: `www/app.js` (`saveBatchFoods`, `estimateBatchNutrition` removal/replacement, batch row rendering)

### Task 7.1: Batch rows accept manual macros; save enqueues background estimates

- [ ] **Step 1:** Remove the batch estimate button (`#batch-estimate-btn`) and the reasoning/`renderBatchResults` thought-process output. Batch rows keep food/qty/unit (+ optional macro inputs for enabled macros if desired; minimum: food/qty/unit). Rewrite `saveBatchFoods` (line ~3820) to build each entry with `macros: {}` (or manual values), `estimateStatus: "pending"` when blank, save all immediately, then `enqueueEstimate(id)` per pending row:

```js
function saveBatchFoods() {
  const date = document.getElementById("batch-date").value;
  const time = document.getElementById("batch-time").value;
  const entries = loadFoodEntries();
  let maxId = entries.length ? Math.max(...entries.map((e) => e.id)) : 0;
  const created = [];
  document.querySelectorAll("#batch-items .batch-item-row").forEach((row) => {
    const food = row.querySelector(".batch-food").value.trim();
    const qty = row.querySelector(".batch-qty").value;
    const unit = row.querySelector(".batch-unit").value.trim();
    if (!food || !qty || !unit) return;
    const entry = { id: ++maxId, date, time, food, qty: parseFloat(qty), unit, macros: {}, estimateStatus: "pending" };
    entries.push(entry); created.push(entry);
  });
  saveFoodEntries(entries);
  ensureDayExists(date);
  closeBatchModal();
  renderFoodTable(); renderCalorieTracker();
  created.forEach((e) => enqueueEstimate(e.id));
}
```

- [ ] **Step 2:** Delete `estimateBatchNutrition`, `renderBatchResults`, `_batchValidationData`, and the `#batch-estimate-btn` listener (search and remove; ensure no remaining references).

- [ ] **Step 3: Verify (emulator).** Batch-add 3 foods → all 3 appear instantly as pending, then fill in one by one in the background. Expected: instant, no reasoning UI.

- [ ] **Step 4: Commit**

```bash
git add www/index.html www/app.js
git commit -m "feat: batch add saves instantly and estimates macros in background"
```

---

## Phase 8 — Remove dead reasoning code + final verification

**Files:**
- Modify: `www/app.js` (delete `renderValidationResults`, `renderReasoning`, `formatDelta`, `viewThoughtProcess`, `_lastValidationData`, `estimateNutrition`, `fillNutritionFields`, `setEstimateStatus`, and listeners for `#estimate-btn`)
- Modify: `www/index.html` (remove any leftover `#validation-results`, `#estimate-btn`, `#estimate-status`, `food-suggestions` only if unused — keep suggestions)

### Task 8.1: Delete unused reasoning/estimate-button code

- [ ] **Step 1:** Remove these now-unused symbols and their references (grep each before deleting to confirm zero remaining callers): `renderValidationResults`, `renderReasoning`, `formatDelta`, `window.viewThoughtProcess`, `_lastValidationData`, `estimateNutrition`, `fillNutritionFields`, `setEstimateStatus`, the `document.getElementById("estimate-btn")...addEventListener` line (~3923).

Run before each deletion, e.g.:

```bash
grep -rn "renderValidationResults\|viewThoughtProcess\|estimateNutrition\|fillNutritionFields\|_lastValidationData\|setEstimateStatus" www/
```

Expected after edits: only the definitions remain → delete them; final grep returns nothing.

- [ ] **Step 2: Run unit tests.** Run: `npm test`. Expected: all macros.js + assessment-view tests PASS.

- [ ] **Step 3: Commit**

```bash
git add www/app.js www/index.html
git commit -m "chore: remove dead AI-reasoning and estimate-button code"
```

### Task 8.2: Full behavioral verification on emulator

- [ ] **Step 1:** `npx cap sync android` then `cd android; .\gradlew.bat installDebug`; relaunch app.

- [ ] **Step 2:** Verify end-to-end (DevTools + screenshots), checking each spec requirement:
  - Add food, macros blank → saves instantly, fills in background, no reasoning panel.
  - Edit existing migrated entry → opens (no crash), shows midpoints, editable.
  - Settings: enable Sodium → Sodium field appears in modal + column in table/card; switch to range → pairs appear; switch estimation to single → faster fill.
  - Manual values are not overwritten; cleared field on edit re-estimates.
  - Force-stop mid-estimate → resumes on relaunch.
  - No API key → entry stays manual, gentle hint, no error spam.

- [ ] **Step 3:** Use `superpowers:verification-before-completion` to confirm each claim with evidence (DevTools output / screenshots) before declaring done.

- [ ] **Step 4: Commit (if any fixes)** and finish the branch with `superpowers:finishing-a-development-branch`.

---

## Self-Review (completed by plan author)

- **Spec coverage:** hide reasoning → Phase 4 (panel removed) + Phase 8 (code deleted); configurable macros → Phase 1 catalog + Phase 3 settings; data model + migration → Phase 1.3 + Phase 2.2; settings (3 keys) → Phase 2.1 + Phase 3; modal redesign → Phase 4; background auto-estimate (trigger/queue/resume/no-key/indicators) → Phase 4.2 + Phase 5 + Phase 6; AI prompt/parse generalization → Phase 5.1; engine modes → Phase 5.2; displays/day-totals → Phase 2.2 + Phase 6; assessment reads new model → Phase 2.2 (calories/protein via helpers); batch → Phase 7; edit re-estimate rule → Phase 4.2/5.3 (blank-only fill). All covered.
- **Type consistency:** macro value `{low,high}` everywhere; `getEnabledMacros()`/`getValueFormat()`/`getEstimationMode()` names consistent across phases; `enqueueEstimate(id)` defined as stub in 4.2 and replaced in 5.3; `estimateEntry(entry, ids)` returns `{id:{low,high}}` consumed by the queue; provider `call(...,ids)` matches `parseAIResponse(content, ids)`.
- **Placeholders:** none — code shown for every code step; the only intentional stub (`enqueueEstimate` no-op in 4.2) is explicitly called out and replaced in 5.3.
- **Open decision** from spec (single = midpoint) is implemented in `formatMacro`/`midpoint` (Task 1.2) and modal single-input population (Task 4.1).
