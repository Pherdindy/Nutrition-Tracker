// Offline-resync planner for the Finance app. Pure logic, no I/O.
// Rows created or edited while Supabase writes were failing exist only in
// localStorage. planResync compares a pre-init localStorage snapshot with the
// server's rows and says what to push up.
//
// It uploads only what this device knows the server never received. A saved
// copy that merely differs from the server is usually just old (another device
// has changed things since), and uploading it destroys the newer data: that
// happened on 2026-11-27, when every difference was still treated as an
// offline edit.
// Server-only rows are REPORTED, not deleted — absence locally can't be
// distinguished from a lost cache.
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

  // A new row is shown under a client-made id (Date.now()) until the server
  // stores it and assigns its own small sequential id. An id this large
  // therefore means the server never stored the row; a smaller id the server
  // no longer has means the row was deleted on another device.
  const FIRST_CLIENT_ID = 1e12;
  function isClientId(id) {
    return typeof id === "number" && id >= FIRST_CLIENT_ID;
  }

  // serverRows/localRows: arrays of row objects with an `id`.
  // fields: which columns participate in the comparison (id/created_at never do).
  // unsentIds: ids of the rows edited on this device whose edit the server has
  // not confirmed.
  // Returns { inserts, updates, serverOnlyIds } — inserts/updates carry the
  // LOCAL version of the row.
  function planResync(serverRows, localRows, fields, unsentIds) {
    const serverById = new Map(serverRows.map((r) => [r.id, r]));
    const localIds = new Set(localRows.map((r) => r.id));
    const unsent = new Set(unsentIds || []);
    const inserts = [];
    const updates = [];
    for (const row of localRows) {
      const serverRow = serverById.get(row.id);
      if (!serverRow) {
        if (isClientId(row.id)) inserts.push(row);
      } else if (unsent.has(row.id) && rowsDiffer(serverRow, row, fields)) {
        updates.push(row);
      }
    }
    const serverOnlyIds = serverRows.filter((r) => !localIds.has(r.id)).map((r) => r.id);
    return { inserts, updates, serverOnlyIds };
  }

  return { planResync, isClientId };
});
