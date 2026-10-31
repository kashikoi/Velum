/* Velum — planning engine: recipe scaling, ingredient aggregation, pantry matching and shopping-list
   reconciliation. Pure functions (db in, data out); the store applies the results. */
(function (V) {
  "use strict";
  const U = V.util;
  const Un = V.units;
  const M = V.model;

  // ---------- Scaling ----------
  function scaleFactor(recipe, servings) {
    const base = recipe && recipe.servings > 0 ? recipe.servings : 1;
    return servings > 0 ? servings / base : 1;
  }
  function scaledIngredients(recipe, servings) {
    const f = scaleFactor(recipe, servings);
    return recipe.ingredients.map((g) => Object.assign({}, g, { qty: g.qty == null ? null : g.qty * f }));
  }

  // ---------- Weeks ----------
  function weekOf(db, iso) { return U.weekStartFor(iso, db.settings.weekStartsOn); }
  function menuForWeek(db, weekStart) { return db.menus.find((m) => m.weekStart === weekStart) || null; }
  function mealsInRange(db, startIso, days) {
    const end = U.addDays(startIso, days);
    return db.meals.filter((m) => m.date >= startIso && m.date < end);
  }
  function mealsForWeek(db, weekStart) { return mealsInRange(db, weekStart, 7); }
  function slotMeals(db, date, meal) {
    return db.meals.filter((m) => m.date === date && m.meal === meal).sort((a, b) => a.sortOrder - b.sortOrder);
  }
  function weekStats(db, weekStart) {
    const meals = mealsForWeek(db, weekStart);
    let filled = 0;
    U.weekDates(weekStart).forEach((d) => M.MEAL_TYPES.forEach((t) => { if (meals.some((m) => m.date === d && m.meal === t)) filled++; }));
    return { meals: meals.length, filled, slots: 21, unplanned: 21 - filled, done: meals.filter((m) => m.done).length };
  }

  // ---------- Ingredient identity ----------
  // Resolves an ingredient (by id, then catalog name/alias match) for consistent keys and categories.
  function catalogIndex(ingredients) {
    const byId = new Map(), byName = new Map();
    ingredients.forEach((g) => {
      byId.set(g.id, g);
      [g.name].concat(g.aliases || []).forEach((n) => { const k = Un.normalizeName(n); if (k && !byName.has(k)) byName.set(k, g); });
    });
    return { byId, byName };
  }
  function resolveIngredient(idx, ingredientId, name) {
    if (ingredientId && idx.byId.has(ingredientId)) return idx.byId.get(ingredientId);
    return idx.byName.get(Un.normalizeName(name)) || null;
  }
  function nameKeyFor(idx, ingredientId, name, unit) {
    const split = Un.splitUnitFromName(name, unit);
    const ing = resolveIngredient(idx, ingredientId, split.name);
    return { ing, key: ing ? "i:" + ing.id : "n:" + Un.normalizeName(split.name), name: split.name, unit: split.unit };
  }

  // ---------- Requirements ----------
  // Every scaled ingredient line needed by the meals in [weekStart, +7d).
  function requirementsForWeek(db, weekStart, opts) {
    const o = opts || {};
    const includeOptional = o.includeOptional !== undefined ? o.includeOptional : db.settings.includeOptional;
    const recipes = new Map(db.recipes.map((r) => [r.id, r]));
    const out = [];
    mealsForWeek(db, weekStart).forEach((meal) => {
      const r = meal.recipeId && recipes.get(meal.recipeId);
      if (!r) return;
      scaledIngredients(r, meal.servings).forEach((g) => {
        if (g.optional && !includeOptional) return;
        if (Un.isNeverShop(g.name)) return;
        out.push({
          name: g.name, qty: g.qty, unit: g.unit, ingredientId: g.ingredientId, optional: g.optional,
          source: { mealId: meal.id, recipeId: r.id, recipe: r.name, date: meal.date, meal: meal.meal },
        });
      });
    });
    return out;
  }

  // ---------- Aggregation ----------
  // Consolidates requirement lines into shopping entries. Lines merge only when they're the same ingredient
  // AND their quantities are compatible (volume+volume, weight+weight, same count unit, or volume->weight via
  // the catalog's gramsPerCup). Anything else stays a separate entry rather than being guessed.
  function aggregate(lines, ingredients, system) {
    const idx = catalogIndex(ingredients || []);
    const groups = new Map();
    lines.forEach((line) => {
      const ident = nameKeyFor(idx, line.ingredientId, line.name, line.unit);
      let unit = ident.unit;
      let dim = Un.dimOf(unit);
      let qty = line.qty;
      if (qty != null && dim === "volume" && ident.ing && ident.ing.gramsPerCup) {
        qty = (Un.toBase(qty, unit) / Un.UNITS.cup.f) * ident.ing.gramsPerCup;
        unit = "g"; dim = "mass";
      }
      const part = qty == null ? "taste" : dim === "count" ? "count:" + unit : dim;
      const key = ident.key + "|" + part;
      let g = groups.get(key);
      if (!g) {
        g = { key, nameKey: ident.key, part, dim, ing: ident.ing, names: new Map(), units: new Set(), base: 0, sources: [], optional: true, toTaste: qty == null };
        groups.set(key, g);
      }
      g.names.set(ident.name, (g.names.get(ident.name) || 0) + 1);
      if (qty != null) { g.base += dim === "count" ? qty : Un.toBase(qty, unit); g.units.add(unit); }
      g.optional = g.optional && !!line.optional;
      if (line.source && !g.sources.some((s) => s.mealId === line.source.mealId && s.recipeId === line.source.recipeId)) g.sources.push(line.source);
    });
    // "to taste" lines fold into a measured entry of the same ingredient when one exists.
    groups.forEach((g, key) => {
      if (g.part !== "taste") return;
      const host = Array.from(groups.values()).find((h) => h !== g && h.nameKey === g.nameKey && h.part !== "taste");
      if (!host) return;
      host.toTaste = true;
      g.sources.forEach((s) => { if (!host.sources.some((x) => x.mealId === s.mealId && x.recipeId === s.recipeId)) host.sources.push(s); });
      host.optional = host.optional && g.optional;
      groups.delete(key);
    });
    const out = [];
    groups.forEach((g) => {
      let qty = null, unit = "";
      if (g.part !== "taste") {
        if (g.dim === "count") {
          unit = g.part.slice(6);
          qty = Math.ceil(g.base - 1e-6); // you can't buy 1.5 onions
          if (qty === 0) qty = 1;
        } else if (g.units.size === 1) {
          unit = Array.from(g.units)[0];
          qty = U.round(g.base / Un.UNITS[unit].f, 3);
        } else {
          const sys = pickSystem(g.units, system);
          unit = Un.bestUnit(g.dim, g.base, sys);
          qty = U.round(g.base / Un.UNITS[unit].f, 3);
        }
      }
      const rawName = topName(g.names);
      const name = g.ing ? g.ing.name : Un.displayName(Un.normalizeName(rawName)) || rawName;
      out.push({
        key: g.key, norm: Un.normalizeName(rawName), ingredientId: g.ing ? g.ing.id : null, name, qty, unit,
        category: g.ing ? g.ing.category : Un.guessCategory(rawName, unit),
        optional: g.optional, toTaste: g.toTaste && qty == null ? true : g.toTaste,
        sources: g.sources,
      });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  function topName(names) {
    let best = "", n = -1;
    names.forEach((c, k) => { if (c > n) { best = k; n = c; } });
    return best;
  }
  function pickSystem(units, preferred) {
    let us = 0, metric = 0;
    units.forEach((u) => { const s = Un.unitInfo(u).sys; if (s === "us") us++; else if (s === "metric") metric++; });
    if (us && !metric) return "us";
    if (metric && !us) return "metric";
    return preferred || "us";
  }

  // ---------- Pantry ----------
  // flag: items you already have are moved to an "Already in pantry" section; subtract: known quantities are
  // deducted first (only when units are compatible) and fully-covered items are flagged.
  function applyPantry(entries, pantry, ingredients, mode) {
    if (mode === "off" || !pantry.length) return entries;
    const idx = catalogIndex(ingredients || []);
    const have = new Map();
    pantry.filter((p) => p.available).forEach((p) => {
      const ident = nameKeyFor(idx, p.ingredientId, p.name, p.unit);
      if (!have.has(ident.key)) have.set(ident.key, []);
      have.get(ident.key).push(Object.assign({}, p, { unit: ident.unit || p.unit }));
    });
    return entries.map((e) => {
      const nameKey = e.key.split("|")[0];
      const stock = have.get(nameKey);
      if (!stock) return e;
      const out = Object.assign({}, e);
      if (mode === "subtract" && e.qty != null) {
        const measured = stock.find((p) => p.qty != null && compatible(p.unit, e.unit));
        if (measured) {
          const need = baseOf(e.qty, e.unit) - baseOf(measured.qty, measured.unit);
          if (need > 1e-6) {
            out.qty = Un.dimOf(e.unit) === "count" ? Math.ceil(need - 1e-6) : U.round(toUnit(need, e.unit), 3);
            out.pantryNote = "after " + Un.formatAmount(measured.qty, measured.unit) + " in pantry";
            return out;
          }
        }
      }
      out.inPantry = true;
      return out;
    });
  }
  function baseOf(qty, unit) { return Un.dimOf(unit) === "count" ? qty : Un.toBase(qty, unit); }
  function toUnit(base, unit) { return Un.dimOf(unit) === "count" ? base : base / Un.UNITS[unit].f; }
  function compatible(a, b) {
    const da = Un.dimOf(a), db = Un.dimOf(b);
    if (da === "count" || db === "count") return a === b;
    return da === db;
  }

  function generateForWeek(db, weekStart, opts) {
    const lines = requirementsForWeek(db, weekStart, opts);
    const entries = aggregate(lines, db.ingredients, db.settings.measurement);
    return applyPantry(entries, db.pantry, db.ingredients, db.settings.pantryMode);
  }
  // A cheap fingerprint of what the menu currently requires; used to tell when a list is out of date.
  function signature(entries) {
    const s = entries.map((e) => e.key + "=" + (e.qty == null ? "-" : U.round(e.qty, 3)) + e.unit + (e.inPantry ? "p" : "")).sort().join(";");
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return entries.length + ":" + h.toString(36);
  }

  // ---------- Reconciliation ----------
  // Merges a freshly generated set of entries into a list's existing items without losing the user's work:
  // manual items are untouched; purchased status survives unless the needed amount went up; user-edited
  // quantities are kept (with a note); items no longer needed are removed only if nothing about them was
  // user-touched — otherwise they're kept and marked "no longer on the menu".
  function reconcile(existing, generated, listId) {
    const changes = { added: [], updated: [], removed: [], stale: [], conflicts: [], unpurchased: [], unchanged: 0, manualKept: 0 };
    const next = [];
    const genByKey = new Map(generated.map((g) => [g.key, g]));
    // Pair items with entries: exact key first, then the same ingredient under a new key (catalog edits change
    // keys: n:name -> i:id, volume -> mass with a density) so purchases/edits carry over instead of duplicating.
    const pair = new Map();
    const seen = new Set();
    existing.forEach((it) => {
      if (it.manual) return;
      const g = pair.get(it.id);
      if (g && !seen.has(g.key)) { pair.set(it.id, g); seen.add(g.key); }
    });
    existing.forEach((it) => {
      if (it.manual || pair.has(it.id)) return;
      const g = generated.find((x) => !seen.has(x.key) && sameIngredient(it, x));
      if (g) { pair.set(it.id, g); seen.add(g.key); }
    });
    let maxSort = existing.reduce((m, it) => Math.max(m, it.sortOrder), -1);

    existing.forEach((it0) => {
      const it = Object.assign({}, it0, { sources: it0.sources.slice() });
      if (it.manual) { changes.manualKept++; next.push(it); return; }
      const g = pair.get(it.id);
      if (!g) {
        if (it.purchased || it.qtyEdited || it.note || it.nameEdited) {
          if (!it.stale) changes.stale.push(it);
          it.stale = true;
          it.change = "No longer on the menu";
          next.push(it);
        } else {
          changes.removed.push(it);
        }
        return;
      }
      it.key = g.key;
      it.norm = g.norm || it.norm;
      it.pantryNote = g.pantryNote || "";
      const qtyChanged = !sameQty(it.genQty, g.qty) || it.genUnit !== g.unit;
      const pantryChanged = !!it.inPantry !== !!g.inPantry;
      const wasStale = it.stale;
      it.sources = g.sources.map((s) => Object.assign({}, s));
      it.optional = g.optional;
      it.toTaste = g.toTaste;
      it.ingredientId = g.ingredientId;
      it.inPantry = !!g.inPantry;
      it.stale = false;
      if (!it.categoryEdited) it.category = g.category;
      if (!it.nameEdited) it.name = g.name;
      if (qtyChanged) {
        const fromTxt = Un.formatAmount(it.genQty, it.genUnit) || "to taste";
        const toTxt = Un.formatAmount(g.qty, g.unit) || "to taste";
        if (it.qtyEdited) {
          it.change = "Menu now needs " + toTxt + " (was " + fromTxt + ") — kept your edit";
          changes.conflicts.push({ item: it, from: fromTxt, to: toTxt });
        } else {
          const increased = more(g.qty, g.unit, it.qty, it.unit);
          if (it.purchased && increased) {
            it.purchased = false;
            it.boughtQty = it.qty;
            it.boughtUnit = it.unit;
            changes.unpurchased.push(it);
          }
          if (it.cleared && increased) it.cleared = false;
          it.qty = g.qty;
          it.unit = g.unit;
          it.change = (increased ? "Increased" : "Changed") + " from " + fromTxt + " to " + toTxt;
          changes.updated.push({ item: it, from: fromTxt, to: toTxt, increased });
        }
        it.genQty = g.qty;
        it.genUnit = g.unit;
      } else if (wasStale) {
        it.change = "Back on the menu";
        changes.updated.push({ item: it, from: "not needed", to: Un.formatAmount(g.qty, g.unit) || "to taste", increased: true });
      } else if (pantryChanged) {
        changes.updated.push({ item: it, from: "", to: it.inPantry ? "in pantry" : "needed", increased: !it.inPantry });
      } else {
        changes.unchanged++;
      }
      next.push(it);
    });

    generated.forEach((g) => {
      if (seen.has(g.key)) return;
      const it = M.normalizeItem({
        listId, key: g.key, ingredientId: g.ingredientId, name: g.name, qty: g.qty, unit: g.unit, category: g.category,
        optional: g.optional, toTaste: g.toTaste, genQty: g.qty, genUnit: g.unit, inPantry: !!g.inPantry,
        norm: g.norm, pantryNote: g.pantryNote || "", sources: g.sources, sortOrder: ++maxSort,
      });
      next.push(it);
      changes.added.push(it);
    });
    changes.significant = changes.added.length + changes.updated.length + changes.removed.length + changes.stale.length + changes.conflicts.length > 0;
    return { items: next, changes };
  }
  function itemNorm(it) { return it.norm || (it.key.indexOf("n:") === 0 ? it.key.slice(2).split("|")[0] : ""); }
  function partFamily(key) {
    const part = String(key).split("|")[1] || "";
    return part === "volume" || part === "mass" ? "measure" : part;
  }
  function sameIngredient(it, g) {
    const sameId = it.ingredientId && g.ingredientId && it.ingredientId === g.ingredientId;
    const n = itemNorm(it);
    const sameName = n && g.norm && n === g.norm;
    return (sameId || sameName) && partFamily(it.key) === partFamily(g.key);
  }
  function sameQty(a, b) {
    if (a == null || b == null) return a == null && b == null;
    return Math.abs(a - b) < 1e-6;
  }
  // True when amount a (in unit ua) is strictly more than b (in unit ub); incomparable units count as "more".
  function more(a, ua, b, ub) {
    if (a == null) return false;
    if (b == null) return true;
    if (!compatible(ua, ub)) return true;
    return baseOf(a, ua) > baseOf(b, ub) + 1e-6;
  }

  V.planner = {
    scaleFactor, scaledIngredients, weekOf, menuForWeek, mealsInRange, mealsForWeek, slotMeals, weekStats,
    catalogIndex, resolveIngredient, nameKeyFor, requirementsForWeek, aggregate, applyPantry, generateForWeek, signature, reconcile,
  };
})(typeof window !== "undefined" ? window.Velum : globalThis.Velum);
