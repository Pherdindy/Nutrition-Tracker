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
