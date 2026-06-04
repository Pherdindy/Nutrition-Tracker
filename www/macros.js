// Pure macro catalog + data-model helpers.
// UMD: usable as a browser global (window.Macros) and a Node module.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Macros = api;
})(typeof self !== "undefined" ? self : this, function () {
  const CATALOG = Object.freeze([
    { id: "calories", label: "Calories", unit: "kcal", locked: true, defaultOn: true },
    { id: "protein", label: "Protein", unit: "g", locked: true, defaultOn: true },
    { id: "carbs", label: "Carbs", unit: "g", locked: false, defaultOn: true },
    { id: "fat", label: "Fat", unit: "g", locked: false, defaultOn: true },
    { id: "fiber", label: "Fiber", unit: "g", locked: false, defaultOn: false },
    { id: "sugar", label: "Sugar", unit: "g", locked: false, defaultOn: false },
    { id: "saturatedFat", label: "Saturated fat", unit: "g", locked: false, defaultOn: false },
    { id: "sodium", label: "Sodium", unit: "mg", locked: false, defaultOn: false },
  ].map(Object.freeze));

  const byId = (id) => CATALOG.find((m) => m.id === id);
  const defaultEnabled = () => CATALOG.filter((m) => m.defaultOn).map((m) => m.id);

  function resolveEnabled(stored) {
    if (!Array.isArray(stored)) return defaultEnabled();
    const set = new Set(stored.filter((id) => byId(id)));
    CATALOG.forEach((m) => { if (m.locked) set.add(m.id); });
    return CATALOG.filter((m) => set.has(m.id)).map((m) => m.id); // catalog order
  }

  function getMacro(entry, id) {
    const m = entry && entry.macros && entry.macros[id];
    if (!m || m.low == null || m.high == null) return null;
    return { low: m.low, high: m.high };
  }

  function setMacro(entry, id, low, high) {
    if (!entry.macros) entry.macros = {};
    entry.macros[id] = { low: Number(low), high: Number(high) };
  }

  const round1 = (n) => Math.round(n * 10) / 10;

  function midpoint(v) {
    if (!v || v.low == null || v.high == null) return null;
    return round1((Number(v.low) + Number(v.high)) / 2);
  }

  function fmtNum(n) { return String(round1(n)).replace(/\.0$/, ""); }

  function formatMacro(v, format) {
    if (!v || v.low == null || v.high == null) return "—";
    if (format === "range") {
      const lo = fmtNum(v.low), hi = fmtNum(v.high);
      if (lo === hi) return lo;
      return lo + "–" + hi;
    }
    return fmtNum(midpoint(v)); // single (default)
  }

  function needsMigration(entry) {
    if (!entry) return false;
    if (entry.macros) return false;
    return ["calLow", "calHigh", "proLow", "proHigh"].some((k) => entry[k] != null);
  }

  function migrateEntry(entry) {
    if (!needsMigration(entry)) return entry;
    const out = { ...entry };
    out.macros = {};
    if (entry.calLow != null || entry.calHigh != null) out.macros.calories = { low: Number(entry.calLow) || 0, high: Number(entry.calHigh) || 0 };
    if (entry.proLow != null || entry.proHigh != null) out.macros.protein = { low: Number(entry.proLow) || 0, high: Number(entry.proHigh) || 0 };
    delete out.calLow; delete out.calHigh; delete out.proLow; delete out.proHigh;
    delete out.aiThoughtProcess;
    return out;
  }

  function blankEnabled(entry, enabled) {
    return (enabled || []).filter((id) => getMacro(entry, id) === null);
  }

  function sumMacro(entries, id) {
    return (entries || []).reduce((acc, e) => {
      const m = getMacro(e, id);
      if (m) { acc.low += Number(m.low) || 0; acc.high += Number(m.high) || 0; }
      return acc;
    }, { low: 0, high: 0 });
  }

  function macroFields(ids) {
    return (ids || []).flatMap((id) => [id + "_lower", id + "_upper"]);
  }

  function parseMacros(parsed, ids) {
    const out = {};
    (ids || []).forEach((id) => {
      const lo = parsed[id + "_lower"], hi = parsed[id + "_upper"];
      if (lo != null && hi != null) out[id] = { low: Number(lo), high: Number(hi) };
    });
    return out;
  }

  function spread(results, ids) {
    let worst = 0;
    for (const field of macroFields(ids)) {
      const vals = results.map((r) => r[field]).filter((v) => v != null);
      if (vals.length < 2) continue;
      const min = Math.min(...vals), max = Math.max(...vals);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (avg === 0) continue;
      const s = ((max - min) / avg) * 100;
      if (s > worst) worst = s;
    }
    return worst;
  }

  function averageEstimates(results, ids) {
    if (!results || !results.length) return {};
    const n = results.length, out = {};
    for (const field of macroFields(ids)) {
      out[field] = round1(results.reduce((s, r) => s + (Number(r[field]) || 0), 0) / n);
    }
    return out;
  }

  function promptFields(ids) {
    return (ids || []).map((id) => '  "' + id + '_lower": <number>,\n  "' + id + '_upper": <number>').join(",\n");
  }

  return {
    CATALOG,
    byId,
    defaultEnabled,
    resolveEnabled,
    getMacro,
    setMacro,
    midpoint,
    formatMacro,
    needsMigration,
    migrateEntry,
    blankEnabled,
    sumMacro,
    macroFields,
    parseMacros,
    spread,
    averageEstimates,
    promptFields,
  };
});
