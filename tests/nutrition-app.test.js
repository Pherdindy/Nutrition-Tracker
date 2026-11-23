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

// ---- saving without the Nutrition section ------------------------------------------

const type = (app, id, value, event = "input") => { app.el(id).value = String(value); app.fire(id, event); };

test("a remembered food is added with its numbers, without the AI", async () => {
  const server = serverWith(row(1, "Sardines", { nutrition: { at: 5, grams: 48 } }));
  const app = await bootApp({ server });
  app.addFood("sardines", { qty: 2, unit: "pieces" });
  await app.settle();
  const saved = on(server, "sardines");
  assert.deepEqual(server.aiCalls, []);
  assert.deepEqual([saved.macros.calories, saved.estimate_status], [range(50), "done"]);
  assert.deepEqual(saved.nutrition, { at: 5, grams: 24, from: { id: 1, date: "2026-11-20" } });
});

test("an entry from before all eight nutrients were kept is asked about once, then remembered", async () => {
  const server = serverWith(row(1, "Sardines", { macros: { calories: range(1), protein: range(1), carbs: range(1), fat: range(1) } }));
  const app = await bootApp({ server });
  for (let i = 0; i < 2; i++) { app.addFood("Sardines", { qty: 4, unit: "pcs" }); await app.settle(); }
  assert.deepEqual(server.aiCalls, ["Sardines"]);
});

test("remembering works offline and syncs later", async () => {
  const server = serverWith(row(1, "Sardines"));
  const device = createDevice();
  const app = await bootApp({ server, device });
  device.online = false;
  app.addFood("Sardines", { qty: 8, unit: "pcs" });
  await app.settle();
  device.online = true;
  await app.windowEvent("online");
  const saved = server.food().filter((r) => r.food === "Sardines").find((r) => r.id !== 1);
  assert.deepEqual([saved.macros.calories, saved.estimate_status], [range(200), "done"]);
});

test("changing the amount scales the numbers, without the AI", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }) }));
  const app = await bootApp({ server });
  app.editFood("Sardines", { qty: 6 });
  await app.settle();
  assert.deepEqual(server.aiCalls, []);
  assert.deepEqual([on(server, "Sardines").macros.calories, on(server, "Sardines").macros.protein], [range(150), mine(33)]);
  assert.equal(on(server, "Sardines").cal_low, 150);
});

test("changing the amount while the first estimate runs asks for the new amount", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  server.ai = (body) => ({ data: { macros: eight(body.payload.qty * 10) }, error: null });
  const release = holdAi(server);
  app.addFood("Tofu", { qty: 1 });
  await app.settle();
  app.editFood("Tofu", { qty: 3 });
  release();
  await app.settle();
  assert.deepEqual(server.aiCalls, ["Tofu", "Tofu"]);
  assert.deepEqual(on(server, "Tofu").macros.calories, range(30));
});

test("renaming asks again and shows the old numbers until the answer", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }) }));
  const app = await bootApp({ server });
  const release = holdAi(server);
  app.editFood("Sardines", { name: "Tuna" });
  await app.settle();
  assert.deepEqual([app.entry("Tuna").estimateStatus, app.entry("Tuna").macros.calories], ["pending", range(100)]);
  release();
  await app.settle();
  assert.deepEqual([on(server, "Tuna").macros.calories, on(server, "Tuna").macros.protein], [range(200), mine(22)]);
  assert.equal("refresh" in on(server, "Tuna").nutrition, false);
});

test("a failed estimate after a rename keeps the old numbers, and the badge retries", async () => {
  const server = serverWith(row(1, "Sardines"));
  const good = server.ai;
  server.ai = () => ({ data: null, error: { context: { status: 502 } } });
  const app = await bootApp({ server });
  app.editFood("Sardines", { name: "Tuna" });
  await app.settle();
  assert.deepEqual([on(server, "Tuna").estimate_status, on(server, "Tuna").macros.calories], ["error", range(100)]);
  server.ai = good;
  app.run(`retryEstimate(${app.entry("Tuna").id})`);
  await app.settle();
  assert.deepEqual([on(server, "Tuna").estimate_status, on(server, "Tuna").macros.calories], ["done", range(200)]);
});

test("a date or time edit of a failed entry asks nobody", async () => {
  const server = serverWith(row(1, "Sardines", { estimate_status: "error", macros: {} }));
  const app = await bootApp({ server });
  app.editFood("Sardines", { time: "19:30" });
  await app.settle();
  assert.deepEqual([server.aiCalls, on(server, "Sardines").estimate_status], [[], "error"]);
});

test("batch add remembers row by row", async () => {
  const server = serverWith(row(1, "Sardines", { qty: 1, unit: "pc" }));
  const app = await bootApp({ server });
  app.addBatch(["Sardines", "Tofu"]);
  await app.settle();
  assert.deepEqual(server.aiCalls, ["Tofu"]);
  assert.deepEqual(server.food().filter((r) => r.food === "Sardines").map((r) => r.estimate_status), ["done", "done"]);
});

test("photo entries are marked and never remembered", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  app.addPhotoItems(["Soup"]);
  await app.settle();
  assert.equal(on(server, "Soup").nutrition.photo, true);
  app.addFood("Soup", { qty: 1, unit: "1 plate" });
  await app.settle();
  assert.deepEqual(server.aiCalls, ["Soup"]);
});

test("choosing a past food fills in its latest amount, not its oldest", async () => {
  const server = serverWith(
    row(1, "Eggs", { date: "2026-02-09", qty: 111, unit: "g" }),
    row(2, "Eggs", { date: "2026-11-22", time: "18:45", qty: 2, unit: "pcs" }),
    row(3, "Eggs", { date: "2026-11-22", time: "10:41", qty: 3, unit: "pcs" }));
  const app = await bootApp({ server });
  app.fire("add-food-btn", "click");
  type(app, "food-name", "Eggs", "change");
  assert.deepEqual([app.el("food-qty").value, app.el("food-unit").value], [2, "pcs"]);
});

test("renaming an entry does not change its amount", async () => {
  const server = serverWith(row(1, "Egs", { qty: 5 }), row(2, "Eggs", { qty: 2 }));
  const app = await bootApp({ server });
  app.run("editFood(1)");
  type(app, "food-name", "Eggs", "change");
  assert.deepEqual([app.el("food-qty").value, app.el("food-unit").value], [5, "pcs"]);
});
