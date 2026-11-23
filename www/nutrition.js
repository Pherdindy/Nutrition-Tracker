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
  const tidy = (n) => Number(n.toPrecision(6)); // as stored: no noise, and scaling back loses nothing
  const show = (n) => String(Math.abs(n) < 100 ? Number(round(n, 4).toPrecision(3)) : round(n, 1)); // 0.345, 15.7, 707.5

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
      .map(([id, m]) => [id, { ...m, low: tidy(m.low * k), high: tidy(m.high * k) }]));
  }

  const nameOf = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  const sameFood = (a, b) => nameOf(a) === nameOf(b);

  // ---- Remembering -------------------------------------------------------------

  const loggedAt = (e) => Date.parse(`${e.date}T${e.time || "00:00"}`) || 0;
  // When an entry's numbers were decided: typed, or answered by the AI.
  const decidedAt = (e) => (e.nutrition && e.nutrition.at) || loggedAt(e);

  // The most recently decided comes first. Copies were decided when their source was: one
  // whose gaps were filled since comes before it, any other after it.
  const isCopy = (e) => !!(e.nutrition && e.nutrition.from);
  const outranks = (a, b) => (decidedAt(a) - decidedAt(b) || complete(a.macros) - complete(b.macros)
    || isCopy(b) - isCopy(a) || a.id - b.id) > 0;

  // The past entry whose numbers a new log of this food starts from.
  function findRemembered(entries, food, amount) {
    let best = null;
    for (const e of entries) {
      const n = e.nutrition || {};
      if (!sameFood(e.food, food) || n.photo || n.stale) continue;
      if (!complete(e.macros) && !mineIds(e.macros).length) continue;
      const k = ratio(e, amount, n.grams);
      if (k !== null && (!best || outranks(e, best.entry))) best = { entry: e, ratio: k };
    }
    return best;
  }

  function reuse({ entry, ratio: k }) {
    const { refresh, stale, ...nutrition } = entry.nutrition || {};
    nutrition.at = decidedAt(entry);
    nutrition.from = nutrition.from || { id: entry.id, date: entry.date };
    if (nutrition.grams > 0) nutrition.grams = tidy(nutrition.grams * k);
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

  // What a changed food or amount means for the numbers: how many times the old amount
  // the new one is (null if that cannot be known), and whether they are another food's
  // or amount's now.
  function editPlan(before, after) {
    const sameAmount = Number(before.qty) === Number(after.qty) && unit(before.unit) === unit(after.unit);
    const k = sameAmount ? 1 : ratio(before, after, before.nutrition && before.nutrition.grams);
    return { ratio: k, lookup: k === null || !sameFood(before.food, after.food) };
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

    const plan = before ? editPlan(before, after) : { ratio: 1, lookup: true };
    if (plan.ratio !== null && plan.ratio !== 1) {
      macros = scale(macros, plan.ratio);
      if (n.grams > 0) n.grams = tidy(n.grams * plan.ratio);
      if (!IDS.some((id) => has(macros, id))) newStatus = true; // nothing to scale: ask for this amount
    }
    if (plan.lookup) {
      const own = pick(macros, mineIds(macros));
      const found = askAgain ? null : findRemembered(entries, after.food, after);
      if (found) {
        const got = reuse(found);
        macros = { ...got.macros, ...own };
        n = got.nutrition;
      } else {
        delete n.grams; // the weight of what it was before
        delete n.gramsMine;
        if (theirIds(macros).length) n.refresh = n.stale = true; // what it was before: shown until the answer lands
      }
      if (Object.keys(own).length) delete n.basis; // they are totals now
      newStatus = true;
    }
    if (isWeight(after.unit)) { // the amount says it
      delete n.grams;
      delete n.gramsMine;
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
      const total = tidy(typed[id] / per);
      macros[id] = { low: total, high: total, mine: true };
    }
    for (const id of cleared) delete macros[id];
    if (typedIds.length) {
      if (per !== 1) n.basis = { qty: basis.qty, unit: basis.unit };
      else delete n.basis;
    }
    if (typedIds.length || cleared.length || weighed) { n.at = now; delete n.from; }
    if (typedIds.length || cleared.length) newStatus = true;

    if (askAgain) { n.refresh = true; newStatus = true; }
    else if (tracked.every((id) => isMine(macros, id))) { // nobody will be asked
      if (n.stale) macros = pick(macros, mineIds(macros));
      delete n.refresh;
      delete n.stale;
    }

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

  // What it weighs, for the AI to go by: the user said so, or typed numbers rest on it.
  function knownWeight(entry) {
    const n = entry.nutrition || {};
    return n.grams > 0 && !isWeight(entry.unit) && (n.gramsMine || restOnWeight(entry)) ? n.grams : undefined;
  }

  function assumedGrams(basis) {
    const weights = basis.map((b) => b.grams).filter((g) => g > 0);
    if (!weights.length) return null;
    const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
    return round(mean, mean < 10 ? 1 : 0);
  }

  // What became of asking the AI: its answer, or none. noCredit: it was not even asked.
  function applyAnswer(entry, answer, { tracked, now, noCredit = false }) {
    const before = entry.macros || {};
    const n = { ...(entry.nutrition || {}) };
    const done = (macros) => {
      const status = statusFor(macros, tracked, null);
      return { macros, nutrition: n, estimateStatus: status === "pending" ? "error" : status };
    };
    if (!answer || !answer.macros) {
      // Asking again is then taken back; but a renamed entry has another food's numbers.
      if (!noCredit || !n.refresh || n.stale) return { macros: before, nutrition: entry.nutrition, estimateStatus: "error" };
      delete n.refresh;
      return done(before);
    }

    const macros = n.refresh ? pick(before, mineIds(before)) : { ...before };
    for (const id of IDS) {
      const m = Macros.getMacro(answer, id);
      if (m && !has(macros, id)) macros[id] = { low: tidy(m.low), high: tidy(m.high) };
    }

    if (n.refresh || !n.at) n.at = now; // filling gaps does not make the other numbers newer
    if (n.refresh) {
      for (const field of ["refresh", "stale", "from", "why", "how", "asked", "photo"]) delete n[field];
      if (!knownWeight(entry)) delete n.grams;
    }
    const basis = (answer.basis || []).slice(0, 2);
    if (basis.length && !n.why) {
      n.why = basis;
      n.how = answer.how || (basis.length > 1 ? "average" : "one");
      n.asked = { qty: entry.qty, unit: entry.unit };
      const assumed = assumedGrams(basis);
      if (assumed && !(n.grams > 0) && !isWeight(entry.unit)) n.grams = assumed;
    }
    return done(macros);
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
  // entry's own amount until the user sets one. What is typed is the user's, and stays
  // as typed, for whatever amount is shown.
  function createForm() {
    let saved = {}, savedGrams = null, amount = {}, allMove = false, what = null;
    let basis = null;    // { qty, unit }, once set
    let badBasis = null; // what its field says while that is not an amount
    let weightText = "";
    const typed = new Map(); // id -> text

    const weight = () => parseNumber(weightText) || null;
    const grams = () => (savedGrams && weight()) || savedGrams;
    const times = () => (basis ? ratio(amount, basis, grams()) : 1); // null if it does not convert
    const numbers = () => [...typed].map(([id, text]) => [id, parseNumber(text)]).filter(([, n]) => n !== null);

    function savedText(id) {
      if (!has(saved, id)) return "";
      const byWeight = savedGrams && weight() && (allMove || !isMine(saved, id)) ? weight() / savedGrams : 1;
      return show(((saved[id].low + saved[id].high) / 2) * byWeight * (times() || 1));
    }

    return {
      rebase(entry) {
        saved = entry.macros || {};
        savedGrams = (!isWeight(entry.unit) && entry.nutrition && entry.nutrition.grams) || null;
        amount = { qty: entry.qty, unit: entry.unit };
        allMove = restOnWeight(entry); // with the weight
        const now = JSON.stringify([entry.food, entry.qty, entry.unit]);
        if (now !== what || !savedGrams) weightText = ""; // it was typed for something else
        what = now;
      },
      // kept: the numbers it will have; one that is not among them shows as blank
      text: (id, kept = saved) => (typed.has(id) ? typed.get(id) : has(kept, id) ? savedText(id) : ""),
      isMine: (id) => (typed.has(id) ? parseNumber(typed.get(id)) !== null : isMine(saved, id)),
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
        const qty = one ? Number(((times() || 1) / one).toPrecision(4)) : (basis || amount).qty;
        basis = { qty, unit: u };
        badBasis = null;
      },
      units() {
        const units = unitsFor(amount, grams());
        return !basis || units.some((u) => unit(u) === unit(basis.unit)) ? units : [...units, basis.unit];
      },

      weight: () => weightText,
      setWeight(text) { weightText = String(text); },

      errors() {
        const out = {};
        for (const [id, text] of typed) {
          if (text.trim() !== "" && parseNumber(text) === null) out[id] = "Enter a number from 0 to 99,999, like 12.5";
        }
        if (weightText.trim() !== "" && !weight()) out.weight = "Enter the weight in grams, above 0";
        if (numbers().length && badBasis !== null) out.basis = "Enter an amount above 0";
        else if (numbers().length && times() === null) out.basis = `${sayAmount(basis)} does not convert to ${sayAmount(amount)}`;
        return out;
      },
      result: () => ({
        typed: Object.fromEntries(numbers()),
        cleared: [...typed].filter(([id, text]) => text.trim() === "" && has(saved, id)).map(([id]) => id),
        basis: basis ? { ...basis } : null,
        grams: savedGrams && weight() !== savedGrams ? weight() : null,
      }),
    };
  }

  // ---- The explanation -----------------------------------------------------------------

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayName = (date) => { const [, m, d] = date.split("-").map(Number); return `${MONTHS[m - 1]} ${d}`; };
  const sayAmount = ({ qty, unit: u }) => `${Number(qty)} ${u}`;

  function explainWeight(entry, n, estimates) {
    if (!(n.grams > 0) || isWeight(entry.unit)) return null;
    const each = Number(entry.qty) > 0 && Number(entry.qty) !== 1 ? ` (${show(n.grams / entry.qty)} g each)` : "";
    if (n.gramsMine) return `Your weight ${show(n.grams)} g${each}`;
    const weights = estimates.map((w) => w.grams).filter((g) => g > 0);
    const low = Math.min(...weights), high = Math.max(...weights);
    if (weights.length > 1 && (high - low) / high > 0.2) {
      const k = n.grams / (weights.reduce((a, b) => a + b, 0) / weights.length); // scaled since
      return `Assumed weight ${show(low * k)}–${show(high * k)} g, using ${show(n.grams)} g`;
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
    findRemembered, reuse, latestLog, statusFor, resolve, needsAnswer, known, knownWeight, applyAnswer,
    createForm, explain, tag, hasTheirs,
  };
});
