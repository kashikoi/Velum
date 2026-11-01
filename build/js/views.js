/* Velum — views: pure render functions (state in, HTML string out). Every user string is escaped.
   Numbers come from Velum.planner / Velum.units; no business rules live here. */
(function (V) {
  "use strict";
  const U = V.util;
  const Un = V.units;
  const M = V.model;
  const P = V.planner;
  const S = V.store;
  const I = V.images;
  const esc = U.escapeHtml;

  // ---------- Building blocks ----------
  function initials(name) {
    return String(name || "").split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  }
  function recipeIcon(r) { return r ? M.CATEGORY_ICON[r.categories[0]] || "🍴" : "📝"; }
  function imgTag(r, alt) {
    const src = r && I.get(r.imageId);
    return src ? `<img src="${esc(src)}" alt="${esc(alt === undefined ? r.name : alt)}" loading="lazy" decoding="async" />` : "";
  }
  function thumb(r, size, fallbackIcon) {
    const img = imgTag(r, "");
    return `<span class="thumb${size ? " thumb--" + size : ""}" aria-hidden="true">${img || (fallbackIcon || recipeIcon(r))}</span>`;
  }
  function placeholder(r) {
    return `<span class="ph"><span>${recipeIcon(r)}</span><span class="recipe-card__initials">${esc(initials(r.name))}</span></span>`;
  }
  function pill(text, tone) { return `<span class="pill${tone ? " pill--" + tone : ""}">${text}</span>`; }
  function pageHead(title, sub, actions) {
    return `<header class="page-head"><div><h2 class="page-head__title">${title}</h2>` +
      (sub ? `<p class="page-head__sub">${sub}</p>` : "") + `</div>` +
      (actions ? `<div class="page-head__actions">${actions}</div>` : "") + `</header>`;
  }
  function stat(label, value) {
    return `<div class="stat"><span class="stat__lbl">${label}</span><span class="stat__val">${value}</span></div>`;
  }
  function bar(pct) { return `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct * 100)}"><div class="bar__fill" style="width:${(pct * 100).toFixed(1)}%"></div></div>`; }
  function timeText(r) { const t = M.totalTime(r); return t ? "⏱ " + U.fmtMinutes(t) : ""; }
  function fmtServ(n) { return Un.formatQty(n, ""); }
  function recipeMap(db) { return new Map(db.recipes.map((r) => [r.id, r])); }
  function mealName(m, recipes) {
    const r = m.recipeId && recipes.get(m.recipeId);
    return r ? r.name : m.title || "Meal";
  }

  function mealChip(m, recipes, opts) {
    const r = m.recipeId && recipes.get(m.recipeId);
    const o = opts || {};
    const meta = [];
    if (r) meta.push("Serves " + fmtServ(m.servings));
    if (r && r.archived) meta.push("archived");
    if (m.note) meta.push(esc(m.note));
    const cls = ["meal-chip", m.done ? "is-done" : "", r ? "" : "is-note", r && r.archived ? "is-archived" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}"${o.draggable ? ` draggable="true"` : ""} data-meal-id="${esc(m.id)}">
      <button type="button" class="done-toggle${m.done ? " is-on" : ""}" data-act="toggle-done" data-id="${esc(m.id)}" aria-pressed="${m.done}" title="${m.done ? "Made it ✓" : "Mark as made"}" aria-label="${m.done ? "Mark not made" : "Mark as made"}: ${esc(mealName(m, recipes))}">✓</button>
      ${r ? thumb(r, "sm") : ""}
      <button type="button" class="meal-chip__text" data-act="open-meal" data-id="${esc(m.id)}">
        <span class="meal-chip__name">${esc(mealName(m, recipes))}</span>
        ${meta.length ? `<span class="meal-chip__meta">${meta.join(" · ")}</span>` : ""}
      </button>
    </div>`;
  }
  function dayOptions(selected, exclude) {
    return M.PLAN_DAYS.filter((day) => day !== exclude).map((day) =>
      `<option value="${day}"${day === selected ? " selected" : ""}>${M.DAY_LABEL[day]}</option>`).join("");
  }
  function slotAdd(day, meal, label) {
    return `<button type="button" class="slot-add" data-act="add-slot" data-day="${day}" data-meal="${meal}" aria-label="Add ${M.MEAL_LABEL[meal]} on ${M.DAY_LABEL[day]}">${label || "+ Add"}</button>`;
  }

  // ---------- Home ----------
  function home(db, ui) {
    const menu = P.menuForPlan(db);
    const stats = P.planStats(db);
    const recipes = recipeMap(db);
    const hasAny = db.recipes.length || db.meals.length;
    if (!hasAny) return welcome();
    const upcoming = db.meals.filter((m) => m.recipeId)
      .sort((a, b) => M.PLAN_DAYS.indexOf(a.day) - M.PLAN_DAYS.indexOf(b.day) ||
        M.MEAL_TYPES.indexOf(a.meal) - M.MEAL_TYPES.indexOf(b.meal) || a.sortOrder - b.sortOrder).slice(0, 8);
    const upcomingHtml = upcoming.length ? `<div class="upcoming">${upcoming.map((m) => {
      const r = recipes.get(m.recipeId);
      return `<a class="up-card" href="#/recipe/${esc(r.id)}?meal=${esc(m.id)}"><span class="up-card__img">${imgTag(r, "") || placeholder(r)}</span>
        <span class="up-card__body"><span class="up-card__when">${M.DAY_LABEL[m.day]} · ${M.MEAL_LABEL[m.meal]}</span><span class="up-card__name">${esc(r.name)}</span></span></a>`;
    }).join("")}</div>` : `<p class="empty-note">No recipes in your plan yet.</p>`;

    const strip = M.PLAN_DAYS.map((d) => {
      const dots = M.MEAL_TYPES.map((t) => {
        const ms = P.slotMeals(db, d, t);
        return `<span class="dot${ms.length ? (ms.every((m) => m.done) ? " is-done" : " is-on") : ""}" title="${M.MEAL_LABEL[t]}"></span>`;
      }).join("");
      return `<a class="week-strip__day" href="#/day/${d}"><span class="week-strip__name">${M.DAY_LABEL[d]}</span><span class="dots">${dots}</span></a>`;
    }).join("");

    const list = menu && S.listForMenu(menu.id);
    let shopHtml;
    if (list) {
      const items = S.listItems(list.id).filter((i) => !i.cleared && !(i.inPantry && !i.pantryOverride));
      const bought = items.filter((i) => i.purchased).length;
      const outdated = S.isListOutdated(list.id);
      shopHtml = `<div class="shop-status"><div class="shop-status__nums"><span><strong>${items.length}</strong> items</span><span><strong>${bought}</strong> bought</span><span><strong>${items.length - bought}</strong> to go</span></div>
        ${bar(items.length ? bought / items.length : 0)}
        ${outdated ? `<div class="insight insight--warn"><span class="insight__body">The menu changed since this list was made.</span><a class="btn btn--tiny" href="#/shopping/${esc(list.id)}">Review</a></div>` : ""}
        <a class="btn btn--ghost" href="#/shopping/${esc(list.id)}">Open shopping list</a></div>`;
    } else {
      shopHtml = `<p class="empty-note">${stats.meals ? "Your menu is ready to shop for." : "Plan a few meals and Velum will add up what to buy."}</p>` +
        (stats.meals ? `<button type="button" class="btn btn--beacon" data-act="create-plan-list">🛒 Build menu shopping list</button>` : "");
    }

    return `
      <section class="hero">
        <div class="hero__top">
          <div><p class="hero__eyebrow">Saturday through Saturday</p>
          <h2 class="hero__title">${esc((menu && menu.name) || "Your menu plan")}</h2></div>
          <a class="btn btn--beacon" href="#/menu">Open menu plan</a>
        </div>
        <div class="hero__meta"><span><strong>${stats.filled}</strong> of ${stats.slots} meals planned</span><span><strong>${stats.unplanned}</strong> open slots</span><span><strong>${stats.done}</strong> made so far</span></div>
        ${bar(stats.filled / stats.slots)}
        <div class="week-strip">${strip}</div>
      </section>
      <div class="home-grid">
        <div class="home-col">
          <section><h3 class="section-title">Planned recipes <a class="link-btn" href="#/menu">Full plan</a></h3>${upcomingHtml}</section>
        </div>
        <div class="home-col">
          <section class="panel"><h3 class="section-title">Shopping</h3>${shopHtml}</section>
          <section><h3 class="section-title">Quick actions</h3>
            <div class="quick-actions">
              <button type="button" class="quick-action" data-act="new-recipe"><span class="quick-action__icon">📝</span>Add a recipe<span class="quick-action__sub">Type it or paste a list</span></button>
              <button type="button" class="quick-action" data-act="plan-meal"><span class="quick-action__icon">🗓️</span>Plan a meal<span class="quick-action__sub">${stats.unplanned} open slots</span></button>
              <a class="quick-action" href="#/shopping"><span class="quick-action__icon">🛒</span>Shopping list<span class="quick-action__sub">Check things off</span></a>
              <a class="quick-action" href="#/recipes"><span class="quick-action__icon">📖</span>Browse recipes<span class="quick-action__sub">${U.plural(db.recipes.filter((r) => !r.archived).length, "recipe")}</span></a>
            </div>
          </section>
        </div>
      </div>`;
  }
  function welcome() {
    return `<div class="empty">
      <div class="empty__icon">🥘</div>
      <h2 class="empty__title">Welcome to Velum</h2>
      <p class="empty__text">Keep the recipes you love, plan breakfast, lunch and dinner from Saturday through Saturday, and Velum adds up exactly what to buy &mdash; combined, converted and sorted by aisle. Your plan stays until you change it.</p>
      <div class="empty__actions">
        <button type="button" class="btn btn--beacon" data-act="new-recipe">+ Add your first recipe</button>
        <button type="button" class="btn btn--ghost" data-act="starter">Load starter recipes</button>
      </div>
      <div class="welcome-steps">
        <div class="insight"><span class="insight__body"><strong>1 · Recipes</strong><br />Type or paste ingredients; Velum understands &ldquo;1 ½ cups flour, sifted&rdquo;.</span></div>
        <div class="insight"><span class="insight__body"><strong>2 · Menu plan</strong><br />Eight days, no calendar dates. Tap a slot to add a recipe, set servings, drag to rearrange.</span></div>
        <div class="insight"><span class="insight__body"><strong>3 · Shopping</strong><br />One tap builds a consolidated list. Re-sync anytime without losing your checks.</span></div>
      </div>
    </div>`;
  }

  // ---------- Menu plan ----------
  function planToolbar(day) {
    const index = M.PLAN_DAYS.indexOf(day);
    return `<div class="week-bar">
      <div class="week-nav">
        ${day ? `${index > 0 ? `<a class="btn btn--icon" href="#/day/${M.PLAN_DAYS[index - 1]}" aria-label="Previous day">‹</a>` : ""}
          <select class="field__input" data-change="pick-day" aria-label="Choose a day">${dayOptions(day)}</select>
          ${index < M.PLAN_DAYS.length - 1 ? `<a class="btn btn--icon" href="#/day/${M.PLAN_DAYS[index + 1]}" aria-label="Next day">›</a>` : ""}`
          : `<span class="week-nav__range">Saturday → Saturday</span>`}
      </div>
      <div class="seg seg--inline" role="tablist">
        <a class="seg__btn${day ? "" : " is-active"}" href="#/menu" role="tab" aria-selected="${!day}">Plan</a>
        <a class="seg__btn${day ? " is-active" : ""}" href="#/day/${day || "saturday"}" role="tab" aria-selected="${!!day}">Day</a>
      </div>
    </div>`;
  }
  function menuPlan(db, ui) {
    const menu = P.menuForPlan(db);
    const recipes = recipeMap(db);
    const days = M.PLAN_DAYS;
    const stats = P.planStats(db);
    const list = menu && S.listForMenu(menu.id);
    const placeholderName = "Your menu plan";

    let grid = `<div class="week-grid" role="grid" aria-label="Eight-day menu plan"><div class="wg-corner"></div>`;
    M.MEAL_TYPES.forEach((t) => {
      grid += `<div class="wg-meal" role="columnheader"><span>${M.MEAL_ICON[t]}</span><span class="wg-meal__label">${M.MEAL_LABEL[t]}</span></div>`;
    });
    days.forEach((d) => {
      grid += `<div class="wg-day" role="rowheader">
        <a class="wg-day__link" href="#/day/${d}"><span class="wg-day__name">${M.DAY_LABEL[d]}</span></a>
        <button type="button" class="mini-btn" data-act="day-menu" data-day="${d}" aria-label="Options for ${M.DAY_LABEL[d]}" title="Copy or clear this day">⋯</button></div>`;
      M.MEAL_TYPES.forEach((t) => {
        const meals = P.slotMeals(db, d, t);
        grid += `<div class="wg-cell${meals.length ? "" : " is-empty"}" data-drop-day="${d}" data-drop-meal="${t}" role="gridcell">` +
          meals.map((m) => mealChip(m, recipes, { draggable: true })).join("") + slotAdd(d, t, meals.length ? "+ Add another" : "+ Add") + `</div>`;
      });
    });
    grid += `</div>`;

    const listHtml = days.map((d) => `<section class="wl-day">
      <div class="wl-day__head"><a class="wl-day__title" href="#/day/${d}">${M.DAY_LABEL[d]}</a>
      <button type="button" class="mini-btn" data-act="day-menu" data-day="${d}" aria-label="Options for ${M.DAY_LABEL[d]}">⋯</button></div>
      ${M.MEAL_TYPES.map((t) => {
        const meals = P.slotMeals(db, d, t);
        return `<div class="wl-row"><span class="wl-row__label">${M.MEAL_LABEL[t]}</span><div class="wl-row__body">${meals.map((m) => mealChip(m, recipes)).join("")}${slotAdd(d, t, meals.length ? "+ Add another" : "+ Add " + M.MEAL_LABEL[t].toLowerCase())}</div></div>`;
      }).join("")}</section>`).join("");

    const shopBtn = list
      ? `<a class="btn btn--beacon" href="#/shopping/${esc(list.id)}">🛒 Shopping list${S.isListOutdated(list.id) ? " · needs update" : ""}</a>`
      : `<button type="button" class="btn btn--beacon" data-act="create-plan-list"${stats.meals ? "" : " disabled"}>🛒 Build shopping list</button>`;

    return `
      <header class="page-head">
        <div style="flex:1 1 320px;min-width:0">
          <input class="menu-name" value="${esc(menu ? menu.name : "")}" placeholder="${esc(placeholderName)}" maxlength="80" data-change="menu-name" aria-label="Menu name" />
          <p class="page-head__sub">One reusable eight-day plan, no dates. Add multiple meals per slot; use notes for who each meal is for${ui.canDrag ? " · drag meals to move them (hold ⌥/Alt to copy)" : ""}.</p>
        </div>
        <div class="page-head__actions">
          <button type="button" class="btn btn--danger btn--tiny" data-act="clear-plan"${stats.meals ? "" : " disabled"}>Clear plan</button>
        </div>
      </header>
      ${planToolbar()}
      ${grid}
      <div class="week-list">${listHtml}</div>
      <div class="week-foot">
        <div class="week-foot__stats"><span><strong>${stats.filled}</strong> of ${stats.slots} planned</span><span><strong>${stats.done}</strong> made</span><span><strong>${stats.unplanned}</strong> open</span></div>
        ${shopBtn}
      </div>`;
  }
  function menuDay(db, ui, day) {
    const recipes = recipeMap(db);
    const cards = M.MEAL_TYPES.map((t) => {
      const meals = P.slotMeals(db, day, t);
      const rows = meals.map((m) => {
        const r = m.recipeId && recipes.get(m.recipeId);
        const meta = [];
        if (r) { meta.push("Serves " + fmtServ(m.servings)); const tt = timeText(r); if (tt) meta.push(tt); }
        if (m.note) meta.push(esc(m.note));
        return `<div class="day-meal">
          <span class="day-meal__img">${r ? imgTag(r, "") || placeholder(r) : "📝"}</span>
          <div><${r ? `a href="#/recipe/${esc(r.id)}?meal=${esc(m.id)}"` : "span"} class="day-meal__name">${esc(mealName(m, recipes))}</${r ? "a" : "span"}>${m.done ? " " + pill("✓ Made", "good") : ""}
            <div class="day-meal__meta">${meta.join(" · ")}</div></div>
          <div class="day-meal__actions">
            <button type="button" class="btn btn--tiny" data-act="toggle-done" data-id="${esc(m.id)}">${m.done ? "Undo made" : "✓ Made it"}</button>
            <button type="button" class="btn btn--ghost btn--tiny" data-act="open-meal" data-id="${esc(m.id)}">Edit</button>
            ${r ? `<a class="btn btn--ghost btn--tiny" href="#/recipe/${esc(r.id)}?meal=${esc(m.id)}&cook=1">Cook</a>` : ""}
          </div></div>`;
      }).join("");
      return `<section class="day-card"><div class="day-card__head"><h3 class="day-card__title">${M.MEAL_ICON[t]} ${M.MEAL_LABEL[t]}</h3>
        <button type="button" class="btn btn--ghost btn--tiny" data-act="add-slot" data-day="${day}" data-meal="${t}">+ Add</button></div>
        ${rows || `<p class="empty-note">Nothing planned.</p>`}</section>`;
    }).join("");
    return `${pageHead(M.DAY_LABEL[day], "Part of your reusable menu plan.",
      `<button type="button" class="btn btn--ghost btn--tiny" data-act="day-menu" data-day="${day}">Copy / clear day…</button>`)}
      ${planToolbar(day)}
      <div class="day-cards">${cards}</div>`;
  }

  // ---------- Recipe library ----------
  function filterRecipes(db, lib) {
    const q = lib.q.trim().toLowerCase();
    let list = db.recipes.filter((r) => (lib.archived ? r.archived : !r.archived));
    if (lib.cat !== "all") list = list.filter((r) => r.categories.indexOf(lib.cat) >= 0);
    if (lib.fav) list = list.filter((r) => r.favorite);
    if (lib.cuisine) list = list.filter((r) => r.cuisine.toLowerCase() === lib.cuisine.toLowerCase());
    if (lib.tag) list = list.filter((r) => r.tags.indexOf(lib.tag) >= 0);
    if (q) {
      list = list.filter((r) => [r.name, r.description, r.cuisine, r.tags.join(" "), r.ingredients.map((g) => g.name).join(" ")].join(" ").toLowerCase().indexOf(q) >= 0);
    }
    const by = {
      recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name),
      used: (a, b) => (b.lastUsedAt || "").localeCompare(a.lastUsedAt || "") || a.name.localeCompare(b.name),
      modified: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      quick: (a, b) => (M.totalTime(a) || 9999) - (M.totalTime(b) || 9999),
    }[lib.sort] || ((a, b) => a.name.localeCompare(b.name));
    return list.slice().sort(by);
  }
  function recipeCard(r) {
    const meta = [timeText(r), r.servings ? "Serves " + fmtServ(r.servings) : "", r.difficulty ? M.DIFFICULTY_LABEL[r.difficulty] : ""].filter(Boolean);
    return `<article class="recipe-card">
      <a class="recipe-card__link" href="#/recipe/${esc(r.id)}">
        <span class="recipe-card__img">${imgTag(r, "") || placeholder(r)}</span>
        <span class="recipe-card__body">
          <span class="recipe-card__name">${esc(r.name)}</span>
          <span class="recipe-card__meta">${meta.map((m) => `<span>${m}</span>`).join("")}</span>
          <span class="recipe-card__pills">${r.categories.map((c) => pill(M.CATEGORY_LABEL[c], "sm")).join("")}${r.cuisine ? pill(esc(r.cuisine), "sm") : ""}</span>
        </span>
      </a>
      <button type="button" class="fav-btn${r.favorite ? " is-on" : ""}" data-act="fav" data-id="${esc(r.id)}" aria-pressed="${r.favorite}" aria-label="${r.favorite ? "Remove from favorites" : "Add to favorites"}: ${esc(r.name)}">${r.favorite ? "♥" : "♡"}</button>
    </article>`;
  }
  function library(db, ui) {
    const lib = ui.lib;
    const active = db.recipes.filter((r) => !r.archived);
    const archivedCount = db.recipes.length - active.length;
    if (!db.recipes.length) {
      return pageHead("Recipes", "Your personal cookbook.") + `<div class="empty"><div class="empty__icon">📖</div><h2 class="empty__title">No recipes yet</h2>
        <p class="empty__text">Add the dishes you cook often. Paste an ingredient list and Velum sorts out quantities and units.</p>
        <div class="empty__actions"><button type="button" class="btn btn--beacon" data-act="new-recipe">+ New recipe</button><button type="button" class="btn btn--ghost" data-act="starter">Load starter recipes</button></div></div>`;
    }
    const cuisines = U.uniqueSorted(active.map((r) => r.cuisine));
    const tags = U.uniqueSorted([].concat.apply([], active.map((r) => r.tags)));
    const list = filterRecipes(db, lib);
    const cats = ["all"].concat(M.RECIPE_CATEGORIES).map((c) => `<button type="button" class="chip${lib.cat === c ? " is-on" : ""}" data-act="lib-cat" data-val="${c}" aria-pressed="${lib.cat === c}">${c === "all" ? "All" : M.CATEGORY_ICON[c] + " " + M.CATEGORY_LABEL[c]}</button>`).join("");
    return `${pageHead("Recipes", U.plural(active.length, "recipe") + (lib.archived ? " · showing archived" : ""), `<button type="button" class="btn btn--beacon" data-act="new-recipe">+ New recipe</button>`)}
      <div class="lib-tools">
        <div class="lib-tools__row">
          <input class="search" id="libSearch" type="search" value="${esc(lib.q)}" placeholder="Search recipes, ingredients, tags…  ( / )" data-input="lib-q" aria-label="Search recipes" />
          <select class="field__input" data-change="lib-sort" aria-label="Sort recipes">
            ${[["recent", "Recently added"], ["name", "Name A–Z"], ["used", "Recently planned"], ["modified", "Recently edited"], ["quick", "Quickest first"]].map(([v, l]) => `<option value="${v}"${lib.sort === v ? " selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <div class="lib-tools__row">
          <div class="chip-toggle">${cats}<button type="button" class="chip${lib.fav ? " is-on" : ""}" data-act="lib-fav" aria-pressed="${lib.fav}">♥ Favorites</button></div>
        </div>
        ${cuisines.length || tags.length || archivedCount ? `<div class="lib-tools__row">
          ${cuisines.length ? `<select class="field__input field__input--sm" data-change="lib-cuisine" aria-label="Filter by cuisine"><option value="">All cuisines</option>${cuisines.map((c) => `<option value="${esc(c)}"${lib.cuisine === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>` : ""}
          ${tags.length ? `<select class="field__input field__input--sm" data-change="lib-tag" aria-label="Filter by tag"><option value="">All tags</option>${tags.map((t) => `<option value="${esc(t)}"${lib.tag === t ? " selected" : ""}>#${esc(t)}</option>`).join("")}</select>` : ""}
          ${archivedCount ? `<button type="button" class="chip${lib.archived ? " is-on" : ""}" data-act="lib-archived" aria-pressed="${lib.archived}">🗄 Archived (${archivedCount})</button>` : ""}
        </div>` : ""}
      </div>
      ${list.length ? `<div class="recipe-grid">${list.map(recipeCard).join("")}</div>` : `<p class="empty-note">No recipes match. <button type="button" class="link-btn" data-act="lib-reset">Clear filters</button></p>`}`;
  }

  // ---------- Recipe detail ----------
  function recipeDetail(db, ui, r, ctx) {
    const servings = ctx.servings;
    const scaled = P.scaledIngredients(r, servings);
    const factor = P.scaleFactor(r, servings);
    const usage = S.recipeUsage(r.id);
    const meal = ctx.mealId ? db.meals.find((m) => m.id === ctx.mealId) : null;
    const groups = [];
    scaled.forEach((g) => {
      let grp = groups.find((x) => x.name === g.group);
      if (!grp) { grp = { name: g.group, items: [] }; groups.push(grp); }
      grp.items.push(g);
    });
    const ingHtml = groups.map((grp) => (grp.name ? `<li class="ing-list__group">${esc(grp.name)}</li>` : "") + grp.items.map((g) => {
      const key = r.id + ":" + g.id;
      const checked = ui.cookChecks.has(key);
      const amount = g.qty == null ? "" : Un.formatAmount(g.qty, g.unit);
      return `<li><label class="ing-line${checked ? " is-checked" : ""}"><input type="checkbox" data-change="ing-check" data-key="${esc(key)}"${checked ? " checked" : ""} />
        <span class="ing-line__text">${amount ? `<span class="ing-line__qty">${esc(amount)}</span> ` : ""}${esc(g.name)}${g.prep ? `<span class="ing-line__prep">, ${esc(g.prep)}</span>` : ""}${g.optional ? " " + pill("optional", "sm") : ""}</span></label></li>`;
    }).join("")).join("");
    const steps = r.steps.map((s, i) => {
      const key = r.id + ":s" + s.id;
      const done = ui.cookChecks.has(key);
      const firstOpen = r.steps.findIndex((x) => !ui.cookChecks.has(r.id + ":s" + x.id));
      return `<li class="${done ? "is-done" : ""}${i === firstOpen && ui.cooking ? " is-current" : ""}" data-act="step-toggle" data-key="${esc(key)}" tabindex="0" role="button" aria-pressed="${done}">${esc(s.text)}</li>`;
    }).join("");
    const t = M.totalTime(r);
    const stats = [
      r.prepMin ? stat("Prep", U.fmtMinutes(r.prepMin)) : "",
      r.cookMin ? stat("Cook", U.fmtMinutes(r.cookMin)) : "",
      t ? stat("Total", U.fmtMinutes(t)) : "",
      stat("Serves", fmtServ(r.servings)),
      r.difficulty ? stat("Difficulty", M.DIFFICULTY_LABEL[r.difficulty]) : "",
    ].join("");
    return `
      ${r.archived ? `<div class="insight insight--warn archived-banner"><span class="insight__body"><strong>Archived.</strong> It's hidden from the library but kept so your plan still shows it.</span><button type="button" class="btn btn--tiny" data-act="restore-recipe" data-id="${esc(r.id)}">Restore to library</button></div>` : ""}
      ${meal ? `<div class="insight insight--good"><span class="insight__body">Planned for <strong>${M.DAY_LABEL[meal.day]} · ${M.MEAL_LABEL[meal.meal]}</strong> — showing amounts for ${fmtServ(meal.servings)} servings.</span><a class="btn btn--tiny" href="#/menu">Back to menu</a></div>` : ""}
      <section class="recipe-hero">
        <div class="recipe-hero__img">${imgTag(r) || placeholder(r)}</div>
        <div class="recipe-hero__body">
          <div class="recipe-hero__pills">${r.categories.map((c) => pill(M.CATEGORY_ICON[c] + " " + M.CATEGORY_LABEL[c])).join("")}${r.cuisine ? pill(esc(r.cuisine), "info") : ""}${r.favorite ? pill("♥ Favorite", "active") : ""}</div>
          <h2 class="recipe-hero__title">${esc(r.name)}</h2>
          ${r.description ? `<p class="recipe-hero__desc">${esc(r.description)}</p>` : ""}
          <div class="stats">${stats}</div>
          ${r.tags.length ? `<div class="recipe-hero__pills">${r.tags.map((x) => `<span class="pill pill--muted pill--sm">#${esc(x)}</span>`).join("")}</div>` : ""}
          <div class="row-actions">
            ${r.archived ? "" : `<button type="button" class="btn btn--beacon" data-act="plan-recipe" data-id="${esc(r.id)}">🗓️ Add to menu</button>`}
            <button type="button" class="btn btn--ghost" data-act="cook-mode">${ui.cooking ? "Exit cook mode" : "👩‍🍳 Cook mode"}</button>
            <button type="button" class="btn btn--ghost" data-act="fav" data-id="${esc(r.id)}" aria-pressed="${r.favorite}">${r.favorite ? "♥ Favorited" : "♡ Favorite"}</button>
            <button type="button" class="btn btn--ghost" data-act="edit-recipe" data-id="${esc(r.id)}">Edit</button>
            <button type="button" class="btn btn--ghost" data-act="dup-recipe" data-id="${esc(r.id)}">Duplicate</button>
            <button type="button" class="btn btn--danger" data-act="delete-recipe" data-id="${esc(r.id)}">${usage.length ? "Archive" : "Delete"}</button>
          </div>
        </div>
      </section>
      <div class="recipe-body">
        <section class="panel">
          <h3 class="section-title">Ingredients</h3>
          <div class="scaler">
            <div class="stepper">
              <button type="button" class="stepper__btn" data-act="scale" data-delta="-1" aria-label="Fewer servings">&minus;</button>
              <input class="stepper__input" type="number" min="0.25" step="any" value="${+(+servings).toFixed(2)}" data-change="scale-input" aria-label="Servings" />
              <button type="button" class="stepper__btn" data-act="scale" data-delta="1" aria-label="More servings">+</button>
            </div>
            <span class="scaler__note">servings${Math.abs(factor - 1) > 1e-9 ? ` · scaled ×${U.round(factor, 2)} from ${fmtServ(r.servings)} <button type="button" class="link-btn" data-act="scale-reset">reset</button>` : ""}</span>
          </div>
          ${scaled.length ? `<ul class="ing-list">${ingHtml}</ul>` : `<p class="empty-note">No ingredients yet.</p>`}
          ${Math.abs(factor - 1) > 1e-9 ? `<p class="field__hint">Scaling here never changes the saved recipe.</p>` : ""}
        </section>
        <section class="panel">
          <h3 class="section-title">Instructions ${r.steps.length ? `<span class="muted">tap a step to mark it done</span>` : ""}</h3>
          ${r.steps.length ? `<ol class="steps">${steps}</ol>` : `<p class="empty-note">No steps yet.</p>`}
          ${r.notes ? `<h3 class="section-title" style="margin-top:18px">Notes</h3><p class="recipe-notes">${esc(r.notes)}</p>` : ""}
          ${r.sourceUrl ? `<p class="field__hint" style="margin-top:12px">Source: <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">${esc(r.sourceUrl.replace(/^https?:\/\//, "").slice(0, 60))}</a></p>` : ""}
        </section>
      </div>
      <p class="recipe-foot"><span>Added ${esc(U.fmtDate(r.createdAt.slice(0, 10)))}</span><span>Edited ${esc(U.fmtDate(r.updatedAt.slice(0, 10)))}</span><span>In ${U.plural(usage.length, "planned meal")}</span></p>`;
  }

  // ---------- Shopping ----------
  function itemRow(it, ui, opts) {
    const amount = it.qty == null ? (it.toTaste ? "to taste" : "") : Un.formatAmount(it.qty, it.unit);
    const bought = it.boughtQty != null ? "had " + Un.formatAmount(it.boughtQty, it.boughtUnit) : "";
    const tags = [
      it.optional ? pill("optional", "sm") : "",
      it.stale ? pill("not on menu", "warn") : "",
      it.qtyEdited ? pill("edited", "info") : "",
      it.toTaste && it.qty != null ? pill("+ to taste", "sm") : "",
    ].join("");
    const sub = [it.pantryNote ? esc(it.pantryNote) : "", it.note ? esc(it.note) : ""].filter(Boolean).join(" · ");
    return `<li class="shop-item${it.purchased ? " is-bought" : ""}${it.stale ? " is-stale" : ""}">
      <button type="button" class="shop-check" data-act="buy" data-id="${esc(it.id)}" aria-pressed="${it.purchased}" aria-label="${it.purchased ? "Unmark" : "Mark"} ${esc(it.name)} as bought">✓</button>
      <button type="button" class="shop-item__main" data-act="buy" data-id="${esc(it.id)}" aria-pressed="${it.purchased}" aria-label="${it.purchased ? "Unmark" : "Mark"} ${esc(it.name)} as bought">
        <span class="shop-item__name">${esc(it.name)} ${tags}</span>
        ${sub ? `<span class="shop-item__sub">${sub}</span>` : ""}
        ${it.change && !it.purchased ? `<span class="shop-item__change">${esc(it.change)}${bought ? " · " + esc(bought) : ""}</span>` : ""}
      </button>
      <span class="shop-item__qty">${esc(amount)}</span>
      <button type="button" class="btn btn--ghost btn--tiny shop-item__edit" data-act="open-item" data-id="${esc(it.id)}" aria-label="Edit ${esc(it.name)}">Edit</button>
      ${opts && opts.pantry ? `<button type="button" class="btn btn--ghost btn--tiny" data-act="pantry-override" data-id="${esc(it.id)}">Need it</button>` : ""}
      ${ui.arrange && !(opts && opts.pantry) ? `<span class="shop-item__arrange"><button type="button" class="mini-btn" data-act="item-move" data-id="${esc(it.id)}" data-delta="-1" aria-label="Move up">▲</button><button type="button" class="mini-btn" data-act="item-move" data-id="${esc(it.id)}" data-delta="1" aria-label="Move down">▼</button></span>` : ""}
    </li>`;
  }
  function shopping(db, ui, list) {
    const thisMenu = P.menuForPlan(db);
    const thisList = thisMenu && S.listForMenu(thisMenu.id);
    const lists = db.lists.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const newPlanBtn = !thisList && db.meals.length
      ? `<button type="button" class="btn btn--beacon" data-act="create-plan-list">🛒 Build list for this plan</button>` : "";
    if (!list) {
      if (ui.phoneChecklist) {
        return `${pageHead("Shopping checklist", "", "")}<div class="empty">
          <h2 class="empty__title">No shopping list on this phone yet</h2>
          <p class="empty__text">Restore a cloud or file backup from your meal-planning device to load its shopping list. Purchase checks are saved on this phone; back up to share them with another device.</p>
          <div class="empty__actions">${newPlanBtn}<button type="button" class="btn btn--beacon" data-act="open-settings">Load saved list</button>
          <button type="button" class="btn btn--ghost" data-act="new-list">+ Blank list</button></div></div>`;
      }
      return `${pageHead("Shopping", "Lists build themselves from your menu plan.", `<button type="button" class="btn btn--ghost" data-act="new-list">+ Blank list</button>`)}
        <div class="empty"><div class="empty__icon">🛒</div><h2 class="empty__title">No shopping list yet</h2>
        <p class="empty__text">${db.meals.length ? "Your menu plan is ready — build a list and Velum will combine every ingredient." : "Plan some meals first, then build a list in one tap. You can also start a blank list for a quick run."}</p>
        <div class="empty__actions">${newPlanBtn || `<a class="btn btn--beacon" href="#/menu">Plan meals</a>`}<button type="button" class="btn btn--ghost" data-act="new-list">+ Blank list</button></div></div>`;
    }
    const all = S.listItems(list.id).filter((i) => !i.cleared);
    const pantrySet = all.filter((i) => i.inPantry && !i.pantryOverride);
    const items = all.filter((i) => !(i.inPantry && !i.pantryOverride));
    const bought = items.filter((i) => i.purchased);
    const linkedMenu = S.menuForList(list);
    const outdated = linkedMenu && S.isListOutdated(list.id);
    const settings = db.settings;
    const order = settings.categoryOrder;
    const sortItems = (arr) => arr.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const open = items.filter((i) => !i.purchased);
    const shownBought = settings.purchased === "inline" ? [] : bought;
    const inlineSet = settings.purchased === "inline" ? items : open;

    let rows = "";
    if (settings.groupBy === "category") {
      order.forEach((cat) => {
        const inCat = sortItems(inlineSet.filter((i) => i.category === cat));
        rows += inCat.map((i) => itemRow(i, ui)).join("");
      });
    } else {
      const flat = sortItems(inlineSet);
      rows = flat.map((i) => itemRow(i, ui)).join("");
    }
    let body = rows ? `<ul class="shop-items" aria-label="Shopping checklist">${rows}</ul>` : "";
    if (!body && items.length) body = `<div class="insight insight--good"><span class="insight__body"><strong>All done!</strong> Everything on the list is in the cart.</span></div>`;
    if (!items.length) body = `<p class="empty-note">This list is empty. Add items above${linkedMenu ? " or add meals to the plan" : ""}.</p>`;
    if (shownBought.length && settings.purchased === "bottom") {
      body += `<section class="aisle"><h3 class="aisle__title">In the cart <span class="aisle__count">${shownBought.length}</span></h3><ul class="shop-items">${shownBought.map((i) => itemRow(i, ui)).join("")}</ul></section>`;
    }
    if (pantrySet.length) {
      body += `<section class="aisle pantry-set"><h3 class="aisle__title">Already in your pantry <span class="aisle__count">${pantrySet.length}</span></h3><ul class="shop-items">${pantrySet.map((i) => itemRow(i, ui, { pantry: true })).join("")}</ul></section>`;
    }

    return `
      <div class="list-bar">
        <select class="field__input" data-change="pick-list" aria-label="Choose a shopping list">
          ${lists.map((l) => `<option value="${esc(l.id)}"${l.id === list.id ? " selected" : ""}>${esc(l.name)}${l.status === "done" ? " ✓" : ""}</option>`).join("")}
        </select>
        <div class="row-actions">
          ${newPlanBtn ? newPlanBtn.replace("btn--beacon", "btn--ghost btn--tiny") : ""}
          <button type="button" class="btn btn--ghost btn--tiny" data-act="new-list">+ New list</button>
          <button type="button" class="btn btn--ghost btn--tiny" data-act="rename-list" data-id="${esc(list.id)}">Rename</button>
          <button type="button" class="btn btn--danger btn--tiny" data-act="delete-list" data-id="${esc(list.id)}">Delete</button>
        </div>
      </div>
      ${linkedMenu ? `<div class="insight${outdated ? " insight--warn" : ""}"><span class="insight__body">${outdated ? "<strong>Your menu changed.</strong> Update to pull in new amounts — your checks and edits are kept." : `From your <strong>Saturday-through-Saturday plan</strong>${list.generatedAt ? " · updated " + esc(U.fmtDateTime(list.generatedAt)) : ""}.`}</span>
        ${ui.phoneChecklist ? "" : `<a class="btn btn--ghost btn--tiny" href="#/menu">Menu</a>`}<button type="button" class="btn ${outdated ? "btn--beacon" : "btn--ghost"} btn--tiny" data-act="regen" data-id="${esc(list.id)}">${outdated ? "Update list" : "Re-sync"}</button></div>` : ""}
      <div class="shop-progress">
        <div class="shop-progress__text"><span><strong>${bought.length}</strong> of ${items.length} in the cart</span><span>${items.length - bought.length} to go</span></div>
        ${bar(items.length ? bought.length / items.length : 0)}
      </div>
      <p class="field__hint">Tap an item or its checkbox to check it off. Changes are saved automatically. Use Edit for amounts, notes, and recipe details.</p>
      <form class="quick-add" data-form="quick-add" data-id="${esc(list.id)}" autocomplete="off">
        <input class="field__input" id="quickAdd" placeholder="Add an item… e.g. 2 lb apples, paper towels" aria-label="Add an item" maxlength="200" />
        <button type="submit" class="btn btn--beacon">Add</button>
      </form>
      <div class="shop-body">${body}</div>
      <div class="list-foot">
        <div class="row-actions">
          <button type="button" class="btn btn--ghost btn--tiny" data-act="clear-done" data-id="${esc(list.id)}"${bought.length ? "" : " disabled"}>Clear ${bought.length || ""} checked</button>
          <button type="button" class="btn btn--ghost btn--tiny" data-act="arrange" aria-pressed="${ui.arrange}">${ui.arrange ? "Done arranging" : "↕ Arrange"}</button>
          <button type="button" class="btn btn--ghost btn--tiny" data-act="group-toggle">${settings.groupBy === "category" ? "Use custom order" : "Use aisle order"}</button>
        </div>
        <button type="button" class="btn btn--ghost btn--tiny" data-act="list-status" data-id="${esc(list.id)}">${list.status === "done" ? "Reopen list" : "✓ Finished shopping"}</button>
      </div>`;
  }

  // ---------- Pantry & catalog ----------
  const STAPLES = ["Olive oil", "Butter", "Flour", "Sugar", "Salt", "Black pepper", "Rice", "Pasta", "Eggs", "Garlic", "Onions", "Soy sauce", "Baking powder", "Vegetable oil"];
  function pantry(db, ui) {
    const tab = ui.pantryTab;
    const tabs = `<div class="seg seg--inline" role="tablist">
      <button type="button" class="seg__btn${tab === "pantry" ? " is-active" : ""}" data-act="pantry-tab" data-val="pantry" role="tab" aria-selected="${tab === "pantry"}">🧺 Pantry (${db.pantry.filter((p) => p.available).length})</button>
      <button type="button" class="seg__btn${tab === "catalog" ? " is-active" : ""}" data-act="pantry-tab" data-val="catalog" role="tab" aria-selected="${tab === "catalog"}">🏷 Ingredient catalog (${db.ingredients.length})</button></div>`;
    if (tab === "catalog") return pageHead("Ingredients & Pantry", "Teach Velum your ingredients so lists stay tidy.", tabs) + catalog(db);
    const modeText = { off: "The pantry is currently ignored when building lists.", flag: "Things you have are set aside in an \"Already in your pantry\" section of your list.", subtract: "Known amounts are subtracted from what recipes need; the rest are set aside." }[db.settings.pantryMode];
    const have = new Set(db.pantry.map((p) => Un.normalizeName(p.name)));
    const staples = STAPLES.filter((s) => !have.has(Un.normalizeName(s)));
    const rows = db.pantry.slice().sort((a, b) => (b.available - a.available) || a.name.localeCompare(b.name)).map((p) => `<li class="pantry-row${p.available ? "" : " is-out"}">
      <label class="switch" title="${p.available ? "I have this" : "Ran out"}"><input type="checkbox" data-change="pantry-avail" data-id="${esc(p.id)}"${p.available ? " checked" : ""} aria-label="Have ${esc(p.name)}" /><span></span></label>
      <span class="pantry-row__name">${esc(p.name)}</span>
      <input class="field__input field__input--sm pantry-row__qty" value="${p.qty == null ? "" : esc(Un.formatQty(p.qty, p.unit))}" placeholder="amount" data-change="pantry-qty" data-id="${esc(p.id)}" aria-label="Amount of ${esc(p.name)} (optional)" />
      <input class="field__input field__input--sm pantry-row__unit" value="${esc(p.unit ? Un.unitLabel(p.unit, p.qty) : "")}" list="unitList" placeholder="unit" data-change="pantry-unit" data-id="${esc(p.id)}" aria-label="Unit for ${esc(p.name)}" />
      <button type="button" class="mini-btn mini-btn--danger" data-act="pantry-del" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button></li>`).join("");
    return `${pageHead("Ingredients & Pantry", "Optional — mark what's already in your kitchen.", tabs)}
      <div class="insight"><span class="insight__body">${modeText} <button type="button" class="link-btn" data-act="open-settings">Change</button></span></div>
      <form class="quick-add" data-form="pantry-add" autocomplete="off">
        <input class="field__input" id="pantryAdd" placeholder="Add something you have… e.g. rice, 2 lb flour" aria-label="Add to pantry" maxlength="200" />
        <button type="submit" class="btn btn--beacon">Add</button>
      </form>
      ${staples.length ? `<div><h3 class="section-title">Common staples</h3><div class="staples">${staples.map((s) => `<button type="button" class="chip" data-act="staple" data-val="${esc(s)}">+ ${esc(s)}</button>`).join("")}</div></div>` : ""}
      ${rows ? `<ul class="pantry-list">${rows}</ul>` : `<p class="empty-note">Your pantry is empty. You don't need to track anything here — it just helps trim your shopping list.</p>`}`;
  }
  function catalog(db) {
    const rows = db.ingredients.slice().sort((a, b) => a.name.localeCompare(b.name)).map((g) => `<tr data-edit-ingredient="${esc(g.id)}" tabindex="0">
      <td><strong>${esc(g.name)}</strong>${g.aliases.length ? `<div class="muted" style="font-size:0.74rem">aka ${esc(g.aliases.join(", "))}</div>` : ""}</td>
      <td>${M.GROCERY_ICON[g.category]} ${M.GROCERY_LABEL[g.category]}</td>
      <td class="hide-sm">${esc(g.defaultUnit ? Un.unitLabel(g.defaultUnit, 2) : "—")}</td>
      <td class="hide-sm">${g.gramsPerCup ? esc(String(g.gramsPerCup)) + " g/cup" : "—"}</td></tr>`).join("");
    return `<div class="row-actions">
        <button type="button" class="btn btn--beacon btn--tiny" data-act="new-ingredient">+ Add ingredient</button>
        <button type="button" class="btn btn--ghost btn--tiny" data-act="learn">Add everything from my recipes</button>
      </div>
      <p class="field__hint">The catalog is optional. Entries set the aisle for an ingredient, merge different names (aliases) into one shopping line, and with &ldquo;grams per cup&rdquo; let cups and grams combine.</p>
      ${rows ? `<div class="panel table-wrap"><table class="tbl"><thead><tr><th>Ingredient</th><th>Aisle</th><th class="hide-sm">Default unit</th><th class="hide-sm">Density</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="empty-note">No catalog entries yet. Velum still guesses aisles on its own; add entries when you want to correct or merge something.</p>`}`;
  }

  // ---------- Dialog bodies ----------
  function changesHtml(ch) {
    const li = (arr, fn) => arr.map((x) => `<li>${fn(x)}</li>`).join("");
    const groups = [];
    if (ch.added.length) groups.push(`<div class="changes__group changes__group--add"><h4>Added (${ch.added.length})</h4><ul>${li(ch.added, (i) => esc(i.name) + (i.qty != null ? " — " + esc(Un.formatAmount(i.qty, i.unit)) : ""))}</ul></div>`);
    if (ch.updated.length) groups.push(`<div class="changes__group changes__group--up"><h4>Updated (${ch.updated.length})</h4><ul>${li(ch.updated, (u) => esc(u.item.name) + (u.from ? ": " + esc(u.from) + " → " + esc(u.to) : " — " + esc(u.to)) + (ch.unpurchased.indexOf(u.item) >= 0 ? " <em>(unchecked — you need more now)</em>" : ""))}</ul></div>`);
    if (ch.conflicts.length) groups.push(`<div class="changes__group changes__group--keep"><h4>Your edits kept (${ch.conflicts.length})</h4><ul>${li(ch.conflicts, (c) => esc(c.item.name) + ": you set " + esc(Un.formatAmount(c.item.qty, c.item.unit) || "—") + "; menu now needs " + esc(c.to))}</ul></div>`);
    if (ch.removed.length) groups.push(`<div class="changes__group changes__group--rm"><h4>Removed — no longer needed (${ch.removed.length})</h4><ul>${li(ch.removed, (i) => esc(i.name))}</ul></div>`);
    if (ch.stale.length) groups.push(`<div class="changes__group changes__group--keep"><h4>Kept but no longer on the menu (${ch.stale.length})</h4><ul>${li(ch.stale, (i) => esc(i.name) + (i.purchased ? " (already bought)" : " (you edited it)"))}</ul></div>`);
    const kept = [];
    if (ch.manualKept) kept.push(U.plural(ch.manualKept, "item") + " you added");
    if (ch.unchanged) kept.push(ch.unchanged + " unchanged");
    return `<div class="changes">${groups.join("") || `<p class="empty-note">Already up to date — nothing to change.</p>`}${kept.length ? `<p class="field__hint">Untouched: ${kept.join(" · ")}. Checked-off items stay checked unless you now need more.</p>` : ""}</div>`;
  }
  function restorePreviewHtml(res, local, sourceLabel, envelope) {
    const m = res.meta, c = m.counts;
    const lc = local;
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    return `<p class="field__hint" style="margin-bottom:10px">Restoring replaces the Velum data on this device. A safety copy of your current data is kept so you can undo.</p>
      <dl class="restore-meta">
        ${row("Source", esc(sourceLabel))}
        ${row("Backed up", esc(m.exportedAt ? U.fmtDateTime(m.exportedAt) : "unknown"))}
        ${envelope && envelope.storedAt ? row("Stored in cloud", esc(U.fmtDateTime(envelope.storedAt))) : ""}
        ${m.revision ? row("Backup version", "#" + m.revision) : ""}
        ${m.device ? row("From device", esc(m.device)) : ""}
        ${row("Integrity", res.integrity === "verified" ? "✅ Checksum verified" + (envelope ? " · AES-GCM authenticated" : "") : "⚠️ No checksum in this older backup")}
        ${res.rejectedImages ? row("Photos skipped", res.rejectedImages + " invalid photo(s) were ignored") : ""}
      </dl>
      <div class="restore-counts">
        ${stat("Recipes", c.recipes + (c.archived ? " (+" + c.archived + " archived)" : ""))}${stat("Photos", c.photos)}${stat("Menus", c.menus)}${stat("Meals", c.meals)}
        ${stat("Lists", c.lists)}${stat("List items", c.items)}${stat("Catalog", c.ingredients)}${stat("Pantry", c.pantry)}
      </div>
      <p class="field__hint" style="margin-top:10px">On this device now: ${U.plural(lc.recipes, "recipe")}, ${U.plural(lc.meals, "meal")}, ${U.plural(lc.items, "list item")}.${lc.newer ? " <strong>This device has changes newer than the backup.</strong>" : ""}</p>`;
  }

  V.views = { home, menuPlan, menuDay, library, recipeDetail, shopping, pantry, changesHtml, restorePreviewHtml, thumb, imgTag, placeholder, recipeIcon, filterRecipes, mealName, dayOptions };
})(typeof window !== "undefined" ? window.Velum : globalThis.Velum);
