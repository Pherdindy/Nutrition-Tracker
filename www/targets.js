// Pure logic for global calorie-deficit / protein-target / age goals.
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

  return { GOALS, deficitForGoal, migrateDay, migrateProfile };
});
