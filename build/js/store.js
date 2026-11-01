/* Velum — application services & persistence. Every mutation goes through here: validate, keep
   relationships consistent (recipes referenced by the plan are archived, never erased), persist, notify. */
(function (V) {
  "use strict";
  const U = V.util;
  const Un = V.units;
  const M = V.model;
  const P = V.planner;

  const STORE_KEY = "velum_cloud_data";
  let db = M.emptyDb();
  let storage = null;
  const listeners = [];

  class ValidationError extends Error {}
  function fail(msg) { throw new ValidationError(msg); }

  function init(opts) {
    storage = (opts && opts.storage) || (typeof localStorage !== "undefined" ? localStorage : null);
    load();
  }
  function load() {
    let raw = null;
    try { raw = storage ? JSON.parse(storage.getItem(STORE_KEY) || "null") : null; } catch (e) { raw = null; }
    db = M.normalizeDb(raw);
  }
  function persist() {
    if (!storage) return;
    try { storage.setItem(STORE_KEY, JSON.stringify(db)); }
    catch (e) { throw new ValidationError("Couldn't save — browser storage may be full."); }
  }
  function commit(opts) {
    if (!(opts && opts.quiet)) db.meta.modifiedAt = now();
    persist();
    listeners.forEach((fn) => { try { fn(); } catch (e) { /* listener errors must not break saves */ } });
  }
  function onChange(fn) { listeners.push(fn); }
  // All-or-nothing: if it can't be persisted, the previous data stays in memory and the error is thrown.
  function replaceDb(next) {
    const prev = db;
    db = M.normalizeDb(next);
    try { persist(); } catch (e) { db = prev; throw e; }
    listeners.forEach((fn) => { try { fn(); } catch (err) { /* listener errors must not break saves */ } });
  }
  function getDb() { return db; }
  function now() { return new Date().toISOString(); }
  function find(list, id, what) { const x = db[list].find((o) => o.id === id); if (!x) fail("That " + what + " no longer exists."); return x; }
  function nextSort(list) { return list.length ? Math.max.apply(null, list.map((x) => x.sortOrder)) + 1 : 0; }

  // ---------- Settings ----------
  function updateSettings(patch) {
    db.settings = M.normalizeSettings(Object.assign({}, db.settings, patch));
    commit();
  }

  // ---------- Recipes ----------
  function validateRecipe(f) {
    if (!U.str(f.name, 160)) fail("Give the recipe a name.");
    const servings = U.numOrNull(f.servings);
    if (servings == null || servings <= 0) fail("Servings must be a number greater than zero.");
    ["prepMin", "cookMin", "totalMin"].forEach((k) => {
      const n = U.numOrNull(f[k]);
      if (f[k] !== "" && f[k] != null && (n == null || n < 0)) fail("Times must be zero or more minutes.");
    });
    (f.ingredients || []).forEach((g) => {
      if (g.qtyText && Un.parseQuantity(g.qtyText) == null) fail("Couldn't read the quantity \"" + g.qtyText + "\" for " + (g.name || "an ingredient") + ". Try 1, 1.5, 1/2 or 1 1/2.");
    });
  }
  function recipeFields(f) {
    return {
      name: f.name, description: f.description, imageId: f.imageId || null, categories: f.categories, cuisine: f.cuisine,
      prepMin: f.prepMin, cookMin: f.cookMin, totalMin: f.totalMin, servings: f.servings, difficulty: f.difficulty,
      tags: Array.isArray(f.tags) ? f.tags : String(f.tags || "").split(","),
      ingredients: (f.ingredients || []).filter((g) => U.str(g.name)).map((g, i) => ({
        id: g.id, ingredientId: g.ingredientId, name: g.name, qty: g.qtyText !== undefined ? Un.parseQuantity(g.qtyText) : g.qty,
        unit: g.unit, prep: g.prep, group: g.group, optional: g.optional, sortOrder: i,
      })),
      steps: (f.steps || []).map((s) => (typeof s === "string" ? { text: s } : s)),
      notes: f.notes, sourceUrl: f.sourceUrl, favorite: f.favorite,
    };
  }
  function createRecipe(f) {
    validateRecipe(f);
    const r = M.normalizeRecipe(Object.assign(recipeFields(f), { createdAt: now(), updatedAt: now() }));
    db.recipes.push(r);
    commit();
    return r;
  }
  function updateRecipe(id, f) {
    const r = find("recipes", id, "recipe");
    validateRecipe(f);
    const next = M.normalizeRecipe(Object.assign({}, r, recipeFields(f), { id: r.id, createdAt: r.createdAt, updatedAt: now(), lastUsedAt: r.lastUsedAt, archived: r.archived }));
    db.recipes[db.recipes.indexOf(r)] = next;
    commit();
    return next;
  }
  function duplicateRecipe(id) {
    const r = find("recipes", id, "recipe");
    const copy = JSON.parse(JSON.stringify(r));
    delete copy.id;
    copy.name = r.name + " (copy)";
    copy.favorite = false;
    copy.archived = false;
    copy.lastUsedAt = null;
    copy.createdAt = copy.updatedAt = now();
    copy.ingredients.forEach((g) => { delete g.id; });
    copy.steps.forEach((s) => { delete s.id; });
    const n = M.normalizeRecipe(copy);
    db.recipes.push(n);
    commit();
    return n;
  }
  function toggleFavorite(id) {
    const r = find("recipes", id, "recipe");
    r.favorite = !r.favorite;
    commit();
    return r.favorite;
  }
  function recipeUsage(id) { return db.meals.filter((m) => m.recipeId === id); }
  // Recipes still referenced by the plan are archived, not erased.
  function deleteRecipe(id) {
    const r = find("recipes", id, "recipe");
    if (recipeUsage(id).length) {
      r.archived = true;
      r.favorite = false;
      r.updatedAt = now();
      commit();
      return { archived: true, imageId: null };
    }
    db.recipes = db.recipes.filter((x) => x.id !== id);
    commit();
    return { archived: false, imageId: r.imageId };
  }
  function restoreRecipe(id) {
    const r = find("recipes", id, "recipe");
    r.archived = false;
    r.updatedAt = now();
    commit();
  }

  // ---------- Menus & meals ----------
  function ensureMenu() {
    let m = P.menuForPlan(db);
    if (!m) {
      m = M.normalizeMenu({ createdAt: now(), updatedAt: now() });
      db.menus.push(m);
    }
    return m;
  }
  function renameMenu(name) {
    const m = ensureMenu();
    m.name = U.str(name, 80);
    m.updatedAt = now();
    commit();
  }
  function touchPlan() { const m = ensureMenu(); m.updatedAt = now(); }
  function markUsed(recipeId) {
    const r = db.recipes.find((x) => x.id === recipeId);
    if (r) r.lastUsedAt = now();
  }
  function validateSlot(day, meal) {
    if (!M.isPlanDay(day)) fail("Pick a day from Saturday through the following Saturday.");
    if (M.MEAL_TYPES.indexOf(meal) < 0) fail("Pick breakfast, lunch or dinner.");
  }
  function addMeal(f) {
    validateSlot(f.day, f.meal);
    if (f.recipeId) {
      const r = find("recipes", f.recipeId, "recipe");
      if (r.archived) fail("That recipe is archived. Restore it from the library first.");
    } else if (!U.str(f.title)) fail("Pick a recipe or type a short note like \"Leftovers\".");
    const servings = U.numOrNull(f.servings) || db.settings.servings[f.meal];
    const meal = M.normalizeMeal({
      day: f.day, meal: f.meal, recipeId: f.recipeId || null, title: f.recipeId ? "" : f.title,
      servings, note: f.note, sortOrder: nextSort(P.slotMeals(db, f.day, f.meal)),
    });
    db.meals.push(meal);
    if (meal.recipeId) markUsed(meal.recipeId);
    touchPlan();
    commit();
    return meal;
  }
  function updateMeal(id, patch) {
    const m = find("meals", id, "meal");
    const p = Object.assign({}, patch);
    const day = p.day !== undefined ? p.day : m.day;
    const meal = p.meal !== undefined ? p.meal : m.meal;
    validateSlot(day, meal);
    if (p.recipeId !== undefined) {
      if (p.recipeId) {
        const r = find("recipes", p.recipeId, "recipe");
        if (r.archived) fail("That recipe is archived.");
        m.recipeId = r.id;
        m.title = "";
        markUsed(r.id);
      } else {
        if (!U.str(p.title !== undefined ? p.title : m.title)) fail("Type a short note or pick a recipe.");
        m.recipeId = null;
      }
    }
    if (p.title !== undefined && !m.recipeId) m.title = U.str(p.title, 160) || m.title;
    if (p.servings !== undefined) {
      const s = U.numOrNull(p.servings);
      if (s == null || s <= 0) fail("Servings must be greater than zero.");
      m.servings = U.clamp(s, 0.25, 500);
    }
    if (p.note !== undefined) m.note = U.str(p.note, 500);
    if (p.done !== undefined) m.done = !!p.done;
    if (p.day !== undefined || p.meal !== undefined) {
      if (day !== m.day || meal !== m.meal) {
        m.day = day; m.meal = meal;
        m.sortOrder = nextSort(P.slotMeals(db, day, meal).filter((x) => x.id !== m.id));
      }
    }
    touchPlan();
    commit();
    return m;
  }
  function moveMeal(id, day, meal) { return updateMeal(id, { day, meal }); }
  function copyMeal(id, day, meal) {
    const m = find("meals", id, "meal");
    validateSlot(day, meal);
    const c = M.normalizeMeal(Object.assign({}, m, { id: undefined, day, meal, done: false, sortOrder: nextSort(P.slotMeals(db, day, meal)) }));
    db.meals.push(c);
    touchPlan();
    commit();
    return c;
  }
  function removeMeal(id) {
    const m = find("meals", id, "meal");
    db.meals = db.meals.filter((x) => x.id !== id);
    touchPlan();
    commit();
    return m;
  }
  function toggleMealDone(id) {
    const m = find("meals", id, "meal");
    m.done = !m.done;
    commit();
    return m.done;
  }
  // mode "replace" clears the target first; "merge" appends.
  function copyDay(fromDay, toDay, mode) {
    if (!M.isPlanDay(fromDay) || !M.isPlanDay(toDay)) fail("Pick a day from the plan.");
    if (fromDay === toDay) fail("Pick a different day to copy to.");
    const src = db.meals.filter((m) => m.day === fromDay);
    if (!src.length) fail("There's nothing planned on that day to copy.");
    if (mode === "replace") db.meals = db.meals.filter((m) => m.day !== toDay);
    src.forEach((m) => {
      db.meals.push(M.normalizeMeal(Object.assign({}, m, { id: undefined, day: toDay, done: false, sortOrder: nextSort(P.slotMeals(db, toDay, m.meal)) })));
    });
    touchPlan();
    commit();
    return src.length;
  }
  function clearDay(day) {
    if (!M.isPlanDay(day)) fail("Pick a day from the plan.");
    const n = db.meals.filter((m) => m.day === day).length;
    db.meals = db.meals.filter((m) => m.day !== day);
    touchPlan();
    commit();
    return n;
  }
  function clearPlan() {
    const n = db.meals.length;
    db.meals = [];
    touchPlan();
    commit();
    return n;
  }

  // ---------- Shopping lists ----------
  function listItems(listId) { return db.items.filter((i) => i.listId === listId).sort((a, b) => a.sortOrder - b.sortOrder); }
  function listForMenu(menuId) { return db.lists.find((l) => l.menuId === menuId) || null; }
  function createList(name) {
    const l = M.normalizeList({ name: U.str(name, 80) || "Shopping list", createdAt: now(), updatedAt: now() });
    db.lists.push(l);
    commit();
    return l;
  }
  // Creates (or returns) the list attached to the reusable plan.
  function createListForPlan() {
    const menu = ensureMenu();
    let l = listForMenu(menu.id);
    if (l) return { list: l, created: false };
    l = M.normalizeList({ menuId: menu.id, name: menu.name || "Menu shopping list", createdAt: now(), updatedAt: now() });
    db.lists.push(l);
    const generated = P.generateForPlan(db);
    const res = P.reconcile([], generated, l.id);
    db.items = db.items.concat(res.items);
    l.generatedAt = now();
    l.signature = P.signature(generated);
    commit();
    return { list: l, created: true, changes: res.changes };
  }
  function menuForList(l) {
    return l.menuId ? db.menus.find((m) => m.id === l.menuId) || null : null;
  }
  // Dry run of regenerating a list from its menu (nothing is saved).
  function previewRegenerate(listId) {
    const l = find("lists", listId, "shopping list");
    if (!menuForList(l)) fail("This list isn't linked to the menu plan.");
    const generated = P.generateForPlan(db);
    return Object.assign(P.reconcile(listItems(listId), generated, listId), { signature: P.signature(generated) });
  }
  function applyRegenerate(listId) {
    const l = find("lists", listId, "shopping list");
    const res = previewRegenerate(listId);
    db.items = db.items.filter((i) => i.listId !== listId).concat(res.items);
    l.generatedAt = now();
    l.updatedAt = now();
    l.signature = res.signature;
    commit();
    return res.changes;
  }
  function isListOutdated(listId) {
    const l = db.lists.find((x) => x.id === listId);
    if (!l || !menuForList(l)) return false;
    return P.signature(P.generateForPlan(db)) !== l.signature;
  }
  function renameList(id, name) {
    const l = find("lists", id, "shopping list");
    if (!U.str(name)) fail("Give the list a name.");
    l.name = U.str(name, 80);
    l.updatedAt = now();
    commit();
  }
  function deleteList(id) {
    find("lists", id, "shopping list");
    db.lists = db.lists.filter((l) => l.id !== id);
    db.items = db.items.filter((i) => i.listId !== id);
    commit();
  }
  function setListStatus(id, status) {
    const l = find("lists", id, "shopping list");
    l.status = status === "done" ? "done" : "active";
    l.updatedAt = now();
    commit();
  }

  // ---------- Shopping items ----------
  function addItem(listId, f) {
    find("lists", listId, "shopping list");
    const name = U.str(f.name, 160);
    if (!name) fail("Type an item name.");
    const qty = f.qtyText !== undefined ? (U.str(f.qtyText) ? Un.parseQuantity(f.qtyText) : null) : f.qty;
    if (f.qtyText && qty == null) fail("Couldn't read that quantity. Try 2, 1.5 or 1/2.");
    const it = M.normalizeItem({
      listId, name, qty, unit: f.unit, category: f.category || Un.guessCategory(name, Un.normalizeUnit(f.unit)), note: f.note,
      manual: true, sortOrder: nextSort(listItems(listId)),
    });
    db.items.push(it);
    touchList(listId);
    commit();
    return it;
  }
  // Quick add: "2 lb apples" / "paper towels".
  function quickAddItem(listId, text) {
    const p = Un.parseIngredientLine(text);
    if (!p) fail("Type an item name.");
    return addItem(listId, { name: p.name, qty: p.qty, unit: p.unit, note: p.prep === "to taste" ? "" : p.prep });
  }
  function touchList(listId) { const l = db.lists.find((x) => x.id === listId); if (l) l.updatedAt = now(); }
  function updateItem(id, f) {
    const it = find("items", id, "item");
    if (f.name !== undefined) {
      const name = U.str(f.name, 160);
      if (!name) fail("Type an item name.");
      if (name !== it.name) { it.name = name; it.nameEdited = !it.manual; }
    }
    if (f.qtyText !== undefined || f.unit !== undefined) {
      const qty = f.qtyText !== undefined ? (U.str(f.qtyText) ? Un.parseQuantity(f.qtyText) : null) : it.qty;
      if (f.qtyText && qty == null) fail("Couldn't read that quantity. Try 2, 1.5 or 1/2.");
      const unit = f.unit !== undefined ? Un.normalizeUnit(f.unit) : it.unit;
      if (qty !== it.qty || unit !== it.unit) {
        it.qty = qty; it.unit = unit;
        if (!it.manual) it.qtyEdited = !(qty === it.genQty && unit === it.genUnit);
        it.change = "";
      }
    }
    if (f.category !== undefined && f.category !== it.category) {
      if (M.GROCERY_CATEGORIES.indexOf(f.category) < 0) fail("Pick a grocery category.");
      it.category = f.category;
      it.categoryEdited = !it.manual;
      if (f.rememberCategory) rememberCategory(it.name, f.category, it.ingredientId);
    }
    if (f.note !== undefined) it.note = U.str(f.note, 300);
    touchList(it.listId);
    commit();
    return it;
  }
  function resetItemToMenu(id) {
    const it = find("items", id, "item");
    if (it.manual) return it;
    it.qty = it.genQty; it.unit = it.genUnit; it.qtyEdited = false; it.change = "";
    commit();
    return it;
  }
  function togglePurchased(id) {
    const it = find("items", id, "item");
    it.purchased = !it.purchased;
    if (it.purchased) { it.boughtQty = null; it.boughtUnit = ""; it.change = ""; }
    touchList(it.listId);
    commit({ quiet: false });
    return it.purchased;
  }
  function setPantryOverride(id, on) {
    const it = find("items", id, "item");
    it.pantryOverride = !!on;
    commit();
  }
  function deleteItem(id) {
    const it = find("items", id, "item");
    db.items = db.items.filter((x) => x.id !== id);
    touchList(it.listId);
    commit();
    return it;
  }
  function restoreItem(item) {
    db.items.push(M.normalizeItem(item));
    commit();
  }
  // Purchased manual items are removed; purchased generated items are hidden (so a regenerate doesn't re-add them).
  function clearCompleted(listId) {
    let n = 0;
    db.items = db.items.filter((it) => {
      if (it.listId !== listId || !it.purchased || it.cleared) return true;
      n++;
      if (it.manual || it.stale) return false;
      it.cleared = true;
      return true;
    });
    touchList(listId);
    commit();
    return n;
  }
  // Reorders within the section the item is displayed in (same aisle / cart / pantry partition as the view).
  function moveItem(id, delta) {
    const it = find("items", id, "item");
    const st = db.settings;
    const inPantry = (x) => x.inPantry && !x.pantryOverride;
    const cartSection = st.purchased === "bottom";
    const peers = listItems(it.listId).filter((x) => {
      if (x.cleared || inPantry(x) !== inPantry(it)) return false;
      if (cartSection && x.purchased !== it.purchased) return false;
      if (cartSection && it.purchased) return true;
      return st.groupBy !== "category" || x.category === it.category;
    });
    const i = peers.indexOf(it), j = i + delta;
    if (i < 0 || j < 0 || j >= peers.length) return;
    const slots = peers.map((x) => x.sortOrder);
    peers.splice(i, 1);
    peers.splice(j, 0, it);
    peers.forEach((x, k) => { x.sortOrder = slots[k]; });
    commit();
  }

  // ---------- Ingredient catalog ----------
  function validateIngredient(f, exceptId) {
    const name = U.str(f.name, 120);
    if (!name) fail("Give the ingredient a name.");
    const key = Un.normalizeName(name);
    const clash = db.ingredients.find((g) => g.id !== exceptId && [g.name].concat(g.aliases).some((n) => Un.normalizeName(n) === key));
    if (clash) fail("\"" + name + "\" is already in your catalog" + (clash.name.toLowerCase() !== name.toLowerCase() ? " (as " + clash.name + ")" : "") + ".");
    const gpc = U.numOrNull(f.gramsPerCup);
    if (f.gramsPerCup !== "" && f.gramsPerCup != null && (gpc == null || gpc <= 0)) fail("Grams per cup must be a positive number.");
  }
  function ingredientFields(f) {
    return {
      name: f.name, defaultUnit: f.defaultUnit, category: f.category,
      aliases: Array.isArray(f.aliases) ? f.aliases : String(f.aliases || "").split(","),
      gramsPerCup: f.gramsPerCup, notes: f.notes,
    };
  }
  function createIngredient(f) {
    validateIngredient(f, null);
    const g = M.normalizeIngredient(ingredientFields(f));
    db.ingredients.push(g);
    commit();
    return g;
  }
  function updateIngredient(id, f) {
    const g = find("ingredients", id, "ingredient");
    validateIngredient(f, id);
    const next = M.normalizeIngredient(Object.assign({ id }, ingredientFields(f)));
    db.ingredients[db.ingredients.indexOf(g)] = next;
    db.items.forEach((it) => { if (it.ingredientId === id && !it.categoryEdited) it.category = next.category; });
    commit();
    return next;
  }
  function deleteIngredient(id) {
    find("ingredients", id, "ingredient");
    db.ingredients = db.ingredients.filter((g) => g.id !== id);
    const clear = (x) => { if (x.ingredientId === id) x.ingredientId = null; };
    db.recipes.forEach((r) => r.ingredients.forEach(clear));
    db.items.forEach(clear);
    db.pantry.forEach(clear);
    commit();
  }
  function rememberCategory(name, category, ingredientId) {
    const idx = P.catalogIndex(db.ingredients);
    const g = P.resolveIngredient(idx, ingredientId, name);
    if (g) g.category = category;
    else db.ingredients.push(M.normalizeIngredient({ name: Un.displayName(Un.normalizeName(name)) || name, category }));
  }
  // Adds every distinct recipe ingredient that isn't in the catalog yet.
  function learnFromRecipes() {
    const idx = P.catalogIndex(db.ingredients);
    const added = new Map();
    db.recipes.forEach((r) => r.ingredients.forEach((g) => {
      if (Un.isNeverShop(g.name)) return;
      const split = Un.splitUnitFromName(g.name, g.unit);
      const key = Un.normalizeName(split.name);
      if (!key || idx.byName.has(key) || added.has(key)) return;
      added.set(key, M.normalizeIngredient({ name: Un.displayName(key), category: Un.guessCategory(split.name, split.unit), defaultUnit: split.unit }));
    }));
    added.forEach((g) => db.ingredients.push(g));
    if (added.size) commit();
    return added.size;
  }

  // ---------- Pantry ----------
  function addPantry(f) {
    const name = U.str(f.name, 120);
    if (!name) fail("Type what you have.");
    const key = Un.normalizeName(name);
    const existing = db.pantry.find((p) => Un.normalizeName(p.name) === key);
    if (existing) { existing.available = true; existing.updatedAt = now(); commit(); return existing; }
    const qty = f.qtyText !== undefined ? (U.str(f.qtyText) ? Un.parseQuantity(f.qtyText) : null) : (f.qty == null ? null : f.qty);
    if (f.qtyText && qty == null) fail("Couldn't read that quantity.");
    const idx = P.catalogIndex(db.ingredients);
    const ing = P.resolveIngredient(idx, null, name);
    const p = M.normalizePantry({ name, qty, unit: f.unit, available: true, ingredientId: ing ? ing.id : null, updatedAt: now() });
    db.pantry.push(p);
    commit();
    return p;
  }
  function quickAddPantry(text) {
    const p = Un.parseIngredientLine(text);
    if (!p) fail("Type what you have.");
    return addPantry({ name: p.name, qty: p.qty, unit: p.unit });
  }
  function updatePantry(id, f) {
    const p = find("pantry", id, "pantry item");
    if (f.name !== undefined) { if (!U.str(f.name)) fail("Type a name."); p.name = U.str(f.name, 120); }
    if (f.qtyText !== undefined) {
      const qty = U.str(f.qtyText) ? Un.parseQuantity(f.qtyText) : null;
      if (U.str(f.qtyText) && qty == null) fail("Couldn't read that quantity.");
      p.qty = qty;
    }
    if (f.unit !== undefined) p.unit = Un.normalizeUnit(f.unit);
    if (f.available !== undefined) p.available = !!f.available;
    p.updatedAt = now();
    commit();
    return p;
  }
  function deletePantry(id) {
    find("pantry", id, "pantry item");
    db.pantry = db.pantry.filter((p) => p.id !== id);
    commit();
  }

  // ---------- Bulk ----------
  function clearAll() {
    const images = db.recipes.map((r) => r.imageId).filter(Boolean);
    const settings = db.settings;
    db = M.emptyDb();
    db.settings = settings;
    commit();
    return images;
  }
  function addRecipes(list) {
    const added = list.map((f) => M.normalizeRecipe(Object.assign({}, f, { createdAt: now(), updatedAt: now() })));
    db.recipes = db.recipes.concat(added);
    commit();
    return added;
  }

  V.store = {
    STORE_KEY, ValidationError, init, load, onChange, replaceDb, getDb, commit,
    updateSettings,
    createRecipe, updateRecipe, duplicateRecipe, toggleFavorite, deleteRecipe, restoreRecipe, recipeUsage, addRecipes,
    ensureMenu, renameMenu, addMeal, updateMeal, moveMeal, copyMeal, removeMeal, toggleMealDone, copyDay, clearDay, clearPlan,
    listItems, listForMenu, createList, createListForPlan, menuForList, previewRegenerate, applyRegenerate, isListOutdated,
    renameList, deleteList, setListStatus,
    addItem, quickAddItem, updateItem, resetItemToMenu, togglePurchased, setPantryOverride, deleteItem, restoreItem, clearCompleted, moveItem,
    createIngredient, updateIngredient, deleteIngredient, learnFromRecipes,
    addPantry, quickAddPantry, updatePantry, deletePantry,
    clearAll,
  };
})(typeof window !== "undefined" ? window.Velum : globalThis.Velum);
