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
