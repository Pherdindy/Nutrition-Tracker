// "Today" is the calendar date where the user is, not the UTC date: the two differ
// for part of every day (the early morning in Asia, the evening in the Americas).
const test = require("node:test");
const assert = require("node:assert");
const { bootApp, createFakeServer } = require("./helpers/app-harness.js");

const PROFILE = { height: 170, age: 32, protein_low: 135, protein_high: 150, weight_loss_goal: "0.50 kg/week" };
const MANILA = { tz: "Asia/Manila", now: "2026-11-22T17:04:00Z" };       // Mon Nov 23, 01:04
const NEW_YORK = { tz: "America/New_York", now: "2026-11-23T01:30:00Z" }; // Sun Nov 22, 20:30

async function at({ tz, now }, options = {}) {
  process.env.TZ = tz;
  return bootApp({ server: createFakeServer({ profile: PROFILE }), now, ...options });
}

for (const [place, when, today] of [["Manila after midnight", MANILA, "2026-11-23"], ["New York in the evening", NEW_YORK, "2026-11-22"]]) {
  test(`${place}: a new food is dated today`, async () => {
    const app = await at(when);
    app.fire("add-food-btn", "click");
    assert.equal(app.el("food-date").value, today);
    assert.equal(app.el("batch-date").value, today);
  });

  test(`${place}: a workout is added to today`, async () => {
    const app = await at(when);
    app.fire("add-workout-btn", "click");
    assert.equal(app.el("day-date").value, today);
  });

  test(`${place}: photo items are dated today`, async () => {
    const app = await at(when);
    app.addPhotoItems(["Soup"]);
    assert.equal(app.entry("Soup").date, today);
  });

  test(`${place}: the custom assessment range ends today`, async () => {
    const app = await at(when);
    assert.equal(app.el("assessment-date-to").value, today);
  });

  test(`${place}: onboarding starts the log today`, async () => {
    const app = await at(when, { server: createFakeServer() });
    Object.entries({ height: 170, age: 32, weight: 168, "protein-low": 135, "protein-high": 150, goal: "Maintain", activity: "Gym" })
      .forEach(([id, value]) => { app.el(`ob-${id}`).value = String(value); });
    app.fire("onboarding-form", "submit");
    assert.deepEqual(app.days().map((d) => d.date), [today]);
  });
}

test("assessment periods end yesterday and are counted from here, not from UTC", async () => {
  const app = await at(MANILA);
  const range = (period) => JSON.parse(app.run(`JSON.stringify(getDateRangeForPeriod("${period}"))`));
  assert.deepEqual(range("today"), { startDate: "2026-11-22", endDate: "2026-11-22" });
  assert.deepEqual(range("week"), { startDate: "2026-11-16", endDate: "2026-11-22" });
  assert.deepEqual(range("month"), { startDate: "2026-10-24", endDate: "2026-11-22" });
  assert.deepEqual(range("quarter"), { startDate: "2026-08-25", endDate: "2026-11-22" });
  assert.deepEqual(range("semi"), { startDate: "2026-05-27", endDate: "2026-11-22" });
  assert.deepEqual(range("year"), { startDate: "2025-11-23", endDate: "2026-11-22" });
  assert.deepEqual(range("unknown"), { startDate: "2026-11-16", endDate: "2026-11-22" });
});

test("year over year runs to today", async () => {
  const app = await at(MANILA);
  assert.equal(app.run('getAssessmentData("yoy").endDate'), "2026-11-23");
});

test("the custom range starts six days before today", async () => {
  const app = await at(MANILA);
  assert.equal(app.el("assessment-date-from").value, "2026-11-17");
});

test("single-digit months and days keep their zero", async () => {
  const app = await at({ tz: "Asia/Manila", now: "2026-01-04T20:00:00Z" });
  app.fire("add-food-btn", "click");
  assert.equal(app.el("food-date").value, "2026-01-05");
});

test("editing an entry keeps the date it was logged under", async () => {
  process.env.TZ = MANILA.tz;
  const server = createFakeServer({
    profile: PROFILE,
    food: [{ id: 1, date: "2026-11-20", time: "08:00", food: "Rice", qty: 1, unit: "pc", macros: { calories: { low: 1, high: 1 } }, estimate_status: "done" }],
  });
  const app = await bootApp({ server, now: MANILA.now });
  app.editFood("Rice", { time: "09:00" });
  assert.equal(app.entry("Rice").date, "2026-11-20");
});
