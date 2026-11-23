// Row-level cloud sync: what changed on this device, kept until the server has it.
// UMD: usable as a browser global (window.Sync) and a Node module.
// No DOM, storage or Supabase here - app.js supplies those.
//
// The rule everything else follows: this device's list is never taken to be the
// whole table. A save sends the rows that changed, a delete names the row it
// deletes, and a row missing from the list means nothing.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Sync = api;
})(typeof self !== "undefined" ? self : this, function () {
  const ID_EPOCH = Date.UTC(2026, 0, 1);
  const ID_RANDOM = 2 ** 23;  // values per second
  const ID_SECONDS = 2 ** 30; // until 2060; together, every safe integer

  // Returns reserve(count = 1) -> the first of `count` consecutive new ids.
  // The second plus a random part, so two devices do not hand out the same id
  // (max + 1 did: the second save then overwrote the first one's row). A clock
  // outside 2026-2060 is clamped; ids always clear the old small ones.
  function createIdSource(now = Date.now, random = Math.random) {
    let last = 0;
    return function reserve(count = 1) {
      const second = Math.min(Math.max(Math.floor((now() - ID_EPOCH) / 1000), 0), ID_SECONDS - 3);
      const first = Math.max((second + 1) * ID_RANDOM + Math.floor(random() * ID_RANDOM), last + 1);
      last = first + count - 1;
      return first;
    };
  }

  // Reads a whole table page by page. getPage(from, to) -> { data, error, count }.
  // The server caps a page (1,000 rows by default) without saying so, so a short
  // page is not the end; reaching the total count, or an empty page, is.
  async function fetchAll(getPage, pageSize = 1000) {
    const rows = [];
    for (;;) {
      const { data, error, count } = await getPage(rows.length, rows.length + pageSize - 1);
      if (error) throw error;
      rows.push(...data);
      if (!data.length || (count != null && rows.length >= count)) return rows;
    }
  }

  // Calls take(entry, key) for each entry that is new or differs from `known`
  // (key -> signature) and then updates `known`, so if take throws the change
  // still counts as untaken. Signatures are strings because callers edit entries
  // in place.
  function takeChanges(known, entries, keyOf, signatureOf, take) {
    for (const entry of entries) {
      const key = keyOf(entry), signature = signatureOf(entry);
      if (known.get(key) === signature) continue;
      take(entry, key);
      known.set(key, signature);
    }
  }

  const matches = (row, match) => Object.entries(match).every(([field, value]) => row[field] === value);

  // The list as it should look on this device: what was loaded, with this
  // device's unsent changes applied on top.
  function overlay(entries, ops, keyOf, fromRow = (row) => row, applyUpdate = (entry) => entry) {
    const out = new Map(entries.map((entry) => [String(keyOf(entry)), entry]));
    for (const [key, op] of Object.entries(ops || {})) {
      if (op.row === null) out.delete(key);
      else if (op.match) { if (out.has(key)) out.set(key, applyUpdate(out.get(key), op)); }
      else if (!(op.ensure && out.has(key))) out.set(key, fromRow(op.row));
    }
    return [...out.values()];
  }

  const RETRY_MS = [5000, 15000, 60000, 300000];

  // The server examined the change and said no, so sending it again unchanged is
  // pointless. Anything else (offline, expired session, overload) may pass later.
  function isRefusal(status) {
    return status >= 400 && status < 500 && ![401, 408, 425, 429].includes(status);
  }

  const KINDS = ["delete", "upsert", "ensure", "update"];
  const kindOf = (op) => (op.row === null ? "delete" : op.match ? "update" : op.ensure ? "ensure" : "upsert");
  const newToken = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

  // Unsent changes, at most one per row (the latest):
  //   { [table]: { [key]: { t: token, row: {...} | null, ensure?: true, match?: {...} } } }
  // row null = delete. ensure = auto-created: add it if absent, never overwrite.
  // match = change these fields while the row still looks like that, never create it.
  //
  //   owner()                     current account id, or null when signed out
  //   list(uid)                   all that is stored, in the shape above (asked for
  //                               every time: other tabs share the storage)
  //   set(uid, table, key, op), remove(uid, table, key)
  //                               store or drop one change, touching no other: with
  //                               a combined value, two tabs saving at the same
  //                               moment could drop each other's changes
  //   send(uid, table, kind, items) -> { error, status }
  //                               items are rows; keys for "delete"; for "update" a
  //                               single { key, row, match }. Must be sent as that
  //                               account or not at all
  //   lock(uid, fn)               runs fn while no other tab is sending
  //   schedule(fn, ms), cancel(handle), log(...)
  function createOutbox({ owner, list, set, remove, send, lock, schedule, cancel, log }) {
    const refusedTokens = new Set(); // not worth resending this session
    let flushing = null; // promise while a flush runs
    let again = false;   // something was asked of it since it last looked
    let timer = null;
    let failures = 0;

    function load(uid) {
      try { return list(uid) || {}; } catch (e) { return {}; }
    }

    function put(table, key, row, { ensure = false } = {}) {
      const uid = owner();
      if (!uid) return;
      const unsent = (load(uid)[table] || {})[key];
      if (ensure && unsent && unsent.row !== null) return; // it exists already, as someone's own change
      const op = { t: newToken(), row };
      if (ensure && !unsent) op.ensure = true; // after an unsent delete it is a replacement
      set(uid, table, key, op);
    }

    // A change the app makes by itself, such as a finished estimate. The user's own
    // changes win: it never replaces a delete, nor touches a row that has since
    // become something else - here or, through `match`, on the server.
    function update(table, key, fields, match) {
      const uid = owner();
      if (!uid) return;
      const unsent = (load(uid)[table] || {})[key];
      if (!unsent || unsent.match) set(uid, table, key, { t: newToken(), row: fields, match });
      else if (unsent.row !== null && matches(unsent.row, match)) {
        set(uid, table, key, { ...unsent, t: newToken(), row: { ...unsent.row, ...fields } });
      }
    }

    // Clears what was delivered, except rows changed again since (new token).
    function settle(uid, table, entries) {
      const ops = load(uid)[table] || {};
      for (const [key, op] of entries) if (ops[key] && ops[key].t === op.t) remove(uid, table, key);
    }

    // false = could not be sent now. A refused row counts as dealt with: it stays
    // in the outbox but must not hold back the rest.
    async function deliver(uid, table, kind, entries) {
      if (owner() !== uid) return true; // signed out meanwhile
      if (kind === "update" && entries.length > 1) return deliverEach(uid, table, kind, entries);
      const res = await send(uid, table, kind, entries.map(([key, op]) =>
        (kind === "delete" ? key : kind === "update" ? { key, row: op.row, match: op.match } : op.row)));
      if (!res.error) { settle(uid, table, entries); return true; }
      if (!isRefusal(res.status)) return false;
      if (entries.length === 1) {
        refusedTokens.add(entries[0][1].t);
        log(`the server refused a change to ${table} ${entries[0][0]}`, res.error);
        return true;
      }
      return deliverEach(uid, table, kind, entries);
    }

    async function deliverEach(uid, table, kind, entries) {
      for (const entry of entries) if (!(await deliver(uid, table, kind, [entry]))) return false;
      return true;
    }

    async function deliverAll(uid) {
      for (const table of Object.keys(load(uid))) {
        for (const kind of KINDS) {
          const entries = Object.entries(load(uid)[table] || {})
            .filter(([, op]) => kindOf(op) === kind && !refusedTokens.has(op.t));
          if (entries.length && !(await deliver(uid, table, kind, entries))) return false;
        }
      }
      return true;
    }

    const hasWork = (uid) => Object.values(load(uid))
      .some((ops) => Object.values(ops).some((op) => !refusedTokens.has(op.t)));

    async function drain() {
      await null; // so `flushing` is set before this can finish
      let ok = true;
      try {
        while (again && ok) {
          again = false;
          const uid = owner();
          if (uid && hasWork(uid)) ok = await lock(uid, () => deliverAll(uid));
        }
      } catch (error) {
        log("sync failed", error);
        ok = false;
      } finally {
        flushing = null;
      }
      if (timer !== null && ok) { cancel(timer); timer = null; }
      if (ok) failures = 0;
      else if (timer === null) {
        timer = schedule(() => { timer = null; flush(); }, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
        failures++;
      }
    }

    // Sends everything unsent. Never rejects; resolves once everything stored
    // before the call has been tried.
    function flush() {
      again = true;
      if (!flushing) flushing = drain();
      return flushing;
    }

    const pending = (table) => {
      const uid = owner();
      return uid ? load(uid)[table] || {} : {};
    };
    function count() {
      const uid = owner();
      return uid ? Object.values(load(uid)).reduce((n, ops) => n + Object.keys(ops).length, 0) : 0;
    }

    return { put, update, flush, pending, count };
  }

  return { createIdSource, fetchAll, takeChanges, matches, overlay, createOutbox };
});
