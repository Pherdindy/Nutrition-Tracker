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

// ---- the AI's answers ---------------------------------------------------------------------

const log = (app, ...list) => app.run(`storeWorkouts("${DATE}", ${JSON.stringify(list.map((w, i) => ({ id: 100 + i, what: "Bike", minutes: 90, kcal: null, ...w })))})`);
function holdAi(server) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; }), answerNow = server.ai;
  server.ai = async (body) => { await gate; return answerNow(body); };
  return () => { server.ai = answerNow; release(); };
}
const answered = { at: 1, met: { low: 5, high: 6 }, why: [{ ref: "Ref", note: "Note.", met: 5.5, minutes: 60 }], how: "one" };
const undated = (w) => ({ ...w, effort: { ...w.effort, ...(w.effort.at && { at: 1 }) } });

test("a new workout asks for its words and minutes, and nothing about the user", async () => {
  const server = serverWith(), bodies = [];
  server.ai = (body) => { bodies.push(body); return answer(); };
  const app = await bootApp({ server });
  const release = holdAi(server);
  log(app, { what: "Bike, zone 2" }, { what: "10,000 steps", minutes: 0 });
  await app.settle(); // the rows are on the server
  assert.deepEqual([app.workout("Bike, zone 2").estimateStatus, on(server, "Bike, zone 2").estimate_status], ["pending", "pending"]);
  release();
  await app.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(bodies)), [{ feature: "workout", payload: { what: "Bike, zone 2", minutes: 90 } }, { feature: "workout", payload: { what: "10,000 steps" } }]);
  assert.deepEqual([undated(app.workout("Bike, zone 2")), undated(app.workout("10,000 steps"))], [
    js(100, "Bike, zone 2", { effort: answered }), js(101, "10,000 steps", { minutes: 0, effort: { ...answered, minutes: 60 } })]);
  assert.deepEqual(server.workouts().map((w) => [w.what, w.estimate_status, undated(w).effort]), [["Bike, zone 2", "done", answered], ["10,000 steps", "done", { ...answered, minutes: 60 }]]);
  const update = server.writes.filter((x) => x.op === "update");
  assert.deepEqual(update.map((x) => x.filters.map(([, column]) => column)), [["id", "what", "minutes", "estimate_status"], ["id", "what", "minutes", "estimate_status"]]);
  assert.deepEqual([app.errors, app.run("outbox.count()")], [[], 0]);
});

test("the day's total follows the answer", async () => {
  const app = await bootApp({ server: serverWith() });
  log(app, {});
  assert.equal(numbersOf(trackerRow(app))[2], (BMR * 1.2).toFixed(1));
  await app.settle();
  assert.equal(numbersOf(trackerRow(app))[2], (BMR * 1.2 + 4.5 * KG * 1.5).toFixed(1));
});

test("no answer: it says so and can be tried again", async () => {
  const server = serverWith();
  server.ai = () => ({ data: null, error: { context: { status: 502 } } });
  const app = await bootApp({ server });
  log(app, {});
  await app.settle();
  assert.deepEqual([app.workout("Bike").estimateStatus, on(server, "Bike").estimate_status], ["error", "error"]);
  server.ai = () => answer();
  app.run("retryWorkout(100)");
  assert.equal(app.workout("Bike").estimateStatus, "pending");
  await app.settle();
  assert.deepEqual([app.workout("Bike").estimateStatus, undated(on(server, "Bike")).effort], ["done", answered]);
});

test("a 402 of either kind fails what else waits, food and workouts, with one call", async () => {
  for (const first of ["food", "workout"]) {
    const server = serverWith();
    server.ai = () => ({ data: null, error: { context: { status: 402 } } });
    const app = await bootApp({ server });
    if (first === "food") { app.addFood("Eggs"); log(app, {}, { what: "Run" }); } else { log(app, {}, { what: "Run" }); app.addFood("Eggs"); }
    await app.settle();
    assert.deepEqual([server.aiCalls.length, app.entry("Eggs").estimateStatus, app.workouts().map((w) => w.estimateStatus)], [1, "error", ["error", "error"]], first);
    assert.deepEqual([server.food()[0].estimate_status, server.workouts().map((w) => w.estimate_status)], ["error", ["error", "error"]], first);
    assert.ok(app.isOpen("paywall-modal"));
  }
});

test("no credit known already: not asked at all", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  app.run("_aiExhausted = true");
  log(app, {});
  await app.settle();
  assert.deepEqual([server.aiCalls, app.workout("Bike").estimateStatus, app.isOpen("paywall-modal")], [[], "error", true]);
  app.run("closePaywall()");
  log(app, { id: 200, what: "Run", kcal: 300 });
  assert.deepEqual([app.workout("Run").estimateStatus, app.isOpen("paywall-modal")], ["done", false], "typed calories need none");
});

test("asking again without credit leaves what was known", async () => {
  const server = serverWith({ workouts: [row(100, "Bike")] });
  const app = await bootApp({ server });
  server.ai = () => ({ data: null, error: { context: { status: 402 } } });
  log(app, { askAgain: true });
  await app.settle();
  assert.deepEqual([app.workout("Bike"), server.workouts().map(({ user_id, ...w }) => w)], [js(100, "Bike"), [row(100, "Bike")]]);
});

test("asking again keeps the numbers until the answer", async () => {
  const server = serverWith({ workouts: [row(100, "Bike")] });
  const app = await bootApp({ server });
  const release = holdAi(server);
  log(app, { askAgain: true });
  await app.settle();
  assert.deepEqual([app.workout("Bike").estimateStatus, app.workout("Bike").effort.met], ["pending", { low: 6, high: 7 }]);
  assert.equal(numbersOf(trackerRow(app))[2], (BMR * 1.2 + 5.5 * KG * 1.5).toFixed(1));
  release();
  await app.settle();
  assert.deepEqual([undated(app.workout("Bike")), undated(on(server, "Bike")).effort], [js(100, "Bike", { effort: answered }), answered]);
});

test("calories typed while the AI is asked: its answer is not used", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  const release = holdAi(server);
  log(app, {});
  await app.settle();
  log(app, { kcal: 400 });
  release();
  await app.settle();
  const { kcal, estimateStatus, effort: e } = app.workout("Bike");
  assert.deepEqual([kcal, estimateStatus, e, on(server, "Bike").kcal, on(server, "Bike").effort], [400, "done", {}, 400, {}]);
});

test("deleted while the AI is asked: it stays deleted", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  const release = holdAi(server);
  log(app, {});
  await app.settle();
  app.run("removeWorkout(100)");
  release();
  await app.settle();
  assert.deepEqual([app.workouts(), server.workouts()], [[], []]);
});

test("other words or minutes while the AI is asked: asked for those", async () => {
  for (const change of [{ what: "Run" }, { minutes: 30 }]) {
    const server = serverWith(), bodies = [];
    server.ai = (body) => { bodies.push(body.payload); return answer(bodies.length, bodies.length); };
    const app = await bootApp({ server });
    const release = holdAi(server);
    log(app, {});
    await app.settle();
    log(app, change);
    release();
    await app.settle();
    const w = app.workouts()[0];
    assert.deepEqual([bodies.length, JSON.stringify(bodies[1]), w.effort.met, w.estimateStatus], [2, JSON.stringify({ what: "Bike", minutes: 90, ...change }), { low: 2, high: 2 }, "done"]);
    assert.deepEqual(server.workouts()[0].effort.met, { low: 2, high: 2 });
  }
});

test("calories typed on another device win over an answer that comes later", async () => {
  const server = serverWith();
  const a = await bootApp({ server });
  const release = holdAi(server);
  log(a, {});
  await a.settle();
  const b = await bootApp({ server, device: createDevice() });
  log(b, { kcal: 400 });
  await b.settle();
  release();
  await a.settle();
  assert.deepEqual([on(server, "Bike").kcal, on(server, "Bike").effort, a.workout("Bike").kcal, a.workout("Bike").estimateStatus], [400, {}, 400, "done"]);
  log(a, { id: 300, what: "Swim", kcal: 1 });
  await a.settle();
  assert.equal(on(server, "Bike").kcal, 400, "and stay so after this device's next save");
});

test("deleted on another device: an answer does not bring it back, here or there", async () => {
  const server = serverWith();
  const a = await bootApp({ server });
  const release = holdAi(server);
  log(a, {});
  await a.settle();
  const b = await bootApp({ server, device: createDevice() });
  b.run("removeWorkout(100)");
  await b.settle();
  release();
  await a.settle();
  assert.deepEqual([server.workouts(), a.workouts()], [[], []]);
});

test("the same workout again needs no AI, whatever the minutes", async () => {
  const server = serverWith({ workouts: [row(1, "Bike, zone 2", { date: "2026-11-20" })] });
  const app = await bootApp({ server });
  log(app, { what: "bike, Zone 2", minutes: 45 });
  await app.settle();
  const w = app.workout("bike, Zone 2");
  assert.deepEqual([server.aiCalls, w.estimateStatus, w.effort.met, w.effort.from], [[], "done", { low: 6, high: 7 }, { id: 1, date: "2026-11-20" }]);
  assert.equal(numbersOf(trackerRow(app))[2], (BMR * 1.2 + 5.5 * KG * 0.75).toFixed(1));
});

test("a question left over is asked by the device that had it, at its next start", async () => {
  const server = serverWith(), device = createDevice();
  const a = await bootApp({ server, device });
  holdAi(server);
  log(a, {});
  await a.settle();
  server.ai = () => answer();
  const other = await bootApp({ server, device: createDevice() });
  await other.settle();
  assert.deepEqual([server.aiCalls.length, other.workout("Bike").estimateStatus], [1, "pending"], "not by another");
  const again = await bootApp({ server, device });
  await again.settle();
  assert.deepEqual([server.aiCalls.length, again.workout("Bike").estimateStatus, on(server, "Bike").estimate_status], [2, "done", "done"]);
});

test("logged offline: not estimated until the user tries again", async () => {
  const server = serverWith(), device = createDevice();
  const app = await bootApp({ server, device });
  device.online = false;
  log(app, {});
  await app.settle();
  assert.equal(app.workout("Bike").estimateStatus, "error");
  device.online = true;
  await app.windowEvent("online");
  app.run("retryWorkout(100)");
  await app.settle();
  assert.deepEqual([undated(on(server, "Bike")).effort, on(server, "Bike").estimate_status], [answered, "done"]);
});

test("one question at a time", async () => {
  const server = serverWith();
  let running = 0, most = 0;
  server.ai = async (body) => { most = Math.max(most, ++running); await new Promise(setImmediate); running--; return body.feature === "workout" ? answer() : { data: { macros: {} }, error: null }; };
  const app = await bootApp({ server });
  app.addFood("Eggs");
  log(app, { what: "Bike" }, { what: "Run" });
  app.addFood("Rice");
  await app.settle();
  assert.deepEqual([most, server.aiCalls], [1, ["Eggs", "Bike", "Run", "Rice"]]);
});

// ---- the day form -----------------------------------------------------------------------

const openDay = (app, date = DATE) => app.run(`editDay(${app.days().find((d) => d.date === date).id})`);
const typeIn = (app, fields) => { for (const [k, v] of Object.entries(fields)) { app.el(`workout-${k}`).value = String(v); app.fire(`workout-${k}`, "input"); } };
const addIn = (app, fields) => { app.fire("workout-add", "click"); typeIn(app, fields); };
const saveForm = (app) => app.fire("day-form", "submit");
const choose = (app, label) => { app.el("day-activity").value = label; app.fire("day-activity", "change"); };
const listed = (app) => app.el("workout-list").innerHTML;
const offered = (app) => [...app.el("day-activity").innerHTML.matchAll(/<option value="([^"]*)"/g)].map(([, label]) => label);
const stored = (server) => server.workouts().map((w) => [w.what, w.minutes, w.kcal]);

test("a workout is added in the day's form", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  openDay(app);
  assert.deepEqual([app.isOpen("workout-editor"), listed(app)], [false, ""]);
  addIn(app, { what: "  Bike, zone 2 ", minutes: "90" });
  saveForm(app);
  assert.equal(app.isOpen("day-modal"), false);
  await app.settle();
  const [w] = app.workouts();
  assert.deepEqual([w.what, w.minutes, w.kcal, w.date, w.estimateStatus, w.effort.met], ["Bike, zone 2", 90, null, DATE, "done", { low: 5, high: 6 }]);
  assert.deepEqual([stored(server), app.errors], [[["Bike, zone 2", 90, null]], []]);
});

test("nothing is stored before Save, and Cancel drops all of it", async () => {
  const server = serverWith({ workouts: [row(1, "Bike")] });
  const app = await bootApp({ server });
  openDay(app);
  addIn(app, { what: "Run", minutes: 20 });
  app.run("dropWorkout(1)");
  choose(app, LIGHT);
  app.fire("day-cancel", "click");
  await app.settle();
  assert.deepEqual([app.workouts(), server.writes, server.aiCalls], [[js(1, "Bike")], [], []]);
  openDay(app);
  assert.deepEqual([app.isOpen("workout-editor"), listed(app).includes("Bike"), listed(app).includes("Run"), app.el("day-activity").value], [false, true, false, SAT]);
});

test("several at once; Save takes the open one and leaves out an empty one", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  openDay(app);
  addIn(app, { what: "Bike", minutes: 90 });
  addIn(app, { what: "Weights", minutes: 45, kcal: 200 });
  assert.ok(listed(app).includes("Bike · 90 min") && !listed(app).includes("Weights"), "the open one is in its fields");
  app.fire("workout-add", "click");
  assert.ok(listed(app).includes("Weights · 45 min · 200 kcal"));
  saveForm(app);
  await app.settle();
  assert.deepEqual(stored(server), [["Bike", 90, null], ["Weights", 45, 200]]);
});

test("what cannot be meant is refused, and said at the field", async () => {
  for (const [fields, field] of [
    [{ what: " ", minutes: 90 }, "what"], [{ what: "Bike", minutes: "lots" }, "minutes"], [{ what: "Bike", minutes: "-5" }, "minutes"], [{ what: "Bike", minutes: "0" }, "minutes"],
    [{ what: "Bike", minutes: "1500" }, "minutes"], [{ what: "Bike", minutes: "1,5" }, "minutes"], [{ what: "Bike", minutes: 90, kcal: "abc" }, "kcal"], [{ what: "Bike", kcal: "-1" }, "kcal"], [{ what: "Bike", kcal: "20000" }, "kcal"],
  ]) {
    const server = serverWith();
    const app = await bootApp({ server });
    openDay(app);
    addIn(app, fields);
    saveForm(app);
    await app.settle();
    assert.deepEqual([app.isOpen("day-modal"), !!app.el(`workout-${field}`).validity, server.writes], [true, true, []], JSON.stringify(fields));
    typeIn(app, { what: "Bike", minutes: 90, kcal: "" });
    saveForm(app);
    assert.equal(app.isOpen("day-modal"), false, "and taken once it is right");
  }
});

test("a duration as people write it", async () => {
  for (const [text, minutes] of [["90", 90], ["1:30", 90], ["1h30", 90], ["1 h 30 min", 90], ["1.5 h", 90], ["1 hour 30 minutes", 90], ["2 hrs", 120], ["45 min", 45], ["22.5", 22.5], ["", 0]]) {
    const server = serverWith();
    const app = await bootApp({ server });
    openDay(app);
    addIn(app, { what: "Bike", minutes: text });
    saveForm(app);
    assert.equal(app.workouts()[0].minutes, minutes, text);
  }
});

test("changing one changes only that one, and opening it changes nothing", async () => {
  const server = serverWith({ workouts: [row(1, "Bike"), row(2, "Run")] });
  const app = await bootApp({ server });
  openDay(app);
  app.run("openWorkout(1)");
  assert.deepEqual(["what", "minutes", "kcal"].map((f) => app.el(`workout-${f}`).value), ["Bike", "90", ""]);
  app.run("openWorkout(2)");
  saveForm(app);
  await app.settle();
  assert.deepEqual(server.writes, []);
  openDay(app);
  app.run("openWorkout(1)");
  typeIn(app, { minutes: 60 });
  saveForm(app);
  await app.settle();
  assert.deepEqual([server.writes.map((w) => [w.op, w.rows.map((r) => [r.what, r.minutes])]), server.aiCalls], [[["upsert", [["Bike", 60]]]], []]);
});

test("a workout that is open keeps what is typed when another is opened", async () => {
  const app = await bootApp({ server: serverWith({ workouts: [row(1, "Bike"), row(2, "Run")] }) });
  openDay(app);
  app.run("openWorkout(1)");
  typeIn(app, { minutes: 30 });
  app.run("openWorkout(2)");
  assert.ok(listed(app).includes("Bike · 30 min · 204–245 kcal"), listed(app));
  app.run("openWorkout(1)");
  assert.equal(app.el("workout-minutes").value, "30");
  typeIn(app, { minutes: "x" });
  app.run("openWorkout(2)");
  assert.deepEqual([app.el("workout-what").value, !!app.el("workout-minutes").validity], ["Bike", true], "not while it is wrong");
});

test("removing one counts from Save on", async () => {
  const server = serverWith({ workouts: [row(1, "Bike"), row(2, "Run")] });
  const app = await bootApp({ server });
  openDay(app);
  app.run("dropWorkout(1)");
  assert.deepEqual([listed(app).includes("Bike"), app.workouts().length], [false, 2]);
  saveForm(app);
  await app.settle();
  assert.deepEqual(stored(server), [["Run", 90, null]]);
  openDay(app);
  app.run("openWorkout(2)");
  app.fire("workout-remove", "click");
  assert.equal(app.isOpen("workout-editor"), false);
  saveForm(app);
  await app.settle();
  assert.deepEqual(stored(server), []);
});

test("typed calories are the user's; taken away, what the AI said is back", async () => {
  const server = serverWith({ workouts: [row(1, "Bike")] });
  const app = await bootApp({ server });
  openDay(app);
  app.run("openWorkout(1)");
  typeIn(app, { kcal: "500" });
  saveForm(app);
  await app.settle();
  assert.deepEqual([on(server, "Bike").kcal, on(server, "Bike").effort, server.aiCalls], [500, effort(6, 7), []]);
  openDay(app);
  app.run("openWorkout(1)");
  assert.equal(app.el("workout-kcal").value, "500");
  typeIn(app, { kcal: "" });
  saveForm(app);
  await app.settle();
  assert.deepEqual([on(server, "Bike").kcal, on(server, "Bike").estimate_status, server.aiCalls], [null, "done", []]);
});

test("ask AI again", async () => {
  const server = serverWith({ workouts: [row(1, "Bike"), row(2, "Run", { kcal: 5 }), row(3, "Swim", { effort: {}, estimate_status: "error" })] });
  const app = await bootApp({ server });
  openDay(app);
  app.run("openWorkout(2)");
  assert.equal(app.isOpen("workout-ask"), false, "nothing to ask: the calories are typed");
  app.run("openWorkout(1)");
  assert.deepEqual([app.isOpen("workout-ask"), app.el("workout-state").textContent], [true, "612–735 kcal"]);
  app.fire("workout-ask", "click");
  assert.deepEqual([app.isOpen("workout-ask"), app.el("workout-state").textContent], [false, "The AI will estimate the calories again."]);
  saveForm(app);
  await app.settle();
  assert.deepEqual([server.aiCalls, on(server, "Bike").effort.met], [["Bike"], { low: 5, high: 6 }]);
});

test("saving one that failed asks for it again", async () => {
  const server = serverWith({ workouts: [row(3, "Swim", { effort: {}, estimate_status: "error" })] });
  const app = await bootApp({ server });
  openDay(app);
  app.run("openWorkout(3)");
  typeIn(app, { minutes: 20 });
  assert.equal(app.el("workout-state").textContent, "The AI will estimate the calories.");
  saveForm(app);
  await app.settle();
  assert.deepEqual([server.aiCalls, on(server, "Swim").estimate_status], [["Swim"], "done"]);
});

test("the state says what will be saved, for the weight in the form", async () => {
  const app = await bootApp({ server: serverWith({ workouts: [row(1, "Old", { date: "2026-11-20" })] }) });
  openDay(app);
  addIn(app, { what: "Bike" });
  assert.equal(app.el("workout-state").textContent, "The AI will estimate the calories.");
  typeIn(app, { what: "old", minutes: 60 });
  assert.equal(app.el("workout-state").textContent, "408–490 kcal, from Nov 20");
  app.el("day-weight").value = "90";
  app.fire("day-weight", "input");
  assert.equal(app.el("workout-state").textContent, "204–245 kcal, from Nov 20");
  typeIn(app, { kcal: 300 });
  assert.equal(app.el("workout-state").textContent, "");
  typeIn(app, { kcal: "abc" });
  assert.equal(app.el("workout-state").textContent, "");
});

test("how it was worked out, as text", async () => {
  const app = await bootApp({ server: serverWith({ workouts: [row(1, "Bike", { effort: effort(6, 7, { why: [{ ref: "<img src=x>", note: "n", met: 6.5, minutes: 90 }] }) })] }) });
  openDay(app);
  addIn(app, { what: "Run" });
  assert.equal(app.isOpen("workout-why"), false, "nothing to explain yet");
  app.run("openWorkout(1)");
  const html = app.el("workout-why-lines").innerHTML;
  assert.ok(app.isOpen("workout-why") && html.includes("Based on &lt;img src=x&gt;") && html.includes("6–7 times resting for 90 min at 81.6 kg"));
  typeIn(app, { minutes: 60 });
  assert.ok(app.el("workout-why-lines").innerHTML.includes("for 60 min"));
});

test("a choice that includes a workout gives way to the rest of the day, and says so", async () => {
  const server = serverWith({ days: [dayRow({ id: 1, date: "2026-11-20", activity: LIGHT }), dayRow({ id: 2, activity: GYM })] });
  const app = await bootApp({ server });
  openDay(app);
  assert.deepEqual([offered(app).length, app.el("day-activity").value, app.isOpen("day-activity-note"), app.el("day-activity-label").textContent], [8, GYM, false, "Activity Type"]);
  app.fire("workout-add", "click");
  assert.deepEqual([offered(app), app.el("day-activity").value, app.el("day-activity-label").textContent], [[SAT, LIGHT], LIGHT, "Rest of the day"]);
  assert.ok(app.isOpen("day-activity-note") && app.el("day-activity-note").textContent.startsWith("“🏋️ Gym day” already includes a workout"));
  app.fire("workout-remove", "click");
  assert.deepEqual([offered(app).length, app.el("day-activity").value, app.isOpen("day-activity-note")], [8, GYM, false], "taken back");
  addIn(app, { what: "Bike", minutes: 90 });
  saveForm(app);
  await app.settle();
  assert.equal(server.days().find((d) => d.date === DATE).activity, LIGHT);
});

test("the rest of the day stays as chosen", async () => {
  const server = serverWith({ days: [dayRow({ activity: GYM })], workouts: [] });
  const app = await bootApp({ server });
  openDay(app);
  addIn(app, { what: "Bike", minutes: 90 });
  assert.equal(app.el("day-activity").value, SAT, "nothing to go by");
  choose(app, LIGHT);
  addIn(app, { what: "Run", minutes: 20 });
  assert.equal(app.el("day-activity").value, LIGHT);
  saveForm(app);
  await app.settle();
  openDay(app);
  assert.deepEqual([offered(app), app.el("day-activity").value, app.isOpen("day-activity-note")], [[SAT, LIGHT], LIGHT, false], "no note: nothing was changed");
});

test("a day that has workouts and, from elsewhere, a choice with one", async () => {
  const server = serverWith({ days: [dayRow({ activity: GYM })], workouts: [row(1, "Bike")] });
  const app = await bootApp({ server });
  openDay(app);
  assert.deepEqual([offered(app), app.el("day-activity").value, app.isOpen("day-activity-note")], [[SAT, LIGHT], SAT, true]);
  app.run("dropWorkout(1)");
  assert.deepEqual([offered(app).length, app.el("day-activity").value], [8, GYM]);
});

test("a choice this build does not know is offered and kept", async () => {
  const server = serverWith({ days: [dayRow({ activity: "Gym" })] });
  const app = await bootApp({ server });
  openDay(app);
  assert.deepEqual([offered(app).includes("Gym"), app.el("day-activity").value], [true, "Gym"]);
  saveForm(app);
  await app.settle();
  assert.deepEqual([server.days()[0].activity, server.writes], ["Gym", []]);
});

test("a workout on a day that does not exist yet: created on Save, not before", async () => {
  const server = serverWith({ days: [dayRow({ id: 1, date: "2026-11-22", activity: LIGHT, weight: 175 })] });
  const app = await bootApp({ server, now: "2026-11-23T04:00:00Z" });
  app.fire("add-workout-btn", "click");
  assert.deepEqual([app.isOpen("day-modal"), app.isOpen("workout-editor"), app.el("day-date").value, app.el("day-weight").value, app.el("day-activity").value], [true, true, DATE, 175, LIGHT]);
  app.fire("day-cancel", "click");
  assert.equal(app.days().length, 1);
  app.fire("add-workout-btn", "click");
  typeIn(app, { what: "Bike", minutes: 90 });
  saveForm(app);
  await app.settle();
  const made = server.days().find((d) => d.date === DATE);
  assert.deepEqual([made.activity, made.weight, stored(server)], [LIGHT, 175, [["Bike", 90, null]]]);
  app.fire("add-workout-btn", "click");
  assert.ok(listed(app).includes("Bike · 90 min"), "the day is there now");
});

test("it does not overwrite a day another device made meanwhile, unless the user chose something", async () => {
  for (const chosen of [null, LIGHT]) {
    const server = serverWith({ days: [dayRow({ id: 1, date: "2026-11-22", activity: SAT, weight: 175 })] });
    const a = await bootApp({ server, now: "2026-11-23T04:00:00Z" }), b = await bootApp({ server, device: createDevice(), now: "2026-11-23T05:00:00Z" });
    b.addFood("Eggs", { date: DATE });
    b.editDay(DATE, { weight: 160 });
    await b.settle();
    a.fire("add-workout-btn", "click");
    typeIn(a, { what: "Bike", minutes: 90 });
    if (chosen) choose(a, chosen);
    saveForm(a);
    await a.settle();
    const made = server.days().find((d) => d.date === DATE);
    assert.deepEqual([made.weight, made.activity, stored(server).length], chosen ? [175, LIGHT, 1] : [160, SAT, 1]);
  }
});

test("deleting a day deletes its workouts, and says how many", async () => {
  const server = serverWith({ workouts: [row(1, "Bike"), row(2, "Run"), row(3, "Other", { date: "2026-11-22" })] });
  let yes = false;
  const app = await bootApp({ server, confirm: () => yes });
  app.deleteDay(DATE);
  assert.deepEqual([app.days().length, app.workouts().length, app.confirms], [1, 3, ["Delete this day entry and its 2 workouts?"]]);
  yes = true;
  app.deleteDay(DATE);
  await app.settle();
  assert.deepEqual([server.days(), stored(server)], [[], [["Other", 90, null]]]);
  const one = await bootApp({ server: serverWith({ workouts: [row(1, "Bike")] }), confirm: () => false }), none = await bootApp({ server: serverWith(), confirm: () => false });
  one.deleteDay(DATE);
  none.deleteDay(DATE);
  assert.deepEqual([one.confirms, none.confirms], [["Delete this day entry and its 1 workout?"], ["Delete this day entry?"]]);
});

test("a workout being edited that was deleted elsewhere: the user is asked", async () => {
  for (const yes of [true, false]) {
    const server = serverWith({ workouts: [row(1, "Bike")] }), device = createDevice();
    const app = await bootApp({ server, device, confirm: () => yes });
    openDay(app);
    app.run("openWorkout(1)");
    typeIn(app, { minutes: 30 });
    app.run("removeWorkout(1)"); // as another tab or device would
    saveForm(app);
    await app.settle();
    assert.equal(app.confirms.length, 1);
    assert.deepEqual(stored(server), yes ? [["Bike", 30, null]] : []);
    if (yes) assert.notEqual(server.workouts()[0].id, 1);
  }
});

test("an answer that arrives while the form is open is shown and not undone by Save", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  const release = holdAi(server);
  log(app, { what: "Bike" }, { what: "Run" });
  await app.settle();
  openDay(app);
  assert.ok(listed(app).includes("Bike · 90 min · estimating…"));
  app.run("openWorkout(101)");
  typeIn(app, { what: "Run hills" });
  release();
  await app.settle();
  assert.ok(listed(app).includes("Bike · 90 min · 490–612 kcal"), listed(app));
  assert.equal(app.el("workout-what").value, "Run hills", "what is being typed is left alone");
  saveForm(app);
  await app.settle();
  assert.deepEqual(server.workouts().map((w) => [w.what, w.estimate_status]), [["Bike", "done"], ["Run hills", "done"]]);
  assert.deepEqual(server.aiCalls, ["Bike", "Run", "Run hills"]);
});

test("earlier workouts are suggested, and bring their minutes", async () => {
  const app = await bootApp({ server: serverWith({ workouts: [row(1, "Bike", { date: "2026-11-20", minutes: 45 }), row(2, "<Run>", { date: "2026-11-19", minutes: 20 }), row(3, "Bike intervals", { date: "2026-11-18", minutes: 30 })] }) });
  openDay(app);
  app.fire("workout-add", "click");
  assert.ok(app.el("workout-suggestions").innerHTML.includes('value="Bike"') && app.el("workout-suggestions").innerHTML.includes('value="&lt;Run&gt;"'));
  typeIn(app, { what: "bike" });
  assert.equal(app.el("workout-minutes").value, "45");
  typeIn(app, { what: "bike int" });
  assert.equal(app.el("workout-minutes").value, "", "it was not meant");
  typeIn(app, { what: "Bike intervals" });
  assert.equal(app.el("workout-minutes").value, "30");
  typeIn(app, { minutes: 50 });
  typeIn(app, { what: "Bike" });
  assert.equal(app.el("workout-minutes").value, "50", "typed minutes are left alone");
});

test("the other fields of the day are saved as before, with and without workouts", async () => {
  const server = serverWith({ workouts: [row(1, "Bike")] });
  const app = await bootApp({ server });
  app.editDay(DATE, { weight: 177.5, incomplete: true });
  await app.settle();
  assert.deepEqual([server.days()[0].weight, server.days()[0].incomplete, server.days()[0].activity, server.writes.map((w) => w.table)], [177.5, true, SAT, ["days"]]);
});

test("each day offers to add a workout, on both layouts", async () => {
  const app = await bootApp({ server: serverWith({ days: [dayRow(), dayRow({ id: 2, date: "2026-11-20" })] }) });
  assert.ok(trackerRow(app, "11-20-26").includes(`addWorkout('2026-11-20')`));
  assert.ok(app.run("isMobile = () => true; renderDayCards(); document.getElementById('day-cards').innerHTML").includes('data-workout="2026-11-20"'));
  app.run("addWorkout('2026-11-20')");
  assert.deepEqual([app.el("day-date").value, app.isOpen("workout-editor")], ["2026-11-20", true]);
});
