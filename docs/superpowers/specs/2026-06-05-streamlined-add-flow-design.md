# Streamlined Add Flow (no macro fields, unified +/Batch tabs) — Design Spec

**Date:** 2026-06-05
**Status:** Approved (design), pending implementation plan
**Applies to:** web (`www/`) and Android (Capacitor, same `www/` codebase)
**Builds on:** the configurable-macros background-estimate feature (macros are AI-generated; entries carry `estimateStatus`).

## Overview

Three connected UX changes to food logging:

1. **Drop manual macros from the modal.** The Add/Edit Food form keeps only the editable inputs (Food, Date, Time, Quantity, Unit). The macro value fields and the "Leave macros blank…" hint are removed. Macros are AI-generated and shown only on the food cards/table.
2. **Unify + and Batch into one Add modal with Single | Batch tabs.** Tapping **+** opens an Add modal with a tab toggle; Single is the one-entry form, Batch is the multi-row form. Editing an entry reuses the Single form with the tabs hidden.
3. **Remove the redundant toolbar buttons.** On mobile the **+ FAB** and **camera FAB** are the add controls (toolbar buttons hidden). On desktop the FABs stay hidden and the toolbar shows a single **"+ Add Food"** button (no Snap — camera is mobile-only).

### Goals
- A clean entry form that only exposes what the user can meaningfully edit.
- One obvious "add" affordance per platform; Batch reachable without a separate button.
- No redundant controls.

### Non-Goals
- Changing the macro estimation engine, the macro model, or the cards/table display.
- Manual macro entry (removed entirely — macros are AI-only now).
- Desktop photo capture (camera is mobile-only; Snap is not offered on desktop).

## Add/Edit Modal

**Fields (Single form):** Food, Date, Time, Quantity, Unit — all editable. **Removed:** the dynamic macro inputs (`#food-macro-fields` / `renderFoodMacroFields`) and the `.modal-hint`.

**Add (new entry):**
- Build `{ date, time, food, qty, unit, macros: {}, estimateStatus: "pending" }`, save, close, re-render, `enqueueEstimate(id)`.

**Edit (existing entry):**
- Pre-fill the 5 fields. Remember the original `food`, `qty`, `unit` (capture at open).
- On Save: update the 5 fields on the entry. Then **if `food` OR `qty` OR `unit` changed** vs the originals → set `macros = {}`, `estimateStatus = "pending"`, and `enqueueEstimate(id)` (re-estimate). **Else** (only date/time changed) → leave `macros`/`estimateStatus` untouched (no AI call).
- (No manual macro entry, so there is no "fill blanks" path anymore; the queue still fills `estimateStatus === "pending"` entries.)

`saveFood` drops `readMacroInputs()` and the macro-field handling; `openFoodModal` drops `renderFoodMacroFields()` and instead stashes the original food/qty/unit for the change check (e.g., on a module var or `data-*`).

## Unified Add Modal with Single / Batch Tabs

- One modal (`#food-modal` repurposed, or a new `#add-modal`) contains a **tab toggle** (`Single` | `Batch`) and two panes:
  - **Single pane:** the food form above.
  - **Batch pane:** the existing batch UI (shared Date/Time + multiple `food/qty/unit` rows + "Add Row").
- **Opening via + (add):** show the modal with the tab toggle visible, default to **Single**.
- **Opening via edit (tap card / edit button):** show the modal on the **Single** pane with the **tab toggle hidden** and the title "Edit Food Entry" (you edit one entry; Batch is add-only).
- **Save (Single):** one entry (pending estimate) as above.
- **Save (Batch):** N entries, each with `macros: {}`, `estimateStatus: "pending"`, then `enqueueEstimate` per row (this is the current batch-save behavior).
- The current separate `#batch-modal` is folded into this modal as the Batch pane; its open/save logic moves into the tab. Cancel/overlay close the whole modal.

Tab toggle styling reuses the existing tab pattern (the app already has `.tab`/`.tab-content` for the top tabs) or a small dedicated `.modal-tabs` toggle — pick the lighter option in the plan.

## Toolbar / FAB Layout

- **Toolbar (Food tab):** replace the three buttons (`#add-food-btn` "+ Add Food", `#batch-add-btn` "+ Batch Add", `#photo-add-btn` "Snap") with a **single `#add-food-btn` "+ Add Food"** that opens the unified Add modal (tabs visible, Single default). Mark it **`desktop-only`** (visible on desktop, hidden on mobile). Keep the date-filter group.
- **FABs:** unchanged visibility (**`mobile-only`**). `#food-fab` (+) opens the unified Add modal (tabs visible, Single default). `#photo-fab` (camera) runs Snap. No camera/Snap control on desktop.
- **New CSS class `desktop-only`:** the mirror of `mobile-only` — `display: none` under `@media (max-width: 720px)`, shown otherwise. (Confirm exact mechanism against the existing `mobile-only` rule.)

Net: mobile shows the two FABs and no toolbar add buttons; desktop shows one "+ Add Food" toolbar button and no FABs/Snap.

## Data Flow / Edge Cases

- Tab switch does not lose data within a single open session (each pane keeps its own inputs); closing the modal resets.
- Edit always lands on Single with tabs hidden; the user can't switch an edit into Batch.
- The estimate queue, status badges, and cards/table are unchanged — entries still flow `pending → done/error`.
- Removing macro fields means a saved entry on a **no-key** device gets `estimateStatus` set by the queue's no-key path (`manual`) and simply shows blank macros until a key is added (same as today).

## File Structure / Affected Code

- `www/index.html` — remove macro-field host + hint from the modal; restructure the modal with a Single/Batch tab toggle + panes (fold in the batch markup); toolbar → single "+ Add Food" (`desktop-only`); FAB handlers unchanged.
- `www/app.js` — `openFoodModal` (drop macro fields, stash original food/qty/unit, handle tab visibility for add vs edit), `saveFood` (drop macro inputs, add change-detection re-estimate), tab-switch wiring, unify batch open/save into the modal, update toolbar/FAB listeners, remove `renderFoodMacroFields`/`readMacroInputs`.
- `www/styles.css` — `.desktop-only`; modal tab-toggle styling; remove now-unused `.modal-hint` styling if present.
- `www/mobile-render.js` — unaffected (cards already show macros).

## Testing

- **Unit (`node --test`):** a small pure helper `macrosNeedReestimate(original, updated)` → boolean (true iff food/qty/unit differ) — unit-tested (e.g., in `targets.js`/a tiny module, or a pure function in a testable module). Covers: qty change → true; unit change → true; food change → true; only date/time change → false.
- **Behavioral (emulator, DevTools):**
  - Add (Single): entry appears, no macro fields in the form, macros estimate in the background.
  - Add (Batch): switch to Batch tab, add rows, save → N pending entries estimate.
  - Edit: change qty → macros re-estimate (status pending→done); change only time → macros unchanged (no re-estimate).
  - Mobile: no toolbar add buttons; + FAB and camera FAB work; + opens Single/Batch tabs.
  - Desktop (narrow→wide viewport): "+ Add Food" toolbar button visible, FABs hidden, no Snap.

## Open Decisions (confirm during planning)

1. Reuse `#food-modal` as the unified modal vs introduce `#add-modal`. Default: repurpose `#food-modal` (less churn; edit already uses it).
2. Tab toggle implementation: a tiny `.modal-tabs` button pair vs reusing `.tab` classes. Default: a small dedicated `.modal-tabs` to avoid coupling to the page-level tab system.
