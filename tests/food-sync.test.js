// Food + day syncing, end to end: the real www/app.js driven through its own
// event handlers against a fake server (see helpers/app-harness.js).
const test = require("node:test");
const assert = require("node:assert");
const { bootApp, createFakeServer, createDevice, OWNER } = require("./helpers/app-harness.js");

const PROFILE = { height: 170, age: 32, protein_low: 135, protein_high: 150, weight_loss_goal: "0.50 kg/week" };
const M = { calories: { low: 100, high: 110 }, protein: { low: 10, high: 11 }, carbs: { low: 1, high: 2 }, fat: { low: 1, high: 2 } };

const foodRow = (id, food, extra = {}) => ({
  id, date: "2026-11-20", time: "08:00", food, qty: 1, unit: "pc", macros: M, estimate_status: "done",
  cal_low: 100, cal_high: 110, pro_low: 10, pro_high: 11, ai_thought_process: null, ...extra,
});
const dayRow = (id, date, extra = {}) => ({
  id, date, weight: 168, activity: "Gym", incomplete: false, age: 32, deficit: 550,
  protein_target_low: 135, protein_target_high: 150, ...extra,
});
const startingServer = (over = {}) => createFakeServer({
  profile: PROFILE,
  food: [foodRow(1, "Rice"), foodRow(2, "Eggs"), foodRow(3, "Tofu")],
  days: [dayRow(1, "2026-11-20"), dayRow(2, "2026-11-23")],
  ...over,
});

// ---- One device, one table: absence is never deletion -----------------------

test("server unreachable at startup on a new device: logging a food leaves the cloud intact", async () => {
  const server = startingServer();
  const device = createDevice({ online: false });
  const app = await bootApp({ server, device });
  assert.deepEqual(app.food(), [], "nothing cached on this device");

  device.online = true;
  app.addFood("Coffee");
  await app.settle();

  assert.deepEqual(server.foods(), ["Coffee", "Eggs", "Rice", "Tofu"]);
});

test("deleting a device's last local entry leaves rows it never loaded on the server", async () => {
  const server = startingServer();
  const device = createDevice({ online: false });
  const app = await bootApp({ server, device });
  device.online = true;
  app.addFood("Coffee");
  await app.settle();

  app.deleteFood("Coffee");
  await app.settle();

  assert.deepEqual(server.foods(), ["Eggs", "Rice", "Tofu"]);
});

test("more than 1,000 entries: all of them load, and a save deletes none", async () => {
  const food = Array.from({ length: 2345 }, (_, i) => foodRow(i + 1, `Food ${i + 1}`));
  const server = startingServer({ food });
  const app = await bootApp({ server });
  assert.equal(app.food().length, 2345);

  app.addFood("Coffee");
  await app.settle();

  assert.equal(server.food().length, 2346);
});

test("a lower server read cap still loads everything", async () => {
  const food = Array.from({ length: 1234 }, (_, i) => foodRow(i + 1, `Food ${i + 1}`));
  const app = await bootApp({ server: startingServer({ food, readCap: 500 }) });
  assert.equal(app.food().length, 1234);
  assert.equal(new Set(app.food().map((e) => e.id)).size, 1234, "no duplicates across pages");
});

test("deleting an entry removes exactly that row from the server", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  app.deleteFood("Eggs");
  await app.settle();
  assert.deepEqual(server.foods(), ["Rice", "Tofu"]);
  assert.deepEqual(app.errors, []);
});

test("tagging a day incomplete, or changing its activity, reaches the server", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  app.editDay("2026-11-20", { incomplete: true });
  app.editDay("2026-11-23", { activity: "Rest" });
  await app.settle();
  assert.deepEqual(server.days().map((d) => [d.date, d.incomplete, d.activity]),
    [["2026-11-20", true, "Gym"], ["2026-11-23", false, "Rest"]]);
});

test("deleting a day removes exactly that day from the server", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  app.deleteDay("2026-11-20");
  await app.settle();
  assert.deepEqual(server.days().map((d) => d.date), ["2026-11-23"]);
});

// ---- Two devices ---------------------------------------------------------------

async function twoDevices(server = startingServer()) {
  const phone = await bootApp({ server });
  const laptop = await bootApp({ server });
  return { server, phone, laptop };
}

test("two devices: a stale device logging a food keeps the other device's new entry", async () => {
  const { server, phone, laptop } = await twoDevices();
  phone.addFood("Coffee");
  await phone.settle();
  laptop.addFood("Toast");
  await laptop.settle();
  assert.deepEqual(server.foods(), ["Coffee", "Eggs", "Rice", "Toast", "Tofu"]);
});

test("two devices: single, batch and photo entries never share an id", async () => {
  const { server, phone, laptop } = await twoDevices();
  for (const app of [phone, laptop]) {
    const tag = app === phone ? "phone" : "laptop";
    app.addFood(`${tag} single`);
    app.addBatch([`${tag} batch 1`, `${tag} batch 2`]);
    app.addPhotoItems([`${tag} photo 1`, `${tag} photo 2`]);
    await app.settle();
  }
  assert.equal(server.food().length, 3 + 10);
  assert.equal(new Set(server.food().map((r) => r.id)).size, 13);
  assert.ok(server.food().every((r) => Number.isSafeInteger(r.id)));
});

test("entries added in the same instant never share an id", async () => {
  const server = startingServer();
  const app = await bootApp({ server, freezeClock: true });
  app.addPhotoItems(["photo 1", "photo 2", "photo 3"]);
  app.addFood("single");
  app.addBatch(["batch 1", "batch 2"]);
  app.addFood("another single");
  await app.settle();
  assert.equal(new Set(server.food().map((r) => r.id)).size, 3 + 7);
});

test("two devices: a stale device's save does not undo an edit made elsewhere", async () => {
  const { server, phone, laptop } = await twoDevices();
  phone.editFood("Rice", { time: "19:30" });
  await phone.settle();
  laptop.addFood("Toast");
  await laptop.settle();
  assert.equal(server.food().find((r) => r.food === "Rice").time, "19:30");
});

test("two devices: a stale device's save does not bring back an entry deleted elsewhere", async () => {
  const { server, phone, laptop } = await twoDevices();
  phone.deleteFood("Rice");
  await phone.settle();
  laptop.addFood("Toast");
  await laptop.settle();
  assert.deepEqual(server.foods(), ["Eggs", "Toast", "Tofu"]);
});

test("two devices: both auto-create the same new day, and both foods and the day are saved", async () => {
  const { server, phone, laptop } = await twoDevices();
  phone.addFood("Coffee", { date: "2026-11-24" });
  await phone.settle();
  laptop.addFood("Toast", { date: "2026-11-24" });
  await laptop.settle();
  assert.deepEqual(server.days().map((d) => d.date).sort(), ["2026-11-20", "2026-11-23", "2026-11-24"]);
  assert.deepEqual([...phone.errors, ...laptop.errors], []);
});

test("two devices: an auto-created day does not overwrite the weight set elsewhere", async () => {
  const { server, phone, laptop } = await twoDevices();
  phone.addFood("Coffee", { date: "2026-11-24" });
  phone.editDay("2026-11-24", { weight: 165.5, incomplete: true });
  await phone.settle();
  laptop.addFood("Toast", { date: "2026-11-24" });
  await laptop.settle();
  const day = server.days().find((d) => d.date === "2026-11-24");
  assert.deepEqual([day.weight, day.incomplete], [165.5, true]);
});

test("two devices: editing a day a device auto-created itself does reach the server", async () => {
  const { server, phone, laptop } = await twoDevices();
  phone.addFood("Coffee", { date: "2026-11-24" });
  await phone.settle();
  laptop.addFood("Toast", { date: "2026-11-24" });
  await laptop.settle();
  laptop.editDay("2026-11-24", { weight: 166 });
  await laptop.settle();
  const days = server.days().filter((d) => d.date === "2026-11-24");
  assert.deepEqual(days.map((d) => d.weight), [166]);
  assert.deepEqual(laptop.errors, []);
});

test("two devices: editing one day leaves the others as the server has them", async () => {
  const { server, phone, laptop } = await twoDevices();
  phone.editDay("2026-11-20", { weight: 160 });
  await phone.settle();
  laptop.editDay("2026-11-23", { weight: 170 });
  await laptop.settle();
  assert.deepEqual(Object.fromEntries(server.days().map((d) => [d.date, d.weight])), { "2026-11-20": 160, "2026-11-23": 170 });
});

// ---- Nothing unsent is lost ------------------------------------------------------

test("a food logged offline survives an online relaunch and reaches the server", async () => {
  const server = startingServer();
  const device = createDevice();
  const before = await bootApp({ server, device });
  device.online = false;
  before.addFood("Coffee", { date: "2026-11-24" });
  await before.settle();

  device.online = true;
  const after = await bootApp({ server, device });
  assert.deepEqual(after.foods(), ["Coffee", "Eggs", "Rice", "Tofu"]);
  assert.deepEqual(server.foods(), ["Coffee", "Eggs", "Rice", "Tofu"]);
  assert.ok(server.days().some((d) => d.date === "2026-11-24"), "its day was saved too");
});

test("an edit and a delete made offline survive an online relaunch", async () => {
  const server = startingServer();
  const device = createDevice();
  const before = await bootApp({ server, device });
  device.online = false;
  before.editFood("Rice", { time: "19:30" });
  before.deleteFood("Eggs");
  before.editDay("2026-11-20", { weight: 161 });
  before.deleteDay("2026-11-23");
  await before.settle();

  device.online = true;
  const after = await bootApp({ server, device });
  assert.deepEqual(after.foods(), ["Rice", "Tofu"]);
  assert.equal(after.entry("Rice").time, "19:30");
  assert.deepEqual(after.days().map((d) => [d.date, d.weight]), [["2026-11-20", 161]]);
  assert.deepEqual(server.foods(), ["Rice", "Tofu"]);
  assert.equal(server.food().find((r) => r.food === "Rice").time, "19:30");
  assert.deepEqual(server.days().map((d) => [d.date, d.weight]), [["2026-11-20", 161]]);
});

test("a save that failed is sent again by the next save", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  device.online = false;
  app.addFood("Coffee");
  app.deleteFood("Eggs");
  await app.settle();

  device.online = true;
  app.addFood("Toast");
  await app.settle();
  assert.deepEqual(server.foods(), ["Coffee", "Rice", "Toast", "Tofu"]);
});

test("a save that failed is sent again when the connection returns", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  device.online = false;
  app.addFood("Coffee");
  await app.settle();
  device.online = true;
  await app.windowEvent("online");
  assert.deepEqual(server.foods(), ["Coffee", "Eggs", "Rice", "Tofu"]);
});

test("a save that failed is sent again when the app comes back to the front", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  device.online = false;
  app.addFood("Coffee");
  await app.settle();
  device.online = true;
  await app.windowEvent("visibilitychange");
  assert.deepEqual(server.foods(), ["Coffee", "Eggs", "Rice", "Tofu"]);
});

test("two tabs offline: neither tab loses what the other logged", async () => {
  const server = startingServer();
  const device = createDevice();
  const tabA = await bootApp({ server, device });
  const tabB = await bootApp({ server, device });
  device.online = false;
  tabA.addFood("Coffee", { date: "2026-11-24" });
  tabB.addFood("Toast", { date: "2026-11-25" });
  await tabA.settle();

  const offline = await bootApp({ server, device });
  assert.deepEqual(offline.foods(), ["Coffee", "Eggs", "Rice", "Toast", "Tofu"]);
  assert.deepEqual(offline.days().map((d) => d.date).sort(), ["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25"]);

  device.online = true;
  await bootApp({ server, device });
  assert.deepEqual(server.foods(), ["Coffee", "Eggs", "Rice", "Toast", "Tofu"]);
  assert.deepEqual(server.days().map((d) => d.date).sort(), ["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25"]);
});

test("a save that failed is retried on a timer, without any further action", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  device.online = false;
  app.addFood("Coffee");
  await app.settle();
  await app.runTimers(); // still offline: must re-arm
  device.online = true;
  await app.runTimers();
  assert.deepEqual(server.foods(), ["Coffee", "Eggs", "Rice", "Tofu"]);
  assert.deepEqual(app.timers(), [], "nothing left to retry");
});

test("a change this device had no room to store is sent by the next save", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  device.full = true;
  assert.throws(() => app.addFood("Coffee"), /QuotaExceeded/);
  device.full = false;
  app.addFood("Toast");
  await app.settle();
  assert.deepEqual(server.foods(), ["Coffee", "Eggs", "Rice", "Toast", "Tofu"]);
});

test("two tabs offline: a day auto-created in one does not undo an edit in the other", async () => {
  const server = startingServer();
  const device = createDevice();
  const tabA = await bootApp({ server, device });
  const tabB = await bootApp({ server, device });
  device.online = false;
  tabB.addFood("Toast", { date: "2026-11-24" });
  tabB.editDay("2026-11-24", { weight: 165.5, incomplete: true });
  tabA.addFood("Coffee", { date: "2026-11-24" }); // has not seen that day
  await tabA.settle();
  device.online = true;
  await tabA.windowEvent("online");
  const day = server.days().find((d) => d.date === "2026-11-24");
  assert.deepEqual([day.weight, day.incomplete], [165.5, true]);
});

// F7: both tabs open at once after time offline
test("two tabs starting together both show what had not been sent yet", async () => {
  const server = startingServer();
  const device = createDevice();
  const tabA = await bootApp({ server, device });
  device.online = false;
  tabA.addFood("Coffee");
  await tabA.settle();
  device.online = true;
  // Tab B has read the table; before it gets the answer, tab A delivers Coffee.
  server.afterSelect = async (table) => {
    if (table !== "food_entries") return;
    server.afterSelect = null;
    await tabA.windowEvent("online");
    assert.ok(server.foods().includes("Coffee"));
  };
  const tabB = await bootApp({ server, device });
  assert.ok(tabB.foods().includes("Coffee"));
});

test("an unreadable stored change does not hold back the others", async () => {
  const server = startingServer();
  const device = createDevice();
  const before = await bootApp({ server, device });
  device.online = false;
  before.addFood("Coffee");
  await before.settle();
  device.storage.setItem(`${before.run("outboxPrefix(currentUid())")}food_entries:5`, "not json");
  device.online = true;
  await bootApp({ server, device });
  assert.deepEqual(server.foods(), ["Coffee", "Eggs", "Rice", "Tofu"]);
});

test("one row the server refuses does not hold back the others, and is kept for later", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  server.reject = (table, row) => row.food === "Cursed";
  app.addFood("Cursed");
  app.addFood("Coffee");
  await app.settle();
  assert.deepEqual(server.foods(), ["Coffee", "Eggs", "Rice", "Tofu"]);

  // Once the server accepts it (e.g. after a migration), a relaunch delivers it.
  server.reject = null;
  const after = await bootApp({ server, device });
  assert.ok(after.foods().includes("Cursed"));
  assert.ok(server.foods().includes("Cursed"));
});

test("an entry whose estimate failed is on the server and can be retried after a relaunch", async () => {
  const server = startingServer();
  const device = createDevice();
  server.ai = () => ({ data: null, error: { context: { status: 502 } } });
  const before = await bootApp({ server, device });
  before.addFood("Coffee");
  await before.settle();

  const after = await bootApp({ server, device });
  assert.equal(after.entry("Coffee").estimateStatus, "error");
  assert.equal(server.food().find((r) => r.food === "Coffee").cal_low, null);
});

test("an edit made while that entry's save is in flight is not lost", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  const release = server.holdWrites();
  app.editFood("Rice", { time: "10:00" });
  await app.settle();
  app.editFood("Rice", { time: "19:30" });
  await app.settle();
  release();
  await app.settle();
  assert.equal(server.food().find((r) => r.food === "Rice").time, "19:30");
});

test("an entry deleted while its first save is in flight stays deleted", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  const release = server.holdWrites();
  app.addFood("Coffee");
  await app.settle();
  app.deleteFood("Coffee");
  await app.settle();
  release();
  await app.settle();
  assert.deepEqual(server.foods(), ["Eggs", "Rice", "Tofu"]);
});

test("a save sends only the rows that changed", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  server.writes.length = 0;
  app.editFood("Rice", { time: "19:30" });
  await app.settle();
  assert.deepEqual(server.writes.map((w) => [w.table, w.op, w.rows.map((r) => r.food)]), [["food_entries", "upsert", ["Rice"]]]);
});

test("a profile change does not make the next day save rewrite every day", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  app.run("saveProfile({ ...loadProfile(), age: 40 })");
  await app.settle();
  server.writes.length = 0;
  app.editDay("2026-11-23", { weight: 170 });
  await app.settle();
  assert.deepEqual(server.writes.map((w) => [w.table, w.rows.map((r) => r.date)]), [["days", ["2026-11-23"]]]);
});

test("a cleared profile age does not block day saves", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  app.run("saveProfile({ ...loadProfile(), age: NaN, proteinLow: NaN, proteinHigh: NaN })");
  await app.settle();
  app.editDay("2026-11-23", { weight: 170 });
  await app.settle();
  assert.equal(server.days().find((d) => d.date === "2026-11-23").weight, 170);
});

// ---- Estimates -------------------------------------------------------------------

const macrosFor = (kcal) => ({ calories: { low: kcal, high: kcal }, protein: { low: 1, high: 1 }, carbs: { low: 1, high: 1 }, fat: { low: 1, high: 1 } });
// Holds every AI answer until release() is called.
function holdAi(server) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const answer = server.ai;
  server.ai = async (body) => { await gate; return answer(body); };
  return () => { server.ai = answer; release(); };
}

test("an estimate another device is still working on is not started again here", async () => {
  const server = startingServer();
  const phone = await bootApp({ server });
  const release = holdAi(server);
  phone.addFood("Coffee");
  await phone.settle();
  const laptop = await bootApp({ server });
  assert.equal(laptop.entry("Coffee").estimateStatus, "pending");
  assert.deepEqual(server.aiCalls, ["Coffee"]);

  phone.deleteFood("Coffee"); // must not come back through the laptop
  release();
  await phone.settle();
  await laptop.settle();
  assert.deepEqual(server.foods(), ["Eggs", "Rice", "Tofu"]);
});

test("an estimate this device left unfinished is resumed at its next start", async () => {
  const server = startingServer();
  const device = createDevice();
  const before = await bootApp({ server, device });
  holdAi(server); // and the app is closed while waiting
  before.addFood("Coffee");
  await before.settle();
  server.ai = () => ({ data: { macros: macrosFor(5) }, error: null });
  const after = await bootApp({ server, device });
  await after.settle();
  assert.deepEqual(server.aiCalls, ["Coffee", "Coffee"]);
  assert.equal(after.entry("Coffee").estimateStatus, "done");
});

test("an estimate abandoned by the device that logged it is finished by another, the start after next", async () => {
  const server = startingServer();
  const phone = await bootApp({ server });
  holdAi(server);
  phone.addFood("Coffee");
  await phone.settle(); // the phone never comes back
  server.ai = () => ({ data: { macros: macrosFor(5) }, error: null });
  const laptop = createDevice();
  await bootApp({ server, device: laptop });
  const second = await bootApp({ server, device: laptop });
  await second.settle();
  assert.equal(server.food().find((r) => r.food === "Coffee").estimate_status, "done");
});

test("a food renamed while its estimate runs gets its own estimate, not the old name's", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  server.ai = (body) => ({ data: { macros: macrosFor(body.payload.food === "Tea" ? 2 : 500) }, error: null });
  const release = holdAi(server);
  app.addFood("Coffee");
  await app.settle();
  app.editFood("Coffee", { name: "Tea" });
  await app.settle();
  release();
  await app.settle();
  assert.deepEqual(server.aiCalls, ["Coffee", "Tea"]);
  assert.deepEqual(server.food().find((r) => r.food === "Tea").macros.calories, { low: 2, high: 2 });
  assert.equal(app.entry("Tea").estimateStatus, "done");
});

test("a failed estimate for the old name does not mark the renamed food as failed", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  server.ai = (body) => (body.payload.food === "Tea" ? { data: { macros: macrosFor(2) }, error: null } : { data: null, error: { context: { status: 502 } } });
  const release = holdAi(server);
  app.addFood("Coffee");
  await app.settle();
  app.editFood("Coffee", { name: "Tea" });
  release();
  await app.settle();
  assert.equal(app.entry("Tea").estimateStatus, "done");
});

// An AI result is not the user's change: it may fill in a waiting entry, and nothing else.

async function waitingOnPhone(server) {
  const phone = await bootApp({ server });
  const release = holdAi(server);
  phone.addFood("Coffee");
  await phone.settle();
  const laptop = await bootApp({ server });
  return { phone, laptop, release };
}
const coffee = (server) => server.food().find((r) => r.food === "Coffee");

test("an estimate that finishes after the entry was deleted elsewhere does not bring it back", async () => {
  const server = startingServer();
  const { phone, laptop, release } = await waitingOnPhone(server);
  laptop.deleteFood("Coffee");
  await laptop.settle();
  release();
  await phone.settle();
  assert.deepEqual(server.foods(), ["Eggs", "Rice", "Tofu"]);
});

test("an estimate that finishes after the entry was edited elsewhere keeps that edit", async () => {
  const server = startingServer();
  const { phone, laptop, release } = await waitingOnPhone(server);
  laptop.editFood("Coffee", { time: "19:30" });
  await laptop.settle();
  release();
  await phone.settle();
  assert.equal(coffee(server).time, "19:30");
  assert.equal(coffee(server).estimate_status, "done");
  assert.equal(coffee(server).cal_low, 100);
});

test("an estimate for an amount that was changed elsewhere is not applied", async () => {
  const server = startingServer();
  const { phone, laptop, release } = await waitingOnPhone(server);
  server.ai = async (body) => ({ data: { macros: macrosFor(body.payload.qty * 10) }, error: null });
  const releaseLaptop = holdAi(server);
  laptop.editFood("Coffee", { qty: 7 }); // starts its own estimate, still running
  await laptop.settle();
  release(); // the phone's answer, for the old amount
  await phone.settle();
  assert.deepEqual([coffee(server).qty, coffee(server).estimate_status, coffee(server).macros], [7, "pending", {}]);
  releaseLaptop();
  await laptop.settle();
  assert.deepEqual([coffee(server).estimate_status, coffee(server).macros.calories.low], ["done", 70]);
});

test("an unsent failed estimate does not hide what another device has finished since", async () => {
  const server = startingServer();
  server.ai = async () => ({ data: null, error: { context: { status: 502 } } });
  const device = createDevice();
  const phone = await bootApp({ server, device });
  const release = holdAi(server);
  phone.addFood("Coffee");
  await phone.settle();
  device.online = false;
  release();
  await phone.settle();
  assert.equal(phone.entry("Coffee").estimateStatus, "error");
  server.ai = async () => ({ data: { macros: macrosFor(42) }, error: null });
  const tablet = createDevice();
  await bootApp({ server, device: tablet });
  await (await bootApp({ server, device: tablet })).settle();

  device.online = true;
  const after = await bootApp({ server, device });
  assert.deepEqual([after.entry("Coffee").estimateStatus, after.entry("Coffee").macros.calories.low], ["done", 42]);
  assert.equal(coffee(server).estimate_status, "done");
});

test("a failed estimate does not wipe one that another device finished", async () => {
  const server = startingServer();
  server.ai = async () => ({ data: null, error: { context: { status: 502 } } });
  const { phone, release } = await waitingOnPhone(server);
  server.ai = async () => ({ data: { macros: macrosFor(42) }, error: null });
  const tablet = createDevice();
  await bootApp({ server, device: tablet });
  await (await bootApp({ server, device: tablet })).settle(); // finishes it at its second start
  assert.equal(coffee(server).estimate_status, "done");
  release();
  await phone.settle();
  assert.deepEqual([coffee(server).estimate_status, coffee(server).macros.calories.low], ["done", 42]);
});

test("an estimate that fails offline does not bring back an entry deleted elsewhere meanwhile", async () => {
  const server = startingServer();
  server.ai = async () => ({ data: null, error: { context: { status: 502 } } });
  const device = createDevice();
  const phone = await bootApp({ server, device });
  const release = holdAi(server);
  phone.addFood("Coffee");
  await phone.settle();
  device.online = false;
  release();
  await phone.settle();
  const laptop = await bootApp({ server });
  laptop.deleteFood("Coffee");
  await laptop.settle();
  device.online = true;
  await phone.windowEvent("online");
  assert.deepEqual(server.foods(), ["Eggs", "Rice", "Tofu"]);
});

test("an estimate that finishes while the entry itself is still being saved ends up on the server", async () => {
  const server = startingServer();
  const app = await bootApp({ server });
  const release = server.holdWrites();
  app.addFood("Coffee");
  await app.settle();
  assert.equal(app.entry("Coffee").estimateStatus, "done");
  release();
  await app.settle();
  assert.deepEqual([coffee(server).estimate_status, coffee(server).cal_low], ["done", 100]);
  assert.equal(app.run("outbox.count()"), 0);
});

test("a finished estimate that could not be saved yet is shown and delivered after a relaunch", async () => {
  const server = startingServer();
  const device = createDevice();
  const before = await bootApp({ server, device });
  const releaseAi = holdAi(server);
  before.addFood("Coffee");
  await before.settle();
  const releaseWrites = server.holdWrites();
  releaseAi();
  await before.settle();
  assert.equal(coffee(server).estimate_status, "pending", "not delivered yet");

  const after = await bootApp({ server, device });
  assert.equal(after.entry("Coffee").estimateStatus, "done");
  assert.deepEqual(after.entry("Coffee").macros.calories, { low: 100, high: 110 });
  releaseWrites();
  await after.settle();
  assert.equal(coffee(server).estimate_status, "done");
  assert.deepEqual(server.aiCalls, ["Coffee"], "and it was not paid for twice");
});

test("two tabs offline: a failed estimate in one does not undo a delete in the other", async () => {
  const server = startingServer();
  const device = createDevice();
  const tabA = await bootApp({ server, device });
  const release = holdAi(server);
  tabA.addFood("Coffee");
  await tabA.settle();
  const tabB = await bootApp({ server, device }); // resumes the same estimate
  device.online = false;
  tabA.deleteFood("Coffee");
  release();
  await tabA.settle();
  await tabB.settle();
  device.online = true;
  await tabA.windowEvent("online");
  await tabB.windowEvent("online");
  assert.deepEqual(server.foods(), ["Eggs", "Rice", "Tofu"]);
});

test("running out of credit marks the waiting entries without rewriting them", async () => {
  const server = startingServer();
  server.ai = async () => ({ data: null, error: { context: { status: 402 } } });
  const app = await bootApp({ server });
  const release = holdAi(server);
  app.addBatch(["Soup", "Bread"]);
  await app.settle();
  release();
  await app.settle();
  const wrote = (food) => server.writes.filter((w) => w.op === "upsert" && w.rows.some((r) => r.food === food)).length;
  assert.deepEqual([wrote("Soup"), wrote("Bread")], [1, 1], "whole row sent once, when it was added");
  assert.deepEqual(app.food().filter((e) => ["Soup", "Bread"].includes(e.food)).map((e) => e.estimateStatus), ["error", "error"]);
  assert.deepEqual(server.food().filter((r) => ["Soup", "Bread"].includes(r.food)).map((r) => r.estimate_status), ["error", "error"]);
  assert.equal(app.isOpen("paywall-modal"), true);
});

test("editing an entry after its estimate arrived sends the whole entry, numbers included", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  const releaseAi = holdAi(server);
  app.addFood("Coffee");
  await app.settle();
  const releaseWrites = server.holdWrites();
  releaseAi();
  await app.settle();
  app.editFood("Coffee", { time: "19:30" }); // before the numbers were delivered
  releaseWrites();
  await app.settle();
  assert.deepEqual([coffee(server).time, coffee(server).estimate_status, coffee(server).cal_low], ["19:30", "done", 100]);
});

// ---- Accounts --------------------------------------------------------------------

test("sign-out with everything saved does not ask and clears this user's data", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  app.addFood("Coffee");
  await app.settle();
  await app.signOut();
  assert.deepEqual(app.confirms, []);
  assert.deepEqual(device.keys().filter((k) => k.startsWith("nt_u")), []);
  assert.equal(app.reloads() > 0, true);
});

test("sign-out sends unsent changes first", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  device.online = false;
  app.addFood("Coffee");
  await app.settle();
  device.online = true;
  await app.signOut();
  assert.deepEqual(app.confirms, []);
  assert.ok(server.foods().includes("Coffee"));
});

test("sign-out that cannot send unsent changes asks first, and cancelling keeps everything", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device, confirm: () => false });
  device.online = false;
  app.addFood("Coffee");
  await app.settle();
  await app.signOut();
  assert.equal(app.confirms.length, 1);
  assert.match(app.confirms[0], /^1 change hasn't been saved/);
  assert.equal(app.reloads(), 0);

  device.online = true;
  const after = await bootApp({ server, device });
  assert.ok(after.foods().includes("Coffee"));
  assert.ok(server.foods().includes("Coffee"));
});

test("signing out anyway discards the unsent changes for good", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device, confirm: () => true });
  server.reject = (table, row) => ["Coffee", "Toast"].includes(row.food);
  app.addFood("Coffee");
  app.addFood("Toast");
  await app.settle();
  await app.signOut();
  assert.match(app.confirms[0], /^2 changes haven't been saved/);
  assert.deepEqual(device.keys().filter((k) => k.startsWith("nt_u")), []);

  server.reject = null;
  const after = await bootApp({ server, device });
  assert.deepEqual(after.foods(), ["Eggs", "Rice", "Tofu"]);
  assert.deepEqual(server.foods(), ["Eggs", "Rice", "Tofu"]);
});

const lapsed = async () => ({ data: { session: null } });

test("a delete made while the session has lapsed is kept until it can be sent as this account", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  const signedIn = device.getSession;
  device.getSession = lapsed;
  app.deleteFood("Eggs");
  app.deleteDay("2026-11-20");
  app.addFood("Coffee");
  await app.settle();

  device.getSession = signedIn;
  await app.windowEvent("online");
  assert.deepEqual(server.foods(), ["Coffee", "Rice", "Tofu"]);
  assert.deepEqual(server.days().map((d) => d.date), ["2026-11-23"]);
});

test("unsent changes are never sent with another account's token", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  device.getSession = async () => ({ data: { session: { access_token: "token:other-uid-9999", user: { id: "other-uid-9999" } } } });
  server.writes.length = 0;
  app.addFood("Coffee");
  app.deleteFood("Eggs");
  await app.settle();
  assert.deepEqual(server.writes, []);
});

test("a startup whose session has lapsed shows the cached data, not an empty account", async () => {
  const server = startingServer();
  const device = createDevice();
  await bootApp({ server, device });
  const signedIn = device.getSession;
  let asked = 0;
  device.getSession = (uid) => (asked++ === 0 ? signedIn(uid) : lapsed());
  const app = await bootApp({ server, device });
  assert.deepEqual(app.foods(), ["Eggs", "Rice", "Tofu"]);
  assert.equal(app.isOpen("onboarding-view"), false);

  device.getSession = signedIn;
  device.online = false;
  assert.deepEqual((await bootApp({ server, device })).foods(), ["Eggs", "Rice", "Tofu"], "and the cache is intact");
});

// F6
test("a session that lapses between the check and the request does not lose a delete", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  const signedIn = device.getSession;
  let asked = 0;
  device.getSession = (uid) => (asked++ === 0 ? signedIn(uid) : lapsed());
  app.deleteFood("Eggs");
  await app.settle();
  device.getSession = signedIn;
  const after = await bootApp({ server, device });
  assert.deepEqual(after.foods(), ["Rice", "Tofu"]);
  assert.deepEqual(server.foods(), ["Rice", "Tofu"]);
});

test("a session that lapses during startup does not make the account look empty", async () => {
  const server = startingServer();
  const device = createDevice();
  await bootApp({ server, device });
  const signedIn = device.getSession;
  let asked = 0;
  device.getSession = (uid) => (asked++ < 2 ? signedIn(uid) : lapsed()); // bootstrap, load check, then gone
  const app = await bootApp({ server, device });
  assert.deepEqual(app.foods(), ["Eggs", "Rice", "Tofu"]);
  assert.equal(app.isOpen("onboarding-view"), false);
});

test("an estimate that returns after sign-out leaves nothing on the device", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  const release = holdAi(server);
  app.addFood("Coffee");
  await app.settle();
  await app.signOut();
  release();
  await app.settle();
  assert.deepEqual(device.keys().filter((k) => /food|days|outbox/.test(k)), []);
});

test("signing out without a connection says so and changes nothing", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device });
  const before = device.keys();
  device.online = false;
  await app.signOut();
  assert.equal(app.alerts.length, 1);
  assert.match(app.alerts[0], /sign out/i);
  assert.deepEqual(device.keys(), before);
  assert.equal(app.reloads(), 0);
  assert.equal(app.busy(), false);
});

test("signing out anyway without a connection keeps the unsent changes", async () => {
  const server = startingServer();
  const device = createDevice();
  const app = await bootApp({ server, device, confirm: () => true });
  device.online = false;
  app.addFood("Coffee");
  await app.settle();
  await app.signOut();
  device.online = true;
  await app.windowEvent("online");
  assert.ok(server.foods().includes("Coffee"));
});

test("the app is blocked while signing out, so nothing can be entered and then wiped", async () => {
  const app = await bootApp({ server: startingServer() });
  const done = app.signOut();
  assert.equal(app.busy(), true);
  await done;
  assert.equal(app.reloads(), 1);
});

test("another account signing in, e.g. in another tab, reloads instead of mixing the two", async () => {
  const device = createDevice();
  const app = await bootApp({ server: startingServer(), device });
  device.onAuth("SIGNED_IN", { user: { id: "other-uid-9999" } });
  await app.settle();
  assert.equal(app.reloads(), 1);
});

test("a token refresh for the same account does not reload", async () => {
  const device = createDevice();
  const app = await bootApp({ server: startingServer(), device });
  device.onAuth("TOKEN_REFRESHED", { user: { id: OWNER } });
  await app.settle();
  assert.equal(app.reloads(), 0);
});

test("one account's unsent changes are never sent as another account", async () => {
  const server = startingServer();
  const device = createDevice();
  const first = await bootApp({ server, device });
  device.online = false;
  first.deleteFood("Rice");
  first.addFood("Coffee");
  await first.settle();

  device.online = true;
  const other = await bootApp({ server, device, uid: "other-uid-9999" });
  assert.deepEqual(other.foods(), []);
  other.addFood("Toast");
  await other.settle();
  assert.deepEqual(server.foods(), ["Eggs", "Rice", "Toast", "Tofu"]);
});
