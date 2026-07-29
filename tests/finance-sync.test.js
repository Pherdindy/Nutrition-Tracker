const test = require("node:test");
const assert = require("node:assert");
const FS = require("../finance/sync.js");

const FIELDS = ["date", "type", "category", "subcategory", "description", "amount", "notes"];

test("planResync: local-only rows become inserts", () => {
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

test("planResync: differing field yields an update carrying the LOCAL version", () => {
  const server = [{ id: 7, date: "2026-07-10", type: "expense", category: "Transport", subcategory: null, description: "grab", amount: 300, notes: null }];
  const local = [{ id: 7, date: "2026-07-10", type: "expense", category: "Transport", subcategory: null, description: "grab to airport", amount: 350, notes: null }];
  const plan = FS.planResync(server, local, FIELDS);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].description, "grab to airport");
  assert.equal(plan.updates[0].amount, 350);
  assert.equal(plan.inserts.length, 0);
});

test("planResync: null vs empty-string vs undefined are the same value", () => {
  const server = [{ id: 3, date: "2026-07-10", type: "expense", category: "Other", subcategory: null, description: "x", amount: 10, notes: null }];
  const local = [{ id: 3, date: "2026-07-10", type: "expense", category: "Other", description: "x", amount: 10, notes: "" }];
  const plan = FS.planResync(server, local, FIELDS);
  assert.equal(plan.updates.length, 0);
});

test("planResync: numeric amounts compare by value, not representation", () => {
  const server = [{ id: 4, date: "2026-07-10", type: "expense", category: "Other", subcategory: null, description: "x", amount: "950.00", notes: null }];
  const local = [{ id: 4, date: "2026-07-10", type: "expense", category: "Other", subcategory: null, description: "x", amount: 950, notes: null }];
  const plan = FS.planResync(server, local, FIELDS);
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

test("planResync: empty server means everything inserts (stock_trades bootstrap)", () => {
  const local = [
    { id: 111, stock_code: "ALI", date_bought: "2026-06-01", price_bought: 30, shares_bought: 100 },
    { id: 222, stock_code: "BDO", date_bought: "2026-06-05", price_bought: 150, shares_bought: 10 },
  ];
  const plan = FS.planResync([], local, ["stock_code", "date_bought", "price_bought", "shares_bought"]);
  assert.equal(plan.inserts.length, 2);
});
