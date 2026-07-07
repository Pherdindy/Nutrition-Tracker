# Day-card Cal +/- and Protein Display Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing signed Cal +/- range ("-273 … -70") on mobile day cards with plain language ("70–273 under target", green), and add a ✓/✗/~ met-missed-borderline indicator to the Protein row.

**Architecture:** Two pure display helpers (`calDeltaDisplay`, `proteinStatusDisplay`) added to the existing UMD module `www/targets.js` (`window.Targets`), unit-tested in `tests/targets.test.js` with `node --test`. `renderDayCards()` in `www/mobile-render.js` consumes them; tones map to four new `.tone-*` CSS classes that use existing theme variables only (`--green`, `--red`, `--yellow`, `--text-dim`) so dark/light themes both work. Desktop table unchanged.

**Tech Stack:** Vanilla JS (UMD browser global + Node module), `node:test` + `node:assert`, plain CSS.

**Spec:** `docs/superpowers/specs/2026-07-07-day-card-display-fixes-design.md`

---

## File map

- Modify: `www/targets.js` — add `calDeltaDisplay`, `proteinStatusDisplay` to the factory and the returned API object.
- Modify: `tests/targets.test.js` — new test blocks for both helpers.
- Modify: `www/mobile-render.js:100-101` — Cal +/- and Protein rows in `renderDayCards()`.
- Modify: `www/styles.css` — add `.tone-good/.tone-bad/.tone-warn/.tone-neutral` next to the existing `.positive/.negative/.neutral` block (~line 240).

Conventions to follow: en dash `–` (U+2013) between range numbers (matches the existing `${lo}–${hi}` kcal text in mobile-render.js); helpers return `{ text, tone, icon }` with `tone ∈ "good"|"bad"|"warn"|"neutral"`; invalid input returns `{ text: "", tone: "neutral", icon: "" }` and the renderer falls back to the old output.

---

### Task 1: `Targets.calDeltaDisplay(overLow, overHigh)`

**Files:**
- Modify: `www/targets.js`
- Test: `tests/targets.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/targets.test.js`:

```js
test("calDeltaDisplay: whole range under target -> 'a–b under target', good, abs values small-first", () => {
  assert.deepEqual(T.calDeltaDisplay(-273, -70), { text: "70–273 under target", tone: "good", icon: "" });
});

test("calDeltaDisplay: whole range over target -> 'a–b over target', bad", () => {
  assert.deepEqual(T.calDeltaDisplay(112, 283), { text: "112–283 over target", tone: "bad", icon: "" });
});

test("calDeltaDisplay: range straddling zero or within ±50 band -> 'on target', neutral", () => {
  assert.deepEqual(T.calDeltaDisplay(-30, 40), { text: "on target", tone: "neutral", icon: "" });
  assert.deepEqual(T.calDeltaDisplay(-40, -10), { text: "on target", tone: "neutral", icon: "" }); // inside ±50 band
  assert.deepEqual(T.calDeltaDisplay(10, 45), { text: "on target", tone: "neutral", icon: "" });   // inside ±50 band
  assert.deepEqual(T.calDeltaDisplay(0, 0), { text: "on target", tone: "neutral", icon: "" });
  assert.deepEqual(T.calDeltaDisplay(-60, 0), { text: "on target", tone: "neutral", icon: "" });   // touches zero = straddle
});

test("calDeltaDisplay: just outside the ±50 band is not neutral", () => {
  assert.deepEqual(T.calDeltaDisplay(-60, -20), { text: "20–60 under target", tone: "good", icon: "" });
  assert.deepEqual(T.calDeltaDisplay(20, 60), { text: "20–60 over target", tone: "bad", icon: "" });
});

test("calDeltaDisplay: degenerate range -> single number", () => {
  assert.deepEqual(T.calDeltaDisplay(-170, -170), { text: "170 under target", tone: "good", icon: "" });
  assert.deepEqual(T.calDeltaDisplay(200, 200), { text: "200 over target", tone: "bad", icon: "" });
});

test("calDeltaDisplay: rounds fractional inputs", () => {
  assert.deepEqual(T.calDeltaDisplay(-272.6, -70.4), { text: "70–273 under target", tone: "good", icon: "" });
});

test("calDeltaDisplay: invalid input -> empty neutral fallback", () => {
  const empty = { text: "", tone: "neutral", icon: "" };
  assert.deepEqual(T.calDeltaDisplay(NaN, -70), empty);
  assert.deepEqual(T.calDeltaDisplay(null, -70), empty);
  assert.deepEqual(T.calDeltaDisplay(undefined, undefined), empty);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the new `calDeltaDisplay` tests FAIL with `TypeError: T.calDeltaDisplay is not a function`; all 43 pre-existing tests still pass.

- [ ] **Step 3: Implement `calDeltaDisplay`**

In `www/targets.js`, insert before the `return { GOALS, ... }` line:

```js
  // ---- Day-card display helpers (pure) ----
  // tone: "good" | "bad" | "warn" | "neutral". Invalid input -> empty text so
  // callers can fall back to their legacy rendering.
  const EMPTY_DISPLAY = { text: "", tone: "neutral", icon: "" };

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
      const a = Math.abs(hi), b = Math.abs(lo); // a <= b: small number first
      return { text: `${a === b ? a : a + "–" + b} under target`, tone: "good", icon: "" };
    }
    return { text: `${lo === hi ? lo : lo + "–" + hi} over target`, tone: "bad", icon: "" };
  }
```

And change the return statement to:

```js
  return { GOALS, deficitForGoal, migrateDay, migrateProfile, calDeltaDisplay };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS (43 old + 7 new = 50).

- [ ] **Step 5: Commit**

```bash
git add www/targets.js tests/targets.test.js
git commit -m "feat(targets): calDeltaDisplay plain-language Cal +/- helper"
```

---

### Task 2: `Targets.proteinStatusDisplay(proLow, proHigh, targetLow, targetHigh)`

**Files:**
- Modify: `www/targets.js`
- Test: `tests/targets.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/targets.test.js`:

```js
test("proteinStatusDisplay: met (low end at/above target low) -> good ✓; exceeding high stays good", () => {
  assert.deepEqual(T.proteinStatusDisplay(136, 147, 135, 150),
    { text: "136–147 g (target 135–150)", tone: "good", icon: "✓" });
  assert.deepEqual(T.proteinStatusDisplay(155, 170, 135, 150),
    { text: "155–170 g (target 135–150)", tone: "good", icon: "✓" });
});

test("proteinStatusDisplay: missed (high end below target low) -> bad ✗", () => {
  assert.deepEqual(T.proteinStatusDisplay(93, 102, 135, 150),
    { text: "93–102 g (target 135–150)", tone: "bad", icon: "✗" });
});

test("proteinStatusDisplay: straddles target low -> warn ~", () => {
  assert.deepEqual(T.proteinStatusDisplay(128, 140, 135, 150),
    { text: "128–140 g (target 135–150)", tone: "warn", icon: "~" });
});

test("proteinStatusDisplay: degenerate ranges collapse to single numbers", () => {
  assert.deepEqual(T.proteinStatusDisplay(140, 140, 135, 150),
    { text: "140 g (target 135–150)", tone: "good", icon: "✓" });
  assert.deepEqual(T.proteinStatusDisplay(100, 100, 135, 135),
    { text: "100 g (target 135)", tone: "bad", icon: "✗" });
});

test("proteinStatusDisplay: rounds fractional intake", () => {
  assert.deepEqual(T.proteinStatusDisplay(135.6, 147.2, 135, 150),
    { text: "136–147 g (target 135–150)", tone: "good", icon: "✓" });
});

test("proteinStatusDisplay: invalid input -> empty neutral fallback", () => {
  const empty = { text: "", tone: "neutral", icon: "" };
  assert.deepEqual(T.proteinStatusDisplay(NaN, 147, 135, 150), empty);
  assert.deepEqual(T.proteinStatusDisplay(136, 147, null, 150), empty);
  assert.deepEqual(T.proteinStatusDisplay(undefined, undefined, undefined, undefined), empty);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the new `proteinStatusDisplay` tests FAIL with `TypeError: T.proteinStatusDisplay is not a function`; the 50 from Task 1 still pass.

- [ ] **Step 3: Implement `proteinStatusDisplay`**

In `www/targets.js`, insert directly after the `calDeltaDisplay` function:

```js
  // Met = intake low end reaches the target low; exceeding the target high is
  // still "met" (protein surplus is good — same semantics as proteinSurplusClass).
  function proteinStatusDisplay(proLow, proHigh, targetLow, targetHigh) {
    if (![proLow, proHigh, targetLow, targetHigh].every(Number.isFinite)) return { ...EMPTY_DISPLAY };
    const lo = Math.round(Math.min(proLow, proHigh));
    const hi = Math.round(Math.max(proLow, proHigh));
    const range = lo === hi ? `${lo}` : `${lo}–${hi}`;
    const tgt = targetLow === targetHigh ? `${targetLow}` : `${targetLow}–${targetHigh}`;
    const text = `${range} g (target ${tgt})`;
    if (lo >= targetLow) return { text, tone: "good", icon: "✓" };
    if (hi < targetLow) return { text, tone: "bad", icon: "✗" };
    return { text, tone: "warn", icon: "~" };
  }
```

And change the return statement to:

```js
  return { GOALS, deficitForGoal, migrateDay, migrateProfile, calDeltaDisplay, proteinStatusDisplay };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS (50 + 6 new = 56).

- [ ] **Step 5: Commit**

```bash
git add www/targets.js tests/targets.test.js
git commit -m "feat(targets): proteinStatusDisplay met/missed/borderline helper"
```

---

### Task 3: Wire helpers into the mobile day cards + tone CSS

**Files:**
- Modify: `www/mobile-render.js:100-101`
- Modify: `www/styles.css` (after the `.neutral` rule in the "Surplus/deficit coloring" block, ~line 250)

- [ ] **Step 1: Add the `.tone-*` classes to `www/styles.css`**

Directly after the existing `.neutral { ... }` rule in the "Surplus/deficit coloring" section, add:

```css
/* Day-card display tones (Targets.calDeltaDisplay / proteinStatusDisplay) */
.tone-good { color: var(--green); }
.tone-bad { color: var(--red); }
.tone-warn { color: var(--yellow); }
.tone-neutral { color: var(--text-dim); }
```

(`--green/--red/--yellow/--text-dim` are defined in both `:root` and `[data-theme="light"]`, so both themes work — do NOT hardcode hex colors.)

- [ ] **Step 2: Replace the Cal +/- and Protein rows in `renderDayCards()`**

In `www/mobile-render.js`, inside the `for (const day of days)` loop, after the line `const overLow = t.calLow - target, overHigh = t.calHigh - target;` add:

```js
    const calDisp = Targets.calDeltaDisplay(overLow, overHigh);
    const proDisp = Targets.proteinStatusDisplay(t.proLow, t.proHigh, profile.proteinLow, profile.proteinHigh);
```

Then replace these two lines:

```js
        <div class="food-card-row"><span>Cal +/-</span><b class="${surplusClass(overLow)}">${renderNum(overLow,0)} … ${renderNum(overHigh,0)}</b></div>
        <div class="food-card-row"><span>Protein</span><b>${renderNum(t.proLow,0)}–${renderNum(t.proHigh,0)} g (target ${profile.proteinLow}–${profile.proteinHigh})</b></div>
```

with:

```js
        <div class="food-card-row"><span>Cal +/-</span><b class="tone-${calDisp.tone}">${calDisp.text ? escapeHtml(calDisp.text) : `${renderNum(overLow,0)} … ${renderNum(overHigh,0)}`}</b></div>
        <div class="food-card-row"><span>Protein</span><b class="tone-${proDisp.tone}">${proDisp.text ? escapeHtml((proDisp.icon + " " + proDisp.text).trim()) : `${renderNum(t.proLow,0)}–${renderNum(t.proHigh,0)} g (target ${profile.proteinLow}–${profile.proteinHigh})`}</b></div>
```

(Empty `text` = helper got invalid input → render the legacy output, per spec. `escapeHtml` is already a dependency of this file.)

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: all 56 tests PASS (no new unit tests in this task; the renderer is DOM code covered by manual verification).

- [ ] **Step 4: Visual check in the browser**

Run: `npx http-server www -p 8080 -c-1` and open `http://localhost:8080` in a browser narrowed below 720px width (mobile breakpoint), Days tab. Verify on the seeded data:
- A day eaten under target shows e.g. `70–273 under target` in green (not `-273 … -70`).
- A day over target shows `112–283 over target` in red.
- Protein rows show `✓ …` green when `proLow ≥ 135`, `✗ …` red when `proHigh < 135`, `~ …` amber when straddling.
- Switch Targets → Theme → Light and confirm all four tones remain readable.

- [ ] **Step 5: Commit**

```bash
git add www/mobile-render.js www/styles.css
git commit -m "feat(days): plain-language Cal +/- and protein met/missed cues on day cards"
```

---

### Task 4: Sync to Android and verify on emulator

**Files:** none (build/verify only)

- [ ] **Step 1: Sync web assets into the native project**

Run: `npx cap sync android`
Expected: `√ copy android` / `√ update android` with no errors.

- [ ] **Step 2: Emulator visual check (if emulator available)**

Follow the smoke-test recipe: set `$env:ANDROID_HOME`/`$env:ANDROID_SDK_ROOT` = `%LOCALAPPDATA%\Android\Sdk`, `$env:JAVA_HOME` = `C:\Program Files\Android\Android Studio\jbr`; launch `emulator.exe -avd Pixel_7 -no-snapshot-load`; then `cd android; .\gradlew.bat installDebug`; launch the app and open the Days tab. Verify the same four items as Task 3 Step 4. Screenshot via `adb shell screencap -p /sdcard/s.png; adb pull /sdcard/s.png` (never PowerShell `>` redirect — corrupts the PNG).

- [ ] **Step 3: Commit any sync artifacts (only if `git status` shows tracked changes under `android/`)**

```bash
git status
git add android
git commit -m "chore: cap sync android for day-card display fixes"
```

---

## Self-review notes

- Spec coverage: all four cal cases (Task 1 tests), three protein cases + above-target-high met case (Task 2 tests), theme-var-only styling (Task 3 Step 1), invalid-input fallback to legacy rendering (both helpers + Task 3 Step 2), desktop table untouched — matches spec's out-of-scope list.
- `escapeHtml` used on helper text in the renderer; helpers themselves stay presentation-agnostic.
- Test counts (50/56) assume the suite currently has 43 passing tests; if the count printed differs, what matters is: zero failures, and the named new tests present.
