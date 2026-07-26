// Pure content model + navigation helpers for the first-run walkthrough.
// UMD: usable as a browser global (window.Tutorial) and a Node module.
// No DOM here — rendering lives in app.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Tutorial = api;
})(typeof self !== "undefined" ? self : this, function () {
  // Each slide: { id, title, caption, art }. `art` names a mini-mockup that
  // app.js renders; `title`/`caption` are set via textContent (plain text).
  const SLIDES = [
    {
      id: "welcome",
      title: "Welcome to Lazy Macros",
      caption: "Track calories and macros the lazy way. Here's a quick tour.",
      art: "welcome",
    },
    {
      id: "food",
      title: "Log your food",
      caption: "Tap the + button, snap a photo, or batch-add several at once — the AI fills in the calories and macros for you.",
      art: "food",
    },
    {
      id: "days",
      title: "Days & activity",
      caption: "Each day logs your weight and activity level. Your activity sets your calorie burn — and your daily target.",
      art: "days",
    },
    {
      id: "targets",
      title: "Your targets",
      caption: "Set your height, age, protein goal, and weight-loss goal. We compute your calorie and protein targets automatically.",
      art: "targets",
    },
    {
      id: "assess",
      title: "Diet assessment",
      caption: "Get an AI review of your eating over any period — what's working, and what to fix.",
      art: "assess",
    },
    {
      id: "done",
      title: "You're all set",
      caption: "Tap + on the Food tab to log your first meal. Reopen this any time from Targets.",
      art: "done",
    },
  ];

  function slideCount() { return SLIDES.length; }

  function clampIndex(i) {
    i = Math.trunc(Number(i));
    if (!Number.isFinite(i) || i < 0) return 0;
    const max = SLIDES.length - 1;
    return i > max ? max : i;
  }

  function next(i) { return clampIndex(clampIndex(i) + 1); }
  function prev(i) { return clampIndex(clampIndex(i) - 1); }
  function isFirst(i) { return clampIndex(i) === 0; }
  function isLast(i) { return clampIndex(i) === SLIDES.length - 1; }

  // The flag is only ever stored as "1" or left absent; any non-empty value = "seen".
  function shouldAutoShow(seenFlagValue) { return !seenFlagValue; }

  return { SLIDES, slideCount, clampIndex, next, prev, isFirst, isLast, shouldAutoShow };
});
