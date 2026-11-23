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
