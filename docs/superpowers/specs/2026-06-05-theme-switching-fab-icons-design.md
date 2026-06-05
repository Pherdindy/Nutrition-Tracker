# Theme Switching + FAB Icon Fix — Design Spec

**Date:** 2026-06-05
**Status:** Approved (design), pending implementation plan
**Applies to:** web (`www/`) and Android (Capacitor, same `www/` codebase)

## Overview

Two related visual changes:

1. **Theme switching** — let users choose **Dark** (current), **Light**, or **System** (follow the device's light/dark setting). Selected on the Targets/Settings tab; persisted; applied without a flash on load; the Android status bar adapts.
2. **FAB icon fix** — replace the clashing `+` text and 📷 emoji on the floating action buttons with crisp, monochrome, theme-aware SVG icons.

### Goals
- A clean, theme-consistent UI in both light and dark.
- Zero flash-of-wrong-theme on startup.
- One obvious place to switch themes.

### Non-Goals
- Accent-color variants or custom user palettes (Dark/Light/System only).
- Per-section theming or high-contrast/accessibility themes (possible later).

## Theme Mechanism

- The existing `:root` CSS variables remain the **Dark** theme (no change to default values). A new **`[data-theme="light"]`** selector overrides the same variable names with a light palette. `data-theme` is set on `document.documentElement` (`<html>`).
- Setting **`nt_theme`** ∈ `"dark" | "light" | "system"`, stored/read via the existing `getSetting`/`setSetting` (cache + localStorage + Supabase `settings`). **Default: `"dark"`** (preserves the current look).
- **`applyTheme()`** (app.js):
  1. Read `nt_theme`.
  2. Resolve effective theme via `Theme.resolveTheme(setting, prefersLight)` where `prefersLight = matchMedia("(prefers-color-scheme: light)").matches`.
  3. `document.documentElement.setAttribute("data-theme", effective)` (effective is `"dark"` or `"light"`).
  4. Update the Android status bar (if Capacitor present): `Capacitor.Plugins.StatusBar.setBackgroundColor({color})` + `setStyle({style})` using `Theme.statusBarFor(effective)`.
  - Called once at startup (after data/settings load) and again whenever the theme setting changes.
- **System tracking:** register a `matchMedia("(prefers-color-scheme: light)")` `change` listener once; when it fires AND `nt_theme === "system"`, re-run `applyTheme()`.

## No-Flash Startup

Add a tiny inline `<script>` in `<head>` (before the stylesheet paints) that sets the initial `data-theme` from localStorage, so the first paint is already the right theme:
```html
<script>
  (function () {
    try {
      var t = localStorage.getItem("nt_theme") || "dark";
      var eff = t === "light" ? "light"
        : t === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
        : "dark";
      document.documentElement.setAttribute("data-theme", eff);
    } catch (e) {}
  })();
</script>
```
`applyTheme()` later reconciles with the cached/Supabase setting + StatusBar (which can't run pre-Capacitor anyway). The `nt_theme` localStorage key written by `setSetting` (which uses `nt_<key>`) must match — note `setSetting("theme", …)` writes `nt_theme`, so the inline script reads `nt_theme`. (Confirm key naming in the plan.)

## Light Palette (initial values, tune in plan)

`[data-theme="light"]`:
```
--bg: #f6f7fb; --surface: #ffffff; --surface2: #eef1f6; --card-bg: #ffffff;
--border: #dfe3ec; --text: #1c1f2a; --text-dim: #5d6478;
--primary: #2f6fed; --primary-hover: #2257c9;
--green: #1f9d63; --red: #d64545; --yellow: #c98a00; --orange: #d2691e;
```
(Dark keeps the existing `:root` values.) Verify contrast of status colors on white; adjust if needed.

## FAB Icons

- In `index.html`, replace the `#food-fab` content (`&#43;`) and `#photo-fab` content (`📷`) with inline **SVG** icons (a "plus" and a "camera"), `width/height ~24`, `fill`/`stroke: currentColor`, the FAB's `color` being the icon color (white).
- `.fab` background becomes **`var(--fab-bg)`** (new variable). Dark: `--fab-bg: #2bb673` (current green). Light: a green that reads on light (e.g. `#1f9d63`) — or keep the same green (it works on both); decide in plan. Icon color stays white via `.fab { color: #fff }` (or `--fab-fg`).
- Keep the 56px circle, position, shadow, and `mobile-only` visibility unchanged. The camera FAB stays offset (`.fab-secondary { right: 80px }`).

## Settings Selector

Add a **"Theme"** `<select>` (options Dark / Light / System) to the settings area on the Targets tab (e.g., in the "Macros & estimation" panel via `renderMacroSettings`, or a small dedicated `renderThemeSetting`). Current value selected from `nt_theme`. On `change`: `setSetting("theme", value)` then `applyTheme()`.

## File Structure

- New: `www/theme.js` — `window.Theme` UMD (pure): `resolveTheme(setting, prefersLight)` → `"dark"|"light"`; `statusBarFor(effective)` → `{ color, style }` (e.g. dark → `{color:"#16324f", style:"DARK"}`, light → `{color:"#f6f7fb", style:"LIGHT"}`). Tests in `tests/theme.test.js`.
- Modify: `www/index.html` — inline no-flash script in `<head>`; SVG FAB icons; theme `<select>` in settings.
- Modify: `www/styles.css` — `[data-theme="light"]` palette; `--fab-bg`/icon sizing; FAB uses `var(--fab-bg)`.
- Modify: `www/app.js` — `applyTheme()` + setting accessors (`getTheme`/`setTheme`), system-change listener, StatusBar integration (replace the current one-time `StatusBar.setBackgroundColor("#16324f")` call with `applyTheme()`), selector wiring, and call `applyTheme()` in init.

## Error & Edge Handling

- `matchMedia` unavailable (very old webview): treat as not-light (dark). The inline script and `resolveTheme` both guard.
- Unknown stored `nt_theme`: `resolveTheme` falls back to `"dark"`.
- StatusBar plugin absent (web preview): skip the StatusBar calls (guard on `Capacitor.Plugins.StatusBar`).
- No-flash script failure: wrapped in try/catch; worst case the default dark `:root` paints first.

## Testing

- **Unit (`node --test`):** `resolveTheme` — `"dark"→"dark"`, `"light"→"light"`, `"system"+prefersLight→"light"`, `"system"+!prefersLight→"dark"`, unknown→`"dark"`; `statusBarFor("dark"/"light")` returns the expected color/style.
- **Behavioral (emulator, DevTools):** switching the selector flips `data-theme`, repaints the palette and FAB icons, updates the status bar, and persists across reload; `system` follows the device light/dark; the FAB icons render as monochrome SVG (no emoji), legible on both themes; no flash of the wrong theme on cold start.

## Open Decisions (confirm during planning)

1. Light-theme `--fab-bg`: reuse the dark green `#2bb673` (works on both) vs a slightly deeper green for white backgrounds. Default assumption: keep `#2bb673` for both unless it reads poorly on light.
2. Exact light-palette hex values may be tuned during implementation for contrast (WCAG-ish) without re-approval.
