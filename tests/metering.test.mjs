import test from "node:test";
import assert from "node:assert";
import { computeCost, quotaState, mergeEstimates, rateLimited } from "../supabase/functions/_shared/metering.mjs";

const PRICES = {
  "model-a": { in_per_mtok: 1.0, out_per_mtok: 5.0 },
  "model-b": { in_per_mtok: 0.15, out_per_mtok: 0.6 },
};

test("computeCost sums both models from token counts", () => {
  const r = computeCost(
    { model: "model-a", inputTokens: 1000, outputTokens: 500 },
    { model: "model-b", inputTokens: 1000, outputTokens: 500 },
    PRICES);
  // a: 1000/1e6*1.0 + 500/1e6*5.0 = 0.0035 ; b: 0.00015 + 0.0003 = 0.00045
  assert.ok(Math.abs(r.costUsd - 0.00395) < 1e-9);
  assert.deepEqual(r.unpriced, []);
});

test("computeCost with a null second usage (degraded pair)", () => {
  const r = computeCost({ model: "model-a", inputTokens: 1000, outputTokens: 0 }, null, PRICES);
  assert.ok(Math.abs(r.costUsd - 0.001) < 1e-9);
});

test("computeCost reports unpriced models instead of guessing", () => {
  const r = computeCost({ model: "mystery", inputTokens: 10, outputTokens: 10 }, null, PRICES);
  assert.deepEqual(r.unpriced, ["mystery"]);
});

test("quotaState: free lifetime allows under, blocks at 100%", () => {
  const cfg = { allowance_usd: 1.0, lifetime: true };
  assert.equal(quotaState({ plan: "free", planCfg: cfg, usedUsd: 0.63 }).allowed, true);
  assert.equal(quotaState({ plan: "free", planCfg: cfg, usedUsd: 0.63 }).pctUsed, 63);
  const full = quotaState({ plan: "free", planCfg: cfg, usedUsd: 1.0 });
  assert.equal(full.allowed, false);
  assert.equal(full.exhausted, true);
  assert.equal(full.pctUsed, 100);
});

test("quotaState: owner always allowed", () => {
  const r = quotaState({ plan: "owner", planCfg: undefined, usedUsd: 999 });
  assert.equal(r.allowed, true);
  assert.equal(r.pctUsed, 0);
});

test("quotaState: pct is capped at 100 even when overshot", () => {
  const r = quotaState({ plan: "t3", planCfg: { allowance_usd: 1.2 }, usedUsd: 1.5 });
  assert.equal(r.pctUsed, 100);
  assert.equal(r.allowed, false);
});

test("mergeEstimates averages agreeing ranges", () => {
  const a = { cal_low: 100, cal_high: 200, pro_low: 10, pro_high: 20, macros: { carbs_g: 10, fat_g: 4 } };
  const b = { cal_low: 120, cal_high: 220, pro_low: 12, pro_high: 22, macros: { carbs_g: 20, fat_g: 6 } };
  const m = mergeEstimates(a, b, 0.4);
  assert.equal(m.cal_low, 110);
  assert.equal(m.cal_high, 210);
  assert.equal(m.pro_low, 11);
  assert.equal(m.macros.carbs_g, 15);
  assert.equal(m.macros.fat_g, 5);
});

test("mergeEstimates widens when midpoints diverge past threshold", () => {
  const a = { cal_low: 100, cal_high: 200, pro_low: 10, pro_high: 20, macros: {} }; // mid 150
  const b = { cal_low: 400, cal_high: 600, pro_low: 10, pro_high: 20, macros: {} }; // mid 500
  const m = mergeEstimates(a, b, 0.4);
  assert.equal(m.cal_low, 100);   // widened to cover both
  assert.equal(m.cal_high, 600);
});

test("mergeEstimates with null second estimate returns the first", () => {
  const a = { cal_low: 1, cal_high: 2, pro_low: 3, pro_high: 4, macros: { fat_g: 1 } };
  assert.deepEqual(mergeEstimates(a, null, 0.4), a);
});

test("rateLimited compares recent count to the per-minute cap", () => {
  assert.equal(rateLimited(9, 10), false);
  assert.equal(rateLimited(10, 10), true);
});
