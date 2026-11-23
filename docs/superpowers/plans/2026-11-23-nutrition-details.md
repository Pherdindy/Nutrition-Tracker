# Nutrition Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people correct an entry's numbers, reuse them the next time they log the food, and see how the AI worked them out.

**Architecture:** A new pure module, `www/nutrition.js`, decides everything about an entry's numbers (units, scaling, remembering, typed numbers, the AI's answer, the explanation). `www/app.js` only wires it to the form, the estimate queue and the sync outbox. The proxy gains a declared basis (reference, weight) and accepts known totals; request and response only grow.

**Tech Stack:** Vanilla JS (UMD modules, no build), Supabase (Postgres + PostgREST + Edge Function in Deno/TypeScript), Capacitor 8, Node `--test`.

**Spec:** `docs/superpowers/specs/2026-11-23-nutrition-details-design.md`. Rules R1–R4 there are binding.

**Conventions for this plan**
- Work in a git worktree on `feat/nutrition-details`; the main checkout is what the user runs.
- Every code block below is source. `<!-- write PATH @TAG -->` before a block means "create or replace this file"; `<!-- edit PATH @TAG -->` before two blocks means "replace the first with the second, exactly once". `<!-- append PATH @TAG -->` adds to the end of a file.
- Run tests with `node --test --test-timeout=9000` from the worktree root.
- Production steps (Task 11) need the user's explicit yes. Nothing before it touches production.

**Already verified (read-only, emulator, owner's session, 2026-11-23):** PostgREST's `macros=eq.<json>` matches exactly one row for all 51 entries with a status, ignores key order, and does not match a changed or empty value.

## File structure

| File | Responsibility |
|---|---|
| `www/nutrition.js` (new) | Units, name match, choosing and scaling remembered numbers, what an edit means, typed numbers and weight, applying an answer, form state, explanation, tag. Pure. |
| `www/sync.js` | `matches` compares by value |
| `www/app.js` | Row mapping, estimate queue, Add/Edit/Batch/Photo, Nutrition section wiring |
| `www/assessment-view.js` | `payload(data)`: what an assessment sends |
| `www/macros.js` | Fiber on by default |
| `www/mobile-render.js`, `www/index.html`, `www/styles.css` | Section markup, tag, layout |
| `supabase/functions/_shared/proxy-shapes.mjs`, `metering.mjs` | `extractBasis`, `cleanKnown`, `mergedHow` |
| `supabase/functions/ai-proxy/index.ts` | Prompt, `known`, response |
| `docs/sql/2026-11-23-food-nutrition-01.sql` (new) | The column |
| `tests/nutrition.test.js`, `tests/nutrition-app.test.js` (new) | Unit and app tests |

---

### Task 1: Conditional updates compare by value

The estimate's conditional update will also require that the numbers are still the ones the AI was asked about (R2), so a condition can now be an object.

**Files:** Modify `www/sync.js`, `www/app.js`; test `tests/sync.test.js`, `tests/helpers/app-harness.js`

- [ ] **Step 1: Failing tests**

<!-- append tests/sync.test.js @T1t -->
```js

test("matches compares objects by value, whatever the order of their keys", () => {
  const row = { macros: { protein: { low: 22, high: 22, mine: true }, fat: { low: 1, high: 2 } } };
  assert.equal(Sync.matches(row, { macros: { fat: { high: 2, low: 1 }, protein: { mine: true, high: 22, low: 22 } } }), true);
  assert.equal(Sync.matches(row, { macros: { fat: { low: 1, high: 2 }, protein: { low: 22, high: 22 } } }), false);
  assert.equal(Sync.matches(row, { macros: { protein: { low: 22, high: 22, mine: true } } }), false);
  assert.equal(Sync.matches({ macros: {} }, { macros: {} }), true);
  assert.equal(Sync.matches({ macros: null }, { macros: {} }), false);
  assert.equal(Sync.matches({ x: 1 }, { x: "1" }), false);
});
```

- [ ] **Step 2: Run** `node --test tests/sync.test.js` — expected: 1 failing (`false == true`).

- [ ] **Step 3: Implement**

<!-- edit www/sync.js @T1 -->
```js
  const matches = (row, match) => Object.entries(match).every(([field, value]) => row[field] === value);
```
```js
  // The same value, objects included, whatever the order of their keys (the database
  // does not keep it).
  function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => same(a[key], b[key]));
  }
  const matches = (row, match) => Object.entries(match).every(([field, value]) => same(row[field], value));
```

<!-- edit www/app.js @T1 -->
```js
      for (const [column, value] of Object.entries(match)) query = query.eq(column, value);
```
```js
      for (const [column, value] of Object.entries(match)) {
        query = query.eq(column, value && typeof value === "object" ? JSON.stringify(value) : value);
      }
```

The fake server must compare a JSON filter by value, as jsonb does, and refuse unknown columns, as PostgREST does.

<!-- edit tests/helpers/app-harness.js @T1 -->
```js
      if (kind === "eq") return String(row[col]) === String(val);
```
```js
      if (kind === "eq") return row[col] && typeof row[col] === "object" ? sameJson(row[col], JSON.parse(val)) : String(row[col]) === String(val);
```

<!-- edit tests/helpers/app-harness.js @T1 -->
```js
const clone = (v) => JSON.parse(JSON.stringify(v));
```
```js
const clone = (v) => JSON.parse(JSON.stringify(v));
const sorted = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const sameJson = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b)); // jsonb equality
```

<!-- edit tests/helpers/app-harness.js @T1 -->
```js
    key: ["id"], unique: [["id"]], defaults: {},
    required: ["id", "date", "time", "food", "qty", "unit"],
  },
```
```js
    key: ["id"], unique: [["id"]], defaults: {},
    required: ["id", "date", "time", "food", "qty", "unit"],
    columns: ["id", "date", "time", "food", "qty", "unit", "cal_low", "cal_high", "pro_low", "pro_high", "ai_thought_process", "macros", "estimate_status", "nutrition"],
  },
```

<!-- edit tests/helpers/app-harness.js @T1 -->
```js
    for (const payload of incoming) {
      const row = { user_id: uid, ...spec.defaults, ...payload };
```
```js
    for (const payload of incoming) {
      const unknown = spec.columns && Object.keys(payload).find((c) => !spec.columns.includes(c));
      if (unknown) return fail(400, "PGRST204", `Could not find the '${unknown}' column of '${q.table}' in the schema cache`);
      const row = { user_id: uid, ...spec.defaults, ...payload };
```

- [ ] **Step 4: Run** the whole suite — expected: all pass.
- [ ] **Step 5: Commit** `feat(sync): conditional updates compare objects by value`

---

### Task 2: Units, amounts, scaling

**Files:** Create `www/nutrition.js`, `tests/nutrition.test.js`

**Interfaces (used by every later task):**
- `unit(text) -> string` canonical unit
- `ratio(from, to, grams?) -> number | null` how many times `from` the amount `to` is; `grams` is the weight of `from`
- `unitsFor({ unit }, grams?) -> string[]` the units an amount can be expressed in, its own first
- `scale(macros, k) -> macros`
- `sameFood(a, b) -> boolean`

- [ ] **Step 1: Failing tests**

<!-- write tests/nutrition.test.js @T2t -->
```js
const test = require("node:test");
const assert = require("node:assert");
const N = require("../www/nutrition.js");

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} is not ${b}`);
const amount = (qty, unit) => ({ qty, unit });

// ---- units ---------------------------------------------------------------------

for (const [canonical, spellings] of Object.entries({
  g: ["g", "G", " g. ", "gram", "Grams", "gr", "gms"],
  kg: ["kg", "kilo", "kilos", "kilogram", "kilograms"],
  oz: ["oz", "ounce", "ounces"],
  lb: ["lb", "lbs", "pound", "pounds"],
  ml: ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "cc"],
  l: ["l", "liter", "liters", "litre", "litres"],
  tsp: ["tsp", "tsps", "teaspoon", "teaspoons"],
  tbsp: ["tbsp", "tbsps", "tablespoon", "tablespoons"],
  cup: ["cup", "cups", "Cups"],
  "fl oz": ["fl oz", "fl  oz", "floz", "fluid ounce", "fluid ounces"],
  pc: ["pc", "pcs", "pcs.", "piece", "pieces"],
  scoop: ["scoop", "scoops"],
  slice: ["slice", "slices"],
  order: ["order", "orders"],
  glass: ["glass"],
  bus: ["bus"],
})) {
  test(`every spelling of ${canonical} is the same unit`, () => {
    for (const s of spellings) assert.equal(N.unit(s), canonical, s);
  });
}

test("amounts in the same unit, however spelled", () => {
  assert.equal(N.ratio(amount(4, "pcs"), amount(6, "pieces")), 1.5);
  assert.equal(N.ratio(amount(1, "order"), amount(2, "orders")), 2);
});

test("weights convert to weights and volumes to volumes", () => {
  assert.equal(N.ratio(amount(80, "g"), amount(0.1, "kg")), 1.25);
  near(N.ratio(amount(1, "lb"), amount(16, "oz")), 1);
  near(N.ratio(amount(1, "cup"), amount(8, "fl oz")), 1);
  near(N.ratio(amount(1, "tbsp"), amount(3, "tsp")), 1);
});

test("pieces convert to a weight only when their weight is known", () => {
  assert.equal(N.ratio(amount(4, "pcs"), amount(56, "g")), null);
  near(N.ratio(amount(4, "pcs"), amount(56, "g"), 48), 56 / 48);
  near(N.ratio(amount(1, "cup"), amount(79, "g"), 158), 0.5);
  assert.equal(N.ratio(amount(80, "g"), amount(4, "pcs"), 80), null, "the weight of the new amount is not known");
});

test("nothing is guessed", () => {
  assert.equal(N.ratio(amount(1, "cup"), amount(100, "g")), null);
  assert.equal(N.ratio(amount(1, "plate"), amount(1, "bowl")), null);
  for (const bad of [0, -1, NaN, undefined]) {
    assert.equal(N.ratio(amount(bad, "g"), amount(1, "g")), null);
    assert.equal(N.ratio(amount(1, "g"), amount(bad, "g")), null);
  }
});

test("the units on offer are only those that convert, the entry's own first", () => {
  assert.deepEqual(N.unitsFor({ unit: "pcs" }), ["pcs"]);
  assert.deepEqual(N.unitsFor({ unit: "pcs" }, 48), ["pcs", "g", "kg", "oz", "lb"]);
  assert.deepEqual(N.unitsFor({ unit: "grams" }), ["grams", "kg", "oz", "lb"]);
  assert.deepEqual(N.unitsFor({ unit: "cups" }), ["cups", "ml", "l", "tsp", "tbsp", "fl oz"]);
  assert.deepEqual(N.unitsFor({ unit: "cups" }, 158).slice(-4), ["g", "kg", "oz", "lb"]);
});

test("scaling keeps ranges and marks, to three decimals", () => {
  const macros = { calories: { low: 100, high: 110 }, protein: { low: 11, high: 11, mine: true } };
  assert.deepEqual(N.scale(macros, 80 / 56), { calories: { low: 142.857, high: 157.143 }, protein: { low: 15.714, high: 15.714, mine: true } });
  assert.deepEqual(macros.calories, { low: 100, high: 110 }, "the original is untouched");
  assert.deepEqual(N.scale(undefined, 2), {});
});

test("food names match regardless of case and spacing", () => {
  assert.equal(N.sameFood(" Cooked  white Rice", "cooked white rice"), true);
  assert.equal(N.sameFood("Sardines", "Sardines in oil"), false);
});
```

- [ ] **Step 2: Run** `node --test tests/nutrition.test.js` — expected: fails, module missing.

- [ ] **Step 3: Implement**

<!-- write www/nutrition.js @T2 -->
```js
// An entry's numbers: units, scaling, remembered foods, typed numbers, the AI's answer
// and how it is explained. Pure: no DOM, no network, no storage.
// UMD: usable as a browser global (window.Nutrition) and a Node module.
//
// The invariant behind all of it: `macros` is always the total for what was eaten.
(function (root, factory) {
  const Macros = (typeof require === "function") ? require("./macros.js") : root.Macros;
  const api = factory(Macros);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Nutrition = api;
})(typeof self !== "undefined" ? self : this, function (Macros) {
  const IDS = Macros.CATALOG.map((m) => m.id);

  const has = (macros, id) => Macros.getMacro({ macros }, id) !== null;
  const isMine = (macros, id) => has(macros, id) && !!macros[id].mine;
  const mineIds = (macros) => IDS.filter((id) => isMine(macros, id));
  const theirIds = (macros) => IDS.filter((id) => has(macros, id) && !macros[id].mine);
  const complete = (macros) => IDS.every((id) => has(macros, id));
  const pick = (macros, ids) => Object.fromEntries(ids.map((id) => [id, macros[id]]));
  const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
  const show = (n) => String(round(n, 1));

  // ---- Units and amounts ------------------------------------------------------

  const WEIGHT = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
  const VOLUME = { ml: 1, l: 1000, tsp: 4.92892159375, tbsp: 14.78676478125, cup: 236.5882365, "fl oz": 29.5735295625 };
  const ALSO = {
    gram: "g", gr: "g", gms: "g", kilo: "kg", kilogram: "kg", ounce: "oz", lbs: "lb", pound: "lb",
    milliliter: "ml", millilitre: "ml", cc: "ml", liter: "l", litre: "l", teaspoon: "tsp", tablespoon: "tbsp",
    floz: "fl oz", "fluid ounce": "fl oz", pcs: "pc", piece: "pc",
  };
  const isWeight = (text) => unit(text) in WEIGHT;

  function unit(text) {
    const s = String(text == null ? "" : text).trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
    const known = (u) => (u in WEIGHT || u in VOLUME ? u : ALSO[u]);
    const single = s.length > 3 && s.endsWith("s") && !s.endsWith("ss") ? s.slice(0, -1) : s;
    return known(s) || known(single) || single;
  }

  // How many times the amount `from` the amount `to` is; null if that cannot be known.
  // grams: the weight of `from`.
  function ratio(from, to, grams) {
    const a = Number(from.qty), b = Number(to.qty);
    if (!(a > 0) || !(b > 0)) return null;
    const ua = unit(from.unit), ub = unit(to.unit);
    if (ua === ub) return b / a;
    for (const table of [WEIGHT, VOLUME]) if (ua in table && ub in table) return (b * table[ub]) / (a * table[ua]);
    return grams > 0 && ub in WEIGHT ? (b * WEIGHT[ub]) / grams : null;
  }

  function unitsFor(amount, grams) {
    const own = unit(amount.unit);
    const others = [
      ...(own in VOLUME ? Object.keys(VOLUME) : []),
      ...(own in WEIGHT || grams > 0 ? Object.keys(WEIGHT) : []),
    ];
    return [String(amount.unit == null ? "" : amount.unit).trim(), ...others.filter((u) => u !== own)];
  }

  function scale(macros, k) {
    return Object.fromEntries(Object.entries(macros || {})
      .filter(([, m]) => m && m.low != null && m.high != null)
      .map(([id, m]) => [id, { ...m, low: round(m.low * k, 3), high: round(m.high * k, 3) }]));
  }

  const nameOf = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  const sameFood = (a, b) => nameOf(a) === nameOf(b);

  return { unit, ratio, unitsFor, scale, sameFood };
});
```

- [ ] **Step 4: Run** `node --test tests/nutrition.test.js` — expected: all pass.
- [ ] **Step 5: Commit** `feat(nutrition): units, amounts and scaling`

---

### Task 3: Remembering, editing, the AI's answer

**Files:** Modify `www/nutrition.js`, `tests/nutrition.test.js`

**Interfaces:**
- `findRemembered(entries, food, { qty, unit }) -> { entry, ratio } | null`
- `reuse({ entry, ratio }) -> { macros, nutrition }`
- `latestLog(entries, food) -> entry | null`
- `editPlan(before, after) -> { kind: "keep" | "lookup" } | { kind: "scale", ratio }`
- `resolve({ before, after, form, others, tracked, now }) -> { macros, nutrition, estimateStatus }`; `form` is `createForm(...).result()` (Task 4) or null
- `statusFor(macros, tracked, nutrition) -> "pending" | "manual" | "done"`
- `needsAnswer(entry, tracked) -> boolean`, `known(entry) -> { id: total } | undefined`
- `applyAnswer(entry, answer, { tracked, now }) -> { macros, nutrition, estimateStatus }`; `answer` is the proxy's response or null

- [ ] **Step 1: Failing tests**

<!-- append tests/nutrition.test.js @T3t -->
```js

// ---- remembering ---------------------------------------------------------------

const full = (kcal = 100, over = {}) => ({
  calories: { low: kcal, high: kcal }, protein: { low: 10, high: 12 }, carbs: { low: 1, high: 2 }, fat: { low: 3, high: 4 },
  fiber: { low: 0, high: 1 }, sugar: { low: 0, high: 1 }, saturatedFat: { low: 1, high: 1 }, sodium: { low: 200, high: 300 }, ...over,
});
const three = (kcal) => ({ calories: { low: kcal, high: kcal }, protein: { low: 10, high: 10 }, carbs: { low: 1, high: 1 } });
const mine = (n) => ({ low: n, high: n, mine: true });
const TRACKED = ["calories", "protein", "carbs"];
const NOW = 1795500000000;
const entry = (over = {}) => ({ id: 1, date: "2026-11-20", time: "08:00", food: "Sardines", qty: 4, unit: "pcs", macros: full(), estimateStatus: "done", ...over });

test("a past entry is remembered by name and a convertible amount", () => {
  const e = entry();
  assert.deepEqual(N.findRemembered([e], " sardines ", amount(6, "pieces")), { entry: e, ratio: 1.5 });
  assert.equal(N.findRemembered([e], "Tuna", amount(4, "pcs")), null);
  assert.equal(N.findRemembered([e], "Sardines", amount(80, "g")), null, "weight of 4 pcs unknown");
  near(N.findRemembered([entry({ nutrition: { grams: 48 } })], "Sardines", amount(80, "g")).ratio, 80 / 48);
});

test("only finished entries with all eight nutrients, or a typed number, are remembered", () => {
  const found = (over) => !!N.findRemembered([entry(over)], "Sardines", amount(4, "pcs"));
  assert.equal(found({}), true);
  assert.equal(found({ estimateStatus: "manual" }), true);
  for (const status of ["pending", "error", null]) assert.equal(found({ estimateStatus: status }), false, String(status));
  assert.equal(found({ macros: three(100) }), false, "saved before all eight were kept");
  assert.equal(found({ macros: { ...three(100), protein: mine(22) } }), true);
  assert.equal(found({ macros: undefined }), false);
  assert.equal(found({ qty: 0 }), false);
  assert.equal(found({ nutrition: { photo: true } }), false);
});

test("the most recently decided entry wins, then the newest id", () => {
  const pickId = (...entries) => N.findRemembered(entries, "Sardines", amount(4, "pcs")).entry.id;
  assert.equal(pickId(entry({ id: 1, nutrition: { at: 200 } }), entry({ id: 2, nutrition: { at: 100 } })), 1);
  assert.equal(pickId(entry({ id: 1, date: "2026-11-20" }), entry({ id: 2, date: "2026-11-22" }), entry({ id: 3, date: "2026-11-21" })), 2);
  assert.equal(pickId(entry({ id: 5 }), entry({ id: 9 }), entry({ id: 7 })), 9);
  // corrected later, although it was eaten earlier
  assert.equal(pickId(entry({ id: 1, date: "2026-11-19", nutrition: { at: Date.parse("2026-11-23T10:00") } }), entry({ id: 2, date: "2026-11-22" })), 1);
});

test("reusing scales everything and names where the numbers came from", () => {
  const e = entry({ id: 7, macros: full(100, { protein: mine(22) }), nutrition: { at: 500, grams: 48, why: [{ ref: "x" }], asked: amount(4, "pcs"), refresh: true, basis: amount(56, "g") } });
  const got = N.reuse({ entry: e, ratio: 1.5 });
  assert.deepEqual(got.macros.calories, { low: 150, high: 150 });
  assert.deepEqual(got.macros.protein, mine(33));
  assert.deepEqual(got.nutrition, { at: 500, grams: 72, why: [{ ref: "x" }], asked: amount(4, "pcs"), basis: amount(56, "g"), from: { id: 7, date: "2026-11-20" } });
});

test("a copy of a copy names the original and keeps its time", () => {
  const first = entry({ id: 1, nutrition: { at: 500 } });
  const second = entry({ id: 2, date: "2026-11-22", ...N.reuse({ entry: first, ratio: 1 }) });
  assert.deepEqual(N.reuse({ entry: second, ratio: 1 }).nutrition, { at: 500, from: { id: 1, date: "2026-11-20" } });
});

test("the weight of a light food does not drift from copy to copy", () => {
  const clove = entry({ qty: 1, unit: "clove", nutrition: { at: 500, grams: 3 } });
  const quarter = entry({ id: 2, qty: 0.25, unit: "clove", ...N.reuse({ entry: clove, ratio: 0.25 }) });
  assert.equal(N.reuse({ entry: quarter, ratio: 4 }).nutrition.grams, 3);
  const scaled = (e, qty) => ({ ...e, qty, ...N.resolve({ before: e, after: { food: e.food, qty, unit: "clove" }, tracked: TRACKED, now: NOW }) });
  assert.equal(scaled(scaled(clove, 0.25), 1).nutrition.grams, 3);
});

test("an entry with no recorded time is remembered as of when it was eaten", () => {
  assert.equal(N.reuse({ entry: entry(), ratio: 1 }).nutrition.at, Date.parse("2026-11-20T08:00"));
});

test("the latest log of a food is by date, time, then id, whatever the order", () => {
  const list = [entry({ id: 3, date: "2026-02-09", unit: "g" }), entry({ id: 9, date: "2026-11-22", time: "10:41" }), entry({ id: 8, date: "2026-11-22", time: "18:45" }), entry({ id: 4, date: "2026-11-22", time: "18:45" })];
  assert.equal(N.latestLog(list, "sardines").id, 8);
  assert.equal(N.latestLog([...list].reverse(), "Sardines").id, 8);
  assert.equal(N.latestLog(list, "Tuna"), null);
});

// ---- saving --------------------------------------------------------------------

const add = (over = {}) => N.resolve({ after: { food: "Sardines", qty: 4, unit: "pcs" }, others: [], tracked: TRACKED, now: NOW, ...over });

test("adding an unknown food waits for the AI", () => {
  assert.deepEqual(add(), { macros: {}, nutrition: undefined, estimateStatus: "pending" });
});

test("adding a remembered food needs no AI", () => {
  const got = add({ after: { food: "Sardines", qty: 2, unit: "pcs" }, others: [entry({ nutrition: { at: 500 } })] });
  assert.equal(got.estimateStatus, "done");
  assert.deepEqual(got.macros.calories, { low: 50, high: 50 });
  assert.deepEqual(got.nutrition, { at: 500, from: { id: 1, date: "2026-11-20" } });
});

test("a remembered food with gaps in what is tracked waits for the AI to fill them", () => {
  const got = add({ others: [entry({ macros: { protein: mine(22) } })] });
  assert.equal(got.estimateStatus, "pending");
  assert.deepEqual(got.macros, { protein: mine(22) });
});

test("typing every tracked number needs no AI", () => {
  const got = add({ form: { typed: { calories: 120, protein: 22, carbs: 0 } } });
  assert.deepEqual(got, { macros: { calories: mine(120), protein: mine(22), carbs: mine(0) }, nutrition: { at: NOW }, estimateStatus: "manual" });
});

test("typing some numbers leaves the rest to the remembered entry, and is decided now", () => {
  const got = add({ others: [entry({ nutrition: { at: 500 } })], form: { typed: { protein: 25 } } });
  assert.deepEqual(got.macros.protein, mine(25));
  assert.deepEqual(got.macros.calories, { low: 100, high: 100 });
  assert.deepEqual(got.nutrition, { at: NOW });
  assert.equal(got.estimateStatus, "done");
});

test("a label's numbers are scaled to what was eaten", () => {
  const got = add({ after: { food: "Sardines", qty: 80, unit: "g" }, form: { typed: { protein: 11 }, basis: amount(56, "g") } });
  assert.deepEqual(got.macros, { protein: mine(15.714) });
  assert.deepEqual(got.nutrition, { basis: amount(56, "g"), at: NOW });
  assert.equal(got.estimateStatus, "pending");
});

const edit = (before, after, form) => N.resolve({ before, after: { food: before.food, qty: before.qty, unit: before.unit, ...after }, form, others: [], tracked: TRACKED, now: NOW });

test("changing only the date or time changes nothing about the numbers", () => {
  for (const e of [entry({ nutrition: { at: 500, from: { id: 9, date: "2026-11-01" } } }), entry({ estimateStatus: "error", macros: {} }), entry({ estimateStatus: null, macros: three(5) })]) {
    const got = edit(e, {});
    assert.deepEqual(got, { macros: e.macros, nutrition: e.nutrition, estimateStatus: e.estimateStatus });
  }
});

test("a unit spelled differently, or a name in other capitals, is no change", () => {
  assert.deepEqual(N.editPlan(entry(), { food: "SARDINES", qty: 4, unit: "pieces" }), { kind: "keep" });
});

test("changing the amount scales the numbers, typed ones too, and asks nobody", () => {
  const e = entry({ macros: full(100, { protein: mine(22) }), nutrition: { at: 500, grams: 48, from: { id: 9, date: "2026-11-01" } } });
  const got = edit(e, { qty: 6 });
  assert.equal(got.estimateStatus, "done");
  assert.deepEqual(got.macros.calories, { low: 150, high: 150 });
  assert.deepEqual(got.macros.protein, mine(33));
  assert.deepEqual(got.nutrition, { at: 500, grams: 72, from: { id: 9, date: "2026-11-01" } });
  near(edit(e, { qty: 96, unit: "g" }).macros.calories.low, 200); // by weight
});

test("changing the amount of an entry that has no numbers keeps it waiting", () => {
  const got = edit(entry({ macros: {}, estimateStatus: "pending" }), { qty: 6 });
  assert.deepEqual([got.macros, got.estimateStatus], [{}, "pending"]);
});

test("a new name, or an amount that does not convert, asks again and keeps the old numbers meanwhile", () => {
  for (const after of [{ food: "Tuna" }, { qty: 2, unit: "cups" }]) {
    const e = entry({ macros: full(100, { protein: mine(22) }) });
    const got = edit(e, after);
    assert.equal(got.estimateStatus, "pending");
    assert.equal(got.nutrition.refresh, true);
    assert.deepEqual(got.macros, e.macros);
  }
});

test("a new name or unit forgets the weight of what it was before", () => {
  for (const after of [{ food: "Tuna" }, { qty: 2, unit: "cups" }]) {
    const got = edit(entry({ nutrition: { at: 5, grams: 90, gramsMine: true } }), after);
    assert.deepEqual(got.nutrition, { at: 5, refresh: true });
  }
});

test("a new name that is remembered takes those numbers, but never over a typed one", () => {
  const tuna = entry({ id: 5, food: "Tuna", macros: full(300), nutrition: { at: 700 } });
  const got = N.resolve({ before: entry({ macros: full(100, { protein: mine(22) }) }), after: { food: "Tuna", qty: 4, unit: "pcs" }, others: [tuna], tracked: TRACKED, now: NOW });
  assert.deepEqual([got.macros.calories.low, got.macros.protein, got.estimateStatus], [300, mine(22), "done"]);
  assert.deepEqual(got.nutrition, { at: 700, from: { id: 5, date: "2026-11-20" } });
});

test("a rename where everything tracked is typed asks nobody", () => {
  const got = edit(entry({ macros: full(100, { calories: mine(1), protein: mine(2), carbs: mine(3) }) }), { food: "Tuna" });
  assert.deepEqual([got.estimateStatus, got.nutrition], ["manual", undefined]);
});

test("typing a number makes it mine and the entry the one to remember", () => {
  const got = edit(entry({ nutrition: { at: 500, from: { id: 9, date: "2026-11-01" } } }), {}, { typed: { protein: 22 } });
  assert.deepEqual(got.macros.protein, mine(22));
  assert.deepEqual(got.nutrition, { at: NOW });
  assert.equal(got.estimateStatus, "done");
});

test("typing numbers for the entry's own amount drops an older label amount", () => {
  assert.deepEqual(edit(entry({ nutrition: { at: 5, basis: amount(56, "g") } }), {}, { typed: { protein: 22 } }).nutrition, { at: NOW });
});

test("a label amount on pieces goes through their weight", () => {
  const got = edit(entry({ nutrition: { at: 5, grams: 48 } }), {}, { typed: { protein: 11 }, basis: amount(56, "g") });
  near(got.macros.protein.low, 9.429); // 11 x 48/56
  assert.deepEqual(got.nutrition.basis, amount(56, "g"));
});

test("clearing a tracked number hands it back to the AI; an untracked one is just gone", () => {
  const e = entry({ macros: full(100, { protein: mine(22), sodium: mine(5) }) });
  const tracked = edit(e, {}, { cleared: ["protein"] });
  assert.deepEqual([tracked.macros.protein, tracked.estimateStatus], [undefined, "pending"]);
  const other = edit(e, {}, { cleared: ["sodium"] });
  assert.deepEqual([other.macros.sodium, other.estimateStatus], [undefined, "done"]);
});

test("correcting the weight rescales the AI's numbers, not the typed ones", () => {
  const e = entry({ macros: full(100, { protein: mine(22) }), nutrition: { at: 5, grams: 48, from: { id: 9, date: "2026-11-01" } } });
  const got = edit(e, {}, { grams: 96 });
  assert.deepEqual([got.macros.calories.low, got.macros.protein, got.estimateStatus], [200, mine(22), "done"]);
  assert.deepEqual(got.nutrition, { at: NOW, grams: 96, gramsMine: true });
});

test("weight, amount and a typed number in one save", () => {
  const e = entry({ nutrition: { at: 5, grams: 48 } });
  const got = edit(e, { qty: 8 }, { grams: 192, typed: { protein: 11 }, basis: amount(96, "g") });
  assert.equal(got.macros.calories.low, 400); // x2 for the amount, x2 for the weight
  assert.deepEqual(got.macros.protein, mine(22)); // 11 per 96 g, 192 g eaten
});

test("ask again keeps the numbers and waits", () => {
  const e = entry({ nutrition: { at: 5, from: { id: 9, date: "2026-11-01" } } });
  const got = edit(e, {}, { askAgain: true });
  assert.deepEqual([got.macros, got.estimateStatus, got.nutrition.refresh], [e.macros, "pending", true]);
});

// ---- the AI's answer -------------------------------------------------------------

const answer = (kcal, over = {}) => ({ macros: full(kcal), basis: [{ ref: "canned sardines", note: "n", grams: 40, kcal: 95 }, { ref: "sardines, USDA", note: "m", grams: 56, kcal: 110 }], how: "average", ...over });
const apply = (e, a) => N.applyAnswer(e, a, { tracked: TRACKED, now: NOW });

test("whether the AI has to be asked", () => {
  assert.equal(N.needsAnswer(entry({ macros: {} }), TRACKED), true);
  assert.equal(N.needsAnswer(entry({ macros: three(1) }), TRACKED), false);
  assert.equal(N.needsAnswer(entry({ macros: three(1) }), [...TRACKED, "fiber"]), true);
  assert.equal(N.needsAnswer(entry({ nutrition: { refresh: true } }), TRACKED), true);
});

test("what is sent along as known", () => {
  const e = entry({ macros: { protein: mine(15.714), fat: { low: 3, high: 4 } } });
  assert.deepEqual(N.known(e), { protein: 15.71, fat: 3.5 });
  assert.deepEqual(N.known({ ...e, nutrition: { refresh: true } }), { protein: 15.71 });
  assert.equal(N.known(entry({ macros: {} })), undefined);
});

test("a first answer fills all eight and says what it was based on", () => {
  const got = apply(entry({ macros: {}, estimateStatus: "pending" }), answer(102));
  assert.equal(got.estimateStatus, "done");
  assert.deepEqual(Object.keys(got.macros).length, 8);
  assert.deepEqual(got.nutrition, { why: answer(1).basis, how: "average", asked: amount(4, "pcs"), grams: 48, at: NOW });
});

test("filling gaps changes no number that is there", () => {
  const got = apply(entry({ macros: { protein: mine(22), calories: { low: 7, high: 8 } }, estimateStatus: "pending" }), answer(102));
  assert.deepEqual([got.macros.protein, got.macros.calories, got.macros.fat], [mine(22), { low: 7, high: 8 }, { low: 3, high: 4 }]);
});

test("ask again replaces every number that is not typed", () => {
  const got = apply(entry({ macros: full(100, { protein: mine(22) }), nutrition: { at: 5, refresh: true, from: { id: 9, date: "2026-11-01" }, why: [{ ref: "old" }], grams: 10 } }), answer(102));
  assert.deepEqual([got.macros.calories, got.macros.protein], [{ low: 102, high: 102 }, mine(22)]);
  assert.deepEqual(got.nutrition, { why: answer(1).basis, how: "average", asked: amount(4, "pcs"), grams: 48, at: NOW });
});

test("a photo entry asked about again is no longer the photo's", () => {
  assert.equal("photo" in apply(entry({ nutrition: { photo: true, refresh: true } }), answer(102)).nutrition, false);
  assert.equal(apply(entry({ nutrition: { photo: true, refresh: true } }), null).nutrition.photo, true);
  assert.equal(apply(entry({ macros: three(1), nutrition: { photo: true } }), answer(102)).nutrition.photo, true);
});

test("no answer leaves the numbers as they are", () => {
  for (const none of [null, undefined, {}]) {
    const e = entry({ nutrition: { refresh: true, at: 5 } });
    assert.deepEqual(apply(e, none), { macros: e.macros, nutrition: e.nutrition, estimateStatus: "error" });
  }
});

test("a partial answer keeps what it does not mention, and is an error if something tracked is missing", () => {
  const a = answer(102); delete a.macros.carbs;
  assert.equal(apply(entry({ macros: {} }), a).estimateStatus, "error");
  const again = apply(entry({ nutrition: { refresh: true } }), a);
  assert.deepEqual([again.macros.carbs, again.estimateStatus], [{ low: 1, high: 2 }, "done"]);
});

test("the user's own weight stands: the answer is brought to it", () => {
  const got = apply(entry({ nutrition: { refresh: true, grams: 96, gramsMine: true } }), answer(100));
  assert.deepEqual([got.macros.calories.low, got.nutrition.grams, got.nutrition.gramsMine], [200, 96, true]);
});

test("an entry in grams stores no assumed weight", () => {
  assert.equal(apply(entry({ qty: 80, unit: "g", macros: {} }), answer(100)).nutrition.grams, undefined);
});

test("small weights keep a decimal", () => {
  const a = answer(5, { basis: [{ grams: 1.2 }, { grams: 1.3 }] });
  assert.equal(apply(entry({ macros: {} }), a).nutrition.grams, 1.3);
});

test("today's proxy, which sends no basis, still works", () => {
  const fresh = apply(entry({ macros: {} }), { macros: full(9) });
  assert.deepEqual([fresh.estimateStatus, fresh.nutrition], ["done", { at: NOW }]);
  const again = apply(entry({ nutrition: { refresh: true, why: [{ ref: "old" }], how: "one", asked: amount(4, "pcs"), grams: 48 } }), { macros: full(9) });
  assert.deepEqual(again.nutrition, { at: NOW }, "the old explanation is not for the new numbers");
});

test("gaps filled on a reused entry keep the explanation of the rest", () => {
  const got = apply(entry({ macros: { protein: mine(1) }, nutrition: { why: [{ ref: "old" }], how: "one", from: { id: 9, date: "2026-11-01" } } }), answer(100));
  assert.deepEqual([got.nutrition.why, got.nutrition.from], [[{ ref: "old" }], { id: 9, date: "2026-11-01" }]);
});

test("numbers are stored without floating-point noise", () => {
  assert.deepEqual(apply(entry({ macros: {} }), { macros: full(0.6499999999999999) }).macros.calories, { low: 0.65, high: 0.65 });
});
```

- [ ] **Step 2: Run** — expected: the new tests fail (`N.findRemembered is not a function` and so on).

- [ ] **Step 3: Implement**

<!-- edit www/nutrition.js @T3 -->
```js
  return { unit, ratio, unitsFor, scale, sameFood };
```
```js
  // ---- Remembering -------------------------------------------------------------

  const loggedAt = (e) => Date.parse(`${e.date}T${e.time || "00:00"}`) || 0;
  // When an entry's numbers were decided: typed, or answered by the AI.
  const decidedAt = (e) => (e.nutrition && e.nutrition.at) || loggedAt(e);

  // The past entry whose numbers a new log of this food starts from.
  function findRemembered(entries, food, amount) {
    let best = null;
    for (const e of entries) {
      const n = e.nutrition || {};
      if (!sameFood(e.food, food) || n.photo || !["done", "manual"].includes(e.estimateStatus)) continue;
      if (!complete(e.macros) && !mineIds(e.macros).length) continue;
      const k = ratio(e, amount, n.grams);
      if (k === null) continue;
      if (!best || (decidedAt(e) - decidedAt(best.entry) || e.id - best.entry.id) > 0) best = { entry: e, ratio: k };
    }
    return best;
  }

  function reuse({ entry, ratio: k }) {
    const { refresh, ...nutrition } = entry.nutrition || {};
    nutrition.at = decidedAt(entry);
    nutrition.from = nutrition.from || { id: entry.id, date: entry.date };
    if (nutrition.grams > 0) nutrition.grams = round(nutrition.grams * k, 3);
    return { macros: scale(entry.macros, k), nutrition };
  }

  function latestLog(entries, food) {
    return entries.filter((e) => sameFood(e.food, food))
      .reduce((a, b) => (!a || (loggedAt(b) - loggedAt(a) || b.id - a.id) > 0 ? b : a), null);
  }

  // ---- Saving --------------------------------------------------------------------

  function statusFor(macros, tracked, nutrition) {
    if (nutrition && nutrition.refresh) return "pending";
    if (!tracked.every((id) => has(macros, id))) return "pending";
    return tracked.every((id) => isMine(macros, id)) ? "manual" : "done";
  }

  // What a changed food or amount means for the numbers.
  function editPlan(before, after) {
    if (!sameFood(before.food, after.food)) return { kind: "lookup" };
    if (Number(before.qty) === Number(after.qty) && unit(before.unit) === unit(after.unit)) return { kind: "keep" };
    const k = ratio(before, after, before.nutrition && before.nutrition.grams);
    return k === null ? { kind: "lookup" } : { kind: "scale", ratio: k };
  }

  // The numbers an entry is saved with.
  //   before   the entry as it was, or null when adding
  //   after    { food, qty, unit }
  //   form     { typed: { id: number }, cleared: [id], basis, grams, askAgain } or null;
  //            typed numbers are for `basis`, or for the entry's own amount without one
  //   others   the other entries, to remember from
  function resolve({ before = null, after, form = null, others = [], tracked, now }) {
    const { typed = {}, cleared = [], basis = null, grams = null, askAgain = false } = form || {};
    let macros = before ? { ...(before.macros || {}) } : {};
    let n = before ? { ...(before.nutrition || {}) } : {};
    let newStatus = !before;

    const plan = before ? editPlan(before, after) : { kind: "lookup" };
    if (plan.kind === "scale") {
      macros = scale(macros, plan.ratio);
      if (n.grams > 0) n.grams = round(n.grams * plan.ratio, 3);
    } else if (plan.kind === "lookup") {
      const own = pick(macros, mineIds(macros));
      const found = findRemembered(others, after.food, after);
      if (found) {
        const got = reuse(found);
        macros = { ...got.macros, ...own };
        n = got.nutrition;
      } else {
        delete n.grams; // the weight of what it was before
        delete n.gramsMine;
        if (theirIds(macros).length) n.refresh = true; // the old numbers stay until the answer lands
      }
      newStatus = true;
    }

    const weighed = grams > 0 && n.grams > 0 && grams !== n.grams;
    if (weighed) {
      macros = { ...macros, ...scale(pick(macros, theirIds(macros)), grams / n.grams) };
      n.grams = grams;
      n.gramsMine = true;
    }

    const typedIds = Object.keys(typed);
    const per = (basis && ratio(after, basis, n.grams)) || 1; // how many times the entry the basis is
    for (const id of typedIds) {
      const total = round(typed[id] / per, 3);
      macros[id] = { low: total, high: total, mine: true };
    }
    for (const id of cleared) delete macros[id];
    if (typedIds.length) {
      if (per !== 1) n.basis = { qty: basis.qty, unit: basis.unit };
      else delete n.basis;
    }
    if (typedIds.length || weighed) { n.at = now; delete n.from; }
    if (typedIds.length || cleared.length) newStatus = true;

    if (askAgain) { n.refresh = true; newStatus = true; }
    else if (tracked.every((id) => isMine(macros, id))) delete n.refresh;

    return {
      macros,
      nutrition: Object.keys(n).length ? n : undefined,
      estimateStatus: newStatus ? statusFor(macros, tracked, n) : before.estimateStatus,
    };
  }

  // ---- The AI's answer -------------------------------------------------------------

  function needsAnswer(entry, tracked) {
    return !!(entry.nutrition && entry.nutrition.refresh) || !tracked.every((id) => has(entry.macros, id));
  }

  // The totals that will not be replaced, for the AI to keep the rest consistent with.
  function known(entry) {
    const refresh = entry.nutrition && entry.nutrition.refresh;
    const ids = refresh ? mineIds(entry.macros) : IDS.filter((id) => has(entry.macros, id));
    if (!ids.length) return undefined;
    return Object.fromEntries(ids.map((id) => [id, round((entry.macros[id].low + entry.macros[id].high) / 2, 2)]));
  }

  function assumedGrams(basis) {
    const weights = basis.map((b) => b.grams).filter((g) => g > 0);
    if (!weights.length) return null;
    const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
    return round(mean, mean < 10 ? 1 : 0);
  }

  function applyAnswer(entry, answer, { tracked, now }) {
    const before = entry.macros || {};
    if (!answer || !answer.macros) return { macros: before, nutrition: entry.nutrition, estimateStatus: "error" };
    const n = { ...(entry.nutrition || {}) };
    const basis = (answer.basis || []).slice(0, 2);
    const assumed = assumedGrams(basis);
    const ownWeight = n.gramsMine && n.grams > 0;
    const k = ownWeight && assumed ? n.grams / assumed : 1; // the answer is for the weight it assumed

    const macros = { ...before };
    for (const id of IDS) {
      const m = Macros.getMacro(answer, id);
      if (!m || isMine(before, id) || (has(before, id) && !n.refresh)) continue;
      macros[id] = { low: round(m.low * k, 3), high: round(m.high * k, 3) };
    }

    if (n.refresh) {
      for (const field of ["refresh", "from", "why", "how", "asked", "photo"]) delete n[field];
      if (!ownWeight) delete n.grams;
    }
    if (basis.length && !n.why) {
      n.why = basis;
      n.how = answer.how || (basis.length > 1 ? "average" : "one");
      n.asked = { qty: entry.qty, unit: entry.unit };
      if (!ownWeight && !(n.grams > 0) && assumed && !isWeight(entry.unit)) n.grams = assumed;
    }
    n.at = now;
    const status = statusFor(macros, tracked, null);
    return { macros, nutrition: n, estimateStatus: status === "pending" ? "error" : status };
  }

  return {
    unit, ratio, unitsFor, scale, sameFood,
    findRemembered, reuse, latestLog, statusFor, editPlan, resolve, needsAnswer, known, applyAnswer,
  };
```

- [ ] **Step 4: Run** `node --test tests/nutrition.test.js` — expected: all pass.
- [ ] **Step 5: Commit** `feat(nutrition): remembering, editing and applying an answer`

---

### Task 4: The form's numbers, the explanation, the tag

**Files:** Modify `www/nutrition.js`, `tests/nutrition.test.js`

**Interfaces:**
- `createForm() -> form` with
  - `rebase({ macros, nutrition, qty, unit })`: what the entry would be saved with if nothing were typed. Call it first, and whenever that changes.
  - `text(id)`, `isMine(id)`, `type(id, text)`
  - `basis() -> { text, unit }`, `setBasis(text)`, `setBasisUnit(unit)`, `units() -> string[]`
  - `setWeight(text)`
  - `errors() -> { [id | "basis" | "weight"]: message }`
  - `result() -> { typed, cleared, basis, grams }`, the `form` argument of `resolve` (which also takes `askAgain`)
- `explain(entry) -> { weight: string | null, lines: string[] }`
- `tag(entry, today) -> string`
- `hasTheirs(entry) -> boolean`: it has a number the user did not type

- [ ] **Step 1: Failing tests**

<!-- append tests/nutrition.test.js @T4t -->
```js

// ---- the form ---------------------------------------------------------------------

const form = (over = {}) => {
  const f = N.createForm();
  f.rebase({ qty: 4, unit: "pcs", macros: { calories: { low: 100, high: 106 }, protein: mine(22) }, nutrition: { grams: 48 }, ...over });
  return f;
};
const inGrams = (qty, macros = {}) => form({ qty, unit: "g", macros, nutrition: undefined });

test("the form shows saved numbers, an AI range as its middle", () => {
  const f = form();
  assert.deepEqual([f.text("calories"), f.text("protein"), f.text("carbs")], ["103", "22", ""]);
  assert.deepEqual([f.isMine("calories"), f.isMine("protein"), f.isMine("carbs")], [false, true, false]);
  assert.deepEqual(f.basis(), { text: "4", unit: "pcs" });
  assert.deepEqual(f.result(), { typed: {}, cleared: [], basis: null, grams: null });
});

test("typing, clearing, and putting back what was there", () => {
  const f = form();
  f.type("calories", "120");
  f.type("protein", "");
  assert.deepEqual([f.text("calories"), f.isMine("calories"), f.isMine("protein")], ["120", true, false]);
  assert.deepEqual([f.result().typed, f.result().cleared], [{ calories: 120 }, ["protein"]]);
  f.type("calories", "103");
  f.type("protein", "22");
  assert.deepEqual([f.result().typed, f.result().cleared], [{}, []]);
});

test("a field that was blank and is blank again takes the number that arrives", () => {
  const f = form();
  f.type("carbs", "5");
  f.type("carbs", "");
  f.rebase({ qty: 4, unit: "pcs", macros: full(100) });
  assert.deepEqual([f.text("carbs"), f.result().typed, f.result().cleared], ["1.5", {}, []]);
});

test("saved numbers follow the entry; a typed one stays as typed, for the amount shown", () => {
  const f = form();
  f.type("carbs", "5");
  f.rebase({ qty: 6, unit: "pcs", macros: { calories: { low: 150, high: 159 }, protein: mine(33) }, nutrition: { grams: 72 } });
  assert.deepEqual([f.text("calories"), f.text("protein"), f.text("carbs")], ["154.5", "33", "5"]);
  assert.deepEqual(f.basis(), { text: "6", unit: "pcs" });
  assert.equal(f.result().basis, null);
});

test("a label is typed as printed, before or after saying what it is for", () => {
  const eaten = { food: "Sardines", qty: 80, unit: "g" }; // 11 g of protein as estimated, 11 g per 56 g on the label
  for (const numbersFirst of [true, false]) {
    const f = inGrams(80, full(160));
    if (numbersFirst) f.type("protein", "11");
    f.setBasis("5"); // on the way to 56
    f.setBasis("56");
    if (!numbersFirst) f.type("protein", "11");
    assert.deepEqual([f.text("protein"), f.text("calories")], ["11", "112"]);
    const saved = N.resolve({ before: entry({ ...eaten, macros: full(160) }), after: eaten, form: f.result(), tracked: TRACKED, now: NOW });
    assert.deepEqual([saved.macros.protein, saved.macros.calories], [mine(15.714), { low: 160, high: 160 }]);
    assert.deepEqual(saved.nutrition.basis, amount(56, "g"));
  }
});

test("the label's amount stays put when the amount eaten changes", () => {
  const f = inGrams(80);
  f.setBasis("56");
  f.type("protein", "11");
  f.rebase({ qty: 100, unit: "g", macros: {} });
  assert.deepEqual([f.text("protein"), f.basis().text, f.result().typed], ["11", "56", { protein: 11 }]);
});

test("another unit for the same amount changes no number", () => {
  const f = form();
  f.setBasisUnit("g");
  assert.deepEqual([f.basis(), f.text("calories"), f.text("protein")], [{ text: "48", unit: "g" }, "103", "22"]);
  f.setBasis("24");
  assert.deepEqual([f.text("calories"), f.text("protein")], ["51.5", "11"]);
  f.setBasisUnit("oz");
  assert.deepEqual([f.basis(), f.text("protein")], [{ text: "0.8466", unit: "oz" }, "11"]);
  f.setBasisUnit("pcs");
  assert.deepEqual(f.basis(), { text: "2", unit: "pcs" });
  assert.deepEqual(f.units(), ["pcs", "g", "kg", "oz", "lb"]);
});

test("an amount the label's does not convert to is refused, not taken for something else", () => {
  const f = inGrams(80);
  f.setBasis("56");
  f.type("protein", "11");
  f.rebase({ qty: 1, unit: "plate", macros: {} });
  assert.equal(f.errors().basis, "56 g does not convert to 1 plate");
  assert.deepEqual([f.basis(), f.units()], [{ text: "56", unit: "g" }, ["plate", "g"]]);
  f.rebase({ qty: 3, unit: "oz", macros: {} });
  assert.deepEqual([f.errors(), f.result().basis], [{}, amount(56, "g")]);
});

test("invalid input is reported and kept", () => {
  const f = form();
  for (const bad of ["abc", "-1", "1,200", "1e3", "100000", "."]) {
    f.type("calories", bad);
    assert.deepEqual([f.text("calories"), f.isMine("calories")], [bad, false]);
    assert.match(f.errors().calories, /number/, bad);
  }
  for (const good of ["0", "12.5", ".5", "12.", "99999", " 7 "]) {
    f.type("calories", good);
    assert.deepEqual(f.errors(), {}, good);
  }
  for (const bad of ["0", "", "x"]) {
    f.setBasis(bad);
    assert.deepEqual([f.basis().text, f.errors().basis], [bad, "Enter an amount above 0"]);
  }
  f.setBasis("4");
  for (const bad of ["0", "x"]) {
    f.setWeight(bad);
    assert.match(f.errors().weight, /weight/);
  }
  f.setWeight("");
  assert.deepEqual(f.errors(), {});
});

test("what the numbers are for does not matter while none is typed", () => {
  const f = form();
  f.setBasis("");
  assert.deepEqual(f.errors(), {});
});

test("correcting the weight shows its effect at once, on the AI's numbers only", () => {
  const f = form();
  f.setWeight("96");
  assert.deepEqual([f.text("calories"), f.text("protein"), f.result().grams], ["206", "22", 96]);
  f.rebase({ qty: 8, unit: "pcs", macros: { calories: { low: 200, high: 212 } }, nutrition: { grams: 96 } });
  assert.deepEqual([f.text("calories"), f.result().grams], ["206", null], "the new amount weighs that anyway");
  f.rebase({ qty: 8, unit: "pcs", macros: {}, nutrition: undefined });
  assert.equal(f.result().grams, null, "there is no weight to correct");
});

test("numbers that arrive while the form is open appear, without touching what was typed", () => {
  const f = form({ macros: {}, nutrition: undefined });
  f.type("protein", "22");
  f.rebase({ qty: 4, unit: "pcs", macros: full(100), nutrition: { grams: 48 } });
  assert.deepEqual([f.text("calories"), f.text("protein"), f.result().typed], ["100", "22", { protein: 22 }]);
});

test("a form for something that has no amount yet", () => {
  const f = form({ qty: NaN, unit: "", macros: {}, nutrition: undefined });
  assert.deepEqual(f.basis(), { text: "", unit: "" });
  f.type("protein", "22");
  f.rebase({ qty: 1, unit: "pc", macros: {} });
  assert.deepEqual([f.errors(), f.result().typed, f.result().basis], [{}, { protein: 22 }, null]);
});

test("whether an entry has numbers the user did not type", () => {
  assert.equal(N.hasTheirs(entry()), true);
  assert.equal(N.hasTheirs(entry({ macros: { protein: mine(1) } })), false);
  assert.equal(N.hasTheirs(entry({ macros: {} })), false);
});

// ---- the explanation ----------------------------------------------------------------

const why = [{ ref: "canned sardines in oil, drained", note: "From USDA.", grams: 46, kcal: 95 }, { ref: "canned sardines in oil, drained", note: "Label values.", grams: 50, kcal: 110 }];
const TODAY = "2026-11-23";
const explained = (over, nutrition) => N.explain(entry({ ...over, nutrition }), TODAY);

test("two estimates, averaged", () => {
  assert.deepEqual(explained({}, { grams: 48, why, how: "average", asked: amount(4, "pcs") }), {
    weight: "Assumed weight 48 g (12 g each)",
    lines: [
      "Based on canned sardines in oil, drained",
      "Two estimates, 95 and 110 kcal, averaged",
      "From USDA.",
      "Label values.",
      "The AI works from what it knows about food. It does not look values up.",
    ],
  });
});

test("weights that differ a lot are both shown", () => {
  const apart = [{ ...why[0], grams: 40 }, { ...why[1], grams: 56 }];
  assert.equal(explained({}, { grams: 48, why: apart, how: "average", asked: amount(4, "pcs") }).weight, "Assumed weight 40–56 g, using 48 g");
  assert.equal(explained({ qty: 8 }, { grams: 96, why: apart, how: "average", asked: amount(4, "pcs") }).weight, "Assumed weight 80–112 g, using 96 g");
});

test("a corrected weight, one piece, and an entry already in grams", () => {
  assert.equal(explained({}, { grams: 90, gramsMine: true, why }).weight, "Your weight 90 g (22.5 g each)");
  assert.equal(explained({ qty: 1 }, { grams: 12, why: [why[0]] }).weight, "Assumed weight 12 g");
  assert.equal(explained({ qty: 80, unit: "g" }, { grams: 80, why }).weight, null);
});

test("estimates that disagreed, a single one, and unknown calories", () => {
  const second = (how, w) => explained({}, { why: w, how, asked: amount(4, "pcs") }).lines[1];
  assert.equal(second("both", [{ ...why[0], kcal: 60 }, { ...why[1], kcal: 200 }]), "Two estimates, 60 and 200 kcal, disagreed, so the range covers both");
  assert.equal(second("one", [why[0]]), "One estimate, 95 kcal");
  assert.equal(second("average", [{ ...why[0], kcal: null }, { ...why[1], kcal: null }]), "Two estimates, averaged");
});

test("numbers scaled from another amount say so", () => {
  const says = (over, nutrition) => explained(over, { why, how: "average", asked: amount(4, "pcs"), ...nutrition }).lines.find((l) => /^For /.test(l));
  assert.equal(says({ qty: 6 }), "For 4 pcs, scaled to 6 pcs");
  assert.equal(says({ unit: "pieces" }), undefined);
  assert.equal(says({ qty: 96, unit: "g" }, { grams: 96 }), "For 4 pcs, scaled to 96 g");
  assert.equal(says({ qty: 2, unit: "cups" }, { refresh: true }), "For 4 pcs", "not scaled: waiting for a new answer");
});

test("typed numbers, per the label's amount if there was one", () => {
  const macros = full(100, { protein: mine(15.714), sodium: mine(300) });
  assert.deepEqual(explained({ qty: 80, unit: "g", macros }, { basis: amount(56, "g") }).lines, ["Protein 11 g per 56 g is your number", "Sodium 210 mg per 56 g is your number"]);
  assert.deepEqual(explained({ macros: full(100, { protein: mine(22) }) }, {}).lines, ["Protein 22 g is your number"]);
});

test("reused, photographed, and unexplained entries", () => {
  assert.ok(explained({}, { from: { id: 1, date: "2026-11-20" } }).lines.includes("Numbers from Nov 20"));
  assert.ok(explained({}, { from: { id: 1, date: "2025-11-20" } }).lines.includes("Numbers from Nov 20, 2025"));
  assert.deepEqual(explained({}, { photo: true }).lines, ["Estimated from your photo"]);
  assert.deepEqual(N.explain(entry(), TODAY).lines, ["No explanation was saved for this entry. Ask AI again to get one."]);
  assert.deepEqual(N.explain(entry({ macros: {}, estimateStatus: "pending" }), TODAY), { weight: null, lines: [] });
});

test("the tag names the day, and the year if it is another one", () => {
  const from = (date) => N.tag(entry({ nutrition: { from: { id: 1, date } } }), TODAY);
  assert.equal(from("2026-11-20"), "from Nov 20");
  assert.equal(from("2025-02-03"), "from Feb 3, 2025");
  assert.equal(N.tag(entry(), TODAY), "");
});
```

- [ ] **Step 2: Run** — expected: the new tests fail (`N.createForm is not a function`).

- [ ] **Step 3: Implement**

<!-- edit www/nutrition.js @T4 -->
```js
  return {
    unit, ratio, unitsFor, scale, sameFood,
    findRemembered, reuse, latestLog, statusFor, editPlan, resolve, needsAnswer, known, applyAnswer,
  };
```
```js
  // ---- The form ----------------------------------------------------------------------

  // A typed number, or null. No commas: 1,5 and 1,200 would be guesses.
  function parseNumber(text) {
    const t = String(text).trim();
    if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    return Number(t) <= 99999 ? Number(t) : null;
  }

  // What is typed into an entry's form, on top of the numbers it would be saved with
  // otherwise (see resolve). All are shown for `basis`, a label's 56 g, or for the
  // entry's own amount until the user sets one.
  function createForm() {
    let saved = {}, savedGrams = null, amount = {};
    let basis = null;    // { qty, unit }, once set
    let badBasis = null; // what its field says while that is not an amount
    let weightText = "";
    const typed = new Map(); // id -> text

    const weight = () => parseNumber(weightText) || null;
    const grams = () => (savedGrams && weight()) || savedGrams;
    const times = () => (basis ? ratio(amount, basis, grams()) : 1); // null if it does not convert

    function savedText(id) {
      if (!has(saved, id)) return "";
      const byWeight = savedGrams && weight() && !isMine(saved, id) ? weight() / savedGrams : 1;
      return show(((saved[id].low + saved[id].high) / 2) * byWeight * (times() || 1));
    }
    // Typing exactly what is saved changes nothing.
    const changed = () => [...typed].filter(([id, text]) => text.trim() !== savedText(id));
    const numbers = () => changed().map(([id, text]) => [id, parseNumber(text)]).filter(([, n]) => n !== null);

    return {
      rebase(entry) {
        saved = entry.macros || {};
        savedGrams = (entry.nutrition && entry.nutrition.grams) || null;
        amount = { qty: entry.qty, unit: entry.unit };
      },
      text: (id) => (typed.has(id) ? typed.get(id) : savedText(id)),
      isMine: (id) => (changed().some(([other]) => other === id) ? parseNumber(typed.get(id)) !== null : isMine(saved, id)),
      type(id, text) {
        if (text.trim() === "" && !has(saved, id)) typed.delete(id); // still blank
        else typed.set(id, text);
      },

      basis() {
        const { qty, unit: u } = basis || amount;
        return { text: badBasis !== null ? badBasis : qty > 0 ? String(qty) : "", unit: u };
      },
      setBasis(text) {
        const qty = parseNumber(text);
        badBasis = qty > 0 ? null : text;
        if (qty > 0) basis = { qty, unit: (basis || amount).unit };
      },
      // The same amount in another unit: 4 pcs becomes 48 g.
      setBasisUnit(u) {
        const one = ratio(amount, { qty: 1, unit: u }, grams());
        const qty = times() && one ? Number((times() / one).toPrecision(4)) : (basis || amount).qty;
        basis = { qty, unit: u };
        badBasis = null;
      },
      units() {
        const units = unitsFor(amount, grams());
        return !basis || units.some((u) => unit(u) === unit(basis.unit)) ? units : [...units, basis.unit];
      },

      setWeight(text) { weightText = String(text); },

      errors() {
        const out = {};
        for (const [id, text] of changed()) {
          if (text.trim() !== "" && parseNumber(text) === null) out[id] = "Enter a number from 0 to 99,999, like 12.5";
        }
        if (weightText.trim() !== "" && !weight()) out.weight = "Enter the weight in grams, above 0";
        if (numbers().length && badBasis !== null) out.basis = "Enter an amount above 0";
        else if (numbers().length && times() === null) out.basis = `${sayAmount(basis)} does not convert to ${sayAmount(amount)}`;
        return out;
      },
      result: () => ({
        typed: Object.fromEntries(numbers()),
        cleared: changed().filter(([, text]) => text.trim() === "").map(([id]) => id),
        basis: basis ? { ...basis } : null,
        grams: savedGrams && weight() !== savedGrams ? weight() : null,
      }),
    };
  }

  // ---- The explanation -----------------------------------------------------------------

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayName = (date) => { const [, m, d] = date.split("-").map(Number); return `${MONTHS[m - 1]} ${d}`; };
  const sayAmount = ({ qty, unit: u }) => `${show(Number(qty))} ${u}`;

  function explainWeight(entry, n, estimates) {
    if (!(n.grams > 0) || isWeight(entry.unit)) return null;
    const each = Number(entry.qty) > 0 && Number(entry.qty) !== 1 ? ` (${show(n.grams / entry.qty)} g each)` : "";
    if (n.gramsMine) return `Your weight ${show(n.grams)} g${each}`;
    const weights = estimates.map((w) => w.grams).filter((g) => g > 0);
    const low = Math.min(...weights), high = Math.max(...weights);
    if (weights.length > 1 && (high - low) / high > 0.2) {
      const k = n.grams / (weights.reduce((a, b) => a + b, 0) / weights.length); // scaled since
      return `Assumed weight ${Math.round(low * k)}–${Math.round(high * k)} g, using ${show(n.grams)} g`;
    }
    return `Assumed weight ${show(n.grams)} g${each}`;
  }

  function explain(entry, today) {
    const n = entry.nutrition || {};
    const estimates = n.why || [];
    const lines = [];

    if (estimates.length) {
      const refs = [...new Set(estimates.map((w) => w.ref).filter(Boolean))];
      if (refs.length) lines.push(`Based on ${refs.join("; ")}`);
      const kcal = estimates.map((w) => w.kcal).filter((k) => k != null);
      const say = kcal.length === estimates.length ? `, ${kcal.join(" and ")} kcal` : "";
      lines.push(n.how === "both" ? `Two estimates${say}, disagreed, so the range covers both`
        : estimates.length > 1 ? `Two estimates${say}, averaged`
        : `One estimate${say}`);
      const k = n.asked ? ratio(n.asked, entry) : 1;
      if (k === null && n.refresh) lines.push(`For ${sayAmount(n.asked)}`); // not scaled: a new answer is due
      else if (k !== 1) lines.push(`For ${sayAmount(n.asked)}, scaled to ${sayAmount(entry)}`);
      lines.push(...new Set(estimates.map((w) => w.note).filter(Boolean)));
      lines.push("The AI works from what it knows about food. It does not look values up.");
    }

    const per = n.basis ? ratio(entry, n.basis, n.grams) : null;
    for (const id of mineIds(entry.macros)) {
      const m = Macros.byId(id), total = entry.macros[id].low;
      lines.push(`${m.label} ${show(per ? total * per : total)} ${m.unit}${per ? ` per ${sayAmount(n.basis)}` : ""} is your number`);
    }
    if (n.from) lines.push(`Numbers ${tag(entry, today)}`);
    if (n.photo) lines.push("Estimated from your photo");
    if (!lines.length && hasTheirs(entry)) lines.push("No explanation was saved for this entry. Ask AI again to get one.");
    return { weight: explainWeight(entry, n, estimates), lines };
  }

  function tag(entry, today) {
    const from = entry.nutrition && entry.nutrition.from;
    if (!from) return "";
    const year = from.date.slice(0, 4);
    return `from ${dayName(from.date)}${year === today.slice(0, 4) ? "" : `, ${year}`}`;
  }

  const hasTheirs = (entry) => theirIds(entry.macros).length > 0;

  return {
    unit, ratio, unitsFor, scale, sameFood,
    findRemembered, reuse, latestLog, statusFor, editPlan, resolve, needsAnswer, known, applyAnswer,
    createForm, explain, tag, hasTheirs,
  };
```

- [ ] **Step 4: Run** `node --test tests/nutrition.test.js` — expected: all pass.
- [ ] **Step 5: Commit** `feat(nutrition): form state, explanation and tag`

---

### Task 5: Rows, the estimate queue, conditional updates

**Files:** Modify `www/index.html`, `www/app.js`, `tests/helpers/app-harness.js`; create `tests/nutrition-app.test.js`

- [ ] **Step 1: Failing tests**

<!-- write tests/nutrition-app.test.js @T5t -->
```js
// Nutrition details, end to end: the real www/app.js driven through its own event
// handlers against a fake server (see helpers/app-harness.js).
const test = require("node:test");
const assert = require("node:assert");
const { bootApp, createFakeServer, createDevice } = require("./helpers/app-harness.js");

const PROFILE = { height: 170, age: 32, protein_low: 135, protein_high: 150, weight_loss_goal: "0.50 kg/week" };
const range = (n) => ({ low: n, high: n });
const mine = (n) => ({ low: n, high: n, mine: true });
const eight = (kcal, over = {}) => ({
  calories: range(kcal), protein: range(10), carbs: range(1), fat: range(3),
  fiber: range(2), sugar: range(1), saturatedFat: range(1), sodium: range(200), ...over,
});
const row = (id, food, over = {}) => ({
  id, date: "2026-11-20", time: "08:00", food, qty: 4, unit: "pcs", macros: eight(100), estimate_status: "done", nutrition: null,
  cal_low: 100, cal_high: 100, pro_low: 10, pro_high: 10, ai_thought_process: null, ...over,
});
const day = { id: 1, date: "2026-11-23", weight: 168, activity: "Gym", incomplete: false, age: 32, deficit: 550, protein_target_low: 135, protein_target_high: 150 };
const serverWith = (...food) => {
  const server = createFakeServer({ profile: PROFILE, food, days: [day] });
  server.ai = () => ({ data: { macros: eight(200) }, error: null });
  return server;
};
const on = (server, food) => server.food().find((r) => r.food === food);
function holdAi(server) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const answer = server.ai;
  server.ai = async (body) => { await gate; return answer(body); };
  return () => { server.ai = answer; release(); };
}

// ---- the queue -------------------------------------------------------------------

test("all eight nutrients are saved, not only the tracked ones", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  app.addFood("Tofu");
  await app.settle();
  assert.deepEqual(Object.keys(on(server, "Tofu").macros).sort(), Object.keys(eight(1)).sort());
  assert.equal(on(server, "Tofu").estimate_status, "done");
  assert.ok(on(server, "Tofu").nutrition.at > 0);
});

test("what the AI based its answer on is kept", async () => {
  const server = serverWith();
  const basis = [{ ref: "firm tofu", note: "USDA.", grams: 100, kcal: 200 }];
  server.ai = () => ({ data: { macros: eight(200), basis, how: "one" }, error: null });
  const app = await bootApp({ server });
  app.addFood("Tofu");
  await app.settle();
  const { at, ...rest } = on(server, "Tofu").nutrition;
  assert.deepEqual(rest, { why: basis, how: "one", asked: { qty: 1, unit: "pc" }, grams: 100 });
});

test("the column survives a reload and later saves", async () => {
  const nutrition = { at: 5, grams: 48, from: { id: 9, date: "2026-11-01" } };
  const server = serverWith(row(1, "Sardines", { nutrition }));
  const app = await bootApp({ server });
  assert.deepEqual(app.entry("Sardines").nutrition, nutrition);
  app.editFood("Sardines", { time: "19:30" });
  await app.settle();
  assert.deepEqual([on(server, "Sardines").nutrition, on(server, "Sardines").time], [nutrition, "19:30"]);
});

test("a number typed on another device while the AI works is not overwritten", async () => {
  const server = serverWith();
  const phone = await bootApp({ server });
  const release = holdAi(server);
  phone.addFood("Tofu");
  await phone.settle();
  // Another device types a number; the entry is still waiting for the rest.
  Object.assign(server.rowOf("food_entries", "Tofu"), { macros: { protein: mine(22) } });
  release();
  await phone.settle();
  assert.deepEqual(on(server, "Tofu").macros, { protein: mine(22) });
  assert.equal(on(server, "Tofu").estimate_status, "pending");
});

test("an estimate that finds its numbers already there asks nobody", async () => {
  const server = serverWith(row(1, "Sardines", { estimate_status: "pending" }));
  const device = createDevice();
  await bootApp({ server, device });
  const app = await bootApp({ server, device }); // resumes at its second start
  await app.settle();
  assert.deepEqual(server.aiCalls, []);
  assert.equal(on(server, "Sardines").estimate_status, "done");
});
```

- [ ] **Step 2: Run** `node --test tests/nutrition-app.test.js` — expected: failures (missing column in rows, only tracked nutrients, `rowOf` missing).

- [ ] **Step 3: Implement**

<!-- edit tests/helpers/app-harness.js @T5 -->
```js
    food: () => clone(db.food_entries),
```
```js
    food: () => clone(db.food_entries),
    rowOf: (table, food) => db[table].find((r) => r.food === food), // live, to change behind the app's back
```

<!-- edit www/index.html @T5 -->
```html
  <script src="sync.js"></script>
```
```html
  <script src="sync.js"></script>
  <script src="nutrition.js"></script>
```

<!-- edit www/app.js @T5 -->
```js
    estimateStatus: r.estimate_status || null };
  if (r.macros) { base.macros = r.macros; return base; }
```
```js
    estimateStatus: r.estimate_status || null };
  if (r.nutrition) base.nutrition = r.nutrition;
  if (r.macros) { base.macros = r.macros; return base; }
```

<!-- edit www/app.js @T5 -->
```js
    macros: e.macros || {}, estimate_status: e.estimateStatus || null,
```
```js
    macros: e.macros || {}, estimate_status: e.estimateStatus || null, nutrition: e.nutrition || null,
```

<!-- edit www/app.js @T5 -->
```js
// The AI's answer to each entry (or that there is none): not the user's change, so it
// only fills in a row that is still waiting for this food and amount. It must not
// bring back an entry deleted on another device, or undo an edit made there.
function saveEstimates(entries, answered) {
  for (const { entry, asked } of answered) {
    const { macros, estimate_status, cal_low, cal_high, pro_low, pro_high } = foodJsToRow(entry);
    outbox.update(FOOD_SYNC.table, FOOD_SYNC.keyOf(entry),
      { macros, estimate_status, cal_low, cal_high, pro_low, pro_high }, { ...asked, estimate_status: "pending" });
```
```js
// The AI's answer to each entry (or that there is none): not the user's change, so it
// only fills in a row that is still waiting, for this food and amount, with the numbers
// it had when the AI was asked. It must not bring back an entry deleted on another
// device, undo an edit made there, or replace a number someone typed meanwhile.
function saveEstimates(entries, answered) {
  for (const { entry, asked } of answered) {
    const { macros, estimate_status, nutrition, cal_low, cal_high, pro_low, pro_high } = foodJsToRow(entry);
    outbox.update(FOOD_SYNC.table, FOOD_SYNC.keyOf(entry),
      { macros, estimate_status, nutrition, cal_low, cal_high, pro_low, pro_high }, { ...asked, estimate_status: "pending" });
```

<!-- edit www/app.js @T5 -->
```js
const askedOf = ({ food, qty, unit }) => ({ food, qty, unit });
```
```js
// What an estimate is for; the numbers are copied, since entries are edited in place.
const askedOf = ({ food, qty, unit, macros }) => ({ food, qty, unit, macros: JSON.parse(JSON.stringify(macros || {})) });
const stillAsked = (entry, asked) => entry.estimateStatus === "pending" && Sync.matches(askedOf(entry), asked);
```

<!-- edit www/app.js @T5 -->
```js
      const ids = Macros.blankEnabled(entry, getEnabledMacros());
      if (!ids.length) {
        const fresh = loadFoodEntries();
        const t = fresh.find((e) => e.id === id);
        if (t) { t.estimateStatus = "manual"; saveEstimates(fresh, [{ entry: t, asked: askedOf(t) }]); }
        continue;
      }
      let filled = null, errStatus = null;
      const asked = askedOf(entry);
      try {
        const est = await callAi("estimate", asked);
        filled = est && est.macros ? est.macros : null;
      } catch (err) {
```
```js
      const tracked = getEnabledMacros();
      const asked = askedOf(entry);
      if (!Nutrition.needsAnswer(entry, tracked)) {
        entry.estimateStatus = Nutrition.statusFor(entry.macros, tracked, entry.nutrition);
        saveEstimates(snapshot, [{ entry, asked }]);
        renderFoodTable(); renderCalorieTracker();
        continue;
      }
      let answer = null, errStatus = null;
      const { food, qty, unit } = asked, known = Nutrition.known(entry);
      try {
        answer = await callAi("estimate", known ? { food, qty, unit, known } : { food, qty, unit });
      } catch (err) {
```

<!-- edit www/app.js @T5 -->
```js
      const found = fresh.find((e) => e.id === id);
      // Changed while this ran: the answer is for something else, and saving that
      // change has queued a new estimate.
      const t = found && !Macros.needsReestimate(asked, found) ? found : null;
```
```js
      const found = fresh.find((e) => e.id === id);
      // Changed while this ran (food, amount, or a number typed): the answer is for
      // something else, and saving that change has queued a new estimate if one is
      // still needed.
      const t = found && stillAsked(found, asked) ? found : null;
```

<!-- edit www/app.js @T5 -->
```js
        if (filled) {
          if (!t.macros) t.macros = {};
          for (const mid of ids) if (filled[mid]) t.macros[mid] = filled[mid];
          t.estimateStatus = ids.every((mid) => filled[mid]) ? "done" : "error";
        } else {
          t.estimateStatus = "error";
        }
        answered.push({ entry: t, asked });
```
```js
        Object.assign(t, Nutrition.applyAnswer(t, answer, { tracked, now: Date.now() }));
        answered.push({ entry: t, asked });
```

`Macros.blankEnabled` and `Macros.needsReestimate` are still used by tests and by nothing else after Task 6; leave them.

- [ ] **Step 4: Run** the whole suite — expected: all pass. (`tests/food-sync.test.js` keeps guarding the in-flight rules through `stillAsked`.)
- [ ] **Step 5: Commit** `feat(nutrition): nutrition column, all eight nutrients, answers never replace typed numbers`

---

### Task 6: Adding, editing, batch, photo, autofill

**Files:** Modify `www/app.js`, `www/macros.js`, `tests/macros.test.js`; test `tests/nutrition-app.test.js`

**Interfaces (used by Task 7):** in `www/app.js`
- `editedEntry() -> entry | null`: the entry the form is editing
- `formFood() -> { food, qty, unit }`
- `numbersFor(before, after, form?) -> { macros, nutrition, estimateStatus }`

- [ ] **Step 1: Failing tests**

<!-- append tests/nutrition-app.test.js @T6t -->
```js

// ---- saving without the Nutrition section ------------------------------------------

const type = (app, id, value, event = "input") => { app.el(id).value = String(value); app.fire(id, event); };

test("a remembered food is added with its numbers, without the AI", async () => {
  const server = serverWith(row(1, "Sardines", { nutrition: { at: 5, grams: 48 } }));
  const app = await bootApp({ server });
  app.addFood("sardines", { qty: 2, unit: "pieces" });
  await app.settle();
  const saved = on(server, "sardines");
  assert.deepEqual(server.aiCalls, []);
  assert.deepEqual([saved.macros.calories, saved.estimate_status], [range(50), "done"]);
  assert.deepEqual(saved.nutrition, { at: 5, grams: 24, from: { id: 1, date: "2026-11-20" } });
});

test("an entry from before all eight nutrients were kept is asked about once, then remembered", async () => {
  const server = serverWith(row(1, "Sardines", { macros: { calories: range(1), protein: range(1), carbs: range(1), fat: range(1) } }));
  const app = await bootApp({ server });
  for (let i = 0; i < 2; i++) { app.addFood("Sardines", { qty: 4, unit: "pcs" }); await app.settle(); }
  assert.deepEqual(server.aiCalls, ["Sardines"]);
});

test("remembering works offline and syncs later", async () => {
  const server = serverWith(row(1, "Sardines"));
  const device = createDevice();
  const app = await bootApp({ server, device });
  device.online = false;
  app.addFood("Sardines", { qty: 8, unit: "pcs" });
  await app.settle();
  device.online = true;
  await app.windowEvent("online");
  const saved = server.food().filter((r) => r.food === "Sardines").find((r) => r.id !== 1);
  assert.deepEqual([saved.macros.calories, saved.estimate_status], [range(200), "done"]);
});

test("changing the amount scales the numbers, without the AI", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }) }));
  const app = await bootApp({ server });
  app.editFood("Sardines", { qty: 6 });
  await app.settle();
  assert.deepEqual(server.aiCalls, []);
  assert.deepEqual([on(server, "Sardines").macros.calories, on(server, "Sardines").macros.protein], [range(150), mine(33)]);
  assert.equal(on(server, "Sardines").cal_low, 150);
});

test("changing the amount while the first estimate runs asks for the new amount", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  server.ai = (body) => ({ data: { macros: eight(body.payload.qty * 10) }, error: null });
  const release = holdAi(server);
  app.addFood("Tofu", { qty: 1 });
  await app.settle();
  app.editFood("Tofu", { qty: 3 });
  release();
  await app.settle();
  assert.deepEqual(server.aiCalls, ["Tofu", "Tofu"]);
  assert.deepEqual(on(server, "Tofu").macros.calories, range(30));
});

test("renaming asks again and shows the old numbers until the answer", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }) }));
  const app = await bootApp({ server });
  const release = holdAi(server);
  app.editFood("Sardines", { name: "Tuna" });
  await app.settle();
  assert.deepEqual([app.entry("Tuna").estimateStatus, app.entry("Tuna").macros.calories], ["pending", range(100)]);
  release();
  await app.settle();
  assert.deepEqual([on(server, "Tuna").macros.calories, on(server, "Tuna").macros.protein], [range(200), mine(22)]);
  assert.equal("refresh" in on(server, "Tuna").nutrition, false);
});

test("a failed estimate after a rename keeps the old numbers, and the badge retries", async () => {
  const server = serverWith(row(1, "Sardines"));
  const good = server.ai;
  server.ai = () => ({ data: null, error: { context: { status: 502 } } });
  const app = await bootApp({ server });
  app.editFood("Sardines", { name: "Tuna" });
  await app.settle();
  assert.deepEqual([on(server, "Tuna").estimate_status, on(server, "Tuna").macros.calories], ["error", range(100)]);
  server.ai = good;
  app.run(`retryEstimate(${app.entry("Tuna").id})`);
  await app.settle();
  assert.deepEqual([on(server, "Tuna").estimate_status, on(server, "Tuna").macros.calories], ["done", range(200)]);
});

test("a date or time edit of a failed entry asks nobody", async () => {
  const server = serverWith(row(1, "Sardines", { estimate_status: "error", macros: {} }));
  const app = await bootApp({ server });
  app.editFood("Sardines", { time: "19:30" });
  await app.settle();
  assert.deepEqual([server.aiCalls, on(server, "Sardines").estimate_status], [[], "error"]);
});

test("batch add remembers row by row", async () => {
  const server = serverWith(row(1, "Sardines", { qty: 1, unit: "pc" }));
  const app = await bootApp({ server });
  app.addBatch(["Sardines", "Tofu"]);
  await app.settle();
  assert.deepEqual(server.aiCalls, ["Tofu"]);
  assert.deepEqual(server.food().filter((r) => r.food === "Sardines").map((r) => r.estimate_status), ["done", "done"]);
});

test("photo entries are marked and never remembered", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  app.addPhotoItems(["Soup"]);
  await app.settle();
  assert.equal(on(server, "Soup").nutrition.photo, true);
  app.addFood("Soup", { qty: 1, unit: "1 plate" });
  await app.settle();
  assert.deepEqual(server.aiCalls, ["Soup"]);
});

test("choosing a past food fills in its latest amount, not its oldest", async () => {
  const server = serverWith(
    row(1, "Eggs", { date: "2026-02-09", qty: 111, unit: "g" }),
    row(2, "Eggs", { date: "2026-11-22", time: "18:45", qty: 2, unit: "pcs" }),
    row(3, "Eggs", { date: "2026-11-22", time: "10:41", qty: 3, unit: "pcs" }));
  const app = await bootApp({ server });
  app.fire("add-food-btn", "click");
  type(app, "food-name", "Eggs", "change");
  assert.deepEqual([app.el("food-qty").value, app.el("food-unit").value], [2, "pcs"]);
});

test("renaming an entry does not change its amount", async () => {
  const server = serverWith(row(1, "Egs", { qty: 5 }), row(2, "Eggs", { qty: 2 }));
  const app = await bootApp({ server });
  app.run("editFood(1)");
  type(app, "food-name", "Eggs", "change");
  assert.deepEqual([app.el("food-qty").value, app.el("food-unit").value], [5, "pcs"]);
});
```

- [ ] **Step 2: Run** — expected: the new tests fail (AI asked, numbers wiped, oldest amount).

- [ ] **Step 3: Implement**

<!-- edit www/app.js @T6 -->
```js

let _foodEditOriginal = null;

```
```js

// The entry being edited; null when adding.
function editedEntry() {
  const id = String(document.getElementById("food-id").value);
  return (id && loadFoodEntries().find((e) => String(e.id) === id)) || null;
}

function formFood() {
  const value = (id) => document.getElementById(id).value;
  return { food: value("food-name"), qty: parseFloat(value("food-qty")), unit: value("food-unit") };
}

// The numbers a new or changed entry is saved with.
function numbersFor(before, after, form = null) {
  const others = loadFoodEntries().filter((e) => !before || e.id !== before.id);
  return Nutrition.resolve({ before, after, form, others, tracked: getEnabledMacros(), now: Date.now() });
}

```

<!-- edit www/app.js @T6 -->
```js
  populateFoodSuggestions();
  _foodEditOriginal = entry ? { food: entry.food, qty: entry.qty, unit: entry.unit } : null;
```
```js
  populateFoodSuggestions();
```

<!-- edit www/app.js @T6 -->
```js
  const entries = loadFoodEntries();
  const id = document.getElementById("food-id").value;
  const base = {
    date: document.getElementById("food-date").value,
    time: document.getElementById("food-time").value,
    food: document.getElementById("food-name").value,
    qty: parseFloat(document.getElementById("food-qty").value),
    unit: document.getElementById("food-unit").value,
  };
  let saved;
  if (id) {
    const idx = entries.findIndex((x) => x.id === parseInt(id));
    if (idx === -1) { console.warn("saveFood: entry not found for id", id); return; }
    saved = { ...entries[idx], ...base };
    if (Macros.needsReestimate(_foodEditOriginal, base)) { saved.macros = {}; saved.estimateStatus = "pending"; }
    entries[idx] = saved;
  } else {
    saved = { ...base, id: newId(), macros: {}, estimateStatus: "pending" };
    entries.push(saved);
  }
  saveFoodEntries(entries);
```
```js
  const id = document.getElementById("food-id").value;
  const before = editedEntry();
  if (id && !before) { console.warn("saveFood: entry not found for id", id); return; }
  const base = { date: document.getElementById("food-date").value, time: document.getElementById("food-time").value, ...formFood() };
  const saved = { ...(before || { id: newId() }), ...base, ...numbersFor(before, base) };
  const entries = loadFoodEntries();
  if (before) entries[entries.findIndex((x) => x.id === before.id)] = saved;
  else entries.push(saved);
  saveFoodEntries(entries);
```

<!-- edit www/app.js @T6 -->
```js
  if (saved && saved.estimateStatus === "pending") enqueueEstimate(saved.id);
}
```
```js
  if (saved.estimateStatus === "pending") enqueueEstimate(saved.id);
}
```

<!-- edit www/app.js @T6 -->
```js
    const entry = { id: newId(), date, time, food, qty: parseFloat(qty), unit, macros: {}, estimateStatus: "pending" };
    entries.push(entry); created.push(entry);
```
```js
    const base = { date, time, food, qty: parseFloat(qty), unit };
    const entry = { id: newId(), ...base, ...numbersFor(null, base) };
    entries.push(entry); created.push(entry);
```

<!-- edit www/app.js @T6 -->
```js
  created.forEach((e) => enqueueEstimate(e.id));
}
```
```js
  created.filter((e) => e.estimateStatus === "pending").forEach((e) => enqueueEstimate(e.id));
}
```

<!-- edit www/app.js @T6 -->
```js
  const created = PhotoEstimate.itemsToEntries(_photoItems, date, time, newId(_photoItems.length));
```
```js
  const created = PhotoEstimate.itemsToEntries(_photoItems, date, time, newId(_photoItems.length))
    .map((e) => ({ ...e, nutrition: { photo: true, at: Date.now() } }));
```

<!-- edit www/app.js @T6 -->
```js
  document.getElementById("food-name").addEventListener("change", function () {
    const entries = loadFoodEntries();
    const match = entries.findLast((e) => e.food === this.value);
    if (match) {
      document.getElementById("food-unit").value = match.unit;
      document.getElementById("food-qty").value = match.qty;
    }
  });
```
```js
  const nameInput = document.getElementById("food-name");
  nameInput.addEventListener("change", () => {
    const match = editedEntry() ? null : Nutrition.latestLog(loadFoodEntries(), nameInput.value);
    if (match) {
      document.getElementById("food-unit").value = match.unit;
      document.getElementById("food-qty").value = match.qty;
    }
  });
```

`Macros.blankEnabled` and `Macros.needsReestimate` now have no callers. Remove both, and their two tests.

<!-- edit www/macros.js @T6 -->
```js
  function blankEnabled(entry, enabled) {
    return (enabled || []).filter((id) => getMacro(entry, id) === null);
  }

```
```js
```

<!-- edit www/macros.js @T6 -->
```js
  function needsReestimate(orig, upd) {
    if (!orig) return true;
    return String(orig.food) !== String(upd.food)
      || Number(orig.qty) !== Number(upd.qty)
      || String(orig.unit) !== String(upd.unit);
  }

```
```js
```

<!-- edit www/macros.js @T6 -->
```js
    blankEnabled,
```
```js
```

<!-- edit www/macros.js @T6 -->
```js
    promptFields,
    needsReestimate,
```
```js
    promptFields,
```

<!-- edit tests/macros.test.js @T6 -->
```js
test("blankEnabled lists enabled macros with no value", () => {
  const e = { macros: { calories: { low: 100, high: 120 } } };
  assert.deepEqual(M.blankEnabled(e, ["calories", "protein", "carbs"]), ["protein", "carbs"]);
  assert.deepEqual(M.blankEnabled(e, ["calories"]), []);
});

```
```js
```

<!-- edit tests/macros.test.js @T6 -->
```js
test("needsReestimate true iff food/qty/unit changed (not date/time)", () => {
  const o = { food: "Oat", qty: 100, unit: "g" };
  assert.equal(M.needsReestimate(o, { food: "Oat", qty: 100, unit: "g" }), false);
  assert.equal(M.needsReestimate(o, { food: "Oat", qty: 150, unit: "g" }), true);   // qty
  assert.equal(M.needsReestimate(o, { food: "Oat", qty: 100, unit: "cup" }), true);  // unit
  assert.equal(M.needsReestimate(o, { food: "Oats", qty: 100, unit: "g" }), true);   // food
  assert.equal(M.needsReestimate(null, { food: "Oat", qty: 100, unit: "g" }), true); // no original (add)
});
```
```js
```

- [ ] **Step 4: Run** the whole suite — expected: all pass. (The `food-sync` tests that change an entry mid-estimate keep passing: an entry without numbers behaves as before.)
- [ ] **Step 5: Commit** `feat(nutrition): remembered foods, scaling, latest amount`

---

### Task 7: The Nutrition section, Ask AI again, tags

**Files:** Modify `www/index.html`, `www/app.js`, `www/mobile-render.js`, `www/styles.css`, `tests/helpers/app-harness.js`; test `tests/nutrition-app.test.js`

- [ ] **Step 1: Failing tests**

<!-- edit tests/helpers/app-harness.js @T7t -->
```js
  focus() {}
  scrollIntoView() {}
```
```js
  focus() {}
  reportValidity() { return true; }
  scrollIntoView() {}
```

<!-- append tests/nutrition-app.test.js @T7t -->
```js

// ---- the Nutrition section ------------------------------------------------------------

const NOON = "2026-11-23T04:00:00Z"; // the tag leaves out the current year
function openAdd(app, { food, qty, unit }) {
  app.fire("add-food-btn", "click");
  app.el("food-date").value = "2026-11-23";
  app.el("food-time").value = "08:00";
  type(app, "food-name", food);
  type(app, "food-qty", qty);
  type(app, "food-unit", unit);
}
const openEdit = (app, food) => app.run(`editFood(${app.entry(food).id})`);
const save = (app) => app.fire("food-form", "submit");
const shown = (app, id) => app.el(`nf-${id}`).value;
const state = (app) => app.el("nutrition-state").textContent;

test("adding stays closed until asked, and Edit opens the section", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines")) });
  openAdd(app, { food: "Tofu", qty: 1, unit: "pc" });
  assert.deepEqual([app.isOpen("nutrition"), app.isOpen("nutrition-open")], [false, true]);
  openEdit(app, "Sardines");
  assert.deepEqual([app.isOpen("nutrition"), app.isOpen("nutrition-open")], [true, false]);
  assert.deepEqual([shown(app, "calories"), shown(app, "protein"), shown(app, "fiber")], ["100", "10", "2"]);
});

test("a label's numbers are typed as printed and saved as what was eaten, with no AI call", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  openAdd(app, { food: "Tofu", qty: 80, unit: "g" });
  app.fire("nutrition-open", "click");
  type(app, "nf-calories", 100);
  type(app, "nutrition-basis-qty", 56);
  for (const [id, n] of [["protein", 11], ["carbs", 0], ["fat", 6], ["fiber", 0]]) type(app, `nf-${id}`, n);
  assert.equal(shown(app, "calories"), "100");
  save(app);
  await app.settle();
  assert.deepEqual(server.aiCalls, []);
  const saved = on(server, "Tofu");
  assert.deepEqual([saved.macros.calories, saved.macros.protein, saved.macros.carbs, saved.estimate_status], [mine(142.857), mine(15.714), mine(0), "manual"]);
  assert.deepEqual(saved.nutrition.basis, { qty: 56, unit: "g" });
  assert.equal(saved.pro_low, 15.714);
});

test("numbers not typed are asked for, and the AI is told the ones that are", async () => {
  const server = serverWith();
  const sent = [];
  server.ai = (body) => { sent.push(body.payload); return { data: { macros: eight(200) }, error: null }; };
  const app = await bootApp({ server });
  openAdd(app, { food: "Tofu", qty: 1, unit: "pc" });
  app.fire("nutrition-open", "click");
  assert.match(state(app), /leave blank/);
  type(app, "nf-protein", 22);
  save(app);
  await app.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ food: "Tofu", qty: 1, unit: "pc", known: { protein: 22 } }]);
  assert.deepEqual([on(server, "Tofu").macros.protein, on(server, "Tofu").macros.calories], [mine(22), range(200)]);
});

test("a remembered food shows its numbers and day before saving", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines")), now: NOON });
  openAdd(app, { food: "Sardines", qty: 2, unit: "pcs" });
  app.fire("nutrition-open", "click");
  assert.deepEqual([shown(app, "calories"), app.el("nutrition-tag").textContent, state(app)], ["50", "from Nov 20", ""]);
  type(app, "food-qty", 6);
  assert.equal(shown(app, "calories"), "150");
  type(app, "food-name", "Tofu");
  assert.deepEqual([shown(app, "calories"), app.el("nutrition-tag").textContent], ["", ""]);
});

test("renaming to a remembered food shows its numbers before saving", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }) }), row(2, "Tuna", { macros: eight(300) }));
  const app = await bootApp({ server, now: NOON });
  openEdit(app, "Sardines");
  type(app, "food-name", "tuna");
  assert.deepEqual([shown(app, "calories"), shown(app, "protein"), app.el("nutrition-tag").textContent, state(app)], ["300", "22", "from Nov 20", ""]);
  save(app);
  await app.settle();
  assert.deepEqual([server.aiCalls, on(server, "tuna").macros.calories, on(server, "tuna").macros.protein], [[], range(300), mine(22)]);
});

test("retyping the amount does not disturb the numbers", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines")) });
  openEdit(app, "Sardines");
  type(app, "food-qty", "");
  assert.deepEqual([shown(app, "calories"), state(app)], ["100", ""]);
  type(app, "food-qty", "8");
  assert.equal(shown(app, "calories"), "200");
});

test("correcting a number makes the entry the one to remember", async () => {
  const server = serverWith(row(1, "Sardines"), row(2, "Sardines", { date: "2026-11-22", macros: eight(300) }));
  const app = await bootApp({ server });
  app.run("editFood(1)");
  type(app, "nf-protein", "22");
  assert.equal(app.isOpen("nm-protein"), true);
  save(app);
  await app.settle();
  app.addFood("Sardines", { qty: 8, unit: "pcs" });
  await app.settle();
  const added = server.food().find((r) => r.food === "Sardines" && r.qty === 8);
  assert.deepEqual([added.macros.protein, added.macros.calories], [mine(44), range(200)]);
  assert.deepEqual(server.aiCalls, []);
});

test("an invalid number is refused beside its field and everything typed stays", async () => {
  const server = serverWith(row(1, "Sardines"));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  type(app, "nf-protein", "abc");
  assert.equal(app.isOpen("ne-protein"), false, "not while typing");
  type(app, "nf-carbs", "5");
  save(app);
  await app.settle();
  assert.equal(app.isOpen("food-modal"), true);
  assert.match(app.el("ne-protein").textContent, /number/);
  assert.equal(app.isOpen("ne-protein"), true);
  assert.deepEqual([shown(app, "protein"), shown(app, "carbs")], ["abc", "5"]);
  assert.deepEqual(on(server, "Sardines").macros.carbs, range(1), "nothing was saved");
  type(app, "nf-protein", "22");
  assert.equal(app.isOpen("ne-protein"), false);
  save(app);
  await app.settle();
  assert.deepEqual([on(server, "Sardines").macros.protein, on(server, "Sardines").macros.carbs], [mine(22), mine(5)]);
});

test("a label's amount that no longer converts is refused, not read as something else", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  openAdd(app, { food: "Tofu", qty: 80, unit: "g" });
  app.fire("nutrition-open", "click");
  type(app, "nutrition-basis-qty", 56);
  type(app, "nf-protein", 11);
  type(app, "food-unit", "plate");
  type(app, "food-qty", 1);
  save(app);
  await app.settle();
  assert.equal(app.el("ne-basis").textContent, "56 g does not convert to 1 plate");
  assert.deepEqual([app.isOpen("food-modal"), server.foods()], [true, []]);
});

test("ask AI again replaces everything that is not typed", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }), nutrition: { at: 5, from: { id: 9, date: "2026-11-01" } } }));
  const app = await bootApp({ server });
  const release = holdAi(server);
  openEdit(app, "Sardines");
  assert.equal(app.isOpen("nutrition-ask"), true);
  app.fire("nutrition-ask", "click");
  await app.settle();
  assert.equal(app.isOpen("food-modal"), false);
  assert.deepEqual([app.entry("Sardines").estimateStatus, app.entry("Sardines").macros.calories], ["pending", range(100)], "the old numbers are still shown");
  release();
  await app.settle();
  const saved = on(server, "Sardines");
  assert.deepEqual([saved.macros.calories, saved.macros.protein, saved.estimate_status], [range(200), mine(22), "done"]);
  assert.equal(saved.nutrition.from, undefined);
});

test("ask AI again is refused while a number is invalid", async () => {
  const server = serverWith(row(1, "Sardines"));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  type(app, "nf-protein", "abc");
  app.fire("nutrition-ask", "click");
  await app.settle();
  assert.deepEqual([app.isOpen("food-modal"), server.aiCalls], [true, []]);
  type(app, "nf-protein", "22");
  save(app);
  await app.settle();
  assert.deepEqual([server.aiCalls, on(server, "Sardines").estimate_status], [[], "done"], "an ordinary save asks nobody");
});

test("ask AI again without credit opens the paywall and changes nothing", async () => {
  const server = serverWith(row(1, "Sardines"));
  server.usage = { pct_used: 100, plan: "free", exhausted: true };
  const app = await bootApp({ server });
  const before = on(server, "Sardines");
  openEdit(app, "Sardines");
  app.fire("nutrition-ask", "click");
  await app.settle();
  assert.equal(app.isOpen("paywall-modal"), true);
  assert.deepEqual(on(server, "Sardines"), before);
});

test("typing every tracked number works without credit", async () => {
  const server = serverWith();
  server.usage = { pct_used: 100, plan: "free", exhausted: true };
  const app = await bootApp({ server });
  openAdd(app, { food: "Tofu", qty: 1, unit: "pc" });
  app.fire("nutrition-open", "click");
  for (const id of ["calories", "protein", "carbs", "fat", "fiber"]) type(app, `nf-${id}`, 1);
  assert.equal(state(app), "");
  save(app);
  await app.settle();
  assert.deepEqual([on(server, "Tofu").estimate_status, app.isOpen("paywall-modal")], ["manual", false]);
});

test("numbers typed without credit are saved even if others are missing", async () => {
  const server = serverWith();
  server.usage = { pct_used: 100, plan: "free", exhausted: true };
  const app = await bootApp({ server });
  openAdd(app, { food: "Tofu", qty: 1, unit: "pc" });
  app.fire("nutrition-open", "click");
  type(app, "nf-protein", 22);
  save(app);
  await app.settle();
  assert.deepEqual([on(server, "Tofu").estimate_status, on(server, "Tofu").macros, app.isOpen("paywall-modal")], ["error", { protein: mine(22) }, true]);
});

test("correcting the weight rescales the AI's numbers", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }), nutrition: { at: 5, grams: 48, why: [{ ref: "r", note: "n", grams: 48, kcal: 100 }], how: "one", asked: { qty: 4, unit: "pcs" } } }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  assert.equal(app.el("nutrition-weight-text").textContent, "Assumed weight 48 g (12 g each)");
  assert.equal(app.isOpen("nutrition-weight-row"), false);
  app.fire("nutrition-weight-change", "click");
  assert.equal(app.isOpen("nutrition-weight-row"), true);
  type(app, "nutrition-weight", "96");
  assert.equal(shown(app, "calories"), "200");
  save(app);
  await app.settle();
  const saved = on(server, "Sardines");
  assert.deepEqual([saved.macros.calories, saved.macros.protein, saved.nutrition.grams, saved.nutrition.gramsMine], [range(200), mine(22), 96, true]);
  assert.deepEqual(server.aiCalls, []);
});

test("the explanation is shown as text, whatever the AI wrote", async () => {
  const server = serverWith(row(1, "Sardines", { nutrition: { at: 5, why: [{ ref: "<img src=x onerror=alert(1)>", note: "a & b", grams: null, kcal: 100 }], how: "one", asked: { qty: 4, unit: "pcs" } } }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  const html = app.el("nutrition-why-lines").innerHTML;
  assert.ok(html.includes("&lt;img") && !html.includes("<img"), html);
  assert.ok(html.includes("a &amp; b"));
  assert.equal(app.isOpen("nutrition-why"), true);
});

test("the form says when saving will ask the AI, and when an estimate failed", async () => {
  const server = serverWith(row(1, "Sardines"), row(2, "Tuna", { estimate_status: "error", macros: {} }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  assert.equal(state(app), "");
  type(app, "food-name", "Mackerel");
  assert.equal(state(app), "AI will estimate the other numbers again.");
  type(app, "food-name", "Sardines");
  type(app, "nf-carbs", "");
  assert.equal(state(app), "AI will estimate the numbers you leave blank.");
  openEdit(app, "Tuna");
  assert.equal(state(app), "The estimate didn't come back. Ask again or type your own numbers.");
  assert.equal(app.isOpen("nutrition-ask"), true);
});

test("numbers that arrive while the entry is open appear in the form", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  const release = holdAi(server);
  app.addFood("Tofu");
  await app.settle();
  openEdit(app, "Tofu");
  assert.equal(state(app), "Estimating… You can type your own numbers meanwhile.");
  type(app, "nf-fat", "9");
  release();
  await app.settle();
  assert.deepEqual([shown(app, "calories"), shown(app, "fat"), state(app)], ["200", "9", ""]);
  save(app);
  await app.settle();
  assert.deepEqual([on(server, "Tofu").macros.calories, on(server, "Tofu").macros.fat], [range(200), mine(9)]);
  assert.deepEqual(server.aiCalls, ["Tofu"]);
});

test("numbers typed and saved while the AI works survive its answer", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  const release = holdAi(server);
  app.addFood("Tofu");
  await app.settle();
  openEdit(app, "Tofu");
  type(app, "nf-protein", "22");
  save(app);
  await app.settle();
  release();
  await app.settle();
  assert.deepEqual([on(server, "Tofu").macros.protein, on(server, "Tofu").macros.calories, on(server, "Tofu").estimate_status], [mine(22), range(200), "done"]);
});

test("reused entries carry their day in the table and on cards", async () => {
  const nutrition = { at: 5, from: { id: 9, date: "2026-11-20" } };
  const app = await bootApp({ server: serverWith(row(1, "Sardines", { nutrition }), row(2, "Tofu")), now: NOON });
  const html = app.run("renderFoodTable(); document.querySelector('#food-eaten-table tbody').innerHTML");
  assert.equal(html.split("from Nov 20").length, 2);
  app.run("MOBILE_MQ.matches = true; renderFoodCards()");
  assert.equal(app.el("food-cards").innerHTML.split("from Nov 20").length, 2);
});

test("closing the form forgets what was typed in it", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines")) });
  openEdit(app, "Sardines");
  type(app, "nf-protein", "99");
  app.fire("food-cancel", "click");
  app.addFood("Tofu");
  await app.settle();
  assert.deepEqual(app.entry("Tofu").macros.protein, range(10));
});
```

- [ ] **Step 2: Run** — expected: the new tests fail.

- [ ] **Step 3: Implement**

<!-- edit www/index.html @T7 -->
```html
          <div class="form-row"><label for="food-date">Date</label><input type="date" id="food-date" required></div>
          <div class="form-row"><label for="food-time">Time</label><input type="time" id="food-time" required></div>
          <div class="form-row"><label for="food-name">Food</label><input type="text" id="food-name" required autocomplete="off" list="food-suggestions"><datalist id="food-suggestions"></datalist></div>
          <div class="form-row"><label for="food-qty">Quantity</label><input type="number" id="food-qty" step="any" required></div>
          <div class="form-row"><label for="food-unit">Unit of measure</label><input type="text" id="food-unit" required autocomplete="off" list="unit-suggestions"><datalist id="unit-suggestions"></datalist></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" id="food-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
```
```html
          <div class="form-row-flow">
            <div class="form-row"><label for="food-date">Date</label><input type="date" id="food-date" required></div>
            <div class="form-row"><label for="food-time">Time</label><input type="time" id="food-time" required></div>
          </div>
          <div class="form-row"><label for="food-name">Food</label><input type="text" id="food-name" required autocomplete="off" list="food-suggestions"><datalist id="food-suggestions"></datalist></div>
          <div class="form-row-flow">
            <div class="form-row"><label for="food-qty">Quantity</label><input type="number" id="food-qty" step="any" required></div>
            <div class="form-row"><label for="food-unit">Unit of measure</label><input type="text" id="food-unit" required autocomplete="off" list="unit-suggestions"><datalist id="unit-suggestions"></datalist></div>
          </div>
          <button type="button" id="nutrition-open" class="link-btn">Enter numbers yourself</button>
          <div id="nutrition" class="nutrition hidden">
            <div class="nutrition-head">
              <h3>Nutrition</h3>
              <span id="nutrition-tag" class="from-tag hidden"></span>
              <button type="button" id="nutrition-ask" class="btn btn-secondary btn-sm hidden">Ask AI again</button>
            </div>
            <p id="nutrition-state" class="nutrition-note hidden" role="status"></p>
            <div id="nutrition-basis" class="nutrition-basis">
              <label for="nutrition-basis-qty">These numbers are for</label>
              <input type="text" inputmode="decimal" id="nutrition-basis-qty" autocomplete="off" aria-describedby="ne-basis">
              <select id="nutrition-basis-unit" aria-label="Unit these numbers are for"></select>
              <p id="ne-basis" class="field-error hidden" role="alert"></p>
            </div>
            <div id="nutrition-fields" class="nutrition-fields"></div>
            <details id="nutrition-more" class="nutrition-more">
              <summary>More nutrients</summary>
              <div id="nutrition-more-fields" class="nutrition-fields"></div>
            </details>
            <details id="nutrition-why" class="nutrition-more hidden">
              <summary>How was this worked out?</summary>
              <div id="nutrition-weight-line" class="nutrition-weight hidden">
                <span id="nutrition-weight-text"></span>
                <button type="button" id="nutrition-weight-change" class="link-btn">Change</button>
              </div>
              <div id="nutrition-weight-row" class="nutrition-weight hidden">
                <label for="nutrition-weight">Actual weight (g)</label>
                <input type="text" inputmode="decimal" id="nutrition-weight" autocomplete="off" aria-describedby="ne-weight">
                <p id="ne-weight" class="field-error hidden" role="alert"></p>
              </div>
              <ul id="nutrition-why-lines"></ul>
            </details>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" id="food-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save entry</button>
          </div>
```

<!-- edit www/app.js @T7 -->
```js
  return Nutrition.resolve({ before, after, form, others, tracked: getEnabledMacros(), now: Date.now() });
}

```
```js
  return Nutrition.resolve({ before, after, form, others, tracked: getEnabledMacros(), now: Date.now() });
}

// ---- Nutrition section of the food form ----

let _nutritionForm = null;    // Nutrition.createForm() while the section is open
let _nutritionErrors = false; // saving was refused: say what is wrong

const showIf = (id, on) => document.getElementById(id).classList.toggle("hidden", !on);

function openNutrition() {
  _nutritionForm = Nutrition.createForm();
  _nutritionErrors = false;
  buildNutritionFields();
  for (const id of ["nutrition-more", "nutrition-why"]) document.getElementById(id).open = false;
  document.getElementById("nutrition-weight").value = "";
  showIf("nutrition-weight-row", false);
  showIf("nutrition-open", false);
  showIf("nutrition", true);
  renderNutrition();
}

function closeNutrition() {
  _nutritionForm = null;
  showIf("nutrition", false);
  showIf("nutrition-open", true);
}

// Passes what is typed into a field of the section on to the form.
function onNutrition(id, type, fn) {
  const input = document.getElementById(id);
  input.addEventListener(type, () => { if (_nutritionForm) { fn(_nutritionForm, input.value); renderNutrition(); } });
}

// The nutrients being tracked, then the others under "More nutrients".
function buildNutritionFields() {
  const tracked = getEnabledMacros();
  const others = Macros.CATALOG.filter((m) => !tracked.includes(m.id));
  const fields = (list) => list.map((m) => `<div class="nutrition-field">
    <label for="nf-${m.id}">${escapeHtml(m.label)} (${escapeHtml(m.unit)})</label>
    <div class="nutrition-input"><input type="text" inputmode="decimal" id="nf-${m.id}" autocomplete="off" aria-describedby="ne-${m.id}"><span id="nm-${m.id}" class="mine-mark hidden">yours</span></div>
    <p id="ne-${m.id}" class="field-error hidden" role="alert"></p>
  </div>`).join("");
  document.getElementById("nutrition-fields").innerHTML = fields(Macros.CATALOG.filter((m) => tracked.includes(m.id)));
  document.getElementById("nutrition-more-fields").innerHTML = fields(others);
  showIf("nutrition-more", others.length > 0);
  for (const { id } of Macros.CATALOG) onNutrition(`nf-${id}`, "input", (form, text) => form.type(id, text));
}

// Shows what the entry would be saved with. Runs whenever anything in the form, or the
// entry's own numbers, changed.
function renderNutrition() {
  const form = _nutritionForm;
  if (!form) return;
  const before = editedEntry(), after = formFood();
  if (before && !(after.qty > 0)) after.qty = before.qty; // its field is being retyped
  form.rebase({ ...after, ...numbersFor(before, after) });
  const willBe = { ...after, ...numbersFor(before, after, form.result()) };

  const errors = _nutritionErrors ? form.errors() : {};
  const setText = (id, text) => { document.getElementById(id).textContent = text; showIf(id, text !== ""); };
  const setValue = (id, value) => {
    const input = document.getElementById(id);
    if (input !== document.activeElement) input.value = value; // never under the cursor
  };
  for (const { id } of Macros.CATALOG) {
    setValue(`nf-${id}`, form.text(id));
    showIf(`nm-${id}`, form.isMine(id));
    setText(`ne-${id}`, errors[id] || "");
  }

  const basis = form.basis(), units = form.units(), unitSelect = document.getElementById("nutrition-basis-unit");
  unitSelect.innerHTML = units.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("");
  unitSelect.value = units.find((u) => Nutrition.unit(u) === Nutrition.unit(basis.unit));
  setValue("nutrition-basis-qty", basis.text);
  setText("ne-basis", errors.basis || "");
  showIf("nutrition-basis", after.qty > 0 && after.unit.trim() !== "");

  setText("nutrition-tag", Nutrition.tag(willBe, localDate()));
  setText("nutrition-state", nutritionState(before, willBe));
  showIf("nutrition-ask", !!before && (Nutrition.hasTheirs(before) || before.estimateStatus === "error"));

  const why = Nutrition.explain(willBe, localDate());
  document.getElementById("nutrition-weight-text").textContent = why.weight || "";
  showIf("nutrition-weight-line", !!why.weight);
  if (!why.weight) showIf("nutrition-weight-row", false);
  setText("ne-weight", errors.weight || "");
  document.getElementById("nutrition-why-lines").innerHTML = why.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  showIf("nutrition-why", !!why.weight || why.lines.length > 0);
}

function nutritionState(before, willBe) {
  if (willBe.estimateStatus === "error") return "The estimate didn't come back. Ask again or type your own numbers.";
  if (willBe.estimateStatus !== "pending") return "";
  if (before && before.estimateStatus === "pending") return "Estimating… You can type your own numbers meanwhile.";
  if (willBe.nutrition && willBe.nutrition.refresh) return "AI will estimate the other numbers again.";
  return "AI will estimate the numbers you leave blank.";
}

// Says what is wrong with the typed numbers, beside their fields. True if nothing is.
function checkNutrition() {
  const wrong = _nutritionForm ? Object.keys(_nutritionForm.errors()) : [];
  if (!wrong.length) return true;
  _nutritionErrors = true;
  renderNutrition();
  const field = document.getElementById({ basis: "nutrition-basis-qty", weight: "nutrition-weight" }[wrong[0]] || `nf-${wrong[0]}`);
  const folded = field.closest("details");
  if (folded) folded.open = true;
  field.focus();
  field.scrollIntoView({ block: "center" }); // its message too
  return false;
}

function askAgain() {
  if (_aiExhausted) { openPaywall(); return; }
  if (document.getElementById("food-form").reportValidity()) submitFood(true);
}

function initNutrition() {
  document.getElementById("nutrition-open").addEventListener("click", () => { openNutrition(); document.getElementById("nf-calories").focus(); });
  document.getElementById("nutrition-ask").addEventListener("click", askAgain);
  document.getElementById("nutrition").addEventListener("focusout", renderNutrition);
  for (const id of ["food-name", "food-qty", "food-unit"]) document.getElementById(id).addEventListener("input", renderNutrition);
  onNutrition("nutrition-basis-qty", "input", (form, text) => form.setBasis(text));
  onNutrition("nutrition-basis-unit", "change", (form, unit) => form.setBasisUnit(unit));
  onNutrition("nutrition-weight", "input", (form, text) => form.setWeight(text));
  document.getElementById("nutrition-weight-change").addEventListener("click", () => {
    showIf("nutrition-weight-row", true);
    document.getElementById("nutrition-weight").focus();
  });
}

function fromTagHtml(entry) {
  const tag = Nutrition.tag(entry, localDate());
  return tag ? `<div class="from-tag">${escapeHtml(tag)}</div>` : "";
}

```

<!-- edit www/app.js @T7 -->
```js
  showFoodPane("single");
  modal.classList.remove("hidden");
}

function populateFoodSuggestions() {
```
```js
  if (entry) openNutrition();
  else closeNutrition();
  showFoodPane("single");
  modal.classList.remove("hidden");
}

function populateFoodSuggestions() {
```

<!-- edit www/app.js @T7 -->
```js
function closeFoodModal() {
```
```js
function closeFoodModal() {
  closeNutrition();
```

<!-- edit www/app.js @T7 -->
```js
function saveFood(e) {
  e.preventDefault();
  const id = document.getElementById("food-id").value;
```
```js
function saveFood(e) {
  e.preventDefault();
  submitFood();
}

function submitFood(again = false) {
  if (!checkNutrition()) return;
  const id = document.getElementById("food-id").value;
```

<!-- edit www/app.js @T7 -->
```js
  const saved = { ...(before || { id: newId() }), ...base, ...numbersFor(before, base) };
```
```js
  const form = _nutritionForm && { ..._nutritionForm.result(), askAgain: again };
  const saved = { ...(before || { id: newId() }), ...base, ...numbersFor(before, base, form) };
```

<!-- edit www/app.js @T7 -->
```js
      if (answered.length) {
        saveEstimates(fresh, answered);
        renderFoodTable(); renderCalorieTracker();
      }
```
```js
      if (answered.length) {
        saveEstimates(fresh, answered);
        renderFoodTable(); renderCalorieTracker(); renderNutrition();
      }
```

<!-- edit www/app.js @T7 -->
```js
      document.getElementById("food-unit").value = match.unit;
      document.getElementById("food-qty").value = match.qty;
    }
  });
```
```js
      document.getElementById("food-unit").value = match.unit;
      document.getElementById("food-qty").value = match.qty;
      renderNutrition();
    }
  });
```

<!-- edit www/app.js @T7 -->
```js
  document.getElementById("food-form").addEventListener("submit", saveFood);
```
```js
  document.getElementById("food-form").addEventListener("submit", saveFood);
  initNutrition();
```

<!-- edit www/app.js @T7 -->
```js
        <td>${escapeHtml(entry.food)}</td>
        <td class="num">${entry.qty}</td>
```
```js
        <td>${escapeHtml(entry.food)}${fromTagHtml(entry)}</td>
        <td class="num">${entry.qty}</td>
```

<!-- edit www/mobile-render.js @T7 -->
```js
      html += `<div class="food-card" data-id="${e.id}">
```
```js
      const tag = Nutrition.tag(e, localDate());
      html += `<div class="food-card" data-id="${e.id}">
```

<!-- edit www/mobile-render.js @T7 -->
```js
        <div class="food-card-sub">${formatTime(e.time)} · ${e.qty} ${escapeHtml(e.unit)}</div>
```
```js
        <div class="food-card-sub">${formatTime(e.time)} · ${e.qty} ${escapeHtml(e.unit)}${tag ? ` · ${escapeHtml(tag)}` : ""}</div>
```

<!-- edit www/mobile-render.js @T7 -->
```js
//                          retryEstimate, getEnabledMacros, getValueFormat, Macros
```
```js
//                          retryEstimate, getEnabledMacros, getValueFormat, localDate,
//                          Macros, Nutrition
```

<!-- append www/styles.css @T7 -->
```css

/* ---- Nutrition section of the food form (theme vars only; sizes follow content) ---- */
.link-btn { background: none; border: none; padding: 4px 0; color: var(--primary); font-family: var(--font); font-size: 0.88rem; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.from-tag { color: var(--text-dim); font-size: 0.78rem; }
.nutrition { border-top: 1px solid var(--border); margin-top: 14px; padding-top: 14px; }
.nutrition-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-bottom: 10px; }
.nutrition-head h3 { font-size: 0.98rem; margin: 0; }
.nutrition-head .btn { margin-left: auto; }
.nutrition-note { color: var(--text-dim); font-size: 0.85rem; margin: 0 0 10px; }
.nutrition-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(8rem, 100%), 1fr)); gap: 10px 12px; }
.nutrition-field label, .nutrition-basis label, .nutrition-weight label { font-size: 0.82rem; color: var(--text-dim); font-weight: 500; }
.nutrition-field label { display: block; margin-bottom: 4px; }
.nutrition-input { position: relative; }
.nutrition-input input { width: 100%; padding-right: 3.2rem; } /* room for the mark, so that typing moves nothing */
.mine-mark { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--primary); font-size: 0.75rem; pointer-events: none; }
.field-error { color: var(--red); font-size: 0.8rem; margin: 4px 0 0; }
.nutrition-basis, .nutrition-weight { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0 0 12px; }
.nutrition-basis input, .nutrition-weight input { flex: 0 1 6rem; min-width: 4.5rem; }
.nutrition-basis select { flex: 0 1 8rem; min-width: 5rem; }
.nutrition-basis .field-error, .nutrition-weight .field-error { flex-basis: 100%; }
.nutrition-more { margin-top: 10px; }
.nutrition-more > summary { cursor: pointer; padding: 6px 0; font-size: 0.88rem; font-weight: 600; }
.nutrition-weight { font-size: 0.88rem; margin: 8px 0; }
#nutrition-why-lines { margin: 4px 0 0; padding-left: 18px; color: var(--text-dim); font-size: 0.85rem; overflow-wrap: anywhere; }
.form-row-flow { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(8rem, 100%), 1fr)); gap: 0 12px; }
/* Save and Cancel stay in reach while a long form scrolls. The negative margins undo
   .modal-content's 28px padding so nothing shows through beneath the bar; a field that
   takes the focus stays clear of it. */
#food-form .modal-actions { position: sticky; bottom: -28px; margin: 20px -28px -28px; padding: 12px 28px 16px; background: var(--surface); border-top: 1px solid var(--border); }
#food-modal .modal-content { scroll-padding-bottom: 6rem; }
@media (max-width: 720px) {
  .nutrition-basis label { flex: 1 0 100%; }
  .nutrition input, .nutrition select { min-height: 44px; font-size: 16px; }
  .nutrition .btn, .nutrition .link-btn, #nutrition-open { min-height: 44px; }
}
```

- [ ] **Step 4: Run** the whole suite — expected: all pass.
- [ ] **Step 5: Layout check in a real browser** (Task 10 repeats it on the final build): open Add and Edit at 360, 390, 720 and 1280 px, and at 125% and 150% scaling; nothing clipped, no sideways scroll, Save entry reachable while scrolled to the middle, in both themes.
- [ ] **Step 6: Commit** `feat(nutrition): type your own numbers, ask AI again, see how it was worked out`

---

### Task 8: Fiber by default, smaller assessments

**Files:** Modify `www/macros.js`, `www/assessment-view.js`, `www/app.js`, `tests/helpers/app-harness.js`; tests `tests/macros.test.js`, `tests/assessment-view.test.js`, `tests/nutrition-app.test.js`

**Interfaces:**
- `AssessmentView.payload(data) -> data`: the same package with only what the assessment prompt reads

- [ ] **Step 1: Failing tests**

<!-- edit tests/macros.test.js @T8t -->
```js
  assert.equal(M.byId("fat").defaultOn, true);
  assert.equal(M.byId("sodium").unit, "mg");
```
```js
  assert.equal(M.byId("fat").defaultOn, true);
  assert.equal(M.byId("fiber").defaultOn, true);
  assert.equal(M.byId("sodium").unit, "mg");
```

<!-- edit tests/macros.test.js @T8t -->
```js
test("defaultEnabled is calories, protein, carbs, fat", () => {
  assert.deepEqual(M.defaultEnabled(), ["calories", "protein", "carbs", "fat"]);
});
```
```js
test("defaultEnabled is calories, protein, carbs, fat, fiber", () => {
  assert.deepEqual(M.defaultEnabled(), ["calories", "protein", "carbs", "fat", "fiber"]);
});
```

The fake AI answers with all eight nutrients, as the proxy does.

<!-- edit tests/food-sync.test.js @T8t -->
```js
const macrosFor = (kcal) => ({ calories: { low: kcal, high: kcal }, protein: { low: 1, high: 1 }, carbs: { low: 1, high: 1 }, fat: { low: 1, high: 1 } });
```
```js
const macrosFor = (kcal) => Object.fromEntries(["protein", "carbs", "fat", "fiber", "sugar", "saturatedFat", "sodium"].reduce((all, id) => [...all, [id, { low: 1, high: 1 }]], [["calories", { low: kcal, high: kcal }]]));
```

<!-- edit tests/helpers/app-harness.js @T8t -->
```js
    ai: () => ({ data: { macros: { calories: { low: 100, high: 110 }, protein: { low: 10, high: 11 }, carbs: { low: 5, high: 6 }, fat: { low: 2, high: 3 } } }, error: null }),
```
```js
    ai: () => ({ data: { macros: { calories: { low: 100, high: 110 }, protein: { low: 10, high: 11 }, carbs: { low: 5, high: 6 }, fat: { low: 2, high: 3 }, fiber: { low: 1, high: 2 }, sugar: { low: 1, high: 2 }, saturatedFat: { low: 0, high: 1 }, sodium: { low: 50, high: 60 } } }, error: null }),
```

<!-- append tests/assessment-view.test.js @T8t -->
```js

// ---- what an assessment sends ----------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

// The prompt as the proxy builds it, from its own source.
const proxyPrompt = (() => {
  const source = fs.readFileSync(path.join(__dirname, "../supabase/functions/ai-proxy/index.ts"), "utf8").replace(/\r\n/g, "\n");
  const functions = ["getMacroRange", "sumMacroRange", "buildAssessmentPromptText"].map((name) => source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`))[0]);
  const js = functions.join("").replace(/: (any\[\]|any|string|number)(?=[,)])/g, "");
  return new Function(`${js}return buildAssessmentPromptText;`)();
})();

const eaten = (food, over = {}) => ({
  id: 1795417693000123, date: "2026-11-20", time: "08:00", food, qty: 4, unit: "pcs", estimateStatus: "done",
  macros: { calories: { low: 100, high: 110, mine: true }, protein: { low: 10, high: 12 }, sodium: { low: 1, high: 2 } },
  nutrition: { at: 1, why: [{ ref: "r", note: "n", grams: 1, kcal: 2 }], from: { id: 2, date: "2026-11-19" } }, ...over,
});
const averages = { avgCalLow: 100, avgCalHigh: 110, avgProLow: 10, avgProHigh: 12, avgProTargetLow: 135, avgProTargetHigh: 150 };
const context = { "2026-11-20": { activity: "Gym", tdee: 2400, deficit: 550, calorieTarget: 1850 } };
const week = () => ({
  period: "week", startDate: "2026-11-16", endDate: "2026-11-22", dates: ["2026-11-20"], numDays: 1, totalEntries: 2, excludedIncompleteDays: 0,
  foodByDate: { "2026-11-20": [eaten("Sardines"), eaten("Soup", { macros: {} })] }, dailyContext: context,
  totalCalLow: 100, totalCalHigh: 110, totalProLow: 10, totalProHigh: 12, ...averages,
});
const yearOverYear = () => {
  const current = week();
  return { ...current, period: "yoy", isYoY: true, currentYear: { ...current, label: "2026" }, previousYear: { ...week(), label: "2025" } };
};

test("the prompt reads the same from the smaller payload", () => {
  for (const data of [week(), yearOverYear()]) {
    const prompt = proxyPrompt(JSON.parse(JSON.stringify(data)));
    assert.ok(prompt.includes("Sardines, 4 pcs (100-110 cal, 10-12g protein)"), prompt);
    assert.equal(proxyPrompt(JSON.parse(JSON.stringify(AV.payload(data)))), prompt);
  }
});

test("an assessment sends nothing the prompt does not read", () => {
  const sent = AV.payload(yearOverYear());
  assert.deepStrictEqual(Object.keys(sent).sort(), ["avgCalHigh", "avgCalLow", "avgProHigh", "avgProLow", "avgProTargetHigh", "avgProTargetLow", "dailyContext", "dates", "endDate", "foodByDate", "isYoY", "numDays", "previousYear", "startDate", "totalEntries"]);
  assert.deepStrictEqual(sent.foodByDate["2026-11-20"], [
    { time: "08:00", food: "Sardines", qty: 4, unit: "pcs", macros: { calories: { low: 100, high: 110 }, protein: { low: 10, high: 12 } } },
    { time: "08:00", food: "Soup", qty: 4, unit: "pcs", macros: {} },
  ]);
  assert.deepStrictEqual(Object.keys(sent.previousYear).sort(), ["avgCalHigh", "avgCalLow", "avgProHigh", "avgProLow", "dailyContext", "label", "numDays", "totalEntries"]);
});

test("the payload does not change what it was made from", () => {
  const data = yearOverYear();
  AV.payload(data);
  assert.deepStrictEqual(data, yearOverYear());
});
```

<!-- append tests/nutrition-app.test.js @T8t -->
```js

// ---- assessments ----------------------------------------------------------------------

test("both rounds of an assessment send the smaller payload, and it is what the size limit counts", async () => {
  const note = "x".repeat(200);
  const why = [{ ref: note, note, grams: 1, kcal: 1 }, { ref: note, note, grams: 1, kcal: 1 }];
  const server = serverWith(...Array.from({ length: 400 }, (_, i) => row(i + 1, "Sardines", { nutrition: { at: 5, why } })));
  const sent = [];
  server.ai = (body) => { sent.push(body); return { data: { a: "{}", b: "{}" }, error: null }; };
  const app = await bootApp({ server, now: NOON });
  assert.ok(app.run("JSON.stringify(getAssessmentData('week')).length") > 250000, "whole entries would be refused");
  // Round 2 follows when the two analyses disagree; what they say does not matter here.
  app.run("checkAssessmentAgreement = () => ({ needsEscalation: true, disagreements: 1, total: 1 }); averageAssessmentScores = (list) => list[0]; renderAssessmentResults = () => {};");
  app.fire("run-assessment-btn", "click");
  await app.settle();
  assert.deepEqual(sent.map((body) => body.feature), ["assess-round1", "assess-round2"]);
  for (const { payload } of sent) {
    assert.equal(payload.data.totalEntries, 400);
    assert.deepEqual(Object.keys(payload.data.foodByDate["2026-11-20"][0]).sort(), ["food", "macros", "qty", "time", "unit"]);
  }
});
```

- [ ] **Step 2: Run** — expected: the new and changed tests fail (`AV.payload is not a function`, fiber missing).

- [ ] **Step 3: Implement**

<!-- edit www/macros.js @T8 -->
```js
    { id: "fiber", label: "Fiber", unit: "g", locked: false, defaultOn: false },
```
```js
    { id: "fiber", label: "Fiber", unit: "g", locked: false, defaultOn: true },
```

<!-- edit www/assessment-view.js @T8 -->
```js
  return { verdictLine, calorieChip, proteinChip, varietyChip, topActions };
```
```js
  // What an assessment sends: only what its prompt reads (buildAssessmentPromptText in
  // supabase/functions/ai-proxy/index.ts), because the proxy limits the size.
  const PERIOD = ["startDate", "endDate", "numDays", "totalEntries", "dates", "dailyContext", "isYoY",
    "avgCalLow", "avgCalHigh", "avgProLow", "avgProHigh", "avgProTargetLow", "avgProTargetHigh"];
  const PREVIOUS_YEAR = ["label", "numDays", "totalEntries", "dailyContext", "avgCalLow", "avgCalHigh", "avgProLow", "avgProHigh"];
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

  function payload(data) {
    const entry = (e) => {
      const macros = {};
      for (const id of ["calories", "protein"]) {
        const m = e.macros && e.macros[id];
        if (m && m.low != null && m.high != null) macros[id] = { low: m.low, high: m.high };
      }
      return { ...pick(e, ["time", "food", "qty", "unit"]), macros };
    };
    const out = pick(data, PERIOD);
    out.foodByDate = Object.fromEntries(Object.entries(data.foodByDate).map(([date, entries]) => [date, entries.map(entry)]));
    if (data.previousYear) out.previousYear = pick(data.previousYear, PREVIOUS_YEAR);
    return out;
  }

  return { verdictLine, calorieChip, proteinChip, varietyChip, topActions, payload };
```

<!-- edit www/app.js @T8 -->
```js
  if (JSON.stringify({ data }).length > 250000) {
```
```js
  const sent = AssessmentView.payload(data);
  if (JSON.stringify({ data: sent }).length > 250000) {
```

<!-- edit www/app.js @T8 -->
```js
    const r1 = await callAi("assess-round1", { data });
```
```js
    const r1 = await callAi("assess-round1", { data: sent });
```

<!-- edit www/app.js @T8 -->
```js
    if (JSON.stringify({ round1A: r1.a, round1B: r1.b, data }).length > 250000) {
```
```js
    if (JSON.stringify({ round1A: r1.a, round1B: r1.b, data: sent }).length > 250000) {
```

<!-- edit www/app.js @T8 -->
```js
        r2 = await callAi("assess-round2", { round1A: r1.a, round1B: r1.b, data });
```
```js
        r2 = await callAi("assess-round2", { round1A: r1.a, round1B: r1.b, data: sent });
```

- [ ] **Step 4: Run** the whole suite — expected: all pass.
- [ ] **Step 5: Commit** `feat: fiber on by default; assessments send only what their prompt reads`

---

### Task 9: The proxy says what it based its answer on

**Files:** Modify `supabase/functions/_shared/proxy-shapes.mjs`, `supabase/functions/_shared/metering.mjs`, `supabase/functions/ai-proxy/index.ts`; tests `tests/proxy-shapes.test.mjs`, `tests/metering.test.mjs`

**Interfaces:**
- `extractBasis(flat) -> { ref, note, grams, kcal }`
- `knownTotals(known) -> string`, empty if there is nothing usable
- `mergedHow(a, b, widenThreshold) -> "one" | "both" | "average"`
- Response of `estimate` gains `basis: [extractBasis, …]` (one per model that answered) and `how`

- [ ] **Step 1: Failing tests**

<!-- edit tests/proxy-shapes.test.mjs @T9t -->
```js
  mergeItemPair, mergePhotoItems, foodsAlign,
} from "../supabase/functions/_shared/proxy-shapes.mjs";
```
```js
  mergeItemPair, mergePhotoItems, foodsAlign, extractBasis, knownTotals,
} from "../supabase/functions/_shared/proxy-shapes.mjs";
```

<!-- append tests/proxy-shapes.test.mjs @T9t -->
```js

// ---- what an estimate was based on ----

const told = (over) => extractBasis({ calories_lower: 95, calories_upper: 104, reference: "canned sardines", reasoning: "From USDA.", total_grams: 48, ...over });

test("extractBasis keeps the reference, the note, the weight and the middle of the calories", () => {
  assert.deepEqual(told(), { ref: "canned sardines", note: "From USDA.", grams: 48, kcal: 100 });
  assert.equal(told({ total_grams: "48.26" }).grams, 48.3);
});

test("extractBasis does without what a model left out or got wrong", () => {
  for (const bad of [undefined, null, 0, -5, "about 50 g", "Infinity", {}, true]) assert.equal(told({ total_grams: bad }).grams, null, String(bad));
  for (const bad of [undefined, null, 7, {}, ["x"]]) assert.deepEqual([told({ reference: bad }).ref, told({ reasoning: bad }).note], ["", ""]);
});

test("extractBasis cuts long text without splitting a character", () => {
  assert.equal(told({ reference: "a".repeat(300) }).ref.length, 120);
  assert.equal(told({ reasoning: "a".repeat(300) }).note.length, 200);
  const cut = told({ reference: "a".repeat(119) + "🐟🐟" }).ref;
  assert.equal(cut, "a".repeat(119) + "🐟");
});

test("extractBasis yields text a jsonb column accepts", () => {
  assert.deepEqual(told({ reference: " a\u0000b\n\tc ", reasoning: "x\ud83dy" }), { ref: "a b c", note: "xy", grams: 48, kcal: 100 });
});

test("knownTotals lists usable totals in the catalog's order, with units", () => {
  assert.equal(knownTotals({ sodium: 300, protein: 15.71, saturatedFat: 0, calories: 103 }), "calories 103 kcal, protein 15.71 g, saturated fat 0 g, sodium 300 mg");
});

test("knownTotals ignores anything else", () => {
  for (const none of [undefined, null, "protein", 5, [], {}, { vitaminC: 5 }, { protein: -1 }, { protein: NaN }, { protein: Infinity }, { protein: "22" }, { protein: null }]) {
    assert.equal(knownTotals(none), "", JSON.stringify(none));
  }
});

// The proxy's own source, for the prompt it sends.
const estimatePrompt = (() => {
  const source = fs.readFileSync(new URL("../supabase/functions/ai-proxy/index.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const functions = ["promptFields", "buildSystemPromptEstimate", "buildEstimatePromptText", "buildEstimatePrompt"].map((name) => source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n\\n`))[0]);
  const js = functions.join("").replace(/: (any|unknown|string\[\]|string)(?=[,)])/g, "");
  return new Function("MACRO_IDS", "knownTotals", `${js}return buildEstimatePrompt;`)(MACRO_IDS, knownTotals);
})();

test("the estimate prompt asks for a reference and a weight, in JSON a model can copy", () => {
  const { system, userOpenAI, userAnthropic, tokens } = estimatePrompt({ food: "Sardines", qty: 4, unit: "pcs" });
  const example = JSON.parse(system.slice(system.indexOf("{"), system.lastIndexOf("}") + 1).replace(/: </g, ': "<').replace(/>(,?)\n/g, '>"$1\n').replace(/""</g, '"<').replace(/>""/g, '>"'));
  assert.deepEqual(Object.keys(example), ["reasoning", "reference", "total_grams", ...MACRO_IDS.flatMap((id) => [`${id}_lower`, `${id}_upper`])]);
  assert.equal(userOpenAI, userAnthropic);
  assert.ok(userOpenAI.includes("Food: Sardines\nQuantity: 4 pcs\n"));
  assert.ok(!userOpenAI.includes("already known"));
  assert.equal(tokens, 650);
});

test("totals the user already knows are passed on as facts", () => {
  const { userOpenAI } = estimatePrompt({ food: "Sardines", qty: 80, unit: "g", known: { protein: 15.71 } });
  assert.ok(userOpenAI.endsWith("These totals for this quantity are already known. Treat them as facts and make the other values consistent with them: protein 15.71 g."), userOpenAI);
});
```

<!-- edit tests/proxy-shapes.test.mjs @T9t -->
```js
import assert from "node:assert";
import { createRequire } from "node:module";
```
```js
import assert from "node:assert";
import fs from "node:fs";
import { createRequire } from "node:module";
```

<!-- edit tests/metering.test.mjs @T9t -->
```js
import { computeCost, quotaState, mergeEstimates, rateLimited } from "../supabase/functions/_shared/metering.mjs";
```
```js
import { computeCost, quotaState, mergeEstimates, mergedHow, rateLimited } from "../supabase/functions/_shared/metering.mjs";
```

<!-- append tests/metering.test.mjs @T9t -->
```js

test("mergedHow says what mergeEstimates did", () => {
  const est = (kcal, protein) => ({ cal_low: kcal, cal_high: kcal, pro_low: protein, pro_high: protein, macros: {} });
  const cases = [
    [est(100, 10), null, "one"], [null, est(100, 10), "one"],
    [est(100, 10), est(110, 11), "average"],
    [est(100, 10), est(300, 10), "both"], [est(100, 10), est(100, 30), "both"],
    [est(60, 10), est(100, 10), "average"], // exactly at the threshold
    [est(0, 0), est(0, 0), "average"],
  ];
  for (const [a, b, how] of cases) {
    assert.equal(mergedHow(a, b, 0.4), how, JSON.stringify([a, b]));
    if (!a || !b) continue;
    const m = mergeEstimates(a, b, 0.4);
    assert.equal(how === "both", m.cal_low !== m.cal_high || m.pro_low !== m.pro_high, "agrees with the merge");
  }
});
```

- [ ] **Step 2: Run** `node --test tests/proxy-shapes.test.mjs tests/metering.test.mjs` — expected: both files fail to load (the new exports do not exist).

- [ ] **Step 3: Implement**

<!-- edit supabase/functions/_shared/proxy-shapes.mjs @T9 -->
```js
// Convert a merged/parsed estimate (flat macros) into the nested
```
```js
// One line of text that a jsonb column accepts (no control characters, no half of a
// character), at most max characters long.
function line(text, max) {
  if (typeof text !== "string") return "";
  const chars = [...text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()].filter((c) => !/^[\ud800-\udfff]$/.test(c));
  return chars.slice(0, max).join("");
}

// What one model says its estimate is based on.
export function extractBasis(o) {
  const grams = typeof o.total_grams === "number" || typeof o.total_grams === "string" ? Number(o.total_grams) : NaN;
  return {
    ref: line(o.reference, 120),
    note: line(o.reasoning, 200),
    grams: Number.isFinite(grams) && grams > 0 ? Math.round(grams * 10) / 10 : null,
    kcal: Math.round((Number(o.calories_lower) + Number(o.calories_upper)) / 2),
  };
}

// The totals a client says it already has, for the prompt: "protein 22 g, sodium 300 mg".
const MACRO_NAMES = { saturatedFat: "saturated fat" };
const MACRO_UNITS = { calories: "kcal", sodium: "mg" };
export function knownTotals(known) {
  return MACRO_IDS
    .filter((id) => known && typeof known === "object" && Number.isFinite(known[id]) && known[id] >= 0)
    .map((id) => `${MACRO_NAMES[id] ?? id} ${known[id]} ${MACRO_UNITS[id] ?? "g"}`)
    .join(", ");
}

// Convert a merged/parsed estimate (flat macros) into the nested
```

<!-- edit supabase/functions/_shared/metering.mjs @T9 -->
```js
export function mergeEstimates(a, b, widenThreshold) {
  if (!b) return a;
  if (!a) return b;
  const calDiverged = diverges(avg(a.cal_low, a.cal_high), avg(b.cal_low, b.cal_high), widenThreshold);
  const proDiverged = diverges(avg(a.pro_low, a.pro_high), avg(b.pro_low, b.pro_high), widenThreshold);
  const macros = {};
```
```js
function divergence(a, b, widenThreshold) {
  return {
    calDiverged: diverges(avg(a.cal_low, a.cal_high), avg(b.cal_low, b.cal_high), widenThreshold),
    proDiverged: diverges(avg(a.pro_low, a.pro_high), avg(b.pro_low, b.pro_high), widenThreshold),
  };
}

// What mergeEstimates makes of two answers: "one" (there is only one), "both" (they
// disagree, so a range covers both) or "average".
export function mergedHow(a, b, widenThreshold) {
  if (!a || !b) return "one";
  const { calDiverged, proDiverged } = divergence(a, b, widenThreshold);
  return calDiverged || proDiverged ? "both" : "average";
}

export function mergeEstimates(a, b, widenThreshold) {
  if (!b) return a;
  if (!a) return b;
  const { calDiverged, proDiverged } = divergence(a, b, widenThreshold);
  const macros = {};
```

<!-- edit supabase/functions/ai-proxy/index.ts @T9 -->
```ts
import { computeCost, quotaState, mergeEstimates, rateLimited } from "../_shared/metering.mjs";
import { MACRO_IDS, extractEstimateFields, toNestedMacros, mergePhotoItems } from "../_shared/proxy-shapes.mjs";
```
```ts
import { computeCost, quotaState, mergeEstimates, mergedHow, rateLimited } from "../_shared/metering.mjs";
import { MACRO_IDS, extractEstimateFields, extractBasis, knownTotals, toNestedMacros, mergePhotoItems } from "../_shared/proxy-shapes.mjs";
```

<!-- edit supabase/functions/ai-proxy/index.ts @T9 -->
```ts
// tokens = the per-feature budget the old adapters used
// (estimate 500, photo/vision 1500, assessment 8000).
// ============================================================

// Ported verbatim from www/app.js buildSystemPromptEstimate()
function buildSystemPromptEstimate(ids: string[]) {
```
```ts
// tokens = the per-feature budget the old adapters used (photo/vision 1500,
// assessment 8000), except the estimate's 500, now 650 for a longer answer.
// ============================================================

// Ported from www/app.js buildSystemPromptEstimate(); "reference" and "total_grams" added
function buildSystemPromptEstimate(ids: string[]) {
```

<!-- edit supabase/functions/ai-proxy/index.ts @T9 -->
```ts
  "reasoning": "<one short sentence naming the reference food and serving you scaled from>",
${promptFields(ids)}
}
Units: calories in kcal, sodium in mg, all other macros in grams.`;
}

// Ported verbatim from www/app.js buildEstimatePrompt()
function buildEstimatePromptText(food: string, qty: unknown, unit: string) {
  return `Estimate the nutritional content of this food:
```
```ts
  "reasoning": "<one short sentence naming the reference food and serving you scaled from>",
  "reference": "<the food these values are for and where they come from, e.g. canned sardines in oil, drained (USDA)>",
  "total_grams": <weight in grams of the whole quantity, or null if it cannot be judged>,
${promptFields(ids)}
}
Units: calories in kcal, sodium in mg, all other macros in grams.`;
}

// Ported from www/app.js buildEstimatePrompt(); the known totals added
function buildEstimatePromptText(food: string, qty: unknown, unit: string, known: unknown) {
  const totals = knownTotals(known);
  const facts = totals
    ? `\n\nThese totals for this quantity are already known. Treat them as facts and make the other values consistent with them: ${totals}.`
    : "";
  return `Estimate the nutritional content of this food:
```

<!-- edit supabase/functions/ai-proxy/index.ts @T9 -->
```ts
5. For variable items (restaurant food, home-cooked), widen ranges but stay evidence-based`;
}

function buildEstimatePrompt(payload: any) {
  const user = buildEstimatePromptText(payload.food, payload.qty, payload.unit);
```
```ts
5. For variable items (restaurant food, home-cooked), widen ranges but stay evidence-based${facts}`;
}

function buildEstimatePrompt(payload: any) {
  const user = buildEstimatePromptText(payload.food, payload.qty, payload.unit, payload.known);
```

<!-- edit supabase/functions/ai-proxy/index.ts @T9 -->
```ts
    tokens: 500,
```
```ts
    tokens: 650,
```

<!-- edit supabase/functions/ai-proxy/index.ts @T9 -->
```ts
  try { parsed = JSON.parse(cleaned); } catch { return null; }
  return extractEstimateFields(parsed);
}
```
```ts
  try { parsed = JSON.parse(cleaned); } catch { return null; }
  const fields = extractEstimateFields(parsed);
  return fields && { ...fields, basis: extractBasis(parsed) };
}
```

<!-- edit supabase/functions/ai-proxy/index.ts @T9 -->
```ts
      macros: toNestedMacros(merged),
      ai_thought_process: { a: okA?.text ?? null, b: okB?.text ?? null },
    });
  }
  if (feature === "photo") {
```
```ts
      macros: toNestedMacros(merged),
      // What each model that answered says its estimate is based on, and how the
      // answers were combined. Shown to the user: no model names.
      basis: [estA, estB].flatMap((est) => (est ? [est.basis] : [])),
      how: mergedHow(estA, estB, widenThreshold),
      ai_thought_process: { a: okA?.text ?? null, b: okB?.text ?? null },
    });
  }
  if (feature === "photo") {
```

- [ ] **Step 4: Run** the whole suite — expected: all pass.
- [ ] **Step 5: Run the whole handler locally** against stubs (Node can strip the types: `module.stripTypeScriptTypes`), without network: a plain estimate, one with `known`, one model failing, models that disagree, a model that answers without the new fields, and the photo and assessment features. Compare every other part of the responses, the ledger rows and the requests to both providers with those of the version on `main`: only what this task names may differ.
- [ ] **Step 6: Commit** `feat(proxy): estimates say what they are based on and accept known totals`

---

### Task 10: Verification and documentation

**Files:** Create `docs/sql/2026-11-23-food-nutrition-01.sql`; modify `docs/HANDOFF.md`, `CLAUDE.md`, the spec (status and amendments)

- [ ] **Step 1: The column, as a file**

<!-- write docs/sql/2026-11-23-food-nutrition-01.sql @T10 -->
```sql
-- food_nutrition_01: what an entry's numbers are based on (see
-- docs/superpowers/specs/2026-11-23-nutrition-details-design.md, "Data model").
-- Nullable and without a default: existing rows and older builds are unaffected.
-- Must be applied BEFORE a build with www/nutrition.js is used: PostgREST refuses a
-- save that names a column it does not know.
alter table public.food_entries add column if not exists nutrition jsonb;
```

- [ ] **Step 2: Whole suite**: `npm test`. Expected: all pass.
- [ ] **Step 3: Mutation checks.** Each of these, applied alone, must make at least one test fail:
  - R1: scaling skipped for typed numbers; the label's amount multiplied instead of divided; `scale` not rounding; the weight correction applied to typed numbers
  - R2: `isMine` ignored in `applyAnswer`; in `resolve` on a lookup; `macros` left out of the conditional update; left out of the local check; `pending` not required
  - R3: numbers dropped on rename; on failure; `refresh` dropped on failure
  - R4: an amount change marked pending; a remembered food marked pending; `findRemembered` ignoring units, status, photo, completeness, order, id ties
  - Form: an invalid number saved; a basis that does not convert accepted; a cleared number kept
  - Text: `escapeHtml` removed from the explanation and the tag
  - Proxy: control characters kept; `known` values not checked; `how` inverted
- [ ] **Step 4: Random two-device runs** (extend the sync fuzzer): add, edit amounts and names, type numbers, ask again, go offline, answers late or failing, reload. After every run: no entry lost; no typed number changed except by the user, or by scaling with the amount; both devices equal to the server once synced.
- [ ] **Step 5: Real browser** with the real Supabase client against the stand-in server (learns `nutrition`, the `macros` filter and unknown columns): add, reuse, type, label, ask again, weight, failure, two tabs. Layout at 360, 390, 720 and 1280 px and at 125% and 150%: no clipped text, no sideways scroll, buttons reachable, both themes.
- [ ] **Step 6: Emulator**, owner's session, **before** the column exists: look only, save nothing (a save would be refused). Open Add and Edit, the explanation, the section's fields with the keyboard up.
- [ ] **Step 7: Independent review** of the whole diff by a fresh reviewer who has the spec and no other context; reproduce each finding with a test before fixing it.
- [ ] **Step 8: Documentation**: HANDOFF (state, pending yes, how to verify), CLAUDE.md (test count, key facts), spec status and amendments.
- [ ] **Step 9: Commit and push the branch** (not `main`).

---

### Task 11: Production (each step needs the user's explicit yes)

Nothing above touches production. `main` is the folder the user runs, so the client must not reach it before the column exists.

- [ ] **Step 1: Migration.** Fingerprint first (`md5` over every existing column of `food_entries`, per user). Apply `food_nutrition_01`. Check: column present, nullable, no default; RLS and grants unchanged; fingerprints equal; the API log shows no 4xx from the running app.
- [ ] **Step 2: Client.** Merge the branch to `main`, push. `npx cap sync android`, `.\gradlew.bat installDebug`. Emulator, owner's session: re-save one entry byte-identically (no-op upsert and no-op conditional update), fingerprints equal before and after.
- [ ] **Step 3: Proxy v12.** Deploy, download, compare byte for byte with the repo. Smoke on the owner's account (a few cents): a plain estimate, one with `known`, on both providers; check `basis`, `how`, the ledger rows, and the log for refusals.
- [ ] **Step 4: Watch** the API log for an hour of real use: no 400 on `food_entries`; a real new entry goes `POST 201` → `PATCH 204` and its row is `done` with eight nutrients.

**Rollback.** Proxy: redeploy `supabase/functions` from `829279f` (v11). Client: `git revert` the merge. Column: leave it; older builds ignore it.
