import test from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import {
  MACRO_IDS,
  extractEstimateFields, toNestedMacros, partialNestedMacros,
  mergeItemPair, mergePhotoItems, foodsAlign,
} from "../supabase/functions/_shared/proxy-shapes.mjs";

const require = createRequire(import.meta.url);
const Macros = require("../www/macros.js");

test("MACRO_IDS stays in parity with the client's macros.js CATALOG", () => {
  // proxy-shapes.mjs hardcodes the id list server-side; www/macros.js CATALOG
  // is the client truth. This fails loudly if the two ever drift.
  const clientIds = Macros.CATALOG.map((m) => m.id);
  assert.deepEqual([...MACRO_IDS].sort(), [...clientIds].sort());
});

// Complete flat item helper: calories 100-200, protein 10-20 (+ overrides).
function flatItem(food, extra = {}) {
  return {
    food, portion: "1 serving",
    calories_lower: 100, calories_upper: 200,
    protein_lower: 10, protein_upper: 20,
    ...extra,
  };
}

// ---- M1: name guard (new behavior) ----

test("mergePhotoItems falls back to A-side whole when item names disagree", () => {
  const a = [flatItem("chicken adobo")];
  const b = [flatItem("pork sinigang", { calories_lower: 500, calories_upper: 700 })];
  const out = mergePhotoItems(a, b, 0.4);
  // A-side whole: A's values untouched, nothing averaged in from B.
  assert.equal(out.length, 1);
  assert.equal(out[0].food, "chicken adobo");
  assert.deepEqual(out[0].macros.calories, { low: 100, high: 200 });
});

test("name containment counts as aligned (merged, not fallback)", () => {
  const a = [flatItem("grilled chicken breast")];
  const b = [flatItem("chicken breast", { calories_lower: 200, calories_upper: 300 })];
  const out = mergePhotoItems(a, b, 0.4);
  // Averaged: (100+200)/2 .. (200+300)/2
  assert.deepEqual(out[0].macros.calories, { low: 150, high: 250 });
});

test("name comparison normalizes case and whitespace", () => {
  const a = [flatItem("  Rice ")];
  const b = [flatItem("rice", { calories_lower: 120, calories_upper: 220 })];
  const out = mergePhotoItems(a, b, 0.4);
  assert.deepEqual(out[0].macros.calories, { low: 110, high: 210 });
});

test("one misaligned pair rejects the whole index-wise merge", () => {
  const a = [flatItem("rice"), flatItem("fried egg")];
  const b = [flatItem("rice", { calories_lower: 120, calories_upper: 220 }), flatItem("banana")];
  const out = mergePhotoItems(a, b, 0.4);
  // Even the matching "rice" pair stays A-side: one bad pair means the two
  // models read different scenes.
  assert.deepEqual(out[0].macros.calories, { low: 100, high: 200 });
  assert.equal(out[1].food, "fried egg");
});

test("foodsAlign: equality, containment, and normalization", () => {
  assert.equal(foodsAlign([flatItem("rice")], [flatItem("RICE ")]), true);
  assert.equal(foodsAlign([flatItem("garlic rice")], [flatItem("rice")]), true);
  assert.equal(foodsAlign([flatItem("rice")], [flatItem("bread")]), false);
});

// ---- Characterization: moved shape helpers ----

test("extractEstimateFields returns null when a core range field is missing or non-finite", () => {
  assert.equal(extractEstimateFields({ calories_lower: 100, calories_upper: 200, protein_lower: 10 }), null);
  assert.equal(extractEstimateFields(flatItem("x", { protein_upper: "not a number" })), null);
});

test("extractEstimateFields keeps core ranges and complete flat extra macros only", () => {
  const est = extractEstimateFields(flatItem("x", { carbs_lower: 30, carbs_upper: 40, fat_lower: 5 }));
  assert.deepEqual(est, {
    cal_low: 100, cal_high: 200, pro_low: 10, pro_high: 20,
    macros: { carbs_lower: 30, carbs_upper: 40 }, // fat dropped: no upper
  });
});

test("toNestedMacros converts core + flat extras into the stored nested shape", () => {
  const nested = toNestedMacros({
    cal_low: 100, cal_high: 200, pro_low: 10, pro_high: 20,
    macros: { carbs_lower: 30, carbs_upper: 40 },
  });
  assert.deepEqual(nested, {
    calories: { low: 100, high: 200 },
    protein: { low: 10, high: 20 },
    carbs: { low: 30, high: 40 },
  });
});

test("partialNestedMacros keeps only complete pairs, over the full catalog", () => {
  const out = partialNestedMacros({
    calories_lower: 100, calories_upper: 200,
    sodium_lower: 300, sodium_upper: 400,
    fat_lower: 5, // no upper
  });
  assert.deepEqual(out, {
    calories: { low: 100, high: 200 },
    sodium: { low: 300, high: 400 },
  });
});

test("mergeItemPair averages agreeing complete items; food/portion from A", () => {
  const out = mergeItemPair(
    flatItem("rice"),
    flatItem("garlic rice", { calories_lower: 120, calories_upper: 220, protein_lower: 12, protein_upper: 22 }),
    0.4);
  assert.equal(out.food, "rice");
  assert.deepEqual(out.macros.calories, { low: 110, high: 210 });
  assert.deepEqual(out.macros.protein, { low: 11, high: 21 });
});

test("mergeItemPair with one incomplete side uses the complete side's ranges", () => {
  const out = mergeItemPair(
    { food: "soup", portion: "1 bowl" }, // no core fields
    flatItem("soup"),
    0.4);
  assert.equal(out.food, "soup");
  assert.deepEqual(out.macros.calories, { low: 100, high: 200 });
});

test("mergeItemPair with neither side complete keeps A's partial read", () => {
  const out = mergeItemPair(
    { food: "tea", portion: "1 cup", sugar_lower: 1, sugar_upper: 2 },
    { food: "tea", portion: "1 cup" },
    0.4);
  assert.deepEqual(out.macros, { sugar: { low: 1, high: 2 } });
});

test("mergePhotoItems: count mismatch falls back to A-side whole", () => {
  const out = mergePhotoItems([flatItem("rice"), flatItem("egg")], [flatItem("rice")], 0.4);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].macros.calories, { low: 100, high: 200 });
});

test("mergePhotoItems: empty B (but parsed) falls back to A-side whole", () => {
  const out = mergePhotoItems([flatItem("egg"), flatItem("rice")], [], 0.4);
  assert.equal(out.length, 2);
  assert.equal(out[0].food, "egg");
  assert.equal(out[1].food, "rice");
  assert.deepEqual(out[0].macros.calories, { low: 100, high: 200 });
});

test("mergePhotoItems: null/degraded arms use the surviving side, normalized", () => {
  const fromB = mergePhotoItems(null, [flatItem("  Egg  ")], 0.4);
  assert.equal(fromB[0].food, "Egg");
  assert.deepEqual(fromB[0].macros.calories, { low: 100, high: 200 });
  const fromA = mergePhotoItems([flatItem("egg")], null, 0.4);
  assert.equal(fromA[0].food, "egg");
  const emptyA = mergePhotoItems([], [flatItem("egg")], 0.4);
  assert.equal(emptyA[0].food, "egg");
});
