// A column of numbers is right-aligned (class "num"), and so is its header.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bootApp, createFakeServer } = require("./helpers/app-harness.js");

const www = (name) => fs.readFileSync(path.join(__dirname, "..", "www", name), "utf8").replace(/\r\n/g, "\n");
const range = (n) => ({ low: n, high: n });

// Which cells of a row are numbers: [false, true, ...], or null for a row that spans columns.
const numbers = (tr) => (/colspan/.test(tr) ? null : [...tr.matchAll(/<t[hd]\b([^>]*)>/g)].map(([, attrs]) => /class="(?:[^"]* )?num(?: [^"]*)?"/.test(attrs)));
const rows = (html) => [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([tr]) => tr);
function check(name, head, body) {
  const header = numbers(rows(head)[0]), lines = rows(body).map(numbers).filter(Boolean);
  assert.ok(lines.length, `${name} has a row to compare`);
  for (const line of lines) assert.deepEqual(header, line, name);
}
// Every table of a piece of HTML that has a header.
function checkAll(name, html, atLeast) {
  const tables = [...html.matchAll(/<table\b[^>]*class="([^"]*)"[^>]*>\s*<thead>([\s\S]*?)<\/thead>\s*<tbody>([\s\S]*?)<\/tbody>/g)];
  assert.ok(tables.length >= atLeast, `${name}: ${tables.length} tables`);
  for (const [, cls, head, body] of tables) check(`${name}: ${cls}`, head, body);
}
const staticHead = (id) => new RegExp(`id="${id}"[\\s\\S]*?<thead>([\\s\\S]*?)</thead>`).exec(www("index.html"))[1];

const food = {
  id: 1, date: "2026-11-20", time: "08:00", food: "Eggs", qty: 2, unit: "pcs", macros: { calories: range(150), protein: range(12) },
  estimate_status: "done", nutrition: null, cal_low: 150, cal_high: 150, pro_low: 12, pro_high: 12, ai_thought_process: null,
};
const day = { id: 1, date: "2026-11-20", weight: 168, activity: "Gym", incomplete: false, age: 32, deficit: 550, protein_target_low: 135, protein_target_high: 150 };
const boot = () => bootApp({ server: createFakeServer({ profile: { height: 170, age: 32, protein_low: 135, protein_high: 150, weight_loss_goal: "0.50 kg/week" }, food: [food], days: [day] }) });
const body = (app, id) => app.run(`document.querySelector("#${id} tbody").innerHTML`);

test("food, day and target tables", async () => {
  const app = await boot();
  app.run(`document.getElementById("food-date-filter").value = ""; renderFoodTable(); renderCalorieTracker(); renderCalorieTarget();`);
  check("food", app.el("food-eaten-head").innerHTML, body(app, "food-eaten-table"));
  check("days", staticHead("calorie-tracker-table"), body(app, "calorie-tracker-table"));
  check("activity", staticHead("activity-table"), body(app, "activity-table"));
  check("goals", staticHead("goals-table"), body(app, "goals-table"));
});

test("assessment tables", async () => {
  const app = await boot();
  const data = {
    startDate: "2026-11-16", endDate: "2026-11-22", dates: ["2026-11-20"], numDays: 1, totalEntries: 1, foodByDate: { "2026-11-20": [food] }, excludedIncompleteDays: 0,
    dailyContext: { "2026-11-20": { activity: "Gym", tdee: 2673, deficit: 550, calorieTarget: 2123 } },
    avgCalLow: 1, avgCalHigh: 2, avgProLow: 1, avgProHigh: 2, avgProTargetLow: 135, avgProTargetHigh: 150,
  };
  const summary = (over) => { app.run(`renderAssessmentDataSummary(${JSON.stringify({ ...data, ...over })})`); return app.el("assessment-data-summary").innerHTML; };
  checkAll("per day", summary(), 1);
  checkAll("year over year", summary({ isYoY: true, previousYear: { totalEntries: 3, numDays: 2, avgCalLow: 1, avgCalHigh: 2, avgProLow: 1, avgProHigh: 2 } }), 2);
  checkAll("no days", summary({ dailyContext: {} }), 1);
  const group = { score: 5, servings_estimated: 1, recommended: 2, status: "low" };
  checkAll("food groups", app.run(`renderSingleAssessment(${JSON.stringify({ provider: "x", data: { overall_score: 5, food_groups: { fruits: group, vegetables: group } } })})`), 1);
  checkAll("action plan", app.run(`renderActionPlan(${JSON.stringify({ action_plan: { daily_targets: [{ group: "Fruit", current: 1, target: 2, add: "an apple" }], stop_and_replace: [{ stop: "a", why: "b", replace_with: "c" }], sourcing_guide: [{ food: "a", risk: "b", what_to_look_for: "c" }] } })})`), 3);
  app.run(`loadAssessments = () => ${JSON.stringify([{ timestamp: "2026-07-31T00:00:00Z", period: "year", verdict: "single", final: { overall_score: 5 }, dataSummary: { numDays: 11, totalEntries: 126, excludedIncompleteDays: 1 } }])}; renderAssessmentHistory()`);
  checkAll("history", app.el("assessment-history").innerHTML, 1);
});

test("a number's header is right-aligned in every table: no other header rule wins", () => {
  const css = www("styles.css");
  const rule = css.lastIndexOf("th.num {");
  assert.match(css.slice(rule), /^th\.num \{\s*text-align: right;\s*\}/);
  const others = [...css.matchAll(/(?:^|\n)([^\n{}@]*\bth\b[^\n{}]*)\{([^}]*)\}/g)].filter(([, selector, body]) => /text-align/.test(body) && !/th\.num/.test(selector));
  assert.ok(others.length >= 5, "found the tables' own rules");
  for (const m of others) {
    const selector = m[1].trim(), classes = (selector.match(/\./g) || []).length, elements = (selector.match(/(^|[\s>])[a-z]/g) || []).length;
    const unused = /^\.validation-/.test(selector); // no such table any more
    assert.ok(unused || (m.index < rule && classes <= 1 && classes + elements <= 2), selector);
  }
});
