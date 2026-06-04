# Snap-to-Log: Photo Food Capture — Design Spec

**Date:** 2026-06-04
**Status:** Approved (design), pending implementation plan
**Applies to:** web (`www/`) and Android (Capacitor, same `www/` codebase)
**Builds on:** the configurable-macros feature (macro `{low,high}` model, `Macros` module, provider layer) merged 2026-06-04.

## Overview

Let users log food by **taking or picking a photo**. A vision-capable AI identifies the foods, estimates portions and macros, and presents an **itemized list** the user can **confirm or correct** (with free-text corrections that the AI re-estimates against). On confirm, each item is saved as its own food entry. The photo is used transiently for estimation and is **never stored**.

Primary use case: logging a meal while out, with no weighing scale — e.g. a photo of "a sloppy joe with fries" becomes two entries with estimated macros, after the user confirms or corrects the AI's reading.

### Goals
- One-tap path from a meal photo to itemized, macro-tagged entries.
- Human-in-the-loop: AI estimates; user confirms or corrects; AI iterates.
- Reuse the existing macro model, provider layer, and entry/save pipeline.

### Non-Goals (out of scope)
- Storing/displaying the photo (discarded after estimation).
- Barcode scanning, packaged-food database lookups.
- Background/automatic photo estimation (the flow is interactive by design).
- Dual-AI cross-check on images (single vision call; the confirm/correct loop is the accuracy mechanism).
- Multi-photo meals in one session (one photo → one item list per session).

## User Flow

1. **Food tab** shows a **"📷 Snap"** action (alongside + Add Food / Batch Add; on mobile, near the FAB).
2. Tap → `Camera.getPhoto({ source: Prompt })` → user chooses **Camera** or **Gallery**.
3. App shows a loading state while the vision call runs.
4. **Confirm/Correct modal** opens with the AI's itemized list: each row = food name, portion, and the enabled macros.
5. User actions:
   - **Confirm all** → save each item as a food entry → close.
   - **Correct** → free-text box; on submit, re-run the vision call with the same image + prior items + the correction; replace the list. Repeat as needed.
   - **Cancel** → discard everything (and the in-memory image).
   - Per-row inline edit of food name + portion for small fixes without an AI round-trip.

## Architecture

Reuse the existing provider pattern rather than a separate vision subsystem. Add vision capability to the provider layer and a small set of pure helpers (testable, in `www/macros.js` or a new `www/photo.js` UMD module — see File Structure).

### Components
- **Capture** (`capturePhoto()` in app.js): wraps `@capacitor/camera`; returns `{ base64, mimeType }` or null (cancel). Compresses/resizes (quality ~70, max edge ~1024 px).
- **Vision call** (provider methods + `estimatePhoto`): provider-specific request builders that attach the image; one call per estimate/correction.
- **Pure helpers** (`window.PhotoEstimate` UMD, `www/photo.js`):
  - `buildVisionSystemPrompt(macroIds)` → instructs a strict JSON response: `{ "items": [ { "food": str, "portion": str, <macroId>_lower, <macroId>_upper, ... } ], "reasoning": str }`.
  - `buildVisionUserText(correctionHistory)` → the instruction text, appending any prior items + correction notes.
  - `parseVisionResponse(jsonText, macroIds)` → `{ items: [ { food, portion, macros: {id:{low,high}} } ] }`, tolerant of missing keys (reuses `Macros.parseMacros` per item).
  - `itemsToEntries(items, dateTime, idStart)` → food entries with `macros` + `estimateStatus:"done"`.
- **Confirm/Correct modal** (`#photo-modal` in index.html + render/handlers in app.js).
- **Settings**: vision provider selector.

### Data flow
`capturePhoto()` → `estimatePhoto(image, history)` → vision call → `parseVisionResponse` → render list in modal → (correct → loop) → `itemsToEntries` → `saveFoodEntries` → re-render. Image held in a module-scoped variable for the modal's lifetime; cleared on confirm/cancel.

## Vision Call Details

- **Provider methods:** add `callVision(imageBase64, mimeType, systemPrompt, userText, model)` to each provider in `PROVIDERS`.
  - **OpenAI:** chat/completions with a user message whose `content` is an array of `{type:"text",text:userText}` + `{type:"image_url", image_url:{url:"data:<mime>;base64,<data>"}}`; `system` message = systemPrompt.
  - **Anthropic:** messages API with user `content` array of `{type:"text",text:userText}` + `{type:"image", source:{type:"base64", media_type:<mime>, data:<data>}}`; top-level `system` = systemPrompt.
- **`estimatePhoto(image, history)`** (app.js): resolves the configured vision provider (see Settings), builds prompts via `PhotoEstimate.buildVision*`, calls `provider.callVision(...)`, returns `parseVisionResponse(...)`. Throws `"no-api-key"` when the chosen provider has no key.
- Macros requested = `getEnabledMacros()`; values stored as `{low,high}` (single-value display uses midpoint, per existing settings).
- `reasoning` requested but discarded.
- **Correction iteration:** each correction is stateless — one fresh `callVision` with the same image + a `userText` that includes the previous item list (as JSON) and the user's correction note ("Re-estimate; the user says: …"). Robust and simple; image re-sent each turn (corrections are infrequent).

## Saving

On **Confirm all**: `itemsToEntries(items, now, maxId+1)` builds one entry per item:
```js
{ id, date: today, time: now, food: item.food, qty: 1, unit: item.portion, macros: item.macros, estimateStatus: "done" }
```
(`qty:1` + `unit:portion` keeps the AI's human-readable portion in the existing qty/unit fields; the macros are already absolute for that portion.) Saved via `saveFoodEntries` (hardened: upsert-before-delete), then `ensureDayExists(today)`, `renderFoodTable`, `renderCalorieTracker`. Status `"done"` means no background re-estimate; if the user later clears a macro on an entry, the existing text-based background estimate fills it.

## Settings

Add to the "Macros & estimation" panel:
- **Photo (vision) provider** select — lists providers that have an API key; default = first available. Uses that provider's **primary model** (all current primary models are vision-capable). Stored as setting `vision_provider` via the existing `getSetting`/`setSetting`.

## Error & Edge Handling

- **No camera plugin permission / user cancels capture:** no-op, no error.
- **No API key for the chosen vision provider:** Snap shows a friendly "Add an API key in Settings" message; nothing opens.
- **Offline / API error:** modal (or a toast) shows the error with a Retry; nothing saved.
- **Empty/unparseable response:** "Couldn't read that photo — try another or add manually."
- **Large image:** mitigated by capture-time compression/resize.
- **Zero items after corrections:** Confirm disabled; user can Cancel.

## Privacy & Data

The image never leaves the device except as the transient body of the vision API request to the user's configured provider (same trust boundary as existing text estimation). It is not written to entries, localStorage, or Supabase. No schema changes required.

## File Structure

- New: `www/photo.js` — `window.PhotoEstimate` UMD (pure: prompt builders, `parseVisionResponse`, `itemsToEntries`). Node-testable like `macros.js`. Depends on `Macros` for `promptFields`/`parseMacros`/`macroFields`.
- New: `tests/photo.test.js` — unit tests for the pure helpers.
- Modify: `www/index.html` — load `photo.js` before `app.js`; add `#photo-modal`; add the "📷 Snap" trigger in the Food tab; vision-provider select in settings.
- Modify: `www/app.js` — `capturePhoto`, `estimatePhoto`, provider `callVision` methods, modal render/handlers, `vision_provider` setting, Snap wiring.
- Modify: `www/styles.css` — photo modal + item-list styles.
- Modify: `www/mobile-render.js` — none expected (photo entries render like any other).
- New dependency: `@capacitor/camera` (+ `npx cap sync android`, Android camera/photo permissions in the manifest).

## Testing

- **Unit (`node --test`):** `buildVisionSystemPrompt` includes the enabled macro fields; `parseVisionResponse` builds `{items:[{food,portion,macros}]}` and tolerates missing/extra keys and non-numeric coercion; `itemsToEntries` produces well-formed entries with unique ids + `estimateStatus:"done"`.
- **Behavioral (emulator, WebView DevTools recipe):** with a vision key set, drive `estimatePhoto` on a sample food image (base64 fixture) and verify a parsed item list; verify the no-key path and the cancel path; verify Confirm creates the expected entries (then clean up test entries).

## Open Decisions (confirm during planning)

1. **Vision-provider model:** use the provider's existing **primary model** (assumed — all are vision-capable), vs adding a separate "vision model" setting. Default assumption: reuse primary model; no extra setting.
2. **Snap trigger placement on mobile:** a second FAB vs an action in the existing add menu. Default assumption: a small camera button next to the + FAB.
