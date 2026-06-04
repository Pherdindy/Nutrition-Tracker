# Configurable Macros + Background Auto-Estimate — Design Spec

**Date:** 2026-06-04
**Status:** Approved (design), pending implementation plan
**Applies to:** web (`www/`) and Android (Capacitor, same `www/` codebase)

## Overview

Three connected changes to the food-logging experience:

1. **Hide AI reasoning** — users see only the estimated output, never the "AI Thought Process" panel (reasoning text, Round 1/Round 2 tables, spread/verdict). Web and mobile.
2. **Configurable macros** — users choose which macros to track (add/remove at will) from a curated catalog. Calories & Protein are always tracked; everything else is toggleable.
3. **Background auto-estimate** — remove the "Estimate Calories & Protein" button. Tapping **Save** stores the entry instantly and the AI fills any blank macros **in the background**, so the UI never blocks on the AI.

### Goals
- Snappy entry: saving never waits on an AI round-trip.
- Flexible, label-standard macro tracking without Cronometer-level bloat.
- Cleaner modal: just inputs + Save.

### Non-Goals (explicitly out of scope)
- Making the Diet Assessment macro-aware (it keeps using calories + protein, but reads the new data model). Possible later enhancement.
- Vitamins/minerals beyond the macro catalog below.
- Net carbs / cholesterol (not selected; catalog is extensible if added later).
- Server-side AI proxy / auth (separate Phase 2 work).

## Macro Catalog

| id | label | unit | default | AI-estimated |
|----|-------|------|---------|--------------|
| `calories` | Calories | kcal | **always on (locked)** | yes |
| `protein` | Protein | g | **always on (locked)** | yes |
| `carbs` | Carbs | g | on | yes |
| `fat` | Fat | g | on | yes |
| `fiber` | Fiber | g | off | yes |
| `sugar` | Sugar | g | off | yes |
| `saturatedFat` | Saturated fat | g | off | yes |
| `sodium` | Sodium | mg | off | yes |

- **Calories & Protein are locked on** because Targets and the Diet Assessment are built on them.
- The catalog is a single source-of-truth array (id, label, unit, locked, defaultOn) so adding a macro later (e.g. net carbs, cholesterol) is a one-line change.

## Data Model

### Food entry (new shape)
```js
{
  id, date, time, food, qty, unit,
  macros: {
    calories: { low: <num>, high: <num> },
    protein:  { low: <num>, high: <num> },
    carbs:    { low: <num>, high: <num> },
    // ...one key per macro that has a value
  },
  estimateStatus: "pending" | "done" | "manual" | "error" | null,
}
```

- **Internal representation is always `{ low, high }`**, regardless of the user's value-format setting. In single-value mode `low === high`. This keeps day totals, cards, and the assessment on one uniform shape; "single vs range" is purely a display/input concern.
- A macro key is **absent** when it has no value yet (blank/unestimated). Code reads with a helper that treats absent as null.
- `aiThoughtProcess` is **no longer stored** (reasoning is hidden). Existing entries may still have it; it is ignored and dropped on next save.

### Migration (non-destructive, on load)
For any entry lacking `macros`:
- `macros.calories = { low: calLow, high: calHigh }` (when present)
- `macros.protein  = { low: proLow, high: proHigh }` (when present)
- Legacy fields `calLow/calHigh/proLow/proHigh` are read once, copied into `macros`, then dropped when the entry is next written. Migration runs in the data layer (`initFromSupabase` / `loadFoodEntries` normalization) so all readers see the new shape.

## Settings

New **"Macros & estimation"** section in the Targets tab. Stored via the existing settings mechanism (key-value `settings` table + localStorage mirror).

| key | values | default |
|-----|--------|---------|
| `nt_macros_enabled` | JSON array of macro ids | `["calories","protein","carbs","fat"]` |
| `nt_value_format` | `"single"` \| `"range"` | `"single"` |
| `nt_estimation_mode` | `"reconcile"` \| `"single"` | `"reconcile"` |

UI:
- **Macros to track:** checkbox list from the catalog; Calories & Protein rendered checked + disabled (locked).
- **Value format:** Single value *(default)* / Low–high range.
- **Estimation:** Dual-AI cross-check *(default)* / Single fast call.

Changing enabled macros affects which fields/columns appear and which the AI estimates; it does **not** retroactively estimate historical entries (existing values stay; newly-enabled macros simply show blank for old entries).

## Add/Edit Food Modal (web + mobile)

**Removed:**
- `#estimate-btn` ("Estimate Calories & Protein") and `#estimate-status`.
- `#validation-results` panel and all calls to `renderValidationResults` from the modal path.

**Layout:**
- date, time, food, qty, unit
- One macro input per **enabled** macro (label shows unit), rendered dynamically from `nt_macros_enabled`:
  - `single` mode → one number input.
  - `range` mode → lower + upper pair (reuse `.form-row-pair`).
- Hint text: *"Leave macros blank — we'll estimate them automatically after you save."*
- Cancel / Save.

`openFoodModal(entry)` populates the macro inputs from `entry.macros`; absent macros render blank. The earlier try/catch guard around reasoning rendering is removed along with the panel (no longer needed).

## Background Auto-Estimate

### Trigger
On `saveFood` (and batch save):
1. Read the form, build the entry's `macros` from whatever the user typed (manual values).
2. Determine **blank enabled macros** (enabled in settings, no value entered).
3. If any blank → set `estimateStatus = "pending"`; else `"manual"`.
4. **Save immediately** (cache + localStorage + `bgWrite` to Supabase), close modal, re-render. The UI is now done.
5. If pending, enqueue a background estimate (not awaited).

### Estimation manager
- A small in-memory queue (`estimateQueue`) with limited concurrency (e.g. 1–2 at a time) to avoid hammering the API.
- For each queued entry: run the chosen engine for the **blank** macros only:
  - `reconcile` → existing dual-provider, multi-round reconciliation logic, generalized to the enabled macro set.
  - `single` → one primary-model call per configured provider, averaged if >1; no reconciliation rounds.
- On success: merge results into the entry's blank macros only (never overwrite manual values), set `estimateStatus = "done"`, persist, re-render affected views.
- On failure: `estimateStatus = "error"`; leave macros blank; surface a quiet, non-blocking indicator (no alert spam). Entry remains editable.

### Resume after interruption
At startup, after data load, sweep for entries with `estimateStatus === "pending"` and re-enqueue them (covers app-close mid-estimate).

### No API key configured
Skip estimation entirely; entry stays `"manual"` with blank macros. Show a one-time gentle hint pointing to provider settings. No repeated errors.

### Pending/error indicators
- Cards/table show "estimating…" (or a small spinner/dim) for entries with `estimateStatus === "pending"`, and a subtle retry affordance for `"error"`.

## AI Prompt & Parsing Changes

- `SYSTEM_PROMPT_ESTIMATE` / `SYSTEM_PROMPT_RECONCILE` become **dynamic**: the requested JSON keys are built from the macros being estimated (e.g. `calories_lower/upper`, `protein_lower/upper`, `carbs_lower/upper`, ...). For single-value mode the AI is still asked for lower/upper (we store `low/high`; single mode just displays the midpoint or the single number — see Open Decisions).
- `reasoning` may still be requested (it improves model output) but is **discarded** — not stored, not displayed.
- `parseAIResponse` generalizes from the fixed 4 fields to the dynamic macro set, tolerating missing keys.
- `averageResults`, `calcSpread`, reconciliation merging generalize over the macro set instead of hardcoding calories/protein.

## Display: Cards, Table, Day Totals, Assessment

- **Helper layer:** `getMacro(entry, id)` → `{low, high}|null`; `formatMacro(value, format)` for single vs range display. All readers go through helpers.
- **Mobile cards** (`renderFoodCards`): show Calories prominently + each enabled macro compactly; pending/error state per above.
- **Desktop table** (`renderFoodTable`): columns for enabled macros.
- **Day totals** (`getDailyFoodTotals`): sum per-macro low/high across entries; generalize beyond calories/protein so totals are available for any enabled macro.
- **Diet Assessment:** unchanged logic, but reads calories/protein via the helper layer (still uses the `{low,high}` shape). Not made macro-aware in this scope.

## Batch Add

Same treatment as the single modal:
- Remove batch estimate button + reasoning panel.
- Batch rows accept manual macro values per enabled macro.
- On batch save: store all entries immediately; enqueue background estimates for rows with blank macros; same pending/done/error handling.

## Edge Cases & Decisions

- **Edit re-estimate rule:** on edit, the AI only fills macros the user **clears**. Changing qty/unit does *not* silently overwrite existing values. (To force a refresh, clear the field and save.)
- **Manual + blank mix:** AI fills only blank enabled macros; typed values are authoritative.
- **Value-format switch:** changing `nt_value_format` re-renders inputs/displays from the same `{low,high}` data; no data migration needed.
- **Disabling a macro:** stored values are retained (not deleted) so re-enabling restores them; they just stop showing.

## Open Decisions (confirm during planning)

1. **Single-value semantics:** when `value_format = single`, do we display/store the **midpoint** of the AI's low/high, or ask the AI for a single point value? Leaning: keep `{low,high}` internally, display the **midpoint** (rounded) in single mode — no prompt change needed. (Default assumption unless changed.)

## Testing

- **Unit (Node `--test`, existing harness):** extract pure helpers and test them:
  - macro catalog + enabled-set resolution
  - migration (legacy fields → `macros`)
  - `getMacro` / `formatMacro` (single vs range, midpoint rounding)
  - `parseAIResponse` over a dynamic macro set (missing keys tolerated)
  - blank-macro detection for the estimate trigger
- **Behavioral (Android emulator via WebView DevTools, per project memory recipe):** save flow stays instant; pending → done transition updates the entry; reasoning panel absent; settings toggles change fields/columns. Avoid mutating real Supabase data in destructive ways during checks.

## Affected Files (initial)

- `www/index.html` — modal markup (remove button/panel, dynamic macro fields), settings section.
- `www/app.js` — data layer (migration, macro helpers, settings), modal render/save, estimation manager, prompt/parse generalization, table/day-total/assessment readers, batch flow.
- `www/mobile-render.js` — cards read macros + pending state.
- `www/styles.css` — macro field/column styling, pending/error indicators.
- `tests/` — new unit tests for the pure helpers.
