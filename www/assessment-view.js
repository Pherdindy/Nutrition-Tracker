// Pure view-model helpers for the simplified mobile diet assessment.
// UMD: usable as a browser global (window.AssessmentView) and a Node module.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssessmentView = api;
})(typeof self !== "undefined" ? self : this, function () {
  function verdictLine(score) {
    if (score >= 9) return "Excellent week";
    if (score >= 7.5) return "Solid week — a few gaps";
    if (score >= 6) return "Decent — room to improve";
    if (score >= 4) return "Needs work";
    return "Rough week — let's reset";
  }

  function calorieChip(status) {
    if (status === "on_target") return { label: "Calories on target", tone: "ok" };
    if (status === "surplus") return { label: "Calorie surplus", tone: "bad" };
    return { label: "Under target", tone: "warn" }; // deficit / unknown
  }

  function proteinChip(status) {
    if (status === "excellent") return { label: "Protein excellent", tone: "ok" };
    if (status === "good") return { label: "Protein good", tone: "ok" };
    if (status === "adequate") return { label: "Protein adequate", tone: "warn" };
    return { label: "Protein low", tone: "bad" }; // deficient / unknown
  }

  const _STATUS_SCORE = { good: 3, adequate: 2, low: 1, critically_low: 0.5, missing: 0 };

  function varietyChip(data) {
    const groups = (data && data.food_groups) || {};
    const vals = Object.values(groups).map((g) => _STATUS_SCORE[g && g.status] ?? 1);
    if (!vals.length) return { label: "Low variety", tone: "bad" };
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg >= 2.5) return { label: "Great variety", tone: "ok" };
    if (avg >= 1.5) return { label: "Decent variety", tone: "warn" };
    return { label: "Low variety", tone: "bad" };
  }

  function topActions(data, n) {
    if (!data) return [];
    const out = [];
    for (const s of data.suggestions || []) {
      if (s && s.food) out.push({ kind: "add", text: `Add ${s.food}${s.reason ? " — " + s.reason : ""}` });
    }
    const sr = (data.action_plan && data.action_plan.stop_and_replace) || [];
    for (const r of sr) {
      if (r && r.stop) out.push({ kind: "stop", text: `Swap ${r.stop}${r.replace_with ? " → " + r.replace_with : ""}` });
    }
    return out.slice(0, n || 3);
  }

  return { verdictLine, calorieChip, proteinChip, varietyChip, topActions };
});
