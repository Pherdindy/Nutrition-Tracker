// Pure logic for global calorie-deficit / protein-target / age goals, plus day-card display helpers.
// UMD: usable as a browser global (window.Targets) and a Node module.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Targets = api;
})(typeof self !== "undefined" ? self : this, function () {
  const GOALS = [
    { goal: "Maintain", daily: 0 },
    { goal: "0.25 kg/week", daily: 275 },
    { goal: "0.50 kg/week", daily: 550 },
    { goal: "0.75 kg/week", daily: 825 },
    { goal: "1.00 kg/week", daily: 1100 },
  ];

  function deficitForGoal(label) {
    const g = GOALS.find((x) => x.goal === label);
    return g ? g.daily : 550;
  }

  function migrateDay(day) {
    if (!day) return day;
    return { id: day.id, date: day.date, weight: day.weight, activity: day.activity };
  }

  function goalForDeficit(daily) {
    const g = GOALS.find((x) => x.daily === Number(daily));
    return g ? g.goal : "0.50 kg/week";
  }

  function migrateProfile(profile, days) {
    const out = { ...profile };
    if (out.age == null) {
      const d = (days || []).find((x) => x.age != null);
      out.age = d ? Number(d.age) : 32;
    }
    if (out.weightLossGoal == null) {
      const d = (days || []).find((x) => x.deficit != null);
      out.weightLossGoal = d ? goalForDeficit(d.deficit) : "0.50 kg/week";
    }
    return out;
  }

  // ---- Day-card display helpers (pure) ----
  // tone: "good" | "bad" | "warn" | "neutral". Invalid input -> empty text so
  // callers can fall back to their legacy rendering.
  const EMPTY_DISPLAY = { text: "", tone: "neutral", icon: "" };

  function rangeText(lo, hi) {
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  }

  function calDeltaDisplay(overLow, overHigh) {
    if (!Number.isFinite(overLow) || !Number.isFinite(overHigh)) return { ...EMPTY_DISPLAY };
    const lo = Math.round(Math.min(overLow, overHigh));
    const hi = Math.round(Math.max(overLow, overHigh));
    // Neutral: range touches/straddles zero, or sits entirely inside the ±50
    // band (same threshold as surplusClass in app.js).
    if ((lo <= 0 && hi >= 0) || (lo >= -50 && hi <= 50)) {
      return { text: "on target", tone: "neutral", icon: "" };
    }
    if (hi < 0) {
      return { text: `${rangeText(Math.abs(hi), Math.abs(lo))} under target`, tone: "good", icon: "" };
    }
    return { text: `${rangeText(lo, hi)} over target`, tone: "bad", icon: "" };
  }

  // Met = intake low end reaches the target low; exceeding the target high is
  // still "met" (protein surplus is good — same semantics as proteinSurplusClass).
  function proteinStatusDisplay(proLow, proHigh, targetLow, targetHigh) {
    if (![proLow, proHigh, targetLow, targetHigh].every(Number.isFinite)) return { ...EMPTY_DISPLAY };
    const lo = Math.round(Math.min(proLow, proHigh));
    const hi = Math.round(Math.max(proLow, proHigh));
    const text = `${rangeText(lo, hi)} g (target ${rangeText(targetLow, targetHigh)})`;
    if (lo >= targetLow) return { text, tone: "good", icon: "✓" };
    if (hi < targetLow) return { text, tone: "bad", icon: "✗" };
    return { text, tone: "warn", icon: "~" };
  }

  return { GOALS, deficitForGoal, migrateDay, migrateProfile, calDeltaDisplay, proteinStatusDisplay };
});
