/* Velum — unified Kashikoi backup + zero-knowledge encrypted cloud sync (shared suite worker). No DOM.
   Same worker, envelope, PBKDF2(600k)/AES-GCM-256 and 16-word phrase as Virga/Arcus/Anvil/Cirrus/etc. */
(function (V) {
  "use strict";
  const U = V.util;
  const M = V.model;

  const CLOUD_SYNC_ENDPOINT = "https://nimbus-sync.nimbus-sync.workers.dev";
  const CLOUD_SYNC_FORMAT = "kashikoi-encrypted-backup-v1";
  const LEGACY_CLOUD_SYNC_FORMAT = "nimbus-encrypted-backup-v1";
  const UNIFIED_BACKUP_SCHEMA = "kashikoi-app-backup-v1";
  // The shared Worker only accepts envelopes tagged "Nimbus"/"Cumulus"; every suite app reads/writes the same
  // blob, so Velum tags it "Nimbus" (author recorded in `writtenBy`) and keeps its own slice in `apps.velum`.
  const CLOUD_ENVELOPE_APP = "Nimbus";
  const ACCEPTED_ENVELOPE_APPS = new Set(["Nimbus", "Cumulus", "Cirrus", "Stratus", "Anvil", "Arcus", "Virga", "Velum"]);
  const RECOVERY_PHRASE_WORD_COUNT = 16;
  const CLOUD_KDF_ITERATIONS = 600000;
  const MAX_CLOUD_BYTES = 24 * 1024 * 1024; // Workers KV values max out at 25 MiB
  const DB_KEYS = ["schemaVersion", "settings", "recipes", "menus", "meals", "lists", "items", "ingredients", "pantry", "meta"];
  const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
  const MAX_IMAGE_CHARS = 3 * 1024 * 1024;
  const RECOVERY_WORDS = [
    "anchor", "apricot", "arbor", "aurora", "basalt", "beacon", "birch", "bison",
    "blossom", "boulder", "breeze", "canyon", "cedar", "cinder", "cirrus", "clay",
    "clover", "cobalt", "comet", "coral", "cove", "crater", "crystal", "cumulus",
    "current", "dawn", "delta", "dune", "ember", "evergreen", "fathom", "fern",
    "fjord", "flint", "forge", "fossil", "galaxy", "garnet", "geyser", "glacier",
    "granite", "grove", "harbor", "hazel", "heather", "horizon", "ivory", "jade",
    "juniper", "kelp", "lagoon", "lantern", "lichen", "lilac", "lumen", "magma",
    "maple", "marble", "meadow", "meridian", "mesa", "mica", "mist", "monsoon",
    "moss", "nebula", "nectar", "oasis", "obsidian", "ocean", "onyx", "opal",
    "orchard", "pebble", "petal", "pine", "pollen", "prairie", "quartz", "quill",
    "rapids", "ravine", "reef", "ridge", "ripple", "river", "sable", "saffron",
    "sage", "sandbar", "sapphire", "savanna", "sequoia", "shale", "shore", "sierra",
    "slate", "solstice", "spruce", "storm", "summit", "tempest", "thicket", "thunder",
    "tide", "timber", "topaz", "trellis", "tundra", "valley", "vapor", "verdant",
    "vertex", "vista", "willow", "wisp", "zenith", "zephyr",
  ];

  // ---------- Hashing ----------
  async function sha256Hex(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function pickDb(src) {
    const out = {};
    DB_KEYS.forEach((k) => { if (src[k] !== undefined) out[k] = src[k]; });
    return out;
  }
  function checksumOf(dbPart, images) { return sha256Hex(U.canonicalJSON({ db: dbPart, images: images || {} })); }
  function countsOf(db, images) {
    return {
      recipes: db.recipes.filter((r) => !r.archived).length, archived: db.recipes.filter((r) => r.archived).length,
      menus: db.menus.length, meals: db.meals.length, lists: db.lists.length, items: db.items.length,
      ingredients: db.ingredients.length, pantry: db.pantry.length, occasional: (db.occasional || []).length, photos: Object.keys(images || {}).length,
    };
  }

  // ---------- Unified backup ----------
  // Builds Velum's slice. `revision` increases with every backup so restores can show which version they are.
  async function createSlice(db, opts) {
    const o = opts || {};
    const dbPart = JSON.parse(JSON.stringify(pickDb(db)));
    const images = o.images || {};
    return Object.assign({
      version: 1, appName: "Velum", exportedAt: new Date().toISOString(), theme: o.theme || "day",
      revision: o.revision || 1, device: U.str(o.device, 80), counts: countsOf(db, images),
      checksum: await checksumOf(dbPart, images), images,
    }, dbPart);
  }
  function existingApps(existing) {
    if (!existing || typeof existing !== "object") return {};
    if (existing.schema === UNIFIED_BACKUP_SCHEMA && existing.apps && typeof existing.apps === "object") return Object.assign({}, existing.apps);
    if (existing.appName === "Nimbus" || Array.isArray(existing.tabs)) return { nimbus: existing };
    if (existing.appName === "Cumulus" || Array.isArray(existing.accounts)) return { cumulus: existing };
    if (existing.appName === "Cirrus" || Array.isArray(existing.movies)) return { cirrus: existing };
    if (existing.appName === "Stratus" || Array.isArray(existing.stamps)) return { stratus: existing };
    if (existing.appName === "Anvil" || Array.isArray(existing.runbooks)) return { anvil: existing };
    if (existing.appName === "Arcus" || Array.isArray(existing.goals)) return { arcus: existing };
    if (existing.appName === "Virga" || (Array.isArray(existing.parts) && Array.isArray(existing.orders))) return { virga: existing };
    if (existing.appName === "Velum" || (Array.isArray(existing.recipes) && Array.isArray(existing.meals))) return { velum: existing };
    return {};
  }
  // Preserves every sibling app's slice; only Velum's slice is replaced.
  function createBackupData(slice, existing) {
    const apps = existingApps(existing);
    apps.velum = slice;
    return { schema: UNIFIED_BACKUP_SCHEMA, version: 1, appName: "Kashikoi Apps", exportedAt: new Date().toISOString(), apps };
  }
  // Accepts a unified backup or a bare Velum slice. Verifies the checksum, validates photos, normalizes data.
  async function readBackup(data) {
    if (!data || typeof data !== "object") throw new Error("Invalid format");
    const slice = data.schema === UNIFIED_BACKUP_SCHEMA && data.apps ? data.apps.velum : data;
    if (!slice || typeof slice !== "object" || !Array.isArray(slice.recipes) || !Array.isArray(slice.meals)) {
      const err = new Error("No Velum data"); err.code = "no-data"; throw err;
    }
    const rawImages = slice.images && typeof slice.images === "object" ? slice.images : {};
    let integrity = "unverified";
    if (typeof slice.checksum === "string") {
      const actual = await checksumOf(pickDb(slice), rawImages);
      if (actual !== slice.checksum) { const err = new Error("Checksum mismatch"); err.code = "integrity"; throw err; }
      integrity = "verified";
    }
    const images = {};
    const rejectedIds = new Set();
    Object.keys(rawImages).forEach((k) => {
      const v = rawImages[k];
      if (/^[A-Za-z0-9_-]{1,40}$/.test(k) && typeof v === "string" && v.length <= MAX_IMAGE_CHARS && IMAGE_RE.test(v)) images[k] = v;
      else rejectedIds.add(k);
    });
    const rejected = rejectedIds.size;
    const db = M.normalizeDb(slice);
    // Photos may legitimately be absent (cloud backups can omit them); only unsafe ones are unlinked here.
    db.recipes.forEach((r) => { if (r.imageId && rejectedIds.has(r.imageId)) r.imageId = null; });
    return {
      db, images, integrity, rejectedImages: rejected,
      theme: typeof slice.theme === "string" ? slice.theme : null,
      meta: {
        exportedAt: typeof slice.exportedAt === "string" ? slice.exportedAt : null,
        revision: Number.isFinite(+slice.revision) ? +slice.revision : null,
        device: typeof slice.device === "string" ? slice.device.slice(0, 80) : "",
        checksum: typeof slice.checksum === "string" ? slice.checksum : "",
        counts: countsOf(db, images),
      },
    };
  }
  function isValidImage(v) { return typeof v === "string" && v.length <= MAX_IMAGE_CHARS && IMAGE_RE.test(v); }

  // ---------- Crypto ----------
  function createRecoveryPhrase() {
    const idx = new Uint32Array(RECOVERY_PHRASE_WORD_COUNT);
    crypto.getRandomValues(idx);
    return Array.from(idx).map((n) => RECOVERY_WORDS[n % RECOVERY_WORDS.length]).join(" ");
  }
  function normalizePhrase(p) { return String(p || "").trim().replace(/\s+/g, " "); }
  function b64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function unb64(s) {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function syncKey(phrase) { return sha256Hex("kashikoi-cloud-sync-v1:" + phrase); }
  async function deriveKey(phrase, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(phrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: CLOUD_KDF_ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(phrase, data) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(phrase, salt);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data)));
    return {
      app: CLOUD_ENVELOPE_APP, writtenBy: "Velum", format: CLOUD_SYNC_FORMAT, updatedAt: new Date().toISOString(),
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: CLOUD_KDF_ITERATIONS, salt: b64(salt) },
      cipher: { name: "AES-GCM", iv: b64(iv) },
      payload: b64(encrypted),
    };
  }
  // AES-GCM is authenticated: a wrong phrase or any tampering with the ciphertext makes decrypt() reject.
  async function decrypt(phrase, env) {
    if (!env || typeof env !== "object" || !ACCEPTED_ENVELOPE_APPS.has(env.app) ||
        (env.format !== CLOUD_SYNC_FORMAT && env.format !== LEGACY_CLOUD_SYNC_FORMAT) ||
        !env.kdf || !env.cipher || typeof env.payload !== "string") throw new Error("Invalid envelope");
    const key = await deriveKey(phrase, new Uint8Array(unb64(env.kdf.salt)));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(unb64(env.cipher.iv)) }, key, unb64(env.payload));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function fetchEnvelope(key, fetchImpl) {
    const f = fetchImpl || fetch;
    const bust = Date.now() + "-" + Math.random().toString(36).slice(2);
    const res = await f(`${CLOUD_SYNC_ENDPOINT}/sync/${key}?t=${bust}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) { const err = new Error("HTTP " + res.status); err.code = "network"; throw err; }
    return res.json();
  }

  // Merge-save: decrypt what's there, replace only Velum's slice, re-encrypt, PUT, then read back to confirm.
  async function saveToCloud(phrase, slice, fetchImpl) {
    const f = fetchImpl || fetch;
    const key = await syncKey(phrase);
    const env = await fetchEnvelope(key, f);
    let existing = null;
    if (env) {
      try { existing = await decrypt(phrase, env); }
      catch (e) { const err = new Error("decrypt-existing"); err.code = "decrypt-existing"; throw err; }
    }
    const envelope = await encrypt(phrase, createBackupData(slice, existing));
    const body = JSON.stringify(envelope);
    if (body.length > MAX_CLOUD_BYTES) { const err = new Error("too-large"); err.code = "too-large"; err.bytes = body.length; throw err; }
    const res = await f(`${CLOUD_SYNC_ENDPOINT}/sync/${key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    if (!res.ok) { const err = new Error("HTTP " + res.status); err.code = "network"; throw err; }
    // Don't claim success until the stored copy decrypts and carries this exact slice.
    const check = await fetchEnvelope(key, f);
    let ok = false;
    try {
      const back = check && await decrypt(phrase, check);
      ok = !!(back && back.apps && back.apps.velum && back.apps.velum.checksum === slice.checksum);
    } catch (e) { ok = false; }
    if (!ok) { const err = new Error("verify"); err.code = "verify"; throw err; }
    return { bytes: body.length, storedAt: check.storedAt || envelope.updatedAt };
  }
  // Returns { data, envelope } or null if nothing is stored for this phrase.
  async function loadFromCloud(phrase, fetchImpl) {
    const env = await fetchEnvelope(await syncKey(phrase), fetchImpl);
    if (!env) return null;
    let data;
    try { data = await decrypt(phrase, env); }
    catch (e) { const err = new Error("decrypt"); err.code = "decrypt"; throw err; }
    return { data, envelope: { updatedAt: env.updatedAt || null, storedAt: env.storedAt || null, writtenBy: env.writtenBy || env.app || "" } };
  }

  V.sync = {
    CLOUD_SYNC_ENDPOINT, RECOVERY_PHRASE_WORD_COUNT, CLOUD_KDF_ITERATIONS, MAX_CLOUD_BYTES,
    createSlice, createBackupData, readBackup, isValidImage, createRecoveryPhrase, normalizePhrase,
    encrypt, decrypt, syncKey, saveToCloud, loadFromCloud,
  };
})(typeof window !== "undefined" ? window.Velum : globalThis.Velum);
