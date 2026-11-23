// Workouts, end to end: the real www/app.js against a fake server (see helpers/app-harness.js).
const test = require("node:test");
const assert = require("node:assert");
const { bootApp, createFakeServer, createDevice } = require("./helpers/app-harness.js");

const SAT = "🪑 Sat all day (no exercise)", LIGHT = "🚶 Light activity (walked / errands)", GYM = "🏋️ Gym day (moderate workout)";
const PROFILE = { height: 170, age: 32, protein_low: 135, protein_high: 150, weight_loss_goal: "0.50 kg/week" };
const DATE = "2026-11-23";
const dayRow = (over = {}) => ({ id: 1, date: DATE, weight: 180, activity: SAT, incomplete: false, age: 32, deficit: 550, protein_target_low: 135, protein_target_high: 150, ...over });
const effort = (low, high = low, over = {}) => ({ at: 5, met: { low, high }, why: [{ ref: "Bike", note: "Steady.", met: (low + high) / 2, minutes: 90 }], how: "one", ...over });
const row = (id, what, over = {}) => ({ id, date: DATE, what, minutes: 90, kcal: null, effort: effort(6, 7), estimate_status: "done", ...over });
const js = (id, what, over = {}) => ({ id, date: DATE, what, minutes: 90, kcal: null, effort: effort(6, 7), estimateStatus: "done", ...over });
const answer = (low = 5, high = 6, minutes = 60) => ({ data: { met: { low, high }, minutes, basis: [{ ref: "Ref", note: "Note.", met: (low + high) / 2, minutes }], how: "one" }, error: null });
function serverWith({ workouts = [], days = [dayRow()], food = [] } = {}) {
  const server = createFakeServer({ profile: PROFILE, workouts, days, food });
  server.ai = () => answer();
  return server;
}
const on = (server, what) => server.workouts().find((w) => w.what === what);
const put = (app, ...list) => app.run(`saveWorkouts([...loadWorkouts(), ...${JSON.stringify(list)}])`);

// ---- stored ---------------------------------------------------------------------------

test("a workout reaches the server as it is, and the next device", async () => {
  const server = serverWith();
  const a = await bootApp({ server });
  put(a, js(7, "Bike", { minutes: 22.5, kcal: 500 }));
  await a.settle();
  const { user_id, ...saved } = on(server, "Bike");
  assert.deepEqual(saved, row(7, "Bike", { minutes: 22.5, kcal: 500 }));
  const b = await bootApp({ server, device: createDevice() });
  assert.deepEqual(b.workouts(), [js(7, "Bike", { minutes: 22.5, kcal: 500 })]);
  assert.deepEqual([a.errors, b.errors], [[], []]);
});

test("loading saves nothing", async () => {
  const server = serverWith({ workouts: [row(1, "Bike"), row(2, "Run", { kcal: 0, effort: {} })] });
  const app = await bootApp({ server });
  app.run("saveWorkouts(loadWorkouts())");
  await app.settle();
  assert.deepEqual([server.writes, app.run("outbox.count()")], [[], 0]);
});

test("saved offline: here after a relaunch, and delivered later", async () => {
  const server = serverWith(), device = createDevice();
  const a = await bootApp({ server, device });
  device.online = false;
  put(a, js(7, "Bike"));
  await a.settle();
  const again = await bootApp({ server, device });
  assert.deepEqual(again.workouts(), [js(7, "Bike")]);
  device.online = true;
  await again.windowEvent("online");
  assert.deepEqual([server.workouts().length, again.run("outbox.count()")], [1, 0]);
});

test("a workout added here and the day changed there: both count", async () => {
  const server = serverWith();
  const a = await bootApp({ server }), b = await bootApp({ server, device: createDevice() });
  b.editDay(DATE, { weight: 170 });
  await b.settle();
  put(a, js(7, "Bike"));
  await a.settle();
  assert.deepEqual([server.days()[0].weight, server.workouts().length], [170, 1]);
});

test("deleted on one device, it does not come back from another", async () => {
  const server = serverWith({ workouts: [row(1, "Bike"), row(2, "Run")] });
  const a = await bootApp({ server }), b = await bootApp({ server, device: createDevice() });
  a.run("removeWorkout(1)");
  await a.settle();
  put(b, js(9, "Swim"));
  await b.settle();
  assert.deepEqual(server.workouts().map((w) => w.what).sort(), ["Run", "Swim"]);
  assert.deepEqual(a.workouts().map((w) => w.what), ["Run"]);
});

test("more than the server gives at once", async () => {
  const server = serverWith({ workouts: Array.from({ length: 2345 }, (_, i) => row(i + 1, `W${i}`)) });
  const app = await bootApp({ server });
  assert.equal(app.workouts().length, 2345);
});

test("the server cannot be read: the copy on this device, with what is unsent", async () => {
  const server = serverWith({ workouts: [row(1, "Bike")] }), device = createDevice();
  const a = await bootApp({ server, device });
  device.online = false;
  put(a, js(7, "Run"));
  await a.settle();
  const again = await bootApp({ server, device });
  assert.deepEqual(again.workouts().map((w) => w.what).sort(), ["Bike", "Run"]);
});

test("signing out leaves nothing, and another account sees nothing", async () => {
  const server = serverWith({ workouts: [row(1, "Bike")] }), device = createDevice();
  const a = await bootApp({ server, device });
  assert.ok(device.keys().some((k) => /_workouts$/.test(k)));
  await a.signOut();
  assert.deepEqual(device.keys().filter((k) => /workouts/.test(k)), []);
  const other = await bootApp({ server, device: createDevice(), uid: "someone-else-02" });
  assert.deepEqual(other.workouts(), []);
});

test("the workouts of a day, the first added first", async () => {
  const app = await bootApp({ server: serverWith({ workouts: [row(5, "Run"), row(2, "Bike"), row(3, "Other day", { date: "2026-11-22" })] }) });
  assert.deepEqual(JSON.parse(app.run(`JSON.stringify(workoutsOn("${DATE}").map((w) => w.what))`)), ["Bike", "Run"]);
});

test("a tab follows what another tab stores", async () => {
  const server = serverWith({ workouts: [row(1, "Bike"), row(2, "Run")] }), device = createDevice();
  const a = await bootApp({ server, device }), b = await bootApp({ server, device });
  const prefix = a.run("outboxPrefix(currentUid())");
  const tell = (id) => { const key = `${prefix}workouts:${id}`; return b.windowEvent("storage", { key, newValue: device.storage.getItem(key) }); };
  device.online = false;
  a.run(`{ const list = loadWorkouts(); list[list.findIndex((w) => w.id === 1)] = ${JSON.stringify(js(1, "Bike", { minutes: 30 }))}; saveWorkouts(list); removeWorkout(2); }`);
  await tell(1);
  await tell(2);
  assert.deepEqual(b.workouts(), [js(1, "Bike", { minutes: 30 })]);
  device.online = true;
  await b.windowEvent("online");
  assert.deepEqual(server.workouts().map((w) => [w.what, w.minutes]), [["Bike", 30]]);
});

test("what another tab changes while this one is loading is not missed", async () => {
  const server = serverWith({ workouts: [row(1, "Bike")] }), device = createDevice();
  const a = await bootApp({ server, device });
  const key = `${a.run("outboxPrefix(currentUid())")}workouts:1`;
  let tell;
  server.afterSelect = async (table) => {
    if (table !== "workouts") return;
    server.afterSelect = null;
    a.run("removeWorkout(1)");
    await a.settle();
    tell("storage", { key, newValue: null });
  };
  const b = await bootApp({ server, device, loading: (fn) => { tell = fn; } });
  await b.settle();
  assert.deepEqual(b.workouts(), []);
});

// ---- totals and new days ----------------------------------------------------------------

const KG = 180 / 2.20462, BMR = 10 * KG + 6.25 * 170 - 5 * 32 + 5;
const trackerRow = (app, date = "11-23-26") => app.run("renderCalorieTracker(); document.querySelector('#calorie-tracker-table tbody').innerHTML").split("<tr").find((tr) => tr.includes(date));
const numbersOf = (tr) => [...tr.matchAll(/<td class="num[^>]*>([^<]*)<\/td>/g)].map(([, text]) => text);

test("a day without workouts is what it was, for every choice", async () => {
  for (const [label, multiplier] of [[SAT, 1.2], [LIGHT, 1.375], [GYM, 1.55], ["💪 Hard gym session (intense)", 1.725], ["🏃 Very active day (sports + gym)", 1.9], ["Gym", 1.2]]) {
    const app = await bootApp({ server: serverWith({ days: [dayRow({ activity: label })] }) });
    const [weight, bmr, tdee, target] = numbersOf(trackerRow(app));
    assert.deepEqual([weight, bmr, tdee, target], ["180", BMR.toFixed(1), (BMR * multiplier).toFixed(1), (BMR * multiplier - 550).toFixed(0)], label);
    assert.ok(trackerRow(app).includes(`<td>${label}</td>`));
  }
});

test("workouts are part of the day's total, its target and what follows", async () => {
  const app = await bootApp({ server: serverWith({ workouts: [row(1, "Bike"), row(2, "Run", { kcal: 100, effort: {} }), row(3, "Other day", { date: "2026-11-22" })] }) });
  const total = BMR * 1.2 + 5.5 * KG * 1.5 + 100;
  assert.deepEqual(numbersOf(trackerRow(app)).slice(2, 4), [total.toFixed(1), (total - 550).toFixed(0)]);
});

test("nothing is counted twice: 'Gym day' with workouts counts and shows as sitting", async () => {
  const app = await bootApp({ server: serverWith({ days: [dayRow({ activity: GYM })], workouts: [row(1, "Bike")] }) });
  assert.equal(numbersOf(trackerRow(app))[2], (BMR * 1.2 + 5.5 * KG * 1.5).toFixed(1));
  assert.ok(trackerRow(app).includes("🪑 Sat all day") && !trackerRow(app).includes("Gym day"));
});

test("the day's line names its workouts, what is known about them, and escapes them", async () => {
  const app = await bootApp({ server: serverWith({ days: [dayRow({ activity: LIGHT })], workouts: [
    row(1, "<b>Bike</b>"), row(2, "Run", { minutes: 0, kcal: 120, effort: {} }), row(3, "Swim", { effort: {}, estimate_status: "error" }),
    row(4, "Row", { effort: {}, estimate_status: "pending" }), row(5, "Walk", { effort: effort(3, 3, { from: { id: 1, date: "2026-11-20" } }) })] }) });
  const tr = trackerRow(app), text = tr.replace(/<[^>]+>/g, "|");
  assert.ok(!tr.includes("<b>Bike</b>"));
  for (const part of ["🚶 Light activity", "&lt;b&gt;Bike&lt;/b&gt; · 90 min · 612–735 kcal", "Run · 120 kcal", "yours", "Swim · 90 min", "not estimated", "Row · 90 min", "estimating…", "Walk · 90 min · 245 kcal", "from Nov 20"]) assert.ok(text.includes(part), part);
  assert.ok(!text.includes("(walked / errands)"), "the bracket would contradict the workouts");
  assert.ok(/onclick="retryWorkout\(3\)"/.test(tr) && !/retryWorkout\(4\)/.test(tr));
});

test("on phones too", async () => {
  const app = await bootApp({ server: serverWith({ workouts: [row(1, "<i>Bike</i>"), row(2, "Swim", { effort: {}, estimate_status: "error" })] }) });
  const html = app.run("isMobile = () => true; renderDayCards(); document.getElementById('day-cards').innerHTML");
  const total = BMR * 1.2 + 5.5 * KG * 1.5;
  for (const part of ["&lt;i&gt;Bike&lt;/i&gt; · 90 min · 612–735 kcal", `${BMR.toFixed(0)} / ${total.toFixed(0)}`, `/ ${(total - 550).toFixed(0)} cal`, "🪑 Sat all day", "not estimated"]) assert.ok(html.includes(part), part);
});

test("the assessment is told of the workouts and the total they make", async () => {
  const app = await bootApp({ server: serverWith({ workouts: [row(1, "Bike")], food: [{ id: 9, date: DATE, time: "08:00", food: "Eggs", qty: 1, unit: "pc", macros: { calories: { low: 100, high: 100 } }, estimate_status: "done", nutrition: null, cal_low: 100, cal_high: 100, pro_low: null, pro_high: null, ai_thought_process: null }] }), now: "2026-11-24T08:00:00Z" });
  const ctx = JSON.parse(app.run(`JSON.stringify(getAssessmentData("week").dailyContext["${DATE}"])`));
  const total = BMR * 1.2 + 5.5 * KG * 1.5;
  assert.deepEqual(ctx, { activity: "🪑 Sat all day + Bike, 90 min (674 kcal)", tdee: Math.round(total), deficit: 550, calorieTarget: Math.round(total - 550) });
});

test("a new day starts with the last rest choice and weight, never with a workout", async () => {
  const app = await bootApp({ server: serverWith({ days: [dayRow({ id: 1, date: "2026-11-21", activity: LIGHT, weight: 170 }), dayRow({ id: 2, date: "2026-11-23", activity: GYM, weight: 180 })] }) });
  app.addFood("Eggs", { date: "2026-11-24" });
  await app.settle();
  const { activity, weight } = app.days().find((d) => d.date === "2026-11-24");
  assert.deepEqual([activity, weight], [LIGHT, 180]);
});

test("a new day with nothing to go by is one of sitting", async () => {
  const app = await bootApp({ server: serverWith({ days: [dayRow({ activity: GYM })] }) });
  app.addFood("Eggs", { date: "2026-11-24" });
  assert.equal(app.days().find((d) => d.date === "2026-11-24").activity, SAT);
});

test("a day added for the past goes by what came before it", async () => {
  const app = await bootApp({ server: serverWith({ days: [dayRow({ id: 1, date: "2026-11-10", activity: LIGHT }), dayRow({ id: 2, date: "2026-11-23", activity: SAT })] }) });
  app.addFood("Eggs", { date: "2026-11-12" });
  assert.equal(app.days().find((d) => d.date === "2026-11-12").activity, LIGHT);
});

test("the list on the Calorie Target tab and at the start has every choice", async () => {
  const app = await bootApp({ server: serverWith() });
  app.run("renderCalorieTarget()");
  const html = app.run("document.querySelector('#activity-table tbody').innerHTML");
  for (const part of ["Zone 2 cardio, about 45 min", "1.400", "Zone 2 cardio, 90 min or more", "1.600", "Hard cardio (run, intervals), about 45 min", "1.500", "Gym day (moderate workout)", "1.550"]) assert.ok(html.includes(part), part);
});
