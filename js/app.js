/* Velum — application controller: canvas actions, drag & drop, week/list dialogs, keyboard, init.
   Business rules live in store/planner; rendering in views; this file only wires the UI to them. */
(function (V) {
  "use strict";
  const U = V.util;
  const Un = V.units;
  const M = V.model;
  const P = V.planner;
  const S = V.store;
  const I = V.images;
  const W = V.views;
  const H = V.shell;
  const E = V.editors;
  const B = V.backup;
  const el = H.el;
  const ui = H.ui;
  const esc = U.escapeHtml;

  // ---------- Week & day dialogs ----------
  function modeRadios(name) {
    return `<div class="field"><span class="field__label">If the target already has meals</span>
      <label class="check-row"><input type="radio" name="${name}" value="merge" checked /> <span>Add alongside them</span></label>
      <label class="check-row"><input type="radio" name="${name}" value="replace" /> <span>Replace them</span></label></div>`;
  }
  function dayDialog(date) {
    const n = S.getDb().meals.filter((m) => m.date === date).length;
    H.openDialog({
      title: U.fmtDate(date, { weekday: "long", month: "long", day: "numeric" }),
      body: `<p class="field__hint">${n ? U.plural(n, "meal") + " planned." : "Nothing planned on this day yet."}</p>
        ${n ? `<label class="field" style="margin-top:10px"><span class="field__label">Copy this day's meals to</span><input class="field__input" type="date" name="to" value="${U.addDays(date, 1)}" required /></label>${modeRadios("mode")}` : ""}`,
      submit: n ? "Copy day" : null,
      extra: n ? `<button type="button" class="btn btn--danger form__actions-left" id="dlgClearDay">Clear this day</button>` : "",
      onOpen: () => {
        const b = $("dlgClearDay");
        if (b) b.addEventListener("click", () => {
          const removed = S.getDb().meals.filter((m) => m.date === date);
          S.clearDay(date);
          H.closeModal("dialogModal");
          H.toast("Cleared " + U.plural(removed.length, "meal") + ".", { label: "Undo", run: () => restoreMeals(removed) });
        });
      },
      onSubmit: (f) => {
        const n2 = S.copyDay(date, f.elements.to.value, f.elements.mode.value);
        H.toast("Copied " + U.plural(n2, "meal") + " to " + U.fmtDate(f.elements.to.value, { weekday: "long" }) + ".");
      },
    });
  }
  function restoreMeals(meals) {
    const db = S.getDb();
    const ids = new Set(db.meals.map((m) => m.id));
    meals.forEach((m) => { if (!ids.has(m.id)) db.meals.push(m); });
    S.commit();
  }
  function copyWeekDialog(ws) {
    H.openDialog({
      title: "Copy this week",
      body: `<p class="field__hint">Copies every meal (with servings and notes) day-for-day. This week stays as it is.</p>
        <label class="field" style="margin-top:10px"><span class="field__label">Copy to the week of</span><input class="field__input" type="date" name="to" value="${U.addDays(ws, 7)}" required /></label>${modeRadios("mode")}`,
      submit: "Copy week",
      onSubmit: (f) => {
        const to = P.weekOf(S.getDb(), f.elements.to.value);
        const n = S.copyWeek(ws, to, f.elements.mode.value);
        H.toast("Copied " + U.plural(n, "meal") + ".", { label: "Go to week", run: () => H.navigate("#/menu/" + to) });
      },
    });
  }
  function reuseWeekDialog(ws) {
    const db = S.getDb();
    const past = db.menus.filter((m) => m.weekStart !== ws && P.mealsForWeek(db, m.weekStart).length)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 12);
    const opts = past.map((m) => `<option value="${m.weekStart}">${esc((m.name ? m.name + " — " : "") + U.fmtRange(m.weekStart, U.addDays(m.weekStart, 6)))} (${P.mealsForWeek(db, m.weekStart).length})</option>`).join("");
    H.openDialog({
      title: "Start from another week",
      body: past.length
        ? `<p class="field__hint">Duplicate a past (or future) week's menu into ${esc(U.fmtRange(ws, U.addDays(ws, 6)))}. The original week isn't changed.</p>
          <label class="field" style="margin-top:10px"><span class="field__label">Week to copy from</span><select class="field__input" name="from">${opts}</select></label>${modeRadios("mode")}`
        : `<p class="empty-note">There are no other weeks with meals yet.</p>`,
      submit: past.length ? "Copy into this week" : null,
      onSubmit: (f) => {
        const n = S.copyWeek(f.elements.from.value, ws, f.elements.mode.value);
        H.toast("Added " + U.plural(n, "meal") + " to this week.");
      },
    });
  }
  function clearWeek(ws) {
    const removed = P.mealsForWeek(S.getDb(), ws);
    if (!removed.length) return;
    if (!confirm("Remove all " + removed.length + " meals from " + U.fmtRange(ws, U.addDays(ws, 6)) + "?")) return;
    S.clearWeek(ws);
    H.toast("Week cleared.", { label: "Undo", run: () => restoreMeals(removed) });
  }
  function planRecipeDialog(id) {
    const db = S.getDb();
    const r = db.recipes.find((x) => x.id === id);
    if (!r) return;
    const meal = M.MEAL_TYPES.find((t) => r.categories.indexOf(t) >= 0) || "dinner";
    const date = nextOpenDate(meal);
    H.openDialog({
      title: "Add “" + r.name + "” to the menu",
      body: `<div class="form__row form__row--3">
          <label class="field"><span class="field__label">Day</span><input class="field__input" type="date" name="date" value="${date}" required /></label>
          <label class="field"><span class="field__label">Meal</span><select class="field__input" name="meal">${M.MEAL_TYPES.map((t) => `<option value="${t}"${t === meal ? " selected" : ""}>${M.MEAL_LABEL[t]}</option>`).join("")}</select></label>
          <label class="field"><span class="field__label">Servings</span><input class="field__input" type="number" min="0.25" step="any" name="servings" value="${ui.recipeServings.get(r.id) || db.settings.servings[meal]}" required /></label>
        </div><p class="field__hint" style="margin-top:8px">The recipe makes ${esc(Un.formatQty(r.servings, ""))}; ingredients scale for this meal only.</p>`,
      submit: "Add to menu",
      onSubmit: (f) => {
        const m = S.addMeal({ recipeId: r.id, date: f.elements.date.value, meal: f.elements.meal.value, servings: f.elements.servings.value });
        H.toast(`Added to ${U.fmtDate(m.date, { weekday: "long" })} ${M.MEAL_LABEL[m.meal].toLowerCase()}.`, { label: "View week", run: () => H.navigate("#/menu/" + P.weekOf(S.getDb(), m.date)) });
      },
    });
  }
  function nextOpenDate(meal) {
    const db = S.getDb();
    for (let i = 0; i < 14; i++) {
      const d = U.addDays(U.todayISO(), i);
      if (!P.slotMeals(db, d, meal).length) return d;
    }
    return U.todayISO();
  }
  // Opens the picker on the next empty slot, starting today.
  function planNext() {
    const db = S.getDb();
    const today = U.todayISO();
    for (let i = 0; i < 14; i++) {
      const d = U.addDays(today, i);
      for (const t of M.MEAL_TYPES) if (!P.slotMeals(db, d, t).length) return E.openPicker(d, t);
    }
    E.openPicker(today, "dinner");
  }

  // ---------- Shopping list dialogs ----------
  function createWeekList(ws) {
    const res = H.attempt(() => S.createListForWeek(ws));
    if (!res.ok) return;
    const { list, created } = res.value;
    ui.listId = list.id;
    H.navigate("#/shopping/" + list.id);
    if (created) H.toast("Built your list: " + U.plural(S.listItems(list.id).length, "item") + ", combined and sorted by aisle.");
  }
  function regenDialog(listId) {
    const res = H.attempt(() => S.previewRegenerate(listId));
    if (!res.ok) return;
    const ch = res.value.changes;
    H.openDialog({
      title: ch.significant ? "Update shopping list" : "List is up to date",
      body: W.changesHtml(ch),
      submit: ch.significant ? "Apply changes" : "OK",
      onSubmit: () => {
        if (!ch.significant) { S.applyRegenerate(listId); return; }
        const applied = S.applyRegenerate(listId);
        H.toast("List updated: " + [applied.added.length && applied.added.length + " added", applied.updated.length && applied.updated.length + " changed", applied.removed.length && applied.removed.length + " removed"].filter(Boolean).join(", ") + ".");
      },
    });
  }
  function listNameDialog(listId) {
    const l = listId && S.getDb().lists.find((x) => x.id === listId);
    H.openDialog({
      title: l ? "Rename list" : "New shopping list",
      body: `<label class="field"><span class="field__label">Name</span><input class="field__input" name="name" maxlength="80" value="${esc(l ? l.name : "")}" placeholder="e.g. Costco run" required /></label>`,
      submit: l ? "Rename" : "Create list",
      onSubmit: (f) => {
        if (l) S.renameList(l.id, f.elements.name.value);
        else {
          const n = S.createList(f.elements.name.value);
          ui.listId = n.id;
          H.navigate("#/shopping/" + n.id);
        }
      },
    });
  }
  function deleteList(id) {
    const l = S.getDb().lists.find((x) => x.id === id);
    if (!l || !confirm("Delete the list “" + l.name + "”? " + (l.menuId ? "You can build it again from the menu." : ""))) return;
    S.deleteList(id);
    ui.listId = null;
    H.navigate("#/shopping");
    H.toast("List deleted.");
  }

  // ---------- Canvas actions ----------
  function onCanvasClick(e) {
    const row = e.target.closest("[data-edit-ingredient]");
    if (row && !e.target.closest("button, a, input")) return E.openIngredientModal(row.dataset.editIngredient);
    const t = e.target.closest("[data-act]");
    if (!t || t.disabled) return;
    const d = t.dataset;
    const db = S.getDb();
    switch (d.act) {
      case "new-recipe": return E.openRecipeEditor(null);
      case "starter": return B.addStarters();
      case "plan-meal": return planNext();
      case "add-slot": return E.openPicker(d.date, d.meal);
      case "open-meal": return E.openMealModal(d.id);
      case "toggle-done": { const r = H.attempt(() => S.toggleMealDone(d.id)); if (r.ok && r.value) H.toast("Nice — marked as made."); return; }
      case "day-menu": return dayDialog(d.date);
      case "copy-week": return copyWeekDialog(d.week);
      case "reuse-week": return reuseWeekDialog(d.week);
      case "clear-week": return clearWeek(d.week);
      case "create-week-list": return createWeekList(d.week);
      // Library
      case "lib-cat": ui.lib.cat = d.val; return H.render();
      case "lib-fav": ui.lib.fav = !ui.lib.fav; return H.render();
      case "lib-archived": ui.lib.archived = !ui.lib.archived; return H.render();
      case "lib-reset": Object.assign(ui.lib, { q: "", cat: "all", fav: false, cuisine: "", tag: "", archived: false }); return H.render();
      case "fav": { e.preventDefault(); const r = H.attempt(() => S.toggleFavorite(d.id)); if (r.ok) H.toast(r.value ? "Added to favorites." : "Removed from favorites."); return; }
      // Recipe detail
      case "edit-recipe": return E.openRecipeEditor(d.id);
      case "dup-recipe": { const r = H.attempt(() => S.duplicateRecipe(d.id)); if (r.ok) { H.navigate("#/recipe/" + r.value.id); E.openRecipeEditor(r.value.id); H.toast("Duplicated — rename your variation."); } return; }
      case "plan-recipe": return planRecipeDialog(d.id);
      case "delete-recipe": return deleteRecipe(d.id);
      case "restore-recipe": { H.attempt(() => S.restoreRecipe(d.id)); return H.toast("Back in your library."); }
      case "cook-mode": H.setCooking(!ui.cooking); return H.render();
      case "scale": {
        const r = db.recipes.find((x) => x.id === ui.route.arg);
        if (!r) return;
        const meal = ui.route.query.meal && db.meals.find((m) => m.id === ui.route.query.meal);
        const cur = ui.recipeServings.get(r.id) || (meal ? meal.servings : r.servings);
        ui.recipeServings.set(r.id, Math.max(1, Math.round(cur) + +d.delta));
        return H.render();
      }
      case "scale-reset": ui.recipeServings.delete(ui.route.arg); return H.render();
      case "step-toggle": toggleCheck(d.key); return H.render();
      // Shopping
      case "buy": H.attempt(() => S.togglePurchased(d.id)); return;
      case "open-item": return E.openItemModal(d.id);
      case "regen": return regenDialog(d.id);
      case "new-list": return listNameDialog(null);
      case "rename-list": return listNameDialog(d.id);
      case "delete-list": return deleteList(d.id);
      case "clear-done": { const r = H.attempt(() => S.clearCompleted(d.id)); if (r.ok) H.toast("Cleared " + U.plural(r.value, "checked item") + "."); return; }
      case "arrange": ui.arrange = !ui.arrange; return H.render();
      case "group-toggle": return H.attempt(() => S.updateSettings({ groupBy: db.settings.groupBy === "category" ? "none" : "category" }));
      case "list-status": { const l = db.lists.find((x) => x.id === d.id); if (l) { S.setListStatus(l.id, l.status === "done" ? "active" : "done"); H.toast(l.status === "done" ? "Nice shopping! List marked finished." : "List reopened."); } return; }
      case "pantry-override": return H.attempt(() => S.setPantryOverride(d.id, true));
      case "item-move": return H.attempt(() => S.moveItem(d.id, +d.delta));
      // Pantry & catalog
      case "pantry-tab": ui.pantryTab = d.val; return H.render();
      case "staple": { const r = H.attempt(() => S.quickAddPantry(d.val)); if (r.ok) H.toast(r.value.name + " added to your pantry."); return; }
      case "pantry-del": { const p = db.pantry.find((x) => x.id === d.id); H.attempt(() => S.deletePantry(d.id)); if (p) H.toast(p.name + " removed.", { label: "Undo", run: () => { S.getDb().pantry.push(p); S.commit(); } }); return; }
      case "new-ingredient": return E.openIngredientModal(null);
      case "learn": { const r = H.attempt(() => S.learnFromRecipes()); if (r.ok) H.toast(r.value ? "Added " + U.plural(r.value, "ingredient") + " to your catalog." : "Every recipe ingredient is already in the catalog."); return; }
      case "open-settings": return B.openSettings();
    }
  }
  function toggleCheck(key) { if (ui.cookChecks.has(key)) ui.cookChecks.delete(key); else ui.cookChecks.add(key); }
  async function deleteRecipe(id) {
    const r = S.getDb().recipes.find((x) => x.id === id);
    if (!r) return;
    const used = S.recipeUsage(id).length;
    const msg = used
      ? "“" + r.name + "” is in " + U.plural(used, "planned meal") + ". It will be archived — hidden from your library but kept so those menus still make sense. Continue?"
      : "Delete “" + r.name + "”? This can't be undone (unless you have a backup).";
    if (!confirm(msg)) return;
    const res = H.attempt(() => S.deleteRecipe(id));
    if (!res.ok) return;
    if (res.value.imageId) await E.releaseImage(res.value.imageId);
    H.navigate("#/recipes");
    H.toast(res.value.archived ? "Recipe archived." : "Recipe deleted.");
  }

  function onCanvasChange(e) {
    const t = e.target;
    const d = t.dataset;
    if (!d.change) return;
    const db = S.getDb();
    switch (d.change) {
      case "jump-date": if (U.isISODate(t.value)) H.navigate(d.mode === "day" ? "#/day/" + t.value : "#/menu/" + P.weekOf(db, t.value)); return;
      case "menu-name": H.attempt(() => S.renameMenu(d.week, t.value)); return;
      case "lib-sort": ui.lib.sort = t.value; return H.render();
      case "lib-cuisine": ui.lib.cuisine = t.value; return H.render();
      case "lib-tag": ui.lib.tag = t.value; return H.render();
      case "scale-input": { const n = U.numOrNull(t.value); if (n && n > 0) ui.recipeServings.set(ui.route.arg, Math.min(500, n)); return H.render(); }
      case "ing-check": toggleCheck(d.key); t.closest(".ing-line").classList.toggle("is-checked", t.checked); return;
      case "pick-list": ui.listId = t.value; return H.navigate("#/shopping/" + t.value);
      case "pantry-avail": H.attempt(() => S.updatePantry(d.id, { available: t.checked })); return;
      case "pantry-qty": H.attempt(() => S.updatePantry(d.id, { qtyText: t.value })); return;
      case "pantry-unit": H.attempt(() => S.updatePantry(d.id, { unit: t.value })); return;
    }
  }
  function onCanvasInput(e) {
    if (e.target.dataset.input === "lib-q") { ui.lib.q = e.target.value; H.render(); }
  }
  function onCanvasSubmit(e) {
    const f = e.target.closest("[data-form]");
    if (!f) return;
    e.preventDefault();
    if (f.dataset.form === "quick-add") {
      const input = $("quickAdd");
      const text = input.value.trim();
      if (!text) return input.focus();
      const r = H.attempt(() => S.quickAddItem(f.dataset.id, text));
      if (r.ok) { const again = $("quickAdd"); again.value = ""; again.focus(); H.toast("Added " + r.value.name + " to " + M.GROCERY_LABEL[r.value.category] + "."); }
    } else if (f.dataset.form === "pantry-add") {
      const input = $("pantryAdd");
      const text = input.value.trim();
      if (!text) return input.focus();
      const r = H.attempt(() => S.quickAddPantry(text));
      if (r.ok) { const again = $("pantryAdd"); again.value = ""; again.focus(); }
    }
  }

  // ---------- Drag & drop meals between slots (desktop) ----------
  let dragId = null;
  function bindDragDrop() {
    el.canvas.addEventListener("dragstart", (e) => {
      const chip = e.target.closest && e.target.closest("[data-meal-id][draggable]");
      if (!chip) return;
      dragId = chip.dataset.mealId;
      chip.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("text/plain", dragId);
    });
    el.canvas.addEventListener("dragover", (e) => {
      const cell = dragId && e.target.closest(".wg-cell");
      if (!cell) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.altKey || e.ctrlKey ? "copy" : "move";
      el.canvas.querySelectorAll(".wg-cell.is-drop").forEach((c) => { if (c !== cell) c.classList.remove("is-drop"); });
      cell.classList.add("is-drop");
    });
    el.canvas.addEventListener("dragleave", (e) => {
      const cell = e.target.closest && e.target.closest(".wg-cell");
      if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove("is-drop");
    });
    el.canvas.addEventListener("drop", (e) => {
      const cell = dragId && e.target.closest(".wg-cell");
      if (!cell) return;
      e.preventDefault();
      const id = dragId;
      dragId = null;
      const copy = e.altKey || e.ctrlKey;
      const res = H.attempt(() => (copy ? S.copyMeal(id, cell.dataset.dropDate, cell.dataset.dropMeal) : S.moveMeal(id, cell.dataset.dropDate, cell.dataset.dropMeal)));
      if (res.ok) H.toast(copy ? "Meal copied." : "Meal moved.");
    });
    el.canvas.addEventListener("dragend", () => {
      dragId = null;
      el.canvas.querySelectorAll(".is-drop, .is-dragging").forEach((n) => n.classList.remove("is-drop", "is-dragging"));
    });
  }

  // ---------- Keyboard ----------
  function onKeydown(e) {
    if (e.key === "Escape") {
      const top = H.topModal();
      if (top) { e.preventDefault(); H.closeModal(top); return; }
      if (ui.cooking) { H.setCooking(false); H.render(); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      const top = H.topModal();
      const form = { recipeModal: el.recipeForm, mealModal: el.mealForm, itemModal: el.itemForm, ingredientModal: el.ingredientForm, dialogModal: el.dialogForm }[top];
      if (form) { e.preventDefault(); form.requestSubmit(); }
      return;
    }
    const tag = document.activeElement && document.activeElement.tagName;
    if ((e.key === "Enter" || e.key === " ") && document.activeElement && document.activeElement.dataset.act === "step-toggle") {
      e.preventDefault();
      document.activeElement.click();
      return;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
    if (typing || H.anyModalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") {
      const s = $("libSearch");
      if (s) { e.preventDefault(); s.focus(); } else { e.preventDefault(); H.navigate("#/recipes"); setTimeout(() => { const s2 = $("libSearch"); if (s2) s2.focus(); }, 30); }
    } else if (e.key === "n" || e.key === "N") { e.preventDefault(); E.openRecipeEditor(null); }
  }

  function $(id) { return document.getElementById(id); }
  function cacheEls() {
    document.querySelectorAll("[id]").forEach((n) => { if (!(n instanceof SVGElement)) el[n.id] = n; });
  }

  async function init() {
    cacheEls();
    S.init();
    el.appVersion.textContent = "v" + H.APP_VERSION;
    H.MODALS.forEach((id) => el[id].addEventListener("click", (e) => { if (e.target.closest("[data-close]")) H.closeModal(id); }));
    el.dialogForm.addEventListener("submit", H.submitDialog);
    el.toastAction.addEventListener("click", H.runToastAction);
    el.canvas.addEventListener("click", onCanvasClick);
    el.canvas.addEventListener("change", onCanvasChange);
    el.canvas.addEventListener("input", onCanvasInput);
    el.canvas.addEventListener("submit", onCanvasSubmit);
    el.canvas.addEventListener("keydown", (e) => {
      const row = e.target.closest && e.target.closest("[data-edit-ingredient]");
      if (row && e.key === "Enter") E.openIngredientModal(row.dataset.editIngredient);
    });
    if (ui.canDrag) bindDragDrop();
    el.topNewRecipeBtn.addEventListener("click", () => E.openRecipeEditor(null));
    el.planMealBtn.addEventListener("click", planNext);
    document.addEventListener("keydown", onKeydown);
    E.bind();
    B.bind();
    S.onChange(() => { H.render(); B.scheduleAutoBackup(); });
    // Keep tabs in sync when Velum is open twice.
    window.addEventListener("storage", (e) => { if (e.key === S.STORE_KEY) { S.load(); H.render(); } });
    window.addEventListener("hashchange", H.onRoute);
    H.onRoute();
    // Photos load asynchronously from IndexedDB; re-render once they're available.
    const ok = await I.init();
    H.render();
    if (!ok) console.warn("Velum: IndexedDB unavailable — recipe photos can't be stored in this browser.");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.Velum);
