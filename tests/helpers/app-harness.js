// Runs the real www/app.js (a browser script) inside a Node vm context, against
// a minimal fake DOM and an in-memory fake Supabase that enforces what
// production enforces: primary/unique keys, NOT NULL, whole-statement failure,
// per-user rows and the 1,000-row read cap. Nothing here talks to the network.
//
// A "device" is one browser: its own localStorage, its own connection. Boot two
// devices against one server to model a phone and a laptop; boot the same
// device twice to model a relaunch.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WWW = path.join(__dirname, "..", "..", "www");
// Exactly the scripts index.html loads, in its order (minus the vendored client).
const SOURCES = [...fs.readFileSync(path.join(WWW, "index.html"), "utf8").matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((m) => m[1])
  .filter((src) => !src.startsWith("vendor/"))
  .map((name) => ({ name, code: fs.readFileSync(path.join(WWW, name), "utf8") }));

const OWNER = "owner-uid-0001";
const clone = (v) => JSON.parse(JSON.stringify(v));
const sorted = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const sameJson = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b)); // jsonb equality
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---- Fake Supabase ---------------------------------------------------------

// Constraints as in production; every key below is implicitly per user.
const SCHEMA = {
  food_entries: {
    key: ["id"], unique: [["id"]], defaults: {},
    required: ["id", "date", "time", "food", "qty", "unit"],
    columns: ["id", "date", "time", "food", "qty", "unit", "cal_low", "cal_high", "pro_low", "pro_high", "ai_thought_process", "macros", "estimate_status", "nutrition"],
  },
  days: {
    key: ["id"], unique: [["id"], ["date"]], defaults: { incomplete: false },
    required: ["id", "date", "age", "weight", "activity", "deficit", "protein_target_low", "protein_target_high"],
  },
  profile: { key: [], unique: [[]], defaults: {}, required: [] },
  settings: { key: ["key"], unique: [["key"]], defaults: {}, required: ["key"] },
  assessments: { key: ["timestamp"], unique: [], defaults: {}, required: [] },
};
const READ_CAP = 1000;

function createFakeServer({ food = [], days = [], profile = null, readCap = READ_CAP } = {}) {
  const own = (row) => ({ user_id: OWNER, ...clone(row) });
  const db = {
    food_entries: food.map(own),
    days: days.map(own),
    profile: profile ? [own(profile)] : [],
    settings: [],
    assessments: [],
  };
  let running = 0;
  let writeGate = null;
  const writes = []; // every write that reached the server: { table, op, rows|filters, error }
  const server = {
    reject: null, // (table, row) => true: the database refuses this row
    afterSelect: null, // async (table, device): runs after a read was answered, before the app gets it
    aiCalls: [],
    ai: () => ({ data: { macros: { calories: { low: 100, high: 110 }, protein: { low: 10, high: 11 }, carbs: { low: 5, high: 6 }, fat: { low: 2, high: 3 } } }, error: null }),
    usage: { pct_used: 0, plan: "owner", exhausted: false },
  };

  const same = (a, b, cols) => a.user_id === b.user_id && cols.every((c) => a[c] === b[c]);
  const fail = (status, code, message) => ({ data: null, error: { code, message }, status, count: null });

  // Filter values travel as text in the URL; the database converts them.
  function filterFn(filters) {
    return (row) => filters.every(([kind, col, val]) => {
      if (kind === "eq") return row[col] && typeof row[col] === "object" ? sameJson(row[col], JSON.parse(val)) : String(row[col]) === String(val);
      if (kind === "gte") return row[col] >= val;
      if (kind === "in") return val.map(String).includes(String(row[col]));
      if (kind === "not.in") return !val.includes(row[col]);
      throw new Error(`fake Supabase: unsupported filter ${kind}`);
    });
  }

  function upsert(uid, q) {
    // No session: the request runs as anon and row security refuses the insert.
    if (!uid) return fail(401, "42501", "new row violates row-level security policy");
    const spec = SCHEMA[q.table];
    const target = q.options.onConflict ? q.options.onConflict.split(",").map((c) => c.trim()).filter((c) => c !== "user_id") : spec.key;
    const incoming = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(clone);
    const next = clone(db[q.table]); // applied only if every row is accepted
    const touched = [];
    for (const payload of incoming) {
      const unknown = spec.columns && Object.keys(payload).find((c) => !spec.columns.includes(c));
      if (unknown) return fail(400, "PGRST204", `Could not find the '${unknown}' column of '${q.table}' in the schema cache`);
      const row = { user_id: uid, ...spec.defaults, ...payload };
      const missing = spec.required.find((c) => row[c] === null || row[c] === undefined);
      if (missing) return fail(400, "23502", `null value in column "${missing}" of relation "${q.table}" violates not-null constraint`);
      if (server.reject && server.reject(q.table, row)) return fail(400, "22000", "row refused");
      const hit = next.find((r) => same(r, row, target));
      if (hit) {
        if (touched.includes(hit)) return fail(500, "21000", "ON CONFLICT DO UPDATE command cannot affect row a second time");
        if (!q.options.ignoreDuplicates) Object.assign(hit, payload);
        touched.push(hit);
      } else {
        next.push(row);
        touched.push(row);
      }
      const current = hit || row;
      if (hit && q.options.ignoreDuplicates) continue;
      const clash = spec.unique.find((cols) => next.some((r) => r !== current && same(r, current, cols)));
      if (clash) return fail(409, "23505", `duplicate key value violates unique constraint on (user_id, ${clash.join(", ")})`);
    }
    db[q.table] = next;
    return { data: null, error: null, status: 201, count: null };
  }

  function execute(uid, q) {
    const mine = (r) => r.user_id === uid;
    if (q.op === "select") {
      let rows = db[q.table].filter(mine).filter(filterFn(q.filters));
      for (const [col, ascending] of [...q.orders].reverse()) {
        rows = rows.map((r, i) => [r, i]).sort(([a, i], [b, j]) => (a[col] === b[col] ? i - j : (a[col] < b[col] ? -1 : 1) * (ascending ? 1 : -1))).map(([r]) => r);
      }
      const count = q.options.count === "exact" ? rows.length : null;
      const [from, to] = q.range || [0, Infinity];
      const page = rows.slice(from, Math.min(to + 1, from + readCap)).map(clone);
      if (q.single) return { data: page[0] || null, error: null, status: 200, count };
      return { data: page, error: null, status: 200, count };
    }
    let result;
    if (q.op === "upsert") result = upsert(uid, q);
    else if (q.op === "insert") { db[q.table].push({ user_id: uid, ...clone(q.payload) }); result = { data: null, error: null, status: 201, count: null }; }
    else if (q.op === "update") {
      const hit = filterFn(q.filters);
      db[q.table].filter((r) => mine(r) && hit(r)).forEach((r) => Object.assign(r, clone(q.payload)));
      result = { data: null, error: null, status: 204, count: null };
    } else if (q.op === "delete") {
      const hit = filterFn(q.filters);
      db[q.table] = db[q.table].filter((r) => !(mine(r) && hit(r)));
      result = { data: null, error: null, status: 204, count: null };
    } else throw new Error(`fake Supabase: unsupported ${q.op} on ${q.table}`);
    writes.push({ table: q.table, op: q.op, rows: q.payload ? clone(Array.isArray(q.payload) ? q.payload : [q.payload]) : null, filters: q.filters, options: q.options, error: result.error });
    return result;
  }

  // Who the server sees: the token set on the request if there is one, else the
  // session at the moment it is sent, else (like supabase-js) nobody. Nobody can
  // read or delete anything, and is not told so.
  async function identity(device, uid, q) {
    const header = q.headers.Authorization;
    if (header) return header.replace("Bearer token:", "");
    const { data } = await device.getSession(uid);
    return data.session ? data.session.user.id : null;
  }

  async function run(device, bootUid, q) {
    running++;
    try {
      if (q.op !== "select" && writeGate) {
        running--; // a held write is "in flight", not "busy"
        await writeGate.promise;
        running++;
      }
      await tick();
      if (!device.online) return fail(0, "", "TypeError: Failed to fetch");
      const result = execute(await identity(device, bootUid, q), q);
      if (q.op === "select" && server.afterSelect) {
        running--; // the answer is on its way: the server itself is idle
        try { await server.afterSelect(q.table, device); } finally { running++; }
      }
      return result;
    } finally {
      running--;
    }
  }

  function connect(device, uid) {
    const from = (table) => {
      const q = { table, op: "select", filters: [], orders: [], options: {}, payload: null, range: null, single: false, headers: {} };
      const b = {
        select(_cols, options) { q.options = options || {}; return b; },
        insert(row) { q.op = "insert"; q.payload = row; return b; },
        upsert(rows, options) { q.op = "upsert"; q.payload = rows; q.options = options || {}; return b; },
        update(row) { q.op = "update"; q.payload = row; return b; },
        delete() { q.op = "delete"; return b; },
        eq(col, val) { q.filters.push(["eq", col, val]); return b; },
        gte(col, val) { q.filters.push(["gte", col, val]); return b; },
        in(col, vals) { q.filters.push(["in", col, [...vals]]); return b; },
        not(col, op, list) {
          if (op !== "in") throw new Error(`fake Supabase: unsupported not.${op}`);
          q.filters.push(["not.in", col, list.replace(/[()]/g, "").split(",").map((s) => (/^-?\d+$/.test(s) ? Number(s) : s))]);
          return b;
        },
        order(col, { ascending = true } = {}) { q.orders.push([col, ascending]); return b; },
        range(a, z) { q.range = [a, z]; return b; },
        maybeSingle() { q.single = true; return b; },
        setHeader(name, value) { q.headers[name] = value; return b; },
        then(resolve, reject) { return run(device, uid, q).then(resolve, reject); },
      };
      return b;
    };
    return {
      from,
      rpc: async () => { await tick(); return device.online ? { data: clone(server.usage), error: null } : { data: null, error: { message: "Failed to fetch" } }; },
      functions: {
        invoke: async (_name, { body }) => {
          await tick();
          if (!device.online) return { data: null, error: { message: "Failed to fetch" } };
          server.aiCalls.push(body.payload.food);
          return server.ai(body);
        },
      },
      auth: {
        getSession: async () => device.getSession(uid),
        onAuthStateChange(fn) { device.onAuth = fn; },
        // Like supabase-js: without a connection it reports an error and keeps the session.
        signOut: async () => {
          await tick();
          if (!device.online) return { error: { message: "Failed to fetch" } };
          if (device.onAuth) device.onAuth("SIGNED_OUT", null);
          return { error: null };
        },
        startAutoRefresh() {}, stopAutoRefresh() {},
      },
    };
  }

  return Object.assign(server, {
    connect,
    writes,
    isIdle: () => running === 0,
    food: () => clone(db.food_entries),
    days: () => clone(db.days),
    foods: () => db.food_entries.map((r) => r.food).sort(),
    // Writes wait until the returned function is called.
    holdWrites() {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      writeGate = { promise };
      return () => { writeGate = null; release(); };
    },
  });
}

// ---- Device: localStorage + connection --------------------------------------

function createDevice({ online = true } = {}) {
  const map = new Map([["nt_tutorial_seen", "1"]]);
  const device = {
    online,
    full: false, // localStorage refuses writes, as when over quota
    // What supabase-js knows; tests replace it to model a lapsed or changed session.
    getSession: async (uid) => ({ data: { session: { access_token: `token:${uid}`, user: { id: uid, email: "owner@example.com" } } } }),
    storage: {
      get length() { return map.size; },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem(key, value) {
        if (device.full) throw new Error("QuotaExceededError");
        map.set(key, String(value));
      },
      removeItem: (key) => { map.delete(key); },
    },
    keys: () => [...map.keys()].sort(),
  };
  return device;
}

// ---- Fake DOM ----------------------------------------------------------------

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

class FakeElement {
  constructor() {
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.className = "";
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
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
  set innerHTML(html) { this._html = String(html); this.children = []; }
  get textContent() { return this._text; }
  set textContent(text) { this._text = String(text); this._html = escapeText(this._text); this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelector(selector) {
    if (!this.found.has(selector)) this.found.set(selector, new FakeElement());
    return this.found.get(selector);
  }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains() { return false; }
  remove() {}
  focus() {}
  scrollIntoView() {}
}

// ---- Boot ----------------------------------------------------------------------

// freezeClock: the app sees one fixed instant and no randomness.
// now: the app's clock stands still at this instant (an ISO string); the time
// zone is process.env.TZ.
async function bootApp({ server = createFakeServer(), device = createDevice(), uid = OWNER, confirm = () => true, freezeClock = false, now = null } = {}) {
  const byId = new Map();
  const el = (id) => {
    if (!byId.has(id)) byId.set(id, new FakeElement());
    return byId.get(id);
  };
  // Initial state index.html declares in markup.
  ["food-modal", "day-modal", "photo-modal", "paywall-modal", "auth-view", "onboarding-view", "tutorial-view"].forEach((id) => el(id).classList.add("hidden"));
  el("assessment-period").value = "week";

  const documentEl = new FakeElement();
  const domReady = [];
  const windowListeners = {};
  const documentListeners = {};
  const timers = [];
  const errors = [];
  const confirms = [];
  const alerts = [];
  const body = new FakeElement();
  let reloads = 0;

  const sandbox = {
    document: {
      getElementById: el,
      querySelector: (selector) => documentEl.querySelector(selector),
      querySelectorAll: (selector) => (selector === "#batch-items .batch-item-row" ? el("batch-items").children : []),
      createElement: () => new FakeElement(),
      addEventListener(type, fn) {
        if (type === "DOMContentLoaded") domReady.push(fn);
        else (documentListeners[type] = documentListeners[type] || []).push(fn);
      },
      documentElement: new FakeElement(),
      body,
      activeElement: null,
      visibilityState: "visible",
    },
    localStorage: device.storage,
    console: {
      log() {}, warn() {},
      error: (...args) => { errors.push(args.map((a) => (a && a.message) || (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")); },
    },
    // Timers run only when the test says so (see runTimers), so a pending retry
    // never keeps the process alive and nothing depends on wall-clock time.
    setTimeout: (fn, ms = 0) => { timers.push({ fn, ms, id: timers.length + 1 }); return timers.length; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.fn = null; },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener(type, fn) { (windowListeners[type] = windowListeners[type] || []).push(fn); },
    location: { origin: "http://localhost:8080", reload() { reloads++; } },
    navigator: {},
    URL,
    alert: (message) => { alerts.push(message); },
    confirm: (message) => { confirms.push(message); return confirm(message); },
    supabase: { createClient: () => server.connect(device, uid) },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  if (now) {
    vm.runInContext(`{
      const RealDate = Date, at = ${Date.parse(now)};
      Date = class extends RealDate {
        constructor(...args) { if (args.length) super(...args); else super(at); }
        static now() { return at; }
      };
    }`, context);
  }
  if (freezeClock) vm.runInContext("Date.now = () => 1795400000000; Math.random = () => 0;", context);
  for (const { name, code } of SOURCES) vm.runInContext(code, context, { filename: `www/${name}` });

  const run = (code) => vm.runInContext(code, context);
  const fire = (id, type, event = {}) => (el(id).listeners[type] || []).forEach((fn) => fn({ preventDefault() {}, ...event }));

  // Resolves once every request the app has issued (other than held writes) has
  // completed and its continuation has run.
  async function settle() {
    for (let quiet = 0; quiet < 6;) {
      await tick();
      quiet = server.isIdle() ? quiet + 1 : 0;
    }
  }

  for (const fn of domReady) fn();
  for (let i = 0; i < 500 && !run("_cache.ready"); i++) await tick();
  if (!run("_cache.ready")) throw new Error("app did not finish starting");
  await settle();

  const app = {
    server, device, el, run, fire, settle, errors, confirms, alerts,
    busy: () => body.classList.contains("loading"),
    reloads: () => reloads,
    isOpen: (id) => !el(id).classList.contains("hidden"),
    food: () => JSON.parse(run("JSON.stringify(loadFoodEntries())")),
    days: () => JSON.parse(run("JSON.stringify(loadDayEntries())")),
    foods: () => app.food().map((e) => e.food).sort(),
    entry: (name) => app.food().find((e) => e.food === name),
    timers: () => timers.filter((t) => t.fn),

    // Fires every timer currently pending (not ones they schedule in turn).
    async runTimers() {
      const due = timers.splice(0).filter((t) => t.fn);
      due.forEach((t) => t.fn());
      await settle();
    },
    async windowEvent(type) {
      (windowListeners[type] || []).forEach((fn) => fn({ type }));
      (documentListeners[type] || []).forEach((fn) => fn({ type }));
      await settle();
    },

    // Fills in and submits the Add Food form.
    addFood(food, { date = "2026-11-23", time = "08:00", qty = 1, unit = "pc" } = {}) {
      fire("add-food-btn", "click");
      Object.assign(el("food-date"), { value: date });
      el("food-time").value = time;
      el("food-name").value = food;
      el("food-qty").value = String(qty);
      el("food-unit").value = unit;
      fire("food-form", "submit");
    },
    // Opens an entry's Edit form, applies the given field values and submits.
    editFood(food, fields) {
      run(`editFood(${app.entry(food).id})`);
      for (const [key, value] of Object.entries(fields)) el(`food-${key}`).value = String(value);
      fire("food-form", "submit");
    },
    deleteFood(food) { run(`deleteFood(${app.entry(food).id})`); },
    addBatch(names, { date = "2026-11-23", time = "08:00" } = {}) {
      fire("add-food-btn", "click");
      el("batch-date").value = date;
      el("batch-time").value = time;
      while (el("batch-items").children.length < names.length) fire("batch-add-row", "click");
      names.forEach((name, i) => {
        const row = el("batch-items").children[i];
        row.querySelector(".batch-food").value = name;
        row.querySelector(".batch-qty").value = "1";
        row.querySelector(".batch-unit").value = "pc";
      });
      fire("batch-save", "click");
    },
    addPhotoItems(names) {
      run(`_photoItems = ${JSON.stringify(names.map((food) => ({ food, portion: "1 plate", macros: { calories: { low: 1, high: 2 }, protein: { low: 1, high: 2 } } })))}`);
      fire("photo-confirm", "click");
    },
    editDay(date, fields) {
      run(`editDay(${app.days().find((d) => d.date === date).id})`);
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value === "boolean") el(`day-${key}`).checked = value;
        else el(`day-${key}`).value = String(value);
      }
      fire("day-form", "submit");
    },
    deleteDay(date) { run(`deleteDay(${app.days().find((d) => d.date === date).id})`); },
    signOut: () => run("signOut()"),
  };
  return app;
}

module.exports = { bootApp, createFakeServer, createDevice, OWNER };
