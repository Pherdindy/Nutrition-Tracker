const test = require("node:test");
const assert = require("node:assert");
const Sync = require("../www/sync.js");

// ---- ids ---------------------------------------------------------------------

test("ids are unique, increasing and safe integers even within one millisecond", () => {
  const reserve = Sync.createIdSource(() => 1795400000000, () => 0.5);
  const ids = [reserve(), reserve(), reserve()];
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  assert.ok(ids.every(Number.isSafeInteger));
});

test("reserving a block keeps later ids clear of it", () => {
  const reserve = Sync.createIdSource(() => 1795400000000, () => 0);
  const first = reserve(5);
  assert.ok(reserve() > first + 4);
});

test("two devices adding at the same moment have over 8 million ids to draw from", () => {
  const at = () => 1795400000000;
  const lowest = Sync.createIdSource(at, () => 0)(), highest = Sync.createIdSource(at, () => 0.99999999)();
  assert.ok(highest - lowest > 8_000_000, `only ${highest - lowest + 1} possible ids`);
});

test("the next second's ids are clear of this second's", () => {
  const highest = Sync.createIdSource(() => 1795400000000, () => 0.99999999)();
  assert.ok(Sync.createIdSource(() => 1795400001000, () => 0)() > highest);
});

test("a wrong clock still gives usable ids, clear of the old small ones", () => {
  for (const year of [1970, 2000, 2025, 2026, 2059, 2075, 2200]) {
    const id = Sync.createIdSource(() => Date.UTC(year, 0, 1), () => 0)(1000);
    assert.ok(Number.isSafeInteger(id + 999) && id > 1_000_000, `${year}: ${id}`);
  }
});

test("ids never go backwards when the clock does", () => {
  let now = 1795400000000;
  const reserve = Sync.createIdSource(() => now, () => 0);
  const a = reserve();
  now -= 60_000;
  assert.ok(reserve() > a);
});

// ---- reading every page --------------------------------------------------------

const pager = (total, cap, calls = []) => async (from, to) => {
  calls.push([from, to]);
  const size = Math.min(to - from + 1, cap, Math.max(0, total - from));
  return { data: Array.from({ length: size }, (_, i) => ({ id: from + i })), error: null, count: total };
};

test("fetchAll reads every page and stops without an extra request", async () => {
  const calls = [];
  const rows = await Sync.fetchAll(pager(2500, 1000, calls), 1000);
  assert.equal(rows.length, 2500);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("fetchAll does not mistake a lower server cap for the end", async () => {
  assert.equal((await Sync.fetchAll(pager(2500, 300), 1000)).length, 2500);
});

test("fetchAll makes one request for an empty table and for one full page", async () => {
  for (const total of [0, 1000]) {
    const calls = [];
    assert.equal((await Sync.fetchAll(pager(total, 1000, calls), 1000)).length, total);
    assert.equal(calls.length, 1);
  }
});

test("fetchAll without a count reads until an empty page", async () => {
  const page = pager(1500, 1000);
  const rows = await Sync.fetchAll(async (a, b) => ({ ...(await page(a, b)), count: null }), 1000);
  assert.equal(rows.length, 1500);
});

test("fetchAll stops on an empty page even if the count says more", async () => {
  const rows = await Sync.fetchAll(async (from) => ({ data: from === 0 ? [{ id: 1 }] : [], error: null, count: 5 }), 1000);
  assert.equal(rows.length, 1);
});

test("fetchAll throws the server's error", async () => {
  await assert.rejects(Sync.fetchAll(async () => ({ data: null, error: { message: "boom" } })), { message: "boom" });
});

// ---- what changed ----------------------------------------------------------------

const changes = (known, entries) => {
  const taken = [];
  Sync.takeChanges(known, entries, (e) => String(e.id), (e) => JSON.stringify(e), (e, key) => taken.push([key, e]));
  return taken;
};

test("takeChanges takes new and changed entries once, and never removals", () => {
  const known = new Map();
  const a = { id: 1, v: 1 }, b = { id: 2, v: 1 };
  assert.deepEqual(changes(known, [a, b]), [["1", a], ["2", b]]);
  assert.deepEqual(changes(known, [a, b]), []);
  a.v = 2; // callers mutate entries in place: the signature must not alias them
  assert.deepEqual(changes(known, [a, b]), [["1", a]]);
  assert.deepEqual(changes(known, [a]), [], "a missing entry is not a change");
});

test("a change that could not be taken is offered again", () => {
  const known = new Map();
  const a = { id: 1, v: 1 }, b = { id: 2, v: 1 };
  assert.throws(() => Sync.takeChanges(known, [a, b], (e) => String(e.id), (e) => JSON.stringify(e), () => { throw new Error("full"); }), /full/);
  assert.deepEqual(changes(known, [a, b]), [["1", a], ["2", b]]);
});

// ---- applying unsent changes over what the cloud returned ---------------------------

test("overlay adds, replaces and removes by key, and drops duplicate rows", () => {
  const rows = [{ id: 1, v: "cloud" }, { id: 2, v: "cloud" }, { id: 2, v: "cloud" }];
  const ops = { 1: { t: "a", row: { id: 1, v: "mine" } }, 2: { t: "b", row: null }, 3: { t: "c", row: { id: 3, v: "new" } } };
  assert.deepEqual(Sync.overlay(rows, ops, (r) => r.id), [{ id: 1, v: "mine" }, { id: 3, v: "new" }]);
});

test("overlay keeps the cloud's row over one that was only auto-created here", () => {
  const ops = { "2026-11-24": { t: "a", row: { date: "2026-11-24", weight: 168 }, ensure: true } };
  assert.deepEqual(Sync.overlay([{ date: "2026-11-24", weight: 165 }], ops, (r) => r.date), [{ date: "2026-11-24", weight: 165 }]);
  assert.deepEqual(Sync.overlay([], ops, (r) => r.date), [{ date: "2026-11-24", weight: 168 }]);
});

test("overlay converts stored rows and tolerates no ops", () => {
  assert.deepEqual(Sync.overlay([], { 1: { t: "a", row: { id: 1 } } }, (r) => r.id, (r) => ({ ...r, mapped: true })), [{ id: 1, mapped: true }]);
  assert.deepEqual(Sync.overlay([{ id: 1 }], undefined, (r) => r.id), [{ id: 1 }]);
});

// ---- outbox ------------------------------------------------------------------------

// A fake connection: answers every send with r.answer (default: accepted).
function rig({ uid = "u1", store = {} } = {}) {
  const r = { uid, store, sent: [], sentAs: [], stored: [], timers: [], logged: [], misses: [], answer: () => ({ error: null, status: 201 }), dealWith: async () => true, agrees: () => true };
  r.box = Sync.createOutbox({
    owner: () => r.uid,
    list: (id) => JSON.parse(JSON.stringify(r.store[id] || {})),
    set: (id, table, key, op) => { ((r.store[id] ||= {})[table] ||= {})[key] = JSON.parse(JSON.stringify(op)); r.stored.push(["set", table, key]); },
    remove: (id, table, key) => { delete r.store[id][table][key]; r.stored.push(["remove", table, key]); },
    send: async (id, table, kind, items) => { r.sent.push([table, kind, items]); r.sentAs.push(id); return r.answer(table, kind, items); },
    missed: (...args) => { r.misses.push(args); return r.dealWith(); },
    agrees: (...args) => r.agrees(...args),
    lock: (_uid, fn) => fn(),
    schedule: (fn, ms) => { r.timers.push({ fn, ms }); return r.timers.length - 1; },
    cancel: (i) => { r.timers[i] = null; },
    log: (...args) => { r.logged.push(args); },
  });
  r.pendingTimers = () => r.timers.filter(Boolean);
  return r;
}
const OFFLINE = () => ({ error: { message: "TypeError: Failed to fetch" }, status: 0 });
const refuseBad = (_table, _kind, items) => (items.some((i) => i.bad) ? { error: { code: "23502" }, status: 400 } : { error: null, status: 201 });

test("a delivered change leaves the outbox", async () => {
  const r = rig();
  r.box.put("food", "1", { id: 1 });
  assert.equal(r.box.count(), 1);
  await r.box.flush();
  assert.deepEqual(r.sent, [["food", "upsert", [{ id: 1 }]]]);
  assert.equal(r.box.count(), 0);
});

test("a failed change stays, survives a restart, and is delivered later", async () => {
  const first = rig();
  first.answer = OFFLINE;
  first.box.put("food", "1", { id: 1 });
  first.box.put("food", "2", null);
  await first.box.flush();
  assert.equal(first.box.count(), 2);

  const second = rig({ store: first.store });
  assert.equal(second.box.count(), 2);
  await second.box.flush();
  assert.deepEqual(second.sent.map(([, kind, items]) => [kind, items]).sort(), [["delete", ["2"]], ["upsert", [{ id: 1 }]]]);
  assert.equal(second.box.count(), 0);
});

test("flushing an empty outbox sends nothing", async () => {
  const r = rig();
  await r.box.flush();
  assert.deepEqual(r.sent, []);
});

test("a flush with nothing to send does not block later ones", async () => {
  const r = rig();
  await r.box.flush();
  r.box.put("food", "1", { id: 1 });
  await r.box.flush();
  assert.equal(r.box.count(), 0);
});

test("only the latest change to a row is sent", async () => {
  const r = rig();
  r.box.put("food", "1", { id: 1, v: 1 });
  r.box.put("food", "1", { id: 1, v: 2 });
  await r.box.flush();
  assert.deepEqual(r.sent, [["food", "upsert", [{ id: 1, v: 2 }]]]);
});

test("a change made while the row is in flight is sent afterwards", async () => {
  const r = rig();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  r.answer = async () => { await gate; return { error: null, status: 201 }; };
  r.box.put("food", "1", { id: 1, v: 1 });
  const done = r.box.flush();
  await new Promise(setImmediate); // v1 is now in flight
  r.box.put("food", "1", { id: 1, v: 2 });
  r.box.flush();
  release();
  await done;
  assert.deepEqual(r.sent.map(([, , items]) => items[0].v), [1, 2]);
  assert.equal(r.box.count(), 0);
});

test("a refused row does not hold back the others and stays in the outbox", async () => {
  const r = rig();
  r.answer = refuseBad;
  r.box.put("food", "1", { id: 1 });
  r.box.put("food", "2", { id: 2, bad: true });
  r.box.put("food", "3", { id: 3 });
  await r.box.flush();
  assert.deepEqual(Object.keys(r.box.pending("food")), ["2"]);
  assert.equal(r.logged.length, 1);
  assert.deepEqual(r.pendingTimers(), [], "waiting will not help a refused row");
});

test("a refused row is not resent in this session until it changes", async () => {
  const r = rig();
  r.answer = refuseBad;
  r.box.put("food", "2", { id: 2, bad: true });
  await r.box.flush();
  r.sent.length = 0;
  r.box.put("food", "3", { id: 3 });
  await r.box.flush();
  assert.deepEqual(r.sent, [["food", "upsert", [{ id: 3 }]]]);

  r.box.put("food", "2", { id: 2 });
  await r.box.flush();
  assert.equal(r.box.count(), 0);
});

test("a refused row is retried after a restart", async () => {
  const first = rig();
  first.answer = () => ({ error: { code: "23502" }, status: 400 });
  first.box.put("food", "2", { id: 2 });
  await first.box.flush();
  const second = rig({ store: first.store });
  await second.box.flush();
  assert.equal(second.box.count(), 0);
});

for (const status of [0, 401, 408, 429, 500, 503]) {
  test(`status ${status} is temporary: nothing is split up, and a retry is scheduled`, async () => {
    const r = rig();
    r.answer = () => ({ error: { message: "x" }, status });
    r.box.put("food", "1", { id: 1 });
    r.box.put("food", "2", { id: 2 });
    await r.box.flush();
    assert.equal(r.sent.length, 1);
    assert.equal(r.box.count(), 2);
    assert.equal(r.pendingTimers().length, 1);
  });
}

test("a send that throws is treated as temporary", async () => {
  const r = rig();
  r.answer = () => { throw new Error("lock timeout"); };
  r.box.put("food", "1", { id: 1 });
  await r.box.flush();
  assert.equal(r.box.count(), 1);
  assert.equal(r.pendingTimers().length, 1);
});

test("retries back off, never pile up, and stop after success", async () => {
  const r = rig();
  r.answer = OFFLINE;
  r.box.put("food", "1", { id: 1 });
  await r.box.flush();
  await r.box.flush();
  assert.equal(r.pendingTimers().length, 1, "one pending retry, not two");
  const delays = [];
  for (let i = 0; i < 6; i++) {
    const t = r.pendingTimers()[0];
    delays.push(t.ms);
    r.timers.length = 0;
    t.fn();
    await r.box.flush();
  }
  assert.deepEqual([...delays].sort((a, b) => a - b), delays, "never shorter than the one before");
  assert.ok(delays[delays.length - 1] > delays[0]);
  r.answer = () => ({ error: null, status: 201 });
  await r.box.flush();
  assert.deepEqual(r.pendingTimers(), []);
});

test("an auto-created row is sent so it cannot overwrite an existing one", async () => {
  const r = rig();
  r.box.put("days", "2026-11-24", { date: "2026-11-24" }, { ensure: true });
  await r.box.flush();
  assert.deepEqual(r.sent, [["days", "ensure", [{ date: "2026-11-24" }]]]);
});

test("editing an auto-created row before it is sent makes it an ordinary change", async () => {
  const r = rig();
  r.box.put("days", "d", { date: "d", weight: 1 }, { ensure: true });
  r.box.put("days", "d", { date: "d", weight: 2 });
  await r.box.flush();
  assert.deepEqual(r.sent, [["days", "upsert", [{ date: "d", weight: 2 }]]]);
});

test("re-creating a row whose delete is still unsent replaces it", async () => {
  const r = rig();
  r.box.put("days", "d", null);
  r.box.put("days", "d", { date: "d" }, { ensure: true });
  await r.box.flush();
  assert.deepEqual(r.sent, [["days", "upsert", [{ date: "d" }]]]);
});

// Changes made by the app itself: conditional, and never creating a row.

const WAITING = { food: "Coffee", status: "pending" };

test("an update is sent on its own, with the condition it depends on", async () => {
  const r = rig();
  r.box.update("food", "1", { kcal: 5 }, WAITING);
  r.box.update("food", "2", { kcal: 6 }, WAITING);
  await r.box.flush();
  assert.deepEqual(r.sent, [
    ["food", "update", [{ key: "1", row: { kcal: 5 }, match: WAITING }]],
    ["food", "update", [{ key: "2", row: { kcal: 6 }, match: WAITING }]],
  ]);
  assert.equal(r.box.count(), 0);
});

test("an update that finds no such row is reported, and then done with", async () => {
  const r = rig();
  r.answer = (_table, kind) => ({ error: null, status: 204, count: kind === "update" ? 0 : null });
  r.box.put("food", "1", { id: 1 });
  r.box.update("food", "2", { kcal: 5 }, WAITING);
  await r.box.flush();
  assert.deepEqual([r.misses, r.box.count()], [[["u1", "food", "2"]], 0]);
});

test("if that cannot be dealt with now, the update stays for later", async () => {
  const r = rig();
  r.answer = () => ({ error: null, status: 204, count: 0 });
  r.dealWith = async () => false;
  r.box.update("food", "2", { kcal: 5 }, WAITING);
  await r.box.flush();
  assert.deepEqual([r.box.count(), r.pendingTimers().length], [1, 1]);
  r.dealWith = async () => true;
  await r.box.flush();
  assert.deepEqual([r.misses.length, r.box.count()], [2, 0]);
});

test("an update that found its row is not reported; one that may not have is", async () => {
  for (const [count, misses] of [[1, 0], [null, 1], [undefined, 1]]) {
    const r = rig();
    r.answer = () => ({ error: null, status: 204, count });
    r.box.update("food", "2", { kcal: 5 }, WAITING);
    await r.box.flush();
    assert.deepEqual([r.misses.length, r.box.count()], [misses, 0], String(count));
  }
});

test("an update that leaves something else than this tab has is reported too", async () => {
  const r = rig();
  r.answer = () => ({ error: null, status: 204, count: 1 });
  const asked = [];
  r.agrees = (table, key, row) => { asked.push([table, key, row]); return false; };
  r.box.update("food", "2", { kcal: 5 }, WAITING);
  await r.box.flush();
  assert.deepEqual([asked, r.misses, r.box.count()], [[["food", "2", { kcal: 5 }]], [["u1", "food", "2"]], 0]);
});

test("an update joins the unsent row it belongs to", async () => {
  const r = rig();
  r.box.put("food", "1", { id: 1, food: "Coffee", status: "pending" });
  r.box.update("food", "1", { status: "done", kcal: 5 }, WAITING);
  await r.box.flush();
  assert.deepEqual(r.sent, [["food", "upsert", [{ id: 1, food: "Coffee", status: "done", kcal: 5 }]]]);
});

test("an update that joins a row already in flight is sent after it", async () => {
  const r = rig();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  r.answer = async () => { await gate; return { error: null, status: 201 }; };
  r.box.put("food", "1", { id: 1, food: "Coffee", status: "pending" });
  const done = r.box.flush();
  await new Promise(setImmediate); // in flight
  r.box.update("food", "1", { status: "done" }, WAITING);
  r.box.flush();
  release();
  await done;
  assert.deepEqual(r.sent.map(([, , items]) => items[0].status), ["pending", "done"]);
  assert.equal(r.box.count(), 0);
});

test("an update is dropped if the unsent row has become something else", async () => {
  const r = rig();
  r.box.put("food", "1", { id: 1, food: "Tea", status: "pending" });
  r.box.update("food", "1", { status: "done", kcal: 5 }, WAITING);
  await r.box.flush();
  assert.deepEqual(r.sent, [["food", "upsert", [{ id: 1, food: "Tea", status: "pending" }]]]);
});

test("an update is dropped if the row has an unsent delete", async () => {
  const r = rig();
  r.box.put("food", "1", null);
  r.box.update("food", "1", { status: "error" }, WAITING);
  await r.box.flush();
  assert.deepEqual(r.sent, [["food", "delete", ["1"]]]);
});

const FAILED = { food: "Coffee", status: "error" };
const sentUpdates = (r) => r.sent.map(([, kind, items]) => [kind, items[0].row, items[0].match]);

test("an update for what an unsent one leaves is sent after it", async () => {
  const r = rig();
  r.box.update("food", "1", { status: "error" }, WAITING);
  r.box.update("food", "1", { status: "pending" }, FAILED);
  r.box.update("food", "1", { status: "done", kcal: 5 }, WAITING); // after that one: they go together
  await r.box.flush();
  assert.deepEqual(sentUpdates(r), [["update", { status: "error" }, WAITING], ["update", { status: "done", kcal: 5 }, FAILED]]);
  assert.equal(r.box.count(), 0);
});

test("also if the first one is on its way", async () => {
  const r = rig();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  r.answer = async () => { await gate; return { error: null, status: 204, count: 1 }; };
  r.box.update("food", "1", { status: "pending" }, FAILED);
  const done = r.box.flush();
  await new Promise(setImmediate); // in flight
  r.box.update("food", "1", { status: "done" }, WAITING);
  release();
  await done;
  assert.deepEqual(sentUpdates(r), [["update", { status: "pending" }, FAILED], ["update", { status: "done" }, WAITING]]);
  assert.equal(r.box.count(), 0);
});

test("also after a restart, and if the first one finds nothing any more", async () => {
  const first = rig();
  first.answer = OFFLINE;
  first.box.update("food", "1", { status: "pending" }, FAILED);
  first.box.update("food", "1", { status: "done" }, WAITING);
  await first.box.flush();
  const second = rig({ store: first.store });
  second.answer = (_t, _k, [{ match }]) => ({ error: null, status: 204, count: match.status === "error" ? 0 : 1 });
  await second.box.flush();
  assert.deepEqual(sentUpdates(second), [["update", { status: "pending" }, FAILED], ["update", { status: "done" }, WAITING]]);
  assert.deepEqual([second.misses.length, second.box.count()], [1, 0]);
});

test("an update takes the place of one the server refused", async () => {
  const r = rig();
  r.answer = () => ({ error: { code: "22P05" }, status: 400 });
  r.box.update("food", "1", { status: "error", bad: true }, WAITING);
  await r.box.flush();
  assert.equal(r.box.count(), 1);
  r.answer = () => ({ error: null, status: 204, count: 1 });
  r.sent.length = 0;
  r.box.update("food", "1", { status: "pending" }, FAILED);
  await r.box.flush();
  assert.deepEqual([sentUpdates(r), r.box.count()], [[["update", { status: "pending" }, FAILED]], 0]);
});

test("the user's own change replaces all of them", async () => {
  const r = rig();
  r.box.update("food", "1", { status: "pending" }, FAILED);
  r.box.update("food", "1", { status: "done" }, WAITING);
  r.box.put("food", "1", { id: 1, status: "done", time: "19:30" });
  await r.box.flush();
  assert.deepEqual(r.sent, [["food", "upsert", [{ id: 1, status: "done", time: "19:30" }]]]);
});

test("a newer update replaces an unsent one; the user's own change replaces both", async () => {
  const r = rig();
  r.box.update("food", "1", { status: "error" }, WAITING);
  r.box.update("food", "1", { status: "done" }, WAITING);
  assert.deepEqual(r.box.pending("food")["1"].row, { status: "done" });
  r.box.put("food", "1", { id: 1, status: "done", time: "19:30" });
  await r.box.flush();
  assert.deepEqual(r.sent, [["food", "upsert", [{ id: 1, status: "done", time: "19:30" }]]]);
});

test("overlay applies an update only to an entry that is still there", () => {
  const apply = (entry, op) => ({ ...entry, ...op.row });
  const ops = { 1: { t: "a", row: { kcal: 5 }, match: WAITING }, 2: { t: "b", row: { kcal: 6 }, match: WAITING } };
  assert.deepEqual(Sync.overlay([{ id: 1 }], ops, (e) => e.id, undefined, apply), [{ id: 1, kcal: 5 }]);
});

test("matches compares exactly the listed fields", () => {
  assert.equal(Sync.matches({ food: "Coffee", status: "pending", other: 1 }, WAITING), true);
  assert.equal(Sync.matches({ food: "Coffee", status: "done" }, WAITING), false);
  assert.equal(Sync.matches({ status: "pending" }, WAITING), false);
});

test("signed out: nothing is stored or sent", async () => {
  const r = rig({ uid: null });
  r.box.put("food", "1", { id: 1 });
  r.box.update("food", "2", { kcal: 1 }, WAITING);
  await r.box.flush();
  assert.deepEqual([r.store, r.sent, r.box.count()], [{}, [], 0]);
});

test("another account's changes are neither sent nor touched", async () => {
  const r = rig();
  r.answer = OFFLINE;
  r.box.put("food", "1", { id: 1 });
  await r.box.flush();
  r.uid = "u2";
  r.answer = () => ({ error: null, status: 201 });
  r.sent.length = 0;
  await r.box.flush();
  assert.deepEqual(r.sent, []);
  assert.equal(Object.keys(r.store.u1.food).length, 1);
});

test("a send is told which account it is for", async () => {
  const r = rig({ uid: "u7" });
  r.box.put("food", "1", { id: 1 });
  await r.box.flush();
  assert.deepEqual(r.sentAs, ["u7"]);
});

test("clearing a delivered change touches no other stored change", async () => {
  const r = rig();
  r.box.put("food", "1", { id: 1 });
  r.box.put("food", "2", { id: 2, bad: true });
  r.answer = refuseBad;
  r.stored.length = 0;
  await r.box.flush();
  assert.deepEqual(r.stored, [["remove", "food", "1"]], "other tabs share this storage: nothing may be rewritten");
});

test("an auto-created row never replaces an unsent change to that row", async () => {
  const r = rig();
  r.box.put("days", "d", { date: "d", weight: 165.5 });
  r.box.put("days", "d", { date: "d", weight: 168 }, { ensure: true });
  await r.box.flush();
  assert.deepEqual(r.sent, [["days", "upsert", [{ date: "d", weight: 165.5 }]]]);
});

test("signing out while a send is in flight does not write the old account's outbox back", async () => {
  const r = rig();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  r.answer = async () => { await gate; return { error: null, status: 201 }; };
  r.box.put("food", "1", { id: 1 });
  const done = r.box.flush();
  await new Promise(setImmediate);
  delete r.store.u1; // sign-out wipes this user's keys,
  r.uid = null;      // then clears the session
  r.stored.length = 0;
  release();
  await done;
  assert.deepEqual([r.store, r.stored], [{}, []]);
});

test("signing out during a flush stops the rest of it", async () => {
  const r = rig();
  r.answer = () => { r.uid = null; return { error: null, status: 201 }; };
  r.box.put("food", "1", { id: 1 });
  r.box.put("food", "2", null);
  r.box.put("days", "d", { date: "d" });
  await r.box.flush();
  assert.equal(r.sent.length, 1);
});

test("a change another tab stored is not lost when this tab stores its own", () => {
  const store = {};
  const a = rig({ store }), b = rig({ store });
  a.box.put("food", "1", { id: 1 });
  b.box.put("food", "2", { id: 2 });
  assert.deepEqual(Object.keys(a.box.pending("food")).sort(), ["1", "2"]);
});

test("unreadable stored data is treated as empty rather than crashing", async () => {
  const r = rig();
  r.box = Sync.createOutbox({
    owner: () => "u1", list: () => { throw new Error("blocked"); }, set() {}, remove() {},
    send: async () => ({ error: null }), lock: (_uid, fn) => fn(), schedule() {}, cancel() {}, log() {},
  });
  r.box.put("food", "1", { id: 1 });
  await r.box.flush();
  assert.equal(r.box.count(), 0);
  assert.deepEqual(r.box.pending("food"), {});
});

test("matches compares objects by value, whatever the order of their keys", () => {
  const row = { macros: { protein: { low: 22, high: 22, mine: true }, fat: { low: 1, high: 2 } } };
  assert.equal(Sync.matches(row, { macros: { fat: { high: 2, low: 1 }, protein: { mine: true, high: 22, low: 22 } } }), true);
  assert.equal(Sync.matches(row, { macros: { fat: { low: 1, high: 2 }, protein: { low: 22, high: 22 } } }), false);
  assert.equal(Sync.matches(row, { macros: { protein: { low: 22, high: 22, mine: true } } }), false);
  assert.equal(Sync.matches({ macros: { protein: row.macros.protein } }, row), false);
  assert.equal(Sync.matches({ macros: {} }, { macros: {} }), true);
  assert.equal(Sync.matches({ macros: null }, { macros: {} }), false);
  assert.equal(Sync.matches({ x: 1 }, { x: "1" }), false);
});
