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
