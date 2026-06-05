# Theme Switching + FAB Icon Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Dark/Light/System theme switching (selector on the Targets tab, no flash on load, Android status bar adapts) and replace the clashing FAB emoji/text with crisp monochrome SVG icons.

**Architecture:** A tiny pure UMD module `www/theme.js` (`window.Theme`) owns `resolveTheme(setting, prefersLight)` and `statusBarFor(effective)` (Node-testable). The Dark theme stays as the `:root` CSS variables; a `[data-theme="light"]` block overrides them. `app.js` `applyTheme()` sets `data-theme` on `<html>` and updates the Capacitor StatusBar; a no-flash inline `<head>` script sets the initial theme before paint. FAB buttons get inline SVG icons and a `--fab-bg` variable.

**Tech Stack:** Vanilla JS (no bundler), UMD modules, Node built-in test runner, CSS custom properties, `@capacitor/status-bar`.

**Reference spec:** `docs/superpowers/specs/2026-06-05-theme-switching-fab-icons-design.md`

**Conventions:** Commit after each task. Already on branch `feat/theme-switching`. `npm test` for units; emulator checks via the WebView DevTools recipe in project memory.

**Current facts (verified):**
- `:root` palette (`www/styles.css:7-23`): `--bg #0f1117, --surface #1a1d27, --surface2/--card-bg #242836, --border #2e3345, --text #e4e6ed, --text-dim #8b8fa3, --primary #4f8cff, --primary-hover #3a7af0, --green #34d399, --red #f87171, --yellow #fbbf24, --orange #fb923c`.
- `.fab` (`styles.css:1668-1670`): `background: #2bb673; color:#fff; font-size:28px; 56px circle`. `.fab-secondary { right: 80px }` (`styles.css:1745`). Mobile media (`styles.css:1673-1676`) sets `.fab { display: block }`.
- FAB markup (`index.html:40-41`): `#food-fab` = `&#43;`, `#photo-fab` = `📷`.
- StatusBar one-time call in `app.js` (~line 3209): `if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.StatusBar) { Capacitor.Plugins.StatusBar.setBackgroundColor({ color: "#16324f" }); Capacitor.Plugins.StatusBar.setStyle({ style: "DARK" }); }`.
- `renderMacroSettings` (`app.js`) renders selects `#set-value-format`/`#set-estimation-mode`/`#set-vision-provider` into `#macro-settings` and wires `change` listeners; `getSetting`/`setSetting` exist (localStorage key `nt_<key>`).
- Script tags load `macros.js`, `targets.js`, `photo.js` before `app.js` (near end of `<body>`).

---

## Phase 1 — `www/theme.js` pure module (TDD)

**Files:** Create `www/theme.js`, `tests/theme.test.js`.

### Task 1.1: resolveTheme + statusBarFor

- [ ] **Step 1: Write failing test** — `tests/theme.test.js`
```js
const test = require("node:test");
const assert = require("node:assert");
const T = require("../www/theme.js");

test("resolveTheme maps setting + system preference to dark/light", () => {
  assert.equal(T.resolveTheme("dark", false), "dark");
  assert.equal(T.resolveTheme("dark", true), "dark");
  assert.equal(T.resolveTheme("light", false), "light");
  assert.equal(T.resolveTheme("system", true), "light");
  assert.equal(T.resolveTheme("system", false), "dark");
  assert.equal(T.resolveTheme("bogus", true), "dark");
  assert.equal(T.resolveTheme(null, true), "dark");
});

test("statusBarFor returns color + style per effective theme", () => {
  assert.deepEqual(T.statusBarFor("dark"), { color: "#16324f", style: "DARK" });
  assert.deepEqual(T.statusBarFor("light"), { color: "#f6f7fb", style: "LIGHT" });
  // unknown -> dark
  assert.deepEqual(T.statusBarFor("x"), { color: "#16324f", style: "DARK" });
});
```

- [ ] **Step 2: Run → FAIL.** `npm test`.

- [ ] **Step 3: Implement** `www/theme.js` (UMD like `targets.js`/`macros.js`):
```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Theme = api;
})(typeof self !== "undefined" ? self : this, function () {
  function resolveTheme(setting, prefersLight) {
    if (setting === "light") return "light";
    if (setting === "dark") return "dark";
    if (setting === "system") return prefersLight ? "light" : "dark";
    return "dark";
  }
  function statusBarFor(effective) {
    return effective === "light"
      ? { color: "#f6f7fb", style: "LIGHT" }
      : { color: "#16324f", style: "DARK" };
  }
  return { resolveTheme, statusBarFor };
});
```

- [ ] **Step 4: Run → PASS.** `npm test` (existing 40 still pass → 42 total).

- [ ] **Step 5: Commit**
```bash
git add www/theme.js tests/theme.test.js
git commit -m "feat(theme): resolveTheme + statusBarFor pure helpers"
```

---

## Phase 2 — CSS light palette + FAB SVG icons + no-flash script

**Files:** `www/styles.css`, `www/index.html`.

### Task 2.1: Light palette + `--fab-bg`

- [ ] **Step 1:** In `www/styles.css`, add `--fab-bg: #2bb673;` to the `:root` block (after `--orange`). Then add a light-theme override block immediately after the `:root { ... }` closing brace:
```css
[data-theme="light"] {
  --bg: #f6f7fb;
  --surface: #ffffff;
  --surface2: #eef1f6;
  --card-bg: #ffffff;
  --border: #dfe3ec;
  --text: #1c1f2a;
  --text-dim: #5d6478;
  --primary: #2f6fed;
  --primary-hover: #2257c9;
  --green: #1f9d63;
  --red: #d64545;
  --yellow: #c98a00;
  --orange: #d2691e;
  --fab-bg: #1f9d63;
}
```

- [ ] **Step 2:** Change the `.fab` rule (`styles.css:1668-1670`) to use the variable and center an SVG:
```css
.fab { position: fixed; right: 16px; bottom: 84px; z-index: 60; width: 56px; height: 56px;
  border-radius: 50%; border: none; background: var(--fab-bg); color: #fff;
  box-shadow: 0 4px 12px rgba(0,0,0,.3); cursor: pointer; align-items: center; justify-content: center; }
.fab svg { width: 24px; height: 24px; display: block; }
```
And in the mobile media block (`styles.css:1673-1676`) change `.fab { display: block; }` to `.fab { display: flex; }` (so the icon centers). Keep `.fab-secondary { right: 80px; }`.

- [ ] **Step 3: Verify.** `npm test` (40+2 pass, unaffected). Commit:
```bash
git add www/styles.css
git commit -m "feat(theme): light palette + themeable FAB background"
```

### Task 2.2: FAB SVG icons + no-flash inline script + theme.js tag

- [ ] **Step 1:** In `www/index.html`, replace the FAB button contents (line 40-41):
```html
      <button id="food-fab" class="fab mobile-only" aria-label="Add food"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
      <button id="photo-fab" class="fab fab-secondary mobile-only" aria-label="Snap a photo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3l2-2h8l2 2h3v12H3z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
```

- [ ] **Step 2:** Add the no-flash inline script inside `<head>` (after the `<title>` / before or after the stylesheet `<link>` — it just needs to be in `<head>`):
```html
  <script>
    (function () {
      try {
        var t = localStorage.getItem("nt_theme") || "dark";
        var eff = t === "light" ? "light"
          : t === "system" ? (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
          : "dark";
        document.documentElement.setAttribute("data-theme", eff);
      } catch (e) {}
    })();
  </script>
```

- [ ] **Step 3:** Add `<script src="theme.js"></script>` among the other module script tags (before `app.js`).

- [ ] **Step 4: Verify.** `npm test` (unaffected). Open `npx http-server www -p 8080 -c-1` in a browser if convenient: FABs show line icons (no emoji). Commit:
```bash
git add www/index.html
git commit -m "feat(theme): SVG FAB icons, no-flash head script, load theme.js"
```

---

## Phase 3 — app.js: applyTheme + setting + selector + StatusBar

**Files:** `www/app.js`.

### Task 3.1: theme accessors + applyTheme + system listener + init

- [ ] **Step 1:** Add near the other settings accessors (e.g. after `setVisionProvider`):
```js
function getTheme() { const t = getSetting("theme", "dark"); return (t === "light" || t === "system") ? t : "dark"; }
function setTheme(t) { setSetting("theme", (t === "light" || t === "system") ? t : "dark"); }
function applyTheme() {
  const prefersLight = !!(window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches);
  const eff = Theme.resolveTheme(getTheme(), prefersLight);
  document.documentElement.setAttribute("data-theme", eff);
  if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.StatusBar) {
    const sb = Theme.statusBarFor(eff);
    Capacitor.Plugins.StatusBar.setBackgroundColor({ color: sb.color }).catch(() => {});
    Capacitor.Plugins.StatusBar.setStyle({ style: sb.style }).catch(() => {});
  }
}
```

- [ ] **Step 2:** Replace the existing one-time StatusBar block in the `DOMContentLoaded` init (~line 3209) — the `if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.StatusBar) { ...setBackgroundColor("#16324f")...setStyle("DARK")... }` — with:
```js
  applyTheme();
```
(applyTheme now owns the StatusBar.)

- [ ] **Step 3:** Register a system-preference listener ONCE in init (near where applyTheme is called):
```js
  if (window.matchMedia) {
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (getTheme() === "system") applyTheme(); });
  }
```

- [ ] **Step 4: Verify.** `node --check www/app.js` exit 0; `npm test` 42 pass. Commit:
```bash
git add www/app.js
git commit -m "feat(theme): applyTheme, theme setting, system listener, StatusBar"
```

### Task 3.2: Theme selector in settings

- [ ] **Step 1:** In `renderMacroSettings`, after the vision-provider `<div class="form-row">…</div>` (and before the card's closing `</div>` / `c.innerHTML = html;`), append:
```js
  const _theme = getTheme();
  html += `<div class="form-row"><label>Theme</label><select id="set-theme">
    <option value="dark" ${_theme === "dark" ? "selected" : ""}>Dark</option>
    <option value="light" ${_theme === "light" ? "selected" : ""}>Light</option>
    <option value="system" ${_theme === "system" ? "selected" : ""}>System</option></select></div>`;
```
And in the listener-wiring section of `renderMacroSettings`:
```js
  const _ts = c.querySelector("#set-theme");
  if (_ts) _ts.addEventListener("change", (e) => { setTheme(e.target.value); applyTheme(); });
```

- [ ] **Step 2: Verify.** `node --check www/app.js` exit 0; `npm test` 42 pass. Commit:
```bash
git add www/app.js
git commit -m "feat(theme): theme selector in Macros & estimation settings"
```

---

## Phase 4 — Build + verification + finish

### Task 4.1: Emulator verification

- [ ] **Step 1:** `npx cap sync android`; `cd android; .\\gradlew.bat installDebug`; relaunch.

- [ ] **Step 2:** Verify (DevTools + visual):
  - FABs render as monochrome line icons (plus + camera), legible on the FAB green — no 📷 emoji.
  - Targets settings has a **Theme** select (Dark/Light/System).
  - Setting **Light** flips `document.documentElement.getAttribute("data-theme")` to `"light"`, repaints the palette (bg/surface/text), and the Android status bar turns light (`Theme.statusBarFor("light")`).
  - Setting **System** resolves to the device's mode; toggling the emulator's dark/light setting (while in System) updates the theme.
  - Setting **Dark** restores the original look.
  - Reload the app — the chosen theme persists with no flash of the wrong theme on cold start.

- [ ] **Step 3:** Use `superpowers:verification-before-completion` to confirm each with evidence (DevTools `data-theme` + getComputedStyle of `--bg`, screenshots).

- [ ] **Step 4:** Finish with `superpowers:finishing-a-development-branch`.

---

## Self-Review (completed by plan author)

- **Spec coverage:** theme mechanism (data-theme + setting) → Task 1.1/3.1; no-flash → Task 2.2; light palette → Task 2.1; FAB icons + `--fab-bg` → Task 2.1/2.2; settings selector → Task 3.2; StatusBar adapt → Task 3.1; system tracking → Task 3.1; testing → Phase 1 + 4.1. All covered.
- **Type consistency:** `Theme.resolveTheme(setting, prefersLight)` → `"dark"|"light"`; `Theme.statusBarFor(effective)` → `{color,style}`; `getTheme()`/`setTheme()`/`applyTheme()` in app.js; setting key `theme` → localStorage `nt_theme` (matches the no-flash script's `localStorage.getItem("nt_theme")`). Consistent.
- **Placeholders:** none — code shown for every code step. Open Decisions defaulted (light `--fab-bg` = `#1f9d63`; light hex values tunable).
- **Key-name check:** `setSetting("theme", …)` writes `nt_theme`; the inline `<head>` script and `getTheme` both read `theme`/`nt_theme` consistently.
