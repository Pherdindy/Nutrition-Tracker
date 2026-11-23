// A day's activity and its workouts: what they burn, what is remembered, the AI's answer
// and how it is explained. Pure: no DOM, no network, no storage.
// UMD: usable as a browser global (window.Workouts) and a Node module.
//
// A workout's calories are always the extra ones, above resting. A day's total is the rest
// of the day plus the workouts, so nothing may be in both.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Workouts = api;
})(typeof self !== "undefined" ? self : this, function () {
  // The labels are stored in `days`. rest: can be the rest of a day with workouts; the
  // others already include a workout.
  const ACTIVITIES = [
    { label: "\u{1FA91} Sat all day (no exercise)", multiplier: 1.2, rest: true },
    { label: "\u{1F6B6} Light activity (walked / errands)", multiplier: 1.375, rest: true },
    { label: "\u{1F6B4} Zone 2 cardio, about 45 min", multiplier: 1.4 },
    { label: "\u{1F3C3} Hard cardio (run, intervals), about 45 min", multiplier: 1.5 },
    { label: "\u{1F3CB}️ Gym day (moderate workout)", multiplier: 1.55 },
    { label: "\u{1F6B4} Zone 2 cardio, 90 min or more", multiplier: 1.6 },
    { label: "\u{1F4AA} Hard gym session (intense)", multiplier: 1.725 },
    { label: "\u{1F3C3} Very active day (sports + gym)", multiplier: 1.9 },
  ];
  const SITTING = ACTIVITIES[0].label;
  const choice = (label) => ACTIVITIES.find((a) => a.label === label) || {};
  const isRest = (label) => !!choice(label).rest;
  const multiplierOf = (label) => choice(label).multiplier || ACTIVITIES[0].multiplier;

  // The last time nothing but the rest of a day was chosen, before this date.
  function lastRest(days, before) {
    const last = days.filter((d) => d.date < before && isRest(d.activity)).reduce((a, b) => (a && a.date > b.date ? a : b), null);
    return last ? last.activity : SITTING;
  }

  // ---- Calories --------------------------------------------------------------------

  const KG = 1 / 2.20462;
  const minutesOf = (w) => (w.minutes > 0 ? w.minutes : w.effort.minutes > 0 ? w.effort.minutes : 0);

  // { low, high } extra calories, or null if they are not known (yet).
  function burn(w, lbs) {
    if (w.kcal != null) return { low: w.kcal, high: w.kcal, mine: true };
    const { met } = w.effort, hours = minutesOf(w) / 60;
    if (!met || !(hours > 0) || !(lbs > 0)) return null;
    const extra = (m) => Math.max(0, m - 1) * lbs * KG * hours;
    return { low: extra(met.low), high: extra(met.high) };
  }

  function total(bmr, day, workouts) {
    const rest = workouts.length && !isRest(day.activity) ? SITTING : day.activity;
    let low = 0, high = 0, waiting = 0;
    for (const w of workouts) {
      const b = burn(w, day.weight);
      if (b) { low += b.low; high += b.high; } else waiting++;
    }
    const mid = (low + high) / 2;
    return { rest, tdee: bmr * multiplierOf(rest) + mid, extra: { low, high, mid }, waiting };
  }

  // ---- As text -----------------------------------------------------------------------

  const tenth = (n) => Math.round(n * 10) / 10;
  const range = (low, high) => (low === high ? `${low}` : `${low}–${high}`);
  const kcalText = ({ low, high }) => `${range(Math.round(low), Math.round(high))} kcal`;
  const minutesText = (w) => (w.minutes > 0 ? `${tenth(w.minutes)} min` : minutesOf(w) ? `about ${Math.round(minutesOf(w))} min` : "");
  const nameOf = (label) => label.replace(/\s*\([^()]*\)$/, "");

  function line(w, lbs) {
    const b = burn(w, lbs);
    return { what: w.what, minutes: minutesText(w), kcal: b ? kcalText(b) : "" };
  }

  // A day's activity in one line, as the assessment is told.
  function dayText(day, workouts) {
    if (!workouts.length) return day.activity;
    const said = workouts.map((w) => {
      const b = burn(w, day.weight), minutes = minutesText(w);
      return `${w.what}${minutes && `, ${minutes}`} (${b ? `${Math.round((b.low + b.high) / 2)} kcal` : "not estimated"})`;
    });
    return [nameOf(total(0, day, workouts).rest), ...said].join(" + ");
  }

  // ---- Typing ------------------------------------------------------------------------

  // "90", "1:30", "1h30", "1.5 h", "1 hour 30 minutes", "45 min"; 0 if empty, null if it
  // cannot be meant. No commas: 1,5 would be a guess.
  function minutesFrom(text) {
    const t = String(text).trim().toLowerCase();
    if (!t) return 0;
    const plain = /^(\d+(?:\.\d+)?)\s*(?:m|mins?|minutes?)?$/.exec(t), clock = /^(\d{1,2}):([0-5]\d)$/.exec(t);
    const hours = /^(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)\s*(?:(\d+)\s*(?:m|mins?|minutes?)?)?$/.exec(t);
    const n = plain ? Number(plain[1]) : clock ? clock[1] * 60 + Number(clock[2]) : hours ? hours[1] * 60 + Number(hours[2] || 0) : NaN;
    return n > 0 && n <= 1440 ? n : null;
  }
  function kcalFrom(text) {
    const t = String(text).trim();
    return /^\d+(\.\d+)?$/.test(t) && Number(t) <= 9999 ? Number(t) : null;
  }

  // What is typed about a workout: its values, and what is wrong by field.
  function typed({ what, minutes, kcal }) {
    const values = { what: what.trim(), minutes: minutesFrom(minutes), kcal: kcalFrom(kcal) }, errors = {};
    if (!values.what) errors.what = "Say what you did";
    if (values.minutes === null) errors.minutes = "Enter minutes from 1 to 1,440, like 90 or 1:30";
    if (kcal.trim() && values.kcal === null) errors.kcal = "Enter calories from 0 to 9,999";
    return { values, errors, blank: !(what + minutes + kcal).trim() };
  }

  // ---- Saving ------------------------------------------------------------------------

  const words = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  const sameWorkout = (a, b) => words(a) === words(b);

  const needsAnswer = (w) => w.kcal == null && (!w.effort.met || !minutesOf(w) || !!w.effort.refresh);

  // The latest answer for the same words: what a new log of this workout starts from.
  function findRemembered(workouts, { what, minutes }, exceptId) {
    return workouts
      .filter((e) => e.id !== exceptId && sameWorkout(e.what, what) && e.effort.met && !e.effort.refresh && (minutes > 0 || e.effort.minutes > 0))
      .reduce((a, b) => (a && a.effort.at >= b.effort.at ? a : b), null);
  }

  // What a workout is saved with besides what the user typed (`after`).
  function resolve({ before, after, askAgain = false, workouts }) {
    let effort = before && sameWorkout(before.what, after.what) ? before.effort : {};
    if (after.kcal == null && !effort.met && !askAgain) {
      const found = findRemembered(workouts, after, before && before.id);
      if (found) {
        effort = { ...found.effort, from: found.effort.from || { id: found.id, date: found.date } };
        if (after.minutes > 0) delete effort.minutes;
      }
    }
    if (after.kcal == null && effort.met && (askAgain || !minutesOf({ ...after, effort }))) {
      effort = { ...effort, refresh: true }; // it stays until the answer
    }
    return { effort, estimateStatus: needsAnswer({ ...after, effort }) ? "pending" : "done" };
  }

  // answer: what the proxy says, or null.
  function applyAnswer(w, answer, { now, noCredit = false }) {
    const met = answer && answer.met;
    const usable = met && [met.low, met.high].every(Number.isFinite) && (w.minutes > 0 || answer.minutes > 0);
    if (!usable) {
      if (noCredit && w.effort.refresh) { // asking again is taken back, if it was asked at all
        const { refresh, ...effort } = w.effort;
        if (!needsAnswer({ ...w, effort })) return { effort, estimateStatus: "done" };
      }
      return { effort: w.effort, estimateStatus: "error" };
    }
    const why = (answer.basis || []).slice(0, 2);
    const effort = { at: now, met: { low: met.low, high: met.high }, why, how: answer.how || (why.length > 1 ? "average" : "one") };
    if (!(w.minutes > 0)) effort.minutes = answer.minutes;
    return { effort, estimateStatus: "done" };
  }

  // ---- Explaining ----------------------------------------------------------------------

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function tag(w, today) {
    const { from } = w.effort;
    if (!from || w.kcal != null) return "";
    const [year, month, date] = from.date.split("-").map(Number);
    return `from ${MONTHS[month - 1]} ${date}${from.date.slice(0, 4) === today.slice(0, 4) ? "" : `, ${year}`}`;
  }

  function explain(w, lbs, today) {
    if (w.kcal != null) return ["The calories are your number"];
    const { met, why = [], how } = w.effort, b = burn(w, lbs), lines = [];
    if (!met) return lines;
    const refs = [...new Set(why.map((e) => e.ref).filter(Boolean))];
    if (refs.length) lines.push(`Based on ${refs.join("; ")}`);
    const efforts = why.map((e) => e.met).filter((m) => m > 0);
    const say = efforts.length && efforts.length === why.length ? `, ${efforts.map(tenth).join(" and ")} times resting energy` : "";
    lines.push(how === "both" ? `Two estimates${say}, disagreed, so the range covers both`
      : why.length > 1 ? `Two estimates${say}, averaged`
      : `One estimate${say}`);
    if (b) lines.push(`${range(tenth(met.low), tenth(met.high))} times resting for ${minutesText(w)} at ${tenth(lbs * KG)} kg, less what you burn anyway: ${kcalText(b)}`);
    lines.push(...new Set(why.map((e) => e.note).filter(Boolean)));
    lines.push("The AI works from what it knows about exercise. It does not look values up.");
    if (w.effort.from) lines.push(`Effort ${tag(w, today)}`);
    return lines;
  }

  // Earlier workouts by their words, the latest first.
  function suggestions(workouts) {
    const seen = new Map();
    for (const w of [...workouts].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))) {
      if (!seen.has(words(w.what))) seen.set(words(w.what), { what: w.what.trim(), minutes: w.minutes });
    }
    return [...seen.values()];
  }

  return {
    ACTIVITIES, isRest, multiplierOf, lastRest, nameOf,
    minutesOf, burn, total, line, dayText,
    typed, sameWorkout, needsAnswer, findRemembered, resolve, applyAnswer,
    tag, explain, suggestions,
  };
});
