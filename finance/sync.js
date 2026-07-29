// Offline-resync planner for the Finance app. Pure logic, no I/O.
// After the owner signs in, rows created/edited while Supabase writes were
// failing (offline, or the 2026-07 owner-lock window) exist only in
// localStorage. planResync diffs a pre-init localStorage snapshot against the
// server's rows and says what to push up. Server-only rows are REPORTED, not
// deleted — absence locally can't be distinguished from a lost cache.
// UMD: usable as a browser global (window.FinanceSync) and a Node module.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FinanceSync = api;
})(typeof self !== "undefined" ? self : this, function () {
  // null/undefined/'' are the same "empty"; numbers compare by value so a
  // server "950.00" string equals a local 950.
  function norm(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(v))) {
      return String(Number(v));
    }
    return String(v);
  }

  function rowsDiffer(a, b, fields) {
    return fields.some((f) => norm(a[f]) !== norm(b[f]));
  }

  // serverRows/localRows: arrays of row objects with an `id`.
  // fields: which columns participate in the comparison (id/created_at never do).
  // Returns { inserts, updates, serverOnlyIds } — inserts/updates carry the
  // LOCAL version of the row (local is the user's latest state on this device).
  function planResync(serverRows, localRows, fields) {
    const serverById = new Map(serverRows.map((r) => [r.id, r]));
    const localIds = new Set(localRows.map((r) => r.id));
    const inserts = [];
    const updates = [];
    for (const row of localRows) {
      const serverRow = serverById.get(row.id);
      if (!serverRow) inserts.push(row);
      else if (rowsDiffer(serverRow, row, fields)) updates.push(row);
    }
    const serverOnlyIds = serverRows.filter((r) => !localIds.has(r.id)).map((r) => r.id);
    return { inserts, updates, serverOnlyIds };
  }

  return { planResync };
});
