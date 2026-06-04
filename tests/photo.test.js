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
