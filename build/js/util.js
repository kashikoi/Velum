/* Velum — shared utilities (no DOM, no state). */
(function (V) {
  "use strict";

  const DAY_MS = 86400000;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // Parses a number; returns null for blank/invalid input (so "unset" is distinguishable from 0).
  function numOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  function round(n, places) {
    const f = Math.pow(10, places == null ? 2 : places);
    return Math.round(n * f) / f;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function str(v, max) { return String(v == null ? "" : v).trim().slice(0, max || 500); }

  // ---------- Dates (local calendar days as YYYY-MM-DD) ----------
  function localISO(d) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function parseDate(iso) {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return Number.isNaN(d.getTime()) || d.getMonth() !== +m[2] - 1 ? null : d;
  }
  function isISODate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !!parseDate(s); }
  function todayISO() { return localISO(new Date()); }
  function addDays(iso, days) {
    const d = parseDate(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + days); // calendar arithmetic is DST-safe
    return localISO(d);
  }
  function daysBetween(aIso, bIso) {
    const a = parseDate(aIso), b = parseDate(bIso);
    if (!a || !b) return null;
    return Math.round((b - a) / DAY_MS);
  }
  // First day of the week containing `iso`; weekStartsOn: 0 = Sunday, 1 = Monday, …
  function weekStartFor(iso, weekStartsOn) {
    const d = parseDate(iso);
    if (!d) return iso;
    const diff = (d.getDay() - (weekStartsOn || 0) + 7) % 7;
    return addDays(iso, -diff);
  }
  function weekDates(startIso) {
    const out = [];
    for (let i = 0; i < 7; i++) out.push(addDays(startIso, i));
    return out;
  }
  function fmtDate(iso, opts) {
    const d = parseDate(iso);
    return d ? d.toLocaleDateString(undefined, opts || { month: "short", day: "numeric", year: "numeric" }) : "";
  }
  function fmtShort(iso) {
    const d = parseDate(iso);
    if (!d) return "";
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtWeekday(iso, long) { return fmtDate(iso, { weekday: long ? "long" : "short" }); }
  function fmtRange(startIso, endIso) {
    const a = parseDate(startIso), b = parseDate(endIso);
    if (!a || !b) return "";
    const sameYear = a.getFullYear() === b.getFullYear();
    const sameMonth = sameYear && a.getMonth() === b.getMonth();
    const left = a.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const right = b.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
    return left + " – " + right + ", " + b.getFullYear();
  }
  function fmtDateTime(isoTs) {
    const d = new Date(isoTs);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function relDays(days) {
    if (days === null || days === undefined) return "";
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days === -1) return "yesterday";
    return days > 0 ? "in " + days + " days" : -days + " days ago";
  }

  function plural(n, word, pluralWord) {
    return n + " " + (n === 1 ? word : (pluralWord || word + "s"));
  }
  function fmtMinutes(min) {
    if (!min) return "";
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    if (!h) return m + " min";
    return h + " hr" + (m ? " " + m + " min" : "");
  }
  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }
  function uniqueSorted(list) {
    return Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }
  // Stable JSON (sorted keys) so checksums don't depend on property order.
  function canonicalJSON(v) {
    if (Array.isArray(v)) return "[" + v.map(canonicalJSON).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonicalJSON(v[k])).join(",") + "}";
    }
    return JSON.stringify(v);
  }

  V.util = {
    DAY_MS, uid, escapeHtml, numOrNull, round, clamp, str,
    localISO, parseDate, isISODate, todayISO, addDays, daysBetween, weekStartFor, weekDates,
    fmtDate, fmtShort, fmtWeekday, fmtRange, fmtDateTime, relDays, plural, fmtMinutes, fmtBytes,
    uniqueSorted, canonicalJSON,
  };
})(typeof window !== "undefined" ? (window.Velum = window.Velum || {}) : (globalThis.Velum = globalThis.Velum || {}));
