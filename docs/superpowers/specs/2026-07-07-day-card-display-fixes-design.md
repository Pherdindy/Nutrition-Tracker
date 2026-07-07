# Day-card Cal +/- and Protein Display Fixes — Design

**Date:** 2026-07-07
**Status:** Approved
**Scope:** Mobile day cards only (`renderDayCards` in `www/mobile-render.js`). The desktop calorie-tracker table keeps its existing separate numeric +/- columns unchanged.

## Problem

1. The day card's **Cal +/-** row renders the raw signed range, e.g. `-273 … -70`. Two negative numbers with no context read backwards and give no cue that this means "under target" (good).
2. The **Protein** row renders `136–147 g (target 135–150)` in plain text — identical styling whether the target is met or badly missed.

## Solution

Two pure display helpers added to `www/targets.js` (`window.Targets`, UMD), consumed by `renderDayCards`. Each returns `{ text, tone, icon }` where `tone ∈ "good" | "bad" | "warn" | "neutral"` and `icon` is `""` when not applicable.

### 1. `calDeltaDisplay(overLow, overHigh)`

Inputs are `caloriesEaten − target` for the low and high ends of the eaten range (`overLow ≤ overHigh`).

| Case | Text | Tone |
|---|---|---|
| Whole range below target (`overHigh < 0`, outside neutral band) | `70–273 under target` (absolute values, small number first) | good (green) |
| Whole range above target (`overLow > 0`, outside neutral band) | `112–283 over target` | bad (red) |
| Range straddles zero, or entirely within the ±50 neutral band | `on target` | neutral (dim) |
| Degenerate range (`overLow === overHigh`) | single number, e.g. `170 under target` | per sign, as above |

The ±50 neutral band matches the existing `surplusClass()` thresholds: a range like `−40 … 30` is `on target`.

### 2. `proteinStatusDisplay(proLow, proHigh, targetLow, targetHigh)`

Inputs are the eaten protein range and the profile's protein target range.

| Case | Text | Tone | Icon |
|---|---|---|---|
| `proLow ≥ targetLow` (met; exceeding `targetHigh` still counts as met — protein surplus is good, matching existing `proteinSurplusClass` semantics) | `136–147 g (target 135–150)` | good | ✓ |
| `proHigh < targetLow` (missed) | `93–102 g (target 135–150)` | bad | ✗ |
| Range straddles `targetLow` (borderline, e.g. 128–140 vs 135) | `128–140 g (target 135–150)` | warn (amber) | ~ |

The icon carries the meaning so the cue is not color-only (accessibility).

### Rendering

`mobile-render.js` maps `tone` to CSS classes that use existing theme variables only (`--green`, `--red`, `--text-dim`, amber via a theme-safe var or a `[data-theme]`-aware rule) — no hardcoded colors (light/dark theme lesson). Existing `.positive`/`.negative` classes may be reused where their colors already match.

### Error handling

If profile/target data is missing (null/undefined/NaN inputs), helpers return `{ text: "", tone: "neutral", icon: "" }` and `renderDayCards` falls back to the current plain rendering.

## Testing

- Unit tests in `tests/targets.test.js` (TDD): all four cal cases (under / over / straddle / degenerate), the neutral-band edge, three protein cases (met incl. above-target-high, missed, borderline), and null/NaN fallback.
- Manual visual check on the emulator in dark and light themes.

## Out of scope

- Desktop table changes.
- Charts (separate upcoming spec).
- Assessment views.
