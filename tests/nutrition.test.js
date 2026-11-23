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

test("scaling keeps ranges and marks, to three decimals", () => {
  const macros = { calories: { low: 100, high: 110 }, protein: { low: 11, high: 11, mine: true } };
  assert.deepEqual(N.scale(macros, 80 / 56), { calories: { low: 142.857, high: 157.143 }, protein: { low: 15.714, high: 15.714, mine: true } });
  assert.deepEqual(macros.calories, { low: 100, high: 110 }, "the original is untouched");
  assert.deepEqual(N.scale(undefined, 2), {});
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

test("only finished entries with all eight nutrients, or a typed number, are remembered", () => {
  const found = (over) => !!N.findRemembered([entry(over)], "Sardines", amount(4, "pcs"));
  assert.equal(found({}), true);
  assert.equal(found({ estimateStatus: "manual" }), true);
  for (const status of ["pending", "error", null]) assert.equal(found({ estimateStatus: status }), false, String(status));
  assert.equal(found({ macros: three(100) }), false, "saved before all eight were kept");
  assert.equal(found({ macros: { ...three(100), protein: mine(22) } }), true);
  assert.equal(found({ macros: undefined }), false);
  assert.equal(found({ qty: 0 }), false);
  assert.equal(found({ nutrition: { photo: true } }), false);
});

test("the most recently decided entry wins, then the newest id", () => {
  const pickId = (...entries) => N.findRemembered(entries, "Sardines", amount(4, "pcs")).entry.id;
  assert.equal(pickId(entry({ id: 1, nutrition: { at: 200 } }), entry({ id: 2, nutrition: { at: 100 } })), 1);
  assert.equal(pickId(entry({ id: 1, date: "2026-11-20" }), entry({ id: 2, date: "2026-11-22" }), entry({ id: 3, date: "2026-11-21" })), 2);
  assert.equal(pickId(entry({ id: 5 }), entry({ id: 9 }), entry({ id: 7 })), 9);
  // corrected later, although it was eaten earlier
  assert.equal(pickId(entry({ id: 1, date: "2026-11-19", nutrition: { at: Date.parse("2026-11-23T10:00") } }), entry({ id: 2, date: "2026-11-22" })), 1);
});

test("reusing scales everything and names where the numbers came from", () => {
  const e = entry({ id: 7, macros: full(100, { protein: mine(22) }), nutrition: { at: 500, grams: 48, why: [{ ref: "x" }], asked: amount(4, "pcs"), refresh: true, basis: amount(56, "g") } });
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

const add = (over = {}) => N.resolve({ after: { food: "Sardines", qty: 4, unit: "pcs" }, others: [], tracked: TRACKED, now: NOW, ...over });

test("adding an unknown food waits for the AI", () => {
  assert.deepEqual(add(), { macros: {}, nutrition: undefined, estimateStatus: "pending" });
});

test("adding a remembered food needs no AI", () => {
  const got = add({ after: { food: "Sardines", qty: 2, unit: "pcs" }, others: [entry({ nutrition: { at: 500 } })] });
  assert.equal(got.estimateStatus, "done");
  assert.deepEqual(got.macros.calories, { low: 50, high: 50 });
  assert.deepEqual(got.nutrition, { at: 500, from: { id: 1, date: "2026-11-20" } });
});

test("a remembered food with gaps in what is tracked waits for the AI to fill them", () => {
  const got = add({ others: [entry({ macros: { protein: mine(22) } })] });
  assert.equal(got.estimateStatus, "pending");
  assert.deepEqual(got.macros, { protein: mine(22) });
});

test("typing every tracked number needs no AI", () => {
  const got = add({ form: { typed: { calories: 120, protein: 22, carbs: 0 } } });
  assert.deepEqual(got, { macros: { calories: mine(120), protein: mine(22), carbs: mine(0) }, nutrition: { at: NOW }, estimateStatus: "manual" });
});

test("typing some numbers leaves the rest to the remembered entry, and is decided now", () => {
  const got = add({ others: [entry({ nutrition: { at: 500 } })], form: { typed: { protein: 25 } } });
  assert.deepEqual(got.macros.protein, mine(25));
  assert.deepEqual(got.macros.calories, { low: 100, high: 100 });
  assert.deepEqual(got.nutrition, { at: NOW });
  assert.equal(got.estimateStatus, "done");
});

test("a label's numbers are scaled to what was eaten", () => {
  const got = add({ after: { food: "Sardines", qty: 80, unit: "g" }, form: { typed: { protein: 11 }, basis: amount(56, "g") } });
  assert.deepEqual(got.macros, { protein: mine(15.714) });
  assert.deepEqual(got.nutrition, { basis: amount(56, "g"), at: NOW });
  assert.equal(got.estimateStatus, "pending");
});

const edit = (before, after, form) => N.resolve({ before, after: { food: before.food, qty: before.qty, unit: before.unit, ...after }, form, others: [], tracked: TRACKED, now: NOW });

test("changing only the date or time changes nothing about the numbers", () => {
  for (const e of [entry({ nutrition: { at: 500, from: { id: 9, date: "2026-11-01" } } }), entry({ estimateStatus: "error", macros: {} }), entry({ estimateStatus: null, macros: three(5) })]) {
    const got = edit(e, {});
    assert.deepEqual(got, { macros: e.macros, nutrition: e.nutrition, estimateStatus: e.estimateStatus });
  }
});

test("a unit spelled differently, or a name in other capitals, is no change", () => {
  assert.deepEqual(N.editPlan(entry(), { food: "SARDINES", qty: 4, unit: "pieces" }), { kind: "keep" });
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

test("changing the amount of an entry that has no numbers keeps it waiting", () => {
  const got = edit(entry({ macros: {}, estimateStatus: "pending" }), { qty: 6 });
  assert.deepEqual([got.macros, got.estimateStatus], [{}, "pending"]);
});

test("a new name, or an amount that does not convert, asks again and keeps the old numbers meanwhile", () => {
  for (const after of [{ food: "Tuna" }, { qty: 2, unit: "cups" }]) {
    const e = entry({ macros: full(100, { protein: mine(22) }) });
    const got = edit(e, after);
    assert.equal(got.estimateStatus, "pending");
    assert.equal(got.nutrition.refresh, true);
    assert.deepEqual(got.macros, e.macros);
  }
});

test("a new name or unit forgets the weight of what it was before", () => {
  for (const after of [{ food: "Tuna" }, { qty: 2, unit: "cups" }]) {
    const got = edit(entry({ nutrition: { at: 5, grams: 90, gramsMine: true } }), after);
    assert.deepEqual(got.nutrition, { at: 5, refresh: true });
  }
});

test("a new name that is remembered takes those numbers, but never over a typed one", () => {
  const tuna = entry({ id: 5, food: "Tuna", macros: full(300), nutrition: { at: 700 } });
  const got = N.resolve({ before: entry({ macros: full(100, { protein: mine(22) }) }), after: { food: "Tuna", qty: 4, unit: "pcs" }, others: [tuna], tracked: TRACKED, now: NOW });
  assert.deepEqual([got.macros.calories.low, got.macros.protein, got.estimateStatus], [300, mine(22), "done"]);
  assert.deepEqual(got.nutrition, { at: 700, from: { id: 5, date: "2026-11-20" } });
});

test("a rename where everything tracked is typed asks nobody", () => {
  const got = edit(entry({ macros: full(100, { calories: mine(1), protein: mine(2), carbs: mine(3) }) }), { food: "Tuna" });
  assert.deepEqual([got.estimateStatus, got.nutrition], ["manual", undefined]);
});

test("typing a number makes it mine and the entry the one to remember", () => {
  const got = edit(entry({ nutrition: { at: 500, from: { id: 9, date: "2026-11-01" } } }), {}, { typed: { protein: 22 } });
  assert.deepEqual(got.macros.protein, mine(22));
  assert.deepEqual(got.nutrition, { at: NOW });
  assert.equal(got.estimateStatus, "done");
});

test("typing numbers for the entry's own amount drops an older label amount", () => {
  assert.deepEqual(edit(entry({ nutrition: { at: 5, basis: amount(56, "g") } }), {}, { typed: { protein: 22 } }).nutrition, { at: NOW });
});

test("a label amount on pieces goes through their weight", () => {
  const got = edit(entry({ nutrition: { at: 5, grams: 48 } }), {}, { typed: { protein: 11 }, basis: amount(56, "g") });
  near(got.macros.protein.low, 9.429); // 11 x 48/56
  assert.deepEqual(got.nutrition.basis, amount(56, "g"));
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

test("a partial answer keeps what it does not mention, and is an error if something tracked is missing", () => {
  const a = answer(102); delete a.macros.carbs;
  assert.equal(apply(entry({ macros: {} }), a).estimateStatus, "error");
  const again = apply(entry({ nutrition: { refresh: true } }), a);
  assert.deepEqual([again.macros.carbs, again.estimateStatus], [{ low: 1, high: 2 }, "done"]);
});

test("the user's own weight stands: the answer is brought to it", () => {
  const got = apply(entry({ nutrition: { refresh: true, grams: 96, gramsMine: true } }), answer(100));
  assert.deepEqual([got.macros.calories.low, got.nutrition.grams, got.nutrition.gramsMine], [200, 96, true]);
});

test("an entry in grams stores no assumed weight", () => {
  assert.equal(apply(entry({ qty: 80, unit: "g", macros: {} }), answer(100)).nutrition.grams, undefined);
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
