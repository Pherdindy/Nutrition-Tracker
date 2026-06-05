// Pure logic for resolving the effective theme and Android status-bar config.
// UMD: usable as a browser global (window.Theme) and a Node module.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Theme = api;
})(typeof self !== "undefined" ? self : this, function () {
  /**
   * Resolve the stored theme setting + OS light-mode preference to "dark" or "light".
   * @param {string|null} setting  - stored value: "dark" | "light" | "system"
   * @param {boolean}     prefersLight - true when OS prefers light mode
   * @returns {"dark"|"light"}
   */
  function resolveTheme(setting, prefersLight) {
    if (setting === "light") return "light";
    if (setting === "dark") return "dark";
    if (setting === "system") return prefersLight ? "light" : "dark";
    return "dark";
  }

  /**
   * Return the Android status-bar color and style for the given effective theme.
   * @param {string} effective - "dark" or "light"
   * @returns {{ color: string, style: string }}
   */
  function statusBarFor(effective) {
    return effective === "light"
      ? { color: "#f6f7fb", style: "LIGHT" }
      : { color: "#16324f", style: "DARK" };
  }

  return { resolveTheme, statusBarFor };
});
