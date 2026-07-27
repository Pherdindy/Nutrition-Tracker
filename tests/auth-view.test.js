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

test("validOtp accepts 6-10 digits (Supabase OTP length is configurable; this project sends 8)", () => {
  assert.equal(AV.validOtp("123456"), true);
  assert.equal(AV.validOtp("94281547"), true); // 8 digits — live value 2026-07-27
  assert.equal(AV.validOtp("1234567890"), true); // 10 digits — Supabase max
  assert.equal(AV.validOtp(" 123456 "), true); // tolerates whitespace padding
  assert.equal(AV.validOtp("12345"), false); // below Supabase minimum
  assert.equal(AV.validOtp("12345678901"), false); // above Supabase maximum
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
