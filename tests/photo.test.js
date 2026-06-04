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
