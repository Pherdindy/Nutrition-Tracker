// Credit bar + AI error presentation logic. UMD like the other helpers.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BillingView = api;
})(typeof self !== "undefined" ? self : this, function () {
  const PLAN_LABELS = { free: "Free", t3: "$3 plan", t5: "$5 plan", t10: "$10 plan", owner: "Owner" };

  function creditBar(pct, plan) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    return {
      width: `${p}%`,
      cls: p >= 100 ? "full" : p >= 80 ? "warn" : "ok",
      label: `AI usage: ${p}% used`,
      planLabel: PLAN_LABELS[plan] || plan,
    };
  }

  function aiErrorMessage(status) {
    if (status === 402) return "You've used your AI credit — upgrade to continue.";
    if (status === 429) return "One moment — too many requests. Try again shortly.";
    if (status === 503) return "AI is temporarily unavailable. Your food logging still works.";
    if (status === 502) return "The AI models couldn't answer just now — try again.";
    return "Something went wrong with the AI service.";
  }

  return { creditBar, aiErrorMessage };
});
