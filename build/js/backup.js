/* Velum — settings dialog and backup/restore (file + zero-knowledge encrypted cloud, shared suite worker). */
(function (V) {
  "use strict";
  const U = V.util;
  const M = V.model;
  const S = V.store;
  const Y = V.sync;
  const I = V.images;
  const W = V.views;
  const H = V.shell;
  const el = H.el;
  const esc = U.escapeHtml;

  const REMEMBER_CLOUD_PHRASE_KEY = "velum_cloud_phrase"; // localStorage, opt-in remembered phrase
  const BACKUP_LOG_KEY = "velum_cloud_backup_log";
  const REVISION_KEY = "velum_cloud_revision";
  const SNAPSHOT_ID = "pre-restore";

  // ---------- Backup log / revisions ----------
  function readLog() {
    try { const v = JSON.parse(localStorage.getItem(BACKUP_LOG_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function logBackup(entry) {
    const log = readLog();
    log.unshift(entry);
    try { localStorage.setItem(BACKUP_LOG_KEY, JSON.stringify(log.slice(0, 12))); } catch (e) { /* non-critical */ }
  }
  function nextRevision() {
    const n = (parseInt(localStorage.getItem(REVISION_KEY) || "0", 10) || 0) + 1;
    localStorage.setItem(REVISION_KEY, String(n));
    return n;
  }
  function deviceLabel() {
    const ua = navigator.userAgent || "";
    const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
    const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    return os + " · " + br;
  }
  function usedImageIds() { return Array.from(new Set(S.getDb().recipes.map((r) => r.imageId).filter(Boolean))); }
  async function buildSlice(includePhotos) {
    return Y.createSlice(S.getDb(), {
      theme: H.getThemePref(), revision: nextRevision(), device: deviceLabel(),
      images: includePhotos ? I.subset(usedImageIds()) : {},
    });
  }

  // ---------- Settings ----------
  function openSettings() {
    const s = S.getDb().settings;
    H.updateThemePicker();
    el.sWeekStart.value = String(s.weekStartsOn);
    el.sMeasure.value = s.measurement;
    el.sServB.value = s.servings.breakfast;
    el.sServL.value = s.servings.lunch;
    el.sServD.value = s.servings.dinner;
    el.sGroup.value = s.groupBy;
    el.sPurchased.value = s.purchased;
    el.sPantry.value = s.pantryMode;
    el.sOptional.checked = s.includeOptional;
    el.autoBackup.checked = s.autoBackup;
    el.cloudPhotos.checked = s.cloudPhotos;
    renderAisles();
    renderBackupStatus();
    setCloudStatus("");
    H.openModal("settingsModal");
  }
  function renderAisles() {
    const order = S.getDb().settings.categoryOrder;
    el.sAisles.innerHTML = order.map((c, i) => `<li><span>${M.GROCERY_ICON[c]} ${M.GROCERY_LABEL[c]}</span>
      <button type="button" class="mini-btn" data-aisle="${c}" data-delta="-1" aria-label="Move ${M.GROCERY_LABEL[c]} earlier"${i === 0 ? " disabled" : ""}>▲</button>
      <button type="button" class="mini-btn" data-aisle="${c}" data-delta="1" aria-label="Move ${M.GROCERY_LABEL[c]} later"${i === order.length - 1 ? " disabled" : ""}>▼</button></li>`).join("");
  }
  function savePlanning() {
    H.attempt(() => S.updateSettings({
      weekStartsOn: +el.sWeekStart.value, measurement: el.sMeasure.value,
      servings: { breakfast: el.sServB.value, lunch: el.sServL.value, dinner: el.sServD.value },
    }));
  }
  function saveShopping() {
    H.attempt(() => S.updateSettings({ groupBy: el.sGroup.value, purchased: el.sPurchased.value, pantryMode: el.sPantry.value, includeOptional: el.sOptional.checked }));
  }
  async function renderBackupStatus() {
    const db = S.getDb();
    const log = readLog();
    const cloud = log.find((x) => x.kind === "cloud");
    const file = log.find((x) => x.kind === "file");
    const last = log[0];
    const dirty = db.meta.modifiedAt && (!last || db.meta.modifiedAt > last.at);
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const photosBytes = I.bytesUsed();
    let snap = null;
    try { snap = await I.getSnapshot(SNAPSHOT_ID); } catch (e) { snap = null; }
    el.undoRestoreBtn.hidden = !snap;
    el.backupStatus.innerHTML =
      row("Encryption", "On this device · AES-GCM-256 · PBKDF2-SHA-256 ×600k") +
      row("Last cloud backup", cloud ? esc(U.fmtDateTime(cloud.at)) + " · version #" + cloud.revision + " · " + U.fmtBytes(cloud.bytes || 0) + (cloud.verified ? " · verified ✓" : "") : "Never") +
      row("Last file backup", file ? esc(U.fmtDateTime(file.at)) + " · version #" + file.revision : "Never") +
      row("Since last backup", dirty ? "⚠️ You have unsaved changes" : last ? "✓ Up to date" : "—") +
      row("Automatic backup", db.settings.autoBackup ? (localStorage.getItem(REMEMBER_CLOUD_PHRASE_KEY) ? "On" : "On — waiting for a remembered phrase") : "Off") +
      row("Photos on device", (I.isAvailable() ? U.plural(usedImageIds().length, "photo") + " · " + U.fmtBytes(photosBytes) : "⚠️ Photo storage (IndexedDB) unavailable in this browser")) +
      (snap ? row("Undo available", "Safety copy from " + esc(U.fmtDateTime(snap.savedAt))) : "");
  }

  // ---------- Restore (shared by file + cloud) ----------
  function localCounts(meta) {
    const db = S.getDb();
    return { recipes: db.recipes.length, meals: db.meals.length, items: db.items.length, newer: !!(db.meta.modifiedAt && meta.exportedAt && db.meta.modifiedAt > meta.exportedAt) };
  }
  function previewRestore(res, sourceLabel, envelope) {
    H.openDialog({
      title: "Restore Velum data?",
      body: W.restorePreviewHtml(res, localCounts(res.meta), sourceLabel, envelope),
      submit: "Replace my Velum data",
      submitClass: "btn--danger",
      onSubmit: () => applyRestore(res, sourceLabel),
    });
  }
  async function applyRestore(res, sourceLabel) {
    // Safety copy first, so a restore can always be undone.
    const before = { db: JSON.parse(JSON.stringify(S.getDb())), images: I.all(), theme: H.getThemePref() };
    let saved = false;
    try { saved = await I.saveSnapshot(SNAPSHOT_ID, before); } catch (e) { saved = false; }
    if (!saved && !confirm("Velum couldn't keep a safety copy of your current data (photo storage is unavailable). Restore anyway?")) return false;
    const photos = Object.assign({}, res.photosOmitted ? I.all() : {}, res.images);
    res.db.recipes.forEach((r) => { if (r.imageId && !photos[r.imageId]) r.imageId = null; });
    // Data first (atomic in the store); photos only once the data is safely persisted.
    try { S.replaceDb(res.db); }
    catch (e) { throw new S.ValidationError("Couldn't save the restored data — browser storage is full. Nothing was changed."); }
    try { await I.replaceAll(photos); } catch (e) { H.toast("Data restored, but some photos couldn't be stored."); }
    if (res.theme) H.setTheme(res.theme);
    if (res.meta.revision) localStorage.setItem(REVISION_KEY, String(Math.max(res.meta.revision, parseInt(localStorage.getItem(REVISION_KEY) || "0", 10) || 0)));
    // Verify by re-reading what was persisted.
    let ok = false;
    try {
      const persisted = M.normalizeDb(JSON.parse(localStorage.getItem(S.STORE_KEY)));
      ok = persisted.recipes.length === res.db.recipes.length && persisted.meals.length === res.db.meals.length && persisted.items.length === res.db.items.length;
    } catch (e) { ok = false; }
    logBackup({ kind: "restore", at: new Date().toISOString(), revision: res.meta.revision || 0, source: sourceLabel });
    H.toast(ok ? `Restored ${U.plural(res.db.recipes.length, "recipe")}, ${U.plural(res.db.meals.length, "meal")} and ${U.plural(res.db.lists.length, "list")} — verified.` : "Restore finished, but verification failed. Use Undo last restore if anything looks wrong.");
    setCloudStatus(ok ? "Restored and verified from " + sourceLabel + "." : "Restore could not be verified.", ok ? "success" : "error");
    renderBackupStatus();
    H.closeModals();
    H.navigate("#/");
    return true;
  }
  async function undoRestore() {
    let snap = null;
    try { snap = await I.getSnapshot(SNAPSHOT_ID); } catch (e) { snap = null; }
    if (!snap) { H.toast("There's no restore to undo."); return; }
    if (!confirm("Put back the data you had before the last restore (" + U.fmtDateTime(snap.savedAt) + ")? Changes made since will be replaced.")) return;
    const p = snap.payload || {};
    try { S.replaceDb(p.db); }
    catch (e) { H.toast("Couldn't put the previous data back — browser storage is full."); return; }
    try { await I.replaceAll(p.images || {}); } catch (e) { /* best effort */ }
    if (p.theme) H.setTheme(p.theme);
    await I.deleteSnapshot(SNAPSHOT_ID);
    renderBackupStatus();
    H.toast("Previous data restored.");
  }

  // ---------- File backup ----------
  async function exportFile() {
    el.exportBtn.disabled = true;
    try {
      const slice = await buildSlice(true);
      const data = Y.createBackupData(slice, null);
      const text = JSON.stringify(data, null, 2);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "velum-backup-" + U.todayISO() + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      logBackup({ kind: "file", at: slice.exportedAt, revision: slice.revision, checksum: slice.checksum, bytes: text.length });
      H.toast("Backup file saved (version #" + slice.revision + ").");
      renderBackupStatus();
    } catch (e) {
      H.toast("Couldn't create the backup file.");
    } finally {
      el.exportBtn.disabled = false;
    }
  }
  function importFile(file) {
    if (!file) return;
    if (file.size > 60 * 1024 * 1024) { H.toast("That file is too large to be a Velum backup."); return; }
    const reader = new FileReader();
    reader.onload = async function () {
      el.importFile.value = "";
      let res;
      try {
        res = await Y.readBackup(JSON.parse(reader.result));
      } catch (e) {
        H.toast(e && e.code === "integrity" ? "This backup failed its integrity check — it was changed or damaged." : "That file doesn't contain Velum data.");
        return;
      }
      previewRestore(res, "backup file “" + file.name + "”");
    };
    reader.onerror = () => H.toast("Couldn't read that file.");
    reader.readAsText(file);
  }

  // ---------- Encrypted cloud ----------
  function getPhrase() { return Y.normalizePhrase(el.cloudPhrase.value); }
  function setCloudStatus(msg, kind) {
    el.cloudStatus.textContent = msg || "";
    el.cloudStatus.className = "cloud-data-status" + (kind ? " cloud-data-status--" + kind : "");
  }
  function generatePhrase() {
    if (getPhrase() && !confirm("Replace the phrase in the box with a brand-new one? If you already use a phrase in your other cloud apps, use that instead so they share one backup.")) return;
    el.cloudPhrase.value = Y.createRecoveryPhrase();
    el.cloudPhrase.type = "text";
    el.togglePhraseBtn.textContent = "Hide";
    el.togglePhraseBtn.setAttribute("aria-pressed", "true");
    el.cloudPhraseOut.hidden = false;
    el.cloudPhraseOut.textContent = "Write these " + Y.RECOVERY_PHRASE_WORD_COUNT + " words down. They are the ONLY key to your cloud backup — they can't be recovered.";
    saveRememberedPhrase();
    setCloudStatus("New recovery phrase created. Back up now to use it.", "info");
  }
  function togglePhrase() {
    const show = el.cloudPhrase.type === "password";
    el.cloudPhrase.type = show ? "text" : "password";
    el.togglePhraseBtn.textContent = show ? "Hide" : "Show";
    el.togglePhraseBtn.setAttribute("aria-pressed", String(show));
  }
  function saveRememberedPhrase() {
    if (el.rememberPhrase.checked && getPhrase()) localStorage.setItem(REMEMBER_CLOUD_PHRASE_KEY, getPhrase());
    else if (!el.rememberPhrase.checked) localStorage.removeItem(REMEMBER_CLOUD_PHRASE_KEY);
    renderBackupStatus();
  }
  function loadRememberedPhrase() {
    const saved = localStorage.getItem(REMEMBER_CLOUD_PHRASE_KEY) || "";
    if (!saved) return;
    el.cloudPhrase.value = saved;
    el.rememberPhrase.checked = true;
  }
  function phraseProblem(p) {
    if (!p) return "Enter or create a recovery phrase first.";
    if (p.split(" ").length < 8) return "That phrase looks too short — use your 16-word recovery phrase.";
    return "";
  }
  let cloudBusy = false;
  function setBusy(on) {
    cloudBusy = on;
    [el.cloudSaveBtn, el.cloudLoadBtn, el.generatePhraseBtn].forEach((b) => { b.disabled = on; });
  }
  async function saveCloud(opts) {
    const quiet = opts && opts.quiet;
    const phrase = quiet ? Y.normalizePhrase(localStorage.getItem(REMEMBER_CLOUD_PHRASE_KEY)) : getPhrase();
    const problem = phraseProblem(phrase);
    if (problem) { if (!quiet) setCloudStatus(problem, "error"); return false; }
    if (cloudBusy) return false;
    setBusy(true);
    if (!quiet) setCloudStatus("Encrypting and backing up…", "info");
    try {
      const slice = await buildSlice(S.getDb().settings.cloudPhotos);
      if (!S.getDb().settings.cloudPhotos) slice.photos = "omitted";
      const res = await Y.saveToCloud(phrase, slice);
      if (!quiet) saveRememberedPhrase();
      logBackup({ kind: "cloud", at: slice.exportedAt, revision: slice.revision, checksum: slice.checksum, bytes: res.bytes, verified: true });
      setCloudStatus("Backed up and verified (version #" + slice.revision + ", " + U.fmtBytes(res.bytes) + "). Use the same phrase to restore on any device.", "success");
      renderBackupStatus();
      return true;
    } catch (error) {
      const code = error && error.code;
      const msg = code === "decrypt-existing" ? "A cloud backup already exists for this phrase but couldn't be decrypted. Check the phrase."
        : code === "too-large" ? "The backup is too large (" + U.fmtBytes(error.bytes) + "). Turn off “Include recipe photos” or remove some photos."
        : code === "verify" ? "The upload finished but couldn't be confirmed. Nothing is assumed saved — try again."
        : "Couldn't reach the backup service. Your data is still safe on this device.";
      setCloudStatus(msg, "error");
      if (quiet) H.toast("Automatic backup failed — " + msg);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function loadCloud() {
    const phrase = getPhrase();
    const problem = phraseProblem(phrase);
    if (problem) { setCloudStatus(problem.replace("or create ", ""), "error"); return; }
    if (cloudBusy) return;
    setBusy(true);
    setCloudStatus("Downloading and decrypting…", "info");
    let loaded;
    try {
      loaded = await Y.loadFromCloud(phrase);
    } catch (e) {
      setBusy(false);
      setCloudStatus(e && e.code === "decrypt" ? "Couldn't decrypt the cloud backup — check the phrase." : "Couldn't reach the backup service. Try again later.", "error");
      return;
    }
    setBusy(false);
    if (!loaded) { setCloudStatus("No cloud backup exists for this phrase yet. Back up from your first device.", "error"); return; }
    let res;
    try {
      res = await Y.readBackup(loaded.data);
    } catch (e) {
      setCloudStatus(e && e.code === "integrity" ? "The cloud backup failed its integrity check and wasn't restored." : "This cloud backup has no Velum data yet. Back up from Velum first.", "error");
      return;
    }
    const slice = loaded.data.apps && loaded.data.apps.velum;
    res.photosOmitted = !!(slice && slice.photos === "omitted");
    saveRememberedPhrase();
    setCloudStatus("Backup found — review it before restoring.", "info");
    previewRestore(res, "encrypted cloud backup", loaded.envelope);
  }

  // ---------- Automatic backup (opt-in; only with a remembered phrase) ----------
  let autoTimer = null;
  let lastAutoFor = null;
  function scheduleAutoBackup() {
    const db = S.getDb();
    if (!db.settings.autoBackup || !localStorage.getItem(REMEMBER_CLOUD_PHRASE_KEY)) return;
    if (!db.meta.modifiedAt || db.meta.modifiedAt === lastAutoFor) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {
      const stamp = S.getDb().meta.modifiedAt;
      if (await saveCloud({ quiet: true })) lastAutoFor = stamp;
    }, 45000);
  }

  // ---------- Bulk data ----------
  function addStarters() {
    const have = new Set(S.getDb().recipes.map((r) => r.name.toLowerCase()));
    const fresh = V.demo.starterRecipes().filter((r) => !have.has(r.name.toLowerCase()));
    if (!fresh.length) { H.toast("The starter recipes are already in your library."); return; }
    S.addRecipes(fresh);
    H.closeModals();
    H.toast("Added " + U.plural(fresh.length, "starter recipe") + ".");
    H.navigate("#/recipes");
  }
  async function clearAll() {
    if (!confirm("Delete ALL Velum recipes, menus, shopping lists, catalog and pantry on this device? Your settings and cloud backup are kept.")) return;
    if (!confirm("Really clear everything? Consider exporting a backup file first.")) return;
    S.clearAll();
    try { await I.replaceAll({}); } catch (e) { /* best effort */ }
    H.closeModals();
    H.navigate("#/");
    H.toast("All Velum data cleared.");
  }
  function openAbout() {
    H.closeModals();
    const db = S.getDb();
    el.aboutVersion.textContent = "Version " + H.APP_VERSION;
    el.aboutBuild.innerHTML = [
      ["Build", "No-build vanilla HTML/CSS/JS · " + H.APP_VERSION],
      ["Data schema", "v" + M.SCHEMA_VERSION + " · kashikoi-app-backup-v1"],
      ["Storage", "localStorage + IndexedDB (photos)"],
      ["Sync", "nimbus-sync worker · end-to-end encrypted"],
      ["Library", U.plural(db.recipes.length, "recipe") + " · " + U.plural(db.meals.length, "meal")],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
    H.openModal("aboutModal");
  }

  function bind() {
    el.settingsBtn.addEventListener("click", openSettings);
    el.themePicker.addEventListener("click", (e) => { const chip = e.target.closest(".theme-chip"); if (chip) H.setTheme(chip.dataset.themeVal); });
    el.planningForm.addEventListener("change", savePlanning);
    el.planningForm.addEventListener("submit", (e) => e.preventDefault());
    el.shoppingForm.addEventListener("change", (e) => { if (!e.target.closest("#sAisles")) saveShopping(); });
    el.shoppingForm.addEventListener("submit", (e) => e.preventDefault());
    el.sAisles.addEventListener("click", (e) => {
      const b = e.target.closest("[data-aisle]");
      if (!b) return;
      const order = S.getDb().settings.categoryOrder.slice();
      const i = order.indexOf(b.dataset.aisle), j = i + +b.dataset.delta;
      if (j < 0 || j >= order.length) return;
      order[i] = order[j]; order[j] = b.dataset.aisle;
      S.updateSettings({ categoryOrder: order });
      renderAisles();
      const again = el.sAisles.querySelector(`[data-aisle="${b.dataset.aisle}"][data-delta="${b.dataset.delta}"]:not([disabled])`);
      if (again) again.focus();
    });
    el.autoBackup.addEventListener("change", () => {
      S.updateSettings({ autoBackup: el.autoBackup.checked });
      if (el.autoBackup.checked && !localStorage.getItem(REMEMBER_CLOUD_PHRASE_KEY)) setCloudStatus("Automatic backup needs “Remember on this device” and a phrase.", "info");
      renderBackupStatus();
    });
    el.cloudPhotos.addEventListener("change", () => S.updateSettings({ cloudPhotos: el.cloudPhotos.checked }));
    el.exportBtn.addEventListener("click", exportFile);
    el.importBtn.addEventListener("click", () => el.importFile.click());
    el.importFile.addEventListener("change", () => importFile(el.importFile.files[0]));
    el.undoRestoreBtn.addEventListener("click", undoRestore);
    el.starterBtn.addEventListener("click", addStarters);
    el.clearBtn.addEventListener("click", clearAll);
    el.aboutBtn.addEventListener("click", openAbout);
    el.cloudPhraseForm.addEventListener("submit", (e) => e.preventDefault());
    el.generatePhraseBtn.addEventListener("click", generatePhrase);
    el.togglePhraseBtn.addEventListener("click", togglePhrase);
    el.rememberPhrase.addEventListener("change", saveRememberedPhrase);
    el.cloudSaveBtn.addEventListener("click", () => saveCloud());
    el.cloudLoadBtn.addEventListener("click", loadCloud);
    loadRememberedPhrase();
  }

  V.backup = { openSettings, openAbout, addStarters, scheduleAutoBackup, renderBackupStatus, bind };
})(window.Velum);
