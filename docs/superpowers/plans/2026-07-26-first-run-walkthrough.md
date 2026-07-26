# First-Run Animated Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app, video-like animated walkthrough that plays once for first-time users (right after onboarding) and is re-openable from a "How to use" button in Targets.

**Architecture:** A new pure UMD module `www/tutorial.js` holds the 6-slide content model and navigation helpers (unit-tested). A full-screen overlay `#tutorial-view` (direct child of `<body>`, like `#auth-view`/`#onboarding-view`) is styled in `www/styles.css` with theme variables only. All DOM rendering, navigation, auto-advance, swipe, focus handling, and the auto-show/replay triggers live in `www/app.js`. No data-layer, Supabase, or auth changes.

**Tech Stack:** Vanilla JS (UMD module pattern matching `theme.js`/`targets.js`), Node's built-in `node --test` runner, plain CSS with existing theme custom-properties, Capacitor WebView (mobile-first).

**Spec:** `docs/superpowers/specs/2026-07-26-first-run-walkthrough-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `www/tutorial.js` | Create | Pure `window.Tutorial`: `SLIDES` content model + `slideCount`/`clampIndex`/`next`/`prev`/`isFirst`/`isLast`/`shouldAutoShow`. No DOM. |
| `tests/tutorial.test.js` | Create | Unit tests for the module (runs under `npm test`). |
| `www/index.html` | Modify | Add `#tutorial-view` overlay, `<script src="tutorial.js">` include, and the "How to use" settings-card button in Targets. |
| `www/styles.css` | Modify | `.tutorial-*` / `.tut-*` styles (theme vars only) + reduced-motion media query. |
| `www/app.js` | Modify | Tutorial rendering + art, open/close, navigation, auto-advance, swipe, focus trap, and auto-show/replay wiring. |

**Key names used across tasks (keep identical):**
- Module (Task 1): `Tutorial.SLIDES`, `slideCount()`, `clampIndex(i)`, `next(i)`, `prev(i)`, `isFirst(i)`, `isLast(i)`, `shouldAutoShow(v)`.
- Element IDs (Tasks 2–3): `#tutorial-view`, `#tut-viewport`, `#tut-dots`, `#tut-progress-fill`, `#tut-back`, `#tut-skip`, `#tut-next`, `#tutorial-replay-btn`.
- `art` keys (Tasks 1 & 3): `"welcome"`, `"food"`, `"days"`, `"targets"`, `"assess"`, `"done"`.
- localStorage flag: `nt_tutorial_seen` (raw `localStorage`, NOT the per-user `lsGet`/`lsSet`).

---

## Task 1: Pure module `tutorial.js` + unit tests

**Files:**
- Create: `tests/tutorial.test.js`
- Create: `www/tutorial.js`

- [ ] **Step 1: Write the failing test**

Create `tests/tutorial.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const Tut = require("../www/tutorial.js");

test("slideCount is 6 and SLIDES has 6 entries", () => {
  assert.equal(Tut.slideCount(), 6);
  assert.equal(Tut.SLIDES.length, 6);
});

test("every slide has non-empty id, title, caption, art strings", () => {
  const arts = [];
  for (const s of Tut.SLIDES) {
    assert.ok(s.id && typeof s.id === "string", "id");
    assert.ok(s.title && typeof s.title === "string", "title");
    assert.ok(s.caption && typeof s.caption === "string", "caption");
    assert.ok(s.art && typeof s.art === "string", "art");
    arts.push(s.art);
  }
  assert.deepEqual(arts, ["welcome", "food", "days", "targets", "assess", "done"]);
});

test("clampIndex bounds the index into range", () => {
  assert.equal(Tut.clampIndex(-3), 0);
  assert.equal(Tut.clampIndex(0), 0);
  assert.equal(Tut.clampIndex(3), 3);
  assert.equal(Tut.clampIndex(5), 5);
  assert.equal(Tut.clampIndex(99), 5);
  assert.equal(Tut.clampIndex(2.9), 2);
  assert.equal(Tut.clampIndex(NaN), 0);
  assert.equal(Tut.clampIndex(undefined), 0);
});

test("next and prev clamp at the ends", () => {
  assert.equal(Tut.next(0), 1);
  assert.equal(Tut.next(5), 5);
  assert.equal(Tut.prev(5), 4);
  assert.equal(Tut.prev(0), 0);
});

test("isFirst and isLast at boundaries and middle", () => {
  assert.equal(Tut.isFirst(0), true);
  assert.equal(Tut.isFirst(1), false);
  assert.equal(Tut.isLast(5), true);
  assert.equal(Tut.isLast(4), false);
});

test("shouldAutoShow is true only when the flag is falsy/absent", () => {
  assert.equal(Tut.shouldAutoShow(null), true);
  assert.equal(Tut.shouldAutoShow(undefined), true);
  assert.equal(Tut.shouldAutoShow(""), true);
  assert.equal(Tut.shouldAutoShow("1"), false);
  assert.equal(Tut.shouldAutoShow("anything"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — the `tutorial.test.js` suite errors with `Cannot find module '../www/tutorial.js'` (other suites still pass).

- [ ] **Step 3: Write the module**

Create `www/tutorial.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all suites pass, `fail 0`. The new `tutorial.test.js` adds 6 passing tests to the suite.

- [ ] **Step 5: Commit**

```bash
git add www/tutorial.js tests/tutorial.test.js
git commit -m "feat(tutorial): pure slide model + navigation helpers with tests"
```

---

## Task 2: Overlay markup, replay button, script include, and styles

No unit test (static HTML/CSS). Verification = `npm test` still green + a visual DevTools check.

**Files:**
- Modify: `www/index.html` (overlay, replay button, script include)
- Modify: `www/styles.css` (append `.tut-*` styles)

- [ ] **Step 1: Add the `<script>` include for the module**

In `www/index.html`, find:

```html
  <script src="auth-view.js"></script>
  <script src="app.js"></script>
```

Replace with (adds `tutorial.js` before `app.js` so `window.Tutorial` exists when app.js runs):

```html
  <script src="auth-view.js"></script>
  <script src="tutorial.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 2: Add the "How to use" button to the Targets tab**

In `www/index.html`, find:

```html
            <button type="submit" class="btn btn-primary">Save Profile</button>
          </form>
        </div>
        <div id="provider-settings"></div>
```

Replace with (inserts a new settings-card between the profile card and the provider-settings mount point):

```html
            <button type="submit" class="btn btn-primary">Save Profile</button>
          </form>
        </div>
        <div class="settings-card">
          <h2>Help</h2>
          <p class="settings-hint">New here? Replay the quick tour of the app.</p>
          <button type="button" id="tutorial-replay-btn" class="btn btn-secondary">How to use</button>
        </div>
        <div id="provider-settings"></div>
```

- [ ] **Step 3: Add the `#tutorial-view` overlay (direct child of `<body>`)**

In `www/index.html`, find (the end of the onboarding overlay, immediately before the first script tag):

```html
  </div>
  <script src="vendor/supabase.min.js"></script>
```

Replace with (inserts the tutorial overlay as a sibling of `#auth-view`/`#onboarding-view`, NOT inside `.app`):

```html
  </div>

  <!-- FIRST-RUN WALKTHROUGH (tutorial overlay) -->
  <div id="tutorial-view" class="tutorial-view hidden" role="dialog" aria-modal="true" aria-label="How to use Lazy Macros">
    <div class="tut-card">
      <div class="tut-progress"><div class="tut-progress-fill" id="tut-progress-fill"></div></div>
      <div class="tut-viewport" id="tut-viewport"></div>
      <div class="tut-dots" id="tut-dots"></div>
      <div class="tut-controls">
        <button type="button" id="tut-back">Back</button>
        <span class="tut-spacer"></span>
        <button type="button" id="tut-skip">Skip</button>
        <button type="button" id="tut-next" class="btn btn-primary">Next</button>
      </div>
    </div>
  </div>

  <script src="vendor/supabase.min.js"></script>
```

- [ ] **Step 4: Append the styles**

Append this block to the END of `www/styles.css` (theme variables only — no hardcoded colors; sits above modals/auth at `z-index: 300`):

```css
/* ============================================================
   FIRST-RUN WALKTHROUGH (tutorial)
   ============================================================ */
.settings-hint { color: var(--text-dim); font-size: 0.85rem; margin: 0 0 10px; }

.tutorial-view {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  overflow-y: auto;
  padding: 24px 16px;
}
.tut-card {
  width: 100%;
  max-width: 400px;
  margin: auto;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 20px 20px 16px;
  display: flex;
  flex-direction: column;
}
.tut-progress { height: 4px; background: var(--surface2); border-radius: 999px; overflow: hidden; margin-bottom: 16px; }
.tut-progress-fill { height: 100%; width: 16.6%; background: var(--primary); border-radius: 999px; transition: width .35s ease; }

.tut-viewport { position: relative; min-height: 300px; }
.tut-slide {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity .35s ease;
}
.tut-slide.active { opacity: 1; pointer-events: auto; }
.tut-art { height: 175px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; width: 100%; }
.tut-title { margin: 0 0 6px; font-size: 1.25rem; color: var(--text); }
.tut-caption { margin: 0; color: var(--text-dim); font-size: 0.92rem; line-height: 1.45; max-width: 300px; }

.tut-dots { display: flex; justify-content: center; gap: 8px; margin: 16px 0 12px; }
.tut-dot { width: 8px; height: 8px; padding: 0; border-radius: 50%; border: none; background: var(--surface2); cursor: pointer; }
.tut-dot.active { background: var(--primary); }

.tut-controls { display: flex; align-items: center; gap: 8px; }
.tut-spacer { flex: 1; }
#tut-back, #tut-skip { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 0.9rem; padding: 8px 4px; }
#tut-back:disabled { visibility: hidden; }
#tut-next { min-width: 104px; }

/* ---- Slide art ---- */
.tut-emblem { position: relative; display: flex; align-items: center; justify-content: center; }
.tut-ring { width: 132px; height: 132px; }
.tut-ring .bg { stroke: var(--surface2); }
.tut-ring .fg { stroke: var(--primary); stroke-linecap: round; }
.tut-score { position: absolute; font-size: 1.8rem; font-weight: 700; color: var(--text); }
.tut-emblem-pulse { animation: tut-pulse 2.6s ease-in-out infinite; }

.tut-phone {
  position: relative;
  width: 190px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tut-bar { height: 12px; border-radius: 6px; background: var(--surface2); }
.tut-bar.short { width: 60%; }
.tut-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--text);
  background: var(--surface2);
  border-radius: 8px;
  padding: 7px 10px;
}
.tut-row.hi { outline: 2px solid var(--primary); }
.tut-arrow { text-align: center; color: var(--text-dim); font-size: 1rem; line-height: 1; }
.tut-chip { align-self: center; font-size: 0.76rem; color: #fff; background: var(--primary); border-radius: 999px; padding: 4px 12px; }

.tut-fabs { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 8px; }
.tut-fab {
  width: 34px; height: 34px; border-radius: 50%;
  background: var(--fab-bg); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 8px rgba(0,0,0,.3);
}
.tut-fab.tut-fab2 { background: var(--primary); }
.tut-pulse { animation: tut-pulse 1.8s ease-in-out infinite; }

.tut-check-svg { width: 122px; height: 122px; }
.tut-check-svg circle { fill: var(--green); }
.tut-check-svg path { stroke: #fff; }

@keyframes tut-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }

@media (prefers-reduced-motion: reduce) {
  .tut-slide, .tut-progress-fill { transition: none; }
  .tut-emblem-pulse, .tut-pulse { animation: none; }
}
```

- [ ] **Step 5: Verify no regression + overlay is present**

Run: `npm test`
Expected: PASS — `fail 0` (HTML/CSS changes don't affect tests).

Then structurally confirm the overlay exists as a direct child of `<body>` (not inside `.app`): search `www/index.html` for `id="tutorial-view"` and confirm it appears AFTER the `</div>` that closes `#onboarding-view` and BEFORE `<script src="vendor/supabase.min.js">`.

- [ ] **Step 6: Commit**

```bash
git add www/index.html www/styles.css
git commit -m "feat(tutorial): overlay markup, replay button, and styles"
```

---

## Task 3: Wire up rendering, navigation, auto-advance, and triggers in app.js

No unit test (DOM behavior). Verification = `npm test` still green + DevTools/emulator interaction.

**Files:**
- Modify: `www/app.js`

- [ ] **Step 1: Add the tutorial state + functions block**

In `www/app.js`, find:

```js
let _appStarted = false;

function maybeShowOnboarding() {
```

Replace with (inserts the entire tutorial block BEFORE `let _appStarted = false;`, leaving those two existing lines intact at the end):

```js
// ============================================================
// FIRST-RUN WALKTHROUGH (tutorial) — depends on window.Tutorial
// ============================================================
const TUT_ADVANCE_MS = 4500;
let _tutIndex = 0;
let _tutTimer = null;
let _tutAuto = false;        // is auto-advance currently active?
let _tutFromAuto = false;    // was this open triggered by the first-run auto-show?
let _tutReturnFocus = null;  // element to restore focus to on close
let _tutRendered = false;    // slides built once
let _tutTouchX = null;       // swipe start x

function tutReduceMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// Trusted, static illustration markup per slide `art` key (no user data → innerHTML is safe).
function tutArtHtml(key) {
  switch (key) {
    case "welcome":
      return '<div class="tut-emblem tut-emblem-pulse"><svg class="tut-ring" viewBox="0 0 120 120" fill="none">' +
        '<circle class="bg" cx="60" cy="60" r="50" stroke-width="10"/>' +
        '<circle class="fg" cx="60" cy="60" r="50" stroke-width="10" stroke-dasharray="235 314" transform="rotate(-90 60 60)"/>' +
        '</svg><span class="tut-score" style="font-size:1.4rem">LM</span></div>';
    case "food":
      return '<div class="tut-phone">' +
        '<div class="tut-bar"></div><div class="tut-bar short"></div><div class="tut-bar"></div><div class="tut-bar short"></div>' +
        '<div class="tut-fabs">' +
          '<span class="tut-fab tut-pulse"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span>' +
          '<span class="tut-fab tut-fab2 tut-pulse"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3l2-2h8l2 2h3v12H3z"/><circle cx="12" cy="13" r="3.5"/></svg></span>' +
        '</div></div>';
    case "days":
      return '<div class="tut-phone">' +
        '<div class="tut-row"><span>Weight</span><b>184 lb</b></div>' +
        '<div class="tut-row hi"><span>🏋️ Gym day</span><b>×1.55</b></div>' +
        '<div class="tut-arrow">↓</div>' +
        '<div class="tut-chip">Target 1,820 kcal</div></div>';
    case "targets":
      return '<div class="tut-phone">' +
        '<div class="tut-row"><span>Height</span><b>170 cm</b></div>' +
        '<div class="tut-row"><span>Age</span><b>32</b></div>' +
        '<div class="tut-row hi"><span>🎯 Goal</span><b>0.50 kg/wk</b></div>' +
        '<div class="tut-chip">Protein 135–150 g</div></div>';
    case "assess":
      return '<div class="tut-emblem"><svg class="tut-ring" viewBox="0 0 120 120" fill="none">' +
        '<circle class="bg" cx="60" cy="60" r="50" stroke-width="10"/>' +
        '<circle class="fg" cx="60" cy="60" r="50" stroke-width="10" stroke-dasharray="245 314" transform="rotate(-90 60 60)"/>' +
        '</svg><span class="tut-score">78</span></div>';
    case "done":
      return '<div class="tut-emblem"><svg class="tut-check-svg" viewBox="0 0 120 120">' +
        '<circle cx="60" cy="60" r="52"/>' +
        '<path d="M38 62 L54 78 L84 44" fill="none" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg></div>';
    default:
      return "";
  }
}

function renderTutorial() {
  if (_tutRendered) return;
  const vp = document.getElementById("tut-viewport");
  const count = Tutorial.slideCount();
  vp.innerHTML = Tutorial.SLIDES.map((s, i) =>
    '<div class="tut-slide" data-i="' + i + '" role="group" aria-roledescription="slide" aria-label="Slide ' + (i + 1) + ' of ' + count + '">' +
      '<div class="tut-art">' + tutArtHtml(s.art) + '</div>' +
      '<h2 class="tut-title"></h2>' +
      '<p class="tut-caption"></p>' +
    '</div>'
  ).join("");
  // Titles/captions via textContent (safe, plain text).
  Tutorial.SLIDES.forEach((s, i) => {
    const slide = vp.querySelector('.tut-slide[data-i="' + i + '"]');
    slide.querySelector(".tut-title").textContent = s.title;
    slide.querySelector(".tut-caption").textContent = s.caption;
  });
  document.getElementById("tut-dots").innerHTML = Tutorial.SLIDES.map((_, i) =>
    '<button type="button" class="tut-dot" data-i="' + i + '" aria-label="Go to slide ' + (i + 1) + '"></button>'
  ).join("");
  _tutRendered = true;
}

function tutGoTo(i) {
  _tutIndex = Tutorial.clampIndex(i);
  document.querySelectorAll("#tut-viewport .tut-slide").forEach((el) =>
    el.classList.toggle("active", Number(el.dataset.i) === _tutIndex));
  document.querySelectorAll("#tut-dots .tut-dot").forEach((d) =>
    d.classList.toggle("active", Number(d.dataset.i) === _tutIndex));
  const fill = document.getElementById("tut-progress-fill");
  if (fill) fill.style.width = ((_tutIndex + 1) / Tutorial.slideCount() * 100) + "%";
  const last = Tutorial.isLast(_tutIndex);
  document.getElementById("tut-back").disabled = Tutorial.isFirst(_tutIndex);
  document.getElementById("tut-skip").classList.toggle("hidden", last);
  document.getElementById("tut-next").textContent = last ? "Start tracking" : "Next";
}

function tutStopAuto() {
  _tutAuto = false;
  if (_tutTimer) { clearTimeout(_tutTimer); _tutTimer = null; }
}

function tutScheduleAuto() {
  if (!_tutAuto) return;
  if (_tutTimer) clearTimeout(_tutTimer);
  _tutTimer = setTimeout(() => {
    if (!_tutAuto) return;
    if (Tutorial.isLast(_tutIndex)) { tutStopAuto(); return; }
    tutGoTo(Tutorial.next(_tutIndex));
    tutScheduleAuto();
  }, TUT_ADVANCE_MS);
}

// First manual interaction cancels auto-advance for good.
function tutInteract() { if (_tutAuto) tutStopAuto(); }

function openTutorial(fromAuto) {
  renderTutorial();
  // Mark seen the moment it opens (auto or manual); replay re-sets "1" harmlessly.
  localStorage.setItem("nt_tutorial_seen", "1");
  _tutFromAuto = !!fromAuto;
  _tutReturnFocus = document.activeElement;
  document.getElementById("tutorial-view").classList.remove("hidden");
  tutGoTo(0);
  _tutAuto = !tutReduceMotion();
  tutScheduleAuto();
  const next = document.getElementById("tut-next");
  if (next) next.focus();
}

function closeTutorial() {
  tutStopAuto();
  document.getElementById("tutorial-view").classList.add("hidden");
  if (_tutFromAuto) activateTab("food-eaten"); // land new users on Food; leave replay users where they were
  if (_tutReturnFocus && typeof _tutReturnFocus.focus === "function" && document.body.contains(_tutReturnFocus)) {
    _tutReturnFocus.focus();
  }
  _tutReturnFocus = null;
  _tutFromAuto = false;
}

function maybeAutoShowTutorial() {
  if (Tutorial.shouldAutoShow(localStorage.getItem("nt_tutorial_seen"))) openTutorial(true);
}

function tutTrapFocus(e) {
  if (e.key !== "Tab") return;
  const nodes = document.querySelectorAll("#tutorial-view button:not([disabled])");
  const focusable = Array.prototype.filter.call(nodes, (el) => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function initTutorialUi() {
  document.getElementById("tut-back").addEventListener("click", () => { tutInteract(); tutGoTo(Tutorial.prev(_tutIndex)); });
  document.getElementById("tut-skip").addEventListener("click", () => { tutInteract(); closeTutorial(); });
  document.getElementById("tut-next").addEventListener("click", () => {
    tutInteract();
    if (Tutorial.isLast(_tutIndex)) closeTutorial();
    else tutGoTo(Tutorial.next(_tutIndex));
  });
  document.getElementById("tut-dots").addEventListener("click", (e) => {
    const dot = e.target.closest(".tut-dot");
    if (!dot) return;
    tutInteract();
    tutGoTo(Number(dot.dataset.i));
  });
  const view = document.getElementById("tutorial-view");
  view.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeTutorial(); return; }
    if (e.key === "ArrowRight") { tutInteract(); tutGoTo(Tutorial.next(_tutIndex)); return; }
    if (e.key === "ArrowLeft") { tutInteract(); tutGoTo(Tutorial.prev(_tutIndex)); return; }
    tutTrapFocus(e);
  });
  const vp = document.getElementById("tut-viewport");
  vp.addEventListener("touchstart", (e) => { _tutTouchX = e.changedTouches[0].clientX; }, { passive: true });
  vp.addEventListener("touchend", (e) => {
    if (_tutTouchX == null) return;
    const dx = e.changedTouches[0].clientX - _tutTouchX;
    _tutTouchX = null;
    if (Math.abs(dx) < 40) return;
    tutInteract();
    tutGoTo(dx < 0 ? Tutorial.next(_tutIndex) : Tutorial.prev(_tutIndex));
  }, { passive: true });
  const replay = document.getElementById("tutorial-replay-btn");
  if (replay) replay.addEventListener("click", () => openTutorial(false));
}

let _appStarted = false;

function maybeShowOnboarding() {
```

- [ ] **Step 2: Call `initTutorialUi()` at startup**

In `www/app.js`, find:

```js
document.addEventListener("DOMContentLoaded", async () => {
  wireAuthUi();
  const { data: { session } } = await sb.auth.getSession();
```

Replace with (wires the tutorial controls once, independent of auth, so it works pre- and post-sign-in):

```js
document.addEventListener("DOMContentLoaded", async () => {
  wireAuthUi();
  initTutorialUi();
  const { data: { session } } = await sb.auth.getSession();
```

- [ ] **Step 3: Auto-show trigger for existing users (in `startApp`)**

In `www/app.js`, find the END of `startApp` (the theme block just before its closing brace):

```js
  applyTheme();
  if (window.matchMedia) {
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (getTheme() === "system") applyTheme(); });
  }
}
```

Replace with (auto-shows the tour only when onboarding is NOT being shown — new users get it via Step 4 instead):

```js
  applyTheme();
  if (window.matchMedia) {
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (getTheme() === "system") applyTheme(); });
  }

  // First-run walkthrough: show for returning users who haven't seen it.
  // (New users see it right after onboarding — see completeOnboarding.)
  if (!_cache.profileMissing) maybeAutoShowTutorial();
}
```

- [ ] **Step 4: Auto-show trigger for new users (in `completeOnboarding`)**

In `www/app.js`, find:

```js
  _cache.profileMissing = false;
  document.getElementById("onboarding-view").classList.add("hidden");
  // Re-render everything that reads profile/days.
  renderCalorieTracker();
  renderCalorieTarget();
}
```

Replace with:

```js
  _cache.profileMissing = false;
  document.getElementById("onboarding-view").classList.add("hidden");
  // Re-render everything that reads profile/days.
  renderCalorieTracker();
  renderCalorieTarget();
  // First-run walkthrough plays right after onboarding.
  maybeAutoShowTutorial();
}
```

- [ ] **Step 5: Verify no regression**

Run: `npm test`
Expected: PASS — `fail 0` (app.js changes don't touch the unit-tested modules).

- [ ] **Step 6: Manual smoke check in a browser**

Run: `npx http-server www -p 8080 -c-1`, open `http://localhost:8080`, open DevTools console, and run:

```js
localStorage.removeItem("nt_tutorial_seen");
openTutorial(false);
```

Expected: the overlay appears with slide 1 (Welcome), 6 progress dots, a filling top bar, and Back hidden. Verify: clicking **Next** advances (and stops auto-advance), **Back** returns, dots jump, the last slide shows **Start tracking**, **Skip**/**Start tracking** close it, and `localStorage.getItem("nt_tutorial_seen")` returns `"1"` afterward. Toggle the browser's "Emulate prefers-reduced-motion: reduce" and reopen — no auto-advance, no pulse animation.

- [ ] **Step 7: Commit**

```bash
git add www/app.js
git commit -m "feat(tutorial): render, navigation, auto-advance, and first-run/replay triggers"
```

---

## Task 4: Sync to Android and verify end-to-end

**Files:** none (build/verify only)

- [ ] **Step 1: Sync web assets into the native project**

Run: `npx cap sync android`
Expected: "sync finished" with no errors (copies `www/` including `tutorial.js` into `android/app/src/main/assets/public`).

- [ ] **Step 2: Full-suite check**

Run: `npm test`
Expected: PASS — `fail 0`.

- [ ] **Step 3: Emulator verification (per the project's smoke-test recipe)**

Set env, launch the AVD, build+install, and open the app (see MEMORY.md "Smoke-test recipe"). Then verify, signed in as a fresh account (so `nt_tutorial_seen` is unset on the device):

- Complete onboarding → the walkthrough **auto-appears** on top, starting at Welcome.
- Let it sit → it **auto-advances** ~4.5s per slide and **stops** on the last slide (does not loop).
- **Swipe** left/right pages the slides and stops auto-advance; **dots** jump; **Back**/**Next** work; last slide shows **Start tracking**.
- **Start tracking**/**Skip** closes it and lands on the **Food** tab.
- Fully close and relaunch the app → walkthrough does **not** auto-show again.
- Targets tab → **How to use** button reopens it; closing returns to **Targets** (not Food).
- Switch to **light** theme (Targets → Theme) and reopen → colors adapt (no invisible/hardcoded elements); switch back to dark.

- [ ] **Step 4: Commit any sync artifacts (if the working tree changed)**

```bash
git add -A
git commit -m "chore(tutorial): cap sync android for first-run walkthrough"
```

If `git status` shows nothing to commit after the sync, skip this step.

---

## Notes for the implementer

- **DRY:** the `+` and camera SVGs in `tutArtHtml("food")` intentionally mirror the real FAB icons in `index.html` so the tour matches the app; if those icons change, update both.
- **YAGNI:** no audio, no per-slide deep-dives, no analytics, no per-user flag — the flag is device-global like `nt_theme` (accepted tradeoff in the spec).
- **Theme safety:** every tutorial color comes from a CSS variable except `#fff` on the FAB/primary chips and the checkmark stroke (which sit on colored fills in both themes, matching how the app's own FABs/buttons use `#fff`).
- **Overlay placement is load-bearing:** `#tutorial-view` MUST remain a direct child of `<body>` (not inside `.app`) to avoid the `body.loading` conflict noted for the auth/onboarding overlays.
