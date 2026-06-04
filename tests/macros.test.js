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
