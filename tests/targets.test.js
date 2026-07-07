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

test("calDeltaDisplay: whole range under target -> 'a–b under target', good, abs values small-first", () => {
  assert.deepEqual(T.calDeltaDisplay(-273, -70), { text: "70–273 under target", tone: "good", icon: "" });
});

test("calDeltaDisplay: whole range over target -> 'a–b over target', bad", () => {
  assert.deepEqual(T.calDeltaDisplay(112, 283), { text: "112–283 over target", tone: "bad", icon: "" });
});

test("calDeltaDisplay: range straddling zero or within ±50 band -> 'on target', neutral", () => {
  assert.deepEqual(T.calDeltaDisplay(-30, 40), { text: "on target", tone: "neutral", icon: "" });
  assert.deepEqual(T.calDeltaDisplay(-40, -10), { text: "on target", tone: "neutral", icon: "" }); // inside ±50 band
  assert.deepEqual(T.calDeltaDisplay(10, 45), { text: "on target", tone: "neutral", icon: "" });   // inside ±50 band
  assert.deepEqual(T.calDeltaDisplay(0, 0), { text: "on target", tone: "neutral", icon: "" });
  assert.deepEqual(T.calDeltaDisplay(-60, 0), { text: "on target", tone: "neutral", icon: "" });   // touches zero = straddle
});

test("calDeltaDisplay: just outside the ±50 band is not neutral", () => {
  assert.deepEqual(T.calDeltaDisplay(-60, -20), { text: "20–60 under target", tone: "good", icon: "" });
  assert.deepEqual(T.calDeltaDisplay(20, 60), { text: "20–60 over target", tone: "bad", icon: "" });
});

test("calDeltaDisplay: degenerate range -> single number", () => {
  assert.deepEqual(T.calDeltaDisplay(-170, -170), { text: "170 under target", tone: "good", icon: "" });
  assert.deepEqual(T.calDeltaDisplay(200, 200), { text: "200 over target", tone: "bad", icon: "" });
});

test("calDeltaDisplay: rounds fractional inputs", () => {
  assert.deepEqual(T.calDeltaDisplay(-272.6, -70.4), { text: "70–273 under target", tone: "good", icon: "" });
});

test("calDeltaDisplay: invalid input -> empty neutral fallback", () => {
  const empty = { text: "", tone: "neutral", icon: "" };
  assert.deepEqual(T.calDeltaDisplay(NaN, -70), empty);
  assert.deepEqual(T.calDeltaDisplay(null, -70), empty);
  assert.deepEqual(T.calDeltaDisplay(undefined, undefined), empty);
});

test("proteinStatusDisplay: met (low end at/above target low) -> good ✓; exceeding high stays good", () => {
  assert.deepEqual(T.proteinStatusDisplay(136, 147, 135, 150),
    { text: "136–147 g (target 135–150)", tone: "good", icon: "✓" });
  assert.deepEqual(T.proteinStatusDisplay(155, 170, 135, 150),
    { text: "155–170 g (target 135–150)", tone: "good", icon: "✓" });
});

test("proteinStatusDisplay: missed (high end below target low) -> bad ✗", () => {
  assert.deepEqual(T.proteinStatusDisplay(93, 102, 135, 150),
    { text: "93–102 g (target 135–150)", tone: "bad", icon: "✗" });
});

test("proteinStatusDisplay: straddles target low -> warn ~", () => {
  assert.deepEqual(T.proteinStatusDisplay(128, 140, 135, 150),
    { text: "128–140 g (target 135–150)", tone: "warn", icon: "~" });
});

test("proteinStatusDisplay: degenerate ranges collapse to single numbers", () => {
  assert.deepEqual(T.proteinStatusDisplay(140, 140, 135, 150),
    { text: "140 g (target 135–150)", tone: "good", icon: "✓" });
  assert.deepEqual(T.proteinStatusDisplay(100, 100, 135, 135),
    { text: "100 g (target 135)", tone: "bad", icon: "✗" });
});

test("proteinStatusDisplay: rounds fractional intake", () => {
  assert.deepEqual(T.proteinStatusDisplay(135.6, 147.2, 135, 150),
    { text: "136–147 g (target 135–150)", tone: "good", icon: "✓" });
});

test("proteinStatusDisplay: invalid input -> empty neutral fallback", () => {
  const empty = { text: "", tone: "neutral", icon: "" };
  assert.deepEqual(T.proteinStatusDisplay(NaN, 147, 135, 150), empty);
  assert.deepEqual(T.proteinStatusDisplay(136, 147, null, 150), empty);
  assert.deepEqual(T.proteinStatusDisplay(undefined, undefined, undefined, undefined), empty);
});

test("calDeltaDisplay: reversed arguments are normalized", () => {
  assert.deepEqual(T.calDeltaDisplay(-70, -273), { text: "70–273 under target", tone: "good", icon: "" });
});

test("calDeltaDisplay: exact ±50 band edges are neutral", () => {
  assert.deepEqual(T.calDeltaDisplay(-50, -50), { text: "on target", tone: "neutral", icon: "" });
  assert.deepEqual(T.calDeltaDisplay(50, 50), { text: "on target", tone: "neutral", icon: "" });
});

test("proteinStatusDisplay: reversed intake arguments are normalized", () => {
  assert.deepEqual(T.proteinStatusDisplay(147, 136, 135, 150),
    { text: "136–147 g (target 135–150)", tone: "good", icon: "✓" });
});
