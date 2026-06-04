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

  return { GOALS, deficitForGoal };
});
