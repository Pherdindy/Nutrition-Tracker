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

// ---- A device whose saved copy is old ---------------------------------------
// Every browser keeps its own copy of the transactions and the category list.
// Opening the app on a device last used before another device's changes must
// leave the server as that other device left it. On 2026-11-27 it did not: the
// old copy was uploaded over the newer data.

const RICE = {
  id: 1, date: "2026-01-05", type: "expense", category: "Groceries", subcategory: null,
  description: "Rice", amount: 500, notes: null, created_at: "2026-01-05T00:00:00+00:00",
};
const SAVED_LIST = JSON.stringify(SAVED_CATEGORIES);
// The app's clock, for the tests that press a button on the January row.
const JANUARY = "2026-01-10T04:00:00Z";

test("old saved copy: a row deleted on another device is not put back", async () => {
  const beans = { ...RICE, id: 2, description: "Beans", amount: 80 };
  const server = createFakeServer({ transactions: [RICE], settings: { ft_categories: SAVED_LIST } });
  const storage = createStorage({ ft_transactions: JSON.stringify([RICE, beans]), ft_categories: SAVED_LIST });

  const app = await bootFinanceApp({ server, storage });

  assert.deepEqual(server.rows().map((r) => [r.id, r.description]), [[1, "Rice"]]);
  assert.deepEqual(app.transactions().map((r) => r.description), ["Rice"]);
  assert.deepEqual(JSON.parse(storage.getItem("ft_transactions")).map((r) => r.description), ["Rice"]);
});

test("old saved copy: a row edited on another device keeps that edit", async () => {
  const edited = { ...RICE, description: "Rice 10kg", amount: 650, category: "Dining Out" };
  const server = createFakeServer({ transactions: [edited], settings: { ft_categories: SAVED_LIST } });
  const storage = createStorage({ ft_transactions: JSON.stringify([RICE]), ft_categories: SAVED_LIST });

  const app = await bootFinanceApp({ server, storage });

  assert.deepEqual(server.rows().map((r) => [r.description, r.amount, r.category]), [["Rice 10kg", 650, "Dining Out"]]);
  assert.deepEqual(app.transactions().map((r) => [r.description, r.amount, r.category]), [["Rice 10kg", 650, "Dining Out"]]);
});

test("old saved copy: a category made on another device, and the transaction filed under it, are kept", async () => {
  const listWithCoffee = JSON.stringify({
    expense: { Groceries: [], "Dining Out": [], Transport: [], Coffee: [] },
    income: { Salary: [], Other: [] },
  });
  const coffeeBeans = { ...RICE, id: 2, description: "Coffee beans", amount: 900, category: "Coffee" };
  const server = createFakeServer({ transactions: [RICE, coffeeBeans], settings: { ft_categories: listWithCoffee } });
  const storage = createStorage({ ft_transactions: JSON.stringify([RICE]), ft_categories: SAVED_LIST });

  const app = await bootFinanceApp({ server, storage });

  const kept = ["Groceries", "Dining Out", "Transport", "Coffee", "Travel"];
  assert.deepEqual(expenseNames(JSON.parse(server.setting("ft_categories"))), kept);
  assert.deepEqual(expenseNames(app.categories()), kept);
  assert.deepEqual(server.rows().map((r) => [r.description, r.category]), [["Rice", "Groceries"], ["Coffee beans", "Coffee"]]);
  assert.deepEqual(app.transactions().map((r) => [r.description, r.category]), [["Rice", "Groceries"], ["Coffee beans", "Coffee"]]);
});

test("an edit that reached the server is not sent again once another device has changed the row", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage, now: JANUARY });
  app.press(app.rowButton("Rice", "openEditModal"));
  app.el("txn-amount").value = "650";
  app.click("txn-save");
  await app.settle();
  assert.deepEqual(server.rows().map((r) => r.amount), [650], "the edit reached the server");

  await server.client.from("transactions").update({ amount: 700 }).eq("id", 1); // another device
  const reloaded = await bootFinanceApp({ server, storage, now: JANUARY });

  assert.deepEqual(server.rows().map((r) => r.amount), [700]);
  assert.deepEqual(reloaded.transactions().map((r) => r.amount), [700]);
});

test("a category change that reached the server is not sent again once another device has changed the list", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage });
  app.categoryAction({ action: "add-cat", type: "expense" });
  app.saveCategoryName("Pets");
  await app.settle();
  assert.deepEqual(expenseNames(JSON.parse(server.setting("ft_categories"))),
    ["Groceries", "Dining Out", "Transport", "Travel", "Pets"], "the change reached the server");

  // Another device adds Coffee.
  await server.client.from("settings").upsert({
    key: "ft_categories",
    value: JSON.stringify({
      expense: { Groceries: [], "Dining Out": [], Transport: [], Travel: [], Pets: [], Coffee: [] },
      income: { Salary: [], Other: [] },
    }),
  });
  const reloaded = await bootFinanceApp({ server, storage });

  const kept = ["Groceries", "Dining Out", "Transport", "Travel", "Pets", "Coffee"];
  assert.deepEqual(expenseNames(JSON.parse(server.setting("ft_categories"))), kept);
  assert.deepEqual(expenseNames(reloaded.categories()), kept);
});

// A load that could not read everything has nothing current to compare with, so
// it must not tidy up the server from what it has saved.

test("old saved copy: a load that cannot read the category list leaves the server's list and rows alone", async () => {
  const listWithCoffee = JSON.stringify({
    expense: { Groceries: [], "Dining Out": [], Transport: [], Coffee: [], Travel: [] },
    income: { Salary: [], Other: [] },
  });
  const coffeeBeans = { ...RICE, id: 2, description: "Coffee beans", amount: 900, category: "Coffee" };
  const server = createFakeServer({ transactions: [RICE, coffeeBeans], settings: { ft_categories: listWithCoffee } });
  const storage = createStorage({ ft_transactions: JSON.stringify([RICE]), ft_categories: SAVED_LIST });
  server.setReadsFailing("settings");

  await bootFinanceApp({ server, storage });

  assert.equal(server.setting("ft_categories"), listWithCoffee);
  assert.deepEqual(server.rows().map((r) => [r.description, r.category]), [["Rice", "Groceries"], ["Coffee beans", "Coffee"]]);
});

test("old saved copy: a load that cannot read the transactions leaves the server's rows alone", async () => {
  // Another device renamed Groceries to Food and edited the row; this one still holds the old row.
  const listWithFood = JSON.stringify({
    expense: { Food: [], "Dining Out": [], Transport: [], Travel: [] },
    income: { Salary: [], Other: [] },
  });
  const renamed = { ...RICE, category: "Food", amount: 650 };
  const server = createFakeServer({ transactions: [renamed], settings: { ft_categories: listWithFood } });
  const storage = createStorage({ ft_transactions: JSON.stringify([RICE]), ft_categories: SAVED_LIST });
  server.setReadsFailing("transactions");

  await bootFinanceApp({ server, storage });

  assert.deepEqual(server.rows().map((r) => [r.description, r.category, r.amount]), [["Rice", "Food", 650]]);
  assert.equal(server.setting("ft_categories"), listWithFood);
});

test("an offline start does not turn an old saved category list into a change to upload", async () => {
  // Another device made Coffee. This one starts offline with its older list,
  // then starts again online.
  const listWithCoffee = JSON.stringify({
    expense: { Groceries: [], "Dining Out": [], Transport: [], Coffee: [], Travel: [] },
    income: { Salary: [], Other: [] },
  });
  const server = createFakeServer({ transactions: [RICE], settings: { ft_categories: listWithCoffee } });
  const storage = createStorage({ ft_transactions: JSON.stringify([RICE]), ft_categories: SAVED_LIST });
  server.setOnline(false);
  await bootFinanceApp({ server, storage });

  server.setOnline(true);
  const reloaded = await bootFinanceApp({ server, storage });

  assert.equal(server.setting("ft_categories"), listWithCoffee);
  assert.deepEqual(expenseNames(reloaded.categories()), ["Groceries", "Dining Out", "Transport", "Coffee", "Travel"]);
});

// At startup the app also tidies up by itself: it adds a new built-in category,
// and it files a transaction whose category is not in the list under
// Uncategorized. That is worked out afresh on every load, so one that did not
// reach the server is not this device's unsent work.

test("startup tidy-up: a recategorisation that did not reach the server is not sent later over another device's fix", async () => {
  // The row's category is missing from the list, so this load files it under Uncategorized.
  const coffeeBeans = { ...RICE, id: 2, description: "Coffee beans", amount: 900, category: "Coffee" };
  const server = createFakeServer({ transactions: [RICE, coffeeBeans], settings: { ft_categories: SAVED_LIST } });
  const storage = createStorage();
  server.setUpdatesFailing(true);
  await bootFinanceApp({ server, storage });
  assert.deepEqual(server.rows().map((r) => r.category), ["Groceries", "Coffee"], "the recategorisation did not reach the server");

  // Another device puts Coffee back in the list.
  server.setUpdatesFailing(false);
  await server.client.from("settings").upsert({
    key: "ft_categories",
    value: JSON.stringify({
      expense: { Groceries: [], "Dining Out": [], Transport: [], Travel: [], Uncategorized: [], Coffee: [] },
      income: { Salary: [], Other: [] },
    }),
  });
  const reloaded = await bootFinanceApp({ server, storage });

  assert.deepEqual(server.rows().map((r) => [r.description, r.category]), [["Rice", "Groceries"], ["Coffee beans", "Coffee"]]);
  assert.deepEqual(reloaded.transactions().map((r) => [r.description, r.category]), [["Rice", "Groceries"], ["Coffee beans", "Coffee"]]);
});

test("startup tidy-up: a built-in category that did not reach the server is not sent later over another device's list", async () => {
  const server = startingServer();
  const storage = createStorage();
  server.setUpsertsFailing(true);
  await bootFinanceApp({ server, storage });
  assert.equal(server.setting("ft_categories"), SAVED_LIST, "Travel did not reach the server");

  // Another device adds Coffee.
  server.setUpsertsFailing(false);
  await server.client.from("settings").upsert({
    key: "ft_categories",
    value: JSON.stringify({
      expense: { Groceries: [], "Dining Out": [], Transport: [], Coffee: [] },
      income: { Salary: [], Other: [] },
    }),
  });
  const reloaded = await bootFinanceApp({ server, storage });

  // Coffee is kept, and Travel is added again because it never arrived.
  const expected = ["Groceries", "Dining Out", "Transport", "Coffee", "Travel"];
  assert.deepEqual(expenseNames(JSON.parse(server.setting("ft_categories"))), expected);
  assert.deepEqual(expenseNames(reloaded.categories()), expected);
});

// ---- Changes the server never received ---------------------------------------
// What this device typed and could not send is still uploaded on the next load.

test("offline: an edit to an existing row reaches the server on the next load", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage, now: JANUARY });
  server.setOnline(false);
  app.press(app.rowButton("Rice", "openEditModal"));
  app.el("txn-amount").value = "650";
  app.click("txn-save");
  await app.settle();
  assert.deepEqual(server.rows().map((r) => r.amount), [500], "the edit did not reach the server");

  server.setOnline(true);
  const reloaded = await bootFinanceApp({ server, storage, now: JANUARY });

  assert.deepEqual(server.rows().map((r) => [r.id, r.amount]), [[1, 650]]);
  assert.deepEqual(reloaded.transactions().map((r) => [r.id, r.amount]), [[1, 650]]);
});

test("offline: an edit is kept through a load that fails to send it", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage, now: JANUARY });
  server.setUpdatesFailing(true);
  app.press(app.rowButton("Rice", "openEditModal"));
  app.el("txn-amount").value = "650";
  app.click("txn-save");
  await app.settle();

  const stillFailing = await bootFinanceApp({ server, storage, now: JANUARY });
  assert.deepEqual(stillFailing.transactions().map((r) => r.amount), [650], "the edit is still on screen");
  assert.deepEqual(server.rows().map((r) => r.amount), [500]);

  server.setUpdatesFailing(false);
  await bootFinanceApp({ server, storage, now: JANUARY });

  assert.deepEqual(server.rows().map((r) => [r.id, r.amount]), [[1, 650]]);
});

test("offline: an edit made while the row's insert was in flight reaches the server on the next load", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage });
  const releaseInsert = server.holdInserts();
  app.addTransaction({ description: "Coffee", amount: 120 });
  app.press(app.rowButton("Coffee", "openEditModal"));
  app.el("txn-amount").value = "150";
  app.click("txn-save");
  server.setUpdatesFailing(true);
  releaseInsert();
  await app.settle();
  assert.deepEqual(coffee(server.rows()).map((r) => [r.id, r.amount]), [[1000, 120]], "the row arrived, the edit did not");

  server.setUpdatesFailing(false);
  const reloaded = await bootFinanceApp({ server, storage });

  assert.deepEqual(coffee(server.rows()).map((r) => [r.id, r.amount]), [[1000, 150]]);
  assert.deepEqual(coffee(reloaded.transactions()).map((r) => [r.id, r.amount]), [[1000, 150]]);
});

test("offline: a new transaction reaches the server on the next load", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage });
  server.setOnline(false);
  app.addTransaction({ description: "Coffee", amount: 120 });
  await app.settle();

  server.setOnline(true);
  const reloaded = await bootFinanceApp({ server, storage });

  assert.deepEqual(server.rows().map((r) => [r.id, r.description, r.amount]), [[1, "Rice", 500], [1000, "Coffee", 120]]);
  assert.deepEqual(coffee(reloaded.transactions()).map((r) => [r.id, r.amount]), [[1000, 120]]);
});

test("offline: a category change reaches the server on the next load", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage });
  server.setOnline(false);
  app.categoryAction({ action: "add-cat", type: "expense" });
  app.saveCategoryName("Pets");
  await app.settle();

  server.setOnline(true);
  const reloaded = await bootFinanceApp({ server, storage });

  const expected = ["Groceries", "Dining Out", "Transport", "Travel", "Pets"];
  assert.deepEqual(expenseNames(JSON.parse(server.setting("ft_categories"))), expected);
  assert.deepEqual(expenseNames(reloaded.categories()), expected);
});

test("offline: a category rename reaches the server on the next load, with every transaction it moved", async () => {
  const beans = { ...RICE, id: 2, description: "Beans", amount: 80 };
  const server = createFakeServer({ transactions: [RICE, beans], settings: { ft_categories: SAVED_LIST } });
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage });
  server.setOnline(false);
  app.categoryAction({ action: "edit-cat", type: "expense", cat: "Groceries" });
  app.saveCategoryName("Food");
  await app.settle();

  server.setOnline(true);
  const reloaded = await bootFinanceApp({ server, storage });

  assert.deepEqual(expenseNames(JSON.parse(server.setting("ft_categories"))), ["Food", "Dining Out", "Transport", "Travel"]);
  assert.deepEqual(server.rows().map((r) => [r.description, r.category]), [["Rice", "Food"], ["Beans", "Food"]]);
  assert.deepEqual(reloaded.transactions().map((r) => [r.description, r.category]), [["Rice", "Food"], ["Beans", "Food"]]);
});

test("offline: an edit survives a reload made while still offline", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage, now: JANUARY });
  server.setOnline(false);
  app.press(app.rowButton("Rice", "openEditModal"));
  app.el("txn-amount").value = "650";
  app.click("txn-save");
  await app.settle();

  const offlineAgain = await bootFinanceApp({ server, storage, now: JANUARY });
  assert.deepEqual(offlineAgain.transactions().map((r) => r.amount), [650], "the edit is still on screen");
  server.setOnline(true);
  await bootFinanceApp({ server, storage, now: JANUARY });

  assert.deepEqual(server.rows().map((r) => [r.id, r.amount]), [[1, 650]]);
});

test("offline: a category change survives a reload made while still offline", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage });
  server.setOnline(false);
  app.categoryAction({ action: "add-cat", type: "expense" });
  app.saveCategoryName("Pets");
  await app.settle();

  const offlineAgain = await bootFinanceApp({ server, storage });
  assert.ok(expenseNames(offlineAgain.categories()).includes("Pets"), "the change is still on screen");
  server.setOnline(true);
  await bootFinanceApp({ server, storage });

  assert.deepEqual(expenseNames(JSON.parse(server.setting("ft_categories"))),
    ["Groceries", "Dining Out", "Transport", "Travel", "Pets"]);
});

test("offline: an edit sent by a later load is not sent again once another device has changed the row", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage, now: JANUARY });
  server.setOnline(false);
  app.press(app.rowButton("Rice", "openEditModal"));
  app.el("txn-amount").value = "650";
  app.click("txn-save");
  await app.settle();
  server.setOnline(true);
  await bootFinanceApp({ server, storage, now: JANUARY });
  assert.deepEqual(server.rows().map((r) => r.amount), [650], "the later load sent the edit");

  await server.client.from("transactions").update({ amount: 700 }).eq("id", 1); // another device
  const reloaded = await bootFinanceApp({ server, storage, now: JANUARY });

  assert.deepEqual(server.rows().map((r) => r.amount), [700]);
  assert.deepEqual(reloaded.transactions().map((r) => r.amount), [700]);
});

test("offline: a category change sent by a later load is not sent again once another device has changed the list", async () => {
  const server = startingServer();
  const storage = createStorage();
  const app = await bootFinanceApp({ server, storage });
  server.setOnline(false);
  app.categoryAction({ action: "add-cat", type: "expense" });
  app.saveCategoryName("Pets");
  await app.settle();
  server.setOnline(true);
  await bootFinanceApp({ server, storage });
  assert.deepEqual(expenseNames(JSON.parse(server.setting("ft_categories"))),
    ["Groceries", "Dining Out", "Transport", "Travel", "Pets"], "the later load sent the change");

  // Another device adds Coffee.
  await server.client.from("settings").upsert({
    key: "ft_categories",
    value: JSON.stringify({
      expense: { Groceries: [], "Dining Out": [], Transport: [], Travel: [], Pets: [], Coffee: [] },
      income: { Salary: [], Other: [] },
    }),
  });
  const reloaded = await bootFinanceApp({ server, storage });

  const kept = ["Groceries", "Dining Out", "Transport", "Travel", "Pets", "Coffee"];
  assert.deepEqual(expenseNames(JSON.parse(server.setting("ft_categories"))), kept);
  assert.deepEqual(expenseNames(reloaded.categories()), kept);
});

test("categories: two changes in a row reach the server in the order they were made", async () => {
  const server = startingServer();
  const app = await bootFinanceApp({ server });
  const releaseFirst = server.holdNextUpsert();
  app.categoryAction({ action: "add-cat", type: "expense" });
  app.saveCategoryName("Pets");
  app.categoryAction({ action: "add-cat", type: "expense" });
  app.saveCategoryName("Fish");
  await app.settle();
  releaseFirst();
  await app.settle();

  assert.deepEqual(expenseNames(JSON.parse(server.setting("ft_categories"))),
    ["Groceries", "Dining Out", "Transport", "Travel", "Pets", "Fish"]);
});

// ---- Dates --------------------------------------------------------------------

// "Today" is the calendar date where the user is, not the UTC date.
for (const [place, tz, now, today] of [
  ["Manila, early on the 1st", "Asia/Manila", "2026-11-30T17:04:00Z", "2026-12-01"],
  ["New York, the evening of the 30th", "America/New_York", "2026-12-01T01:30:00Z", "2026-11-30"],
]) {
  test(`${place}: a new transaction is dated today and stays in the month on screen`, async () => {
    process.env.TZ = tz;
    const app = await bootFinanceApp({ server: startingServer(), now });
    app.click("add-txn-btn");
    assert.equal(app.el("txn-date").value, today);
    assert.equal(app.el("txn-month-filter").value, today.slice(0, 7));
  });
}
