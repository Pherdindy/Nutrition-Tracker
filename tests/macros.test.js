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
