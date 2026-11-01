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
