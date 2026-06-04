# Global Targets + Auto-Created Days — Design Spec

**Date:** 2026-06-04
**Status:** Approved (design), pending implementation plan
**Applies to:** web (`www/`) and Android (Capacitor, same `www/` codebase)
**Builds on:** configurable-macros + photo-capture features (merged 2026-06-04). Reuses the macro `{low,high}` model, the hardened `saveFoodEntries`/`saveDayEntries` pattern, and the existing `WEIGHT_LOSS_GOALS` map.

## Overview

Two related simplifications of the Days/Targets flow:

1. **Auto-create days.** Days are created automatically when food is logged (already done by `ensureDayExists`); remove the manual **"+ Add Day"** button and add path. Day **Edit** (weight + activity) and **Delete** remain.
2. **Global targets.** Move the calorie **deficit** and **protein target** off individual Day entries and onto the **Targets tab** as single global values. **Age** also moves to the Targets tab (a personal constant). A Day shrinks to `{ date, weight, activity }`.

### Goals
- Logging food is the only action needed to start tracking a day.
- One place (Targets) for personal constants and goals — no per-day target duplication.

### Non-Goals
- Changing weight handling (weight stays per-day — it genuinely varies).
- Per-day or date-ranged target overrides (targets are a single current value).
- Historical re-computation: existing logged days keep their weight/activity; past assessments already saved are unchanged.

## Data Model

### Profile (global — the Targets store)
```js
profile = { height, age, proteinLow, proteinHigh, weightLossGoal }
```
- New fields: `age` (number), `weightLossGoal` (string label).
- `weightLossGoal` is one of the `WEIGHT_LOSS_GOALS` labels plus **"Maintain"**:
  - "Maintain" → deficit 0
  - "0.25 kg/week" → 275, "0.50 kg/week" → 550, "0.75 kg/week" → 825, "1.00 kg/week" → 1100
- Daily deficit is **derived**, never stored separately: `getDeficit()` looks up `profile.weightLossGoal` in the goal map (default 550 / "0.50 kg/week" if unset/unknown).
- `DEFAULT_PROFILE = { height: 170.1, age: 32, proteinLow: 135, proteinHigh: 150, weightLossGoal: "0.50 kg/week" }`.

### Day (shrunk)
```js
day = { id, date, weight, activity }
```
- Removed: `age`, `deficit`, `proteinTargetLow`, `proteinTargetHigh`.

## Auto-Create Days

- `ensureDayExists(date)` remains the sole creator, called from `saveFood`, batch save, and photo confirm. It creates `{ id, date, weight, activity }` copying `weight`/`activity` from the most recent existing day, or defaults (`weight: 168`, `activity: ACTIVITY_TYPES[0].label`) when there is no prior day. It no longer sets age/deficit/protein.
- **Remove** the `#add-day-btn` button, its listener, and the day modal's "add" path.
- **Keep** day **Edit** (weight + activity) and **Delete**.

## Targets Tab

Extend the existing Profile form (currently height + protein low/high) with:
- **Age** number input.
- **Weight-loss goal** `<select>` listing "Maintain" + the four `WEIGHT_LOSS_GOALS` labels, current value selected from `profile.weightLossGoal`.

`saveProfileForm` persists `height, age, proteinLow, proteinHigh, weightLossGoal`. No per-day target inputs anywhere.

## Consumers Switch to Global

Every reader of the removed per-day fields now reads the profile:
- **`renderCalorieTracker`** (`www/app.js`): `bmr = calcBMR(day.weight, profile.height, profile.age)`; `target = tdee - getDeficit()`; protein surplus vs `profile.proteinLow/High`. The now-constant **Deficit** and **Protein-target** per-row columns are **removed** from the table; the table header drops them. The single global deficit/protein target are shown once (e.g., a small line above the table or in the Targets tab — see Rendering).
- **Mobile day cards** (`renderDayCards`, `www/mobile-render.js`): drop the per-day Deficit/Protein-target rows; keep weight, BMR/TDEE (using `profile.age`), activity, target, cal +/- and protein vs the global target.
- **Diet Assessment** (`buildRangeData`, `buildAssessmentPrompt`, `renderAssessmentResults` daily context): replace `day.deficit` → `getDeficit()`, `day.proteinTargetLow/High` → `profile.proteinLow/High`, `day.age` → `profile.age`. (This is the same class of reader-migration the macros feature required — all sites must be updated, none missed.)
- **`ensureDayExists`** and the day modal stop referencing the removed fields.

## Migration + Persistence

### Supabase schema (USER ACTION — run once)
The `profile` table needs two new columns:
```sql
alter table profile add column if not exists age integer;
alter table profile add column if not exists weight_loss_goal text;
```
Reads tolerate their absence (fall back to defaults / seed-from-days); localStorage works regardless. The `days` table is unchanged — its `age`/`deficit`/`protein_target_*` columns simply stop being written (left as-is for old rows).

### Mappers
- `profileRowToJs`/`profileJsToRow`: include `age` and `weight_loss_goal` ↔ `weightLossGoal`.
- `dayRowToJs`/`dayJsToRow`: map only `{ id, date, weight, activity }` going forward. `dayJsToRow` no longer writes age/deficit/protein_target (or writes them null) — confirm `saveDayEntries` is the hardened upsert-before-delete form so a write can't wipe the table.

### Seed-on-load
After data load, if `profile.age` or `profile.weightLossGoal` is missing:
- `age` ← the `age` of any existing day entry (fallback 32).
- `weightLossGoal` ← map the most common existing `day.deficit` to its goal label (550 → "0.50 kg/week"; fallback "0.50 kg/week").
Persist the seeded profile once.

## Rendering Details

- Show the global deficit and protein target once where they're relevant — simplest: the Targets tab Profile form already displays them (goal select + protein inputs), and the calorie tracker's per-day **Target** column reflects `tdee - getDeficit()`. No new summary widget required (YAGNI); the removed columns are simply gone.
- Day Edit modal: fields reduce to **Weight** + **Activity** (date shown read-only). Title stays "Edit Day".

## Error & Edge Handling

- First-ever day (no prior, empty profile): `ensureDayExists` uses defaults; `getDeficit()` returns 550.
- Unknown/blank `weightLossGoal`: `getDeficit()` falls back to 550.
- Deleting all days: tracker shows empty state (unchanged behavior).

## File Structure

- New pure module `www/targets.js` (`window.Targets`, UMD like `macros.js`) for the testable pure logic: the goal list, `deficitForGoal(label)`, `migrateProfile(profile, days)` (seed age/goal from days), and `migrateDay(day)` (strip the removed fields, keep date/weight/activity). Tests in `tests/targets.test.js`. (`WEIGHT_LOSS_GOALS` currently lives in `app.js`; the module can own the canonical list and `app.js` can reference it, or the module can accept the list — decide in planning to avoid duplication.)
- Modify `www/app.js`: profile model/defaults, mappers, `ensureDayExists`, `renderCalorieTracker`, day modal (`openDayModal`/`saveDay`), `saveProfileForm`, assessment readers, remove `#add-day-btn` wiring.
- Modify `www/mobile-render.js`: `renderDayCards`.
- Modify `www/index.html`: Profile form (age + goal select), remove "+ Add Day" button, trim day modal fields, calorie-tracker table header.
- Modify `www/styles.css`: minor if needed.

## Testing

- **Unit (`node --test`):** `deficitForGoal` (each label + Maintain + unknown→550); `migrateProfile` (seeds age/goal from days, leaves populated profile untouched); `migrateDay` (strips age/deficit/protein, keeps date/weight/activity).
- **Behavioral (emulator, DevTools):** logging food on a new date auto-creates a `{date,weight,activity}` day (no Add Day button present); editing a day changes weight/activity only; the calorie tracker target = TDEE − global deficit and protein surplus uses the global protein target; the assessment data uses global values (non-zero, correct); profile form persists age + goal.

## Open Decisions (confirm during planning)

1. Where to surface the single global deficit/protein numbers in the Days view — assumed: nowhere new; the Target column + Targets tab suffice (removed columns simply gone). If a one-line "Goal: 0.5 kg/week (−550 kcal), protein 135–150 g" header above the tracker is wanted, it's a small add.
2. Keep `age` on the day modal as read-only context? Assumed: no — age is global now and not shown per-day.
