// Run: node --test tests/
// Engine + service tests for Velum (no browser, no dependencies).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.join(__dirname, "..", "js");
["util", "units", "model", "planner", "store", "sync", "demo"].forEach((f) => require(path.join(root, f + ".js")));
const { util: U, units: Un, model: M, planner: P, store: S, sync: Y, demo: D } = globalThis.Velum;

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
function fresh() { const st = memStorage(); S.init({ storage: st }); return st; }
const ing = (qtyText, unit, name, extra) => Object.assign({ qtyText, unit, name }, extra || {});
const MON = "2026-11-02"; // a Monday
const WED = "2026-11-04";

function recipe(name, servings, ingredients, extra) {
  return S.createRecipe(Object.assign({ name, servings, categories: ["dinner"], ingredients, steps: ["Cook it."] }, extra || {}));
}
function findItem(listId, name) { return S.listItems(listId).find((i) => i.name.toLowerCase() === name.toLowerCase()); }

// ---------- Units & parsing ----------
test("quantities parse fractions, mixed numbers, unicode and ranges", () => {
  assert.equal(Un.parseQuantity("1 1/2"), 1.5);
  assert.equal(Un.parseQuantity("½"), 0.5);
  assert.equal(Un.parseQuantity("1½"), 1.5);
  assert.equal(Un.parseQuantity("2-3"), 3);
  assert.equal(Un.parseQuantity("abc"), null);
  assert.equal(Un.parseQuantity(""), null);
});

test("ingredient lines parse into quantity, unit, name and prep", () => {
  assert.deepEqual(pick(Un.parseIngredientLine("2 cups all-purpose flour, sifted")), { qty: 2, unit: "cup", name: "all-purpose flour", prep: "sifted" });
  assert.deepEqual(pick(Un.parseIngredientLine("4 cloves garlic")), { qty: 4, unit: "clove", name: "garlic", prep: "" });
  assert.deepEqual(pick(Un.parseIngredientLine("Salt and pepper to taste")), { qty: null, unit: "", name: "Salt and pepper", prep: "to taste" });
  assert.equal(Un.parseIngredientLine("1 cup milk (optional)").optional, true);
  assert.equal(Un.parseIngredientLine("1 T butter").unit, "tbsp");
  assert.equal(Un.parseIngredientLine("1 t salt").unit, "tsp");
  function pick(p) { return { qty: p.qty, unit: p.unit, name: p.name, prep: p.prep }; }
});

test("name normalization merges variants but keeps meaningfully different products apart", () => {
  ["Garlic cloves", "Cloves of garlic", "Fresh garlic", "garlic"].forEach((n) => assert.equal(Un.normalizeName(n), "garlic", n));
  assert.notEqual(Un.normalizeName("ground beef"), Un.normalizeName("beef steak"));
  assert.notEqual(Un.normalizeName("whole milk"), Un.normalizeName("skim milk"));
  assert.notEqual(Un.normalizeName("fresh basil"), Un.normalizeName("dried basil"));
  assert.equal(Un.normalizeName("2 medium onions".replace(/^\d+ /, "")), "onion");
});

test("grocery categories are guessed sensibly", () => {
  assert.equal(Un.guessCategory("ground beef"), "meat");
  assert.equal(Un.guessCategory("chicken broth"), "pantry");
  assert.equal(Un.guessCategory("eggplant"), "produce");
  assert.equal(Un.guessCategory("eggs"), "dairy");
  assert.equal(Un.guessCategory("black pepper"), "spices");
  assert.equal(Un.guessCategory("red bell pepper"), "produce");
  assert.equal(Un.guessCategory("peanut butter"), "pantry");
  assert.equal(Un.guessCategory("diced tomatoes", "can"), "pantry");
  assert.equal(Un.guessCategory("paper towels"), "household");
});

// ---------- Recipe management ----------
test("acceptance: create, edit, scale, search, favorite a recipe", () => {
  fresh();
  const r = recipe("Chicken Tacos", 4, [ing("2", "cup", "flour"), ing("1", "lb", "chicken"), ing("", "", "salt", { prep: "to taste" })],
    { tags: "weeknight, Mexican", prepMin: 10, cookMin: 20 });
  assert.equal(r.ingredients.length, 3);
  assert.equal(r.ingredients[2].qty, null);
  assert.equal(M.totalTime(r), 30);
  assert.deepEqual(r.tags, ["weeknight", "mexican"]);

  const scaled = P.scaledIngredients(r, 8);
  assert.equal(scaled[0].qty, 4);
  assert.equal(scaled[1].qty, 2);
  assert.equal(S.getDb().recipes[0].ingredients[0].qty, 2, "scaling must not modify the recipe");

  const edited = S.updateRecipe(r.id, Object.assign({}, r, { name: "Spicy Chicken Tacos", ingredients: r.ingredients.map((g) => Object.assign({}, g, { qtyText: g.qty == null ? "" : String(g.qty) })) }));
  assert.equal(edited.name, "Spicy Chicken Tacos");
  assert.equal(edited.createdAt, r.createdAt);
  assert.equal(S.toggleFavorite(r.id), true);
  assert.throws(() => recipe("", 4, []), S.ValidationError);
  assert.throws(() => recipe("Bad", 0, []), S.ValidationError);
  assert.throws(() => recipe("Bad qty", 2, [ing("lots", "", "rice")]), /Couldn't read the quantity/);
});

test("duplicating a recipe makes an independent copy", () => {
  fresh();
  const r = recipe("Chicken Tacos", 4, [ing("1", "lb", "chicken")]);
  const c = S.duplicateRecipe(r.id);
  assert.notEqual(c.id, r.id);
  assert.notEqual(c.ingredients[0].id, r.ingredients[0].id);
  assert.equal(c.name, "Chicken Tacos (copy)");
});

test("deleting a recipe used in meal history archives it instead of erasing history", () => {
  fresh();
  const r = recipe("Chili", 4, [ing("1", "lb", "ground beef")]);
  const unused = recipe("Soup", 4, []);
  S.addMeal({ date: MON, meal: "dinner", recipeId: r.id });
  assert.equal(S.deleteRecipe(r.id).archived, true);
  assert.equal(S.getDb().recipes.find((x) => x.id === r.id).archived, true);
  assert.equal(S.getDb().meals[0].recipeId, r.id);
  assert.throws(() => S.addMeal({ date: WED, meal: "dinner", recipeId: r.id }), /archived/);
  assert.equal(S.deleteRecipe(unused.id).archived, false);
  assert.equal(S.getDb().recipes.length, 1);
});

// ---------- Weekly planning ----------
test("acceptance: plan a week, change servings, navigate away and back, assignments persist", () => {
  const st = fresh();
  const b = recipe("Oats", 2, [ing("1", "cup", "oats")], { categories: ["breakfast"] });
  const l = recipe("Salad", 2, [ing("1", "head", "lettuce")], { categories: ["lunch"] });
  const d = recipe("Chili", 4, [ing("1", "lb", "ground beef")]);
  U.weekDates(MON).forEach((date) => {
    S.addMeal({ date, meal: "breakfast", recipeId: b.id });
    S.addMeal({ date, meal: "lunch", recipeId: l.id });
  });
  const dinner = S.addMeal({ date: MON, meal: "dinner", recipeId: d.id });
  assert.equal(dinner.servings, 4, "defaults to the dinner serving setting");
  S.updateMeal(dinner.id, { servings: 6 });
  S.addMeal({ date: U.addDays(MON, 7), meal: "dinner", title: "Dinner out" });

  S.load(); // simulate a reload from storage
  assert.ok(st._m.get(S.STORE_KEY).length > 10);
  const stats = P.weekStats(S.getDb(), MON);
  assert.equal(stats.filled, 15);
  assert.equal(stats.unplanned, 6);
  assert.equal(S.getDb().meals.find((m) => m.id === dinner.id).servings, 6);
  assert.equal(P.mealsForWeek(S.getDb(), U.addDays(MON, 7)).length, 1);
  assert.ok(S.getDb().recipes.find((r) => r.id === d.id).lastUsedAt);
});

test("copy and move meals, copy a day and a whole week without touching history", () => {
  fresh();
  const r = recipe("Chili", 4, [ing("1", "lb", "ground beef")]);
  const m = S.addMeal({ date: MON, meal: "dinner", recipeId: r.id, servings: 4 });
  S.addMeal({ date: MON, meal: "lunch", title: "Leftovers" });
  S.moveMeal(m.id, WED, "lunch");
  assert.equal(S.getDb().meals.find((x) => x.id === m.id).date, WED);
  S.copyMeal(m.id, MON, "dinner");
  assert.equal(S.copyDay(MON, "2026-11-05", "replace"), 2);
  const next = U.addDays(MON, 7);
  assert.equal(S.copyWeek(MON, next, "replace"), P.mealsForWeek(S.getDb(), MON).length);
  assert.equal(P.mealsForWeek(S.getDb(), next).length, P.mealsForWeek(S.getDb(), MON).length);
  const before = P.mealsForWeek(S.getDb(), MON).length;
  S.clearWeek(next);
  assert.equal(P.mealsForWeek(S.getDb(), MON).length, before, "clearing a week leaves other weeks intact");
  assert.throws(() => S.copyWeek(MON, MON), /different week/);
  assert.throws(() => S.addMeal({ date: MON, meal: "brunch", title: "x" }), S.ValidationError);
});

test("changing the first day of the week re-keys menus without losing lists", () => {
  fresh();
  S.renameMenu(MON, "Fall week");
  const { list } = S.createListForWeek(MON);
  S.updateSettings({ weekStartsOn: 0 });
  const db = S.getDb();
  assert.equal(db.menus.length, 1);
  assert.equal(db.menus[0].weekStart, "2026-11-01");
  assert.equal(db.lists.find((l) => l.id === list.id).menuId, db.menus[0].id);
});

// ---------- Shopping lists ----------
test("acceptance: spec example consolidates ground beef, onions and olive oil", () => {
  fresh();
  const mon = recipe("Monday dinner", 4, [ing("1", "lb", "ground beef"), ing("2", "", "onions"), ing("1", "tbsp", "olive oil")]);
  const wed = recipe("Wednesday dinner", 4, [ing("1.5", "lb", "ground beef"), ing("1", "", "onion"), ing("2", "tbsp", "olive oil")]);
  S.addMeal({ date: MON, meal: "dinner", recipeId: mon.id, servings: 4 });
  S.addMeal({ date: WED, meal: "dinner", recipeId: wed.id, servings: 4 });
  const { list } = S.createListForWeek(MON);
  const items = S.listItems(list.id);
  assert.equal(items.length, 3, "no duplicate entries");
  const beef = findItem(list.id, "Ground beef");
  assert.equal(beef.qty, 2.5); assert.equal(beef.unit, "lb"); assert.equal(beef.category, "meat");
  const onion = findItem(list.id, "Onion");
  assert.equal(onion.qty, 3); assert.equal(onion.category, "produce");
  const oil = findItem(list.id, "Olive oil");
  assert.equal(oil.qty, 3); assert.equal(oil.unit, "tbsp");
  assert.equal(beef.sources.length, 2);
});

test("compatible units convert; volume and weight never mix without a density", () => {
  const db = M.emptyDb();
  const out = P.aggregate([
    { name: "butter", qty: 1, unit: "tbsp" }, { name: "butter", qty: 2, unit: "tsp" },
    { name: "flour", qty: 1, unit: "cup" }, { name: "flour", qty: 100, unit: "g" },
    { name: "chicken", qty: 8, unit: "oz" }, { name: "chicken", qty: 1, unit: "lb" },
    { name: "milk", qty: 250, unit: "ml" }, { name: "milk", qty: 1, unit: "l" },
    { name: "garlic", qty: 4, unit: "clove" }, { name: "garlic", qty: 1, unit: "head" },
    { name: "salt", qty: null, unit: "" }, { name: "salt", qty: 1, unit: "tsp" },
  ], db.ingredients, "us");
  const get = (n, u) => out.filter((e) => e.name.toLowerCase() === n && (u === undefined || e.unit === u));
  const butter = get("butter")[0];
  assert.equal(butter.unit, "tbsp");
  assert.ok(Math.abs(butter.qty - 5 / 3) < 0.01, "1 tbsp + 2 tsp = 1⅔ tbsp");
  assert.equal(get("flour").length, 2, "1 cup flour and 100 g flour stay separate");
  const chicken = get("chicken")[0];
  assert.equal(chicken.unit, "lb"); assert.equal(chicken.qty, 1.5);
  const milk = get("milk")[0];
  assert.equal(milk.unit, "l"); assert.equal(milk.qty, 1.25);
  assert.equal(get("garlic").length, 2, "cloves and heads are different count units");
  const salt = get("salt");
  assert.equal(salt.length, 1); assert.equal(salt[0].qty, 1); assert.equal(salt[0].toTaste, true);

  const withDensity = P.aggregate([{ name: "flour", qty: 1, unit: "cup" }, { name: "flour", qty: 100, unit: "g" }],
    [M.normalizeIngredient({ id: "flour1", name: "Flour", category: "pantry", gramsPerCup: 120 })], "us");
  assert.equal(withDensity.length, 1);
  assert.equal(withDensity[0].unit, "g");
  assert.equal(withDensity[0].qty, 220, "catalog density lets 1 cup + 100 g = 220 g");
});

test("meaningfully different ingredients are never combined", () => {
  const out = P.aggregate([
    { name: "ground beef", qty: 1, unit: "lb" }, { name: "beef steak", qty: 1, unit: "lb" },
    { name: "whole milk", qty: 1, unit: "cup" }, { name: "skim milk", qty: 1, unit: "cup" },
    { name: "fresh basil", qty: 1, unit: "bunch" }, { name: "dried basil", qty: 1, unit: "tsp" },
    { name: "Garlic cloves", qty: 2, unit: "" }, { name: "cloves of garlic", qty: 1, unit: "" }, { name: "garlic", qty: 1, unit: "clove" },
  ], [], "us");
  assert.equal(out.length, 7);
  const garlic = out.find((e) => e.name === "Garlic");
  assert.equal(garlic.qty, 4); assert.equal(garlic.unit, "clove");
});

test("serving changes scale the shopping list; water is never shopped; counts round up", () => {
  fresh();
  const r = recipe("Rice", 4, [ing("2", "cup", "rice"), ing("3", "cup", "water"), ing("1", "", "onion")]);
  const m = S.addMeal({ date: MON, meal: "dinner", recipeId: r.id, servings: 6 });
  const { list } = S.createListForWeek(MON);
  assert.equal(findItem(list.id, "Rice").qty, 3);
  assert.equal(findItem(list.id, "Water"), undefined);
  assert.equal(findItem(list.id, "Onion").qty, 2, "1.5 onions -> buy 2");
  void m;
});

test("acceptance: manual items, purchases and edits survive regeneration", () => {
  fresh();
  const tacos = recipe("Tacos", 4, [ing("1", "lb", "ground beef"), ing("2", "", "onions"), ing("8", "", "tortillas")]);
  const chili = recipe("Chili", 4, [ing("1.5", "lb", "ground beef"), ing("1", "", "onion"), ing("1", "can", "kidney beans")]);
  const pasta = recipe("Pasta", 4, [ing("1", "lb", "spaghetti")]);
  S.addMeal({ date: MON, meal: "dinner", recipeId: tacos.id, servings: 4 });
  const chiliMeal = S.addMeal({ date: WED, meal: "dinner", recipeId: chili.id, servings: 4 });
  const { list } = S.createListForWeek(MON);
  assert.equal(S.isListOutdated(list.id), false);

  const towels = S.quickAddItem(list.id, "2 rolls paper towels");
  assert.equal(towels.manual, true);
  assert.equal(towels.category, "household");
  const apples = S.quickAddItem(list.id, "3 lb apples");
  assert.equal(apples.qty, 3); assert.equal(apples.unit, "lb");
  S.togglePurchased(findItem(list.id, "Tortilla").id);
  S.togglePurchased(findItem(list.id, "Onion").id);
  S.togglePurchased(findItem(list.id, "Kidney bean").id);
  S.updateItem(findItem(list.id, "Ground beef").id, { qtyText: "3" });

  // Menu changes: chili doubled, tacos removed, pasta added.
  S.updateMeal(chiliMeal.id, { servings: 8 });
  S.removeMeal(S.getDb().meals.find((m) => m.recipeId === tacos.id).id);
  S.addMeal({ date: "2026-11-06", meal: "dinner", recipeId: pasta.id, servings: 4 });
  assert.equal(S.isListOutdated(list.id), true);

  const preview = S.previewRegenerate(list.id);
  assert.equal(preview.changes.significant, true);
  assert.equal(S.listItems(list.id).length, 6, "preview must not change the list");
  const changes = S.applyRegenerate(list.id);

  assert.ok(findItem(list.id, "Paper towel") || S.listItems(list.id).some((i) => i.id === towels.id), "manual item kept");
  assert.ok(S.listItems(list.id).some((i) => i.id === apples.id));
  assert.equal(changes.manualKept, 2);
  const tortilla = findItem(list.id, "Tortilla");
  assert.equal(tortilla.purchased, true, "purchased item no longer needed is kept");
  assert.equal(tortilla.stale, true);
  const beef = findItem(list.id, "Ground beef");
  assert.equal(beef.qty, 3, "user-edited quantity preserved");
  assert.equal(beef.genQty, 3);
  assert.ok(changes.conflicts.length >= 1);
  const onion = findItem(list.id, "Onion");
  assert.equal(onion.qty, 2, "chili x2 needs 2 onions (down from 3)");
  assert.equal(onion.purchased, true, "need went down, so the purchase still covers it");
  const beans = findItem(list.id, "Kidney bean");
  assert.equal(beans.qty, 2);
  assert.equal(beans.purchased, false, "needed amount went up past what was bought");
  assert.equal(beans.boughtQty, 1);
  assert.ok(findItem(list.id, "Spaghetti"));
  assert.ok(changes.added.some((i) => i.name === "Spaghetti"));
  assert.equal(S.isListOutdated(list.id), false);

  // Unchanged ingredients keep their purchased status on a no-op regenerate.
  S.togglePurchased(findItem(list.id, "Spaghetti").id);
  const again = S.applyRegenerate(list.id);
  assert.equal(findItem(list.id, "Spaghetti").purchased, true);
  assert.equal(again.significant, false);
});

test("clearing completed items hides generated purchases so a regenerate doesn't re-add them", () => {
  fresh();
  const r = recipe("Pasta", 4, [ing("1", "lb", "spaghetti"), ing("1", "jar", "marinara sauce")]);
  S.addMeal({ date: MON, meal: "dinner", recipeId: r.id, servings: 4 });
  const { list } = S.createListForWeek(MON);
  const extra = S.quickAddItem(list.id, "milk");
  S.togglePurchased(findItem(list.id, "Spaghetti").id);
  S.togglePurchased(extra.id);
  assert.equal(S.clearCompleted(list.id), 2);
  assert.equal(S.listItems(list.id).some((i) => i.id === extra.id), false);
  S.applyRegenerate(list.id);
  const sp = findItem(list.id, "Spaghetti");
  assert.equal(sp.cleared, true);
  assert.equal(sp.purchased, true);
});

test("changing an item's category can be remembered in the ingredient catalog", () => {
  fresh();
  const r = recipe("Snack", 2, [ing("1", "bag", "pretzels")]);
  S.addMeal({ date: MON, meal: "lunch", recipeId: r.id });
  const { list } = S.createListForWeek(MON);
  const it = findItem(list.id, "Pretzel");
  S.updateItem(it.id, { category: "pantry", rememberCategory: true });
  assert.equal(S.getDb().ingredients.length, 1);
  assert.equal(S.getDb().ingredients[0].category, "pantry");
  S.applyRegenerate(list.id);
  assert.equal(findItem(list.id, "Pretzel").category, "pantry");
});

// ---------- Pantry ----------
test("pantry: flag mode marks items you have; subtract mode deducts compatible quantities", () => {
  fresh();
  const r = recipe("Bake", 4, [ing("3", "cup", "flour"), ing("2", "tbsp", "olive oil"), ing("1", "tsp", "salt")]);
  S.addMeal({ date: MON, meal: "dinner", recipeId: r.id, servings: 4 });
  S.quickAddPantry("salt");
  S.quickAddPantry("1 cup flour");
  S.quickAddPantry("Extra virgin olive oil");
  let { list } = S.createListForWeek(MON);
  assert.equal(findItem(list.id, "Salt").inPantry, true);
  assert.equal(findItem(list.id, "Olive oil").inPantry, true, "synonyms resolve");
  assert.equal(findItem(list.id, "Flour").inPantry, true);

  S.updateSettings({ pantryMode: "subtract" });
  S.applyRegenerate(list.id);
  const flour = findItem(list.id, "Flour");
  assert.equal(flour.inPantry, false);
  assert.equal(flour.qty, 2, "3 cups needed - 1 cup on hand");

  S.updateSettings({ pantryMode: "off" });
  S.applyRegenerate(list.id);
  assert.equal(findItem(list.id, "Salt").inPantry, false);
  assert.equal(findItem(list.id, "Flour").qty, 3);
});

test("ingredient catalog: aliases resolve, duplicates are rejected, learn from recipes", () => {
  fresh();
  const g = S.createIngredient({ name: "Scallions", aliases: "green onions, spring onions", category: "produce" });
  assert.throws(() => S.createIngredient({ name: "green onion" }), /already in your catalog/);
  const r = recipe("Soup", 4, [ing("2", "", "spring onions"), ing("1", "", "scallion"), ing("2", "cup", "chicken broth")]);
  S.addMeal({ date: MON, meal: "dinner", recipeId: r.id, servings: 4 });
  const { list } = S.createListForWeek(MON);
  const sc = findItem(list.id, "Scallions");
  assert.equal(sc.qty, 3);
  assert.equal(sc.ingredientId, g.id);
  assert.equal(S.learnFromRecipes(), 1);
  assert.ok(S.getDb().ingredients.some((x) => x.name === "Chicken broth" && x.category === "pantry"));
});

// ---------- Starter recipes ----------
test("starter recipes parse cleanly and produce a sensible combined list", () => {
  fresh();
  const added = S.addRecipes(D.starterRecipes());
  assert.ok(added.length >= 8);
  added.forEach((r) => r.ingredients.forEach((g) => assert.ok(g.name && !/^\d/.test(g.name), r.name + ": " + g.name)));
  const tacos = added.find((r) => r.name === "Beef Tacos");
  const bolo = added.find((r) => r.name === "Spaghetti Bolognese");
  S.addMeal({ date: MON, meal: "dinner", recipeId: tacos.id, servings: 4 });
  S.addMeal({ date: WED, meal: "dinner", recipeId: bolo.id, servings: 6 });
  const { list } = S.createListForWeek(MON);
  const beef = findItem(list.id, "Ground beef");
  assert.equal(beef.qty, 2); assert.equal(beef.unit, "lb");
  const garlic = findItem(list.id, "Garlic");
  assert.equal(garlic.qty, 5); assert.equal(garlic.unit, "clove");
});

// ---------- Backup & restore ----------
test("acceptance: backup slice round-trips with integrity verification and keeps sibling apps", async () => {
  fresh();
  const r = recipe("Chili", 4, [ing("1", "lb", "ground beef")], { imageId: "img1" });
  S.addMeal({ date: MON, meal: "dinner", recipeId: r.id });
  const { list } = S.createListForWeek(MON);
  S.togglePurchased(S.listItems(list.id)[0].id);
  S.updateSettings({ measurement: "metric" });
  const images = { img1: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" };

  const slice = await Y.createSlice(S.getDb(), { theme: "twilight", images, revision: 7, device: "Test" });
  const unified = Y.createBackupData(slice, { schema: "kashikoi-app-backup-v1", apps: { arcus: { appName: "Arcus", goals: [1] } } });
  assert.ok(unified.apps.arcus, "sibling slices are preserved");
  const restored = await Y.readBackup(JSON.parse(JSON.stringify(unified)));
  assert.equal(restored.integrity, "verified");
  assert.equal(restored.theme, "twilight");
  assert.equal(restored.meta.revision, 7);
  assert.equal(restored.db.recipes[0].imageId, "img1");
  assert.equal(restored.images.img1, images.img1);
  assert.equal(restored.db.items[0].purchased, true);
  assert.equal(restored.db.settings.measurement, "metric");
  assert.deepEqual(restored.meta.counts, { recipes: 1, archived: 0, menus: 1, meals: 1, lists: 1, items: 1, ingredients: 0, pantry: 0, photos: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(restored.db)), JSON.parse(JSON.stringify(S.getDb())));

  const tampered = JSON.parse(JSON.stringify(unified));
  tampered.apps.velum.recipes[0].name = "Evil";
  await assert.rejects(Y.readBackup(tampered), (e) => e.code === "integrity");

  const badImg = JSON.parse(JSON.stringify(slice));
  delete badImg.checksum;
  badImg.images.img1 = "javascript:alert(1)";
  const r2 = await Y.readBackup(badImg);
  assert.equal(r2.rejectedImages, 1);
  assert.equal(r2.db.recipes[0].imageId, null, "unsafe photos are dropped");
  await assert.rejects(Y.readBackup({ schema: "kashikoi-app-backup-v1", apps: { arcus: {} } }), (e) => e.code === "no-data");
});

test("encrypted cloud save merges, verifies, and only the right phrase decrypts", async () => {
  fresh();
  recipe("Chili", 4, [ing("1", "lb", "ground beef")]);
  const kv = new Map();
  const fakeFetch = async (url, init) => {
    const key = url.split("/sync/")[1].split("?")[0];
    if (init && init.method === "PUT") {
      const body = JSON.parse(init.body);
      assert.equal(body.app, "Nimbus");
      assert.equal(body.writtenBy, "Velum");
      assert.ok(!init.body.includes("Chili"), "no plaintext leaves the device");
      kv.set(key, JSON.stringify(Object.assign(body, { storedAt: "now" })));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (!kv.has(key)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(kv.get(key)) };
  };
  const phrase = Y.createRecoveryPhrase();
  assert.equal(phrase.split(" ").length, 16);
  // A sibling app already saved under this phrase.
  const sibling = await Y.encrypt(phrase, { schema: "kashikoi-app-backup-v1", apps: { virga: { appName: "Virga", parts: [], orders: [] } } });
  kv.set(await Y.syncKey(phrase), JSON.stringify(sibling));

  const slice = await Y.createSlice(S.getDb(), { theme: "day", images: {}, revision: 1 });
  const res = await Y.saveToCloud(phrase, slice, fakeFetch);
  assert.ok(res.bytes > 0);
  const loaded = await Y.loadFromCloud(phrase, fakeFetch);
  assert.ok(loaded.data.apps.virga, "sibling app data preserved");
  const back = await Y.readBackup(loaded.data);
  assert.equal(back.db.recipes[0].name, "Chili");
  assert.equal(back.integrity, "verified");
  assert.equal(await Y.loadFromCloud(Y.createRecoveryPhrase(), fakeFetch), null, "unknown phrase finds nothing");
  const other = Y.createRecoveryPhrase();
  kv.set(await Y.syncKey(other), kv.get(await Y.syncKey(phrase)));
  await assert.rejects(Y.loadFromCloud(other, fakeFetch), (e) => e.code === "decrypt");
});

test("normalizeDb repairs dangling references from damaged data", () => {
  const db = M.normalizeDb({
    recipes: [{ id: "r1", name: "A", servings: 2 }],
    meals: [{ id: "m1", date: MON, meal: "dinner", recipeId: "gone" }, { id: "m2", date: MON, meal: "lunch", recipeId: "r1" }],
    lists: [{ id: "l1", menuId: "nope" }], items: [{ id: "i1", listId: "l1", name: "x" }, { id: "i2", listId: "zzz", name: "y" }],
    menus: [{ id: "a", weekStart: MON }, { id: "b", weekStart: MON }],
  });
  assert.equal(db.meals.find((m) => m.id === "m1").title, "Deleted recipe");
  assert.equal(db.lists[0].menuId, null);
  assert.equal(db.items.length, 1);
  assert.equal(db.menus.length, 1);
});

// ---------- Regressions from review ----------
test("catalog edits don't duplicate or uncheck items already on a list", () => {
  fresh();
  const r = recipe("Soup", 4, [ing("2", "", "shallots"), ing("1", "cup", "flour"), ing("1", "cup", "milk")]);
  S.addMeal({ date: MON, meal: "dinner", recipeId: r.id, servings: 4 });
  const { list } = S.createListForWeek(MON);
  S.togglePurchased(findItem(list.id, "Shallot").id);
  S.togglePurchased(findItem(list.id, "Flour").id);
  S.updateItem(findItem(list.id, "Shallot").id, { category: "pantry", rememberCategory: true });
  S.learnFromRecipes();
  S.updateIngredient(S.getDb().ingredients.find((g) => g.name === "Flour").id, { name: "Flour", category: "pantry", gramsPerCup: 120 });
  const ch = S.applyRegenerate(list.id);
  const items = S.listItems(list.id);
  assert.equal(items.length, 3, "no duplicates");
  assert.equal(ch.stale.length, 0);
  assert.equal(findItem(list.id, "Shallot").purchased, true);
  assert.equal(findItem(list.id, "Shallot").key.startsWith("i:"), true, "re-keyed to the catalog entry");
  assert.equal(findItem(list.id, "Flour").unit, "g");
});

test("pantry subtraction note is generated, not a user note", () => {
  fresh();
  S.updateSettings({ pantryMode: "subtract" });
  S.quickAddPantry("1/2 cup milk");
  const r = recipe("Latte", 2, [ing("1", "cup", "milk")]);
  const m = S.addMeal({ date: MON, meal: "breakfast", recipeId: r.id, servings: 2 });
  const { list } = S.createListForWeek(MON);
  const milk = findItem(list.id, "Milk");
  assert.equal(milk.note, "");
  assert.match(milk.pantryNote, /in pantry/);
  S.removeMeal(m.id);
  const ch = S.applyRegenerate(list.id);
  assert.equal(ch.removed.length, 1);
  assert.equal(ch.stale.length, 0);
});

test("toggling the first day of the week is lossless", () => {
  fresh();
  S.renameMenu(MON, "Thanksgiving prep");
  S.updateSettings({ weekStartsOn: 0 });
  S.updateSettings({ weekStartsOn: 1 });
  assert.equal(S.getDb().menus[0].weekStart, MON);
});

test("arrange moves items within their visible section", () => {
  fresh();
  const l = S.createList("Run");
  const a = S.quickAddItem(l.id, "apples");
  S.quickAddItem(l.id, "milk");
  const b = S.quickAddItem(l.id, "bananas");
  S.moveItem(b.id, -1);
  const produce = S.listItems(l.id).filter((i) => i.category === "produce").map((i) => i.name);
  assert.deepEqual(produce, ["bananas", "apples"]);
  void a;
});

test("replaceDb is all-or-nothing when storage is full", () => {
  const st = fresh();
  recipe("Keep me", 2, []);
  st.setItem = () => { throw new Error("quota"); };
  assert.throws(() => S.replaceDb(M.emptyDb()), S.ValidationError);
  assert.equal(S.getDb().recipes.length, 1);
});
