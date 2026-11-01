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
  assert.equal((html.match(/role="columnheader"/g) || []).length, 8);
  assert.equal((html.match(/role="gridcell"/g) || []).length, 24);
  const headings = [...html.matchAll(/class="wg-day__name">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(headings, M.PLAN_DAYS.map((d) => M.DAY_LABEL[d]));
  assert.match(html, /of 24 planned/);
  assert.doesNotMatch(html, /type="date"|Previous week|Next week|Copy week|Start from another week|today|is-past/);
  const first = W.menuDay(db, ui, "saturday");
  const last = W.menuDay(db, ui, "following-saturday");
  assert.doesNotMatch(first, /aria-label="Previous day"/);
  assert.doesNotMatch(last, /aria-label="Next day"/);
  assert.match(first, /#\/day\/sunday/);
  assert.match(last, /#\/day\/friday/);
  assert.equal((W.dayOptions("following-saturday").match(/<option/g) || []).length, 8);
  assert.match(W.dayOptions("following-saturday"), /value="following-saturday" selected/);
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
