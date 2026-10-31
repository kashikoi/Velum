# Velum — agent context / project memory

Checked-in snapshot of working context for the Velum app. If you're an agent picking
this up in a new session, read this first.

## What this is
- A personal, local-first **meal planner**: recipe library → weekly breakfast/lunch/dinner menu →
  auto-consolidated shopping list → optional pantry. Part of the kashikoi cloud-themed app suite
  (Cumulus, Nimbus, Cirrus, Stratus, Anvil, Arcus, Virga). Intended repo: github.com/kashikoi/Velum,
  Pages: https://kashikoi.github.io/Velum/ (served from `main` /).
- Named after the velum cloud. Scenic background is an inline SVG of a stacked lenticular cloud over
  the Flatirons with a downtown skyline (based on a user photo); Day is the default atmosphere.
  Snow speckles, tree line, city blocks/windows and red lights were generated once with a seeded
  script — edit in place.
- Plain vanilla HTML/CSS/JS, no build step, no backend of its own.

## Architecture & conventions
- Classic scripts on one namespace (`window.Velum`, `globalThis.Velum` in Node), loaded in order:
  `util → units → model → planner → store → sync → images → demo → views → shell → editors → backup → app`.
  Engine files (util…demo minus images) are DOM-free and tested with `node --test`.
- **All mutations go through `Velum.store`** (validate → mutate → `commit()` → persist → notify).
  UI code never edits `db` directly except the explicit undo helpers that push a removed object back
  and call `S.commit()`. Validation failures throw `store.ValidationError`; UI uses `shell.attempt()`.
- Rendering: `views.js` pure string templates with `escapeHtml()` on every user string. Clicks are
  delegated on `#canvas` via `data-act`, changes via `data-change`, input via `data-input`, forms via
  `data-form`. Hash routes: `#/`, `#/menu/<date>`, `#/day/<date>`, `#/recipes`, `#/recipe/<id>?meal=&cook=1`,
  `#/shopping/<listId>`, `#/pantry`. `shell.render()` restores focus/caret for inputs with an `id`.
- Meals are keyed by **date + meal type**; menus are per-week metadata (`weekStart`). Changing the first
  day of the week re-keys menus (`rekeyMenus`). Lists link to a menu by `menuId`.
- `planner.aggregate()` is the single source of shopping math (see README "How the shopping list is
  calculated"). `planner.reconcile()` merges regenerated entries into existing items — keep its
  guarantees (manual items untouched; purchased kept unless need increased; `qtyEdited` kept; touched
  items become `stale` instead of being removed; `cleared` stays hidden).
- Item `key` = `<i:catalogId | n:normalizedName>|<volume|mass|count:<unit>|taste>`. Don't change key
  shape without a migration — reconciliation matches on it.
- Recipes referenced by meals are archived (`archived: true`), never erased. Photos can be shared by
  duplicated recipes: only delete via `editors.releaseImage()` (checks references).
- Photos: IndexedDB (`images.js`), re-encoded JPEG ≤ 1000 px through canvas; cached in memory so views
  render synchronously. Never put photos in localStorage (shared origin quota).
- Modals stack by open order (`shell.openModal` assigns z-index); `topModal()` drives Esc / ⌘S.
- `[hidden] { display:none !important }` is required (modals use `display:flex`).
- The "beacon" CSS token name is kept for suite parity but is saffron in Velum.

## Cloud sync (shared with the suite)
- Same worker (`nimbus-sync.nimbus-sync.workers.dev`, KV), same PBKDF2(600k)/AES-GCM envelope,
  same `kashikoi-cloud-sync-v1:` key derivation and 16-word phrase as Virga/Arcus/etc.
- The worker only accepts `app: "Nimbus" | "Cumulus"`, so the envelope is tagged `Nimbus` with
  `writtenBy: "Velum"`. Data lives at `apps.velum` inside the unified `kashikoi-app-backup-v1` blob;
  saving always merges and preserves other apps' slices. Sibling apps' `existingApps()` don't know
  `velum` yet but keep it because they copy `apps` wholesale for unified blobs.
- Velum's slice adds `revision`, `device`, `counts`, `checksum` (SHA-256 of canonical JSON of db+images)
  and `images`. `saveToCloud` reads back and verifies the checksum before reporting success.
- KDF iterations are fixed client-side (not read from the envelope) so a tampered blob can't stall the browser.

## Ecosystem gaps / assumptions (documented, not invented)
- No authentication exists anywhere in the suite; the recovery phrase is the only credential. Velum
  follows that rather than adding accounts.
- No system-theme option exists in the siblings (they use Day/Twilight/Night/Random); Velum matches.
- The shared worker keeps one blob per phrase, so "backup versioning" is a revision counter + local
  backup log + one pre-restore snapshot, not server-side history. Server-side history would need a
  worker/KV change (and ~25 MiB KV value limit applies to the whole unified blob).
- No service worker / offline cache in the siblings (except ArmyQuest); Velum doesn't add one.

## Release flow
Same as the other cloud apps: work on `develop` → bump `APP_VERSION` in `js/shell.js` and every
`?v=` string + About version in index.html → `node --test` → `cp -R index.html styles.css icon.svg
manifest.webmanifest js build/` → commit "Release Velum <version>" → push `develop` →
`git checkout main && git merge develop -m "Merge develop for Velum <version>"` → push `main` →
switch back to `develop`.
