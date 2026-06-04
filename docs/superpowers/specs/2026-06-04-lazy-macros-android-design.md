# Lazy Macros — Android App (Phase 1) Design

**Date:** 2026-06-04
**Status:** Approved (design); pending implementation plan
**Author:** Brainstormed with Claude

---

## 1. Summary

Convert the existing single-page web app ("Calorie & Activity Tracker") into a real,
installable **Android app** distributed through Google Play, and **simplify the diet
assessment for small phone screens**. The app will be branded **Lazy Macros**.

This document covers **Phase 1 only**. The product will eventually be sold as a
subscription, which requires several additional subsystems (accounts, a secure AI
backend, billing, and legal compliance) — those are deliberately deferred to later
phases, each with its own spec (see §9).

### Brand
- **App name:** Lazy Macros
- **Play Store subtitle / short description:** "Calorie & Macro Tracker" (keyword-rich)
- **Package ID:** `com.lazymacros.app` (permanent once published)
- **Positioning:** effortless macro tracking — the AI auto-estimation makes tracking
  "lazy." Wit + a clear keyword ("Macros") + an ownable, trademark-friendly hook ("Lazy").
- **Pre-launch verification (owner to do before public release):** confirm
  `lazymacros.com`/`.app` and @lazymacros social handles are free; run a formal
  USPTO + Philippines IPOPHL trademark search in the downloadable-software / nutrition
  app class.

---

## 2. Goals & Non-Goals

### Goals (Phase 1)
1. Package the existing web app into a native Android `.aab` via Capacitor — no rewrite.
2. Mobile-friendly, app-like layouts for **all four tabs**.
3. A **simplified diet assessment** view for mobile (scorecard + progressive disclosure).
4. An app-like navigation shell (bottom tab bar on mobile).
5. Keep the desktop web experience working from the same codebase.

### Non-Goals (deferred to later phases)
- User accounts / authentication / per-user data isolation.
- Server-side AI proxy (secure key handling, usage metering, cost control).
- Subscriptions / Google Play Billing / entitlement checks.
- Legal/compliance (privacy policy, in-app account deletion, Play "Data Safety" form).
- iOS build.
- Swipe-to-delete gestures (nice-to-have; use tap-to-edit + actions menu for now).

---

## 3. Existing System (context)

- Vanilla-JS single-page app: `index.html`, `app.js` (~4000 lines), `styles.css`.
- Four tabs: **Food Eaten**, **Calorie Tracker**, **Calorie Target**, **Diet Assessment**.
- Data layer: **Supabase** (primary) + **localStorage** (offline fallback), with an
  in-memory `_cache` for synchronous reads and write-through via `bgWrite()`.
- AI calorie/protein estimation and a **dual-AI diet assessment** (two providers, a
  Round 1 / Round 2 reconciliation flow) producing a large structured result, including
  a detailed action plan (grocery add/keep, stop-and-replace, sourcing guide, meal ideas).
- AI API keys (`nt_key_openai`, `nt_key_anthropic`) stored in localStorage only.
- No authentication; single shared Supabase dataset with an "allow all" RLS policy.

---

## 4. Architecture & Approach

- **Capacitor** wraps the existing web assets in a native Android shell and produces a
  signed `.aab`. All current logic and the Supabase data layer carry over unchanged.
- **One responsive codebase.** The same files serve both desktop (existing table layout)
  and mobile (new card layouts). Layout is switched via CSS breakpoints plus `matchMedia`
  where JS needs to render differently. The desktop experience is preserved as-is.
- **Bundle the Supabase JS library locally** (vendored file) instead of the CDN
  `<script>` tag, so the app shell loads reliably even offline. Data sync still requires
  network (unchanged behavior).
- **Project restructure:** move `index.html`, `app.js`, `styles.css` (plus the vendored
  Supabase JS) into a **`www/`** folder. `www/` becomes both the served web app and
  Capacitor's `webDir`. The separate `finance/` app and any in-progress changes there
  are untouched.

### Responsive strategy
- Breakpoint at roughly `max-width: 720px` defines "mobile."
- Data-heavy tabs (Food Eaten, Calorie Tracker) get a **dedicated mobile card renderer**
  selected via `matchMedia`, sharing the same data layer as the desktop table renderer.
- Form/settings tabs reflow via CSS (single column, large tap targets).

---

## 5. App Shell & Navigation

- **Mobile:** fixed **bottom tab bar** with four items — **Food · Days · Targets · Assess**
  (icon + label), thumb-reachable.
- **Desktop:** the current top tab row remains.
- Full-screen native feel (no browser chrome), themed status bar, app icon, splash screen.

---

## 6. Mobile Layouts (per tab)

### 6.1 Food Eaten → cards
- Vertical list of **cards**: food name + calorie range on top; time, quantity, and
  protein range below.
- Floating **＋ Add Food** action button.
- **Tap a card to edit** (reuses the existing food modal); **delete via an actions menu**
  (long-press or an overflow control). No new edit UI is built.
- **Batch Add** remains available (existing modal).

### 6.2 Calorie Tracker (19 columns) → daily summary cards
- One **summary card per day**: date, calorie target vs eaten, protein summary.
- **Tap-to-expand** reveals the full per-day breakdown (BMR, TDEE, deficit, all
  calorie/protein +/- fields).
- Add/edit reuse the existing day modal.

### 6.3 Calorie Target → single-column settings
- Activity-multiplier and goals tables, plus the profile form, reflow into a single
  column with large tap targets.
- Provider settings and validation settings collapse into **accordions**.

### 6.4 Diet Assessment → simplified scorecard (see §7)

---

## 7. Simplified Diet Assessment (Option A: Scorecard + drill-down)

**Principle:** the same rich dual-AI analysis runs underneath, **unchanged**. Only the
mobile *presentation* is simplified.

Mobile layout, top to bottom:
1. **Overall score ring** + a one-line plain-language verdict.
2. Three **status chips**: **Calories** (deficit/on-target/surplus), **Protein**
   (deficient→excellent), **Variety** (derived from food-group statuses).
3. **"Do this week"** — the top 3 actions, drawn from the existing `suggestions` and
   `stop_and_replace` data.
4. **Collapsible sections** (tap to expand), all populated from existing assessment data:
   - **Food groups** (the six groups with status/servings).
   - **Full grocery & sourcing plan** (action plan: grocery add/keep, stop-and-replace,
     sourcing guide, meal ideas).
   - **Why this score** (the model's `reasoning`).

**Hide the dual-AI machinery from the user.** No "Round 1 / Round 2," provider names, or
"providers agreed" counts in the mobile view. Optionally expose them behind a small,
low-emphasis "Details" link for power users.

Desktop retains the current detailed assessment view.

---

## 8. AI Keys During Phase 1

- The current model — AI keys stored in localStorage and entered in Settings — is
  **retained for Phase 1**. This is acceptable for the owner and for closed testers, who
  each enter their own key.
- A **server-side key proxy is Phase 2** and is required before any public or paid
  release. **The owner's API key must never be shipped inside the app binary** (it would
  be extracted and abused).

---

## 9. Out of Scope — Later Phases (for context)

Each becomes its own spec → plan → implementation cycle:

- **Phase 2 — Accounts + Secure AI backend:** Supabase Auth, per-user data isolation
  (RLS by `user_id`), and a server proxy (e.g., Supabase Edge Function) that holds the
  AI key server-side, authenticates the user, and meters usage.
- **Phase 3 — Billing + Compliance:** Google Play Billing subscriptions + entitlement
  checks; privacy policy, in-app account deletion, Play "Data Safety" form, store listing,
  and launch.

---

## 10. Testing & Build

- Verify responsive layouts in a desktop browser at phone width.
- Run in the **Android emulator** and on a **physical phone** via `npx cap run android`.
- Confirm inside the Capacitor shell: Supabase read/write, AI estimation, and the full
  diet assessment flow.
- Produce a **signed `.aab`** and document the rebuild steps (for later Play Console
  internal testing in Phase 3).

### Prerequisites (owner machine)
- Node.js
- Android Studio + Android SDK
- A JDK

---

## 11. Key Decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Distribution goal | Publish to Google Play (eventually a paid subscription product) |
| This spec's scope | **Phase 1 only**: mobile UX + Capacitor packaging |
| Packaging tech | **Capacitor** (wrap existing web app; no rewrite) |
| Codebase | Single **responsive** codebase (mobile + desktop) |
| Mobile scope | **All four tabs** mobilized |
| Navigation | **Bottom tab bar** (mobile); top tabs (desktop) |
| Assessment | **Option A** — scorecard + drill-down; simplify *display* only, keep rich analysis |
| AI machinery | Hidden from user (invisible plumbing) |
| Brand name | **Lazy Macros** / `com.lazymacros.app` / subtitle "Calorie & Macro Tracker" |
| Project layout | Web assets move into `www/` (Capacitor `webDir`) |
| Edit/delete | Tap-to-edit + actions menu (swipe-to-delete deferred) |
| AI keys (Phase 1) | Keep localStorage/BYOK model; secure proxy is Phase 2 |
