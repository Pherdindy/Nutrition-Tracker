// Pure metering logic shared by the ai-proxy Edge Function (Deno) and the
// node --test suite. No dependencies, no I/O — keep it that way.

export function computeCost(usageA, usageB, prices) {
  let costUsd = 0;
  const unpriced = [];
  for (const u of [usageA, usageB]) {
    if (!u) continue;
    const p = prices[u.model];
    if (!p || !Number.isFinite(u.inputTokens) || !Number.isFinite(u.outputTokens)) {
      unpriced.push(u.model);
      continue;
    }
    costUsd += (u.inputTokens / 1e6) * p.in_per_mtok + (u.outputTokens / 1e6) * p.out_per_mtok;
  }
  return { costUsd, unpriced };
}

export function quotaState({ plan, planCfg, usedUsd }) {
  if (plan === "owner") return { allowed: true, pctUsed: 0, exhausted: false };
  if (!planCfg || !(planCfg.allowance_usd > 0)) {
    return { allowed: false, pctUsed: 100, exhausted: true, misconfigured: true };
  }
  const allowance = planCfg.allowance_usd;
  const exhausted = usedUsd >= allowance;
  return {
    allowed: !exhausted,
    pctUsed: Math.min(100, Math.floor((usedUsd / allowance) * 100)),
    exhausted,
  };
}

function avg(x, y) { return (x + y) / 2; }

function diverges(midA, midB, widenThreshold) {
  return Math.abs(midA - midB) / Math.max(midA, midB, 1) > widenThreshold;
}

export function mergeEstimates(a, b, widenThreshold) {
  if (!b) return a;
  if (!a) return b;
  const calDiverged = diverges(avg(a.cal_low, a.cal_high), avg(b.cal_low, b.cal_high), widenThreshold);
  const proDiverged = diverges(avg(a.pro_low, a.pro_high), avg(b.pro_low, b.pro_high), widenThreshold);
  const macros = {};
  for (const k of new Set([...Object.keys(a.macros || {}), ...Object.keys(b.macros || {})])) {
    const av = (a.macros || {})[k], bv = (b.macros || {})[k];
    macros[k] = av == null ? bv : bv == null ? av : avg(av, bv);
  }
  return {
    cal_low: calDiverged ? Math.min(a.cal_low, b.cal_low) : avg(a.cal_low, b.cal_low),
    cal_high: calDiverged ? Math.max(a.cal_high, b.cal_high) : avg(a.cal_high, b.cal_high),
    pro_low: proDiverged ? Math.min(a.pro_low, b.pro_low) : avg(a.pro_low, b.pro_low),
    pro_high: proDiverged ? Math.max(a.pro_high, b.pro_high) : avg(a.pro_high, b.pro_high),
    macros,
  };
}

export function rateLimited(recentCount, ratePerMin) {
  return recentCount >= ratePerMin;
}
