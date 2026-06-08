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

test("formatMacro: single shows midpoint, range shows low-high (collapsed when equal)", () => {
  assert.equal(M.formatMacro({ low: 100, high: 120 }, "single"), "110");
  assert.equal(M.formatMacro({ low: 100, high: 120 }, "range"), "100–120");
  assert.equal(M.formatMacro({ low: 50, high: 50 }, "range"), "50");
  assert.equal(M.formatMacro(null, "single"), "—");
});

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

test("averageEstimates returns {} for empty results (no NaN)", () => {
  assert.deepEqual(M.averageEstimates([], ["calories"]), {});
});
test("formatMacro range collapses when equal after rounding", () => {
  assert.equal(M.formatMacro({ low: 10.05, high: 10.1 }, "range"), "10.1");
});
test("resolveEnabled([]) returns only locked macros", () => {
  assert.deepEqual(M.resolveEnabled([]), ["calories", "protein"]);
});
test("promptFields exact format for a single macro", () => {
  assert.equal(M.promptFields(["calories"]),
    '  "calories_lower": <number>,\n  "calories_upper": <number>');
});

test("needsReestimate true iff food/qty/unit changed (not date/time)", () => {
  const o = { food: "Oat", qty: 100, unit: "g" };
  assert.equal(M.needsReestimate(o, { food: "Oat", qty: 100, unit: "g" }), false);
  assert.equal(M.needsReestimate(o, { food: "Oat", qty: 150, unit: "g" }), true);   // qty
  assert.equal(M.needsReestimate(o, { food: "Oat", qty: 100, unit: "cup" }), true);  // unit
  assert.equal(M.needsReestimate(o, { food: "Oats", qty: 100, unit: "g" }), true);   // food
  assert.equal(M.needsReestimate(null, { food: "Oat", qty: 100, unit: "g" }), true); // no original (add)
});
