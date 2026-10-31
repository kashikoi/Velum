/* Velum — recipe photos and safety snapshots in IndexedDB.
   Photos never go in localStorage: every suite app on kashikoi.github.io shares that origin's ~5 MB quota.
   Uploads are decoded and re-encoded through a canvas, which strips metadata and anything that isn't pixels. */
(function (V) {
  "use strict";

  const DB_NAME = "velum";
  const DB_VERSION = 1;
  const MAX_INPUT_BYTES = 25 * 1024 * 1024;
  const MAX_EDGE = 1000;
  const cache = new Map(); // id -> data URL, loaded at startup so views can render synchronously
  let idb = null;
  let available = false;

  function open() {
    return new Promise((resolve) => {
      if (typeof indexedDB === "undefined") return resolve(null);
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("images")) d.createObjectStore("images", { keyPath: "id" });
        if (!d.objectStoreNames.contains("snapshots")) d.createObjectStore("snapshots", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  function tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      if (!idb) return resolve(null);
      const t = idb.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  function req(r) { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }

  async function init() {
    idb = await open();
    available = !!idb;
    if (!idb) return false;
    try {
      const all = await tx("images", "readonly", (s) => req(s.getAll()));
      (all || []).forEach((rec) => { if (rec && rec.id && typeof rec.dataUrl === "string") cache.set(rec.id, rec.dataUrl); });
    } catch (e) { /* fall back to an empty cache */ }
    return true;
  }
  function isAvailable() { return available; }
  function get(id) { return id ? cache.get(id) || null : null; }
  function all() { const o = {}; cache.forEach((v, k) => { o[k] = v; }); return o; }
  function subset(ids) { const o = {}; ids.forEach((id) => { if (cache.has(id)) o[id] = cache.get(id); }); return o; }
  async function put(id, dataUrl) {
    cache.set(id, dataUrl);
    if (idb) await tx("images", "readwrite", (s) => { s.put({ id, dataUrl, savedAt: new Date().toISOString() }); });
  }
  async function remove(id) {
    if (!id) return;
    cache.delete(id);
    if (idb) await tx("images", "readwrite", (s) => { s.delete(id); });
  }
  // Replaces every photo (used by restore).
  async function replaceAll(map) {
    cache.clear();
    Object.keys(map).forEach((k) => cache.set(k, map[k]));
    if (idb) {
      await tx("images", "readwrite", (s) => {
        s.clear();
        Object.keys(map).forEach((k) => s.put({ id: k, dataUrl: map[k], savedAt: new Date().toISOString() }));
      });
    }
  }
  // Deletes photos no recipe references any more.
  async function prune(usedIds) {
    const used = new Set(usedIds);
    const drop = Array.from(cache.keys()).filter((k) => !used.has(k));
    for (const k of drop) await remove(k);
    return drop.length;
  }
  function bytesUsed() { let n = 0; cache.forEach((v) => { n += v.length; }); return n; }

  async function saveSnapshot(id, payload) {
    if (!idb) return false;
    await tx("snapshots", "readwrite", (s) => { s.put({ id, payload, savedAt: new Date().toISOString() }); });
    return true;
  }
  async function getSnapshot(id) {
    if (!idb) return null;
    return tx("snapshots", "readonly", (s) => req(s.get(id)));
  }
  async function deleteSnapshot(id) {
    if (idb) await tx("snapshots", "readwrite", (s) => { s.delete(id); });
  }

  // Validates and shrinks an uploaded image to a JPEG data URL (<= 1000px on the long edge).
  async function processFile(file) {
    if (!file) throw new Error("No file selected.");
    if (!/^image\/(jpeg|png|webp|gif|heic|heif|avif)$/i.test(file.type || "")) throw new Error("Please choose a JPEG, PNG, WebP or GIF image.");
    if (file.size > MAX_INPUT_BYTES) throw new Error("That image is larger than 25 MB.");
    let source;
    try {
      source = typeof createImageBitmap === "function" ? await createImageBitmap(file) : await loadViaImg(file);
    } catch (e) {
      throw new Error("That file couldn't be read as an image.");
    }
    const w = source.width, h = source.height;
    if (!w || !h) throw new Error("That image appears to be empty.");
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (source.close) source.close();
    let url = canvas.toDataURL("image/jpeg", 0.8);
    if (url.length > 450 * 1024) url = canvas.toDataURL("image/jpeg", 0.65);
    return url;
  }
  function loadViaImg(file) {
    return new Promise((resolve, reject) => {
      const u = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(u); reject(new Error("decode")); };
      img.src = u;
    });
  }

  V.images = { init, isAvailable, get, all, subset, put, remove, replaceAll, prune, bytesUsed, saveSnapshot, getSnapshot, deleteSnapshot, processFile };
})(typeof window !== "undefined" ? window.Velum : globalThis.Velum);
