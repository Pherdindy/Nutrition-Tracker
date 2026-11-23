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
const on = (server, food) => { // as saved; what the nutrition is of is tested by itself
  const r = server.food().find((x) => x.food === food);
  if (r && r.nutrition) delete r.nutrition.of;
  return r;
};
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

test("an answer that reached the server is not read back", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  let reads = 0;
  server.afterSelect = async () => { reads++; };
  const release = holdAi(server);
  app.addFood("Tofu");
  await app.settle();
  release();
  await app.settle();
  assert.deepEqual([server.writes.map((w) => w.op), on(server, "Tofu").estimate_status, reads], [["upsert", "update"], "done", 0]);
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

test("what is known about the numbers is ignored once another build changed what they are for", async () => {
  const nutrition = { at: 5, grams: 48, of: { food: "Sardines", qty: 4, unit: "pcs" } };
  for (const change of [{ qty: 8 }, { food: "Tuna" }, { unit: "cups" }]) {
    const app = await bootApp({ server: serverWith(row(1, "Sardines", { nutrition, ...change })) });
    assert.equal(app.food()[0].nutrition, undefined, JSON.stringify(change));
  }
  const server = serverWith(row(1, "Sardines", { nutrition }));
  const app = await bootApp({ server });
  assert.deepEqual(app.entry("Sardines").nutrition, { at: 5, grams: 48 });
  app.editFood("Sardines", { qty: 8 });
  await app.settle();
  assert.deepEqual(server.food()[0].nutrition, { at: 5, grams: 96, of: { food: "Sardines", qty: 8, unit: "pcs" } });
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

for (const [answers, answer] of [["fails", { data: null, error: { context: { status: 502 } } }], ["arrives", { data: { macros: eight(200) }, error: null }]]) {
  test(`an answer that ${answers} changes nothing once another device has settled the entry`, async () => {
    const server = serverWith();
    const app = await bootApp({ server });
    server.ai = () => answer;
    const release = holdAi(server);
    app.addFood("Tofu");
    await app.settle();
    Object.assign(server.rowOf("food_entries", "Tofu"), { estimate_status: "manual" });
    release();
    await app.settle();
    assert.deepEqual([on(server, "Tofu").estimate_status, on(server, "Tofu").macros], ["manual", {}]);
  });

  test(`an answer that ${answers} changes nothing once the entry is settled here`, async () => {
    const server = serverWith();
    const app = await bootApp({ server });
    server.ai = () => answer;
    const release = holdAi(server);
    app.addFood("Tofu");
    await app.settle();
    app.run(`_cache.food.find((e) => e.food === "Tofu").estimateStatus = "manual"`);
    release();
    await app.settle();
    assert.deepEqual([app.entry("Tofu").estimateStatus, app.entry("Tofu").macros], ["manual", {}]);
  });
}

// ---- a device whose copy is behind ------------------------------------------------------

const ALL = { calories: 90, protein: 22, carbs: 1, fat: 2, fiber: 0 };
const foodTable = (app) => app.run("document.querySelector('#food-eaten-table tbody').innerHTML");
const typedAll = Object.fromEntries(Object.entries(ALL).map(([id, n]) => [id, mine(n)]));
async function typeElsewhere(server, food) { // on another device, started just now
  const laptop = await bootApp({ server, device: createDevice() });
  laptop.run(`editFood(${laptop.entry(food).id})`);
  for (const [id, n] of Object.entries(ALL)) { laptop.el(`nf-${id}`).value = String(n); laptop.fire(`nf-${id}`, "input"); }
  laptop.fire("food-form", "submit");
  await laptop.settle();
}

test("retrying on a device that has not seen the numbers typed elsewhere does not undo them", async () => {
  const server = serverWith();
  const good = server.ai;
  server.ai = () => ({ data: null, error: { context: { status: 502 } } });
  const phone = await bootApp({ server });
  phone.addFood("Tofu");
  await phone.settle();
  await typeElsewhere(server, "Tofu");
  server.ai = good;
  phone.run(`retryEstimate(${phone.entry("Tofu").id})`);
  await phone.settle();
  assert.deepEqual([on(server, "Tofu").macros, on(server, "Tofu").estimate_status], [typedAll, "manual"]);
  assert.deepEqual([phone.entry("Tofu").macros, phone.entry("Tofu").estimateStatus], [typedAll, "manual"], "and the phone shows them");
});

test("an answer refused by the server does not stay on the device, to be saved with the next edit", async () => {
  const server = serverWith();
  const phone = await bootApp({ server });
  const release = holdAi(server);
  phone.addFood("Tofu");
  await phone.settle();
  await typeElsewhere(server, "Tofu");
  release();
  await phone.settle();
  assert.deepEqual(phone.entry("Tofu").macros, typedAll);
  assert.equal(server.writes.filter((w) => w.table === "food_entries" && w.op === "upsert").length, 2, "each device saved once; taking over saves nothing");
  phone.editFood("Tofu", { time: "09:30" });
  await phone.settle();
  assert.deepEqual([on(server, "Tofu").macros, on(server, "Tofu").time], [typedAll, "09:30"]);
});

test("what the user changes while the server's row is fetched stands", async () => {
  const server = serverWith();
  const phone = await bootApp({ server });
  const release = holdAi(server);
  phone.addFood("Tofu");
  await phone.settle();
  await typeElsewhere(server, "Tofu");
  server.afterSelect = async () => { server.afterSelect = null; phone.editFood("Tofu", { qty: 9 }); };
  release();
  await phone.settle();
  assert.deepEqual([phone.entry("Tofu").qty, on(server, "Tofu").qty], [9, 9]);
  assert.deepEqual(on(server, "Tofu").macros, phone.entry("Tofu").macros);
});

test("if the server's row cannot be read now, it is taken over later", async () => {
  const server = serverWith();
  const phone = await bootApp({ server });
  const release = holdAi(server);
  phone.addFood("Tofu");
  await phone.settle();
  await typeElsewhere(server, "Tofu");
  server.unreadable = true;
  release();
  await phone.settle();
  assert.deepEqual([phone.run("outbox.count()"), phone.entry("Tofu").estimateStatus], [1, "done"]);
  server.unreadable = false;
  await phone.runTimers();
  assert.deepEqual([phone.run("outbox.count()"), phone.entry("Tofu").macros], [0, typedAll]);
});

test("a retry that failed offline shows as failed after a relaunch, not as waiting", async () => {
  const server = serverWith(row(1, "Tofu", { estimate_status: "error", macros: {} }));
  const device = createDevice();
  const phone = await bootApp({ server, device });
  device.online = false;
  phone.run("retryEstimate(1)");
  await phone.settle();
  assert.equal(phone.entry("Tofu").estimateStatus, "error");
  device.online = true;
  server.ai = () => { throw new Error("nobody should ask"); };
  const again = await bootApp({ server, device }); // the two unsent changes are laid over what it loads
  assert.equal(again.entry("Tofu").estimateStatus, "error");
  await again.settle();
  assert.deepEqual([on(server, "Tofu").estimate_status, again.run("outbox.count()")], ["error", 0]);
});

test("an entry deleted elsewhere goes here too when its answer arrives, and cannot come back", async () => {
  const server = serverWith();
  const phone = await bootApp({ server });
  const release = holdAi(server);
  phone.addFood("Tofu");
  await phone.settle();
  const laptop = await bootApp({ server, device: createDevice() });
  laptop.deleteFood("Tofu");
  await laptop.settle();
  release();
  await phone.settle();
  assert.deepEqual([server.foods(), phone.foods(), phone.run("outbox.count()"), phone.errors], [[], [], 0, []]);
});

test("what the user changes while the answer itself is on its way stands", async () => {
  // Made, but the app did not hear of it, so it is sent again and then finds nothing.
  const server = serverWith();
  const app = await bootApp({ server });
  const release = holdAi(server);
  app.addFood("Tofu");
  await app.settle();
  server.loseAnswers = true;
  release();
  await app.settle();
  server.loseAnswers = false;
  assert.equal(on(server, "Tofu").estimate_status, "done");
  const releaseWrites = server.holdWrites();
  await app.runTimers(); // sent again, on its way
  app.run(`editFood(${app.entry("Tofu").id})`);
  app.el("food-qty").value = "3";
  type(app, "nf-protein", "33");
  app.fire("food-form", "submit");
  await app.settle();
  releaseWrites();
  await app.settle();
  await app.runTimers();
  assert.deepEqual([app.entry("Tofu").qty, app.entry("Tofu").macros.protein], [3, mine(33)]);
  assert.deepEqual([on(server, "Tofu").qty, on(server, "Tofu").macros.protein], [3, mine(33)]);
  assert.ok(!app.errors.some((e) => /sync failed/.test(e)), app.errors.join());
});

test("nor is a row taken over for an account that has left", async () => {
  const server = serverWith();
  const phone = await bootApp({ server });
  const release = holdAi(server);
  phone.addFood("Tofu");
  await phone.settle();
  await typeElsewhere(server, "Tofu");
  server.afterSelect = async () => { server.afterSelect = null; phone.run("_authUser = null"); };
  release();
  await phone.settle();
  assert.equal(phone.run("_cache.food.find((e) => e.food === 'Tofu').estimateStatus"), "done");
});

test("an answer that waited behind its retry is not undone here", async () => {
  const server = serverWith(row(1, "Tofu", { estimate_status: "error", macros: {} }));
  const app = await bootApp({ server });
  server.loseAnswers = true; // the retry is made, but the app does not hear of it
  app.run("retryEstimate(1)");
  await app.settle();
  assert.deepEqual([on(server, "Tofu").estimate_status, app.entry("Tofu").estimateStatus], ["pending", "done"]);
  server.loseAnswers = false;
  await app.runTimers();
  assert.deepEqual([on(server, "Tofu").estimate_status, app.entry("Tofu").estimateStatus, app.entry("Tofu").macros], ["done", "done", eight(200)]);
  assert.deepEqual([server.aiCalls, app.run("outbox.count()")], [["Tofu"], 0]);
});

test("a tab sees what became of a change another tab sent for it", async () => {
  const server = serverWith();
  const device = createDevice();
  const tab = await bootApp({ server, device });
  const release = holdAi(server);
  tab.addFood("Tofu");
  await tab.settle();
  await typeElsewhere(server, "Tofu"); // on a second device
  device.online = false;
  release();
  await tab.settle();
  assert.equal(tab.entry("Tofu").estimateStatus, "done", "the answer is here, unsent");
  const id = tab.entry("Tofu").id;
  device.online = true;
  const other = await bootApp({ server, device }); // another tab of this browser sends it, and is refused
  await other.settle();
  const key = device.keys().find((k) => k.includes("_outbox:"));
  assert.equal(key, undefined);
  const prefix = tab.run("outboxPrefix(currentUid())");
  await tab.windowEvent("storage", { key: `${prefix}food_entries:${id}`, newValue: null });
  assert.deepEqual(tab.entry("Tofu").macros, typedAll);
  assert.ok(foodTable(tab).includes(`>${typedAll.calories.low}<`), "and shows it");
  tab.editFood("Tofu", { time: "09:30" });
  await tab.settle();
  assert.deepEqual([on(server, "Tofu").macros, on(server, "Tofu").time], [typedAll, "09:30"]);
});

test("a tab ignores storage events that are nothing to it", async () => {
  const server = serverWith(row(1, "Tofu"));
  const app = await bootApp({ server });
  const prefix = app.run("outboxPrefix(currentUid())");
  server.rowOf("food_entries", "Tofu").time = "23:00";
  let reads = 0;
  server.afterSelect = async () => { reads++; };
  const op = JSON.stringify({ t: "x", row: { id: 1, date: "2026-11-20", time: "22:00", food: "Tofu", qty: 4, unit: "pcs", macros: {} } });
  for (const event of [{ key: null, newValue: null }, { key: "nt_theme", newValue: null }, { key: `${prefix}days:2026-11-23`, newValue: null }, { key: `${prefix}food_entries:1`, newValue: op }, { key: `${prefix}food_entries:999`, newValue: null }]) {
    await app.windowEvent("storage", event);
  }
  assert.deepEqual([app.errors, reads], [[], 2], "two are an entry's that is looked up, one of them not here");
  assert.equal(app.entry("Tofu").time, "23:00");
});

test("a tab follows what another tab stores, so that it cannot put its old copy over it", async () => {
  const server = serverWith(row(1, "Tofu"), row(2, "Rice"), row(3, "Eggs", { estimate_status: "pending", macros: {} }));
  const device = createDevice();
  const a = await bootApp({ server, device }), b = await bootApp({ server, device });
  const prefix = a.run("outboxPrefix(currentUid())");
  const stored = async (id) => { // what the browser tells the other tab
    const key = `${prefix}food_entries:${id}`;
    await b.windowEvent("storage", { key, newValue: device.storage.getItem(key) });
  };
  device.online = false;
  openEdit(a, "Tofu");
  type(a, "nf-protein", "33");
  save(a);
  await stored(1);
  a.deleteFood("Rice");
  await stored(2);
  a.addFood("Soup");
  await stored(a.entry("Soup").id);
  await a.settle();
  assert.deepEqual([b.entry("Tofu").macros.protein, b.foods()], [mine(33), ["Eggs", "Soup", "Tofu"]]);
  assert.deepEqual(["Tofu", "Soup", "Rice", ">33<"].map((text) => foodTable(b).includes(text)), [true, true, false, true], "and shows them");
  device.online = true;
  b.editFood("Tofu", { time: "09:30" });
  await b.windowEvent("online");
  assert.deepEqual([on(server, "Tofu").macros.protein, on(server, "Tofu").time, server.foods()], [mine(33), "09:30", ["Eggs", "Soup", "Tofu"]]);
  assert.equal(server.writes.filter((w) => w.rows && w.rows.some((r) => r.food === "Eggs")).length, 0, "nothing else was saved");
});

test("what another tab changes while this one is loading is not missed", async () => {
  for (const change of ["edit", "delete"]) {
    const server = serverWith(row(1, "Tofu"));
    const device = createDevice();
    const a = await bootApp({ server, device });
    const key = `${a.run("outboxPrefix(currentUid())")}food_entries:1`;
    let tell;
    // b's reading is answered; then a changes the entry, and it is sent before b has loaded
    server.afterSelect = async (table) => {
      if (table !== "food_entries") return;
      server.afterSelect = null;
      if (change === "edit") a.editFood("Tofu", { time: "19:30" }); else a.deleteFood("Tofu");
      const newValue = device.storage.getItem(key);
      await a.settle();
      tell("storage", { key, newValue });
      tell("storage", { key, newValue: null });
    };
    const b = await bootApp({ server, device, loading: (fn) => { tell = fn; } });
    await b.settle();
    assert.deepEqual(b.food().map((e) => e.time), change === "edit" ? ["19:30"] : [], change);
  }
});

test("a tab that sends another's answer takes it over, whatever its own was", async () => {
  // Both asked; this one's failed, the other's arrived later and replaced it in the outbox.
  const server = serverWith(row(1, "Tofu", { estimate_status: "error", macros: {} }));
  const device = createDevice();
  const a = await bootApp({ server, device }), b = await bootApp({ server, device });
  const prefix = a.run("outboxPrefix(currentUid())"), key = `${prefix}food_entries:1`;
  server.rowOf("food_entries", "Tofu").estimate_status = "pending";
  for (const tab of [a, b]) tab.run("{ const e = _cache.food[0]; e.estimateStatus = 'pending'; FOOD_SYNC.known.set('1', FOOD_SYNC.signature(e)); }");
  device.online = false;
  b.run("{ const entries = loadFoodEntries(), e = entries[0]; saveEstimates(entries, [{ entry: Object.assign(e, { estimateStatus: 'error' }), asked: askedOf(e) }]); }");
  a.run(`{ const entries = loadFoodEntries(), e = entries[0], asked = askedOf(e); saveEstimates(entries, [{ entry: Object.assign(e, { estimateStatus: "done", macros: ${JSON.stringify(eight(200))} }), asked }]); }`);
  await b.windowEvent("storage", { key, newValue: device.storage.getItem(key) });
  assert.equal(b.entry("Tofu").estimateStatus, "error");
  device.online = true;
  await b.windowEvent("online"); // b sends it
  assert.deepEqual([on(server, "Tofu").estimate_status, b.entry("Tofu").estimateStatus, b.entry("Tofu").macros], ["done", "done", eight(200)]);
});

test("a tab that sends another's change knows it from then on, even if it has not heard of it", async () => {
  const server = serverWith(row(1, "Tofu"), row(2, "Rice"), row(3, "Eggs"));
  const device = createDevice();
  const a = await bootApp({ server, device }), b = await bootApp({ server, device });
  device.online = false;
  a.editFood("Tofu", { time: "19:30" });
  a.deleteFood("Rice");
  a.editDay("2026-11-23", { weight: 150 });
  await a.settle(); // could not send it
  device.online = true;
  let reads = 0;
  server.afterSelect = async () => { reads++; };
  await b.windowEvent("online");
  assert.deepEqual([server.foods(), on(server, "Tofu").time], [["Eggs", "Tofu"], "19:30"]);
  assert.deepEqual([b.foods(), b.entry("Tofu").time, reads], [["Eggs", "Tofu"], "19:30", 2]);
});

test("what a tab sends of its own is not looked up", async () => {
  const server = serverWith(row(1, "Tofu"), row(2, "Rice"));
  const app = await bootApp({ server });
  let reads = 0;
  server.afterSelect = async () => { reads++; };
  app.editFood("Tofu", { time: "19:30" });
  app.deleteFood("Rice");
  app.addFood("Tofu", { qty: 8, unit: "pcs" });
  app.editDay("2026-11-23", { weight: 150 });
  await app.settle();
  assert.deepEqual([server.foods(), app.run("outbox.count()"), reads], [["Tofu", "Tofu"], 0, 0]);
});

test("a tab that hears of another's change keeps what its user does while it looks", async () => {
  const server = serverWith(row(1, "Tofu"));
  const app = await bootApp({ server });
  const prefix = app.run("outboxPrefix(currentUid())");
  server.afterSelect = async () => { server.afterSelect = null; app.editFood("Tofu", { qty: 9 }); await app.settle(); };
  await app.windowEvent("storage", { key: `${prefix}food_entries:1`, newValue: null });
  await app.settle();
  assert.deepEqual([app.entry("Tofu").qty, on(server, "Tofu").qty], [9, 9]);
});

test("retrying offline does not save anything over the server's row either", async () => {
  const server = serverWith();
  const device = createDevice();
  server.ai = () => ({ data: null, error: { context: { status: 502 } } });
  const phone = await bootApp({ server, device });
  phone.addFood("Tofu");
  await phone.settle();
  await typeElsewhere(server, "Tofu");
  device.online = false;
  phone.run(`retryEstimate(${phone.entry("Tofu").id})`);
  await phone.settle();
  device.online = true;
  await phone.windowEvent("online");
  await phone.runTimers();
  assert.deepEqual([on(server, "Tofu").macros, phone.entry("Tofu").macros, phone.run("outbox.count()")], [typedAll, typedAll, 0]);
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

test("a batch of remembered foods needs no credit", async () => {
  const server = serverWith(row(1, "Sardines", { qty: 1, unit: "pc" }));
  server.usage = { pct_used: 100, plan: "free", exhausted: true };
  const app = await bootApp({ server });
  app.addBatch(["Sardines"]);
  await app.settle();
  assert.deepEqual([app.isOpen("paywall-modal"), server.food().map((r) => r.estimate_status)], [false, ["done", "done"]]);
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

test("choosing a past food never replaces an amount that was typed", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines"), row(2, "Tuna", { qty: 2, unit: "cans" })) });
  const filled = () => [app.el("food-qty").value, app.el("food-unit").value];
  app.fire("add-food-btn", "click");
  type(app, "food-qty", "200");
  type(app, "food-unit", "g");
  type(app, "food-name", "sardines", "change");
  assert.deepEqual(filled(), ["200", "g"]);
  app.fire("add-food-btn", "click");
  type(app, "food-qty", "200");
  type(app, "food-name", "Sardines", "change");
  assert.deepEqual(filled(), ["200", ""], "half typed");
  app.fire("add-food-btn", "click");
  type(app, "food-name", "Sardines", "change");
  type(app, "food-name", "Tuna", "change");
  assert.deepEqual(filled(), [2, "cans"], "its own filling-in it may replace");
  type(app, "food-qty", "3");
  type(app, "food-name", "Sardines", "change");
  assert.deepEqual(filled(), ["3", "cans"]);
});

test("renaming an entry does not change its amount", async () => {
  const server = serverWith(row(1, "Egs", { qty: 5 }), row(2, "Eggs", { qty: 2 }));
  const app = await bootApp({ server });
  app.run("editFood(1)");
  type(app, "food-name", "Eggs", "change");
  assert.deepEqual([app.el("food-qty").value, app.el("food-unit").value], [5, "pcs"]);
});

// ---- the Nutrition section ------------------------------------------------------------

const NOON = "2026-11-23T04:00:00Z"; // the tag leaves out the current year
function openAdd(app, { food, qty, unit }) {
  app.fire("add-food-btn", "click");
  app.el("food-date").value = "2026-11-23";
  app.el("food-time").value = "08:00";
  type(app, "food-name", food);
  type(app, "food-qty", qty);
  type(app, "food-unit", unit);
}
const openEdit = (app, food) => app.run(`editFood(${app.entry(food).id})`);
const save = (app) => app.fire("food-form", "submit");
const shown = (app, id) => app.el(`nf-${id}`).value;
const state = (app) => app.el("nutrition-state").textContent;

test("adding stays closed until asked, and Edit opens the section", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines")) });
  openAdd(app, { food: "Tofu", qty: 1, unit: "pc" });
  assert.deepEqual([app.isOpen("nutrition"), app.isOpen("nutrition-open")], [false, true]);
  openEdit(app, "Sardines");
  assert.deepEqual([app.isOpen("nutrition"), app.isOpen("nutrition-open")], [true, false]);
  assert.deepEqual([shown(app, "calories"), shown(app, "protein"), shown(app, "fiber")], ["100", "10", "2"]);
});

test("a label's numbers are typed as printed and saved as what was eaten, with no AI call", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  openAdd(app, { food: "Tofu", qty: 80, unit: "g" });
  app.fire("nutrition-open", "click");
  type(app, "nf-calories", 100);
  type(app, "nutrition-basis-qty", 56);
  for (const [id, n] of [["protein", 11], ["carbs", 0], ["fat", 6], ["fiber", 0]]) type(app, `nf-${id}`, n);
  assert.equal(shown(app, "calories"), "100");
  save(app);
  await app.settle();
  assert.deepEqual(server.aiCalls, []);
  const saved = on(server, "Tofu"), basis = { qty: 56, unit: "g" };
  assert.deepEqual([saved.macros.calories, saved.macros.protein, saved.macros.carbs, saved.estimate_status], [{ ...mine(142.857), basis }, { ...mine(15.7143), basis }, { ...mine(0), basis }, "manual"]);
  assert.equal(saved.pro_low, 15.7143);
});

test("numbers not typed are asked for, and the AI is told the ones that are", async () => {
  const server = serverWith();
  const sent = [];
  server.ai = (body) => { sent.push(body.payload); return { data: { macros: eight(200) }, error: null }; };
  const app = await bootApp({ server });
  openAdd(app, { food: "Tofu", qty: 1, unit: "pc" });
  app.fire("nutrition-open", "click");
  assert.match(state(app), /leave blank/);
  type(app, "nf-protein", 22);
  save(app);
  await app.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ food: "Tofu", qty: 1, unit: "pc", known: { protein: 22 } }]);
  assert.deepEqual([on(server, "Tofu").macros.protein, on(server, "Tofu").macros.calories], [mine(22), range(200)]);
});

test("a remembered food shows its numbers and day before saving", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines")), now: NOON });
  openAdd(app, { food: "Sardines", qty: 2, unit: "pcs" });
  app.fire("nutrition-open", "click");
  assert.deepEqual([shown(app, "calories"), app.el("nutrition-tag").textContent, state(app)], ["50", "from Nov 20", ""]);
  type(app, "food-qty", 6);
  assert.equal(shown(app, "calories"), "150");
  type(app, "food-name", "Tofu");
  assert.deepEqual([shown(app, "calories"), app.el("nutrition-tag").textContent], ["", ""]);
});

test("choosing a past food with the section open fills in its amount and numbers", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines")) });
  app.fire("add-food-btn", "click");
  app.fire("nutrition-open", "click");
  assert.equal(app.isOpen("nutrition-basis"), false, "there is no amount yet");
  type(app, "food-name", "Sardines", "change");
  assert.deepEqual([shown(app, "calories"), app.el("nutrition-basis-qty").value, app.isOpen("nutrition-basis")], ["100", "4", true]);
});

test("numbers can be given for another unit of the same food", async () => {
  const server = serverWith(row(1, "Sardines", { nutrition: { at: 5, grams: 48 } }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  type(app, "nutrition-basis-unit", "g", "change");
  assert.deepEqual([app.el("nutrition-basis-qty").value, shown(app, "calories")], ["48", "100"]);
  type(app, "nutrition-basis-qty", "56");
  type(app, "nf-protein", "11");
  save(app);
  await app.settle();
  assert.deepEqual(on(server, "Sardines").macros.protein, { ...mine(9.42857), basis: { qty: 56, unit: "g" } });
});

test("renaming to a remembered food shows its numbers before saving", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }) }), row(2, "Tuna", { macros: eight(300) }));
  const app = await bootApp({ server, now: NOON });
  openEdit(app, "Sardines");
  type(app, "food-name", "tuna");
  assert.deepEqual([shown(app, "calories"), shown(app, "protein"), app.el("nutrition-tag").textContent, state(app)], ["300", "22", "from Nov 20", ""]);
  save(app);
  await app.settle();
  assert.deepEqual([server.aiCalls, on(server, "tuna").macros.calories, on(server, "tuna").macros.protein], [[], range(300), mine(22)]);
});

test("renaming and typing all that is tracked leaves nothing of the other food, on screen or saved", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { sodium: range(500) }) }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  type(app, "food-name", "Yakult");
  assert.equal(shown(app, "sodium"), "500", "what it was, while the AI is to be asked");
  for (const id of ["calories", "protein", "carbs", "fat", "fiber"]) type(app, `nf-${id}`, 1);
  assert.deepEqual([shown(app, "sodium"), state(app)], ["", ""]);
  save(app);
  await app.settle();
  const saved = on(server, "Yakult");
  assert.deepEqual([server.aiCalls, saved.macros.sodium, saved.estimate_status], [[], undefined, "manual"]);
});

test("a new name and amount in one save scale a typed number, as on screen", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }) }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  type(app, "food-qty", 8);
  type(app, "food-name", "Sardines in oil");
  assert.equal(shown(app, "protein"), "44");
  save(app);
  await app.settle();
  assert.deepEqual(on(server, "Sardines in oil").macros.protein, mine(44));
});

test("changing the amount of a failed entry without numbers asks for the new amount", async () => {
  const server = serverWith(row(1, "Sardines", { estimate_status: "error", macros: {} }));
  const app = await bootApp({ server });
  app.editFood("Sardines", { qty: 6 });
  await app.settle();
  assert.deepEqual([server.aiCalls, on(server, "Sardines").estimate_status], [["Sardines"], "done"]);
});

test("retyping the amount does not disturb the numbers", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines")) });
  openEdit(app, "Sardines");
  type(app, "food-qty", "");
  assert.deepEqual([shown(app, "calories"), state(app)], ["100", ""]);
  type(app, "food-qty", "8");
  assert.equal(shown(app, "calories"), "200");
});

test("correcting a number makes the entry the one to remember", async () => {
  const server = serverWith(row(1, "Sardines"), row(2, "Sardines", { date: "2026-11-22", macros: eight(300) }));
  const app = await bootApp({ server });
  app.run("editFood(1)");
  assert.equal(app.isOpen("nm-protein"), false);
  type(app, "nf-protein", "22");
  assert.equal(app.isOpen("nm-protein"), true);
  save(app);
  await app.settle();
  app.addFood("Sardines", { qty: 8, unit: "pcs" });
  await app.settle();
  const added = server.food().find((r) => r.food === "Sardines" && r.qty === 8);
  assert.deepEqual([added.macros.protein, added.macros.calories], [mine(44), range(200)]);
  assert.deepEqual(server.aiCalls, []);
});

test("an invalid number is refused beside its field and everything typed stays", async () => {
  const server = serverWith(row(1, "Sardines"));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  type(app, "nf-protein", "abc");
  assert.equal(app.isOpen("ne-protein"), false, "not while typing");
  type(app, "nf-carbs", "5");
  save(app);
  await app.settle();
  assert.equal(app.isOpen("food-modal"), true);
  assert.match(app.el("ne-protein").textContent, /number/);
  assert.equal(app.isOpen("ne-protein"), true);
  assert.deepEqual([shown(app, "protein"), shown(app, "carbs")], ["abc", "5"]);
  assert.deepEqual(on(server, "Sardines").macros.carbs, range(1), "nothing was saved");
  type(app, "nf-protein", "22");
  assert.equal(app.isOpen("ne-protein"), false);
  save(app);
  await app.settle();
  assert.deepEqual([on(server, "Sardines").macros.protein, on(server, "Sardines").macros.carbs], [mine(22), mine(5)]);
});

test("messages of a refused save do not greet the next entry", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines"), row(2, "Tuna")) });
  openEdit(app, "Sardines");
  type(app, "nf-protein", "abc");
  save(app);
  app.fire("food-cancel", "click");
  openEdit(app, "Tuna");
  type(app, "nf-protein", "abc");
  assert.equal(app.isOpen("ne-protein"), false);
});

test("ask AI again is offered for numbers the AI gave, and after a failure", async () => {
  const server = serverWith(row(1, "Sardines"), row(2, "Tuna", { estimate_status: "error", macros: {} }), row(3, "Soup", { estimate_status: "pending", macros: {} }), row(4, "Yakult", { estimate_status: "manual", macros: { calories: mine(1), protein: mine(1), carbs: mine(1), fat: mine(1), fiber: mine(1) } }));
  const app = await bootApp({ server });
  const offered = (food) => { openEdit(app, food); return app.isOpen("nutrition-ask"); };
  assert.deepEqual(["Sardines", "Tuna", "Soup", "Yakult"].map(offered), [true, true, false, false]);
  openAdd(app, { food: "Sardines", qty: 4, unit: "pcs" });
  app.fire("nutrition-open", "click");
  assert.equal(app.isOpen("nutrition-ask"), false, "nothing to ask again about while adding");
});

test("a label's amount that no longer converts is refused, not read as something else", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  openAdd(app, { food: "Tofu", qty: 80, unit: "g" });
  app.fire("nutrition-open", "click");
  type(app, "nutrition-basis-qty", 56);
  type(app, "nf-protein", 11);
  type(app, "food-qty", 1);
  type(app, "food-unit", "plate");
  save(app);
  await app.settle();
  assert.equal(app.el("ne-basis").textContent, "56 g does not convert to 1 plate");
  assert.deepEqual([app.isOpen("food-modal"), server.foods()], [true, []]);
});

test("ask AI again replaces everything that is not typed", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }), nutrition: { at: 5, from: { id: 9, date: "2026-11-01" } } }));
  const app = await bootApp({ server });
  const release = holdAi(server);
  openEdit(app, "Sardines");
  assert.equal(app.isOpen("nutrition-ask"), true);
  app.fire("nutrition-ask", "click");
  await app.settle();
  assert.equal(app.isOpen("food-modal"), false);
  assert.deepEqual([app.entry("Sardines").estimateStatus, app.entry("Sardines").macros.calories], ["pending", range(100)], "the old numbers are still shown");
  release();
  await app.settle();
  const saved = on(server, "Sardines");
  assert.deepEqual([saved.macros.calories, saved.macros.protein, saved.estimate_status], [range(200), mine(22), "done"]);
  assert.equal(saved.nutrition.from, undefined);
});

test("ask AI again is refused while a number is invalid", async () => {
  const server = serverWith(row(1, "Sardines"));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  type(app, "nf-protein", "abc");
  app.fire("nutrition-ask", "click");
  await app.settle();
  assert.deepEqual([app.isOpen("food-modal"), server.aiCalls], [true, []]);
  type(app, "nf-protein", "22");
  save(app);
  await app.settle();
  assert.deepEqual([server.aiCalls, on(server, "Sardines").estimate_status], [[], "done"], "an ordinary save asks nobody");
});

for (const [answer, foods] of [[true, ["Tofu"]], [false, []]]) {
  test(`saving an entry that was deleted elsewhere meanwhile asks, and ${answer ? "saves it as a new one" : "lets it go"}`, async () => {
    const server = serverWith(row(1, "Tofu"));
    const app = await bootApp({ server, confirm: () => answer });
    openEdit(app, "Tofu");
    type(app, "nf-protein", "33");
    const laptop = await bootApp({ server, device: createDevice() });
    laptop.deleteFood("Tofu");
    await laptop.settle();
    await app.windowEvent("storage", { key: `${app.run("outboxPrefix(currentUid())")}food_entries:1`, newValue: null });
    assert.deepEqual(app.foods(), []);
    save(app);
    await app.settle();
    assert.match(app.confirms.at(-1), /deleted/);
    assert.deepEqual([app.isOpen("food-modal"), server.foods()], [false, foods]);
    if (answer) assert.deepEqual([on(server, "Tofu").macros.protein, on(server, "Tofu").id === 1], [mine(33), false]);
  });
}

test("a quantity must be above 0, unless it was like that and is left so", async () => {
  const server = serverWith(row(1, "Sardines"), row(2, "Old", { qty: 0 }));
  const app = await bootApp({ server });
  for (const bad of ["0", "-2"]) {
    app.editFood("Sardines", { qty: bad });
    await app.settle();
    assert.deepEqual([app.isOpen("food-modal"), on(server, "Sardines").qty], [true, 4], bad);
    assert.match(app.el("food-qty").validity, /above 0/);
    type(app, "food-qty", "5");
    assert.equal(app.el("food-qty").validity, "", "it no longer holds the form back");
    app.editFood("Sardines", { qty: bad });
    app.fire("food-cancel", "click");
    openEdit(app, "Sardines");
    assert.equal(app.el("food-qty").validity, "", "nor the next one");
    app.fire("food-cancel", "click");
  }
  app.editFood("Old", { time: "19:30" });
  await app.settle();
  assert.equal(on(server, "Old").time, "19:30");
  app.addBatch(["Tofu"]);
  app.fire("add-food-btn", "click");
  const rows = app.el("batch-items").children;
  rows[0].querySelector(".batch-food").value = "Nothing";
  rows[0].querySelector(".batch-qty").value = "-2";
  rows[0].querySelector(".batch-unit").value = "pc";
  app.fire("batch-save", "click");
  await app.settle();
  assert.deepEqual(server.foods(), ["Old", "Sardines", "Tofu"]);
});

test("what stays is shown: a number of the other food while the AI is to be asked after all", async () => {
  const typed = Object.fromEntries(["calories", "protein", "carbs", "fat", "fiber"].map((id) => [id, mine(1)]));
  const server = serverWith(row(1, "Sardines", { macros: { ...eight(100, { sodium: range(500) }), ...typed } }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  type(app, "food-name", "Tuna");
  assert.equal(shown(app, "sodium"), "", "nobody would be asked");
  type(app, "nf-carbs", "");
  assert.deepEqual([shown(app, "sodium"), state(app)], ["500", "AI will estimate the other numbers again."]);
});

test("ask AI again is refused while the form is incomplete", async () => {
  const server = serverWith(row(1, "Sardines"));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  app.el("food-form").reportValidity = () => false; // as with an empty name
  app.fire("nutrition-ask", "click");
  await app.settle();
  assert.deepEqual([app.isOpen("food-modal"), server.aiCalls], [true, []]);
});

test("asking again while a gap is being filled asks again", async () => {
  const server = serverWith(row(1, "Sardines"));
  const sent = [];
  server.ai = (body) => { sent.push(body.payload); return { data: { macros: eight(100 * sent.length) }, error: null }; };
  const app = await bootApp({ server });
  const release = holdAi(server);
  openEdit(app, "Sardines");
  type(app, "nf-carbs", "");
  save(app);
  await app.settle();
  openEdit(app, "Sardines");
  app.fire("nutrition-ask", "click");
  await app.settle();
  release();
  await app.settle();
  assert.deepEqual(sent.map((p) => !!p.known), [true, false]);
  assert.deepEqual([on(server, "Sardines").macros.calories, on(server, "Sardines").estimate_status], [range(200), "done"]);
});

test("the AI is told a weight the user corrected", async () => {
  const server = serverWith(row(1, "Sardines", { nutrition: { at: 5, grams: 96, gramsMine: true } }));
  const sent = [];
  server.ai = (body) => { sent.push(body.payload); return { data: { macros: eight(200), basis: [{ ref: "r", note: "n", grams: 48, kcal: 200 }], how: "one" }, error: null }; };
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  app.fire("nutrition-ask", "click");
  await app.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ food: "Sardines", qty: 4, unit: "pcs", grams: 96 }]);
  assert.deepEqual([on(server, "Sardines").macros.calories, on(server, "Sardines").nutrition.grams], [range(200), 96]);
});

test("out of credit, learned from the call: asking again is taken back for all that were asked", async () => {
  const server = serverWith(row(1, "Sardines"), row(2, "Tuna"));
  server.ai = () => ({ data: null, error: { context: { status: 402 } } });
  const app = await bootApp({ server });
  const before = ["Sardines", "Tuna"].map((food) => on(server, food));
  const release = holdAi(server);
  for (const food of ["Sardines", "Tuna"]) { openEdit(app, food); app.fire("nutrition-ask", "click"); await app.settle(); }
  assert.equal(on(server, "Tuna").estimate_status, "pending");
  release();
  await app.settle();
  assert.equal(app.isOpen("paywall-modal"), true);
  assert.deepEqual(["Sardines", "Tuna"].map((food) => on(server, food)), before);
});

test("without credit, an entry that needs nothing from the AI does not open the paywall", async () => {
  const server = serverWith(row(1, "Sardines", { estimate_status: "error" }));
  server.usage = { pct_used: 100, plan: "free", exhausted: true };
  const app = await bootApp({ server });
  app.run("retryEstimate(1)");
  await app.settle();
  assert.deepEqual([app.isOpen("paywall-modal"), on(server, "Sardines").estimate_status], [false, "done"]);
});

test("a failed question about a good entry does not make it forgotten", async () => {
  const server = serverWith(row(1, "Sardines"));
  const device = createDevice();
  const app = await bootApp({ server, device });
  device.online = false;
  openEdit(app, "Sardines");
  app.fire("nutrition-ask", "click");
  await app.settle();
  assert.equal(app.entry("Sardines").estimateStatus, "error");
  app.addFood("Sardines", { qty: 8, unit: "pcs" });
  await app.settle();
  const added = app.food().find((e) => e.qty === 8);
  assert.deepEqual([added.macros.calories, added.estimateStatus], [range(200), "done"]);
});

test("ask AI again without credit opens the paywall and changes nothing", async () => {
  const server = serverWith(row(1, "Sardines"));
  server.usage = { pct_used: 100, plan: "free", exhausted: true };
  const app = await bootApp({ server });
  const before = on(server, "Sardines");
  openEdit(app, "Sardines");
  app.fire("nutrition-ask", "click");
  await app.settle();
  assert.deepEqual([app.isOpen("paywall-modal"), app.isOpen("food-modal")], [true, true]);
  assert.deepEqual(on(server, "Sardines"), before);
});

test("without credit, changing the time of a failed entry does not open the paywall", async () => {
  const server = serverWith(row(1, "Sardines", { estimate_status: "error", macros: {} }));
  server.usage = { pct_used: 100, plan: "free", exhausted: true };
  const app = await bootApp({ server });
  app.editFood("Sardines", { time: "19:30" });
  await app.settle();
  assert.deepEqual([app.isOpen("paywall-modal"), on(server, "Sardines").time], [false, "19:30"]);
});

test("typing every tracked number works without credit", async () => {
  const server = serverWith();
  server.usage = { pct_used: 100, plan: "free", exhausted: true };
  const app = await bootApp({ server });
  openAdd(app, { food: "Tofu", qty: 1, unit: "pc" });
  app.fire("nutrition-open", "click");
  for (const id of ["calories", "protein", "carbs", "fat", "fiber"]) type(app, `nf-${id}`, 1);
  assert.equal(state(app), "");
  save(app);
  await app.settle();
  assert.deepEqual([on(server, "Tofu").estimate_status, app.isOpen("paywall-modal")], ["manual", false]);
});

test("numbers typed without credit are saved even if others are missing", async () => {
  const server = serverWith();
  server.usage = { pct_used: 100, plan: "free", exhausted: true };
  const app = await bootApp({ server });
  openAdd(app, { food: "Tofu", qty: 1, unit: "pc" });
  app.fire("nutrition-open", "click");
  type(app, "nf-protein", 22);
  save(app);
  await app.settle();
  assert.deepEqual([on(server, "Tofu").estimate_status, on(server, "Tofu").macros, app.isOpen("paywall-modal")], ["error", { protein: mine(22) }, true]);
});

test("correcting the weight rescales the AI's numbers", async () => {
  const server = serverWith(row(1, "Sardines", { macros: eight(100, { protein: mine(22) }), nutrition: { at: 5, grams: 48, why: [{ ref: "r", note: "n", grams: 48, kcal: 100 }], how: "one", asked: { qty: 4, unit: "pcs" } } }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  assert.equal(app.el("nutrition-weight-text").textContent, "Assumed weight 48 g (12 g each)");
  assert.equal(app.isOpen("nutrition-weight-row"), false);
  app.fire("nutrition-weight-change", "click");
  assert.equal(app.isOpen("nutrition-weight-row"), true);
  type(app, "nutrition-weight", "96");
  assert.equal(shown(app, "calories"), "200");
  save(app);
  await app.settle();
  const saved = on(server, "Sardines");
  assert.deepEqual([saved.macros.calories, saved.macros.protein, saved.nutrition.grams, saved.nutrition.gramsMine], [range(200), mine(22), 96, true]);
  assert.deepEqual(server.aiCalls, []);
});

test("a typed weight does not follow to another food or amount", async () => {
  const server = serverWith(row(1, "Sardines", { nutrition: { at: 5, grams: 48 } }), row(2, "Tuna", { macros: eight(300), nutrition: { at: 5, grams: 120 } }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  type(app, "nutrition-weight", "96");
  type(app, "food-name", "Tuna");
  assert.deepEqual([shown(app, "calories"), app.el("nutrition-weight").value], ["300", ""]);
  type(app, "food-name", "Sardines");
  type(app, "nutrition-weight", "96 g");
  type(app, "food-qty", 96);
  type(app, "food-unit", "g");
  save(app);
  await app.settle();
  assert.equal(app.isOpen("food-modal"), false, "nothing invisible holds it back");
  assert.deepEqual([on(server, "Sardines").macros.calories, on(server, "Sardines").qty], [range(200), 96]);
});

test("the explanation is shown as text, whatever the AI wrote", async () => {
  const server = serverWith(row(1, "Sardines", { nutrition: { at: 5, why: [{ ref: "<img src=x onerror=alert(1)>", note: "a & b", grams: null, kcal: 100 }], how: "one", asked: { qty: 4, unit: "pcs" } } }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  const html = app.el("nutrition-why-lines").innerHTML;
  assert.ok(html.includes("&lt;img") && !html.includes("<img"), html);
  assert.ok(html.includes("a &amp; b"));
  assert.equal(app.isOpen("nutrition-why"), true);
});

test("the form says when saving will ask the AI, and when an estimate failed", async () => {
  const server = serverWith(row(1, "Sardines"), row(2, "Tuna", { estimate_status: "error", macros: {} }));
  const app = await bootApp({ server });
  openEdit(app, "Sardines");
  assert.equal(state(app), "");
  type(app, "food-name", "Mackerel");
  assert.equal(state(app), "AI will estimate the other numbers again.");
  type(app, "food-name", "Sardines");
  type(app, "nf-carbs", "");
  assert.equal(state(app), "AI will estimate the numbers you leave blank.");
  openEdit(app, "Tuna");
  assert.equal(state(app), "The estimate didn't come back. Ask again or type your own numbers.");
  assert.equal(app.isOpen("nutrition-ask"), true);
});

test("numbers that arrive while the entry is open appear in the form", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  const release = holdAi(server);
  app.addFood("Tofu");
  await app.settle();
  openEdit(app, "Tofu");
  assert.equal(state(app), "Estimating… You can type your own numbers meanwhile.");
  type(app, "nf-fat", "9");
  release();
  await app.settle();
  assert.deepEqual([shown(app, "calories"), shown(app, "fat"), state(app)], ["200", "9", ""]);
  save(app);
  await app.settle();
  assert.deepEqual([on(server, "Tofu").macros.calories, on(server, "Tofu").macros.fat], [range(200), mine(9)]);
  assert.deepEqual(server.aiCalls, ["Tofu"]);
});

test("numbers typed and saved while the AI works survive its answer", async () => {
  const server = serverWith();
  const app = await bootApp({ server });
  const release = holdAi(server);
  app.addFood("Tofu");
  await app.settle();
  openEdit(app, "Tofu");
  type(app, "nf-protein", "22");
  save(app);
  await app.settle();
  release();
  await app.settle();
  assert.deepEqual([on(server, "Tofu").macros.protein, on(server, "Tofu").macros.calories, on(server, "Tofu").estimate_status], [mine(22), range(200), "done"]);
});

test("reused entries carry their day in the table and on cards", async () => {
  const nutrition = { at: 5, from: { id: 9, date: "2026-11-20" } };
  const app = await bootApp({ server: serverWith(row(1, "Sardines", { nutrition }), row(2, "Tofu")), now: NOON });
  const html = app.run("renderFoodTable(); document.querySelector('#food-eaten-table tbody').innerHTML");
  assert.equal(html.split("from Nov 20").length, 2);
  app.run("MOBILE_MQ.matches = true; renderFoodCards()");
  assert.equal(app.el("food-cards").innerHTML.split("from Nov 20").length, 2);
});

test("closing the form forgets what was typed in it", async () => {
  const app = await bootApp({ server: serverWith(row(1, "Sardines")) });
  openEdit(app, "Sardines");
  type(app, "nf-protein", "99");
  app.fire("food-cancel", "click");
  app.addFood("Tofu");
  await app.settle();
  assert.deepEqual(app.entry("Tofu").macros.protein, range(10));
});

// ---- assessments ----------------------------------------------------------------------

test("both rounds of an assessment send the smaller payload, and it is what the size limit counts", async () => {
  const note = "x".repeat(200);
  const why = [{ ref: note, note, grams: 1, kcal: 1 }, { ref: note, note, grams: 1, kcal: 1 }];
  const server = serverWith(...Array.from({ length: 400 }, (_, i) => row(i + 1, "Sardines", { nutrition: { at: 5, why } })));
  const sent = [];
  server.ai = (body) => { sent.push(body); return { data: { a: "{}", b: "{}" }, error: null }; };
  const app = await bootApp({ server, now: NOON });
  assert.ok(app.run("JSON.stringify(getAssessmentData('week')).length") > 250000, "whole entries would be refused");
  // Round 2 follows when the two analyses disagree; what they say does not matter here.
  app.run("checkAssessmentAgreement = () => ({ needsEscalation: true, disagreements: 1, total: 1 }); averageAssessmentScores = (list) => list[0]; renderAssessmentResults = () => {};");
  app.fire("run-assessment-btn", "click");
  await app.settle();
  assert.deepEqual(sent.map((body) => body.feature), ["assess-round1", "assess-round2"]);
  for (const { payload } of sent) {
    assert.equal(payload.data.totalEntries, 400);
    assert.deepEqual(Object.keys(payload.data.foodByDate["2026-11-20"][0]).sort(), ["food", "macros", "qty", "time", "unit"]);
  }
});
