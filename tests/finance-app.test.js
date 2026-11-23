// Finance app, end to end: the real finance/app.js driven through its own
// event handlers against a fake server (see helpers/finance-app-harness.js).
const test = require("node:test");
const assert = require("node:assert");
const { bootFinanceApp, createFakeServer, createStorage } = require("./helpers/finance-app-harness.js");

const SAVED_CATEGORIES = {
  expense: { Groceries: [], "Dining Out": [], Transport: [] },
  income: { Salary: [], Other: [] },
};

// One existing row (id 1); the fake server hands out ids from 1000 for inserts.
function startingServer() {
  return createFakeServer({
    transactions: [{
      id: 1, date: "2026-01-05", type: "expense", category: "Groceries", subcategory: null,
      description: "Rice", amount: 500, notes: null, created_at: "2026-01-05T00:00:00+00:00",
    }],
    settings: { ft_categories: JSON.stringify(SAVED_CATEGORIES) },
  });
}

const coffee = (rows) => rows.filter((r) => r.description === "Coffee");

// ---- Editing / deleting a transaction that was just added -------------------
// A new row is rendered under a temporary client id (Date.now()) and the
// server assigns the real id when the background insert returns. The buttons
// are pressed exactly as rendered, so they carry the temporary id.

test("new transaction: Edit works after the insert has landed", async () => {
  const app = await bootFinanceApp({ server: startingServer() });
  app.addTransaction({ description: "Coffee", amount: 120 });
  const editButton = app.rowButton("Coffee", "openEditModal");
  await app.settle();
  assert.deepEqual(coffee(app.server.rows()).map((r) => r.id), [1000], "the insert reached the server");

  app.press(editButton);
  assert.equal(app.isOpen("txn-modal"), true, "Edit opens the dialog");
  assert.equal(app.el("txn-description").value, "Coffee");

  app.el("txn-amount").value = "150";
  app.click("txn-save");
  await app.settle();

  assert.deepEqual(coffee(app.server.rows()).map((r) => [r.id, r.amount]), [[1000, 150]]);
  assert.deepEqual(coffee(app.transactions()).map((r) => [r.id, r.amount]), [[1000, 150]]);
  assert.deepEqual(app.errors, [], "no background write failed");
});

test("new transaction: Delete works after the insert has landed", async () => {
  const app = await bootFinanceApp({ server: startingServer() });
  app.addTransaction({ description: "Coffee", amount: 120 });
  const deleteButton = app.rowButton("Coffee", "openDeleteModal");
  await app.settle();

  app.press(deleteButton);
  app.click("delete-confirm");
  await app.settle();

  assert.deepEqual(coffee(app.transactions()), []);
  assert.deepEqual(app.server.rows().map((r) => r.description), ["Rice"]);
  assert.deepEqual(app.errors, [], "no background write failed");
});

test("new transaction: an edit saved while the insert is in flight is kept and reaches the server", async () => {
  const app = await bootFinanceApp({ server: startingServer() });
  const releaseInsert = app.server.holdInserts();
  app.addTransaction({ description: "Coffee", amount: 120 });

  app.press(app.rowButton("Coffee", "openEditModal"));
  app.el("txn-amount").value = "150";
  app.click("txn-save");
  await app.settle();
  releaseInsert();
  await app.settle();

  assert.deepEqual(coffee(app.server.rows()).map((r) => [r.id, r.amount]), [[1000, 150]]);
  assert.deepEqual(coffee(app.transactions()).map((r) => [r.id, r.amount]), [[1000, 150]]);
  assert.deepEqual(app.errors, [], "no background write failed");
});

test("new transaction: a delete confirmed while the insert is in flight removes the server row too", async () => {
  const app = await bootFinanceApp({ server: startingServer() });
  const releaseInsert = app.server.holdInserts();
  app.addTransaction({ description: "Coffee", amount: 120 });

  app.press(app.rowButton("Coffee", "openDeleteModal"));
  app.click("delete-confirm");
  await app.settle();
  releaseInsert();
  await app.settle();

  assert.deepEqual(coffee(app.transactions()), []);
  assert.deepEqual(app.server.rows().map((r) => r.description), ["Rice"]);
  assert.deepEqual(app.errors, [], "no background write failed");
});

test("new transaction: an Edit dialog opened before the insert landed still saves after it", async () => {
  const app = await bootFinanceApp({ server: startingServer() });
  const releaseInsert = app.server.holdInserts();
  app.addTransaction({ description: "Coffee", amount: 120 });

  app.press(app.rowButton("Coffee", "openEditModal"));
  releaseInsert();
  await app.settle();
  app.el("txn-amount").value = "175";
  app.click("txn-save");
  await app.settle();

  assert.deepEqual(coffee(app.server.rows()).map((r) => [r.id, r.amount]), [[1000, 175]]);
  assert.deepEqual(coffee(app.transactions()).map((r) => [r.id, r.amount]), [[1000, 175]]);
  assert.deepEqual(app.errors, [], "no background write failed");
});

test("new transaction: a Delete dialog opened before the insert landed still deletes after it", async () => {
  const app = await bootFinanceApp({ server: startingServer() });
  const releaseInsert = app.server.holdInserts();
  app.addTransaction({ description: "Coffee", amount: 120 });

  app.press(app.rowButton("Coffee", "openDeleteModal"));
  releaseInsert();
  await app.settle();
  app.click("delete-confirm");
  await app.settle();

  assert.deepEqual(coffee(app.transactions()), []);
  assert.deepEqual(app.server.rows().map((r) => r.description), ["Rice"]);
  assert.deepEqual(app.errors, [], "no background write failed");
});

test("new transaction: a category rename while the insert is in flight reaches the server row", async () => {
  const app = await bootFinanceApp({ server: startingServer() });
  const releaseInsert = app.server.holdInserts();
  app.addTransaction({ description: "Coffee", amount: 120, category: "Groceries" });

  app.categoryAction({ action: "edit-cat", type: "expense", cat: "Groceries" });
  app.saveCategoryName("Food");
  await app.settle();
  releaseInsert();
  await app.settle();

  // Ids are listed too: a write addressed by the temporary id must never
  // overwrite the server-assigned one.
  assert.deepEqual(app.server.rows().map((r) => [r.id, r.description, r.category]),
    [[1, "Rice", "Food"], [1000, "Coffee", "Food"]]);
  assert.deepEqual(coffee(app.transactions()).map((r) => [r.id, r.category]), [[1000, "Food"]]);
  assert.deepEqual(app.errors, [], "no background write failed");
});

test("new transaction: stays editable under its temporary id when the insert fails (offline)", async () => {
  const app = await bootFinanceApp({ server: startingServer() });
  app.server.setOnline(false);
  app.addTransaction({ description: "Coffee", amount: 120 });
  await app.settle();

  app.press(app.rowButton("Coffee", "openEditModal"));
  assert.equal(app.isOpen("txn-modal"), true);
  app.el("txn-amount").value = "150";
  app.click("txn-save");
  await app.settle();

  // Still stored locally, edit included, for the next load's resync to push.
  const stored = coffee(JSON.parse(app.storage.getItem("ft_transactions")));
  assert.deepEqual(stored.map((r) => r.amount), [150]);
  assert.deepEqual(coffee(app.transactions()).map((r) => [r.id, r.amount]), [[stored[0].id, 150]]);
  assert.deepEqual(app.server.rows().map((r) => r.description), ["Rice"]);
});

// ---- Categories -------------------------------------------------------------

const expenseNames = (categories) => Object.keys(categories.expense);

test("categories: + Add in Manage Categories saves a new category", async () => {
  const app = await bootFinanceApp({ server: startingServer() });
  app.categoryAction({ action: "add-cat", type: "expense" });
  assert.equal(app.isOpen("cat-modal"), true);
  app.saveCategoryName("Pets");
  await app.settle();

  assert.ok(expenseNames(app.categories()).includes("Pets"));
  assert.ok(expenseNames(JSON.parse(app.server.setting("ft_categories"))).includes("Pets"));
});

test("categories: a fresh install's defaults include Travel", async () => {
  const app = await bootFinanceApp({ server: createFakeServer() });
  assert.ok(expenseNames(app.categories()).includes("Travel"));
});

test("categories: a saved list that predates Travel gets it added at startup", async () => {
  const app = await bootFinanceApp({ server: startingServer() });
  const expected = ["Groceries", "Dining Out", "Transport", "Travel"];
  assert.deepEqual(expenseNames(app.categories()), expected);
  assert.deepEqual(expenseNames(JSON.parse(app.server.setting("ft_categories"))), expected);
});

test("categories: Travel stays deleted once the user removes it", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage });
  assert.ok(expenseNames(app.categories()).includes("Travel"), "added on first load");

  app.categoryAction({ action: "delete-cat", type: "expense", cat: "Travel" });
  await app.settle();
  const reloaded = await bootFinanceApp({ server, storage });

  assert.equal(expenseNames(reloaded.categories()).includes("Travel"), false);
  assert.equal(expenseNames(JSON.parse(server.setting("ft_categories"))).includes("Travel"), false);
});

test("categories: Travel transactions keep their category on a device whose saved list predates Travel", async () => {
  // Another device already added Travel and used it; this one still holds the older list.
  const server = createFakeServer({
    transactions: [{
      id: 7, date: "2026-01-09", type: "expense", category: "Travel", subcategory: null,
      description: "Flight", amount: 9000, notes: null, created_at: "2026-01-09T00:00:00+00:00",
    }],
    settings: {
      ft_categories: JSON.stringify({ ...SAVED_CATEGORIES, expense: { ...SAVED_CATEGORIES.expense, Travel: [] } }),
    },
  });
  const storage = createStorage({ ft_categories: JSON.stringify(SAVED_CATEGORIES) });
  const app = await bootFinanceApp({ server, storage });

  assert.deepEqual(server.rows().map((r) => r.category), ["Travel"]);
  assert.deepEqual(app.transactions().map((r) => r.category), ["Travel"]);
});
