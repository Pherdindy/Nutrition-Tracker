# Snap-to-Log: Photo Food Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users photograph a meal; a vision AI returns an itemized list (food, portion, macros) they confirm or correct, then each item is saved as a food entry. The image is never stored.

**Architecture:** A new pure UMD module `www/photo.js` (`window.PhotoEstimate`) owns the vision prompt builders, response parsing, and item→entry mapping (Node-testable, depends on `Macros`). `www/app.js` adds camera capture (`@capacitor/camera` via `Capacitor.Plugins.Camera`), provider `callVision` methods, an `estimatePhoto` orchestrator, the confirm/correct modal, and a `vision_provider` setting. Reuses the existing `{low,high}` macro model and `saveFoodEntries` (hardened) pipeline.

**Tech Stack:** Vanilla JS (no bundler — plugins via `Capacitor.Plugins`), UMD modules, Node built-in test runner, `@capacitor/camera`, OpenAI/Anthropic vision APIs.

**Reference spec:** `docs/superpowers/specs/2026-06-04-snap-to-log-photo-capture-design.md`

**Conventions:** Commit after each task. Already on branch `feat/photo-capture`. `npm test` for units. Emulator checks via the WebView DevTools recipe in project memory. Macro values are always `{low,high}`.

---

## Phase 1 — `www/photo.js` pure module (TDD)

**Files:** Create `www/photo.js`, `tests/photo.test.js`.

`www/photo.js` UMD resolves `Macros` (Node `require` or browser global):
```js
(function (root, factory) {
  const Macros = (typeof require === "function") ? require("./macros.js") : root.Macros;
  const api = factory(Macros);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PhotoEstimate = api;
})(typeof self !== "undefined" ? self : this, function (Macros) {
  // functions added per task below
  return { /* exports per task */ };
});
```

### Task 1.1: Prompt builders

- [ ] **Step 1: Write the failing test** — `tests/photo.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const P = require("../www/photo.js");

test("buildVisionSystemPrompt requests an items array with food, portion, and enabled macro fields", () => {
  const s = P.buildVisionSystemPrompt(["calories", "protein"]);
  assert.match(s, /"items"/);
  assert.match(s, /"food"/);
  assert.match(s, /"portion"/);
  assert.match(s, /"calories_lower"/);
  assert.match(s, /"protein_upper"/);
});

test("buildVisionUserText includes prior items and correction when present", () => {
  const base = P.buildVisionUserText(null);
  assert.match(base, /identify/i);
  const withCorr = P.buildVisionUserText({ priorItems: [{ food: "Bean soup" }], correction: "It's a sloppy joe" });
  assert.match(withCorr, /Bean soup/);
  assert.match(withCorr, /sloppy joe/);
});
```

- [ ] **Step 2: Run to verify fail.** `npm test` → FAIL (module not found).

- [ ] **Step 3: Implement** (inside factory; add to exports)

```js
  function buildVisionSystemPrompt(macroIds) {
    return `You are a precise nutrition assistant analyzing a photo of food. Identify each distinct food item visible. Estimate each item's portion from visual cues (plate size, utensils, packaging) and its nutrition. Be consistent and evidence-based.

Respond with ONLY a JSON object (no markdown fences) in this exact format:
{
  "reasoning": "<brief reasoning; not shown to the user>",
  "items": [
    {
      "food": "<short food name>",
      "portion": "<human-readable portion, e.g. '1 sandwich' or '~150 g'>",
${Macros.promptFields(macroIds)}
    }
  ]
}
Units: calories in kcal, sodium in mg, all other macros in grams. Give one object per distinct food.`;
  }

  function buildVisionUserText(history) {
    let t = "Identify each distinct food in this photo. For each, return a short name, an estimated portion, and the nutrition estimates. Return ONLY the JSON object.";
    if (history && Array.isArray(history.priorItems) && history.priorItems.length) {
      t += "\n\nYour previous reading was:\n" + JSON.stringify(history.priorItems.map((i) => ({ food: i.food, portion: i.portion })));
    }
    if (history && history.correction) {
      t += "\n\nThe user provided this correction — re-estimate the whole photo accordingly:\n" + history.correction;
    }
    return t;
  }
```
Exports: `buildVisionSystemPrompt, buildVisionUserText`.

- [ ] **Step 4: Run to verify pass.** `npm test` → PASS (existing macros/assessment tests still pass).

- [ ] **Step 5: Commit**

```bash
git add www/photo.js tests/photo.test.js
git commit -m "feat(photo): vision prompt builders"
```

### Task 1.2: parseVisionResponse

- [ ] **Step 1: Write the failing test** (append)

```js
test("parseVisionResponse extracts items with food, portion, macros; tolerant of fences/missing", () => {
  const json = '```json\\n{"items":[{"food":"Sloppy joe","portion":"1 sandwich","calories_lower":480,"calories_upper":560,"protein_lower":26,"protein_upper":30},{"food":"Fries","portion":"1 cup","calories_lower":340,"calories_upper":390}]}\\n```';
  const out = P.parseVisionResponse(json, ["calories", "protein"]);
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].food, "Sloppy joe");
  assert.equal(out.items[0].portion, "1 sandwich");
  assert.deepEqual(out.items[0].macros.calories, { low: 480, high: 560 });
  assert.deepEqual(out.items[0].macros.protein, { low: 26, high: 30 });
  // fries had no protein -> absent, not crashing
  assert.equal(out.items[1].macros.protein, undefined);
});

test("parseVisionResponse returns empty items on bad shape; throws on non-JSON", () => {
  assert.deepEqual(P.parseVisionResponse('{"foo":1}', ["calories"]).items, []);
  assert.throws(() => P.parseVisionResponse("not json", ["calories"]));
});
```

- [ ] **Step 2: Run to verify fail.** `npm test` → FAIL.

- [ ] **Step 3: Implement** (add to exports)

```js
  function parseVisionResponse(jsonText, macroIds) {
    const cleaned = String(jsonText).trim().replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) { throw new Error("Could not parse photo result"); }
    const raw = Array.isArray(parsed.items) ? parsed.items : [];
    const items = raw.map((it) => ({
      food: String(it.food || "").trim() || "Unknown item",
      portion: String(it.portion || "").trim() || "1 serving",
      macros: Macros.parseMacros(it, macroIds),
    }));
    return { items };
  }
```
Exports add: `parseVisionResponse`.

- [ ] **Step 4: Run to verify pass.** `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add www/photo.js tests/photo.test.js
git commit -m "feat(photo): parse vision item-list response"
```

### Task 1.3: itemsToEntries

- [ ] **Step 1: Write the failing test** (append)

```js
test("itemsToEntries builds entries with unique ids, qty 1, portion as unit, done status", () => {
  const items = [
    { food: "Sloppy joe", portion: "1 sandwich", macros: { calories: { low: 480, high: 560 } } },
    { food: "Fries", portion: "1 cup", macros: { calories: { low: 340, high: 390 } } },
  ];
  const out = P.itemsToEntries(items, "2026-06-04", "12:30", 10);
  assert.equal(out.length, 2);
  assert.deepEqual({ id: out[0].id, qty: out[0].qty, unit: out[0].unit, food: out[0].food, status: out[0].estimateStatus, date: out[0].date, time: out[0].time },
    { id: 10, qty: 1, unit: "1 sandwich", food: "Sloppy joe", status: "done", date: "2026-06-04", time: "12:30" });
  assert.equal(out[1].id, 11);
  assert.deepEqual(out[0].macros.calories, { low: 480, high: 560 });
});
```

- [ ] **Step 2: Run to verify fail.** `npm test` → FAIL.

- [ ] **Step 3: Implement** (add to exports)

```js
  function itemsToEntries(items, date, time, idStart) {
    return (items || []).map((it, i) => ({
      id: idStart + i,
      date, time,
      food: it.food,
      qty: 1,
      unit: it.portion,
      macros: it.macros || {},
      estimateStatus: "done",
    }));
  }
```
Exports add: `itemsToEntries`.

- [ ] **Step 4: Run to verify pass.** `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add www/photo.js tests/photo.test.js
git commit -m "feat(photo): map confirmed items to food entries"
```

---

## Phase 2 — Camera plugin + vision provider calls + estimate orchestrator

**Files:** `package.json` (dep), `android/` (sync), `www/index.html` (script tag), `www/app.js`.

### Task 2.1: Install @capacitor/camera and sync

- [ ] **Step 1:** Install the plugin (Capacitor 8):

```bash
npm install @capacitor/camera@^8
```

- [ ] **Step 2:** Sync to Android:

```bash
npx cap sync android
```

- [ ] **Step 3:** Add camera/photo permissions to `android/app/src/main/AndroidManifest.xml` inside `<manifest>` (above `<application>`), if not already contributed by the plugin:

```xml
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
```

- [ ] **Step 4: Verify.** `npx cap sync android` runs clean and lists `@capacitor/camera` among plugins. Report the plugin list line.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json android/
git commit -m "build: add @capacitor/camera plugin + camera permission"
```

### Task 2.2: Load photo.js + vision provider resolution + setting

- [ ] **Step 1:** In `www/index.html`, add `<script src="photo.js"></script>` immediately AFTER the `macros.js` script tag and before `app.js` (PhotoEstimate depends on Macros being defined first).

- [ ] **Step 2:** In `www/app.js`, add near the other settings accessors:

```js
function getVisionProvider() {
  const pref = getSetting("vision_provider", "");
  const withKeys = PROVIDERS.filter((p) => getProviderSettings(p.id).apiKey.length > 0);
  return withKeys.find((p) => p.id === pref) || withKeys[0] || null;
}
function setVisionProvider(id) { setSetting("vision_provider", id); }
```

- [ ] **Step 3:** Add a vision-provider select to `renderMacroSettings` (after the estimation-mode select, before the closing `</div>`):

```js
  const visionId = (getVisionProvider() || {}).id || "";
  html += `<div class="form-row"><label>Photo (vision) provider</label><select id="set-vision-provider">`;
  html += PROVIDERS.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === visionId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
  html += `</select></div>`;
```
And in the same function's listener-wiring section:
```js
  const vp = c.querySelector("#set-vision-provider");
  if (vp) vp.addEventListener("change", (e) => setVisionProvider(e.target.value));
```

- [ ] **Step 4: Verify.** `node --check www/app.js` exit 0; `npm test` 27→ (still all pass; no new unit tests here). On emulator/browser, the Targets settings show a "Photo (vision) provider" select.

- [ ] **Step 5: Commit**

```bash
git add www/index.html www/app.js
git commit -m "feat(photo): load module, vision-provider setting + selector"
```

### Task 2.3: Provider callVision methods + estimatePhoto + capturePhoto

- [ ] **Step 1:** Add a `callVision` method to BOTH providers in the `PROVIDERS` array. OpenAI (inside the openai object):

```js
    callVision: async (apiKey, model, b64, mime, systemPrompt, userText) => {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
            ] },
          ],
          ...openaiModelParams(model, 1500),
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `OpenAI API error ${res.status}`); }
      return extractOpenAIContent(await res.json());
    },
```
Anthropic (inside the anthropic object):
```js
    callVision: async (apiKey, model, b64, mime, systemPrompt, userText) => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model, max_tokens: 1500,
          messages: [ { role: "user", content: [
            { type: "text", text: userText },
            { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
          ] } ],
          system: systemPrompt, temperature: 0,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `Claude API error ${res.status}`); }
      return (await res.json()).content[0].text;
    },
```

- [ ] **Step 2:** Add the orchestrator + capture helpers (near `estimateEntry`):

```js
async function estimatePhoto(image, history) {
  const provider = getVisionProvider();
  if (!provider) throw new Error("no-api-key");
  const ids = getEnabledMacros();
  const settings = getProviderSettings(provider.id);
  const text = await provider.callVision(
    settings.apiKey, settings.primaryModel,
    image.base64, image.mimeType,
    PhotoEstimate.buildVisionSystemPrompt(ids),
    PhotoEstimate.buildVisionUserText(history),
  );
  return PhotoEstimate.parseVisionResponse(text, ids);
}

async function capturePhoto() {
  if (!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Camera)) {
    alert("Camera is only available in the installed app.");
    return null;
  }
  try {
    const photo = await Capacitor.Plugins.Camera.getPhoto({
      quality: 70, resultType: "base64", source: "PROMPT", width: 1024, correctOrientation: true,
    });
    if (!photo || !photo.base64String) return null;
    return { base64: photo.base64String, mimeType: `image/${photo.format || "jpeg"}` };
  } catch (e) {
    return null; // user cancelled or denied permission — no-op
  }
}
```

- [ ] **Step 3: Verify.** `node --check www/app.js` exit 0; `npm test` all pass. (Live vision verified in Phase 4.)

- [ ] **Step 4: Commit**

```bash
git add www/app.js
git commit -m "feat(photo): provider vision calls, estimatePhoto, capturePhoto"
```

---

## Phase 3 — Confirm/correct modal + Snap trigger

**Files:** `www/index.html` (modal + trigger), `www/app.js` (render/handlers/wiring), `www/styles.css`.

### Task 3.1: Photo modal markup + Snap trigger

- [ ] **Step 1:** In `www/index.html`, add the Snap trigger in the Food tab toolbar next to the existing Add/Batch buttons (desktop) — find the `#add-food-btn`/`#batch-add-btn` group and add:

```html
        <button id="photo-add-btn" class="btn btn-secondary">📷 Snap</button>
```
And a mobile camera button near the FAB (find `#food-fab` and add a sibling):
```html
      <button id="photo-fab" class="fab fab-secondary" aria-label="Snap a photo">📷</button>
```

- [ ] **Step 2:** Add the modal markup before `</body>` (near the other modals):

```html
    <div id="photo-modal" class="modal hidden">
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <h2>Snap to Log</h2>
        <p id="photo-status" class="estimate-status"></p>
        <div id="photo-items"></div>
        <div id="photo-correct" class="hidden">
          <label for="photo-correct-text">Correction</label>
          <input type="text" id="photo-correct-text" placeholder="e.g. That's not bean soup — it's a sloppy joe with fries" autocomplete="off">
          <button type="button" id="photo-correct-submit" class="btn btn-primary btn-sm">Re-estimate</button>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="photo-cancel">Cancel</button>
          <button type="button" class="btn btn-secondary" id="photo-correct-toggle">Correct</button>
          <button type="button" class="btn btn-primary" id="photo-confirm">Confirm all</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 3: Verify.** `node --check www/app.js` (unaffected); page loads with the new button(s) present. Commit:

```bash
git add www/index.html
git commit -m "feat(photo): Snap trigger + confirm/correct modal markup"
```

### Task 3.2: Modal render + handlers + wiring

- [ ] **Step 1:** Add the photo-flow state + functions to `www/app.js`:

```js
let _photoImage = null, _photoHistory = null, _photoItems = [];

function setPhotoStatus(msg, isErr) {
  const el = document.getElementById("photo-status");
  if (el) { el.textContent = msg || ""; el.classList.toggle("error", !!isErr); }
}
function openPhotoModal() {
  _photoItems = [];
  document.getElementById("photo-items").innerHTML = "";
  document.getElementById("photo-correct").classList.add("hidden");
  document.getElementById("photo-correct-text").value = "";
  document.getElementById("photo-confirm").disabled = true;
  setPhotoStatus("");
  document.getElementById("photo-modal").classList.remove("hidden");
}
function closePhotoModal() {
  _photoImage = null; _photoHistory = null; _photoItems = [];
  document.getElementById("photo-modal").classList.add("hidden");
}
function renderPhotoItems() {
  const fmt = getValueFormat();
  const host = document.getElementById("photo-items");
  if (!_photoItems.length) { host.innerHTML = `<p class="cards-empty">No foods detected. Add a correction or cancel.</p>`; document.getElementById("photo-confirm").disabled = true; return; }
  host.innerHTML = _photoItems.map((it, i) => `
    <div class="photo-item" data-idx="${i}">
      <input class="photo-item-food" data-idx="${i}" value="${escapeHtml(it.food)}">
      <input class="photo-item-portion" data-idx="${i}" value="${escapeHtml(it.portion)}">
      <div class="photo-item-macros">${getEnabledMacros().map((id) => `${escapeHtml(Macros.byId(id).label)} ${Macros.formatMacro(Macros.getMacro(it, id), fmt)}`).join(" · ")}</div>
    </div>`).join("");
  document.getElementById("photo-confirm").disabled = false;
  host.querySelectorAll(".photo-item-food").forEach((el) => el.addEventListener("input", (e) => { _photoItems[+e.target.dataset.idx].food = e.target.value; }));
  host.querySelectorAll(".photo-item-portion").forEach((el) => el.addEventListener("input", (e) => { _photoItems[+e.target.dataset.idx].portion = e.target.value; }));
}
async function runPhotoEstimate() {
  setPhotoStatus("Reading photo…");
  document.getElementById("photo-confirm").disabled = true;
  try {
    const { items } = await estimatePhoto(_photoImage, _photoHistory);
    _photoItems = items;
    setPhotoStatus(items.length ? "" : "No foods detected.");
    renderPhotoItems();
  } catch (e) {
    setPhotoStatus(e.message === "no-api-key" ? "No vision provider key — add one in Targets." : "Couldn't read that photo — try again or add manually.", true);
  }
}
async function startPhotoCapture() {
  if (!getVisionProvider()) { alert("Add an AI provider API key in Targets to use photo capture."); return; }
  const image = await capturePhoto();
  if (!image) return;
  _photoImage = image; _photoHistory = null;
  openPhotoModal();
  await runPhotoEstimate();
}
function confirmPhotoItems() {
  // sync any edited names/portions already live in _photoItems
  const entries = loadFoodEntries();
  const maxId = entries.length ? Math.max(...entries.map((e) => e.id)) : 0;
  const now = new Date();
  const date = now.toISOString().slice(0, 10), time = now.toTimeString().slice(0, 5);
  const created = PhotoEstimate.itemsToEntries(_photoItems, date, time, maxId + 1);
  if (!created.length) return;
  saveFoodEntries([...entries, ...created]);
  ensureDayExists(date);
  closePhotoModal();
  renderFoodTable(); renderCalorieTracker();
}
```

- [ ] **Step 2:** Wire listeners in the init section (where other modal listeners are registered):

```js
  document.getElementById("photo-add-btn")?.addEventListener("click", startPhotoCapture);
  document.getElementById("photo-fab")?.addEventListener("click", startPhotoCapture);
  document.getElementById("photo-cancel").addEventListener("click", closePhotoModal);
  document.querySelector("#photo-modal .modal-overlay").addEventListener("click", closePhotoModal);
  document.getElementById("photo-confirm").addEventListener("click", confirmPhotoItems);
  document.getElementById("photo-correct-toggle").addEventListener("click", () => document.getElementById("photo-correct").classList.toggle("hidden"));
  document.getElementById("photo-correct-submit").addEventListener("click", () => {
    const t = document.getElementById("photo-correct-text").value.trim();
    if (!t) return;
    _photoHistory = { priorItems: _photoItems, correction: t };
    document.getElementById("photo-correct-text").value = "";
    document.getElementById("photo-correct").classList.add("hidden");
    runPhotoEstimate();
  });
```

- [ ] **Step 3:** Add styles to `www/styles.css`:

```css
.photo-item { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.08); }
.photo-item-food { font-weight: 600; width: 100%; margin-bottom: 4px; }
.photo-item-portion { width: 100%; font-size: .85rem; color: var(--text-dim); margin-bottom: 4px; }
.photo-item-macros { font-size: .8rem; color: var(--text-dim); }
.fab-secondary { right: 80px; }
```

- [ ] **Step 4: Verify.** `node --check www/app.js` exit 0; `npm test` all pass. Behavioral check in Phase 4.

- [ ] **Step 5: Commit**

```bash
git add www/app.js www/styles.css
git commit -m "feat(photo): confirm/correct modal logic and wiring"
```

---

## Phase 4 — Build, sync, and behavioral verification

**Files:** none (verification).

### Task 4.1: Build + emulator verification

- [ ] **Step 1:** `npx cap sync android`; `cd android; .\\gradlew.bat installDebug`; relaunch.

- [ ] **Step 2:** Verify (DevTools + UI; a vision-provider key must be set on the device):
  - The **📷 Snap** button/FAB is present in the Food tab.
  - Tapping it opens the camera/gallery prompt (grant permission once).
  - After choosing an image, the modal shows "Reading photo…" then an item list with food/portion/macros.
  - **Correct** with a free-text note re-estimates and replaces the list.
  - Editing a food/portion inline updates the item.
  - **Confirm all** creates one entry per item (status `done`, macros populated); verify in the table/cards; then delete the test entries.
  - **No-key path:** with `vision_provider` pointing at a keyless provider, Snap shows the friendly prompt.
  - **Cancel** at the OS picker is a no-op.
  - For a non-interactive check, drive `estimatePhoto({base64:<fixture>, mimeType:"image/jpeg"}, null)` over DevTools with a small base64 food image and confirm a parsed item list.

- [ ] **Step 3:** Use `superpowers:verification-before-completion` to confirm each claim with evidence before declaring done.

- [ ] **Step 4:** Finish with `superpowers:finishing-a-development-branch`.

---

## Self-Review (completed by plan author)

- **Spec coverage:** capture (camera+gallery) → Task 2.1/2.3; vision single-call + provider methods → Task 2.3; itemized parse → Task 1.2; confirm/correct loop → Task 3.2; save as entries (done status) → Task 1.3 + 3.2; settings vision provider → Task 2.2; image discarded (only in `_photoImage`, cleared on close) → Task 3.2; errors/no-key/cancel → Task 2.3/3.2; testing → Phase 1 + Task 4.1. Open Decisions resolved: reuse primary model (Task 2.3 uses `settings.primaryModel`); camera button by FAB (Task 3.1). All covered.
- **Type consistency:** `estimatePhoto(image, history)` where `image={base64,mimeType}`; `history={priorItems,correction}`; provider `callVision(apiKey, model, b64, mime, systemPrompt, userText)`; `PhotoEstimate.{buildVisionSystemPrompt,buildVisionUserText,parseVisionResponse,itemsToEntries}` names consistent across phases; items shape `{food, portion, macros:{id:{low,high}}}` consistent in parse → render → itemsToEntries.
- **Placeholders:** none — code shown for every code step.
- **Privacy:** `_photoImage` is the only image reference; cleared in `closePhotoModal`; never passed to `saveFoodEntries`.
