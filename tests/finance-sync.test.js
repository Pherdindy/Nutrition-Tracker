const test = require("node:test");
const assert = require("node:assert");
const FS = require("../finance/sync.js");

const FIELDS = ["date", "type", "category", "subcategory", "description", "amount", "notes"];

// The rule: this device uploads only what it knows the server never received.
// A new row keeps its client-made id (Date.now()) until the server stores it,
// and an edited row is listed as unsent until the server confirms the edit.
// Any other difference means the saved copy is old, and the server's data stays.

test("planResync: a row that still has its client-made id becomes an insert", () => {
  const server = [{ id: 1, date: "2026-07-25", type: "expense", category: "Rent", subcategory: null, description: "old", amount: 100, notes: null }];
  const local = [
    server[0],
    { id: 1753700000000, date: "2026-07-28", type: "expense", category: "Dining Out", subcategory: null, description: "Yardstick", amount: 190, notes: "" },
  ];
  const plan = FS.planResync(server, local, FIELDS);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].description, "Yardstick");
  assert.equal(plan.updates.length, 0);
  assert.deepEqual(plan.serverOnlyIds, []);
});

test("planResync: identical rows produce no work", () => {
  const row = { id: 5, date: "2026-07-01", type: "income", category: "Salary", subcategory: null, description: "pay", amount: 1000, notes: null };
  const plan = FS.planResync([row], [{ ...row }], FIELDS);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.deepEqual(plan.serverOnlyIds, []);
});

test("planResync: an unsent edit yields an update carrying the local version", () => {
  const server = [{ id: 7, date: "2026-07-10", type: "expense", category: "Transport", subcategory: null, description: "grab", amount: 300, notes: null }];
  const local = [{ id: 7, date: "2026-07-10", type: "expense", category: "Transport", subcategory: null, description: "grab to airport", amount: 350, notes: null }];
  const plan = FS.planResync(server, local, FIELDS, [7]);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].description, "grab to airport");
  assert.equal(plan.updates[0].amount, 350);
  assert.equal(plan.inserts.length, 0);
});

test("planResync: a row that differs but has no unsent edit is left as the server has it", () => {
  const server = [
    { id: 7, date: "2026-07-10", type: "expense", category: "Coffee", subcategory: null, description: "grab to airport", amount: 350, notes: null },
    { id: 8, date: "2026-07-11", type: "expense", category: "Transport", subcategory: null, description: "bus", amount: 20, notes: null },
  ];
  const local = [
    { id: 7, date: "2026-07-10", type: "expense", category: "Transport", subcategory: null, description: "grab", amount: 300, notes: null },
    { id: 8, date: "2026-07-11", type: "expense", category: "Transport", subcategory: null, description: "bus fare", amount: 25, notes: null },
  ];
  // Row 8 was edited here and not sent; row 7 is simply an old copy.
  const plan = FS.planResync(server, local, FIELDS, [8]);
  assert.deepEqual(plan.updates.map((r) => [r.id, r.description]), [[8, "bus fare"]]);
  assert.equal(plan.inserts.length, 0);
});

test("planResync: null vs empty-string vs undefined are the same value", () => {
  const server = [{ id: 3, date: "2026-07-10", type: "expense", category: "Other", subcategory: null, description: "x", amount: 10, notes: null }];
  const local = [{ id: 3, date: "2026-07-10", type: "expense", category: "Other", description: "x", amount: 10, notes: "" }];
  const plan = FS.planResync(server, local, FIELDS, [3]);
  assert.equal(plan.updates.length, 0);
});

test("planResync: numeric amounts compare by value, not representation", () => {
  const server = [{ id: 4, date: "2026-07-10", type: "expense", category: "Other", subcategory: null, description: "x", amount: "950.00", notes: null }];
  const local = [{ id: 4, date: "2026-07-10", type: "expense", category: "Other", subcategory: null, description: "x", amount: 950, notes: null }];
  const plan = FS.planResync(server, local, FIELDS, [4]);
  assert.equal(plan.updates.length, 0);
});

test("planResync: server-only rows are reported, never deleted", () => {
  const server = [
    { id: 1, date: "2026-07-01", type: "expense", category: "Rent", subcategory: null, description: "a", amount: 1, notes: null },
    { id: 2, date: "2026-07-02", type: "expense", category: "Rent", subcategory: null, description: "b", amount: 2, notes: null },
  ];
  const local = [server[0]];
  const plan = FS.planResync(server, local, FIELDS);
  assert.deepEqual(plan.serverOnlyIds, [2]);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 0);
});

test("planResync: a row the server once stored and no longer has is not inserted again", () => {
  // Ids 111 and 222 were given by the server, so these rows were deleted on
  // another device. Row 222 was even edited here and never sent.
  const local = [
    { id: 111, date: "2026-06-01", type: "expense", category: "Groceries", amount: 30 },
    { id: 222, date: "2026-06-05", type: "income", category: "Salary", amount: 150 },
    { id: 1750000000000, date: "2026-06-06", type: "expense", category: "Groceries", amount: 45 },
  ];
  const plan = FS.planResync([], local, ["date", "type", "category", "amount"], [222]);
  assert.deepEqual(plan.inserts.map((r) => r.id), [1750000000000]);
  assert.equal(plan.updates.length, 0);
});
