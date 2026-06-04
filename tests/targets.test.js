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
