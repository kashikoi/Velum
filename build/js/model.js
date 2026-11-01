/* Velum — domain model: constants, entity shapes and normalization (also used to validate restored backups). */
(function (V) {
  "use strict";
  const U = V.util;
  const Un = V.units;

  const SCHEMA_VERSION = 2;
  const PLAN_DAYS = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "following-saturday"];
  const DAY_LABEL = {
    saturday: "Saturday", sunday: "Sunday", monday: "Monday", tuesday: "Tuesday",
    wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", "following-saturday": "Saturday",
  };
  function isPlanDay(day) { return PLAN_DAYS.indexOf(day) >= 0; }
  function legacyDay(date) {
    return U.isISODate(date) ? PLAN_DAYS[(U.parseDate(date).getDay() + 1) % 7] : "saturday";
  }

  const MEAL_TYPES = ["breakfast", "lunch", "dinner"];
  const MEAL_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
  const MEAL_ICON = { breakfast: "🥣", lunch: "🥪", dinner: "🍲" };

  const RECIPE_CATEGORIES = ["breakfast", "lunch", "dinner", "snack", "dessert", "other"];
  const CATEGORY_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack", dessert: "Dessert", other: "Other" };
  const CATEGORY_ICON = { breakfast: "🥞", lunch: "🥗", dinner: "🍝", snack: "🥨", dessert: "🍰", other: "🍴" };
  const DIFFICULTIES = ["easy", "medium", "hard"];
  const DIFFICULTY_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };

  const GROCERY_CATEGORIES = ["produce", "meat", "dairy", "bakery", "pantry", "frozen", "beverages", "spices", "household", "other"];
  const GROCERY_LABEL = {
    produce: "Produce", meat: "Meat & Seafood", dairy: "Dairy & Eggs", bakery: "Bakery", pantry: "Pantry", frozen: "Frozen",
    beverages: "Beverages", spices: "Spices & Seasonings", household: "Household", other: "Other",
  };
  const GROCERY_ICON = { produce: "🥬", meat: "🥩", dairy: "🧀", bakery: "🥖", pantry: "🥫", frozen: "🧊", beverages: "🧃", spices: "🧂", household: "🧻", other: "🛍️" };

  function defaultSettings() {
    return {
      servings: { breakfast: 2, lunch: 2, dinner: 4 },
      measurement: "us",
      groupBy: "category",
      categoryOrder: GROCERY_CATEGORIES.slice(),
      purchased: "bottom",
      includeOptional: true,
      pantryMode: "flag",
      autoBackup: false,
      cloudPhotos: true,
    };
  }
  function emptyDb() {
    return {
      schemaVersion: SCHEMA_VERSION,
      settings: defaultSettings(),
      recipes: [], menus: [], meals: [], lists: [], items: [], ingredients: [], pantry: [], occasional: [],
      meta: { modifiedAt: null },
    };
  }

  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const oneOf = (v, list, dflt) => (list.indexOf(v) >= 0 ? v : dflt);
  const ts = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
  const posNum = (v, dflt) => { const n = U.numOrNull(v); return n != null && n > 0 ? n : dflt; };
  const nonNeg = (v) => { const n = U.numOrNull(v); return n != null && n >= 0 ? n : null; };
  const id = (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : U.uid());

  function normalizeSettings(s) {
    const o = obj(s), d = defaultSettings(), sv = obj(o.servings);
    const order = arr(o.categoryOrder).filter((c) => GROCERY_CATEGORIES.indexOf(c) >= 0);
    GROCERY_CATEGORIES.forEach((c) => { if (order.indexOf(c) < 0) order.push(c); });
    return {
      servings: {
        breakfast: U.clamp(Math.round(posNum(sv.breakfast, d.servings.breakfast)), 1, 50),
        lunch: U.clamp(Math.round(posNum(sv.lunch, d.servings.lunch)), 1, 50),
        dinner: U.clamp(Math.round(posNum(sv.dinner, d.servings.dinner)), 1, 50),
      },
      measurement: oneOf(o.measurement, ["us", "metric"], d.measurement),
      groupBy: oneOf(o.groupBy, ["category", "none"], d.groupBy),
      categoryOrder: Array.from(new Set(order)),
      purchased: oneOf(o.purchased, ["bottom", "inline", "hide"], d.purchased),
      includeOptional: o.includeOptional === undefined ? d.includeOptional : !!o.includeOptional,
      pantryMode: oneOf(o.pantryMode, ["off", "flag", "subtract"], d.pantryMode),
      autoBackup: !!o.autoBackup,
      cloudPhotos: o.cloudPhotos === undefined ? d.cloudPhotos : !!o.cloudPhotos,
    };
  }

  function normalizeRecipeIngredient(x, i) {
    const o = obj(x);
    return {
      id: id(o.id),
      ingredientId: typeof o.ingredientId === "string" && o.ingredientId ? o.ingredientId : null,
      name: U.str(o.name, 160),
      qty: nonNeg(o.qty),
      unit: Un.normalizeUnit(o.unit),
      prep: U.str(o.prep, 160),
      group: U.str(o.group, 60),
      optional: !!o.optional,
      sortOrder: Number.isFinite(+o.sortOrder) ? +o.sortOrder : i,
    };
  }
  function normalizeRecipe(x) {
    const o = obj(x);
    const now = new Date().toISOString();
    const cats = Array.from(new Set(arr(o.categories).filter((c) => RECIPE_CATEGORIES.indexOf(c) >= 0)));
    const ings = arr(o.ingredients).map(normalizeRecipeIngredient).filter((g) => g.name).sort((a, b) => a.sortOrder - b.sortOrder);
    ings.forEach((g, i) => { g.sortOrder = i; });
    const steps = arr(o.steps).map((s) => (typeof s === "string" ? { text: s } : obj(s)))
      .map((s) => ({ id: id(s.id), text: U.str(s.text, 4000) })).filter((s) => s.text);
    return {
      id: id(o.id),
      name: U.str(o.name, 160) || "Untitled recipe",
      description: U.str(o.description, 2000),
      imageId: typeof o.imageId === "string" && o.imageId ? o.imageId : null,
      categories: cats.length ? cats : ["other"],
      cuisine: U.str(o.cuisine, 60),
      prepMin: nonNeg(o.prepMin),
      cookMin: nonNeg(o.cookMin),
      totalMin: nonNeg(o.totalMin),
      servings: U.clamp(posNum(o.servings, 4), 0.25, 500),
      difficulty: oneOf(o.difficulty, DIFFICULTIES, ""),
      tags: Array.from(new Set(arr(o.tags).map((t) => U.str(t, 40).toLowerCase()).filter(Boolean))).slice(0, 30),
      ingredients: ings,
      steps,
      notes: U.str(o.notes, 4000),
      sourceUrl: /^https?:\/\//i.test(String(o.sourceUrl || "")) ? U.str(o.sourceUrl, 500) : "",
      favorite: !!o.favorite,
      archived: !!o.archived,
      createdAt: ts(o.createdAt) || now,
      updatedAt: ts(o.updatedAt) || ts(o.createdAt) || now,
      lastUsedAt: ts(o.lastUsedAt),
    };
  }
  function totalTime(r) {
    if (r.totalMin) return r.totalMin;
    return (r.prepMin || 0) + (r.cookMin || 0) || null;
  }

  function normalizeMenu(x) {
    const o = obj(x);
    const now = new Date().toISOString();
    return {
      id: id(o.id),
      name: U.str(o.name, 80),
      notes: U.str(o.notes, 1000),
      createdAt: ts(o.createdAt) || now,
      updatedAt: ts(o.updatedAt) || now,
    };
  }
  function normalizeMeal(x, i) {
    const o = obj(x);
    return {
      id: id(o.id),
      day: isPlanDay(o.day) ? o.day : legacyDay(o.date),
      meal: oneOf(o.meal, MEAL_TYPES, "dinner"),
      recipeId: typeof o.recipeId === "string" && o.recipeId ? o.recipeId : null,
      title: U.str(o.title, 160),
      servings: U.clamp(posNum(o.servings, 2), 0.25, 500),
      note: U.str(o.note, 500),
      done: !!o.done,
      sortOrder: Number.isFinite(+o.sortOrder) ? +o.sortOrder : i,
    };
  }
  function normalizeList(x) {
    const o = obj(x);
    const now = new Date().toISOString();
    return {
      id: id(o.id),
      menuId: typeof o.menuId === "string" && o.menuId ? o.menuId : null,
      name: U.str(o.name, 80) || "Shopping list",
      status: oneOf(o.status, ["active", "done"], "active"),
      createdAt: ts(o.createdAt) || now,
      updatedAt: ts(o.updatedAt) || now,
      generatedAt: ts(o.generatedAt),
      signature: typeof o.signature === "string" ? o.signature.slice(0, 200) : "",
    };
  }
  function normalizeSource(s) {
    const o = obj(s);
    return { mealId: U.str(o.mealId, 40), recipeId: U.str(o.recipeId, 40), recipe: U.str(o.recipe, 160), day: isPlanDay(o.day) ? o.day : legacyDay(o.date), meal: oneOf(o.meal, MEAL_TYPES, "") };
  }
  function normalizeItem(x, i) {
    const o = obj(x);
    return {
      id: id(o.id),
      listId: U.str(o.listId, 40),
      key: typeof o.key === "string" ? o.key.slice(0, 240) : "",
      norm: U.str(o.norm, 160),
      pantryNote: U.str(o.pantryNote, 160),
      ingredientId: typeof o.ingredientId === "string" && o.ingredientId ? o.ingredientId : null,
      name: U.str(o.name, 160) || "Item",
      qty: nonNeg(o.qty),
      unit: Un.normalizeUnit(o.unit),
      category: oneOf(o.category, GROCERY_CATEGORIES, "other"),
      note: U.str(o.note, 300),
      purchased: !!o.purchased,
      manual: !!o.manual,
      optional: !!o.optional,
      toTaste: !!o.toTaste,
      qtyEdited: !!o.qtyEdited,
      nameEdited: !!o.nameEdited,
      categoryEdited: !!o.categoryEdited,
      genQty: nonNeg(o.genQty),
      genUnit: Un.normalizeUnit(o.genUnit),
      boughtQty: nonNeg(o.boughtQty),
      boughtUnit: Un.normalizeUnit(o.boughtUnit),
      stale: !!o.stale,
      cleared: !!o.cleared,
      inPantry: !!o.inPantry,
      pantryOverride: !!o.pantryOverride,
      change: U.str(o.change, 200),
      sources: arr(o.sources).slice(0, 60).map(normalizeSource),
      sortOrder: Number.isFinite(+o.sortOrder) ? +o.sortOrder : i,
    };
  }
  function normalizeIngredient(x) {
    const o = obj(x);
    return {
      id: id(o.id),
      name: U.str(o.name, 120) || "Ingredient",
      defaultUnit: Un.normalizeUnit(o.defaultUnit),
      category: oneOf(o.category, GROCERY_CATEGORIES, "other"),
      aliases: Array.from(new Set(arr(o.aliases).map((a) => U.str(a, 120)).filter(Boolean))).slice(0, 30),
      gramsPerCup: (() => { const n = nonNeg(o.gramsPerCup); return n ? n : null; })(),
      notes: U.str(o.notes, 1000),
    };
  }
  function normalizePantry(x) {
    const o = obj(x);
    return {
      id: id(o.id),
      ingredientId: typeof o.ingredientId === "string" && o.ingredientId ? o.ingredientId : null,
      name: U.str(o.name, 120) || "Item",
      qty: nonNeg(o.qty),
      unit: Un.normalizeUnit(o.unit),
      available: o.available === undefined ? true : !!o.available,
      updatedAt: ts(o.updatedAt) || new Date().toISOString(),
    };
  }
  function normalizeOccasional(x, i) {
    const o = obj(x);
    return {
      id: id(o.id),
      name: U.str(o.name, 160) || "Item",
      qty: (() => { const n = nonNeg(o.qty); return n ? n : null; })(),
      unit: Un.normalizeUnit(o.unit),
      category: oneOf(o.category, GROCERY_CATEGORIES, "other"),
      note: U.str(o.note, 300),
      sortOrder: Number.isFinite(+o.sortOrder) ? +o.sortOrder : i || 0,
    };
  }

  // Legacy dated menus become one reusable plan; all meal assignments and shopping items are retained.
  function normalizeDb(raw) {
    const o = obj(raw);
    const db = {
      schemaVersion: SCHEMA_VERSION,
      settings: normalizeSettings(o.settings),
      recipes: arr(o.recipes).map(normalizeRecipe),
      menus: arr(o.menus).map(normalizeMenu),
      meals: arr(o.meals).map(normalizeMeal),
      lists: arr(o.lists).map(normalizeList),
      items: arr(o.items).map(normalizeItem),
      ingredients: arr(o.ingredients).map(normalizeIngredient),
      pantry: arr(o.pantry).map(normalizePantry),
      occasional: arr(o.occasional).map(normalizeOccasional),
      meta: { modifiedAt: ts(obj(o.meta).modifiedAt) },
    };
    const dedupe = (list) => { const seen = new Set(); return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))); };
    ["recipes", "menus", "meals", "lists", "items", "ingredients", "pantry", "occasional"].forEach((k) => { db[k] = dedupe(db[k]); });
    if (!db.menus.length && db.meals.length) db.menus.push(normalizeMenu({}));
    const menu = db.menus[0];
    const previousMenuIds = new Set(db.menus.map((m) => m.id));
    db.lists.forEach((l) => { if (menu && previousMenuIds.has(l.menuId)) l.menuId = menu.id; });
    db.menus = menu ? [menu] : [];
    if (+o.schemaVersion < SCHEMA_VERSION || o.schemaVersion === undefined) {
      const slots = new Map();
      db.meals.forEach((m) => {
        const key = m.day + ":" + m.meal;
        m.sortOrder = slots.get(key) || 0;
        slots.set(key, m.sortOrder + 1);
      });
    }
    const recipeIds = new Set(db.recipes.map((r) => r.id));
    const ingIds = new Set(db.ingredients.map((g) => g.id));
    const menuIds = new Set(db.menus.map((m) => m.id));
    const listIds = new Set(db.lists.map((l) => l.id));
    db.meals.forEach((m) => { if (m.recipeId && !recipeIds.has(m.recipeId)) { m.title = m.title || "Deleted recipe"; m.recipeId = null; } });
    db.meals = db.meals.filter((m) => m.recipeId || m.title);
    db.lists.forEach((l) => { if (l.menuId && !menuIds.has(l.menuId)) l.menuId = null; });
    db.items = db.items.filter((it) => listIds.has(it.listId));
    const fixIng = (x) => { if (x.ingredientId && !ingIds.has(x.ingredientId)) x.ingredientId = null; };
    db.items.forEach(fixIng);
    db.pantry.forEach(fixIng);
    db.recipes.forEach((r) => r.ingredients.forEach(fixIng));
    return db;
  }

  V.model = {
    SCHEMA_VERSION, PLAN_DAYS, DAY_LABEL, isPlanDay, legacyDay, MEAL_TYPES, MEAL_LABEL, MEAL_ICON, RECIPE_CATEGORIES, CATEGORY_LABEL, CATEGORY_ICON,
    DIFFICULTIES, DIFFICULTY_LABEL, GROCERY_CATEGORIES, GROCERY_LABEL, GROCERY_ICON,
    defaultSettings, emptyDb, normalizeSettings, normalizeRecipe, normalizeRecipeIngredient, normalizeMenu, normalizeMeal,
    normalizeList, normalizeItem, normalizeIngredient, normalizePantry, normalizeOccasional, normalizeDb, totalTime,
  };
})(typeof window !== "undefined" ? window.Velum : globalThis.Velum);
