/* Velum — UI shell: shared UI state, element cache, routing, rendering, toasts, modals, generic dialog, theme. */
(function (V) {
  "use strict";
  const U = V.util;
  const P = V.planner;
  const S = V.store;
  const W = V.views;
  const esc = U.escapeHtml;

  const APP_VERSION = "2026.11.01.5";
  const THEME_KEY = "velum_cloud_theme";
  const ACTIVE_THEME_KEY = "velum_cloud_active_theme";
  const THEMES = ["day", "twilight", "night"];
  const DEFAULT_THEME = "day";

  const el = {};
  const ui = {
    route: { name: "home", arg: null, query: {} },
    lib: { q: "", cat: "all", fav: false, cuisine: "", tag: "", sort: "recent", archived: false },
    recipeServings: new Map(),
    cookChecks: new Set(),
    cooking: false,
    arrange: false,
    pantryTab: "pantry",
    listId: null,
    phoneChecklist: document.documentElement.classList.contains("phone-checklist"),
    canDrag: typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches,
  };

  function $(id) { return document.getElementById(id); }

  // ---------- Toast (with optional Undo) ----------
  function toast(msg, action) {
    el.toastText.textContent = msg;
    el.toast.hidden = false;
    el.toastAction.hidden = !action;
    el.toastAction.textContent = action ? action.label : "";
    toast._action = action || null;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.toast.hidden = true; toast._action = null; }, action ? 6000 : 3200);
  }
  function runToastAction() {
    const a = toast._action;
    el.toast.hidden = true;
    toast._action = null;
    if (a) a.run();
  }
  // Runs a store mutation; validation errors are shown, never thrown into the UI.
  function attempt(fn, errEl) {
    try {
      if (errEl) errEl.hidden = true;
      return { ok: true, value: fn() };
    } catch (err) {
      const msg = err instanceof S.ValidationError ? err.message : "Something went wrong: " + (err && err.message);
      if (errEl) { errEl.textContent = msg; errEl.hidden = false; errEl.scrollIntoView({ block: "nearest" }); } else toast(msg);
      if (!(err instanceof S.ValidationError)) console.error(err);
      return { ok: false };
    }
  }

  // ---------- Modals ----------
  const MODALS = ["recipeModal", "pickerModal", "mealModal", "itemModal", "ingredientModal", "dialogModal", "settingsModal", "aboutModal"];
  let lastFocus = null;
  let zCounter = 0;
  // Later-opened dialogs stack on top (e.g. the restore preview over Settings).
  function openModal(id, focusEl) {
    if (!anyModalOpen()) { lastFocus = document.activeElement; zCounter = 0; }
    el[id].style.zIndex = String(200 + (++zCounter));
    el[id].hidden = false;
    const target = focusEl || el[id].querySelector("input:not([type=hidden]):not([hidden]), select, textarea, button.modal__close");
    if (target) setTimeout(() => target.focus({ preventScroll: true }), 30);
  }
  function closeModal(id) {
    el[id].hidden = true;
    if (!anyModalOpen() && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }
  function closeModals() { MODALS.forEach((id) => { el[id].hidden = true; }); }
  function anyModalOpen() { return MODALS.some((id) => !el[id].hidden); }
  function topModal() {
    let best = null, z = -1;
    MODALS.forEach((id) => { if (!el[id].hidden && +el[id].style.zIndex > z) { z = +el[id].style.zIndex; best = id; } });
    return best;
  }

  // Generic dialog: { title, body, submit, submitClass, onSubmit(form) -> false keeps it open, onOpen(body) }
  let dialogCfg = null;
  function openDialog(cfg) {
    dialogCfg = cfg;
    el.dialogTitle.textContent = cfg.title;
    el.dialogBody.innerHTML = cfg.body;
    el.dError.hidden = true;
    el.dialogActions.innerHTML = (cfg.extra || "") +
      `<button type="button" class="btn btn--ghost" data-close>${esc(cfg.cancel || "Cancel")}</button>` +
      (cfg.submit ? `<button type="submit" class="btn ${cfg.submitClass || "btn--beacon"}">${esc(cfg.submit)}</button>` : "");
    openModal("dialogModal");
    if (cfg.onOpen) cfg.onOpen(el.dialogBody);
  }
  async function submitDialog(e) {
    e.preventDefault();
    if (!dialogCfg || !dialogCfg.onSubmit) return;
    const btn = el.dialogActions.querySelector("[type=submit]");
    if (btn) btn.disabled = true;
    try {
      let keep = false;
      const r = attempt(() => dialogCfg.onSubmit(el.dialogForm), el.dError);
      if (!r.ok) keep = true;
      else if (r.value && typeof r.value.then === "function") {
        try { keep = (await r.value) === false; }
        catch (err) {
          keep = true;
          el.dError.textContent = err instanceof S.ValidationError ? err.message : "Something went wrong: " + (err && err.message);
          el.dError.hidden = false;
        }
      }
      else keep = r.value === false;
      if (!keep) { dialogCfg = null; closeModal("dialogModal"); }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---------- Theme / atmosphere ----------
  function getThemePref() {
    const pref = localStorage.getItem(THEME_KEY);
    return pref === "day" || pref === "twilight" || pref === "night" || pref === "random" ? pref : DEFAULT_THEME;
  }
  function applyThemeClass(mode) {
    const root = document.documentElement;
    root.classList.remove("day", "twilight");
    if (mode === "day") root.classList.add("day");
    else if (mode === "twilight") root.classList.add("twilight");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mode === "day" ? "#163e7a" : mode === "twilight" ? "#34264a" : "#050b18");
  }
  function setTheme(pref) {
    if (["day", "twilight", "night", "random"].indexOf(pref) < 0) return;
    localStorage.setItem(THEME_KEY, pref);
    if (pref === "random") {
      const active = THEMES[Math.floor(Math.random() * THEMES.length)];
      sessionStorage.setItem(ACTIVE_THEME_KEY, active);
      applyThemeClass(active);
    } else {
      sessionStorage.removeItem(ACTIVE_THEME_KEY);
      applyThemeClass(pref);
    }
    updateThemePicker();
  }
  function updateThemePicker() {
    const pref = getThemePref();
    el.themePicker.querySelectorAll(".theme-chip").forEach((chip) => {
      const on = chip.dataset.themeVal === pref;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-checked", String(on));
    });
  }

  // ---------- Routing ----------
  // #/  #/menu  #/day/<day-key>  #/recipes  #/recipe/<id>[?meal=&cook=1]  #/shopping[/<listId>]  #/pantry
  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const query = {};
    (qs || "").split("&").filter(Boolean).forEach((kv) => { const [k, v] = kv.split("="); query[decodeURIComponent(k)] = decodeURIComponent(v || ""); });
    const name = ["menu", "day", "recipes", "recipe", "shopping", "pantry"].indexOf(parts[0]) >= 0 ? parts[0] : "home";
    if (ui.phoneChecklist) return { name: "shopping", arg: name === "shopping" ? parts[1] || null : null, query: {} };
    let arg = parts[1] || null;
    if (name === "menu") arg = null;
    if (name === "day" && !V.model.isPlanDay(arg)) arg = U.isISODate(arg) ? V.model.legacyDay(arg) : "saturday";
    return { name, arg, query };
  }
  function navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }
  const NAV = [
    { id: "home", icon: "🏠", label: "Overview", short: "Home", href: "#/" },
    { id: "menu", icon: "🗓️", label: "Menu plan", short: "Menu", href: "#/menu" },
    { id: "recipes", icon: "📖", label: "Recipes", short: "Recipes", href: "#/recipes" },
    { id: "shopping", icon: "🛒", label: "Shopping", short: "Shop", href: "#/shopping" },
    { id: "pantry", icon: "🧺", label: "Ingredients & pantry", short: "Pantry", href: "#/pantry" },
  ];
  function navSection(name) { return name === "day" ? "menu" : name === "recipe" ? "recipes" : name; }

  function currentList(db) {
    const r = ui.route;
    if (r.name === "shopping" && r.arg) return db.lists.find((l) => l.id === r.arg) || null;
    const remembered = ui.listId && db.lists.find((l) => l.id === ui.listId);
    if (remembered) return remembered;
    const menu = P.menuForPlan(db);
    const planList = menu && S.listForMenu(menu.id);
    if (planList) return planList;
    const active = db.lists.filter((l) => l.status === "active").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return active[0] || db.lists.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
  }
  function remaining(db, list) {
    if (!list) return 0;
    return S.listItems(list.id).filter((i) => !i.cleared && !i.purchased && !(i.inPantry && !i.pantryOverride)).length;
  }

  function renderRail(db) {
    const stats = P.planStats(db);
    const list = currentList(db);
    const left = remaining(db, list);
    el.railSummary.innerHTML =
      `<div class="stat-mini"><span class="stat-mini__val">${stats.filled}/${stats.slots}</span><span class="stat-mini__lbl">Planned</span></div>` +
      `<div class="stat-mini"><span class="stat-mini__val">${db.recipes.filter((r) => !r.archived).length}</span><span class="stat-mini__lbl">Recipes</span></div>` +
      `<div class="stat-mini${left ? " is-alert" : ""}"><span class="stat-mini__val">${left}</span><span class="stat-mini__lbl">To buy</span></div>`;
    const section = navSection(ui.route.name);
    const badges = { shopping: left };
    el.navList.innerHTML = NAV.map((n) => {
      const b = badges[n.id];
      return `<li><a class="nav-item${section === n.id ? " is-active" : ""}" href="${n.href}"${section === n.id ? ' aria-current="page"' : ""}>` +
        `<span class="nav-item__icon">${n.icon}</span><span class="nav-item__label">${n.label}</span>${b ? `<span class="nav-item__badge nav-item__badge--alert">${b}</span>` : ""}</a></li>`;
    }).join("");
    el.tabbar.innerHTML = NAV.map((n) => {
      const b = badges[n.id];
      return `<a class="tab${section === n.id ? " is-active" : ""}" href="${n.href}"${section === n.id ? ' aria-current="page"' : ""}><span class="tab__icon">${n.icon}</span>${n.short}${b ? `<span class="tab__badge">${b}</span>` : ""}</a>`;
    }).join("");
  }
  function renderCrumb(db) {
    if (ui.phoneChecklist) {
      el.crumb.innerHTML = `<span class="crumb__item crumb__home">VELUM</span><span class="crumb__sep">›</span><span class="crumb__item is-current">Shopping</span>`;
      return;
    }
    const r = ui.route;
    const section = NAV.find((n) => n.id === navSection(r.name));
    let html = `<a class="crumb__item crumb__home" href="#/">VELUM</a>`;
    if (r.name !== "home") {
      html += `<span class="crumb__sep">›</span><a class="crumb__item${r.name === section.id ? " is-current" : ""}" href="${section.href}">${section.label}</a>`;
    }
    if (r.name === "recipe") {
      const rec = db.recipes.find((x) => x.id === r.arg);
      if (rec) html += `<span class="crumb__sep">›</span><span class="crumb__item is-current">${esc(rec.name)}</span>`;
    } else if (r.name === "day") {
      html += `<span class="crumb__sep">›</span><span class="crumb__item is-current">${V.model.DAY_LABEL[r.arg]}</span>`;
    }
    el.crumb.innerHTML = html;
  }

  function canvasHtml(db) {
    const r = ui.route;
    document.documentElement.classList.toggle("cooking", ui.cooking && r.name === "recipe");
    switch (r.name) {
      case "menu": return W.menuPlan(db, ui);
      case "day": return W.menuDay(db, ui, r.arg);
      case "recipes": return W.library(db, ui);
      case "recipe": {
        const rec = db.recipes.find((x) => x.id === r.arg);
        if (!rec) return `<div class="empty"><div class="empty__icon">🔍</div><h2 class="empty__title">Recipe not found</h2><p class="empty__text">It may have been deleted.</p><a class="btn btn--beacon" href="#/recipes">Back to recipes</a></div>`;
        const meal = r.query.meal ? db.meals.find((m) => m.id === r.query.meal && m.recipeId === rec.id) : null;
        const servings = ui.recipeServings.get(rec.id) || (meal ? meal.servings : rec.servings);
        return W.recipeDetail(db, ui, rec, { servings, mealId: meal ? meal.id : null });
      }
      case "shopping": {
        const list = currentList(db);
        if (list) ui.listId = list.id;
        return W.shopping(db, ui, list);
      }
      case "pantry": return W.pantry(db, ui);
      default: return W.home(db, ui);
    }
  }
  // Re-renders everything, keeping focus/caret in a search/quick-add field that survives the re-render.
  function render() {
    const db = S.getDb();
    const active = document.activeElement;
    const keep = active && active.id && el.canvas.contains(active) ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    renderRail(db);
    renderCrumb(db);
    el.canvas.innerHTML = `<div class="canvas__inner${ui.route.name === "shopping" || ui.route.name === "pantry" ? " canvas__inner--narrow" : ""}">${canvasHtml(db)}</div>`;
    if (keep) {
      const again = $(keep.id);
      if (again) {
        again.focus({ preventScroll: true });
        try { if (keep.start != null) again.setSelectionRange(keep.start, keep.end); } catch (e) { /* not a text input */ }
      }
    }
  }
  function onRoute() {
    const prev = ui.route;
    ui.route = parseRoute();
    if (ui.route.name !== "recipe" || (prev.name === "recipe" && prev.arg !== ui.route.arg)) {
      if (ui.cooking) V.shell.setCooking(false);
    }
    if (ui.route.name === "recipe" && ui.route.query.cook === "1" && !ui.cooking) V.shell.setCooking(true);
    if (ui.route.name === "shopping" && ui.route.arg) ui.listId = ui.route.arg;
    render();
    if (prev.name !== ui.route.name || prev.arg !== ui.route.arg) {
      el.canvas.scrollTop = 0;
      if (window.scrollY) window.scrollTo(0, 0);
    }
  }

  // ---------- Cook mode (keeps the screen awake where supported) ----------
  let wakeLock = null;
  async function setCooking(on) {
    ui.cooking = !!on;
    document.documentElement.classList.toggle("cooking", ui.cooking);
    try {
      if (on && navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }

  V.shell = {
    APP_VERSION, el, ui, $, toast, runToastAction, attempt,
    MODALS, openModal, closeModal, closeModals, anyModalOpen, topModal, openDialog, submitDialog,
    getThemePref, setTheme, updateThemePicker, applyThemeClass,
    parseRoute, navigate, render, onRoute, currentList, setCooking,
  };
})(window.Velum);
