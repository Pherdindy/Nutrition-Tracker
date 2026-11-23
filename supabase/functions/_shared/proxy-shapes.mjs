// Pure response-shape helpers shared by the ai-proxy Edge Function (Deno) and
// the node --test suite. No dependencies beyond metering.mjs, no I/O — keep it
// that way. Field extraction and item normalization are ported from the pre-B
// client (www/macros.js parseMacros shape, www/photo.js parseVisionResponse).

import { mergeEstimates } from "./metering.mjs";

// www/macros.js CATALOG order.
export const MACRO_IDS = ["calories", "protein", "carbs", "fat", "fiber", "sugar", "saturatedFat", "sodium"];
export const OTHER_MACRO_IDS = MACRO_IDS.filter((id) => id !== "calories" && id !== "protein");

// Pull { cal_low, cal_high, pro_low, pro_high, macros } out of a flat
// <id>_lower/<id>_upper object (a top-level estimate or one photo item).
// macros stays FLAT here (what mergeEstimates averages per field). Returns
// null when any of the four core range fields is missing or non-finite — a
// partial estimate must degrade to the single-model path, never poison the
// merge with NaN.
export function extractEstimateFields(o) {
  const cal_low = Number(o.calories_lower), cal_high = Number(o.calories_upper);
  const pro_low = Number(o.protein_lower), pro_high = Number(o.protein_upper);
  if (![cal_low, cal_high, pro_low, pro_high].every(Number.isFinite)) return null;
  const macros = {};
  for (const id of OTHER_MACRO_IDS) {
    const lo = Number(o[id + "_lower"]), hi = Number(o[id + "_upper"]);
    if (Number.isFinite(lo) && Number.isFinite(hi)) { macros[id + "_lower"] = lo; macros[id + "_upper"] = hi; }
  }
  return { cal_low, cal_high, pro_low, pro_high, macros };
}

// One line of text that a jsonb column accepts (no control characters, no half of a
// character), at most max characters long and then cut at a word.
function line(text, max) {
  if (typeof text !== "string") return "";
  const chars = [...text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()].filter((c) => !/^[\ud800-\udfff]$/.test(c));
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max - 1).join("").replace(/[\s,;:(]+\S{0,30}$/, "") + "…";
}

// What one model says its estimate is based on.
export function extractBasis(o) {
  const grams = typeof o.total_grams === "number" || typeof o.total_grams === "string" ? Number(o.total_grams) : NaN;
  return {
    ref: line(o.reference, 120),
    note: line(o.reasoning, 200),
    grams: Number.isFinite(grams) && grams > 0 ? Math.round(grams * 10) / 10 : null,
    kcal: Math.round((Number(o.calories_lower) + Number(o.calories_upper)) / 2),
  };
}

// The totals a client says it already has, for the prompt: "protein 22 g, sodium 300 mg".
const MACRO_NAMES = { saturatedFat: "saturated fat" };
const MACRO_UNITS = { calories: "kcal", sodium: "mg" };
export function knownTotals(known) {
  return MACRO_IDS
    .filter((id) => known && typeof known === "object" && Number.isFinite(known[id]) && known[id] >= 0)
    .map((id) => `${MACRO_NAMES[id] ?? id} ${known[id]} ${MACRO_UNITS[id] ?? "g"}`)
    .join(", ");
}

// What a client knows the whole quantity weighs, for the prompt.
export function weightNote(grams) {
  return Number.isFinite(grams) && grams > 0 ? ` (weighs ${grams} g in total)` : "";
}

// The duration a client gives, or 0.
export function minutesGiven(minutes) {
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 ? minutes : 0;
}

// What one model says about a workout, or null if it cannot be right. given: the minutes
// the user gave, which are a fact.
export function extractWorkout(o, given = 0) {
  if (!o || typeof o !== "object") return null;
  const number = (x) => (typeof x === "number" || (typeof x === "string" && x.trim()) ? Number(x) : NaN);
  const mets = [number(o.met_lower), number(o.met_upper)], minutes = given || number(o.minutes);
  if (!mets.every((m) => m >= 1 && m <= 25) || !(minutes > 0 && minutes <= 1440)) return null;
  const met_low = Math.min(...mets), met_high = Math.max(...mets);
  return {
    met_low, met_high, minutes,
    basis: { ref: line(o.reference, 120), note: line(o.reasoning, 200), met: Math.round((met_low + met_high) * 5) / 10, minutes },
  };
}

// Convert a merged/parsed estimate (flat macros) into the nested
// { id: { low, high } } shape the client stores (Macros.parseMacros shape).
export function toNestedMacros(est) {
  const nested = {
    calories: { low: est.cal_low, high: est.cal_high },
    protein: { low: est.pro_low, high: est.pro_high },
  };
  for (const id of OTHER_MACRO_IDS) {
    const lo = est.macros && est.macros[id + "_lower"], hi = est.macros && est.macros[id + "_upper"];
    if (lo != null && hi != null) nested[id] = { low: Number(lo), high: Number(hi) };
  }
  return nested;
}

// Ported from www/photo.js parseVisionResponse() per-item normalization.
export function itemFoodPortion(it) {
  return {
    food: String(it.food || "").trim() || "Unknown item",
    portion: String(it.portion || "").trim() || "1 serving",
  };
}

// Macros.parseMacros over the full catalog (tolerates missing fields).
export function partialNestedMacros(o) {
  const out = {};
  for (const id of MACRO_IDS) {
    const lo = o[id + "_lower"], hi = o[id + "_upper"];
    if (lo != null && hi != null) out[id] = { low: Number(lo), high: Number(hi) };
  }
  return out;
}

// Merge one aligned item pair: both complete -> mergeEstimates on the ranges;
// one complete -> use it; neither -> keep A's partial read (client tolerates gaps).
export function mergeItemPair(a, b, widenThreshold) {
  const { food, portion } = itemFoodPortion(a);
  const ea = extractEstimateFields(a), eb = extractEstimateFields(b);
  if (ea && eb) return { food, portion, macros: toNestedMacros(mergeEstimates(ea, eb, widenThreshold)) };
  const e = ea ?? eb;
  if (e) return { food, portion, macros: toNestedMacros(e) };
  return { food, portion, macros: partialNestedMacros(a) };
}

// Name guard: index-wise merging only makes sense when both models saw the
// same items. Foods align when, normalized (lowercase/trim), each index pair
// is equal or one name contains the other ("grilled chicken breast" vs
// "chicken breast"). One misaligned pair rejects the whole index-wise merge.
function normFood(it) {
  return String((it && it.food) || "").trim().toLowerCase();
}
export function foodsAlign(itemsA, itemsB) {
  for (let i = 0; i < itemsA.length; i++) {
    const a = normFood(itemsA[i]), b = normFood(itemsB[i]);
    if (!(a === b || a.includes(b) || b.includes(a))) return false;
  }
  return true;
}

// Photo pair merge: when both models read the same number of items AND the
// item names align, merge each aligned item's ranges with the shared
// mergeEstimates rule; when their reads disagree structurally (different item
// counts or names), keep the A-side read whole — mixing two different scene
// interpretations item-by-item would be nonsense.
export function mergePhotoItems(itemsA, itemsB, widenThreshold) {
  if (!itemsA) return (itemsB || []).map((b) => ({ ...itemFoodPortion(b), macros: partialNestedMacros(b) }));
  if (!itemsB) return itemsA.map((a) => ({ ...itemFoodPortion(a), macros: partialNestedMacros(a) }));
  if (itemsA.length === 0) return itemsB.map((b) => ({ ...itemFoodPortion(b), macros: partialNestedMacros(b) }));
  if (itemsB.length === 0 || itemsA.length !== itemsB.length || !foodsAlign(itemsA, itemsB)) {
    return itemsA.map((a) => ({ ...itemFoodPortion(a), macros: partialNestedMacros(a) }));
  }
  return itemsA.map((a, i) => mergeItemPair(a, itemsB[i], widenThreshold));
}
