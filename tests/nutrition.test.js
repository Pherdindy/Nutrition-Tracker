const test = require("node:test");
const assert = require("node:assert");
const N = require("../www/nutrition.js");

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} is not ${b}`);
const amount = (qty, unit) => ({ qty, unit });

// ---- units ---------------------------------------------------------------------

for (const [canonical, spellings] of Object.entries({
  g: ["g", "G", " g. ", "gram", "Grams", "gr", "gms"],
  kg: ["kg", "kilo", "kilos", "kilogram", "kilograms"],
  oz: ["oz", "ounce", "ounces"],
  lb: ["lb", "lbs", "pound", "pounds"],
  ml: ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "cc"],
  l: ["l", "liter", "liters", "litre", "litres"],
  tsp: ["tsp", "tsps", "teaspoon", "teaspoons"],
  tbsp: ["tbsp", "tbsps", "tablespoon", "tablespoons"],
  cup: ["cup", "cups", "Cups"],
  "fl oz": ["fl oz", "fl  oz", "floz", "fluid ounce", "fluid ounces"],
  pc: ["pc", "pcs", "pcs.", "piece", "pieces"],
  scoop: ["scoop", "scoops"],
  slice: ["slice", "slices"],
  order: ["order", "orders"],
  glass: ["glass"],
  bus: ["bus"],
})) {
  test(`every spelling of ${canonical} is the same unit`, () => {
    for (const s of spellings) assert.equal(N.unit(s), canonical, s);
  });
}

test("amounts in the same unit, however spelled", () => {
  assert.equal(N.ratio(amount(4, "pcs"), amount(6, "pieces")), 1.5);
  assert.equal(N.ratio(amount(1, "order"), amount(2, "orders")), 2);
});

test("weights convert to weights and volumes to volumes", () => {
  assert.equal(N.ratio(amount(80, "g"), amount(0.1, "kg")), 1.25);
  near(N.ratio(amount(1, "lb"), amount(16, "oz")), 1);
  near(N.ratio(amount(1, "cup"), amount(8, "fl oz")), 1);
  near(N.ratio(amount(1, "tbsp"), amount(3, "tsp")), 1);
});

test("pieces convert to a weight only when their weight is known", () => {
  assert.equal(N.ratio(amount(4, "pcs"), amount(56, "g")), null);
  near(N.ratio(amount(4, "pcs"), amount(56, "g"), 48), 56 / 48);
  near(N.ratio(amount(1, "cup"), amount(79, "g"), 158), 0.5);
  assert.equal(N.ratio(amount(80, "g"), amount(4, "pcs"), 80), null, "the weight of the new amount is not known");
});

test("nothing is guessed", () => {
  assert.equal(N.ratio(amount(1, "cup"), amount(100, "g")), null);
  assert.equal(N.ratio(amount(1, "plate"), amount(1, "bowl")), null);
  for (const bad of [0, -1, NaN, undefined]) {
    assert.equal(N.ratio(amount(bad, "g"), amount(1, "g")), null);
    assert.equal(N.ratio(amount(1, "g"), amount(bad, "g")), null);
  }
});

test("the units on offer are only those that convert, the entry's own first", () => {
  assert.deepEqual(N.unitsFor({ unit: "pcs" }), ["pcs"]);
  assert.deepEqual(N.unitsFor({ unit: "pcs" }, 48), ["pcs", "g", "kg", "oz", "lb"]);
  assert.deepEqual(N.unitsFor({ unit: "grams" }), ["grams", "kg", "oz", "lb"]);
  assert.deepEqual(N.unitsFor({ unit: "cups" }), ["cups", "ml", "l", "tsp", "tbsp", "fl oz"]);
  assert.deepEqual(N.unitsFor({ unit: "cups" }, 158).slice(-4), ["g", "kg", "oz", "lb"]);
});

test("scaling keeps ranges and marks, to six digits", () => {
  const macros = { calories: { low: 100, high: 110 }, protein: { low: 11, high: 11, mine: true } };
  assert.deepEqual(N.scale(macros, 80 / 56), { calories: { low: 142.857, high: 157.143 }, protein: { low: 15.7143, high: 15.7143, mine: true } });
  assert.deepEqual(macros.calories, { low: 100, high: 110 }, "the original is untouched");
  assert.deepEqual(N.scale(undefined, 2), {});
});

test("an amount saved wrong and corrected later loses next to nothing", () => {
  for (const was of [0.5, 0.04, 1234.5]) for (const k of [1000, 3, 37854.1]) {
    const back = N.scale(N.scale({ fiber: { low: was, high: was } }, 1 / k), k).fiber.low;
    assert.ok(Math.abs(back - was) / was < 1e-5, `${was} / ${k} x ${k} = ${back}`);
  }
});

test("food names match regardless of case and spacing", () => {
  assert.equal(N.sameFood(" Cooked  white Rice", "cooked white rice"), true);
  assert.equal(N.sameFood("Sardines", "Sardines in oil"), false);
});

// ---- remembering ---------------------------------------------------------------

const full = (kcal = 100, over = {}) => ({
  calories: { low: kcal, high: kcal }, protein: { low: 10, high: 12 }, carbs: { low: 1, high: 2 }, fat: { low: 3, high: 4 },
  fiber: { low: 0, high: 1 }, sugar: { low: 0, high: 1 }, saturatedFat: { low: 1, high: 1 }, sodium: { low: 200, high: 300 }, ...over,
});
const three = (kcal) => ({ calories: { low: kcal, high: kcal }, protein: { low: 10, high: 10 }, carbs: { low: 1, high: 1 } });
const mine = (n) => ({ low: n, high: n, mine: true });
const TRACKED = ["calories", "protein", "carbs"];
const NOW = 1795500000000;
const entry = (over = {}) => ({ id: 1, date: "2026-11-20", time: "08:00", food: "Sardines", qty: 4, unit: "pcs", macros: full(), estimateStatus: "done", ...over });

test("a past entry is remembered by name and a convertible amount", () => {
  const e = entry();
  assert.deepEqual(N.findRemembered([e], " sardines ", amount(6, "pieces")), { entry: e, ratio: 1.5 });
  assert.equal(N.findRemembered([e], "Tuna", amount(4, "pcs")), null);
  assert.equal(N.findRemembered([e], "Sardines", amount(80, "g")), null, "weight of 4 pcs unknown");
  near(N.findRemembered([entry({ nutrition: { grams: 48 } })], "Sardines", amount(80, "g")).ratio, 80 / 48);
});

test("only entries with all eight nutrients, or a typed number, are remembered", () => {
  const found = (over) => !!N.findRemembered([entry(over)], "Sardines", amount(4, "pcs"));
  for (const status of ["done", "manual"]) assert.equal(found({ estimateStatus: status }), true, status);
  for (const status of ["pending", "error", null]) assert.equal(found({ estimateStatus: status, macros: {} }), false, String(status));
  assert.equal(found({ macros: three(100) }), false, "saved before all eight were kept");
  assert.equal(found({ macros: { ...three(100), protein: mine(22) } }), true);
  assert.equal(found({ macros: { protein: mine(22) }, estimateStatus: "pending" }), true, "typed, whatever the AI is doing about the rest");
  assert.equal(found({ macros: undefined }), false);
  assert.equal(found({ qty: 0 }), false);
  assert.equal(found({ nutrition: { photo: true } }), false);
});

test("an entry that is asked about again keeps its numbers for others, a renamed one does not", () => {
  const found = (nutrition, status) => !!N.findRemembered([entry({ nutrition, estimateStatus: status })], "Sardines", amount(4, "pcs"));
  for (const status of ["pending", "error"]) assert.equal(found({ refresh: true }, status), true, `asked again, ${status}`);
  for (const status of ["pending", "error", "manual"]) assert.equal(found({ refresh: true, stale: true }, status), false, `renamed, ${status}`);
});

test("the most recently decided entry wins, then the newest id", () => {
  const pickId = (...entries) => N.findRemembered(entries, "Sardines", amount(4, "pcs")).entry.id;
  assert.equal(pickId(entry({ id: 1, nutrition: { at: 200 } }), entry({ id: 2, nutrition: { at: 100 } })), 1);
  assert.equal(pickId(entry({ id: 1, date: "2026-11-20" }), entry({ id: 2, date: "2026-11-22" }), entry({ id: 3, date: "2026-11-21" })), 2);
  assert.equal(pickId(entry({ id: 5 }), entry({ id: 9 }), entry({ id: 7 })), 9);
  // a copy whose gaps were filled is used rather than the one with the gaps
  const gaps = { macros: { protein: mine(22) }, nutrition: { at: 100 } };
  assert.equal(pickId(entry({ id: 5, ...gaps }), entry({ id: 9, macros: full(100, { protein: mine(22) }), nutrition: { at: 100, from: { id: 5, date: "2026-11-20" } } })), 9);
  // otherwise a copy never outranks what it was copied from
  assert.equal(pickId(entry({ id: 5, nutrition: { at: 100 } }), entry({ id: 9, nutrition: { at: 100, from: { id: 5, date: "2026-11-20" } } })), 5);
  // corrected later, although it was eaten earlier
  assert.equal(pickId(entry({ id: 1, date: "2026-11-19", nutrition: { at: Date.parse("2026-11-23T10:00") } }), entry({ id: 2, date: "2026-11-22" })), 1);
});

test("reusing scales everything and names where the numbers came from", () => {
  const e = entry({ id: 7, macros: full(100, { protein: mine(22) }), nutrition: { at: 500, grams: 48, why: [{ ref: "x" }], asked: amount(4, "pcs"), refresh: true, stale: true, basis: amount(56, "g") } });
  const got = N.reuse({ entry: e, ratio: 1.5 });
  assert.deepEqual(got.macros.calories, { low: 150, high: 150 });
  assert.deepEqual(got.macros.protein, mine(33));
  assert.deepEqual(got.nutrition, { at: 500, grams: 72, why: [{ ref: "x" }], asked: amount(4, "pcs"), basis: amount(56, "g"), from: { id: 7, date: "2026-11-20" } });
});

test("a copy of a copy names the original and keeps its time", () => {
  const first = entry({ id: 1, nutrition: { at: 500 } });
  const second = entry({ id: 2, date: "2026-11-22", ...N.reuse({ entry: first, ratio: 1 }) });
  assert.deepEqual(N.reuse({ entry: second, ratio: 1 }).nutrition, { at: 500, from: { id: 1, date: "2026-11-20" } });
});

test("the weight of a light food does not drift from copy to copy", () => {
  const clove = entry({ qty: 1, unit: "clove", nutrition: { at: 500, grams: 3 } });
  const quarter = entry({ id: 2, qty: 0.25, unit: "clove", ...N.reuse({ entry: clove, ratio: 0.25 }) });
  assert.equal(N.reuse({ entry: quarter, ratio: 4 }).nutrition.grams, 3);
  const scaled = (e, qty) => ({ ...e, qty, ...N.resolve({ before: e, after: { food: e.food, qty, unit: "clove" }, tracked: TRACKED, now: NOW }) });
  assert.equal(scaled(scaled(clove, 0.25), 1).nutrition.grams, 3);
  assert.equal(scaled(scaled(clove, 0.0001), 1).nutrition.grams, 3, "nor does it vanish");
  assert.ok(N.reuse({ entry: clove, ratio: 0.0001 }).nutrition.grams > 0);
});

test("an entry with no recorded time is remembered as of when it was eaten", () => {
  assert.equal(N.reuse({ entry: entry(), ratio: 1 }).nutrition.at, Date.parse("2026-11-20T08:00"));
});

test("the latest log of a food is by date, time, then id, whatever the order", () => {
  const list = [entry({ id: 3, date: "2026-02-09", unit: "g" }), entry({ id: 9, date: "2026-11-22", time: "10:41" }), entry({ id: 8, date: "2026-11-22", time: "18:45" }), entry({ id: 4, date: "2026-11-22", time: "18:45" })];
  assert.equal(N.latestLog(list, "sardines").id, 8);
  assert.equal(N.latestLog([...list].reverse(), "Sardines").id, 8);
  assert.equal(N.latestLog(list, "Tuna"), null);
});

// ---- saving --------------------------------------------------------------------

const add = (over = {}) => N.resolve({ after: { food: "Sardines", qty: 4, unit: "pcs" }, tracked: TRACKED, now: NOW, ...over });

test("adding an unknown food waits for the AI", () => {
  assert.deepEqual(add(), { macros: {}, nutrition: undefined, estimateStatus: "pending" });
});

test("adding a remembered food needs no AI", () => {
  const got = add({ after: { food: "Sardines", qty: 2, unit: "pcs" }, entries: [entry({ nutrition: { at: 500 } })] });
  assert.equal(got.estimateStatus, "done");
  assert.deepEqual(got.macros.calories, { low: 50, high: 50 });
  assert.deepEqual(got.nutrition, { at: 500, from: { id: 1, date: "2026-11-20" } });
});

test("a remembered food with gaps in what is tracked waits for the AI to fill them", () => {
  const got = add({ entries: [entry({ macros: { protein: mine(22) } })] });
  assert.equal(got.estimateStatus, "pending");
  assert.deepEqual(got.macros, { protein: mine(22) });
});

test("typing every tracked number needs no AI", () => {
  const got = add({ form: { typed: { calories: 120, protein: 22, carbs: 0 } } });
  assert.deepEqual(got, { macros: { calories: mine(120), protein: mine(22), carbs: mine(0) }, nutrition: { at: NOW }, estimateStatus: "manual" });
});

test("typing some numbers leaves the rest to the remembered entry, and is decided now", () => {
  const got = add({ entries: [entry({ nutrition: { at: 500 } })], form: { typed: { protein: 25 } } });
  assert.deepEqual(got.macros.protein, mine(25));
  assert.deepEqual(got.macros.calories, { low: 100, high: 100 });
  assert.deepEqual(got.nutrition, { at: NOW });
  assert.equal(got.estimateStatus, "done");
});

test("a label's numbers are scaled to what was eaten", () => {
  const got = add({ after: { food: "Sardines", qty: 80, unit: "g" }, form: { typed: { protein: 11 }, basis: amount(56, "g") } });
  assert.deepEqual(got.macros, { protein: mine(15.7143) });
  assert.deepEqual(got.nutrition, { basis: amount(56, "g"), at: NOW });
  assert.equal(got.estimateStatus, "pending");
});

const edit = (before, after, form) => N.resolve({ before, after: { food: before.food, qty: before.qty, unit: before.unit, ...after }, form, entries: [before], tracked: TRACKED, now: NOW });

test("changing only the date or time changes nothing about the numbers", () => {
  for (const e of [entry({ nutrition: { at: 500, from: { id: 9, date: "2026-11-01" } } }), entry({ estimateStatus: "error", macros: {} }), entry({ estimateStatus: null, macros: three(5) })]) {
    const got = edit(e, {});
    assert.deepEqual(got, { macros: e.macros, nutrition: e.nutrition, estimateStatus: e.estimateStatus });
  }
});

test("a unit spelled differently, or a name in other capitals, is no change", () => {
  const e = entry({ estimateStatus: "error", nutrition: { at: 5 } });
  assert.deepEqual(edit(e, { food: "SARDINES", unit: "pieces" }), { macros: e.macros, nutrition: e.nutrition, estimateStatus: "error" });
});

test("changing the amount scales the numbers, typed ones too, and asks nobody", () => {
  const e = entry({ macros: full(100, { protein: mine(22) }), nutrition: { at: 500, grams: 48, from: { id: 9, date: "2026-11-01" } } });
  const got = edit(e, { qty: 6 });
  assert.equal(got.estimateStatus, "done");
  assert.deepEqual(got.macros.calories, { low: 150, high: 150 });
  assert.deepEqual(got.macros.protein, mine(33));
  assert.deepEqual(got.nutrition, { at: 500, grams: 72, from: { id: 9, date: "2026-11-01" } });
  near(edit(e, { qty: 96, unit: "g" }).macros.calories.low, 200); // by weight
});

test("changing the amount of an entry that has no numbers asks the AI", () => {
  for (const status of ["pending", "error", null]) {
    const got = edit(entry({ macros: {}, estimateStatus: status }), { qty: 6 });
    assert.deepEqual([got.macros, got.estimateStatus], [{}, "pending"], String(status));
  }
});

test("a new name and a new amount in one save: typed numbers scale first", () => {
  const e = entry({ macros: full(100, { protein: mine(22) }) });
  assert.deepEqual(edit(e, { food: "Sardines in oil", qty: 8 }).macros.protein, mine(44));
  assert.deepEqual(edit(e, { food: "Sardines in oil", qty: 2, unit: "cups" }).macros.protein, mine(22), "cups do not convert: it stays, as a total");
});

test("an amount in a weight needs no assumed weight", () => {
  const e = entry({ nutrition: { at: 5, grams: 96, gramsMine: true } });
  const got = edit(e, { qty: 100, unit: "g" });
  near(got.macros.calories.low, 104.167);
  assert.deepEqual(got.nutrition, { at: 5 });
  assert.deepEqual(add({ after: { food: "Sardines", qty: 100, unit: "g" }, entries: [entry({ nutrition: { at: 5, grams: 96 } })] }).nutrition, { at: 5, from: { id: 1, date: "2026-11-20" } });
});

test("a new name, or an amount that does not convert, asks again and keeps the old numbers meanwhile", () => {
  for (const after of [{ food: "Tuna" }, { qty: 2, unit: "cups" }]) {
    const e = entry({ macros: full(100, { protein: mine(22) }) });
    const got = edit(e, after);
    assert.equal(got.estimateStatus, "pending");
    assert.deepEqual(got.nutrition, { refresh: true, stale: true });
    assert.deepEqual(got.macros, e.macros);
  }
});

test("a new name or unit forgets the weight of what it was before, and what typed numbers were per", () => {
  for (const after of [{ food: "Tuna" }, { qty: 2, unit: "cups" }]) {
    const e = entry({ macros: full(100, { protein: mine(9.429) }), nutrition: { at: 5, grams: 48, gramsMine: true, basis: amount(56, "g") } });
    const got = edit(e, after);
    assert.deepEqual([got.macros.protein, got.nutrition], [mine(9.429), { at: 5, refresh: true, stale: true }], "typed numbers stay as totals");
  }
});

test("a typed number carried over to a remembered food is a total there", () => {
  const tuna = entry({ id: 5, food: "Tuna", macros: full(300, { fat: mine(3) }), nutrition: { at: 700, grams: 60, basis: amount(56, "g") } });
  const rename = (macros) => N.resolve({ before: entry({ macros }), after: { food: "Tuna", qty: 4, unit: "pcs" }, entries: [tuna], tracked: TRACKED, now: NOW });
  assert.equal(rename(full(100, { protein: mine(22) })).nutrition.basis, undefined);
  assert.deepEqual(rename(full(100)).nutrition.basis, amount(56, "g"));
});

test("a new name that is remembered takes those numbers, but never over a typed one", () => {
  const tuna = entry({ id: 5, food: "Tuna", macros: full(300), nutrition: { at: 700 } });
  const got = N.resolve({ before: entry({ macros: full(100, { protein: mine(22) }) }), after: { food: "Tuna", qty: 4, unit: "pcs" }, entries: [tuna], tracked: TRACKED, now: NOW });
  assert.deepEqual([got.macros.calories.low, got.macros.protein, got.estimateStatus], [300, mine(22), "done"]);
  assert.deepEqual(got.nutrition, { at: 700, from: { id: 5, date: "2026-11-20" } });
});

test("a rename where everything tracked is typed asks nobody, and leaves nothing of the other food", () => {
  const typed = { calories: mine(1), protein: mine(2), carbs: mine(3) };
  const before = edit(entry({ macros: full(100, typed) }), { food: "Tuna" });
  assert.deepEqual([before.macros, before.estimateStatus, before.nutrition], [typed, "manual", undefined]);
  const now = edit(entry(), { food: "Tuna" }, { typed: { calories: 1, protein: 2, carbs: 3 } });
  assert.deepEqual([now.macros, now.estimateStatus, now.nutrition], [typed, "manual", { at: NOW }]);
  const explained = edit(entry({ nutrition: { at: 5, why: [{ ref: "sardines" }], how: "one", asked: amount(4, "pcs"), from: { id: 9, date: "2026-11-01" }, photo: true } }), { food: "Tuna" }, { typed: { calories: 1, protein: 2, carbs: 3 } });
  assert.deepEqual(explained.nutrition, { at: NOW });
  const same = edit(entry(), {}, { typed: { calories: 1, protein: 2, carbs: 3 } });
  assert.deepEqual(same.macros.sodium, { low: 200, high: 300 }, "its own other numbers stay");
});

test("a renamed entry with a typed number does not take over the other food's memory", () => {
  const tuna = entry({ id: 5, food: "Tuna", macros: full(300, { protein: mine(30) }), nutrition: { at: 700 } });
  const renamed = { ...entry({ id: 9, food: "Tuna" }), ...N.resolve({ before: entry({ macros: full(100, { protein: mine(22) }) }), after: { food: "Tuna", qty: 4, unit: "pcs" }, entries: [tuna], tracked: TRACKED, now: NOW }) };
  assert.deepEqual(renamed.macros.protein, mine(22));
  assert.equal(N.findRemembered([tuna, renamed], "Tuna", amount(4, "pcs")).entry.id, 5);
});

test("typing a number makes it mine and the entry the one to remember", () => {
  const got = edit(entry({ nutrition: { at: 500, from: { id: 9, date: "2026-11-01" } } }), {}, { typed: { protein: 22 } });
  assert.deepEqual(got.macros.protein, mine(22));
  assert.deepEqual(got.nutrition, { at: NOW });
  assert.equal(got.estimateStatus, "done");
});

test("typing on a failed entry asks for the rest, or for nothing if that was all", () => {
  const failed = entry({ macros: {}, estimateStatus: "error" });
  assert.equal(edit(failed, {}, { typed: { protein: 22 } }).estimateStatus, "pending");
  assert.equal(edit(failed, {}, { typed: { calories: 1, protein: 22, carbs: 0 } }).estimateStatus, "manual");
});

test("typing numbers for the entry's own amount drops an older label amount", () => {
  assert.deepEqual(edit(entry({ nutrition: { at: 5, basis: amount(56, "g") } }), {}, { typed: { protein: 22 } }).nutrition, { at: NOW });
});

test("a label amount on pieces goes through their weight", () => {
  const got = edit(entry({ nutrition: { at: 5, grams: 48 } }), {}, { typed: { protein: 11 }, basis: amount(56, "g") });
  near(got.macros.protein.low, 11 * 48 / 56);
  assert.deepEqual(got.nutrition.basis, amount(56, "g"));
});

test("clearing a number makes the entry the one to remember", () => {
  const got = edit(entry({ macros: full(100, { sodium: mine(2000) }), nutrition: { at: 500, from: { id: 9, date: "2026-11-01" } } }), {}, { cleared: ["sodium"] });
  assert.deepEqual(got.nutrition, { at: NOW });
});

test("clearing a tracked number hands it back to the AI; an untracked one is just gone", () => {
  const e = entry({ macros: full(100, { protein: mine(22), sodium: mine(5) }) });
  const tracked = edit(e, {}, { cleared: ["protein"] });
  assert.deepEqual([tracked.macros.protein, tracked.estimateStatus], [undefined, "pending"]);
  const other = edit(e, {}, { cleared: ["sodium"] });
  assert.deepEqual([other.macros.sodium, other.estimateStatus], [undefined, "done"]);
});

test("correcting the weight rescales the AI's numbers, not the typed ones", () => {
  const e = entry({ macros: full(100, { protein: mine(22) }), nutrition: { at: 5, grams: 48, from: { id: 9, date: "2026-11-01" } } });
  const got = edit(e, {}, { grams: 96 });
  assert.deepEqual([got.macros.calories.low, got.macros.protein, got.estimateStatus], [200, mine(22), "done"]);
  assert.deepEqual(got.nutrition, { at: NOW, grams: 96, gramsMine: true });
});

test("numbers typed per weight rest on the weight: correcting it moves them too", () => {
  const e = entry({ macros: full(100, { protein: mine(9.429) }), nutrition: { at: 5, grams: 48, basis: amount(56, "g") } }); // 11 g per 56 g
  const got = edit(e, {}, { grams: 96 });
  assert.deepEqual([got.macros.protein, got.macros.calories.low], [mine(18.858), 200]);
  assert.ok(N.explain({ ...e, ...got }, "2026-11-23").lines.includes("Protein 11 g per 56 g is your number"));
  const typedPerPiece = edit(entry({ macros: full(100, { protein: mine(9) }), nutrition: { at: 5, grams: 48, basis: amount(2, "pcs") } }), {}, { grams: 96 });
  assert.deepEqual(typedPerPiece.macros.protein, mine(9));
});

test("weight, amount and a typed number in one save", () => {
  const e = entry({ nutrition: { at: 5, grams: 48 } });
  const got = edit(e, { qty: 8 }, { grams: 192, typed: { protein: 11 }, basis: amount(96, "g") });
  assert.equal(got.macros.calories.low, 400); // x2 for the amount, x2 for the weight
  assert.deepEqual(got.macros.protein, mine(22)); // 11 per 96 g, 192 g eaten
});

test("ask again keeps the numbers and waits", () => {
  const e = entry({ nutrition: { at: 5, from: { id: 9, date: "2026-11-01" } } });
  const got = edit(e, {}, { askAgain: true });
  assert.deepEqual([got.macros, got.estimateStatus, got.nutrition.refresh], [e.macros, "pending", true]);
});

test("ask again does not look at remembered foods, even under a new name", () => {
  const tuna = entry({ id: 5, food: "Tuna", macros: full(300, { protein: mine(30) }), nutrition: { at: 700 } });
  const e = entry();
  const got = N.resolve({ before: e, after: { food: "Tuna", qty: 4, unit: "pcs" }, form: { askAgain: true }, entries: [tuna], tracked: TRACKED, now: NOW });
  assert.deepEqual([got.macros, got.estimateStatus, got.nutrition], [e.macros, "pending", { refresh: true, stale: true }]);
});

// ---- the AI's answer -------------------------------------------------------------

const answer = (kcal, over = {}) => ({ macros: full(kcal), basis: [{ ref: "canned sardines", note: "n", grams: 40, kcal: 95 }, { ref: "sardines, USDA", note: "m", grams: 56, kcal: 110 }], how: "average", ...over });
const apply = (e, a) => N.applyAnswer(e, a, { tracked: TRACKED, now: NOW });

test("whether the AI has to be asked", () => {
  assert.equal(N.needsAnswer(entry({ macros: {} }), TRACKED), true);
  assert.equal(N.needsAnswer(entry({ macros: three(1) }), TRACKED), false);
  assert.equal(N.needsAnswer(entry({ macros: three(1) }), [...TRACKED, "fiber"]), true);
  assert.equal(N.needsAnswer(entry({ nutrition: { refresh: true } }), TRACKED), true);
});

test("what is sent along as known", () => {
  const e = entry({ macros: { protein: mine(15.714), fat: { low: 3, high: 4 } } });
  assert.deepEqual(N.known(e), { protein: 15.71, fat: 3.5 });
  assert.deepEqual(N.known({ ...e, nutrition: { refresh: true } }), { protein: 15.71 });
  assert.equal(N.known(entry({ macros: {} })), undefined);
});

test("a first answer fills all eight and says what it was based on", () => {
  const got = apply(entry({ macros: {}, estimateStatus: "pending" }), answer(102));
  assert.equal(got.estimateStatus, "done");
  assert.deepEqual(Object.keys(got.macros).length, 8);
  assert.deepEqual(got.nutrition, { why: answer(1).basis, how: "average", asked: amount(4, "pcs"), grams: 48, at: NOW });
});

test("filling gaps changes no number that is there", () => {
  const got = apply(entry({ macros: { protein: mine(22), calories: { low: 7, high: 8 } }, estimateStatus: "pending" }), answer(102));
  assert.deepEqual([got.macros.protein, got.macros.calories, got.macros.fat], [mine(22), { low: 7, high: 8 }, { low: 3, high: 4 }]);
});

test("ask again replaces every number that is not typed", () => {
  const got = apply(entry({ macros: full(100, { protein: mine(22) }), nutrition: { at: 5, refresh: true, from: { id: 9, date: "2026-11-01" }, why: [{ ref: "old" }], grams: 10 } }), answer(102));
  assert.deepEqual([got.macros.calories, got.macros.protein], [{ low: 102, high: 102 }, mine(22)]);
  assert.deepEqual(got.nutrition, { why: answer(1).basis, how: "average", asked: amount(4, "pcs"), grams: 48, at: NOW });
});

test("a photo entry asked about again is no longer the photo's", () => {
  assert.equal("photo" in apply(entry({ nutrition: { photo: true, refresh: true } }), answer(102)).nutrition, false);
  assert.equal(apply(entry({ nutrition: { photo: true, refresh: true } }), null).nutrition.photo, true);
  assert.equal(apply(entry({ macros: three(1), nutrition: { photo: true } }), answer(102)).nutrition.photo, true);
});

test("no answer leaves the numbers as they are", () => {
  for (const none of [null, undefined, {}]) {
    const e = entry({ nutrition: { refresh: true, at: 5 } });
    assert.deepEqual(apply(e, none), { macros: e.macros, nutrition: e.nutrition, estimateStatus: "error" });
  }
});

test("a partial answer is an error if something tracked is missing", () => {
  const a = answer(102); delete a.macros.carbs;
  assert.equal(apply(entry({ macros: {} }), a).estimateStatus, "error");
  assert.equal(apply(entry({ macros: { carbs: { low: 1, high: 2 } } }), a).estimateStatus, "done", "filling gaps: it was there");
});

test("no number from before survives an answer that replaces them all", () => {
  const a = answer(102); delete a.macros.sodium;
  const renamed = apply(entry({ macros: full(100, { protein: mine(22) }), nutrition: { refresh: true, stale: true } }), a);
  assert.deepEqual([renamed.macros.sodium, renamed.macros.protein, renamed.estimateStatus, renamed.nutrition.stale], [undefined, mine(22), "done", undefined]);
});

test("the user's own weight stands, and the AI is told it", () => {
  const e = entry({ nutrition: { refresh: true, grams: 96, gramsMine: true } });
  assert.equal(N.knownWeight(e), 96);
  const got = apply(e, answer(100));
  assert.deepEqual([got.macros.calories.low, got.nutrition.grams, got.nutrition.gramsMine], [100, 96, true]);
});

test("a weight the AI assumed, or that the amount says itself, is not told", () => {
  assert.equal(N.knownWeight(entry({ nutrition: { grams: 48 } })), undefined);
  assert.equal(N.knownWeight(entry({ qty: 96, unit: "g", nutrition: { grams: 96, gramsMine: true } })), undefined);
  assert.equal(N.knownWeight(entry()), undefined);
});

test("filling gaps does not make older numbers newer", () => {
  const copy = entry({ macros: { protein: mine(220) }, nutrition: { at: 5, from: { id: 9, date: "2026-11-01" } } });
  assert.equal(apply(copy, answer(102)).nutrition.at, 5);
  assert.equal(apply(entry({ macros: {} }), answer(102)).nutrition.at, NOW);
  assert.equal(apply(entry({ nutrition: { at: 5, refresh: true } }), answer(102)).nutrition.at, NOW);
});

test("without credit, asking again is taken back; a renamed entry still waits", () => {
  const broke = (e) => N.applyAnswer(e, null, { tracked: TRACKED, now: NOW, noCredit: true });
  const asked = entry({ estimateStatus: "pending", nutrition: { at: 5, refresh: true, from: { id: 9, date: "2026-11-01" } } });
  assert.deepEqual(broke(asked), { macros: asked.macros, nutrition: { at: 5, from: { id: 9, date: "2026-11-01" } }, estimateStatus: "done" });
  const renamed = entry({ estimateStatus: "pending", nutrition: { refresh: true, stale: true } });
  assert.deepEqual(broke(renamed), { macros: renamed.macros, nutrition: renamed.nutrition, estimateStatus: "error" });
  assert.equal(broke(entry({ macros: {}, estimateStatus: "pending" })).estimateStatus, "error");
  assert.equal(broke(entry({ macros: { protein: mine(1) }, nutrition: { refresh: true }, estimateStatus: "pending" })).estimateStatus, "error", "there are blanks");
});

test("numbers typed per weight keep the weight they rest on when the AI answers again", () => {
  const perWeight = { at: 5, grams: 48, basis: amount(56, "g"), refresh: true };
  const heavier = answer(100, { basis: [{ ref: "r", grams: 60 }] });
  const got = apply(entry({ macros: full(100, { protein: mine(9.429) }), nutrition: perWeight }), heavier);
  assert.equal(N.knownWeight(entry({ macros: full(100, { protein: mine(9.429) }), nutrition: perWeight })), 48, "the AI is told it");
  assert.deepEqual([got.macros.protein, got.macros.calories.low, got.nutrition.grams], [mine(9.429), 100, 48]);
  assert.ok(N.explain({ ...entry(), ...got }, "2026-11-23").lines.includes("Protein 11 g per 56 g is your number"));
  const noneTyped = apply(entry({ nutrition: perWeight }), heavier);
  assert.deepEqual([noneTyped.macros.calories.low, noneTyped.nutrition.grams], [100, 60], "nothing rests on it any more");
});

test("an entry in grams stores no assumed weight", () => {
  assert.equal(apply(entry({ qty: 80, unit: "g", macros: {} }), answer(100)).nutrition.grams, undefined);
});

test("at most two estimates are kept", () => {
  assert.equal(apply(entry({ macros: {} }), answer(5, { basis: [{ ref: "a" }, { ref: "b" }, { ref: "c" }] })).nutrition.why.length, 2);
});

test("small weights keep a decimal", () => {
  const a = answer(5, { basis: [{ grams: 1.2 }, { grams: 1.3 }] });
  assert.equal(apply(entry({ macros: {} }), a).nutrition.grams, 1.3);
});

test("today's proxy, which sends no basis, still works", () => {
  const fresh = apply(entry({ macros: {} }), { macros: full(9) });
  assert.deepEqual([fresh.estimateStatus, fresh.nutrition], ["done", { at: NOW }]);
  const again = apply(entry({ nutrition: { refresh: true, why: [{ ref: "old" }], how: "one", asked: amount(4, "pcs"), grams: 48 } }), { macros: full(9) });
  assert.deepEqual(again.nutrition, { at: NOW }, "the old explanation is not for the new numbers");
});

test("gaps filled on a reused entry keep the explanation of the rest", () => {
  const got = apply(entry({ macros: { protein: mine(1) }, nutrition: { why: [{ ref: "old" }], how: "one", from: { id: 9, date: "2026-11-01" } } }), answer(100));
  assert.deepEqual([got.nutrition.why, got.nutrition.from], [[{ ref: "old" }], { id: 9, date: "2026-11-01" }]);
});

test("numbers are stored without floating-point noise", () => {
  assert.deepEqual(apply(entry({ macros: {} }), { macros: full(0.6499999999999999) }).macros.calories, { low: 0.65, high: 0.65 });
});

// ---- the form ---------------------------------------------------------------------

const form = (over = {}) => {
  const f = N.createForm();
  f.rebase({ qty: 4, unit: "pcs", macros: { calories: { low: 100, high: 106 }, protein: mine(22) }, nutrition: { grams: 48 }, ...over });
  return f;
};
const inGrams = (qty, macros = {}) => form({ qty, unit: "g", macros, nutrition: undefined });

test("the form shows saved numbers, an AI range as its middle", () => {
  const f = form();
  assert.deepEqual([f.text("calories"), f.text("protein"), f.text("carbs")], ["103", "22", ""]);
  assert.deepEqual([f.isMine("calories"), f.isMine("protein"), f.isMine("carbs")], [false, true, false]);
  assert.deepEqual(f.basis(), { text: "4", unit: "pcs" });
  assert.deepEqual(f.result(), { typed: {}, cleared: [], basis: null, grams: null });
});

test("typing, clearing, and putting back what was there", () => {
  const f = form();
  f.type("calories", "120");
  f.type("protein", "");
  assert.deepEqual([f.text("calories"), f.isMine("calories"), f.isMine("protein")], ["120", true, false]);
  assert.deepEqual([f.result().typed, f.result().cleared], [{ calories: 120 }, ["protein"]]);
  f.type("calories", "103");
  f.type("protein", "22");
  assert.deepEqual([f.result().typed, f.result().cleared, f.isMine("calories")], [{ calories: 103, protein: 22 }, [], true], "what is typed is the user's, the number shown too");
});

test("a field that was blank and is blank again takes the number that arrives", () => {
  const f = form();
  f.type("carbs", "5");
  f.type("carbs", "");
  f.rebase({ qty: 4, unit: "pcs", macros: full(100) });
  assert.deepEqual([f.text("carbs"), f.result().typed, f.result().cleared], ["1.5", {}, []]);
});

test("saved numbers follow the entry; a typed one stays as typed, for the amount shown", () => {
  const f = form();
  f.type("carbs", "5");
  f.rebase({ qty: 6, unit: "pcs", macros: { calories: { low: 150, high: 159 }, protein: mine(33) }, nutrition: { grams: 72 } });
  assert.deepEqual([f.text("calories"), f.text("protein"), f.text("carbs")], ["154.5", "33", "5"]);
  assert.deepEqual(f.basis(), { text: "6", unit: "pcs" });
  assert.equal(f.result().basis, null);
});

test("a label is typed as printed, before or after saying what it is for", () => {
  const eaten = { food: "Sardines", qty: 80, unit: "g" }; // 11 g of protein as estimated, 11 g per 56 g on the label
  for (const numbersFirst of [true, false]) {
    const f = inGrams(80, full(160));
    if (numbersFirst) f.type("protein", "11");
    f.setBasis("5"); // on the way to 56
    f.setBasis("56");
    if (!numbersFirst) f.type("protein", "11");
    assert.deepEqual([f.text("protein"), f.text("calories")], ["11", "112"]);
    const saved = N.resolve({ before: entry({ ...eaten, macros: full(160) }), after: eaten, form: f.result(), tracked: TRACKED, now: NOW });
    assert.deepEqual([saved.macros.protein, saved.macros.calories], [mine(15.7143), { low: 160, high: 160 }]);
    assert.deepEqual(saved.nutrition.basis, amount(56, "g"));
  }
});

test("the label's amount stays put when the amount eaten changes", () => {
  const f = inGrams(80);
  f.setBasis("56");
  f.type("protein", "11");
  f.rebase({ qty: 100, unit: "g", macros: {} });
  assert.deepEqual([f.text("protein"), f.basis().text, f.result().typed], ["11", "56", { protein: 11 }]);
});

test("another unit for the same amount changes no number", () => {
  const f = form();
  f.setBasisUnit("g");
  assert.deepEqual([f.basis(), f.text("calories"), f.text("protein")], [{ text: "48", unit: "g" }, "103", "22"]);
  f.setBasis("24");
  assert.deepEqual([f.text("calories"), f.text("protein")], ["51.5", "11"]);
  f.setBasisUnit("oz");
  assert.deepEqual([f.basis(), f.text("protein")], [{ text: "0.8466", unit: "oz" }, "11"]);
  f.setBasisUnit("pcs");
  assert.deepEqual(f.basis(), { text: "2", unit: "pcs" });
  assert.deepEqual(f.units(), ["pcs", "g", "kg", "oz", "lb"]);
});

test("after that refusal, the only unit that fits means the entry's own amount", () => {
  const f = inGrams(80);
  f.setBasis("56");
  f.type("protein", "11");
  f.rebase({ qty: 2, unit: "plate", macros: {} });
  f.setBasisUnit("plate");
  assert.deepEqual([f.basis(), f.errors(), f.result().typed], [{ text: "2", unit: "plate" }, {}, { protein: 11 }]);
});

test("small numbers are shown to three digits, so that a label's are not taken for them", () => {
  const f = inGrams(20, { fat: { low: 6.9, high: 6.9 }, calories: { low: 707.5, high: 707.5 }, saturatedFat: { low: 2.8, high: 2.8 }, protein: mine(15.7143), sugar: { low: 22.35, high: 22.35 } });
  assert.deepEqual(["fat", "calories", "protein", "sugar"].map((id) => f.text(id)), ["6.9", "707.5", "15.7", "22.4"]);
  f.setBasis("1");
  assert.deepEqual([f.text("fat"), f.text("saturatedFat")], ["0.345", "0.14"]);
});

test("what the entry would no longer have is shown as blank", () => {
  const f = form();
  assert.deepEqual([f.text("calories", { protein: mine(22) }), f.text("protein", { protein: mine(22) })], ["", "22"]);
  f.type("calories", "5");
  assert.equal(f.text("calories", {}), "5");
});

test("an amount the label's does not convert to is refused, not taken for something else", () => {
  const f = inGrams(80);
  f.setBasis("56");
  f.type("protein", "11");
  f.rebase({ qty: 1, unit: "plate", macros: {} });
  assert.equal(f.errors().basis, "56 g does not convert to 1 plate");
  assert.deepEqual([f.basis(), f.units()], [{ text: "56", unit: "g" }, ["plate", "g"]]);
  f.rebase({ qty: 3, unit: "oz", macros: {} });
  assert.deepEqual([f.errors(), f.result().basis], [{}, amount(56, "g")]);
});

test("invalid input is reported and kept", () => {
  const f = form();
  for (const bad of ["abc", "-1", "1,200", "1e3", "100000", "."]) {
    f.type("calories", bad);
    assert.deepEqual([f.text("calories"), f.isMine("calories")], [bad, false]);
    assert.match(f.errors().calories, /number/, bad);
  }
  for (const good of ["0", "12.5", ".5", "12.", "99999", " 7 "]) {
    f.type("calories", good);
    assert.deepEqual(f.errors(), {}, good);
  }
  for (const bad of ["0", "", "x"]) {
    f.setBasis(bad);
    assert.deepEqual([f.basis().text, f.errors().basis], [bad, "Enter an amount above 0"]);
  }
  f.setBasis("4");
  for (const bad of ["0", "x"]) {
    f.setWeight(bad);
    assert.match(f.errors().weight, /weight/);
  }
  f.setWeight("");
  assert.deepEqual(f.errors(), {});
});

test("what the numbers are for does not matter while none is typed", () => {
  const f = form();
  f.setBasis("");
  assert.deepEqual(f.errors(), {});
});

test("correcting the weight shows its effect at once, on the AI's numbers only", () => {
  const f = form();
  f.setWeight("96");
  assert.deepEqual([f.text("calories"), f.text("protein"), f.result().grams], ["206", "22", 96]);
});

for (const [what, next] of [
  ["another amount", { qty: 8, unit: "pcs", nutrition: { grams: 96 } }],
  ["another food", { food: "Tuna", qty: 4, unit: "pcs", nutrition: { grams: 120 } }],
  ["a weight", { qty: 150, unit: "g", nutrition: undefined }],
  ["something whose weight is not known", { qty: 4, unit: "pcs", nutrition: undefined }],
]) {
  test(`a typed weight is not carried over to ${what}`, () => {
    for (const text of ["90", "96 g"]) {
      const f = form();
      f.setWeight(text);
      f.rebase({ macros: { calories: { low: 300, high: 300 } }, ...next });
      assert.deepEqual([f.weight(), f.text("calories"), f.result().grams, f.errors()], ["", "300", null, {}], text);
    }
  });
}

test("a typed weight stays while an answer lands", () => {
  const f = form();
  f.setWeight("96");
  f.rebase({ qty: 4, unit: "pcs", macros: { calories: { low: 120, high: 120 } }, nutrition: { grams: 60 } });
  assert.deepEqual([f.weight(), f.text("calories"), f.result().grams], ["96", "192", 96]);
});

test("correcting the weight shows its effect on numbers typed per weight too", () => {
  const f = form({ nutrition: { grams: 48, basis: amount(56, "g") } });
  f.setWeight("96");
  assert.deepEqual([f.text("calories"), f.text("protein")], ["206", "44"]);
});

test("numbers that arrive while the form is open appear, without touching what was typed", () => {
  const f = form({ macros: {}, nutrition: undefined });
  f.type("protein", "22");
  f.rebase({ qty: 4, unit: "pcs", macros: full(100), nutrition: { grams: 48 } });
  assert.deepEqual([f.text("calories"), f.text("protein"), f.result().typed], ["100", "22", { protein: 22 }]);
});

test("a form for something that has no amount yet", () => {
  const f = form({ qty: NaN, unit: "", macros: {}, nutrition: undefined });
  assert.deepEqual(f.basis(), { text: "", unit: "" });
  f.type("protein", "22");
  f.rebase({ qty: 1, unit: "pc", macros: {} });
  assert.deepEqual([f.errors(), f.result().typed, f.result().basis], [{}, { protein: 22 }, null]);
});

test("whether an entry has numbers the user did not type", () => {
  assert.equal(N.hasTheirs(entry()), true);
  assert.equal(N.hasTheirs(entry({ macros: { protein: mine(1) } })), false);
  assert.equal(N.hasTheirs(entry({ macros: {} })), false);
});

// ---- the explanation ----------------------------------------------------------------

const why = [{ ref: "canned sardines in oil, drained", note: "From USDA.", grams: 46, kcal: 95 }, { ref: "canned sardines in oil, drained", note: "Label values.", grams: 50, kcal: 110 }];
const TODAY = "2026-11-23";
const explained = (over, nutrition) => N.explain(entry({ ...over, nutrition }), TODAY);

test("two estimates, averaged", () => {
  assert.deepEqual(explained({}, { grams: 48, why, how: "average", asked: amount(4, "pcs") }), {
    weight: "Assumed weight 48 g (12 g each)",
    lines: [
      "Based on canned sardines in oil, drained",
      "Two estimates, 95 and 110 kcal, averaged",
      "From USDA.",
      "Label values.",
      "The AI works from what it knows about food. It does not look values up.",
    ],
  });
});

test("weights that differ a lot are both shown", () => {
  const apart = [{ ...why[0], grams: 40 }, { ...why[1], grams: 56 }];
  assert.equal(explained({}, { grams: 48, why: apart, how: "average", asked: amount(4, "pcs") }).weight, "Assumed weight 40–56 g, using 48 g");
  assert.equal(explained({ qty: 8 }, { grams: 96, why: apart, how: "average", asked: amount(4, "pcs") }).weight, "Assumed weight 80–112 g, using 96 g");
});

test("a corrected weight, one piece, and an entry already in grams", () => {
  assert.equal(explained({}, { grams: 90, gramsMine: true, why }).weight, "Your weight 90 g (22.5 g each)");
  assert.equal(explained({ qty: 1 }, { grams: 12, why: [why[0]] }).weight, "Assumed weight 12 g");
  assert.equal(explained({ qty: 80, unit: "g" }, { grams: 80, why }).weight, null);
});

test("estimates that disagreed, a single one, and unknown calories", () => {
  const second = (how, w) => explained({}, { why: w, how, asked: amount(4, "pcs") }).lines[1];
  assert.equal(second("both", [{ ...why[0], kcal: 60 }, { ...why[1], kcal: 200 }]), "Two estimates, 60 and 200 kcal, disagreed, so the range covers both");
  assert.equal(second("one", [why[0]]), "One estimate, 95 kcal");
  assert.equal(second("average", [{ ...why[0], kcal: null }, { ...why[1], kcal: null }]), "Two estimates, averaged");
});

test("numbers scaled from another amount say so", () => {
  const says = (over, nutrition) => explained(over, { why, how: "average", asked: amount(4, "pcs"), ...nutrition }).lines.find((l) => /^For /.test(l));
  assert.equal(says({ qty: 6 }), "For 4 pcs, scaled to 6 pcs");
  assert.equal(says({ unit: "pieces" }), undefined);
  assert.equal(says({ qty: 96, unit: "g" }, { grams: 96 }), "For 4 pcs, scaled to 96 g");
  assert.equal(says({ qty: 2, unit: "cups" }, { refresh: true }), "For 4 pcs", "not scaled: waiting for a new answer");
});

test("amounts and small weights are said as they are", () => {
  const says = (over, nutrition) => explained(over, { why, how: "average", ...nutrition });
  assert.ok(says({ qty: 1, unit: "cup" }, { asked: amount(0.25, "cup") }).lines.includes("For 0.25 cup, scaled to 1 cup"));
  const macros = { protein: mine(11) };
  assert.ok(explained({ qty: 0.056, unit: "kg", macros }, { basis: amount(0.056, "kg") }).lines.includes("Protein 11 g per 0.056 kg is your number"));
  assert.equal(explained({ qty: 2, unit: "pinch" }, { grams: 0.5, why: [{ grams: 0.4 }, { grams: 0.6 }] }).weight, "Assumed weight 0.4–0.6 g, using 0.5 g");
});

test("typed numbers, per the label's amount if there was one", () => {
  const macros = full(100, { protein: mine(15.714), sodium: mine(300) });
  assert.deepEqual(explained({ qty: 80, unit: "g", macros }, { basis: amount(56, "g") }).lines, ["Protein 11 g per 56 g is your number", "Sodium 210 mg per 56 g is your number"]);
  assert.deepEqual(explained({ macros: full(100, { protein: mine(22) }) }, {}).lines, ["Protein 22 g is your number"]);
});

test("reused, photographed, and unexplained entries", () => {
  assert.ok(explained({}, { from: { id: 1, date: "2026-11-20" } }).lines.includes("Numbers from Nov 20"));
  assert.ok(explained({}, { from: { id: 1, date: "2025-11-20" } }).lines.includes("Numbers from Nov 20, 2025"));
  assert.deepEqual(explained({}, { photo: true }).lines, ["Estimated from your photo"]);
  assert.deepEqual(N.explain(entry(), TODAY).lines, ["No explanation was saved for this entry. Ask AI again to get one."]);
  assert.deepEqual(N.explain(entry({ macros: {}, estimateStatus: "pending" }), TODAY), { weight: null, lines: [] });
});

test("the tag names the day, and the year if it is another one", () => {
  const from = (date) => N.tag(entry({ nutrition: { from: { id: 1, date } } }), TODAY);
  assert.equal(from("2026-11-20"), "from Nov 20");
  assert.equal(from("2025-02-03"), "from Feb 3, 2025");
  assert.equal(N.tag(entry(), TODAY), "");
});
