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
    // Supabase email-OTP length is configurable from 6 to 10 digits; this
    // project currently issues 8. Accept the whole legal range so a dashboard
    // config change can never lock users out (found live 2026-07-27).
    return typeof s === "string" && /^\d{6,10}$/.test(s.trim());
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
