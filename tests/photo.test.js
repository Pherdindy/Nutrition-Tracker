const test = require("node:test");
const assert = require("node:assert");
const P = require("../www/photo.js");

test("buildVisionSystemPrompt requests an items array with food, portion, and enabled macro fields", () => {
  const s = P.buildVisionSystemPrompt(["calories", "protein"]);
  assert.match(s, /"items"/);
  assert.match(s, /"food"/);
  assert.match(s, /"portion"/);
  assert.match(s, /"calories_lower"/);
  assert.match(s, /"protein_upper"/);
});

test("buildVisionUserText includes prior items and correction when present", () => {
  const base = P.buildVisionUserText(null);
  assert.match(base, /identify/i);
  const withCorr = P.buildVisionUserText({ priorItems: [{ food: "Bean soup" }], correction: "It's a sloppy joe" });
  assert.match(withCorr, /Bean soup/);
  assert.match(withCorr, /sloppy joe/);
});

test("parseVisionResponse extracts items with food, portion, macros; tolerant of fences/missing", () => {
  const json = '```json\n{"items":[{"food":"Sloppy joe","portion":"1 sandwich","calories_lower":480,"calories_upper":560,"protein_lower":26,"protein_upper":30},{"food":"Fries","portion":"1 cup","calories_lower":340,"calories_upper":390}]}\n```';
  const out = P.parseVisionResponse(json, ["calories", "protein"]);
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].food, "Sloppy joe");
  assert.equal(out.items[0].portion, "1 sandwich");
  assert.deepEqual(out.items[0].macros.calories, { low: 480, high: 560 });
  assert.deepEqual(out.items[0].macros.protein, { low: 26, high: 30 });
  assert.equal(out.items[1].macros.protein, undefined);
});

test("parseVisionResponse returns empty items on bad shape; throws on non-JSON", () => {
  assert.deepEqual(P.parseVisionResponse('{"foo":1}', ["calories"]).items, []);
  assert.throws(() => P.parseVisionResponse("not json", ["calories"]));
});

test("itemsToEntries builds entries with unique ids, qty 1, portion as unit, done status", () => {
  const items = [
    { food: "Sloppy joe", portion: "1 sandwich", macros: { calories: { low: 480, high: 560 } } },
    { food: "Fries", portion: "1 cup", macros: { calories: { low: 340, high: 390 } } },
  ];
  const out = P.itemsToEntries(items, "2026-06-04", "12:30", 10);
  assert.equal(out.length, 2);
  assert.deepEqual({ id: out[0].id, qty: out[0].qty, unit: out[0].unit, food: out[0].food, status: out[0].estimateStatus, date: out[0].date, time: out[0].time },
    { id: 10, qty: 1, unit: "1 sandwich", food: "Sloppy joe", status: "done", date: "2026-06-04", time: "12:30" });
  assert.equal(out[1].id, 11);
  assert.deepEqual(out[0].macros.calories, { low: 480, high: 560 });
});

test("parseVisionResponse skips null/non-object items instead of crashing", () => {
  const out = P.parseVisionResponse('{"items":[null,5,{"food":"Rice","portion":"1 cup","calories_lower":200,"calories_upper":220}]}', ["calories"]);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].food, "Rice");
});

test("parseVisionResponse strips a ```javascript fence", () => {
  const out = P.parseVisionResponse('```javascript\n{"items":[{"food":"Egg","portion":"1 large"}]}\n```', ["calories"]);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].food, "Egg");
});

test("itemsToEntries returns [] for null/undefined input", () => {
  assert.deepEqual(P.itemsToEntries(null, "2026-06-04", "12:30", 1), []);
  assert.deepEqual(P.itemsToEntries(undefined, "2026-06-04", "12:30", 1), []);
});
