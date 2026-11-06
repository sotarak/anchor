import type { Plugin } from "vite";

/**
 * Keeps third-party runtime styles working under the dashboard's strict CSP (`style-src 'self'`,
 * no 'unsafe-inline'), which blocks every runtime-created <style> element.
 *
 * - sonner injects its whole stylesheet as a <style> at import time. That call becomes a no-op and
 *   the app imports `sonner/dist/styles.css` instead, served from 'self' like any other CSS.
 * - @radix-ui/react-select renders a <style> inside every Select viewport to hide its scrollbar.
 *   That element is dropped; the same rule lives in src/styles/globals.css.
 * - react-style-singleton (Radix scroll lock, via react-remove-scroll-bar) adds a <style> whenever
 *   a modal opens. Its one DOM-touching module is replaced with a constructable-stylesheet version:
 *   CSSOM sheets in `document.adoptedStyleSheets` are not subject to style-src.
 *
 * Both rewrites assert they matched, so a library upgrade that moves the code fails the build
 * instead of silently bringing the CSP violations back. Covered by test/e2e/smoke.spec.ts.
 */
export function cspSafeStyles(): Plugin {
  return {
    name: "anchor:csp-safe-styles",
    enforce: "pre",
    transform(code, id) {
      const path = id.split("?")[0]?.replaceAll("\\", "/") ?? "";
      if (/\/sonner\/dist\/index\.mjs$/.test(path)) {
        const head = "function __insertCSS(code) {";
        if (!code.includes(head)) this.error("sonner: __insertCSS not found; recheck the CSP shim");
        return { code: code.replace(head, `${head}\n  return;`), map: null };
      }
      if (/\/@radix-ui\/react-select\/dist\/index\.mjs$/.test(path)) {
        const style =
          /\/\* @__PURE__ \*\/ jsx\(\s*"style",\s*\{\s*dangerouslySetInnerHTML: \{\s*__html: `\[data-radix-select-viewport\][^`]*`\s*\},\s*nonce\s*\}\s*\)/;
        if (!style.test(code))
          this.error("react-select: viewport <style> not found; recheck the CSP shim");
        return { code: code.replace(style, "null"), map: null };
      }
      if (/\/react-style-singleton\/dist\/es2015\/singleton\.js$/.test(path)) {
        if (!code.includes("export var stylesheetSingleton")) {
          this.error("react-style-singleton: stylesheetSingleton not found; recheck the CSP shim");
        }
        return { code: ADOPTED_SINGLETON, map: null };
      }
      return null;
    },
  };
}

// Same contract as react-style-singleton's stylesheetSingleton: the first add() installs the CSS,
// the last remove() takes it away.
const ADOPTED_SINGLETON = `
export var stylesheetSingleton = function () {
  var counter = 0;
  var sheet = null;
  return {
    add: function (style) {
      if (counter == 0 && typeof document !== "undefined") {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(style);
        document.adoptedStyleSheets = document.adoptedStyleSheets.concat(sheet);
      }
      counter++;
    },
    remove: function () {
      counter--;
      if (!counter && sheet) {
        var installed = sheet;
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (s) {
          return s !== installed;
        });
        sheet = null;
      }
    },
  };
};
`;
