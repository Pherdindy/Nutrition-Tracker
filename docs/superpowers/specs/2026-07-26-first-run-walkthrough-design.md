# First-Run Animated Walkthrough ("How to use") — Design

**Date:** 2026-07-26
**Status:** Approved
**Scope:** New self-contained in-app onboarding walkthrough for the Lazy Macros phone app. Adds a new UMD module `www/tutorial.js`, an overlay in `www/index.html`, DOM wiring in `www/app.js`, styles in `www/styles.css`, and unit tests in `tests/tutorial.test.js`. No changes to data layer, Supabase schema, auth, or existing feature logic.

## Problem

First-time users land in the app with no orientation. The four tabs (Food, Days/Calorie Tracker, Targets, Assess) and the core loop — *log food → AI fills macros → activity sets your target → assess your diet* — are not self-evident. We want a short, video-like tutorial embedded **inside** the app (must run offline in the Capacitor WebView; no real video file), shown automatically once to new users and re-openable on demand.

A real recorded/rendered `.mp4` is intentionally **not** used: it bloats the bundle, can't be produced without external screen-recording tooling, and rots when the UI changes. Instead we build an animated HTML/CSS/JS walkthrough that plays like a ~30s video.

## Solution

A full-screen overlay of **6 auto-advancing, swipeable slides**. Each slide is a stylized CSS/SVG mini-mockup of the relevant screen (not a screenshot) with a short title and one-line caption, and the key control animates in. Theme-aware (dark/light), silent (no audio), respects `prefers-reduced-motion`.

### Storyboard (6 slides)

| # | Title | Caption | Visual |
|---|---|---|---|
| 1 | **Welcome to Lazy Macros** | "Track calories & macros the lazy way. Here's a quick 30-second tour." | App name + subtle animated macro ring |
| 2 | **Log your food** | "Tap **+** to add a meal, **📷 Snap** a photo, or **Batch**-add several. AI fills in the calories & macros for you." | Mini Food list; **+** and camera FABs pulse |
| 3 | **Days & activity** | "Each day logs your weight and activity level — your activity type sets your calorie burn, and your daily target." | Mini Day card; activity row highlights, target updates |
| 4 | **Your targets** | "Set your height, age, protein goal, and weight-loss goal. We compute your calorie & protein targets automatically." | Mini Targets form; goal selector animates |
| 5 | **Diet assessment** | "Get an AI review of your eating over any period — what's working, and what to fix." | Mini scorecard; score ring fills |
| 6 | **You're all set** | "Tap **+** on the Food tab to log your first meal. Reopen this any time from Targets → How to use." | Checkmark + **Start tracking** button |

Copy is illustrative and may be lightly tuned during implementation; slide *count, order, and subjects* are fixed.

### Look, feel & motion

- **Progress dots** (6) at the top; **Back / Skip / Next** controls. On the last slide, Next becomes **Start tracking**; Skip is hidden.
- **Auto-advance** ≈ 4.5 s per slide with a thin top progress bar. The timer **stops permanently on the first user interaction** (swipe, tap, or any control) — from then on it's manual paging. (Rationale: avoids fighting a user who has taken control.)
- **Swipe** left/right on touch; buttons work everywhere (desktop preview included).
- Transitions: cross-fade + gentle slide/scale between slides.
- **`prefers-reduced-motion: reduce`** → no auto-advance and no slide/art animation; manual paging only.
- **Silent** — no audio, no narration.

### Placement & trigger

- New overlay `#tutorial-view`, a **direct child of `<body>`** (same pattern as `#auth-view` / `#onboarding-view`), NOT inside `.app` — this avoids the known `body.loading` / `.app` conflict.
- **Auto-show logic:** on first app start after sign-in, if the global flag `nt_tutorial_seen` is unset → open the walkthrough. This naturally lands **right after** the onboarding profile form for brand-new users (onboarding completes → app starts → flag unset → tutorial shows). Setting the flag on finish/skip means it never auto-shows again.
  - The flag is a **global** localStorage key (like `nt_theme`), NOT per-user-namespaced, because "have I seen the app tour" is a UI/device preference, not per-account data. Consequence: one-per-device; a second account signing in on the same device won't see it again. Accepted tradeoff for a personal single-user-per-device app.
- **Replay:** a **"How to use"** button in the Targets tab (`#calorie-target` settings grid) calls `openTutorial()` directly and does **not** consult or change the flag.
- Closing the walkthrough (finish or skip) leaves the user on the **Food** tab.

### Architecture

**New module `www/tutorial.js`** — UMD `window.Tutorial`, matching the existing module pattern (`auth-view.js`, `targets.js`, `theme.js`). Contains the slide model and **pure, unit-testable** helpers only (no DOM):

- `SLIDES` — array of `{ id, title, caption, art }` (art = a key naming which mini-mockup to render).
- `slideCount()` → number of slides.
- `clampIndex(i)` → clamps to `[0, slideCount()-1]`.
- `next(i)` / `prev(i)` → clamped neighbor index.
- `isLast(i)` → boolean (index is final slide).
- `isFirst(i)` → boolean.
- `shouldAutoShow(seenFlagValue)` → boolean (`true` only when the value is falsy/absent — `null`/`undefined`/`""`; any non-empty value, e.g. `"1"`, means "seen" → `false`). The flag is only ever stored as `"1"` or left absent.

**DOM wiring in `www/app.js`** (keeps DOM out of the module, per the established split):

- `renderTutorial()` — builds the slide DOM for `#tutorial-view` from `Tutorial.SLIDES` (called once, lazily, on first open).
- `openTutorial()` / `closeTutorial()` — show/hide the overlay, manage focus (trap on open, restore on close), wire `Esc`.
- Navigation handlers (Back/Skip/Next/dots/swipe) driving a current-index state via `Tutorial.next/prev/clampIndex`.
- Auto-advance timer with cancel-on-interaction and `prefers-reduced-motion` guard.
- Trigger hook: after sign-in/onboarding, `if (Tutorial.shouldAutoShow(localStorage.getItem("nt_tutorial_seen"))) openTutorial();` and set `localStorage.setItem("nt_tutorial_seen", "1")` on finish/skip. Reads/writes the flag via **raw `localStorage`** (the non-namespaced path, exactly as `nt_theme` does) — NOT the per-user `lsGet`/`lsSet` helpers.

**`www/index.html`:**

- `#tutorial-view` overlay markup (an `.auth-view`-style backdrop containing a slide viewport, progress dots, and controls), placed as a direct child of `<body>` alongside `#auth-view` / `#onboarding-view`.
- `<script src="tutorial.js"></script>` **before** `app.js` (mirrors `auth-view.js` placement).
- A **"How to use"** button in the `#calorie-target` settings grid.

**`www/styles.css`:** `.tutorial-*` classes using existing theme variables only (`--bg`, `--surface`, `--card-bg`, `--text`, `--text-dim`, `--primary`, `--green`, `--border`) — no hardcoded colors (light/dark-theme lesson). Reuses the global `.hidden { display:none !important; }` rule to toggle the overlay.

### Accessibility & edge cases

- `role="dialog"`, `aria-modal="true"`, an `aria-label`; focus moves into the overlay on open and returns to the trigger (or Food tab) on close; focus is trapped while open.
- Keyboard: `Esc` closes; Left/Right arrows page; Enter activates the focused control.
- Progress conveyed by dots **and** an accessible current-slide label (not color-only).
- Reduced-motion honored (see motion section).
- Safe if opened before data loads — the walkthrough is static content independent of Supabase/cache.

### Testing

- **Unit tests** `tests/tutorial.test.js` (TDD, runs under existing `npm test`): `slideCount` = 6; `clampIndex` bounds (below 0, above max, in-range); `next`/`prev` clamping at the ends; `isFirst`/`isLast` at boundaries and middle; `shouldAutoShow` true for `undefined`/`null`/`""` (falsy/absent) and false for `"1"` (and any non-empty stored value). (Suite currently 64 tests → grows.)
- **Manual/emulator structural check:** overlay is a direct child of `<body>`; auto-shows once for a fresh (flag-unset) profile then not again; "How to use" reopens it; swipe + buttons + dots navigate; auto-advance stops on interaction; last slide shows **Start tracking**; renders correctly in dark **and** light themes; reduced-motion disables auto-advance.
- After `www/` changes: `npx cap sync android`, then verify in the WebView.

## Out of scope

- Audio / narration; any real video file or screen recording.
- Per-slide deep-dives into sub-features (photo correction, batch internals, manual mode, assessment periods/history) — the "Deep dive" scope was set aside.
- Analytics / telemetry on tutorial views.
- Desktop-specific tutorial layout beyond it rendering acceptably in the browser preview (the walkthrough targets mobile first-run).
- Any change to auth, onboarding data capture, Supabase schema, or existing feature behavior.
