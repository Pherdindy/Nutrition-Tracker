# Accounts & Per-User Data (Spec A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require Supabase Auth sign-in (Google OAuth via deep link + email OTP), give every table a `user_id` with per-user RLS, migrate the owner's existing data to his account, onboard new users with a profile setup instead of seed data, and namespace the offline cache per user.

**Architecture:** The vendored `supabase-js` v2 already includes Auth (PKCE flow for the Android deep-link return). A new pure UMD module `www/auth-view.js` holds testable logic (view routing, input validation, error mapping, cache-key namespacing); `www/app.js` gains an auth gate around the existing `DOMContentLoaded` startup (extracted into `startApp()`), sign-in/out handlers, and an onboarding overlay. Database changes ship as two SQL scripts run manually in the Supabase SQL editor (house pattern), staged so the live app keeps working between them: script 1 adds nullable `user_id` columns while RLS stays "Allow all"; script 2 (after the owner's first sign-in) backfills, adds defaults/constraints/composite PKs, and swaps in per-user RLS.

**Tech Stack:** Vanilla JS (UMD browser globals, no bundler), `supabase-js` v2 (vendored), Capacitor 8 (`@capacitor/app` + `@capacitor/browser` added), `node --test`, plain CSS with theme vars.

**Spec:** `docs/superpowers/specs/2026-07-07-accounts-per-user-data-design.md`

---

## File map

- Create: `www/auth-view.js` — pure logic: `route`, `validEmail`, `validOtp`, `authErrorMessage`, `nsKey` (UMD `window.AuthView`).
- Create: `tests/auth-view.test.js` — unit tests for all five functions.
- Create: `docs/sql/2026-07-07-accounts-01-add-user-id.sql` — nullable `user_id` columns (run BEFORE code deploy).
- Create: `docs/sql/2026-07-07-accounts-02-finalize.sql` — backfill + defaults + PKs + per-user RLS (run AFTER owner's first sign-in).
- Modify: `www/index.html` — auth view + onboarding overlay markup; two new script tags.
- Modify: `www/styles.css` — `.auth-view`/`.onboarding-view` styles (theme vars only).
- Modify: `www/app.js` — sb client PKCE options; auth gate + `startApp()` extraction; Google/OTP/deep-link handlers; namespaced cache wrappers; onboarding logic; Account card + sign-out; seed/migration removal; per-user profile upsert.
- Modify: `package.json` — add `@capacitor/app`, `@capacitor/browser`.
- Modify: `android/app/src/main/AndroidManifest.xml` — deep-link intent filter.

**Key architectural facts for every task:** scripts are browser globals loaded in order (`vendor/supabase.min.js` → `macros.js` → `photo.js` → `targets.js` → `theme.js` → `auth-view.js` → `app.js` → `assessment-view.js` → `mobile-render.js`). The Supabase client is `sb` (never `supabase`). Data reads are synchronous from `_cache`; writes go cache → localStorage → fire-and-forget `bgWrite()`. Theme (`nt_theme`) and API keys (`nt_key_*`) stay device-global and are NOT namespaced (theme is read by a pre-auth inline head script; keys die in spec B). Only the five data keys are namespaced: `food`, `days`, `profile`, `assessments`, `version`.

---

### Task 0: USER ACTION — Supabase dashboard + Google Cloud setup

**Files:** none. **This is a human checkpoint; the executor pauses and asks the user to do it (can run in parallel with Tasks 1-4; blocks Task 5 verification).**

- [ ] **Step 1: Supabase Auth URL configuration.** In the Supabase dashboard → Authentication → URL Configuration: set Site URL to `http://localhost:8080`, and add `com.lazymacros.app://auth-callback` AND `http://localhost:8080` to "Redirect URLs".
- [ ] **Step 2: Email OTP.** Authentication → Providers → Email: keep enabled. Authentication → Email Templates → "Magic Link": ensure the body contains the 6-digit code token `{{ .Token }}` (e.g. `<p>Your Lazy Macros sign-in code: {{ .Token }}</p>`). Without `{{ .Token }}` users get a useless magic link instead of a code.
- [ ] **Step 3: Google provider.** In Google Cloud Console create an OAuth 2.0 **Web application** client (APIs & Services → Credentials): authorized redirect URI `https://wcbpvvyhswaricoadqbb.supabase.co/auth/v1/callback`. Copy client ID + secret into Supabase → Authentication → Providers → Google (enable it). No Android/SHA-1 client is needed — the flow is browser-based (Google → Supabase callback → deep link), not native One Tap.
- [ ] **Step 4:** Confirm to the executor that all three are done.

---

### Task 1: USER ACTION — run SQL migration 1 (nullable user_id columns)

**Files:**
- Create: `docs/sql/2026-07-07-accounts-01-add-user-id.sql`

- [ ] **Step 1: Write the SQL file** with exactly this content:

```sql
-- Accounts migration 1/2: add nullable user_id columns.
-- Safe to run while the current (pre-auth) app is live: RLS stays "Allow all",
-- columns are nullable, nothing else changes. Run in the Supabase SQL editor.

alter table food_entries add column if not exists user_id uuid references auth.users(id);
alter table days         add column if not exists user_id uuid references auth.users(id);
alter table profile      add column if not exists user_id uuid references auth.users(id);
alter table assessments  add column if not exists user_id uuid references auth.users(id);
alter table settings     add column if not exists user_id uuid references auth.users(id);
```

- [ ] **Step 2: Commit**

```bash
git add docs/sql/2026-07-07-accounts-01-add-user-id.sql
git commit -m "docs(sql): accounts migration 1 - nullable user_id columns"
```

- [ ] **Step 3: USER runs the script** in the Supabase SQL editor and confirms "Success. No rows returned". The executor pauses until confirmed.

---

### Task 2: `www/auth-view.js` pure module (TDD)

**Files:**
- Create: `www/auth-view.js`
- Test: `tests/auth-view.test.js`

- [ ] **Step 1: Write the failing tests.** Create `tests/auth-view.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const AV = require("../www/auth-view.js");

test("route: no session -> signin; session without profile -> onboarding; both -> app", () => {
  assert.equal(AV.route({ hasSession: false, profileMissing: false }), "signin");
  assert.equal(AV.route({ hasSession: false, profileMissing: true }), "signin");
  assert.equal(AV.route({ hasSession: true, profileMissing: true }), "onboarding");
  assert.equal(AV.route({ hasSession: true, profileMissing: false }), "app");
});

test("validEmail accepts normal addresses, rejects junk", () => {
  assert.equal(AV.validEmail("a@b.co"), true);
  assert.equal(AV.validEmail("robert+test@gmail.com"), true);
  assert.equal(AV.validEmail("no-at-sign"), false);
  assert.equal(AV.validEmail("spaces in@it.com"), false);
  assert.equal(AV.validEmail(""), false);
  assert.equal(AV.validEmail(null), false);
});

test("validOtp requires exactly 6 digits", () => {
  assert.equal(AV.validOtp("123456"), true);
  assert.equal(AV.validOtp(" 123456 "), true); // tolerates whitespace padding
  assert.equal(AV.validOtp("12345"), false);
  assert.equal(AV.validOtp("1234567"), false);
  assert.equal(AV.validOtp("12345a"), false);
  assert.equal(AV.validOtp(""), false);
  assert.equal(AV.validOtp(null), false);
});

test("authErrorMessage maps known Supabase auth errors to friendly text", () => {
  assert.equal(AV.authErrorMessage({ message: "Token has expired or is invalid" }),
    "That code is wrong or expired — request a new one.");
  assert.equal(AV.authErrorMessage({ message: "otp_expired" }),
    "That code is wrong or expired — request a new one.");
  assert.equal(AV.authErrorMessage({ message: "Failed to fetch" }),
    "Can't reach the server — check your connection and try again.");
  assert.equal(AV.authErrorMessage({ message: "NetworkError when attempting to fetch resource." }),
    "Can't reach the server — check your connection and try again.");
  assert.equal(AV.authErrorMessage({ message: "For security purposes, you can only request this after 60 seconds." }),
    "Please wait a minute before requesting another code.");
  assert.equal(AV.authErrorMessage({ message: "Something exotic" }), "Sign-in failed: Something exotic");
  assert.equal(AV.authErrorMessage(null), "Sign-in failed. Please try again.");
});

test("nsKey namespaces data keys by uid prefix; no uid -> legacy key", () => {
  const uid = "3f8a9c21-1234-5678-9abc-def012345678";
  assert.equal(AV.nsKey(uid, "food"), "nt_u3f8a9c21_food");
  assert.equal(AV.nsKey(uid, "version"), "nt_u3f8a9c21_version");
  assert.equal(AV.nsKey(null, "food"), "nt_food");
  assert.equal(AV.nsKey(undefined, "days"), "nt_days");
});
```

- [ ] **Step 2: Run `npm test`** — expect the 5 new tests to FAIL with `Cannot find module '../www/auth-view.js'`; the existing 59 still pass.

- [ ] **Step 3: Implement.** Create `www/auth-view.js`:

```js
// Pure auth/onboarding logic for the sign-in gate: view routing, input
// validation, friendly error mapping, per-user localStorage key namespacing.
// UMD: usable as a browser global (window.AuthView) and a Node module.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuthView = api;
})(typeof self !== "undefined" ? self : this, function () {
  // Which top-level view to show for a given auth/profile state.
  function route(state) {
    if (!state || !state.hasSession) return "signin";
    return state.profileMissing ? "onboarding" : "app";
  }

  function validEmail(s) {
    return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function validOtp(s) {
    return typeof s === "string" && /^\d{6}$/.test(s.trim());
  }

  function authErrorMessage(err) {
    const m = (err && err.message) || "";
    if (/expired|invalid|otp/i.test(m)) return "That code is wrong or expired — request a new one.";
    if (/fetch|network/i.test(m)) return "Can't reach the server — check your connection and try again.";
    if (/security purposes|after \d+ seconds/i.test(m)) return "Please wait a minute before requesting another code.";
    if (m) return `Sign-in failed: ${m}`;
    return "Sign-in failed. Please try again.";
  }

  // Per-user localStorage namespacing for the offline data cache.
  // nsKey("3f8a9c21-...", "food") -> "nt_u3f8a9c21_food"; no uid -> legacy "nt_food".
  function nsKey(uid, base) {
    if (!uid) return `nt_${base}`;
    return `nt_u${String(uid).slice(0, 8)}_${base}`;
  }

  return { route, validEmail, validOtp, authErrorMessage, nsKey };
});
```

- [ ] **Step 4: Run `npm test`** — all tests pass (59 + 5 = 64 subtests; what matters is zero failures).

- [ ] **Step 5: Commit**

```bash
git add www/auth-view.js tests/auth-view.test.js
git commit -m "feat(auth): AuthView pure module - routing, validation, error mapping, cache namespacing"
```

---

### Task 3: Capacitor deps, deep-link intent filter, PKCE client options

**Files:**
- Modify: `package.json` (via npm)
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `www/app.js:26-28` (client creation)
- Modify: `www/index.html:278-285` (script tag)

- [ ] **Step 1: Install plugins**

Run: `npm install @capacitor/app@^8 @capacitor/browser@^8`
Expected: both added to `package.json` dependencies, exit 0.

- [ ] **Step 2: Add the deep-link intent filter.** In `android/app/src/main/AndroidManifest.xml`, inside the existing `<activity ... android:name=".MainActivity" ...>` element, directly after the existing LAUNCHER `</intent-filter>`, add:

```xml
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.lazymacros.app" />
            </intent-filter>
```

- [ ] **Step 3: PKCE client options.** In `www/app.js`, replace:

```js
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

with:

```js
// PKCE flow so the Android deep-link return can exchange a code for a session;
// detectSessionInUrl handles the ?code= redirect in plain-browser (dev) mode.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
```

- [ ] **Step 4: Load the new module.** In `www/index.html`, add `<script src="auth-view.js"></script>` between the `theme.js` and `app.js` script tags:

```html
  <script src="targets.js"></script>
  <script src="theme.js"></script>
  <script src="auth-view.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 5: Sync and verify build.** Run `npx cap sync android` (expect `√ copy android` / `√ update android`, plugins now list `@capacitor/app` and `@capacitor/browser`). Run `npm test` (still zero failures).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json android/app/src/main/AndroidManifest.xml www/app.js www/index.html android/app/capacitor.build.gradle android/capacitor.settings.gradle
git commit -m "feat(auth): capacitor app+browser plugins, deep-link intent filter, PKCE client"
```

(Include the two generated `android/*.gradle` files only if `git status` shows them modified.)

---

### Task 4: Auth + onboarding markup and styles

**Files:**
- Modify: `www/index.html` (before `</div><!-- .app -->`-closing `</div>`, i.e. right after the photo modal `</div>`)
- Modify: `www/styles.css` (append at end)

- [ ] **Step 1: Add the two overlay views.** In `www/index.html`, directly after the PHOTO MODAL closing `</div>` (line ~276, before the final `</div>` that closes `.app`), add:

```html
    <!-- AUTH VIEW (sign-in gate) -->
    <div id="auth-view" class="auth-view hidden">
      <div class="auth-card">
        <h1>Lazy Macros</h1>
        <p class="auth-sub">Sign in to sync your nutrition data</p>
        <button id="auth-google" class="btn btn-primary auth-btn">Continue with Google</button>
        <div class="auth-divider"><span>or</span></div>
        <div class="form-row">
          <label for="auth-email">Email</label>
          <input type="email" id="auth-email" autocomplete="email" placeholder="you@example.com">
        </div>
        <button id="auth-send-otp" class="btn btn-secondary auth-btn">Email me a code</button>
        <div id="auth-otp-row" class="hidden">
          <div class="form-row">
            <label for="auth-otp">6-digit code</label>
            <input type="text" id="auth-otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
          </div>
          <button id="auth-verify-otp" class="btn btn-primary auth-btn">Verify code</button>
        </div>
        <p id="auth-error" class="auth-error"></p>
      </div>
    </div>

    <!-- ONBOARDING VIEW (first-run profile setup) -->
    <div id="onboarding-view" class="auth-view hidden">
      <div class="auth-card">
        <h1>Welcome!</h1>
        <p class="auth-sub">A few details so we can compute your targets</p>
        <form id="onboarding-form">
          <div class="form-row"><label for="ob-height">Height (cm)</label><input type="number" id="ob-height" step="0.1" required></div>
          <div class="form-row"><label for="ob-age">Age</label><input type="number" id="ob-age" min="10" max="120" required></div>
          <div class="form-row"><label for="ob-weight">Current weight (lbs)</label><input type="number" id="ob-weight" step="any" required></div>
          <div class="form-row"><label for="ob-activity">Today's activity</label><select id="ob-activity" required></select></div>
          <div class="form-row"><label for="ob-goal">Weight-loss goal</label><select id="ob-goal" required></select></div>
          <div class="form-row"><label for="ob-protein-low">Protein target lower (g)</label><input type="number" id="ob-protein-low" required></div>
          <div class="form-row"><label for="ob-protein-high">Protein target upper (g)</label><input type="number" id="ob-protein-high" required></div>
          <button type="submit" class="btn btn-primary auth-btn">Start tracking</button>
        </form>
      </div>
    </div>
```

- [ ] **Step 2: Styles.** Append to `www/styles.css`:

```css
/* ---- Auth gate + onboarding (theme vars only) ---- */
.auth-view {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  overflow-y: auto;
  padding: 24px 16px;
}
.auth-card {
  width: 100%;
  max-width: 360px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
}
.auth-card h1 { margin: 0 0 4px; font-size: 1.4rem; color: var(--text); }
.auth-sub { margin: 0 0 20px; color: var(--text-dim); font-size: 0.9rem; }
.auth-btn { width: 100%; margin-top: 8px; }
.auth-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0;
  color: var(--text-dim);
  font-size: 0.8rem;
}
.auth-divider::before, .auth-divider::after {
  content: "";
  flex: 1;
  border-top: 1px solid var(--border);
}
.auth-error { color: var(--red); font-size: 0.85rem; min-height: 1.2em; margin: 12px 0 0; }
```

- [ ] **Step 3: Run `npm test`** (unchanged, zero failures) and `node --check www/app.js` still passes (no JS changed this task, sanity only).

- [ ] **Step 4: Commit**

```bash
git add www/index.html www/styles.css
git commit -m "feat(auth): sign-in gate and onboarding overlay markup + styles"
```

---

### Task 5: Auth gate in app.js — startApp extraction, Google/OTP/deep-link handlers

**Files:**
- Modify: `www/app.js` (the `DOMContentLoaded` handler at ~line 3176, plus a new AUTH GATE section directly above it)

- [ ] **Step 1: Extract `startApp()`.** The current handler is:

```js
document.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.add('loading');
  try {
    await initFromSupabase();
  } catch (err) {
    console.error('[Supabase] Init failed, falling back to localStorage:', err);
    initFromLocalStorage();
  }
  document.body.classList.remove('loading');

  // Resume any estimates left pending from a previous session
  resumePendingEstimates();
  ... (rest of the handler)
});
```

Restructure it into (keep the ENTIRE former body from `// Resume any estimates...` down to the last statement of the current handler — move it verbatim into `startApp()` after the init block; do not retype it, cut and paste the block):

```js
let _appStarted = false;

async function startApp() {
  if (_appStarted) return;
  _appStarted = true;
  document.body.classList.add('loading');
  try {
    await initFromSupabase();
  } catch (err) {
    console.error('[Supabase] Init failed, falling back to localStorage:', err);
    initFromLocalStorage();
  }
  document.body.classList.remove('loading');

  maybeShowOnboarding(); // defined in Task 7 — no-op stub until then, see Step 2

  // Resume any estimates left pending from a previous session
  resumePendingEstimates();
  // ... (former DOMContentLoaded body, moved verbatim)
}

document.addEventListener("DOMContentLoaded", async () => {
  wireAuthUi();
  const { data: { session } } = await sb.auth.getSession();
  setAuthUser(session ? session.user : null);
  if (session) {
    await startApp();
  } else {
    showAuthView(true);
  }
  // Fires on OTP verify, OAuth code exchange, and sign-out.
  sb.auth.onAuthStateChange(async (_event, s) => {
    setAuthUser(s ? s.user : null);
    if (s) { showAuthView(false); await startApp(); }
  });
});
```

- [ ] **Step 2: Temporary stub** so Task 5 stands alone (replaced in Task 7). Add directly above `startApp()`:

```js
function maybeShowOnboarding() {} // replaced in the onboarding task
```

- [ ] **Step 3: Add the AUTH GATE section.** Insert directly above the `let _appStarted = false;` line:

```js
// ============================================================
// AUTH GATE — sign-in required before the app starts
// ============================================================

let _authUser = null;
function setAuthUser(user) { _authUser = user || null; }
function currentUid() { return _authUser ? _authUser.id : null; }

function showAuthView(show) {
  document.getElementById("auth-view").classList.toggle("hidden", !show);
}

function setAuthError(err) {
  document.getElementById("auth-error").textContent = err ? AuthView.authErrorMessage(err) : "";
}

function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

async function signInWithGoogle() {
  setAuthError(null);
  try {
    if (isNativeApp()) {
      // Native: open the OAuth URL in the in-app browser; the deep-link
      // listener below completes the session with exchangeCodeForSession.
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: "com.lazymacros.app://auth-callback", skipBrowserRedirect: true },
      });
      if (error) throw error;
      await window.Capacitor.Plugins.Browser.open({ url: data.url });
    } else {
      // Plain browser (dev): normal redirect round-trip; detectSessionInUrl
      // picks up the ?code= on return.
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    }
  } catch (err) {
    console.error("[Auth] Google sign-in failed:", err);
    setAuthError(err);
  }
}

async function sendOtp() {
  setAuthError(null);
  const email = document.getElementById("auth-email").value.trim();
  if (!AuthView.validEmail(email)) { setAuthError({ message: "Enter a valid email address" }); return; }
  const { error } = await sb.auth.signInWithOtp({ email });
  if (error) { setAuthError(error); return; }
  document.getElementById("auth-otp-row").classList.remove("hidden");
}

async function verifyOtp() {
  setAuthError(null);
  const email = document.getElementById("auth-email").value.trim();
  const token = document.getElementById("auth-otp").value.trim();
  if (!AuthView.validOtp(token)) { setAuthError({ message: "Enter the 6-digit code" }); return; }
  const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error) setAuthError(error);
  // Success path: onAuthStateChange fires and starts the app.
}

function wireAuthUi() {
  document.getElementById("auth-google").addEventListener("click", signInWithGoogle);
  document.getElementById("auth-send-otp").addEventListener("click", sendOtp);
  document.getElementById("auth-verify-otp").addEventListener("click", verifyOtp);

  // Deep-link return from the OAuth browser (native only).
  if (isNativeApp() && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener("appUrlOpen", async ({ url }) => {
      if (!url || !url.startsWith("com.lazymacros.app://auth-callback")) return;
      try { await window.Capacitor.Plugins.Browser.close(); } catch (e) { /* browser may already be closed */ }
      const code = new URL(url).searchParams.get("code");
      if (!code) return;
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) { console.error("[Auth] Code exchange failed:", error); setAuthError(error); }
      // Success: onAuthStateChange starts the app.
    });
  }
}
```

- [ ] **Step 4: Syntax check + tests.** Run `node --check www/app.js` (passes) and `npm test` (zero failures).

- [ ] **Step 5: Manual browser smoke test.** Run `npx http-server www -p 8080 -c-1`; open `http://localhost:8080`. Expected: the sign-in gate shows instead of the app (no session). Enter your email → "Email me a code" → check inbox for a 6-digit code (requires Task 0 done) → verify → app loads with all data. Reload → app loads directly (session persisted). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add www/app.js
git commit -m "feat(auth): sign-in gate with Google OAuth deep link + email OTP"
```

---

### Task 6: Namespaced offline cache + Account card with sign-out

> **Hard requirements added by Task 5's code review:** (a) sign-out must `location.reload()` (already in Step 3 below); (b) the `onAuthStateChange` callback in the DOMContentLoaded handler must also handle session LOSS while the app is running (token revoked/expired in background): add `if (!s && _appStarted) { clearUserCache(); location.reload(); }` so a dead session can't strand a running app silently writing to a wrong cache.

**Files:**
- Modify: `www/app.js` — cache wrappers + replace the five data-key call sites; Account card renderer
- Modify: `www/index.html:136-138` — add an account card mount point

- [ ] **Step 1: Add cache wrappers.** In `www/app.js`, directly under the `bgWrite` function, add:

```js
// ---- Per-user localStorage cache (theme + API keys stay device-global) ----
const CACHE_BASES = ["food", "days", "profile", "assessments", "version"];
function lsGet(base) { return localStorage.getItem(AuthView.nsKey(currentUid(), base)); }
function lsSet(base, value) { localStorage.setItem(AuthView.nsKey(currentUid(), base), value); }
function clearUserCache() {
  for (const base of CACHE_BASES) localStorage.removeItem(AuthView.nsKey(currentUid(), base));
}
```

- [ ] **Step 2: Replace the data-key call sites.** Replace every direct localStorage access to the five data keys with the wrappers (leave `nt_theme`, `nt_key_*`, and `nt_<setting>` mirrors in `getSetting`/`setSetting`/provider settings untouched). Exact call sites (line numbers pre-edit):

| Location | Old | New |
|---|---|---|
| `loadProfile` (99) | `localStorage.getItem("nt_profile")` | `lsGet("profile")` |
| `saveProfile` (105) | `localStorage.setItem("nt_profile", JSON.stringify(profile))` | `lsSet("profile", JSON.stringify(profile))` |
| `loadFoodEntries` (116) | `localStorage.getItem("nt_food")` | `lsGet("food")` |
| `saveFoodEntries` (122) | `localStorage.setItem("nt_food", ...)` | `lsSet("food", JSON.stringify(entries))` |
| `loadDayEntries` (144) | `localStorage.getItem("nt_days")` | `lsGet("days")` |
| `saveDayEntries` (150) | `localStorage.setItem("nt_days", ...)` | `lsSet("days", JSON.stringify(entries))` |
| `initFromSupabase` sync-back (333-336) | four `setItem` calls | `lsSet("food", ...)`, `lsSet("days", ...)`, `lsSet("profile", ...)`, `lsSet("assessments", ...)` |
| `initFromLocalStorage` (345-365) | all `getItem`/`setItem` for version/food/days/profile/assessments | `lsGet`/`lsSet` equivalents (seeding block is deleted in Task 7; if executing out of order, convert what exists) |
| `loadAssessments` (3004) | `localStorage.getItem("nt_assessments")` | `lsGet("assessments")` |
| `saveAssessment` (3013) | `localStorage.setItem("nt_assessments", ...)` | `lsSet("assessments", JSON.stringify(assessments))` |
| `deleteAssessment` (3028) | `localStorage.setItem("nt_assessments", ...)` | `lsSet("assessments", JSON.stringify(assessments))` |
| `migrateLocalStorageToSupabase` (375-378) | leave as-is | deleted entirely in Task 7 |
| `seedSupabase` (458) | leave as-is | deleted entirely in Task 7 |

- [ ] **Step 3: Account card.** In `www/index.html`, inside the Calorie Target tab's `.settings-grid` (after `<div id="validation-settings"></div>`), add `<div id="account-settings"></div>`. In `www/app.js`, add near `renderProviderSettings` (find it with grep; place the new function directly before it):

```js
function renderAccountSettings() {
  const host = document.getElementById("account-settings");
  if (!host) return;
  const email = _authUser && _authUser.email ? _authUser.email : "(unknown)";
  host.innerHTML = `<div class="settings-card">
    <h2>Account</h2>
    <p style="color:var(--text-dim);margin:0 0 12px;">Signed in as <b style="color:var(--text)">${escapeHtml(email)}</b></p>
    <button id="sign-out-btn" class="btn btn-secondary">Sign out</button>
  </div>`;
  document.getElementById("sign-out-btn").addEventListener("click", signOut);
}

async function signOut() {
  clearUserCache();          // wipe this user's offline cache before identity flips
  await sb.auth.signOut();   // clears the persisted session
  location.reload();         // relaunch -> gate shows the sign-in view
}
```

And call `renderAccountSettings();` inside `startApp()` directly after the existing `renderProviderSettings(); renderMacroSettings();` lines.

- [ ] **Step 4: Tests + syntax.** `npm test` (zero failures), `node --check www/app.js`.

- [ ] **Step 5: Manual check.** `npx http-server www -p 8080 -c-1`: sign in (OTP), confirm localStorage now has `nt_u<8 chars>_food` etc. (DevTools → Application), Targets tab shows the Account card with your email; Sign out returns to the gate and the namespaced keys are gone. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add www/app.js www/index.html
git commit -m "feat(auth): per-user namespaced offline cache + account card with sign-out"
```

---

### Task 7: Per-user data layer — remove seeding, onboarding flow, profile upsert

**Files:**
- Modify: `www/app.js` — `initFromSupabase`, `initFromLocalStorage`, `profileJsToRow`, `saveProfile`, onboarding logic; delete `SEED_FOOD`, `SEED_DAYS`, `seedSupabase`, `migrateLocalStorageToSupabase`, `DATA_VERSION`

- [ ] **Step 1: Delete dead single-user code.** Remove entirely: the `SEED_FOOD` and `SEED_DAYS` constant arrays, `seedSupabase()`, `migrateLocalStorageToSupabase()`, the `DATA_VERSION` constant, and the version-seeding block at the top of `initFromLocalStorage` (everything from `const currentVersion = ...` through the closing `}` of the `if (currentVersion < DATA_VERSION)` block).

- [ ] **Step 2: Simplify `initFromSupabase`.** Remove the empty-DB migrate-or-seed branch (the whole `if (!hasFoodData && !hasDaysData && !hasProfileData) { ... return initFromSupabase(); }` block). Replace the profile read `sb.from('profile').select('*').eq('id', 1).maybeSingle()` with `sb.from('profile').select('*').maybeSingle()` (RLS scopes it per user after migration 2; pre-migration there is one global row, same result). After `_cache.ready = true;` add:

```js
  _cache.profileMissing = !hasProfileData;
```

And in `initFromLocalStorage`, after `_cache.ready = true;` add:

```js
  _cache.profileMissing = !savedProfile;
```

- [ ] **Step 3: Per-user profile row.** Replace `profileJsToRow`:

```js
function profileJsToRow(p) {
  // No id: the profile table keys on user_id (filled by its auth.uid() default).
  return { height: p.height, age: p.age, protein_low: p.proteinLow, protein_high: p.proteinHigh, weight_loss_goal: p.weightLossGoal };
}
```

And in `saveProfile`, change the upsert line to:

```js
    const { error } = await sb.from('profile').upsert(profileJsToRow(profile), { onConflict: 'user_id' });
```

**Known transient:** until SQL migration 2 adds the `user_id` unique constraint, this upsert errors in the cloud and is caught by `bgWrite` (harmless `[Supabase bgWrite]` log; data persists locally) — same pattern as previous migrations. Migration 2 (Task 8) runs in the same session.

- [ ] **Step 4: Onboarding logic.** Replace the Task 5 stub `function maybeShowOnboarding() {}` with:

```js
function maybeShowOnboarding() {
  if (!_cache.profileMissing) return;
  const ob = document.getElementById("onboarding-view");
  // Populate the selects (same options as the Targets tab).
  const act = document.getElementById("ob-activity");
  act.innerHTML = ACTIVITY_TYPES.map((a) => `<option value="${escapeHtml(a.label)}">${escapeHtml(a.label)}</option>`).join("");
  const goal = document.getElementById("ob-goal");
  goal.innerHTML = Targets.GOALS.map((g) => `<option value="${escapeHtml(g.goal)}">${escapeHtml(g.goal)}</option>`).join("");
  goal.value = "0.50 kg/week";
  document.getElementById("ob-protein-low").value = DEFAULT_PROFILE.proteinLow;
  document.getElementById("ob-protein-high").value = DEFAULT_PROFILE.proteinHigh;
  ob.classList.remove("hidden");
}

function completeOnboarding(ev) {
  ev.preventDefault();
  const profile = {
    height: parseFloat(document.getElementById("ob-height").value),
    age: parseInt(document.getElementById("ob-age").value, 10),
    proteinLow: parseFloat(document.getElementById("ob-protein-low").value),
    proteinHigh: parseFloat(document.getElementById("ob-protein-high").value),
    weightLossGoal: document.getElementById("ob-goal").value,
  };
  if ([profile.height, profile.age, profile.proteinLow, profile.proteinHigh].some((n) => !Number.isFinite(n))) return;
  saveProfile(profile);
  // First Day entry seeds the copy-forward chain used by ensureDayExists.
  const weight = parseFloat(document.getElementById("ob-weight").value);
  const activity = document.getElementById("ob-activity").value;
  if (Number.isFinite(weight)) {
    const today = new Date().toISOString().slice(0, 10);
    saveDayEntries([...loadDayEntries(), { id: Date.now(), date: today, weight, activity }]);
  }
  _cache.profileMissing = false;
  document.getElementById("onboarding-view").classList.add("hidden");
  // Re-render everything that reads profile/days.
  renderCalorieTracker();
  renderProfileForm();
}
```

Wire the form: inside `startApp()`, with the other listeners, add:

```js
  document.getElementById("onboarding-form").addEventListener("submit", completeOnboarding);
```

**Note:** `renderProfileForm` — grep for the function that populates `#profile-height` etc. (it exists; the profile form is rendered from `loadProfile()` during startup). If it has a different name (e.g. it's inline in the startup code), call what actually exists or omit the call and note it; do not invent a function.

- [ ] **Step 5: Tests + syntax + smoke.** `npm test` (zero failures — deleted code has no tests), `node --check www/app.js`. Browser smoke test (`npx http-server www -p 8080 -c-1`): sign in with your real account → app loads normally, NO onboarding (profile row exists). Sign in with a fresh email (`yourname+test1@gmail.com` via OTP) → onboarding appears; fill it → app shows empty tracker with one auto-created day; **note:** until migration 2 runs, this test account's cloud writes land with `user_id` null and both accounts see the same global data — full isolation only exists after Task 8. Verify shapes, not isolation, at this step.

- [ ] **Step 6: Commit**

```bash
git add www/app.js
git commit -m "feat(auth): onboarding flow, per-user profile upsert, remove seed/migration code"
```

---

### Task 8: USER ACTION — run SQL migration 2 (backfill, constraints, per-user RLS)

**Files:**
- Create: `docs/sql/2026-07-07-accounts-02-finalize.sql`

- [ ] **Step 1: Owner signs in once** (Task 5/7 smoke tests already did this). Find the owner's user id: Supabase dashboard → Authentication → Users → copy the UUID for robertmessi123456@gmail.com.

- [ ] **Step 2: Write the SQL file** (`<OWNER_UID>` is replaced by the user before running — it is a run-time parameter, not a placeholder to implement):

```sql
-- Accounts migration 2/2: backfill owner, defaults, per-user keys, per-user RLS.
-- RUN AFTER: migration 1, code deploy, and the owner's first sign-in.
-- REPLACE <OWNER_UID> with the owner's auth.users id before running.

-- 1) Backfill: everything unowned belongs to the owner (includes any rows
--    written between deploy and this migration).
update food_entries set user_id = '<OWNER_UID>' where user_id is null;
update days         set user_id = '<OWNER_UID>' where user_id is null;
update profile      set user_id = '<OWNER_UID>' where user_id is null;
update assessments  set user_id = '<OWNER_UID>' where user_id is null;
update settings     set user_id = '<OWNER_UID>' where user_id is null;

-- 2) Defaults + not null: future inserts self-own via auth.uid().
alter table food_entries alter column user_id set default auth.uid(), alter column user_id set not null;
alter table days         alter column user_id set default auth.uid(), alter column user_id set not null;
alter table profile      alter column user_id set default auth.uid(), alter column user_id set not null;
alter table assessments  alter column user_id set default auth.uid(), alter column user_id set not null;
alter table settings     alter column user_id set default auth.uid(), alter column user_id set not null;

-- 3) Per-user keys. Client ids are Date.now() values generated per device, so
--    they must only be unique per user, not globally.
alter table food_entries drop constraint food_entries_pkey, add primary key (user_id, id);
alter table days         drop constraint days_pkey,         add primary key (user_id, id);
alter table settings     drop constraint settings_pkey,     add primary key (user_id, key);
-- profile: one row per user; keep legacy id column but key on user_id.
alter table profile      drop constraint profile_pkey,      add primary key (user_id);

-- 4) Per-user RLS replacing "Allow all". Policy names may differ; drop
--    whatever exists (check: select policyname from pg_policies where schemaname='public').
do $$
declare t text; p record;
begin
  foreach t in array array['food_entries','days','profile','assessments','settings'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format('create policy per_user_all on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
```

- [ ] **Step 3: Commit**

```bash
git add docs/sql/2026-07-07-accounts-02-finalize.sql
git commit -m "docs(sql): accounts migration 2 - backfill, per-user keys, RLS"
```

- [ ] **Step 4: USER runs the script** (with `<OWNER_UID>` substituted) in the Supabase SQL editor. Executor pauses until confirmed. Note: if step 3 fails on a constraint name (e.g. `days_pkey` doesn't exist under that name), find actual names with `select conname from pg_constraint where conrelid = 'days'::regclass;` and adjust — table PK constraint names can vary.

- [ ] **Step 5: Post-migration browser check.** `npx http-server www -p 8080 -c-1`: sign in as owner → all historical data loads; profile save now syncs without `[Supabase bgWrite]` errors. Sign out → sign in as the `+test1` account → sees ONLY its own onboarding-created data (isolation now real).

---

### Task 9: Emulator verification (two accounts) + final sync

**Files:** none (build/verify only)

- [ ] **Step 1:** `npx cap sync android` (expect success).
- [ ] **Step 2: Emulator run.** Env: `$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"; $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME; $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`. If no device in `adb devices`: `& "$env:ANDROID_HOME\emulator\emulator.exe" -avd Pixel_7 -no-snapshot-load` (background; cold boot required — corrupt quickboot snapshot history), poll `adb shell getprop sys.boot_completed` → 1. Then `cd android; .\gradlew.bat installDebug`; launch via `adb shell monkey -p com.lazymacros.app -c android.intent.category.LAUNCHER 1`.
- [ ] **Step 3: Verify on device** (WebView devtools via `adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>` for DOM checks; screenshots via `adb shell screencap -p /sdcard/s.png; adb pull /sdcard/s.png` — never PowerShell `>` redirect):
  1. Fresh launch shows the sign-in gate (dark theme, styled).
  2. Email OTP sign-in as owner → data loads (125+ entries), bottom nav + day cards fine.
  3. Google button → in-app browser opens Google; complete sign-in → deep link returns to the app signed in. (If Task 0 Google config is pending, note it and verify OTP only.)
  4. Kill the app (`adb shell am force-stop com.lazymacros.app`), relaunch → straight into the app (persisted session).
  5. Airplane-mode relaunch (`adb shell cmd connectivity airplane-mode enable`, relaunch) → app loads from the namespaced offline cache. Re-disable airplane mode after.
  6. Sign out (Targets → Account) → gate reappears; sign in as `+test2` fresh account → onboarding → empty app, one day entry; owner's data absent.
- [ ] **Step 4:** Commit any `cap sync` artifacts under `android/` if tracked changes exist: `git commit -m "chore: cap sync android for accounts feature"`.

---

## Self-review notes

- Spec coverage: sign-in gate (T5), Google deep link + OTP (T3/T5), per-user schema + RLS + owner backfill (T1/T8), onboarding without seeds (T7), namespaced cache + sign-out clearing (T6), offline behaviors (T5 gate + existing fallback, verified T9), manual dashboard steps (T0), SHA-1 note resolved (browser flow → no SHA-1 needed, T0 Step 3).
- Known transient windows are documented where they occur (T7 Step 3, T7 Step 5) rather than hidden.
- `maybeShowOnboarding` is stubbed in T5 and defined in T7 — noted at both sites.
- The `renderProfileForm` name in T7 Step 4 is flagged for verification against the actual codebase rather than asserted.
- Test count grows 59 → 64; only `auth-view.js` logic is unit-testable (DOM/auth flows are glue over supabase-js, verified live in T5/T6/T7 smokes and T9).
