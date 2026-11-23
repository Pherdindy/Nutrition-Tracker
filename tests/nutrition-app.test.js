// Nutrition details, end to end: the real www/app.js driven through its own event
// handlers against a fake server (see helpers/app-harness.js).
const test = require("node:test");
const assert = require("node:assert");
const { bootApp, createFakeServer, createDevice } = require("./helpers/app-harness.js");

const PROFILE = { height: 170, age: 32, protein_low: 135, protein_high: 150, weight_loss_goal: "0.50 kg/week" };
const range = (n) => ({ low: n, high: n });
const mine = (n) => ({ low: n, high: n, mine: true });
const eight = (kcal, over = {}) => ({
  calories: range(kcal), protein: range(10), carbs: range(1), fat: range(3),
  fiber: range(2), sugar: range(1), saturatedFat: range(1), sodium: range(200), ...over,
});
const row = (id, food, over = {}) => ({
  id, date: "2026-11-20", time: "08:00", food, qty: 4, unit: "pcs", macros: eight(100), estimate_status: "done", nutrition: null,
  cal_low: 100, cal_high: 100, pro_low: 10, pro_high: 10, ai_thought_process: null, ...over,
});
const day = { id: 1, date: "2026-11-23", weight: 168, activity: "Gym", incomplete: false, age: 32, deficit: 550, protein_target_low: 135, protein_target_high: 150 };
const serverWith = (...food) => {
  const server = createFakeServer({ profile: PROFILE, food, days: [day] });
  server.ai = () => ({ data: { macros: eight(200) }, error: null });
  return server;
};
const on = (server, food) => server.food().find((r) => r.food === food);
function holdAi(server) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const answer = server.ai;
  server.ai = async (body) => { await gate; return answer(body); };
  return () => { server.ai = answer; release(); };
}

// ---- the queue -------------------------------------------------------------------

test("all eight nutrients are saved, not only the tracked ones", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  app.addFood("Tofu");
  await app.settle();
  assert.deepEqual(Object.keys(on(server, "Tofu").macros).sort(), Object.keys(eight(1)).sort());
  assert.equal(on(server, "Tofu").estimate_status, "done");
  assert.ok(on(server, "Tofu").nutrition.at > 0);
});

test("what the AI based its answer on is kept", async () => {
  const server = serverWith();
  const basis = [{ ref: "firm tofu", note: "USDA.", grams: 100, kcal: 200 }];
  server.ai = () => ({ data: { macros: eight(200), basis, how: "one" }, error: null });
  const app = await bootApp({ server });
  app.addFood("Tofu");
  await app.settle();
  const { at, ...rest } = on(server, "Tofu").nutrition;
  assert.deepEqual(rest, { why: basis, how: "one", asked: { qty: 1, unit: "pc" }, grams: 100 });
});

test("the column survives a reload and later saves", async () => {
  const nutrition = { at: 5, grams: 48, from: { id: 9, date: "2026-11-01" } };
  const server = serverWith(row(1, "Sardines", { nutrition }));
  const app = await bootApp({ server });
  assert.deepEqual(app.entry("Sardines").nutrition, nutrition);
  app.editFood("Sardines", { time: "19:30" });
  await app.settle();
  assert.deepEqual([on(server, "Sardines").nutrition, on(server, "Sardines").time], [nutrition, "19:30"]);
});

test("a number typed on another device while the AI works is not overwritten", async () => {
  const server = serverWith();
  const phone = await bootApp({ server });
  const release = holdAi(server);
  phone.addFood("Tofu");
  await phone.settle();
  // Another device types a number; the entry is still waiting for the rest.
  Object.assign(server.rowOf("food_entries", "Tofu"), { macros: { protein: mine(22) } });
  release();
  await phone.settle();
  assert.deepEqual(on(server, "Tofu").macros, { protein: mine(22) });
  assert.equal(on(server, "Tofu").estimate_status, "pending");
});

test("an estimate that finds its numbers already there asks nobody", async () => {
  const server = serverWith(row(1, "Sardines", { estimate_status: "pending" }));
  const device = createDevice();
  await bootApp({ server, device });
  const app = await bootApp({ server, device }); // resumes at its second start
  await app.settle();
  assert.deepEqual(server.aiCalls, []);
  assert.equal(on(server, "Sardines").estimate_status, "done");
});
