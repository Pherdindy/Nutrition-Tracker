# Streamlined Add Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove manual macro fields from the food modal, fold Batch Add into the + via a Single/Batch tab toggle, and collapse the three toolbar buttons to one desktop-only "+ Add Food" (FABs stay mobile-only; no desktop Snap).

**Architecture:** A tiny pure helper `Macros.needsReestimate(orig, upd)` decides if an edit changed nutrition-relevant fields. The `#food-modal` is repurposed into a unified Add modal with a `.modal-tabs` toggle: a Single pane (the existing food form, minus macro fields) and a Batch pane (the folded-in batch UI). Edit reuses the Single pane with tabs hidden. The separate `#batch-modal` is removed.

**Tech Stack:** Vanilla JS (no bundler), UMD modules, Node test runner, CSS custom properties.

**Reference spec:** `docs/superpowers/specs/2026-06-05-streamlined-add-flow-design.md`

**Conventions:** Commit after each task. Already on branch `feat/streamlined-add`. `npm test` for units; emulator checks via the WebView DevTools recipe in project memory.

**Current facts (verified):**
- `#food-modal` (`index.html:190-226`): form with date/time/food/qty/unit, then `<div id="food-macro-fields"></div>` (218) + `<p class="modal-hint">…</p>` (219), then `.modal-actions` (Cancel/Save).
- `#batch-modal` (`index.html:264-285`): `modal-wide`; `#batch-date`/`#batch-time`, `#batch-items`, `#batch-add-row`, `.modal-actions` (`#batch-cancel`/`#batch-save`).
- Toolbar (`index.html:35-37`): `#add-food-btn` "+ Add Food", `#batch-add-btn` "+ Batch Add", `#photo-add-btn` (Snap SVG). FABs (`51-52`): `#food-fab` (+), `#photo-fab` (camera), both `mobile-only`.
- `openFoodModal` (`app.js:687-699`) calls `renderFoodMacroFields(entry)`; `readMacroInputs` (`723-744`); `saveFood` (`746-779`) reads macros + sets pending/manual; `renderFoodMacroFields` (`664-686`).
- Batch: `openBatchModal` (`3133-3142`), `addBatchRow` (`3167-3179`), `removeBatchRow` (`3181-3185`), `closeBatchModal` (`3187-3189`), `saveBatchFoods` (`3191-3212`), `populateBatchSuggestions` (`3144-3165`).
- Listeners (`app.js`): `add-food-btn`/`food-fab` → `openFoodModal(null)` (3237-3238); `food-cancel`/overlay/`food-form` submit (3240-3242); `batch-add-btn` → `openBatchModal` (3274); `batch-add-row`/`batch-save`/`batch-cancel`/`batch-modal` overlay (3275-3278); `photo-add-btn`/`photo-fab` → `startPhotoCapture` (3281-3282).
- `.desktop-only { display:none !important }` ALREADY exists inside `@media (max-width:720px)` (`styles.css:1639`) — apply the class; no CSS needed for it.

---

## Phase 1 — `Macros.needsReestimate` helper (TDD)

**Files:** `www/macros.js`, `tests/macros.test.js`.

### Task 1.1: needsReestimate

- [ ] **Step 1: Write failing test** (append to `tests/macros.test.js`)
```js
test("needsReestimate true iff food/qty/unit changed (not date/time)", () => {
  const o = { food: "Oat", qty: 100, unit: "g" };
  assert.equal(M.needsReestimate(o, { food: "Oat", qty: 100, unit: "g" }), false);
  assert.equal(M.needsReestimate(o, { food: "Oat", qty: 150, unit: "g" }), true);   // qty
  assert.equal(M.needsReestimate(o, { food: "Oat", qty: 100, unit: "cup" }), true);  // unit
  assert.equal(M.needsReestimate(o, { food: "Oats", qty: 100, unit: "g" }), true);   // food
  assert.equal(M.needsReestimate(null, { food: "Oat", qty: 100, unit: "g" }), true); // no original (add)
});
```

- [ ] **Step 2: Run → FAIL.** `npm test`.

- [ ] **Step 3: Implement** (add inside the `macros.js` factory; add to the returned object)
```js
  function needsReestimate(orig, upd) {
    if (!orig) return true;
    return String(orig.food) !== String(upd.food)
      || Number(orig.qty) !== Number(upd.qty)
      || String(orig.unit) !== String(upd.unit);
  }
```
Add `needsReestimate` to the `return { ... }` exports.

- [ ] **Step 4: Run → PASS.** `npm test` (was 42 → 43).

- [ ] **Step 5: Commit**
```bash
git add www/macros.js tests/macros.test.js
git commit -m "feat(macros): needsReestimate(orig,upd) helper"
```

---

## Phase 2 — Modal restructure

### Task 2.1: Remove macro fields from the single modal + re-estimate on edit

**Files:** `www/index.html`, `www/app.js`.

- [ ] **Step 1 (index.html):** Delete the two lines in `#food-modal` (218-219):
```html
          <div id="food-macro-fields"></div>
          <p class="modal-hint">Leave macros blank — we'll estimate them automatically after you save.</p>
```
(Leave the date/time/food/qty/unit rows and `.modal-actions`.)

- [ ] **Step 2 (app.js):** Add a module var and rewrite `openFoodModal` to drop the macro fields and stash the original food/qty/unit:
```js
let _foodEditOriginal = null;

function openFoodModal(entry) {
  const modal = document.getElementById("food-modal");
  document.getElementById("food-modal-title").textContent = entry ? "Edit Food Entry" : "Add Food Entry";
  document.getElementById("food-id").value = entry ? entry.id : "";
  document.getElementById("food-date").value = entry ? entry.date : new Date().toISOString().slice(0, 10);
  document.getElementById("food-time").value = entry ? entry.time : new Date().toTimeString().slice(0, 5);
  document.getElementById("food-name").value = entry ? entry.food : "";
  document.getElementById("food-qty").value = entry ? entry.qty : "";
  document.getElementById("food-unit").value = entry ? entry.unit : "";
  populateFoodSuggestions();
  _foodEditOriginal = entry ? { food: entry.food, qty: entry.qty, unit: entry.unit } : null;
  modal.classList.remove("hidden");
}
```

- [ ] **Step 3 (app.js):** Replace `saveFood` — no macro inputs; add → macros pending; edit → re-estimate only when food/qty/unit changed:
```js
function saveFood(e) {
  e.preventDefault();
  const entries = loadFoodEntries();
  const id = document.getElementById("food-id").value;
  const base = {
    date: document.getElementById("food-date").value,
    time: document.getElementById("food-time").value,
    food: document.getElementById("food-name").value,
    qty: parseFloat(document.getElementById("food-qty").value),
    unit: document.getElementById("food-unit").value,
  };
  let saved;
  if (id) {
    const idx = entries.findIndex((x) => x.id === parseInt(id));
    if (idx === -1) { console.warn("saveFood: entry not found for id", id); return; }
    saved = { ...entries[idx], ...base };
    if (Macros.needsReestimate(_foodEditOriginal, base)) { saved.macros = {}; saved.estimateStatus = "pending"; }
    entries[idx] = saved;
  } else {
    const maxId = entries.length ? Math.max(...entries.map((x) => x.id)) : 0;
    saved = { ...base, id: maxId + 1, macros: {}, estimateStatus: "pending" };
    entries.push(saved);
  }
  saveFoodEntries(entries);
  ensureDayExists(base.date);
  closeFoodModal();
  renderFoodTable();
  renderCalorieTracker();
  if (saved && saved.estimateStatus === "pending") enqueueEstimate(saved.id);
}
```

- [ ] **Step 4 (app.js):** Delete the now-unused `renderFoodMacroFields` (664-686) and `readMacroInputs` (723-744) functions. Grep `www/app.js` for `renderFoodMacroFields` and `readMacroInputs` → only the definitions should remain → delete them; final grep returns 0.

- [ ] **Step 5: Verify.** `node --check www/app.js` exit 0; `npm test` 43 pass. (Single add/edit now has no macro fields; batch still works via its own modal.)

- [ ] **Step 6: Commit**
```bash
git add www/index.html www/app.js
git commit -m "feat(add): drop manual macro fields; re-estimate on food/qty/unit edit"
```

### Task 2.2: Unify + and Batch into one tabbed modal; trim the toolbar

**Files:** `www/index.html`, `www/app.js`, `www/styles.css`.

- [ ] **Step 1 (index.html):** Replace the entire `#food-modal` (190-226) with the unified tabbed modal:
```html
    <div id="food-modal" class="modal hidden">
      <div class="modal-overlay"></div>
      <div class="modal-content modal-wide">
        <h2 id="food-modal-title">Add Food Entry</h2>
        <div class="modal-tabs" id="food-modal-tabs">
          <button type="button" class="modal-tab active" data-pane="single">Single</button>
          <button type="button" class="modal-tab" data-pane="batch">Batch</button>
        </div>
        <form id="food-form" class="modal-pane" data-pane="single">
          <input type="hidden" id="food-id">
          <div class="form-row"><label for="food-date">Date</label><input type="date" id="food-date" required></div>
          <div class="form-row"><label for="food-time">Time</label><input type="time" id="food-time" required></div>
          <div class="form-row"><label for="food-name">Food</label><input type="text" id="food-name" required autocomplete="off" list="food-suggestions"><datalist id="food-suggestions"></datalist></div>
          <div class="form-row"><label for="food-qty">Quantity</label><input type="number" id="food-qty" step="any" required></div>
          <div class="form-row"><label for="food-unit">Unit of measure</label><input type="text" id="food-unit" required autocomplete="off" list="unit-suggestions"><datalist id="unit-suggestions"></datalist></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" id="food-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
        <div class="modal-pane hidden" data-pane="batch">
          <div class="form-row-pair">
            <div class="form-row"><label for="batch-date">Date</label><input type="date" id="batch-date" required></div>
            <div class="form-row"><label for="batch-time">Time</label><input type="time" id="batch-time" required></div>
          </div>
          <div id="batch-items"></div>
          <button type="button" id="batch-add-row" class="btn btn-secondary btn-sm">+ Add Row</button>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" id="batch-cancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="batch-save">Save All</button>
          </div>
        </div>
      </div>
    </div>
```

- [ ] **Step 2 (index.html):** DELETE the entire separate `#batch-modal` block (the `<!-- BATCH ADD MODAL -->` div, 263-285).

- [ ] **Step 3 (index.html):** Trim the toolbar (35-37) to a single desktop-only button — remove the Batch and Snap toolbar buttons:
```html
        <button id="add-food-btn" class="btn btn-primary desktop-only">+ Add Food</button>
```
(Leave the `.filter-group` after it.)

- [ ] **Step 4 (styles.css):** Append tab styles:
```css
.modal-tabs { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid var(--border); }
.modal-tab { background: none; border: none; color: var(--text-dim); padding: 8px 14px; cursor: pointer; font-size: .9rem; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.modal-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
```

- [ ] **Step 5 (app.js):** Add `showFoodPane` and extend `openFoodModal` to manage tabs (edit hides tabs + Single only; add shows tabs + inits the batch pane). Replace `openFoodModal` from Task 2.1 with:
```js
function showFoodPane(name) {
  document.querySelectorAll("#food-modal .modal-tab").forEach((t) => t.classList.toggle("active", t.dataset.pane === name));
  document.querySelectorAll("#food-modal .modal-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== name));
}

function openFoodModal(entry) {
  const modal = document.getElementById("food-modal");
  document.getElementById("food-modal-title").textContent = entry ? "Edit Food Entry" : "Add Food Entry";
  document.getElementById("food-id").value = entry ? entry.id : "";
  document.getElementById("food-date").value = entry ? entry.date : new Date().toISOString().slice(0, 10);
  document.getElementById("food-time").value = entry ? entry.time : new Date().toTimeString().slice(0, 5);
  document.getElementById("food-name").value = entry ? entry.food : "";
  document.getElementById("food-qty").value = entry ? entry.qty : "";
  document.getElementById("food-unit").value = entry ? entry.unit : "";
  populateFoodSuggestions();
  _foodEditOriginal = entry ? { food: entry.food, qty: entry.qty, unit: entry.unit } : null;
  const tabs = document.getElementById("food-modal-tabs");
  if (entry) {
    tabs.classList.add("hidden");
  } else {
    tabs.classList.remove("hidden");
    document.getElementById("batch-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("batch-time").value = new Date().toTimeString().slice(0, 5);
    document.getElementById("batch-items").innerHTML = "";
    for (let i = 0; i < 3; i++) addBatchRow();
    populateBatchSuggestions();
  }
  showFoodPane("single");
  modal.classList.remove("hidden");
}
```

- [ ] **Step 6 (app.js):** Delete `openBatchModal` (3133-3142) and `closeBatchModal` (3187-3189) — folded in / replaced. In `saveBatchFoods`, change `closeBatchModal();` to `closeFoodModal();`.

- [ ] **Step 7 (app.js):** Update the init listeners. Remove these lines:
```js
  document.getElementById("batch-add-btn").addEventListener("click", openBatchModal);
  document.getElementById("batch-cancel").addEventListener("click", closeBatchModal);
  document.querySelector("#batch-modal .modal-overlay").addEventListener("click", closeBatchModal);
  document.getElementById("photo-add-btn")?.addEventListener("click", startPhotoCapture);
```
And ADD (next to the food-modal listeners):
```js
  document.getElementById("batch-cancel").addEventListener("click", closeFoodModal);
  document.querySelectorAll("#food-modal-tabs .modal-tab").forEach((t) => t.addEventListener("click", () => showFoodPane(t.dataset.pane)));
```
Keep `batch-add-row` and `batch-save` listeners (their elements now live in the unified modal). Keep `photo-fab` → `startPhotoCapture`. Keep `add-food-btn`/`food-fab` → `openFoodModal(null)`.

- [ ] **Step 8: Verify.** `node --check www/app.js` exit 0; `npm test` 43 pass. Grep `www/app.js`/`www/index.html` for `batch-modal`, `openBatchModal`, `closeBatchModal`, `photo-add-btn`, `batch-add-btn`, `food-macro-fields`, `modal-hint` → 0 live references (the only `batch-cancel`/`batch-save`/`batch-add-row` refs are the unified-modal ones). Report grep.

- [ ] **Step 9: Commit**
```bash
git add www/index.html www/app.js www/styles.css
git commit -m "feat(add): unified Single/Batch tabbed modal; one desktop-only Add button"
```

---

## Phase 3 — Build + verification + finish

### Task 3.1: Emulator verification

- [ ] **Step 1:** `npx cap sync android`; `cd android; .\\gradlew.bat installDebug`; relaunch.

- [ ] **Step 2:** Verify (DevTools + visual):
  - Food modal (Add): NO macro fields, NO hint; **Single | Batch tabs** present; Single is the food form.
  - Add (Single): save a food → entry appears, macros estimate in the background.
  - Add (Batch): click Batch tab → batch rows; add rows; Save All → N pending entries estimate.
  - Edit (tap a card / edit): modal opens on Single with **tabs hidden**, title "Edit Food Entry"; changing **qty** then Save → macros re-estimate (status pending→done); changing only **time** → macros unchanged (no re-estimate; check `loadFoodEntries()` estimateStatus stays "done").
  - Mobile: toolbar has NO add buttons; + FAB opens the tabbed modal; camera FAB runs Snap.
  - Desktop (wide viewport / `matchMedia` false): "+ Add Food" toolbar button visible, FABs hidden, no Snap control.

- [ ] **Step 3:** Use `superpowers:verification-before-completion` to confirm each with evidence (DevTools + screenshots).

- [ ] **Step 4:** Finish with `superpowers:finishing-a-development-branch`.

---

## Self-Review (completed by plan author)

- **Spec coverage:** drop macro fields + hint → Task 2.1; re-estimate on food/qty/unit change → Task 1.1 + 2.1; unified Single/Batch tabs → Task 2.2; edit hides tabs → Task 2.2 (openFoodModal); toolbar → one desktop-only Add, remove Batch/Snap → Task 2.2; FABs unchanged (mobile-only) → unchanged; remove separate batch modal → Task 2.2; testing → Phase 1 + 3.1. All covered.
- **Type consistency:** `Macros.needsReestimate(orig, upd)` → boolean; `_foodEditOriginal` = `{food,qty,unit}|null`; `showFoodPane(name)` toggles `.modal-tab.active` + `.modal-pane.hidden`; panes carry `class="modal-pane" data-pane`; `saveBatchFoods` now calls `closeFoodModal`. Consistent.
- **Placeholders:** none — full code per step. Open decisions resolved (reuse `#food-modal`; dedicated `.modal-tabs`).
- **Hazard checks:** removing `#batch-add-btn`/`#photo-add-btn`/`#batch-modal` is paired with removing their listeners in the SAME task (2.2) → no init null-reference crash. `.desktop-only` already exists in CSS.
