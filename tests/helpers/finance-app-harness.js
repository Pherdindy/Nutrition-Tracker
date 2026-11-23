// Runs the real finance/app.js (a browser script) inside a Node vm context,
// against a minimal fake DOM and an in-memory fake Supabase. Nothing here
// talks to the network. Used by tests/finance-app.test.js.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FINANCE_DIR = path.join(__dirname, "..", "..", "finance");
const SOURCES = ["sync.js", "app.js"].map((name) => ({
  name,
  code: fs.readFileSync(path.join(FINANCE_DIR, name), "utf8"),
}));

const clone = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---- Fake Supabase ---------------------------------------------------------
// Mirrors the behaviours the app depends on: the server assigns its own small
// sequential id on insert, and an update/delete whose filter matches no row
// succeeds silently ({ error: null }) exactly like PostgREST does.
function createFakeServer({ transactions = [], settings = {}, nextId = 1000 } = {}) {
  const db = { transactions: clone(transactions), settings: { ...settings } };
  let running = 0;
  let insertGate = null;
  let online = true;

  const matches = (row, filters) => filters.every(([col, val]) => row[col] === val);

  function execute(q) {
    if (!online) return { data: null, error: { message: "Failed to fetch" } };
    if (q.table === "settings") {
      if (q.op === "select") {
        const key = (q.filters.find(([col]) => col === "key") || [])[1];
        return { data: key in db.settings ? { value: db.settings[key] } : null, error: null };
      }
      if (q.op === "upsert") {
        db.settings[q.payload.key] = q.payload.value;
        return { data: null, error: null };
      }
    }
    if (q.table === "transactions") {
      if (q.op === "select") return { data: clone(db.transactions), error: null };
      if (q.op === "insert") {
        const row = { ...clone(q.payload), id: nextId++, created_at: "2026-01-01T00:00:00+00:00" };
        db.transactions.push(row);
        return { data: [clone(row)], error: null };
      }
      if (q.op === "update") {
        // The whole payload is applied, id included, as the real server would.
        db.transactions.filter((r) => matches(r, q.filters)).forEach((r) => Object.assign(r, clone(q.payload)));
        return { data: null, error: null };
      }
      if (q.op === "delete") {
        db.transactions = db.transactions.filter((r) => !matches(r, q.filters));
        return { data: null, error: null };
      }
    }
    throw new Error(`fake Supabase: unsupported ${q.op} on ${q.table}`);
  }

  async function run(q) {
    // A held insert models a slow request: the test acts while it is in flight.
    if (q.op === "insert" && insertGate) await insertGate.promise;
    running++;
    try {
      await tick();
      return execute(q);
    } finally {
      running--;
    }
  }

  function from(table) {
    const q = { table, op: "select", filters: [], payload: null };
    const builder = {
      select() { return builder; },
      insert(row) { q.op = "insert"; q.payload = row; return builder; },
      update(row) { q.op = "update"; q.payload = row; return builder; },
      upsert(row) { q.op = "upsert"; q.payload = row; return builder; },
      delete() { q.op = "delete"; return builder; },
      eq(col, val) { q.filters.push([col, val]); return builder; },
      order() { return builder; },
      maybeSingle() { return builder; },
      then(resolve, reject) { return run(q).then(resolve, reject); },
    };
    return builder;
  }

  const client = {
    from,
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "owner" } } } }),
      onAuthStateChange() {},
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    },
  };

  return {
    client,
    rows: () => clone(db.transactions),
    setting: (key) => db.settings[key],
    isIdle: () => running === 0,
    setOnline(value) { online = value; },
    // Inserts wait until the returned function is called.
    holdInserts() {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      insertGate = { promise };
      return () => { insertGate = null; release(); };
    },
  };
}

// ---- Fake storage / DOM ----------------------------------------------------

function createStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeAttr = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

class FakeElement {
  constructor() {
    this.value = "";
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.found = new Map();
    this._html = "";
    this._text = "";
    const classes = new Set();
    this.classList = {
      add: (c) => { classes.add(c); },
      remove: (c) => { classes.delete(c); },
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    this._html = String(html);
    this.children = [];
    // A <select> shows its first option once its options are replaced.
    const firstOption = /<option value="([^"]*)"/.exec(this._html);
    if (firstOption) this.value = unescapeAttr(firstOption[1]);
  }
  get textContent() { return this._text; }
  set textContent(text) {
    this._text = String(text);
    this._html = escapeText(this._text);
    this.children = [];
  }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  querySelector(selector) {
    if (!this.found.has(selector)) this.found.set(selector, new FakeElement());
    return this.found.get(selector);
  }
  focus() {}
}

const MODALS = ["txn-modal", "delete-modal", "manage-cats-modal", "cat-modal", "expense-detail-modal"];

// ---- Boot ------------------------------------------------------------------

// Loads the app as a page load would and waits for startup to finish.
// Pass the same `server` and `storage` again to model a reload.
async function bootFinanceApp({ server = createFakeServer(), storage = createStorage() } = {}) {
  const byId = new Map();
  const el = (id) => {
    if (!byId.has(id)) byId.set(id, new FakeElement());
    return byId.get(id);
  };
  // Initial state that index.html declares in markup.
  MODALS.forEach((id) => el(id).classList.add("hidden"));
  el("summary-range-type").value = "monthly";
  el("bd-type-filter").value = "expense";

  const documentEl = new FakeElement();
  const errors = []; // what the app sent to console.error (failed background writes)
  const sandbox = {
    document: {
      getElementById: el,
      querySelector: (selector) => documentEl.querySelector(selector),
      querySelectorAll: () => [],
      createElement: () => new FakeElement(),
      addEventListener() {},
    },
    localStorage: storage,
    console: { log() {}, warn() {}, error: (...args) => { errors.push(args.map(String).join(" ")); } },
    setTimeout,
    clearTimeout,
    alert: (message) => { throw new Error(`unexpected alert: ${message}`); },
    confirm: () => true,
    supabase: { createClient: () => server.client },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const { name, code } of SOURCES) vm.runInContext(code, context, { filename: `finance/${name}` });

  const run = (code) => vm.runInContext(code, context);
  const fire = (id, type, event = {}) => (el(id).listeners[type] || []).forEach((fn) => fn(event));

  // Resolves once every request the app has issued (other than held inserts)
  // has completed and its continuation has run.
  async function settle() {
    for (let quiet = 0; quiet < 3;) {
      await tick();
      quiet = server.isIdle() ? quiet + 1 : 0;
    }
  }

  await settle();
  if (!run("_cache.ready")) throw new Error("finance app did not finish starting");

  return {
    server,
    storage,
    el,
    settle,
    errors,
    click: (id) => fire(id, "click"),
    // What the browser does when an inline onclick="…" button is pressed.
    press: (inlineHandler) => run(inlineHandler),
    isOpen: (id) => !el(id).classList.contains("hidden"),
    transactions: () => JSON.parse(run("JSON.stringify(loadTransactions())")),
    categories: () => JSON.parse(run("JSON.stringify(loadCategories())")),

    // Fills in and saves the "+ New Transaction" dialog.
    addTransaction({ description, amount, category = "Groceries" }) {
      fire("add-txn-btn", "click");
      el("txn-date").value = `${el("txn-month-filter").value}-15`;
      el("txn-category").value = category;
      el("txn-description").value = description;
      el("txn-amount").value = String(amount);
      fire("txn-save", "click");
    },

    // The inline handler of a row's Edit / Del button as currently rendered,
    // e.g. "openEditModal(1763600000000)".
    rowButton(description, handlerName) {
      const row = el("txn-tbody").children.find((tr) => tr.innerHTML.includes(`<td>${description}</td>`));
      if (!row) throw new Error(`no rendered row for "${description}"`);
      const found = new RegExp(`onclick="(${handlerName}\\(\\d+\\))"`).exec(row.innerHTML);
      if (!found) throw new Error(`row "${description}" has no ${handlerName} button`);
      return found[1];
    },

    // A click on a [data-action] button inside the Manage Categories dialog.
    categoryAction(dataset) {
      fire("manage-cats-modal", "click", { target: { closest: () => ({ dataset }) } });
    },

    // Types a name into the category name dialog and saves it.
    saveCategoryName(name) {
      el("cat-modal-input").value = name;
      fire("cat-modal-save", "click");
    },
  };
}

module.exports = { bootFinanceApp, createFakeServer, createStorage };
