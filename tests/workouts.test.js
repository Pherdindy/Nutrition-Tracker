const test = require("node:test");
const assert = require("node:assert");
const W = require("../www/workouts.js");

const SAT = "🪑 Sat all day (no exercise)", LIGHT = "🚶 Light activity (walked / errands)", GYM = "🏋️ Gym day (moderate workout)";
const LBS = 180, KG = 180 / 2.20462;
const met = (low, high = low) => ({ low, high });
const w = (over = {}) => ({ id: 1, date: "2026-11-23", what: "Stationary bike, zone 2", minutes: 90, kcal: null, effort: { at: 5, met: met(6, 7), why: [{ ref: "Bike", note: "n", met: 6.5, minutes: 90 }], how: "one" }, estimateStatus: "done", ...over });
const answer = (over = {}) => ({ met: met(6, 7), minutes: 60, basis: [{ ref: "Stationary bike, 90-100 W, 2024 Compendium", note: "Steady.", met: 6.5, minutes: 60 }], how: "one", ...over });
const day = (date, activity) => ({ date, activity, weight: LBS });

// ---- the list ----------------------------------------------------------------------

test("the choices people already have keep their label and multiplier", () => {
  const had = { [SAT]: 1.2, [LIGHT]: 1.375, [GYM]: 1.55, "💪 Hard gym session (intense)": 1.725, "🏃 Very active day (sports + gym)": 1.9 };
  for (const [label, multiplier] of Object.entries(had)) assert.equal(W.multiplierOf(label), multiplier, label);
  assert.equal(W.multiplierOf("Something else"), 1.2);
});

test("the list goes from little to much, has cardio, and names each choice once", () => {
  const multipliers = W.ACTIVITIES.map((a) => a.multiplier);
  assert.deepEqual(multipliers, [...multipliers].sort((a, b) => a - b));
  assert.equal(new Set(W.ACTIVITIES.map((a) => a.label)).size, 8);
  assert.deepEqual(W.ACTIVITIES.filter((a) => /cardio/i.test(a.label)).map((a) => a.multiplier), [1.4, 1.5, 1.6]);
});

test("only sitting and light activity are the rest of a day", () => {
  assert.deepEqual(W.ACTIVITIES.filter((a) => W.isRest(a.label)).map((a) => a.label), [SAT, LIGHT]);
  assert.equal(W.isRest("Something else"), false);
});

test("the last rest choice before a date", () => {
  const days = [day("2026-11-20", LIGHT), day("2026-11-22", GYM), day("2026-11-21", SAT), day("2026-11-25", LIGHT)];
  assert.equal(W.lastRest(days, "2026-11-23"), SAT);
  assert.equal(W.lastRest(days, "2026-11-21"), LIGHT, "before that day, not on it");
  assert.equal(W.lastRest(days, "2026-12-01"), LIGHT);
  assert.equal(W.lastRest(days, "2026-11-01"), SAT, "nothing before: sitting");
  assert.equal(W.lastRest([day("2026-11-22", GYM)], "2026-11-23"), SAT);
});

// ---- calories ------------------------------------------------------------------------

test("extra calories: what is above resting, for that weight and time", () => {
  const { low, high, mine } = W.burn(w(), LBS);
  assert.ok(Math.abs(low - 5 * KG * 1.5) < 1e-9 && Math.abs(high - 6 * KG * 1.5) < 1e-9);
  assert.equal(mine, undefined);
  assert.deepEqual([Math.round(low), Math.round(high)], [612, 735]);
  assert.ok(W.burn(w(), 2 * LBS).low === 2 * low, "a heavier day burns more");
  assert.ok(Math.abs(W.burn(w({ minutes: 45 }), LBS).low - low / 2) < 1e-9, "half the time, half of it");
});

test("typed calories are what they are", () => {
  assert.deepEqual(W.burn(w({ kcal: 500 }), LBS), { low: 500, high: 500, mine: true });
  assert.deepEqual(W.burn(w({ kcal: 0, effort: {} }), LBS), { low: 0, high: 0, mine: true });
});

test("the user's minutes win; the AI's count only without them", () => {
  const effort = { met: met(6), minutes: 60 };
  assert.deepEqual([W.minutesOf(w({ minutes: 0, effort })), W.minutesOf(w({ minutes: 30, effort })), W.minutesOf(w({ minutes: 0, effort: {} }))], [60, 30, 0]);
});

test("not known: no calories", () => {
  for (const unknown of [w({ effort: {} }), w({ minutes: 0 }), w({ effort: { met: null } })]) assert.equal(W.burn(unknown, LBS), null);
  assert.equal(W.burn(w(), NaN), null);
  assert.equal(W.burn(w(), 0), null);
});

test("never below zero", () => {
  assert.deepEqual(W.burn(w({ effort: { met: met(0.8, 1) } }), LBS), { low: 0, high: 0 });
});

// ---- a day -----------------------------------------------------------------------------

test("a day without workouts is what it was: BMR times the choice", () => {
  for (const { label, multiplier } of W.ACTIVITIES) {
    const t = W.total(1725, day("2026-11-23", label), []);
    assert.deepEqual([t.tdee, t.rest, t.waiting], [1725 * multiplier, label, 0]);
  }
  assert.equal(W.total(1725, day("2026-11-23", "Something else"), []).tdee, 1725 * 1.2);
  assert.equal(W.total(1725, day("2026-11-23", "Something else"), []).rest, "Something else");
});

test("workouts come on top of the rest of the day, by their middle", () => {
  const t = W.total(1725, day("2026-11-23", LIGHT), [w(), w({ id: 2, kcal: 100 })]);
  assert.ok(Math.abs(t.tdee - (1725 * 1.375 + 5.5 * KG * 1.5 + 100)) < 1e-9);
  assert.equal(t.rest, LIGHT);
  assert.deepEqual([Math.round(t.extra.low), Math.round(t.extra.mid), Math.round(t.extra.high)], [712, 774, 835]);
});

test("nothing is counted twice: a choice with a workout counts as sitting", () => {
  for (const label of W.ACTIVITIES.map((a) => a.label).filter((l) => !W.isRest(l)).concat("Something else")) {
    const t = W.total(1725, day("2026-11-23", label), [w({ kcal: 0 })]);
    assert.deepEqual([t.tdee, t.rest], [1725 * 1.2, SAT], label);
  }
});

test("a workout that is not known yet counts nothing, and is counted as waiting", () => {
  const t = W.total(1725, day("2026-11-23", SAT), [w({ effort: {}, estimateStatus: "pending" }), w({ kcal: 50 })]);
  assert.deepEqual([t.tdee, t.waiting], [1725 * 1.2 + 50, 1]);
});

// ---- as text ----------------------------------------------------------------------------

test("a choice's name without the bracket", () => {
  assert.equal(W.nameOf(SAT), "🪑 Sat all day");
  assert.equal(W.nameOf("🚴 Zone 2 cardio, about 45 min"), "🚴 Zone 2 cardio, about 45 min");
  assert.equal(W.nameOf("🏃 Hard cardio (run, intervals), about 45 min"), "🏃 Hard cardio (run, intervals), about 45 min");
});

test("a day as one line, for the assessment", () => {
  assert.equal(W.dayText(day("d", GYM), []), GYM);
  assert.equal(W.dayText(day("d", SAT), [w()]), "🪑 Sat all day + Stationary bike, zone 2, 90 min (674 kcal)");
  assert.equal(W.dayText(day("d", GYM), [w({ effort: {} }), w({ what: "Walk", minutes: 0, kcal: 120 })]),
    "🪑 Sat all day + Stationary bike, zone 2, 90 min (not estimated) + Walk (120 kcal)");
});

test("a workout as a line", () => {
  assert.deepEqual(W.line(w(), LBS), { what: "Stationary bike, zone 2", minutes: "90 min", kcal: "612–735 kcal" });
  assert.deepEqual(W.line(w({ effort: { met: met(6) } }), LBS).kcal, "612 kcal");
  assert.deepEqual(W.line(w({ kcal: 500.4 }), LBS).kcal, "500 kcal");
  assert.deepEqual(W.line(w({ minutes: 0, effort: { met: met(6), minutes: 52.5 } }), LBS).minutes, "about 53 min");
  assert.deepEqual(W.line(w({ minutes: 0, effort: {} }), LBS), { what: "Stationary bike, zone 2", minutes: "", kcal: "" });
  assert.deepEqual(W.line(w({ minutes: 22.5 }), LBS).minutes, "22.5 min");
});

// ---- saving -------------------------------------------------------------------------------

const save = (before, after, over = {}) => W.resolve({ before, after: { what: "Stationary bike, zone 2", minutes: 90, kcal: null, ...after }, askAgain: false, workouts: [], ...over });

test("a new workout waits for the AI", () => {
  assert.deepEqual(save(null, {}), { effort: {}, estimateStatus: "pending" });
});

test("typed calories need no AI, whatever else there is", () => {
  assert.deepEqual(save(null, { kcal: 500 }), { effort: {}, estimateStatus: "done" });
  assert.deepEqual(save(null, { kcal: 0, minutes: 0 }), { effort: {}, estimateStatus: "done" });
  assert.deepEqual(save(null, { kcal: 500 }, { workouts: [w({ id: 7 })] }), { effort: {}, estimateStatus: "done" }, "nor anything remembered");
  assert.deepEqual(save(w(), { kcal: 500 }), { effort: w().effort, estimateStatus: "done" }, "the AI's are kept for when they are taken away");
  assert.deepEqual(save(w({ kcal: 500 }), { kcal: null }), { effort: w().effort, estimateStatus: "done" });
  assert.deepEqual(save(w({ kcal: 500, effort: {} }), { kcal: null }), { effort: {}, estimateStatus: "pending" });
});

test("other minutes only scale", () => {
  assert.deepEqual(save(w(), { minutes: 30 }), { effort: w().effort, estimateStatus: "done" });
  const judged = w({ minutes: 0, effort: { ...w().effort, minutes: 52 } });
  assert.deepEqual(save(judged, { minutes: 0 }), { effort: judged.effort, estimateStatus: "done" });
  assert.deepEqual(save(judged, { minutes: 30 }).estimateStatus, "done");
});

test("no minutes left: asked again, and what is known stays until then", () => {
  assert.deepEqual(save(w(), { minutes: 0 }), { effort: { ...w().effort, refresh: true }, estimateStatus: "pending" });
});

test("case and spaces are not other words", () => {
  assert.deepEqual(save(w(), { what: "  stationary BIKE,  zone 2 " }), { effort: w().effort, estimateStatus: "done" });
});

test("other words are another workout", () => {
  assert.deepEqual(save(w(), { what: "Run" }), { effort: {}, estimateStatus: "pending" });
});

test("a workout logged before is reused without asking", () => {
  const past = w({ id: 7, date: "2026-11-20", minutes: 30 });
  const got = save(null, { what: "stationary bike, zone 2" }, { workouts: [past] });
  assert.deepEqual(got, { effort: { ...past.effort, from: { id: 7, date: "2026-11-20" } }, estimateStatus: "done" });
  assert.deepEqual(save(w({ what: "Run" }), {}, { workouts: [past] }).effort.from, { id: 7, date: "2026-11-20" }, "also when renamed to it");
});

test("a copy says where the first was", () => {
  const first = { id: 3, date: "2026-11-01" };
  const copy = w({ id: 9, date: "2026-11-20", effort: { ...w().effort, from: first } });
  assert.deepEqual(save(null, {}, { workouts: [copy] }).effort.from, first);
});

test("the latest answer is the one that is reused", () => {
  const a = w({ id: 1, effort: { ...w().effort, at: 50, met: met(4) } }), b = w({ id: 2, effort: { ...w().effort, at: 60, met: met(5) } });
  for (const list of [[a, b], [b, a]]) assert.deepEqual(save(null, {}, { workouts: list }).effort.met, met(5));
});

test("not reused: typed calories, no answer, one that is being asked again, itself", () => {
  const none = [w({ effort: {}, kcal: 500 }), w({ effort: {}, estimateStatus: "pending" }), w({ effort: { ...w().effort, refresh: true }, estimateStatus: "pending" })];
  for (const past of none) assert.deepEqual(save(null, {}, { workouts: [past] }), { effort: {}, estimateStatus: "pending" });
  const self = w({ id: 4, what: "Run" });
  assert.equal(save(self, { what: "Swim" }, { workouts: [w({ id: 4, what: "Swim" })] }).estimateStatus, "pending");
});

test("minutes are part of what is reused only if they were the AI's", () => {
  const judged = w({ id: 7, minutes: 0, effort: { ...w().effort, minutes: 52 } });
  assert.deepEqual(save(null, { minutes: 0 }, { workouts: [judged] }).effort.minutes, 52);
  assert.equal(save(null, { minutes: 0 }, { workouts: [w({ id: 8 })] }).estimateStatus, "pending", "nobody knows how long");
  const got = save(null, { minutes: 20 }, { workouts: [judged] });
  assert.deepEqual([got.estimateStatus, got.effort.minutes], ["done", undefined], "typed ones need none");
});

test("asking again keeps the numbers until the answer", () => {
  const asked = { effort: { ...w().effort, refresh: true }, estimateStatus: "pending" };
  assert.deepEqual(save(w(), {}, { askAgain: true }), asked);
  assert.deepEqual(save(w(asked), {}, { askAgain: true }), asked, "and once more");
  const past = w({ id: 7, date: "2026-11-20" });
  assert.deepEqual(save(null, {}, { askAgain: true, workouts: [past] }), { effort: {}, estimateStatus: "pending" }, "nothing is reused then");
});

test("asking again with calories typed: there is nothing to ask", () => {
  assert.deepEqual(save(w(), { kcal: 400 }, { askAgain: true }), { effort: w().effort, estimateStatus: "done" });
});

test("a failed or waiting one stays so until something answers it", () => {
  assert.equal(save(w({ effort: {}, estimateStatus: "error" }), {}).estimateStatus, "pending", "saved again: asked again");
  assert.equal(save(w({ effort: {}, estimateStatus: "pending" }), { minutes: 30 }).estimateStatus, "pending");
  const asking = w({ effort: { ...w().effort, refresh: true }, estimateStatus: "pending" });
  assert.deepEqual(save(asking, { minutes: 30 }), { effort: asking.effort, estimateStatus: "pending" }, "a question is not taken back by other minutes");
});

test("needsAnswer", () => {
  for (const no of [w(), w({ kcal: 5, effort: {} }), w({ minutes: 0, effort: { met: met(6), minutes: 5 } })]) assert.equal(W.needsAnswer(no), false);
  for (const yes of [w({ effort: {} }), w({ minutes: 0 }), w({ effort: { ...w().effort, refresh: true } })]) assert.equal(W.needsAnswer(yes), true);
});

// ---- the answer -------------------------------------------------------------------------

const apply = (entry, a, over = {}) => W.applyAnswer(entry, a, { now: 200, noCredit: false, ...over });

test("an answer is stored with what it is based on", () => {
  assert.deepEqual(apply(w({ effort: {}, estimateStatus: "pending" }), answer()),
    { effort: { at: 200, met: met(6, 7), why: answer().basis, how: "one" }, estimateStatus: "done" });
});

test("the AI's minutes are kept only if the user gave none", () => {
  assert.equal(apply(w({ minutes: 0, effort: {} }), answer()).effort.minutes, 60);
  assert.equal("minutes" in apply(w({ effort: {} }), answer()).effort, false);
});

test("a new answer replaces the old one whole", () => {
  const asked = w({ effort: { at: 1, met: met(3), why: [], how: "both", from: { id: 1, date: "d" }, refresh: true }, estimateStatus: "pending" });
  assert.deepEqual(apply(asked, answer()), { effort: { at: 200, met: met(6, 7), why: answer().basis, how: "one" }, estimateStatus: "done" });
});

test("an answer without what is needed is no answer", () => {
  for (const bad of [null, {}, { met: null }, { met: { low: 6 } }, { met: { low: "6", high: 7 } }, { met: met(NaN) }]) {
    assert.deepEqual(apply(w({ effort: {} }), bad), { effort: {}, estimateStatus: "error" }, JSON.stringify(bad));
  }
  assert.deepEqual(apply(w({ minutes: 0, effort: {} }), answer({ minutes: null })), { effort: {}, estimateStatus: "error" }, "nobody knows how long");
});

test("no answer: what was known stays, marked as failed", () => {
  const asked = w({ effort: { ...w().effort, refresh: true }, estimateStatus: "pending" });
  assert.deepEqual(apply(asked, null), { effort: asked.effort, estimateStatus: "error" });
});

test("no credit: asking again is taken back", () => {
  const asked = w({ effort: { ...w().effort, refresh: true }, estimateStatus: "pending" });
  assert.deepEqual(apply(asked, null, { noCredit: true }), { effort: w().effort, estimateStatus: "done" });
  assert.deepEqual(apply(w({ effort: {}, estimateStatus: "pending" }), null, { noCredit: true }), { effort: {}, estimateStatus: "error" });
  const nothingElse = w({ minutes: 0, effort: { ...w().effort, refresh: true }, estimateStatus: "pending" });
  assert.deepEqual(apply(nothingElse, null, { noCredit: true }).estimateStatus, "error", "it cannot go back to having no minutes");
});

test("odd extras of an answer are left out", () => {
  const got = apply(w({ effort: {} }), answer({ met: { low: 6, high: 7, x: 1 }, basis: [1, 2, 3].map((n) => ({ ref: `r${n}` })), how: undefined, extra: "x" }));
  assert.deepEqual([got.effort.why.length, got.effort.how, "extra" in got.effort, got.effort.met], [2, "average", false, met(6, 7)]);
  assert.deepEqual(apply(w({ effort: {} }), answer({ basis: undefined, how: undefined })).effort, { at: 200, met: met(6, 7), why: [], how: "one" });
});

// ---- as explained ---------------------------------------------------------------------

test("how it was worked out", () => {
  const two = w({ effort: { at: 1, met: met(6, 6.8), why: [{ ref: "Bike, 90–100 W", note: "Steady effort.", met: 6, minutes: 90 }, { ref: "Bike, 101–125 W", note: "Steady effort.", met: 6.8, minutes: 90 }], how: "average" } });
  assert.deepEqual(W.explain(two, LBS, "2026-11-23"), [
    "Based on Bike, 90–100 W; Bike, 101–125 W",
    "Two estimates, 6 and 6.8 times resting energy, averaged",
    "6–6.8 times resting for 90 min at 81.6 kg, less what you burn anyway: 612–710 kcal",
    "Steady effort.",
    "The AI works from what it knows about exercise. It does not look values up.",
  ]);
});

test("what both say is said once", () => {
  const est = { ref: "Bike", note: "Steady.", met: 6, minutes: 90 };
  const lines = W.explain(w({ effort: { at: 1, met: met(6), why: [est, est], how: "average" } }), LBS, "2026-11-23");
  assert.deepEqual([lines[0], lines.filter((l) => l === "Steady.").length, lines[2]], ["Based on Bike", 1, "6 times resting for 90 min at 81.6 kg, less what you burn anyway: 612 kcal"]);
});

test("one estimate, and two that disagreed", () => {
  const lines = (how, why) => W.explain(w({ effort: { at: 1, met: met(5, 8), why, how } }), LBS, "2026-11-23")[1];
  const est = (m) => ({ ref: "x", note: "", met: m, minutes: 90 });
  assert.equal(lines("one", [est(6.5)]), "One estimate, 6.5 times resting energy");
  assert.equal(lines("both", [est(5), est(8)]), "Two estimates, 5 and 8 times resting energy, disagreed, so the range covers both");
  assert.equal(lines("one", [{ ref: "x", note: "" }]), "One estimate");
});

test("assumed minutes, typed calories, remembered, nothing to say", () => {
  const judged = w({ minutes: 0, effort: { ...w().effort, minutes: 52 } });
  assert.ok(W.explain(judged, LBS, "2026-11-23").includes("6–7 times resting for about 52 min at 81.6 kg, less what you burn anyway: 354–425 kcal"));
  assert.deepEqual(W.explain(w({ kcal: 500 }), LBS, "2026-11-23"), ["The calories are your number"]);
  const from = w({ effort: { ...w().effort, from: { id: 1, date: "2026-11-20" } } });
  assert.ok(W.explain(from, LBS, "2026-11-23").includes("Effort from Nov 20"));
  assert.equal(W.tag(from, "2026-11-23"), "from Nov 20");
  assert.equal(W.tag(from, "2027-01-02"), "from Nov 20, 2026");
  assert.equal(W.tag(w({ kcal: 5, effort: from.effort }), "2026-11-23"), "", "typed calories are not from then");
  assert.equal(W.tag(w(), "2026-11-23"), "");
  assert.deepEqual(W.explain(w({ effort: {}, estimateStatus: "pending" }), LBS, "2026-11-23"), []);
});

// ---- suggestions ---------------------------------------------------------------------

test("earlier workouts, each once, the latest first, with its minutes", () => {
  const list = [w({ id: 1, date: "2026-11-01", what: "Run", minutes: 20 }), w({ id: 2, date: "2026-11-05", what: "run ", minutes: 30 }), w({ id: 3, date: "2026-11-03", what: "Swim", minutes: 0 })];
  assert.deepEqual(W.suggestions(list), [{ what: "run", minutes: 30 }, { what: "Swim", minutes: 0 }]);
  assert.deepEqual(W.suggestions([]), []);
});
