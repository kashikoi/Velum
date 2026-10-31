/* Velum — editors: recipe editor, recipe picker, meal / shopping item / catalog dialogs. */
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
  const el = H.el;
  const ui = H.ui;
  const esc = U.escapeHtml;

  // Photos can be shared by duplicated recipes, so only delete one when nothing references it.
  async function releaseImage(id) {
    if (!id || S.getDb().recipes.some((r) => r.imageId === id)) return;
    try { await I.remove(id); } catch (e) { /* stale photo is harmless */ }
  }

  // =================== Recipe editor ===================
  let draft = null;
  let afterSave = null; // { date, meal, replaceId } when creating from the picker

  function blankIng() { return { id: null, qtyText: "", unit: "", name: "", prep: "", group: "", optional: false, ingredientId: null }; }
  function openRecipeEditor(id, opts) {
    const db = S.getDb();
    const r = id ? db.recipes.find((x) => x.id === id) : null;
    afterSave = (opts && opts.afterSave) || null;
    draft = {
      id: r ? r.id : null,
      imageId: r ? r.imageId : null,
      newImage: null,
      removeImage: false,
      categories: new Set(r ? r.categories : (opts && opts.category ? [opts.category] : ["dinner"])),
      ingredients: r ? r.ingredients.map((g) => ({ id: g.id, qtyText: g.qty == null ? "" : Un.formatQty(g.qty, g.unit), unit: g.unit ? Un.unitLabel(g.unit, g.qty) : "", name: g.name, prep: g.prep, group: g.group, optional: g.optional, ingredientId: g.ingredientId })) : [blankIng(), blankIng(), blankIng()],
      steps: r ? r.steps.map((s) => ({ id: s.id, text: s.text })) : [{ id: null, text: "" }],
    };
    el.recipeTitle.textContent = r ? "Edit recipe" : "New recipe";
    el.rName.value = r ? r.name : (opts && opts.name) || "";
    el.rDesc.value = r ? r.description : "";
    el.rPrep.value = r && r.prepMin != null ? r.prepMin : "";
    el.rCook.value = r && r.cookMin != null ? r.cookMin : "";
    el.rTotal.value = r && r.totalMin != null ? r.totalMin : "";
    el.rServings.value = r ? r.servings : (opts && opts.category && db.settings.servings[opts.category]) || 4;
    el.rCuisine.value = r ? r.cuisine : "";
    el.rDifficulty.value = r ? r.difficulty : "";
    el.rTags.value = r ? r.tags.join(", ") : "";
    el.rNotes.value = r ? r.notes : "";
    el.rSource.value = r ? r.sourceUrl : "";
    el.rFavorite.checked = r ? r.favorite : false;
    el.rPasteBox.hidden = true;
    el.rError.hidden = true;
    el.cuisineList.innerHTML = U.uniqueSorted(db.recipes.map((x) => x.cuisine).concat(["American", "Chinese", "French", "Greek", "Indian", "Italian", "Japanese", "Korean", "Mediterranean", "Mexican", "Middle Eastern", "Thai", "Vietnamese"]))
      .map((c) => `<option value="${esc(c)}"></option>`).join("");
    el.ingredientNameList.innerHTML = U.uniqueSorted(db.ingredients.map((g) => g.name).concat([].concat.apply([], db.recipes.map((x) => x.ingredients.map((g) => g.name)))))
      .slice(0, 400).map((n) => `<option value="${esc(n)}"></option>`).join("");
    renderCats();
    renderPhoto();
    renderIngRows();
    renderStepRows();
    H.openModal("recipeModal", el.rName);
    el.recipeModal.querySelector(".modal__card").scrollTop = 0;
  }
  function renderCats() {
    el.rCats.innerHTML = M.RECIPE_CATEGORIES.map((c) => `<button type="button" class="chip${draft.categories.has(c) ? " is-on" : ""}" data-cat="${c}" aria-pressed="${draft.categories.has(c)}">${M.CATEGORY_ICON[c]} ${M.CATEGORY_LABEL[c]}</button>`).join("");
  }
  function renderPhoto() {
    const src = draft.newImage || (!draft.removeImage && I.get(draft.imageId));
    el.rPhotoPreview.innerHTML = src ? `<img src="${esc(src)}" alt="Recipe photo preview" />` : `<span aria-hidden="true">📷</span>`;
    el.rPhotoRemove.hidden = !src;
    el.rPhotoPick.textContent = src ? "Change photo" : "Upload photo";
  }
  async function onPhotoFile(file) {
    if (!file) return;
    el.rPhotoPick.disabled = true;
    el.rPhotoPick.textContent = "Processing…";
    try {
      draft.newImage = await I.processFile(file);
      draft.removeImage = false;
      el.rError.hidden = true;
    } catch (e) {
      el.rError.textContent = e.message || "That image couldn't be used.";
      el.rError.hidden = false;
    } finally {
      el.rPhotoPick.disabled = false;
      el.rPhotoFile.value = "";
      renderPhoto();
    }
  }
  function renderIngRows() {
    const n = draft.ingredients.length;
    el.rIngredients.innerHTML = `<div class="ing-head" aria-hidden="true"><span>Qty</span><span>Unit</span><span>Ingredient</span><span>Prep / note</span><span>Group</span><span></span><span></span></div>` +
      draft.ingredients.map((g, i) => `<div class="ing-row" data-i="${i}">
        <input class="field__input field__input--sm" data-f="qtyText" value="${esc(g.qtyText)}" placeholder="1 ½" inputmode="decimal" aria-label="Quantity" />
        <input class="field__input field__input--sm" data-f="unit" value="${esc(g.unit)}" list="unitList" placeholder="unit" aria-label="Unit" />
        <input class="field__input field__input--sm" data-f="name" value="${esc(g.name)}" list="ingredientNameList" placeholder="ingredient" aria-label="Ingredient name" />
        <input class="field__input field__input--sm" data-f="prep" value="${esc(g.prep)}" placeholder="chopped, to taste…" aria-label="Preparation" />
        <input class="field__input field__input--sm" data-f="group" value="${esc(g.group)}" placeholder="e.g. Sauce" aria-label="Ingredient group" />
        <label class="ing-row__opt"><input type="checkbox" data-f="optional"${g.optional ? " checked" : ""} /> opt.</label>
        <span class="ing-row__btns">
          <button type="button" class="mini-btn" data-ing-move="-1" aria-label="Move up"${i === 0 ? " disabled" : ""}>▲</button>
          <button type="button" class="mini-btn" data-ing-move="1" aria-label="Move down"${i === n - 1 ? " disabled" : ""}>▼</button>
          <button type="button" class="mini-btn mini-btn--danger" data-ing-del aria-label="Remove ingredient">✕</button>
        </span></div>`).join("");
  }
  function renderStepRows() {
    const n = draft.steps.length;
    el.rSteps.innerHTML = draft.steps.map((s, i) => `<li class="step-row" data-i="${i}">
      <textarea class="field__input field__input--area" data-f="text" rows="2" maxlength="4000" placeholder="Describe this step…" aria-label="Step ${i + 1}">${esc(s.text)}</textarea>
      <span class="step-row__btns">
        <button type="button" class="mini-btn" data-step-move="-1" aria-label="Move step up"${i === 0 ? " disabled" : ""}>▲</button>
        <button type="button" class="mini-btn" data-step-move="1" aria-label="Move step down"${i === n - 1 ? " disabled" : ""}>▼</button>
        <button type="button" class="mini-btn mini-btn--danger" data-step-del aria-label="Remove step">✕</button>
      </span></li>`).join("");
  }
  function swap(arr, i, j) { if (j < 0 || j >= arr.length) return; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  function onIngInput(e) {
    const row = e.target.closest("[data-i]");
    if (!row || !e.target.dataset.f) return;
    const g = draft.ingredients[+row.dataset.i];
    g[e.target.dataset.f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  }
  function onIngClick(e) {
    const row = e.target.closest("[data-i]");
    if (!row) return;
    const i = +row.dataset.i;
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.ingMove) { swap(draft.ingredients, i, i + +b.dataset.ingMove); renderIngRows(); focusRow(el.rIngredients, i + +b.dataset.ingMove, "[data-ing-move]"); }
    else if (b.hasAttribute("data-ing-del")) { draft.ingredients.splice(i, 1); if (!draft.ingredients.length) draft.ingredients.push(blankIng()); renderIngRows(); }
  }
  function onStepInput(e) {
    const row = e.target.closest("[data-i]");
    if (row) draft.steps[+row.dataset.i].text = e.target.value;
  }
  function onStepClick(e) {
    const row = e.target.closest("[data-i]");
    const b = e.target.closest("button");
    if (!row || !b) return;
    const i = +row.dataset.i;
    if (b.dataset.stepMove) { swap(draft.steps, i, i + +b.dataset.stepMove); renderStepRows(); focusRow(el.rSteps, i + +b.dataset.stepMove, "[data-step-move]"); }
    else if (b.hasAttribute("data-step-del")) { draft.steps.splice(i, 1); if (!draft.steps.length) draft.steps.push({ id: null, text: "" }); renderStepRows(); }
  }
  function focusRow(container, i, sel) {
    const row = container.querySelector(`[data-i="${i}"]`);
    const b = row && row.querySelector(sel + ":not([disabled])");
    if (b) b.focus();
  }
  function applyPaste() {
    const lines = el.rPasteText.value.split(/\r?\n/);
    let group = "";
    let added = 0;
    const rows = [];
    lines.forEach((line) => {
      const t = line.trim();
      if (!t) return;
      // "For the sauce:" style headings become ingredient groups.
      const h = /^(?:for the\s+)?([^:]{2,40}):$/i.exec(t);
      if (h) { group = h[1].replace(/^\w/, (c) => c.toUpperCase()); return; }
      const p = Un.parseIngredientLine(t);
      if (!p) return;
      rows.push({ id: null, qtyText: p.qty == null ? "" : Un.formatQty(p.qty, p.unit), unit: p.unit ? Un.unitLabel(p.unit, p.qty) : "", name: p.name, prep: p.prep, group, optional: p.optional, ingredientId: null });
      added++;
    });
    draft.ingredients = draft.ingredients.filter((g) => g.name.trim() || g.qtyText.trim()).concat(rows);
    if (!draft.ingredients.length) draft.ingredients.push(blankIng());
    el.rPasteText.value = "";
    el.rPasteBox.hidden = true;
    renderIngRows();
    H.toast(added ? "Added " + U.plural(added, "ingredient") + " — check the quantities." : "Nothing to add.");
  }
  function collectRecipe() {
    return {
      name: el.rName.value, description: el.rDesc.value, categories: Array.from(draft.categories),
      prepMin: el.rPrep.value, cookMin: el.rCook.value, totalMin: el.rTotal.value, servings: el.rServings.value,
      cuisine: el.rCuisine.value, difficulty: el.rDifficulty.value, tags: el.rTags.value,
      ingredients: draft.ingredients.filter((g) => g.name.trim()).map((g) => ({
        id: g.id, ingredientId: g.ingredientId, qtyText: g.qtyText.trim(), unit: Un.normalizeUnit(g.unit), name: g.name, prep: g.prep, group: g.group, optional: g.optional,
      })),
      steps: draft.steps.filter((s) => s.text.trim()).map((s) => ({ id: s.id, text: s.text })),
      notes: el.rNotes.value, sourceUrl: el.rSource.value.trim(), favorite: el.rFavorite.checked,
    };
  }
  async function saveRecipe(e) {
    e.preventDefault();
    if (!draft) return;
    const f = collectRecipe();
    if (f.sourceUrl && !/^https?:\/\//i.test(f.sourceUrl)) { el.rError.textContent = "The source link must start with http:// or https://."; el.rError.hidden = false; return; }
    const orphans = draft.ingredients.filter((g) => !g.name.trim() && g.qtyText.trim());
    if (orphans.length) { el.rError.textContent = "One ingredient has a quantity but no name."; el.rError.hidden = false; return; }
    let imageId = draft.imageId, pending = null, oldImage = null;
    if (draft.newImage) { imageId = U.uid(); pending = draft.newImage; oldImage = draft.imageId; }
    else if (draft.removeImage) { oldImage = draft.imageId; imageId = null; }
    f.imageId = imageId;
    if (pending) {
      try { await I.put(imageId, pending); }
      catch (err) { el.rError.textContent = "Couldn't store the photo (browser storage may be full). Try a smaller image or remove it."; el.rError.hidden = false; return; }
    }
    const res = H.attempt(() => (draft.id ? S.updateRecipe(draft.id, f) : S.createRecipe(f)), el.rError);
    if (!res.ok) { if (pending) I.remove(imageId); return; }
    if (oldImage) releaseImage(oldImage);
    const r = res.value;
    const isNew = !draft.id;
    draft = null;
    H.closeModal("recipeModal");
    if (afterSave) {
      const a = afterSave;
      afterSave = null;
      const m = H.attempt(() => (a.replaceId ? S.updateMeal(a.replaceId, { recipeId: r.id }) : S.addMeal({ date: a.date, meal: a.meal, recipeId: r.id })));
      if (m.ok) H.toast(`Saved and added to ${U.fmtWeekday(a.date)} ${M.MEAL_LABEL[a.meal].toLowerCase()}.`);
      return;
    }
    H.toast(isNew ? "Recipe saved." : "Changes saved.");
    if (isNew) H.navigate("#/recipe/" + r.id);
  }

  // =================== Recipe picker ===================
  let picker = null;
  function openPicker(date, meal, replaceId) {
    picker = { date, meal, replaceId: replaceId || null, tab: "suggested", q: "" };
    el.pickerSearch.value = "";
    el.pickerNote.value = "";
    el.pickerTitle.textContent = replaceId ? "Replace recipe" : "Add a meal";
    renderPickerSlot();
    renderPicker();
    H.openModal("pickerModal", el.pickerSearch);
  }
  function renderPickerSlot() {
    el.pickerSlot.innerHTML = picker.replaceId
      ? `Pick a new recipe for <strong>${esc(U.fmtDate(picker.date, { weekday: "long", month: "short", day: "numeric" }))} · ${M.MEAL_LABEL[picker.meal]}</strong>.`
      : `<div class="form__row"><label class="field"><span class="field__label">Day</span><input class="field__input field__input--sm" type="date" id="pickerDate" value="${picker.date}" /></label>
         <label class="field"><span class="field__label">Meal</span><select class="field__input field__input--sm" id="pickerMeal">${M.MEAL_TYPES.map((t) => `<option value="${t}"${t === picker.meal ? " selected" : ""}>${M.MEAL_LABEL[t]}</option>`).join("")}</select></label></div>`;
  }
  function pickerRecipes() {
    const db = S.getDb();
    let list = db.recipes.filter((r) => !r.archived);
    const q = picker.q.trim().toLowerCase();
    if (q) list = list.filter((r) => (r.name + " " + r.tags.join(" ") + " " + r.cuisine + " " + r.ingredients.map((g) => g.name).join(" ")).toLowerCase().indexOf(q) >= 0);
    if (picker.tab === "suggested") {
      const fits = list.filter((r) => r.categories.indexOf(picker.meal) >= 0);
      list = fits.concat(list.filter((r) => fits.indexOf(r) < 0));
      list.sort((a, b) => (b.categories.indexOf(picker.meal) >= 0) - (a.categories.indexOf(picker.meal) >= 0) || (b.favorite - a.favorite) || a.name.localeCompare(b.name));
    } else if (picker.tab === "favorites") list = list.filter((r) => r.favorite).sort((a, b) => a.name.localeCompare(b.name));
    else if (picker.tab === "recent") list = list.filter((r) => r.lastUsedAt).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }
  function renderPicker() {
    const tabs = [["suggested", "For " + M.MEAL_LABEL[picker.meal].toLowerCase()], ["all", "All"], ["favorites", "♥ Favorites"], ["recent", "Recently planned"]];
    el.pickerTabs.innerHTML = tabs.map(([v, l]) => `<button type="button" class="seg__btn${picker.tab === v ? " is-active" : ""}" data-tab="${v}">${l}</button>`).join("");
    const list = pickerRecipes();
    const db = S.getDb();
    el.pickerList.innerHTML = list.length ? list.map((r) => {
      const meta = [r.categories.map((c) => M.CATEGORY_LABEL[c]).join(", "), M.totalTime(r) ? U.fmtMinutes(M.totalTime(r)) : "", "serves " + Un.formatQty(r.servings, "")].filter(Boolean).join(" · ");
      return `<li><button type="button" class="pick-row" data-pick="${esc(r.id)}">${W.thumb(r)}<span class="pick-row__text"><span class="pick-row__name">${esc(r.name)} ${r.favorite ? '<span class="pick-row__fav">♥</span>' : ""}</span><span class="pick-row__meta">${esc(meta)}</span></span></button></li>`;
    }).join("") : `<li class="empty-note" style="padding:14px">${db.recipes.length ? "No recipes match." : "No recipes yet — create one below, or add a quick note."}</li>`;
  }
  function pickRecipe(recipeId) {
    const p = picker;
    const res = H.attempt(() => (p.replaceId ? S.updateMeal(p.replaceId, { recipeId }) : S.addMeal({ date: p.date, meal: p.meal, recipeId })));
    if (!res.ok) return;
    H.closeModal("pickerModal");
    const r = S.getDb().recipes.find((x) => x.id === recipeId);
    if (p.replaceId) H.toast("Replaced with " + r.name + ".");
    else {
      const id = res.value.id;
      H.toast(`${r.name} → ${U.fmtWeekday(p.date)} ${M.MEAL_LABEL[p.meal].toLowerCase()}`, { label: "Undo", run: () => H.attempt(() => S.removeMeal(id)) });
    }
  }
  function addPickerNote(e) {
    e.preventDefault();
    const title = el.pickerNote.value.trim();
    if (!title) { el.pickerNote.focus(); return; }
    const p = picker;
    const res = H.attempt(() => (p.replaceId ? S.updateMeal(p.replaceId, { recipeId: null, title }) : S.addMeal({ date: p.date, meal: p.meal, title })));
    if (res.ok) { H.closeModal("pickerModal"); H.toast("Added \"" + title + "\"."); }
  }

  // =================== Meal dialog ===================
  let mealId = null;
  function openMealModal(id) {
    const db = S.getDb();
    const m = db.meals.find((x) => x.id === id);
    if (!m) return;
    mealId = id;
    const r = m.recipeId && db.recipes.find((x) => x.id === m.recipeId);
    el.mealTitle.textContent = U.fmtDate(m.date, { weekday: "long", month: "short", day: "numeric" }) + " · " + M.MEAL_LABEL[m.meal];
    el.mHead.innerHTML = r
      ? `${W.thumb(r, "lg")}<div><div class="meal-head__name">${esc(r.name)}</div><div class="meal-head__meta">Recipe serves ${esc(Un.formatQty(r.servings, ""))}${M.totalTime(r) ? " · " + U.fmtMinutes(M.totalTime(r)) : ""}${r.archived ? " · archived" : ""}</div></div>`
      : `<span class="thumb thumb--lg">📝</span><div><div class="meal-head__name">${esc(m.title)}</div><div class="meal-head__meta">A note, not a recipe — nothing is added to the shopping list.</div></div>`;
    el.mTitleWrap.hidden = !!r;
    el.mTitle.value = r ? "" : m.title;
    el.mServingsWrap.hidden = !r;
    el.mServings.value = m.servings;
    updateServingsHint(r);
    el.mNote.value = m.note;
    el.mDate.value = m.date;
    el.mMeal.value = m.meal;
    el.mDone.checked = m.done;
    el.mView.hidden = !r;
    el.mError.hidden = true;
    H.openModal("mealModal", r ? el.mServings : el.mTitle);
  }
  function updateServingsHint(r) {
    const n = U.numOrNull(el.mServings.value);
    el.mServingsHint.textContent = r && n > 0 ? (Math.abs(n - r.servings) < 1e-9 ? "Same as the recipe." : "Ingredients scale ×" + U.round(n / r.servings, 2) + " for this meal only.") : "";
  }
  function mealRecipe() {
    const db = S.getDb();
    const m = db.meals.find((x) => x.id === mealId);
    return m && m.recipeId ? db.recipes.find((x) => x.id === m.recipeId) : null;
  }
  function saveMeal(e) {
    e.preventDefault();
    const r = mealRecipe();
    const patch = { note: el.mNote.value, done: el.mDone.checked, date: el.mDate.value, meal: el.mMeal.value };
    if (r) patch.servings = el.mServings.value; else patch.title = el.mTitle.value;
    const res = H.attempt(() => S.updateMeal(mealId, patch), el.mError);
    if (res.ok) { H.closeModal("mealModal"); H.toast("Meal updated."); }
  }
  function removeMealFromModal() {
    const res = H.attempt(() => S.removeMeal(mealId), el.mError);
    if (!res.ok) return;
    const m = res.value;
    H.closeModal("mealModal");
    H.toast("Meal removed.", { label: "Undo", run: () => { S.getDb().meals.push(m); S.commit(); } });
  }
  function copyMealFromModal() {
    const res = H.attempt(() => S.copyMeal(mealId, el.mDate.value, el.mMeal.value), el.mError);
    if (res.ok) { H.closeModal("mealModal"); H.toast(`Copied to ${U.fmtWeekday(el.mDate.value)} ${M.MEAL_LABEL[el.mMeal.value].toLowerCase()}.`); }
  }

  // =================== Shopping item dialog ===================
  let itemId = null;
  function categoryOptions(selected) {
    return M.GROCERY_CATEGORIES.map((c) => `<option value="${c}"${c === selected ? " selected" : ""}>${M.GROCERY_ICON[c]} ${M.GROCERY_LABEL[c]}</option>`).join("");
  }
  function openItemModal(id) {
    const it = S.getDb().items.find((x) => x.id === id);
    if (!it) return;
    itemId = id;
    el.itemTitle.textContent = it.manual ? "Your item" : "From your menu";
    el.iName.value = it.name;
    el.iQty.value = it.qty == null ? "" : Un.formatQty(it.qty, it.unit);
    el.iUnit.value = it.unit ? Un.unitLabel(it.unit, it.qty) : "";
    el.iCategory.innerHTML = categoryOptions(it.category);
    el.iNote.value = it.note;
    el.iRemember.checked = true;
    el.iRememberWrap.hidden = true;
    el.iReset.hidden = it.manual || !it.qtyEdited;
    el.iError.hidden = true;
    const info = [];
    if (!it.manual) {
      info.push("Menu needs: <strong>" + esc(Un.formatAmount(it.genQty, it.genUnit) || "to taste") + "</strong>" + (it.toTaste && it.genQty != null ? " (plus some to taste)" : ""));
      if (it.sources.length) info.push("For: <ul>" + it.sources.map((s) => `<li>${esc(s.recipe)} — ${esc(U.fmtWeekday(s.date, true))} ${M.MEAL_LABEL[s.meal] ? M.MEAL_LABEL[s.meal].toLowerCase() : ""}</li>`).join("") + "</ul>");
      if (it.stale) info.push("No meal on the menu needs this any more.");
    }
    if (it.change) info.push(esc(it.change));
    el.iInfo.innerHTML = info.join("<br />");
    H.openModal("itemModal", el.iQty);
  }
  function saveItem(e) {
    e.preventDefault();
    const it = S.getDb().items.find((x) => x.id === itemId);
    const f = { name: el.iName.value, qtyText: el.iQty.value.trim(), unit: el.iUnit.value, category: el.iCategory.value, note: el.iNote.value };
    if (it && f.category !== it.category) f.rememberCategory = el.iRemember.checked;
    const res = H.attempt(() => S.updateItem(itemId, f), el.iError);
    if (res.ok) { H.closeModal("itemModal"); H.toast(f.rememberCategory ? "Saved — Velum will remember that aisle." : "Item updated."); }
  }
  function deleteItemFromModal() {
    const res = H.attempt(() => S.deleteItem(itemId), el.iError);
    if (!res.ok) return;
    const it = res.value;
    H.closeModal("itemModal");
    H.toast(it.name + " removed.", { label: "Undo", run: () => S.restoreItem(it) });
  }

  // =================== Ingredient catalog dialog ===================
  let ingredientId = null;
  function openIngredientModal(id) {
    const g = id ? S.getDb().ingredients.find((x) => x.id === id) : null;
    ingredientId = g ? g.id : null;
    el.ingredientTitle.textContent = g ? "Edit ingredient" : "New ingredient";
    el.gName.value = g ? g.name : "";
    el.gCategory.innerHTML = categoryOptions(g ? g.category : "other");
    el.gUnit.value = g && g.defaultUnit ? Un.unitLabel(g.defaultUnit, 2) : "";
    el.gAliases.value = g ? g.aliases.join(", ") : "";
    el.gDensity.value = g && g.gramsPerCup ? g.gramsPerCup : "";
    el.gNotes.value = g ? g.notes : "";
    el.gDelete.hidden = !g;
    el.gError.hidden = true;
    H.openModal("ingredientModal", el.gName);
  }
  function saveIngredient(e) {
    e.preventDefault();
    const f = { name: el.gName.value, category: el.gCategory.value, defaultUnit: el.gUnit.value, aliases: el.gAliases.value, gramsPerCup: el.gDensity.value, notes: el.gNotes.value };
    const res = H.attempt(() => (ingredientId ? S.updateIngredient(ingredientId, f) : S.createIngredient(f)), el.gError);
    if (res.ok) { H.closeModal("ingredientModal"); H.toast("Ingredient saved."); }
  }
  function deleteIngredientFromModal() {
    if (!confirm("Remove this ingredient from your catalog? Recipes keep their ingredient text.")) return;
    const res = H.attempt(() => S.deleteIngredient(ingredientId), el.gError);
    if (res.ok) { H.closeModal("ingredientModal"); H.toast("Ingredient removed."); }
  }

  function bind() {
    // Recipe editor
    el.recipeForm.addEventListener("submit", saveRecipe);
    el.rCats.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      const c = b.dataset.cat;
      if (draft.categories.has(c)) { if (draft.categories.size > 1) draft.categories.delete(c); } else draft.categories.add(c);
      renderCats();
    });
    el.rIngredients.addEventListener("input", onIngInput);
    el.rIngredients.addEventListener("change", onIngInput);
    el.rIngredients.addEventListener("click", onIngClick);
    el.rIngredients.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !e.target.dataset.f || e.target.type === "checkbox") return;
      e.preventDefault();
      const row = e.target.closest("[data-i]");
      const i = +row.dataset.i;
      if (i === draft.ingredients.length - 1) { draft.ingredients.push(blankIng()); renderIngRows(); }
      const next = el.rIngredients.querySelector(`[data-i="${i + 1}"] [data-f="qtyText"]`);
      if (next) next.focus();
    });
    el.rAddIng.addEventListener("click", () => {
      draft.ingredients.push(blankIng());
      renderIngRows();
      const last = el.rIngredients.querySelector(`[data-i="${draft.ingredients.length - 1}"] [data-f="qtyText"]`);
      if (last) last.focus();
    });
    el.rSteps.addEventListener("input", onStepInput);
    el.rSteps.addEventListener("click", onStepClick);
    el.rAddStep.addEventListener("click", () => {
      draft.steps.push({ id: null, text: "" });
      renderStepRows();
      const last = el.rSteps.querySelector(`[data-i="${draft.steps.length - 1}"] textarea`);
      if (last) last.focus();
    });
    el.rPasteToggle.addEventListener("click", () => { el.rPasteBox.hidden = !el.rPasteBox.hidden; if (!el.rPasteBox.hidden) el.rPasteText.focus(); });
    el.rPasteCancel.addEventListener("click", () => { el.rPasteBox.hidden = true; });
    el.rPasteApply.addEventListener("click", applyPaste);
    el.rPhotoPick.addEventListener("click", () => el.rPhotoFile.click());
    el.rPhotoFile.addEventListener("change", () => onPhotoFile(el.rPhotoFile.files[0]));
    el.rPhotoRemove.addEventListener("click", () => { draft.newImage = null; draft.removeImage = true; renderPhoto(); });
    el.rPhoto.addEventListener("dragover", (e) => { e.preventDefault(); el.rPhoto.classList.add("is-over"); });
    el.rPhoto.addEventListener("dragleave", () => el.rPhoto.classList.remove("is-over"));
    el.rPhoto.addEventListener("drop", (e) => { e.preventDefault(); el.rPhoto.classList.remove("is-over"); onPhotoFile(e.dataTransfer.files[0]); });
    ["rPrep", "rCook"].forEach((k) => el[k].addEventListener("input", () => {
      const t = (U.numOrNull(el.rPrep.value) || 0) + (U.numOrNull(el.rCook.value) || 0);
      el.rTotal.placeholder = t ? String(t) : "";
    }));

    // Picker
    el.pickerSearch.addEventListener("input", () => { picker.q = el.pickerSearch.value; if (picker.q && picker.tab === "recent") picker.tab = "all"; renderPicker(); });
    el.pickerSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); const first = el.pickerList.querySelector("[data-pick]"); if (first) pickRecipe(first.dataset.pick); }
      if (e.key === "ArrowDown") { e.preventDefault(); const first = el.pickerList.querySelector("[data-pick]"); if (first) first.focus(); }
    });
    el.pickerList.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const rows = Array.from(el.pickerList.querySelectorAll("[data-pick]"));
      const i = rows.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const j = i + (e.key === "ArrowDown" ? 1 : -1);
      if (j < 0) el.pickerSearch.focus(); else if (rows[j]) rows[j].focus();
    });
    el.pickerTabs.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { picker.tab = b.dataset.tab; renderPicker(); } });
    el.pickerList.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) pickRecipe(b.dataset.pick); });
    el.pickerSlot.addEventListener("change", (e) => {
      if (e.target.id === "pickerDate" && U.isISODate(e.target.value)) picker.date = e.target.value;
      if (e.target.id === "pickerMeal") { picker.meal = e.target.value; renderPicker(); }
    });
    el.pickerNoteForm.addEventListener("submit", addPickerNote);
    el.pickerNewRecipe.addEventListener("click", () => {
      const p = picker;
      H.closeModal("pickerModal");
      openRecipeEditor(null, { category: p.meal, name: el.pickerSearch.value.trim(), afterSave: { date: p.date, meal: p.meal, replaceId: p.replaceId } });
    });

    // Meal dialog
    el.mealForm.addEventListener("submit", saveMeal);
    el.mealForm.addEventListener("click", (e) => {
      const b = e.target.closest("[data-step]");
      if (!b) return;
      const n = U.numOrNull(el.mServings.value) || 0;
      el.mServings.value = Math.max(1, Math.round(n) + +b.dataset.step);
      updateServingsHint(mealRecipe());
    });
    el.mServings.addEventListener("input", () => updateServingsHint(mealRecipe()));
    el.mRemove.addEventListener("click", removeMealFromModal);
    el.mCopy.addEventListener("click", copyMealFromModal);
    el.mReplace.addEventListener("click", () => {
      const m = S.getDb().meals.find((x) => x.id === mealId);
      H.closeModal("mealModal");
      if (m) openPicker(m.date, m.meal, m.id);
    });
    el.mView.addEventListener("click", () => {
      const m = S.getDb().meals.find((x) => x.id === mealId);
      H.closeModal("mealModal");
      if (m && m.recipeId) H.navigate("#/recipe/" + m.recipeId + "?meal=" + m.id);
    });

    // Item dialog
    el.itemForm.addEventListener("submit", saveItem);
    el.iCategory.addEventListener("change", () => {
      const it = S.getDb().items.find((x) => x.id === itemId);
      el.iRememberWrap.hidden = !it || el.iCategory.value === it.category;
    });
    el.iDelete.addEventListener("click", deleteItemFromModal);
    el.iReset.addEventListener("click", () => {
      const res = H.attempt(() => S.resetItemToMenu(itemId), el.iError);
      if (res.ok) { H.closeModal("itemModal"); H.toast("Back to the menu amount."); }
    });

    // Ingredient dialog
    el.ingredientForm.addEventListener("submit", saveIngredient);
    el.gDelete.addEventListener("click", deleteIngredientFromModal);

    el.unitList.innerHTML = Un.UNIT_CHOICES.filter(Boolean).map((u) => `<option value="${esc(Un.unitLabel(u, 2))}">${esc(Un.unitInfo(u).label || u)}</option>`).join("");
  }

  V.editors = { openRecipeEditor, openPicker, openMealModal, openItemModal, openIngredientModal, releaseImage, isEditingRecipe: () => !!draft, bind };
})(window.Velum);
