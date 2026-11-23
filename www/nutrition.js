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
    if (nutrition.grams > 0) nutrition.grams = round(nutrition.grams * k, 3);
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

  // The user's numbers were typed per weight for something that is not measured by
  // weight, so they rest on what it weighs.
  function restOnWeight({ macros, nutrition: n, unit: u }) {
    return mineIds(macros).length > 0 && !!n && !!n.basis && isWeight(n.basis.unit) && !isWeight(u);
  }

  // The numbers an entry is saved with.
  //   before   the entry as it was, or null when adding
  //   after    { food, qty, unit }
  //   form     { typed: { id: number }, cleared: [id], basis, grams, askAgain } or null;
  //            typed numbers are for `basis`, or for the entry's own amount without one
  //   entries  all of them, to remember from
  function resolve({ before = null, after, form = null, entries = [], tracked, now }) {
    const { typed = {}, cleared = [], basis = null, grams = null, askAgain = false } = form || {};
    let macros = before ? { ...(before.macros || {}) } : {};
    let n = before ? { ...(before.nutrition || {}) } : {};
    let newStatus = !before;

    const plan = before ? editPlan(before, after) : { kind: "lookup" };
    if (plan.kind === "scale") {
      macros = scale(macros, plan.ratio);
      if (n.grams > 0) n.grams = round(n.grams * plan.ratio, 3);
    } else if (plan.kind === "lookup") {
      const own = pick(macros, mineIds(macros));
      const found = findRemembered(entries, after.food, after);
      if (found) {
        const got = reuse(found);
        macros = { ...got.macros, ...own };
        n = got.nutrition;
      } else {
        delete n.grams; // the weight of what it was before
        delete n.gramsMine;
        if (theirIds(macros).length) n.refresh = true; // the old numbers stay until the answer lands
      }
      if (Object.keys(own).length) delete n.basis; // they are totals now
      newStatus = true;
    }

    const weighed = grams > 0 && n.grams > 0 && grams !== n.grams;
    if (weighed) {
      const moved = restOnWeight({ macros, nutrition: n, unit: after.unit }) ? macros : pick(macros, theirIds(macros));
      macros = { ...macros, ...scale(moved, grams / n.grams) };
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
    const weightStands = n.grams > 0 && (n.gramsMine || restOnWeight(entry));
    const k = weightStands && assumed ? n.grams / assumed : 1; // the answer is for the weight it assumed

    const macros = { ...before };
    for (const id of IDS) {
      const m = Macros.getMacro(answer, id);
      if (!m || isMine(before, id) || (has(before, id) && !n.refresh)) continue;
      macros[id] = { low: round(m.low * k, 3), high: round(m.high * k, 3) };
    }

    if (n.refresh) {
      for (const field of ["refresh", "from", "why", "how", "asked", "photo"]) delete n[field];
      if (!weightStands) delete n.grams;
    }
    if (basis.length && !n.why) {
      n.why = basis;
      n.how = answer.how || (basis.length > 1 ? "average" : "one");
      n.asked = { qty: entry.qty, unit: entry.unit };
      if (!(n.grams > 0) && assumed && !isWeight(entry.unit)) n.grams = assumed;
    }
    n.at = now;
    const status = statusFor(macros, tracked, null);
    return { macros, nutrition: n, estimateStatus: status === "pending" ? "error" : status };
  }

  // ---- The form ----------------------------------------------------------------------

  // A typed number, or null. No commas: 1,5 and 1,200 would be guesses.
  function parseNumber(text) {
    const t = String(text).trim();
    if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    return Number(t) <= 99999 ? Number(t) : null;
  }

  // What is typed into an entry's form, on top of the numbers it would be saved with
  // otherwise (see resolve). All are shown for `basis`, a label's 56 g, or for the
  // entry's own amount until the user sets one.
  function createForm() {
    let saved = {}, savedGrams = null, amount = {}, allMove = false;
    let basis = null;    // { qty, unit }, once set
    let badBasis = null; // what its field says while that is not an amount
    let weightText = "";
    const typed = new Map(); // id -> text

    const weight = () => parseNumber(weightText) || null;
    const grams = () => (savedGrams && weight()) || savedGrams;
    const times = () => (basis ? ratio(amount, basis, grams()) : 1); // null if it does not convert

    function savedText(id) {
      if (!has(saved, id)) return "";
      const byWeight = savedGrams && weight() && (allMove || !isMine(saved, id)) ? weight() / savedGrams : 1;
      return show(((saved[id].low + saved[id].high) / 2) * byWeight * (times() || 1));
    }
    // Typing exactly what is saved changes nothing.
    const changed = () => [...typed].filter(([id, text]) => text.trim() !== savedText(id));
    const numbers = () => changed().map(([id, text]) => [id, parseNumber(text)]).filter(([, n]) => n !== null);

    return {
      rebase(entry) {
        saved = entry.macros || {};
        savedGrams = (entry.nutrition && entry.nutrition.grams) || null;
        amount = { qty: entry.qty, unit: entry.unit };
        allMove = restOnWeight(entry); // with the weight
      },
      text: (id) => (typed.has(id) ? typed.get(id) : savedText(id)),
      isMine: (id) => (changed().some(([other]) => other === id) ? parseNumber(typed.get(id)) !== null : isMine(saved, id)),
      type(id, text) {
        if (text.trim() === "" && !has(saved, id)) typed.delete(id); // still blank
        else typed.set(id, text);
      },

      basis() {
        const { qty, unit: u } = basis || amount;
        return { text: badBasis !== null ? badBasis : qty > 0 ? String(qty) : "", unit: u };
      },
      setBasis(text) {
        const qty = parseNumber(text);
        badBasis = qty > 0 ? null : text;
        if (qty > 0) basis = { qty, unit: (basis || amount).unit };
      },
      // The same amount in another unit: 4 pcs becomes 48 g.
      setBasisUnit(u) {
        const one = ratio(amount, { qty: 1, unit: u }, grams());
        const qty = times() && one ? Number((times() / one).toPrecision(4)) : (basis || amount).qty;
        basis = { qty, unit: u };
        badBasis = null;
      },
      units() {
        const units = unitsFor(amount, grams());
        return !basis || units.some((u) => unit(u) === unit(basis.unit)) ? units : [...units, basis.unit];
      },

      setWeight(text) { weightText = String(text); },

      errors() {
        const out = {};
        for (const [id, text] of changed()) {
          if (text.trim() !== "" && parseNumber(text) === null) out[id] = "Enter a number from 0 to 99,999, like 12.5";
        }
        if (weightText.trim() !== "" && !weight()) out.weight = "Enter the weight in grams, above 0";
        if (numbers().length && badBasis !== null) out.basis = "Enter an amount above 0";
        else if (numbers().length && times() === null) out.basis = `${sayAmount(basis)} does not convert to ${sayAmount(amount)}`;
        return out;
      },
      result: () => ({
        typed: Object.fromEntries(numbers()),
        cleared: changed().filter(([, text]) => text.trim() === "").map(([id]) => id),
        basis: basis ? { ...basis } : null,
        grams: savedGrams && weight() !== savedGrams ? weight() : null,
      }),
    };
  }

  // ---- The explanation -----------------------------------------------------------------

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayName = (date) => { const [, m, d] = date.split("-").map(Number); return `${MONTHS[m - 1]} ${d}`; };
  const sayAmount = ({ qty, unit: u }) => `${show(Number(qty))} ${u}`;

  function explainWeight(entry, n, estimates) {
    if (!(n.grams > 0) || isWeight(entry.unit)) return null;
    const each = Number(entry.qty) > 0 && Number(entry.qty) !== 1 ? ` (${show(n.grams / entry.qty)} g each)` : "";
    if (n.gramsMine) return `Your weight ${show(n.grams)} g${each}`;
    const weights = estimates.map((w) => w.grams).filter((g) => g > 0);
    const low = Math.min(...weights), high = Math.max(...weights);
    if (weights.length > 1 && (high - low) / high > 0.2) {
      const k = n.grams / (weights.reduce((a, b) => a + b, 0) / weights.length); // scaled since
      return `Assumed weight ${Math.round(low * k)}–${Math.round(high * k)} g, using ${show(n.grams)} g`;
    }
    return `Assumed weight ${show(n.grams)} g${each}`;
  }

  function explain(entry, today) {
    const n = entry.nutrition || {};
    const estimates = n.why || [];
    const lines = [];

    if (estimates.length) {
      const refs = [...new Set(estimates.map((w) => w.ref).filter(Boolean))];
      if (refs.length) lines.push(`Based on ${refs.join("; ")}`);
      const kcal = estimates.map((w) => w.kcal).filter((k) => k != null);
      const say = kcal.length === estimates.length ? `, ${kcal.join(" and ")} kcal` : "";
      lines.push(n.how === "both" ? `Two estimates${say}, disagreed, so the range covers both`
        : estimates.length > 1 ? `Two estimates${say}, averaged`
        : `One estimate${say}`);
      const k = n.asked ? ratio(n.asked, entry) : 1;
      if (k === null && n.refresh) lines.push(`For ${sayAmount(n.asked)}`); // not scaled: a new answer is due
      else if (k !== 1) lines.push(`For ${sayAmount(n.asked)}, scaled to ${sayAmount(entry)}`);
      lines.push(...new Set(estimates.map((w) => w.note).filter(Boolean)));
      lines.push("The AI works from what it knows about food. It does not look values up.");
    }

    const per = n.basis ? ratio(entry, n.basis, n.grams) : null;
    for (const id of mineIds(entry.macros)) {
      const m = Macros.byId(id), total = entry.macros[id].low;
      lines.push(`${m.label} ${show(per ? total * per : total)} ${m.unit}${per ? ` per ${sayAmount(n.basis)}` : ""} is your number`);
    }
    if (n.from) lines.push(`Numbers ${tag(entry, today)}`);
    if (n.photo) lines.push("Estimated from your photo");
    if (!lines.length && hasTheirs(entry)) lines.push("No explanation was saved for this entry. Ask AI again to get one.");
    return { weight: explainWeight(entry, n, estimates), lines };
  }

  function tag(entry, today) {
    const from = entry.nutrition && entry.nutrition.from;
    if (!from) return "";
    const year = from.date.slice(0, 4);
    return `from ${dayName(from.date)}${year === today.slice(0, 4) ? "" : `, ${year}`}`;
  }

  const hasTheirs = (entry) => theirIds(entry.macros).length > 0;

  return {
    unit, ratio, unitsFor, scale, sameFood,
    findRemembered, reuse, latestLog, statusFor, editPlan, resolve, needsAnswer, known, applyAnswer,
    createForm, explain, tag, hasTheirs,
  };
});
