// An entry's numbers: units, scaling, remembered foods, typed numbers, the AI's answer
// and how it is explained. Pure: no DOM, no network, no storage.
// UMD: usable as a browser global (window.Nutrition) and a Node module.
//
// The invariant behind all of it: `macros` is always the total for what was eaten.
(function (root, factory) {
  const Macros = (typeof require === "function") ? require("./macros.js") : root.Macros;
  const api = factory(Macros);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Nutrition = api;
})(typeof self !== "undefined" ? self : this, function (Macros) {
  const IDS = Macros.CATALOG.map((m) => m.id);

  const has = (macros, id) => Macros.getMacro({ macros }, id) !== null;
  const isMine = (macros, id) => has(macros, id) && !!macros[id].mine;
  const mineIds = (macros) => IDS.filter((id) => isMine(macros, id));
  const theirIds = (macros) => IDS.filter((id) => has(macros, id) && !macros[id].mine);
  const complete = (macros) => IDS.every((id) => has(macros, id));
  const pick = (macros, ids) => Object.fromEntries(ids.map((id) => [id, macros[id]]));
  const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
  const show = (n) => String(round(n, 1));

  // ---- Units and amounts ------------------------------------------------------

  const WEIGHT = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
  const VOLUME = { ml: 1, l: 1000, tsp: 4.92892159375, tbsp: 14.78676478125, cup: 236.5882365, "fl oz": 29.5735295625 };
  const ALSO = {
    gram: "g", gr: "g", gms: "g", kilo: "kg", kilogram: "kg", ounce: "oz", lbs: "lb", pound: "lb",
    milliliter: "ml", millilitre: "ml", cc: "ml", liter: "l", litre: "l", teaspoon: "tsp", tablespoon: "tbsp",
    floz: "fl oz", "fluid ounce": "fl oz", pcs: "pc", piece: "pc",
  };
  const isWeight = (text) => unit(text) in WEIGHT;

  function unit(text) {
    const s = String(text == null ? "" : text).trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
    const known = (u) => (u in WEIGHT || u in VOLUME ? u : ALSO[u]);
    const single = s.length > 3 && s.endsWith("s") && !s.endsWith("ss") ? s.slice(0, -1) : s;
    return known(s) || known(single) || single;
  }

  // How many times the amount `from` the amount `to` is; null if that cannot be known.
  // grams: the weight of `from`.
  function ratio(from, to, grams) {
    const a = Number(from.qty), b = Number(to.qty);
    if (!(a > 0) || !(b > 0)) return null;
    const ua = unit(from.unit), ub = unit(to.unit);
    if (ua === ub) return b / a;
    for (const table of [WEIGHT, VOLUME]) if (ua in table && ub in table) return (b * table[ub]) / (a * table[ua]);
    return grams > 0 && ub in WEIGHT ? (b * WEIGHT[ub]) / grams : null;
  }

  function unitsFor(amount, grams) {
    const own = unit(amount.unit);
    const others = [
      ...(own in VOLUME ? Object.keys(VOLUME) : []),
      ...(own in WEIGHT || grams > 0 ? Object.keys(WEIGHT) : []),
    ];
    return [String(amount.unit == null ? "" : amount.unit).trim(), ...others.filter((u) => u !== own)];
  }

  function scale(macros, k) {
    return Object.fromEntries(Object.entries(macros || {})
      .filter(([, m]) => m && m.low != null && m.high != null)
      .map(([id, m]) => [id, { ...m, low: round(m.low * k, 3), high: round(m.high * k, 3) }]));
  }

  const nameOf = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  const sameFood = (a, b) => nameOf(a) === nameOf(b);

  // ---- Remembering -------------------------------------------------------------

  const loggedAt = (e) => Date.parse(`${e.date}T${e.time || "00:00"}`) || 0;
  // When an entry's numbers were decided: typed, or answered by the AI.
  const decidedAt = (e) => (e.nutrition && e.nutrition.at) || loggedAt(e);

  // The past entry whose numbers a new log of this food starts from.
  function findRemembered(entries, food, amount) {
    let best = null;
    for (const e of entries) {
      const n = e.nutrition || {};
      if (!sameFood(e.food, food) || n.photo || !["done", "manual"].includes(e.estimateStatus)) continue;
      if (!complete(e.macros) && !mineIds(e.macros).length) continue;
      const k = ratio(e, amount, n.grams);
      if (k === null) continue;
      if (!best || (decidedAt(e) - decidedAt(best.entry) || e.id - best.entry.id) > 0) best = { entry: e, ratio: k };
    }
    return best;
  }

  function reuse({ entry, ratio: k }) {
    const { refresh, ...nutrition } = entry.nutrition || {};
    nutrition.at = decidedAt(entry);
    nutrition.from = nutrition.from || { id: entry.id, date: entry.date };
    if (nutrition.grams > 0) nutrition.grams = round(nutrition.grams * k, 1);
    return { macros: scale(entry.macros, k), nutrition };
  }

  function latestLog(entries, food) {
    return entries.filter((e) => sameFood(e.food, food))
      .reduce((a, b) => (!a || (loggedAt(b) - loggedAt(a) || b.id - a.id) > 0 ? b : a), null);
  }

  // ---- Saving --------------------------------------------------------------------

  function statusFor(macros, tracked, nutrition) {
    if (nutrition && nutrition.refresh) return "pending";
    if (!tracked.every((id) => has(macros, id))) return "pending";
    return tracked.every((id) => isMine(macros, id)) ? "manual" : "done";
  }

  // What a changed food or amount means for the numbers.
  function editPlan(before, after) {
    if (!sameFood(before.food, after.food)) return { kind: "lookup" };
    if (Number(before.qty) === Number(after.qty) && unit(before.unit) === unit(after.unit)) return { kind: "keep" };
    const k = ratio(before, after, before.nutrition && before.nutrition.grams);
    return k === null ? { kind: "lookup" } : { kind: "scale", ratio: k };
  }

  // The numbers an entry is saved with.
  //   before   the entry as it was, or null when adding
  //   after    { food, qty, unit }
  //   form     { typed: { id: number }, cleared: [id], basis, grams, askAgain } or null;
  //            typed numbers are for `basis`, or for the entry's own amount without one
  //   others   the other entries, to remember from
  function resolve({ before = null, after, form = null, others = [], tracked, now }) {
    const { typed = {}, cleared = [], basis = null, grams = null, askAgain = false } = form || {};
    let macros = before ? { ...(before.macros || {}) } : {};
    let n = before ? { ...(before.nutrition || {}) } : {};
    let newStatus = !before;

    const plan = before ? editPlan(before, after) : { kind: "lookup" };
    if (plan.kind === "scale") {
      macros = scale(macros, plan.ratio);
      if (n.grams > 0) n.grams = round(n.grams * plan.ratio, 1);
    } else if (plan.kind === "lookup") {
      const own = pick(macros, mineIds(macros));
      const found = findRemembered(others, after.food, after);
      if (found) {
        const got = reuse(found);
        macros = { ...got.macros, ...own };
        n = got.nutrition;
      } else {
        delete n.grams; // the weight of what it was before
        delete n.gramsMine;
        if (theirIds(macros).length) n.refresh = true; // the old numbers stay until the answer lands
      }
      newStatus = true;
    }

    const weighed = grams > 0 && n.grams > 0 && grams !== n.grams;
    if (weighed) {
      macros = { ...macros, ...scale(pick(macros, theirIds(macros)), grams / n.grams) };
      n.grams = grams;
      n.gramsMine = true;
    }

    const typedIds = Object.keys(typed);
    const per = (basis && ratio(after, basis, n.grams)) || 1; // how many times the entry the basis is
    for (const id of typedIds) {
      const total = round(typed[id] / per, 3);
      macros[id] = { low: total, high: total, mine: true };
    }
    for (const id of cleared) delete macros[id];
    if (typedIds.length) {
      if (per !== 1) n.basis = { qty: basis.qty, unit: basis.unit };
      else delete n.basis;
    }
    if (typedIds.length || weighed) { n.at = now; delete n.from; }
    if (typedIds.length || cleared.length) newStatus = true;

    if (askAgain) { n.refresh = true; newStatus = true; }
    else if (tracked.every((id) => isMine(macros, id))) delete n.refresh;

    return {
      macros,
      nutrition: Object.keys(n).length ? n : undefined,
      estimateStatus: newStatus ? statusFor(macros, tracked, n) : before.estimateStatus,
    };
  }

  // ---- The AI's answer -------------------------------------------------------------

  function needsAnswer(entry, tracked) {
    return !!(entry.nutrition && entry.nutrition.refresh) || !tracked.every((id) => has(entry.macros, id));
  }

  // The totals that will not be replaced, for the AI to keep the rest consistent with.
  function known(entry) {
    const refresh = entry.nutrition && entry.nutrition.refresh;
    const ids = refresh ? mineIds(entry.macros) : IDS.filter((id) => has(entry.macros, id));
    if (!ids.length) return undefined;
    return Object.fromEntries(ids.map((id) => [id, round((entry.macros[id].low + entry.macros[id].high) / 2, 2)]));
  }

  function assumedGrams(basis) {
    const weights = basis.map((b) => b.grams).filter((g) => g > 0);
    if (!weights.length) return null;
    const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
    return round(mean, mean < 10 ? 1 : 0);
  }

  function applyAnswer(entry, answer, { tracked, now }) {
    const before = entry.macros || {};
    if (!answer || !answer.macros) return { macros: before, nutrition: entry.nutrition, estimateStatus: "error" };
    const n = { ...(entry.nutrition || {}) };
    const basis = (answer.basis || []).slice(0, 2);
    const assumed = assumedGrams(basis);
    const ownWeight = n.gramsMine && n.grams > 0;
    const k = ownWeight && assumed ? n.grams / assumed : 1; // the answer is for the weight it assumed

    const macros = { ...before };
    for (const id of IDS) {
      const m = Macros.getMacro(answer, id);
      if (!m || isMine(before, id) || (has(before, id) && !n.refresh)) continue;
      macros[id] = { low: round(m.low * k, 3), high: round(m.high * k, 3) };
    }

    if (n.refresh) {
      for (const field of ["refresh", "from", "why", "how", "asked", "photo"]) delete n[field];
      if (!ownWeight) delete n.grams;
    }
    if (basis.length && !n.why) {
      n.why = basis;
      n.how = answer.how || (basis.length > 1 ? "average" : "one");
      n.asked = { qty: entry.qty, unit: entry.unit };
      if (!ownWeight && !(n.grams > 0) && assumed && !isWeight(entry.unit)) n.grams = assumed;
    }
    n.at = now;
    const status = statusFor(macros, tracked, null);
    return { macros, nutrition: n, estimateStatus: status === "pending" ? "error" : status };
  }

  return {
    unit, ratio, unitsFor, scale, sameFood,
    findRemembered, reuse, latestLog, statusFor, editPlan, resolve, needsAnswer, known, applyAnswer,
  };
});
