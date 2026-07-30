const test = require("node:test");
const assert = require("node:assert");
const BV = require("../www/billing-view.js");

test("creditBar maps pct to width, class, and label", () => {
  assert.deepEqual(BV.creditBar(63, "free"),
    { width: "63%", cls: "ok", label: "AI usage: 63% used", planLabel: "Free" });
  assert.equal(BV.creditBar(85, "t3").cls, "warn");
  assert.equal(BV.creditBar(100, "free").cls, "full");
  assert.equal(BV.creditBar(0, "t10").planLabel, "$10 plan");
  assert.equal(BV.creditBar(0, "owner").planLabel, "Owner");
});

test("creditBar clamps out-of-range pct", () => {
  assert.equal(BV.creditBar(-5, "free").width, "0%");
  assert.equal(BV.creditBar(140, "free").width, "100%");
});

test("aiErrorMessage maps proxy statuses to friendly text", () => {
  assert.equal(BV.aiErrorMessage(402), "You've used your AI credit — upgrade to continue.");
  assert.equal(BV.aiErrorMessage(429), "One moment — too many requests. Try again shortly.");
  assert.equal(BV.aiErrorMessage(503), "AI is temporarily unavailable. Your food logging still works.");
  assert.equal(BV.aiErrorMessage(502), "The AI models couldn't answer just now — try again.");
  assert.equal(BV.aiErrorMessage(500), "Something went wrong with the AI service.");
});
