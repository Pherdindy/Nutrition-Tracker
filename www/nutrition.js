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

  return { unit, ratio, unitsFor, scale, sameFood };
});
