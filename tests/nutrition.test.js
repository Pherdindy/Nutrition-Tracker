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
