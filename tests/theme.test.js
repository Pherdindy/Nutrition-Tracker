const test = require("node:test");
const assert = require("node:assert");
const T = require("../www/theme.js");

test("resolveTheme maps setting + system preference to dark/light", () => {
  assert.equal(T.resolveTheme("dark", false), "dark");
  assert.equal(T.resolveTheme("dark", true), "dark");
  assert.equal(T.resolveTheme("light", false), "light");
  assert.equal(T.resolveTheme("system", true), "light");
  assert.equal(T.resolveTheme("system", false), "dark");
  assert.equal(T.resolveTheme("bogus", true), "dark");
  assert.equal(T.resolveTheme(null, true), "dark");
});

test("statusBarFor returns color + style per effective theme", () => {
  assert.deepEqual(T.statusBarFor("dark"), { color: "#16324f", style: "DARK" });
  assert.deepEqual(T.statusBarFor("light"), { color: "#f6f7fb", style: "LIGHT" });
  assert.deepEqual(T.statusBarFor("x"), { color: "#16324f", style: "DARK" });
});
