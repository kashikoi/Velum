const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const startup = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const shell = fs.readFileSync(path.join(root, "js/shell.js"), "utf8");

function browser(userAgent) {
  const classes = new Set();
  const context = vm.createContext({
    navigator: { userAgent },
    document: { documentElement: { classList: {
      add: (name) => classes.add(name), contains: (name) => classes.has(name),
    } } },
    localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null },
    location: { hash: "#/" },
    window: { Velum: {
      util: { escapeHtml: String, isISODate: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) },
      model: { isPlanDay: (day) => day === "saturday" }, planner: {}, store: {}, views: {},
    } },
  });
  vm.runInContext(startup, context);
  vm.runInContext(shell, context);
  return context;
}

test("phones open shopping-only for home, deep links and landscape; desktops and tablets keep full routes", () => {
  const phoneAgents = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/130.0 Mobile Safari/537.36",
  ];
  phoneAgents.forEach((ua) => {
    const context = browser(ua);
    assert.equal(context.window.Velum.shell.ui.phoneChecklist, true);
    ["#/", "#/menu", "#/recipe/recipe1", "#/pantry"].forEach((hash) => {
      context.location.hash = hash;
      const route = context.window.Velum.shell.parseRoute();
      assert.equal(route.name, "shopping");
      assert.equal(route.arg, null);
    });
    context.location.hash = "#/shopping/list1";
    assert.equal(context.window.Velum.shell.parseRoute().arg, "list1");
  });
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X)", "Mozilla/5.0 (iPad; CPU OS 18_0)", "Mozilla/5.0 (Linux; Android 15) Safari"].forEach((ua) => {
    const context = browser(ua);
    assert.equal(context.window.Velum.shell.ui.phoneChecklist, false);
    context.location.hash = "#/menu";
    assert.equal(context.window.Velum.shell.parseRoute().name, "menu");
  });
  assert.match(html, /width=device-width, initial-scale=1/);
  assert.doesNotMatch(html, /width=1280/);
});
