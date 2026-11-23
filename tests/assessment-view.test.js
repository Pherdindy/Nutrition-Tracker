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
