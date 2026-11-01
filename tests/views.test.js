const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.join(__dirname, "..", "js");
["util", "units", "model", "planner", "store"].forEach((f) => require(path.join(root, f + ".js")));
globalThis.Velum.images = { get: () => null };
require(path.join(root, "views.js"));
const { util: U, model: M, store: S, views: W } = globalThis.Velum;

test("plan and day views use eight fixed named days and no date controls", () => {
  S.init();
  const db = S.getDb();
  const ui = { canDrag: true };
  const html = W.menuPlan(db, ui);
  assert.equal((html.match(/role="columnheader"/g) || []).length, 3);
  assert.equal((html.match(/role="rowheader"/g) || []).length, 8);
  assert.equal((html.match(/role="gridcell"/g) || []).length, 24);
  const headings = [...html.matchAll(/class="wg-day__name">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(headings, M.PLAN_DAYS.map((d) => M.DAY_LABEL[d]));
  assert.equal(headings[0], "Saturday");
  assert.equal(headings[7], "Saturday");
  assert.doesNotMatch(html, /Following Saturday/);
  assert.match(html, /of 24 planned/);
  assert.doesNotMatch(html, /type="date"|Previous week|Next week|Copy week|Start from another week|today|is-past/);
  const first = W.menuDay(db, ui, "saturday");
  const last = W.menuDay(db, ui, "following-saturday");
  assert.doesNotMatch(first, /aria-label="Previous day"/);
  assert.doesNotMatch(last, /aria-label="Next day"/);
  assert.match(first, /#\/day\/sunday/);
  assert.match(last, /#\/day\/friday/);
  assert.equal((W.dayOptions("following-saturday").match(/<option/g) || []).length, 8);
  assert.match(W.dayOptions("following-saturday"), /value="following-saturday" selected>Saturday<\/option>/);
});

test("days are rows with three meal columns and occupied slots can hold multiple detailed meals", () => {
  S.init();
  const first = S.createRecipe({ name: "Chicken sandwich with roasted vegetables", servings: 1 });
  const second = S.createRecipe({ name: "Oatmeal with berries and yogurt", servings: 1 });
  S.addMeal({ day: "monday", meal: "breakfast", recipeId: first.id, servings: 1, note: "For Alex" });
  S.addMeal({ day: "monday", meal: "breakfast", recipeId: second.id, servings: 1, note: "For Sam" });
  const html = W.menuPlan(S.getDb(), { canDrag: true });
  const cells = [...html.matchAll(/data-drop-day="([^"]+)" data-drop-meal="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(cells, M.PLAN_DAYS.flatMap((day) => M.MEAL_TYPES.map((meal) => [day, meal])));
  assert.match(html, /Serves 1 · For Alex/);
  assert.match(html, /Serves 1 · For Sam/);
  assert.match(html, /Chicken sandwich with roasted vegetables/);
  assert.match(html, /Oatmeal with berries and yogurt/);
  assert.equal((html.match(/\+ Add another/g) || []).length, 2, "desktop and mobile occupied slots both offer another meal");
  assert.equal((html.match(/draggable="true"/g) || []).length, 2);
});

test("overview and shopping are independent of the current calendar date", () => {
  S.init();
  S.addMeal({ day: "following-saturday", meal: "dinner", title: "Dinner out" });
  const { list } = S.createListForPlan();
  const original = U.todayISO;
  U.todayISO = () => { throw new Error("The reusable plan must not consult today's date"); };
  try {
    const db = S.getDb();
    const home = W.home(db, {});
    assert.equal((home.match(/class="week-strip__day"/g) || []).length, 8);
    assert.match(home, /of 24 meals planned/);
    assert.doesNotMatch(home, /Today|This week|Coming up/);
    assert.match(W.shopping(db, {}, list), /Saturday-through-Saturday plan/);
    assert.match(W.menuPlan(db, {}), /data-drop-day="following-saturday"/);
  } finally {
    U.todayISO = original;
  }
});

test("shopping checklist removes category headings without changing item order or purchase preferences", () => {
  S.init();
  const list = S.createList("Weekly groceries");
  S.addItem(list.id, { name: "Rice", category: "pantry", qty: 2, unit: "lb" });
  S.addItem(list.id, { name: "Apples", category: "produce", qty: 3 });
  S.addItem(list.id, { name: "Carrots", category: "produce", qty: 1, unit: "lb" });
  const names = (html) => [...html.matchAll(/class="shop-item__name">([^<]+) /g)].map((m) => m[1]);
  let html = W.shopping(S.getDb(), {}, list);
  assert.deepEqual(names(html), ["Apples", "Carrots", "Rice"]);
  assert.doesNotMatch(html, /Produce|Pantry<\/h3>|Added by you|Group by aisle/);
  assert.match(html, /class="shop-item__main" data-act="buy"/);
  assert.match(html, /data-act="open-item"[^>]*aria-label="Edit Apples"/);
  S.updateSettings({ categoryOrder: ["pantry", "produce"] });
  assert.deepEqual(names(W.shopping(S.getDb(), {}, list)), ["Rice", "Apples", "Carrots"]);
  S.updateSettings({ groupBy: "none" });
  assert.deepEqual(names(W.shopping(S.getDb(), {}, list)), ["Rice", "Apples", "Carrots"]);
  const apples = S.listItems(list.id).find((i) => i.name === "Apples");
  S.togglePurchased(apples.id);
  assert.deepEqual(names(W.shopping(S.getDb(), {}, list)), ["Rice", "Carrots", "Apples"]);
  S.updateSettings({ purchased: "inline" });
  assert.deepEqual(names(W.shopping(S.getDb(), {}, list)), ["Rice", "Apples", "Carrots"]);
  S.updateSettings({ purchased: "hide" });
  html = W.shopping(S.getDb(), {}, list);
  assert.deepEqual(names(html), ["Rice", "Carrots"]);
});

test("phone checklist keeps backup loading and item editing but removes meal-plan navigation", () => {
  S.init();
  const ui = { phoneChecklist: true };
  const empty = W.shopping(S.getDb(), ui, null);
  assert.match(empty, /Load saved list/);
  assert.match(empty, /data-act="open-settings"/);
  assert.doesNotMatch(empty, /href="#\/menu"/);
  S.addMeal({ day: "saturday", meal: "dinner", title: "Dinner out" });
  const { list } = S.createListForPlan();
  S.addItem(list.id, { name: "<Apples>", qty: 2, note: "Small & crisp" });
  const html = W.shopping(S.getDb(), ui, list);
  assert.doesNotMatch(html, /href="#\/menu"/);
  assert.match(html, /data-act="regen"/);
  assert.match(html, /&lt;Apples&gt;/);
  assert.match(html, /Small &amp; crisp/);
  assert.match(html, /data-act="open-item"/);
  assert.match(W.shopping(S.getDb(), {}, list), /href="#\/menu"/, "desktop keeps the full app navigation");
});

test("phone checks toggle strikethrough in place regardless of desktop purchase preference", () => {
  for (const groupBy of ["category", "none"]) {
    for (const purchased of ["bottom", "hide", "inline"]) {
      S.init();
      const list = S.createList("Groceries");
      const apples = S.addItem(list.id, { name: "Apples", category: "produce" });
      S.addItem(list.id, { name: "Carrots", category: "produce" });
      S.addItem(list.id, { name: "Rice", category: "pantry" });
      S.updateSettings({ groupBy, purchased });
      const render = () => W.shopping(S.getDb(), { phoneChecklist: true }, list);
      const names = (html) => [...html.matchAll(/class="shop-item__name">([^<]+) /g)].map((m) => m[1]);
      const before = names(render());
      S.togglePurchased(apples.id);
      let html = render();
      assert.deepEqual(names(html), before);
      assert.match(html, /class="shop-item is-bought"/);
      assert.match(html, /aria-pressed="true" aria-label="Unmark Apples as bought"/);
      assert.doesNotMatch(html, /In the cart <span|All done!/);
      assert.equal(S.getDb().settings.purchased, purchased);
      S.togglePurchased(apples.id);
      html = render();
      assert.deepEqual(names(html), before);
      assert.doesNotMatch(html, /class="shop-item is-bought"/);
      assert.match(html, /aria-pressed="false" aria-label="Mark Apples as bought"/);
    }
  }
});

test("checklist keeps pantry items separate and cleared items hidden", () => {
  S.init();
  S.replaceDb(M.normalizeDb({
    lists: [{ id: "groceries", name: "Groceries" }],
    items: [
      { id: "salt", listId: "groceries", name: "Salt", category: "pantry", inPantry: true, sortOrder: 0 },
      { id: "apples", listId: "groceries", name: "Apples", category: "produce", sortOrder: 1 },
      { id: "removed", listId: "groceries", name: "Removed item", cleared: true, sortOrder: 2 },
    ],
  }));
  const html = W.shopping(S.getDb(), { phoneChecklist: true }, S.getDb().lists[0]);
  assert.match(html, /Already in your pantry/);
  assert.ok(html.indexOf('class="shop-item__name">Apples') < html.indexOf('class="shop-item__name">Salt'));
  assert.match(html, /data-act="pantry-override"/);
  assert.doesNotMatch(html, /Removed item/);
});
