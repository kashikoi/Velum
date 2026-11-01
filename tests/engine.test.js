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
const MON = "monday";
const WED = "wednesday";

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

test("deleting a recipe in the plan archives it instead of erasing planned meals", () => {
  fresh();
  const r = recipe("Chili", 4, [ing("1", "lb", "ground beef")]);
  const unused = recipe("Soup", 4, []);
  S.addMeal({ day: MON, meal: "dinner", recipeId: r.id });
  assert.equal(S.deleteRecipe(r.id).archived, true);
  assert.equal(S.getDb().recipes.find((x) => x.id === r.id).archived, true);
  assert.equal(S.getDb().meals[0].recipeId, r.id);
  assert.throws(() => S.addMeal({ day: WED, meal: "dinner", recipeId: r.id }), /archived/);
  assert.equal(S.deleteRecipe(unused.id).archived, false);
  assert.equal(S.getDb().recipes.length, 1);
});

// ---------- Reusable planning ----------
test("acceptance: eight-day plan and servings persist across reloads", () => {
  const st = fresh();
  const b = recipe("Oats", 2, [ing("1", "cup", "oats")], { categories: ["breakfast"] });
  const l = recipe("Salad", 2, [ing("1", "head", "lettuce")], { categories: ["lunch"] });
  const d = recipe("Chili", 4, [ing("1", "lb", "ground beef")]);
  M.PLAN_DAYS.forEach((day) => {
    S.addMeal({ day, meal: "breakfast", recipeId: b.id });
    S.addMeal({ day, meal: "lunch", recipeId: l.id });
  });
  const dinner = S.addMeal({ day: MON, meal: "dinner", recipeId: d.id });
  assert.equal(dinner.servings, 4, "defaults to the dinner serving setting");
  S.updateMeal(dinner.id, { servings: 6 });
  S.addMeal({ day: "following-saturday", meal: "dinner", title: "Dinner out" });

  S.load(); // simulate a reload from storage
  assert.ok(st._m.get(S.STORE_KEY).length > 10);
  const stats = P.planStats(S.getDb());
  assert.equal(stats.filled, 18);
  assert.equal(stats.slots, 24);
  assert.equal(stats.unplanned, 6);
  assert.equal(S.getDb().meals.find((m) => m.id === dinner.id).servings, 6);
  assert.equal(P.slotMeals(S.getDb(), "following-saturday", "dinner").length, 1);
  assert.equal(S.getDb().menus.length, 1);
  assert.ok(S.getDb().meals.every((m) => !("date" in m)));
  assert.ok(S.getDb().recipes.find((r) => r.id === d.id).lastUsedAt);
});

test("copy and move meals between named days, clear individual days and the whole plan", () => {
  fresh();
  const r = recipe("Chili", 4, [ing("1", "lb", "ground beef")]);
  const m = S.addMeal({ day: MON, meal: "dinner", recipeId: r.id, servings: 4 });
  S.addMeal({ day: MON, meal: "lunch", title: "Leftovers" });
  S.moveMeal(m.id, WED, "lunch");
  assert.equal(S.getDb().meals.find((x) => x.id === m.id).day, WED);
  S.copyMeal(m.id, MON, "dinner");
  assert.equal(S.copyDay(MON, "following-saturday", "replace"), 2);
  assert.equal(S.clearDay("following-saturday"), 2);
  assert.equal(P.slotMeals(S.getDb(), MON, "dinner").length, 1, "clearing one day leaves other days intact");
  assert.throws(() => S.copyDay(MON, MON), /different day/);
  assert.throws(() => S.addMeal({ day: MON, meal: "brunch", title: "x" }), S.ValidationError);
  const count = S.getDb().meals.length;
  assert.equal(S.clearPlan(), count);
  assert.equal(S.getDb().meals.length, 0);
  assert.equal(S.getDb().recipes.length, 1);
});

test("the plan has one stable menu and shopping list independent of old week settings", () => {
  fresh();
  S.renameMenu("Family meals");
  const { list } = S.createListForPlan();
  S.updateSettings({ weekStartsOn: 0 });
  const db = S.getDb();
  assert.equal(db.menus.length, 1);
  assert.equal(db.menus[0].name, "Family meals");
  assert.equal("weekStart" in db.menus[0], false);
  assert.equal("weekStartsOn" in db.settings, false);
  assert.equal(db.lists.find((l) => l.id === list.id).menuId, db.menus[0].id);
});

// ---------- Shopping lists ----------
test("acceptance: spec example consolidates ground beef, onions and olive oil", () => {
  fresh();
  const mon = recipe("Monday dinner", 4, [ing("1", "lb", "ground beef"), ing("2", "", "onions"), ing("1", "tbsp", "olive oil")]);
  const wed = recipe("Wednesday dinner", 4, [ing("1.5", "lb", "ground beef"), ing("1", "", "onion"), ing("2", "tbsp", "olive oil")]);
  S.addMeal({ day: MON, meal: "dinner", recipeId: mon.id, servings: 4 });
  S.addMeal({ day: WED, meal: "dinner", recipeId: wed.id, servings: 4 });
  const { list } = S.createListForPlan();
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
  const m = S.addMeal({ day: MON, meal: "dinner", recipeId: r.id, servings: 6 });
  const { list } = S.createListForPlan();
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
  S.addMeal({ day: MON, meal: "dinner", recipeId: tacos.id, servings: 4 });
  const chiliMeal = S.addMeal({ day: WED, meal: "dinner", recipeId: chili.id, servings: 4 });
  const { list } = S.createListForPlan();
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
  S.addMeal({ day: "friday", meal: "dinner", recipeId: pasta.id, servings: 4 });
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
  S.addMeal({ day: MON, meal: "dinner", recipeId: r.id, servings: 4 });
  const { list } = S.createListForPlan();
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
  S.addMeal({ day: MON, meal: "lunch", recipeId: r.id });
  const { list } = S.createListForPlan();
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
  S.addMeal({ day: MON, meal: "dinner", recipeId: r.id, servings: 4 });
  S.quickAddPantry("salt");
  S.quickAddPantry("1 cup flour");
  S.quickAddPantry("Extra virgin olive oil");
  let { list } = S.createListForPlan();
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
  S.addMeal({ day: MON, meal: "dinner", recipeId: r.id, servings: 4 });
  const { list } = S.createListForPlan();
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
  S.addMeal({ day: MON, meal: "dinner", recipeId: tacos.id, servings: 4 });
  S.addMeal({ day: WED, meal: "dinner", recipeId: bolo.id, servings: 6 });
  const { list } = S.createListForPlan();
  const beef = findItem(list.id, "Ground beef");
  assert.equal(beef.qty, 2); assert.equal(beef.unit, "lb");
  const garlic = findItem(list.id, "Garlic");
  assert.equal(garlic.qty, 5); assert.equal(garlic.unit, "clove");
});

// ---------- Backup & restore ----------
test("acceptance: backup slice round-trips with integrity verification and keeps sibling apps", async () => {
  fresh();
  const r = recipe("Chili", 4, [ing("1", "lb", "ground beef")], { imageId: "img1" });
  S.addMeal({ day: MON, meal: "dinner", recipeId: r.id });
  const { list } = S.createListForPlan();
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
    meals: [{ id: "m1", day: MON, meal: "dinner", recipeId: "gone" }, { id: "m2", day: MON, meal: "lunch", recipeId: "r1" }],
    lists: [{ id: "l1", menuId: "nope" }], items: [{ id: "i1", listId: "l1", name: "x" }, { id: "i2", listId: "zzz", name: "y" }],
    menus: [{ id: "a", weekStart: "2026-11-02" }, { id: "b", weekStart: "2026-11-02" }],
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
  S.addMeal({ day: MON, meal: "dinner", recipeId: r.id, servings: 4 });
  const { list } = S.createListForPlan();
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
  const m = S.addMeal({ day: MON, meal: "breakfast", recipeId: r.id, servings: 2 });
  const { list } = S.createListForPlan();
  const milk = findItem(list.id, "Milk");
  assert.equal(milk.note, "");
  assert.match(milk.pantryNote, /in pantry/);
  S.removeMeal(m.id);
  const ch = S.applyRegenerate(list.id);
  assert.equal(ch.removed.length, 1);
  assert.equal(ch.stale.length, 0);
});

test("renaming the reusable plan retains meals and the shopping link", () => {
  fresh();
  S.addMeal({ day: "saturday", meal: "dinner", title: "Pizza" });
  const { list } = S.createListForPlan();
  S.renameMenu("Family favorites");
  assert.equal(S.getDb().menus[0].name, "Family favorites");
  assert.equal(S.getDb().meals[0].day, "saturday");
  assert.equal(list.menuId, S.getDb().menus[0].id);
});

test("both Saturdays remain independent in shopping quantities and verified backups", async () => {
  fresh();
  const r = recipe("Pasta", 2, [ing("1", "lb", "pasta")]);
  S.addMeal({ day: "saturday", meal: "dinner", recipeId: r.id, servings: 2 });
  const { list } = S.createListForPlan();
  const pasta = findItem(list.id, "Pasta");
  S.togglePurchased(pasta.id);
  S.addMeal({ day: "following-saturday", meal: "dinner", recipeId: r.id, servings: 4 });
  assert.equal(P.planStats(S.getDb()).filled, 2);
  assert.equal(S.isListOutdated(list.id), true);
  S.applyRegenerate(list.id);
  assert.equal(findItem(list.id, "Pasta").qty, 3);
  assert.equal(findItem(list.id, "Pasta").purchased, false, "increased quantities uncheck the purchase");
  assert.deepEqual(findItem(list.id, "Pasta").sources.map((s) => s.day), ["saturday", "following-saturday"]);
  const restored = await Y.readBackup(await Y.createSlice(S.getDb()));
  assert.equal(restored.integrity, "verified");
  assert.deepEqual(restored.db.meals.map((m) => m.day), ["saturday", "following-saturday"]);
  assert.deepEqual(restored.db.items[0].sources.map((s) => s.day), ["saturday", "following-saturday"]);
  S.clearDay("saturday");
  assert.equal(P.slotMeals(S.getDb(), "following-saturday", "dinner").length, 1);
});

test("a complete 24-slot plan does not roll over when the calendar advances", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-07T12:00:00Z") });
  fresh();
  M.PLAN_DAYS.forEach((day) => M.MEAL_TYPES.forEach((meal) => S.addMeal({ day, meal, title: "Family meal" })));
  const before = JSON.parse(JSON.stringify(S.getDb()));
  t.mock.timers.tick(100 * U.DAY_MS);
  S.load();
  assert.deepEqual(S.getDb(), before);
  assert.equal(P.planStats(S.getDb()).filled, 24);
  assert.equal(P.planStats(S.getDb()).unplanned, 0);
  assert.equal(S.getDb().menus.length, 1);
});

test("dated meal inputs are rejected rather than silently creating new weeks", () => {
  fresh();
  assert.throws(() => S.addMeal({ day: "2026-11-07", meal: "dinner", title: "Pizza" }), S.ValidationError);
  assert.throws(() => S.addMeal({ date: "2026-11-07", meal: "dinner", title: "Pizza" }), S.ValidationError);
  const m = S.addMeal({ day: "saturday", meal: "dinner", title: "Pizza" });
  assert.throws(() => S.updateMeal(m.id, { day: "invalid", title: "Changed" }), S.ValidationError);
  assert.equal(m.title, "Pizza", "invalid day must fail before editing the meal");
  assert.throws(() => S.copyMeal(m.id, "2026-11-14", "dinner"), S.ValidationError);
  assert.throws(() => S.copyDay("saturday", "2026-11-14"), S.ValidationError);
  assert.throws(() => S.clearDay("2026-11-14"), S.ValidationError);
});

test("schema v1 migration preserves dated meals, recipes, lists and purchase checks", async () => {
  const legacy = {
    schemaVersion: 1, settings: { weekStartsOn: 1 }, ingredients: [], pantry: [],
    recipes: [{ id: "recipe1", name: "Pasta", servings: 2 }],
    menus: [{ id: "menu1", weekStart: "2026-11-02" }, { id: "menu2", weekStart: "2026-11-09" }],
    meals: [
      { id: "meal1", date: "2026-11-07", meal: "dinner", recipeId: "recipe1", servings: 2 },
      { id: "meal2", date: "2026-11-14", meal: "dinner", recipeId: "recipe1", servings: 4 },
      { id: "meal3", date: "2026-11-08", meal: "lunch", title: "Leftovers" },
    ],
    lists: [{ id: "list1", menuId: "menu1" }, { id: "list2", menuId: "menu2" }],
    items: [{
      id: "item1", listId: "list2", name: "Pasta", purchased: true, qtyEdited: true, qty: 3,
      sources: [{ mealId: "meal2", recipeId: "recipe1", recipe: "Pasta", date: "2026-11-14", meal: "dinner" }],
    }],
  };
  const st = memStorage();
  st.setItem(S.STORE_KEY, JSON.stringify(legacy));
  S.init({ storage: st });
  const db = S.getDb();
  assert.equal(db.schemaVersion, 2);
  assert.equal(db.menus.length, 1);
  assert.equal(db.meals.length, 3);
  assert.deepEqual(db.meals.map((m) => m.day), ["saturday", "saturday", "sunday"]);
  assert.deepEqual(db.meals.slice(0, 2).map((m) => m.sortOrder), [0, 1]);
  assert.ok(db.lists.every((l) => l.menuId === "menu1"));
  assert.equal(db.items[0].purchased, true);
  assert.equal(db.items[0].qtyEdited, true);
  assert.equal(db.items[0].sources[0].day, "saturday");
  assert.ok(db.meals.every((m) => !("date" in m)));
  S.commit();
  S.load();
  assert.deepEqual(S.getDb(), db, "migration remains stable after saving and reloading");
  const oldSlice = await Y.createSlice(legacy);
  const restored = await Y.readBackup(oldSlice);
  assert.equal(restored.integrity, "verified", "old checksum is verified before migration");
  assert.equal(restored.db.schemaVersion, 2);
  assert.deepEqual(restored.db.meals.map((m) => m.day), db.meals.map((m) => m.day));
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
