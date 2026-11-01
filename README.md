# Velum — Recipes, Menu Plan & Groceries

## Overview
- **Name:** Velum (after *velum* — the smooth veil of cloud that drapes over a rising one, like the stacked lenticular saucers that park over the Flatirons on a windy winter day).
- **Purpose:** A personal kitchen companion. Keep a recipe library and one reusable eight-day meal plan, and let Velum add up exactly what to buy — combined, converted, sorted by aisle — then check things off in the store.
- **Sister apps:** Shares the sky/cloud design language, settings, and encrypted cloud sync of Cumulus, Nimbus, Cirrus, Stratus, Anvil, Arcus and Virga (frosted glass, Day / Twilight / Night / Random atmosphere, no-build vanilla HTML/CSS/JS).
- **Scenic panes:** Mostly translucent navigation and content panes with light frosting keep the clouds and Flatirons visible in every atmosphere. Cards use light glass washes; dialogs retain stronger glass for readability.

## Technology & Design Philosophy
- **Stack:** Plain vanilla HTML5, CSS3, ES2015+ JavaScript. No framework, no bundler, no build step. Classic `<script>` files share one `window.Velum` namespace (same split-module pattern as the Arcus refactor) so the engine runs unchanged in Node for tests.
- **Local-first:** Data persists in `localStorage`; recipe photos live in IndexedDB (the shared `kashikoi.github.io` origin's ~5 MB localStorage quota is used by every suite app). JSON backup files plus optional zero-knowledge encrypted cloud backup.
- **Deploy:** Static site — open `index.html` directly or serve it (GitHub Pages: `https://kashikoi.github.io/Velum/` once the repo is published).
- **Phone layout:** iPhone and Android phone browsers open directly to a shopping-only screen with large checkboxes, wrapping item names, and no meal-planning navigation, in portrait or landscape. Checked items stay in their original position with strikethrough; tap again to uncheck. Desktop/tablet browsers keep the full app and their purchased-item display preference. **Backup & restore** remains available to load a shopping list from the planning device; data and checks are local to each browser, not live-synced.

## Modules
- **Overview (home)** — eight-day strip, planned recipes with photos, shopping progress, quick actions.
- **Menu plan** — eight day rows with Breakfast, Lunch, and Dinner columns (stacked day cards on phones): Saturday, Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday. Both are labeled Saturday, but remain independent slots with distinct internal keys. There are no calendar dates, dated weeks, automatic rollovers, or week history; the plan stays until you edit or clear it. Each slot supports multiple meals with full names, servings, and wrapping notes; **Add another** lets two people plan different dishes. Use each meal's note for who it is for. Tap a slot to pick a recipe (search, favorites, recently planned, or "create new"), or add a quick note like "Leftovers". Each meal has its own servings, note and "made it" check. Drag meals between slots on desktop (hold ⌥/Alt to copy), or use Day/Meal dropdowns on any device. Copy or clear a day; clear the whole plan (undoable).
- **Recipes** — name, description, photo, categories (breakfast/lunch/dinner/snack/dessert/other, multiple allowed), cuisine, prep/cook/total time, servings, difficulty, tags, grouped ingredients (qty, unit, name, prep, optional), ordered steps, notes, source link, favorite. Paste a whole ingredient list and Velum parses it (`1 ½ cups flour, sifted`, `4 cloves garlic`, `Salt to taste`, `For the sauce:` headings → groups). Search, category/cuisine/tag/favorite filters, five sort orders, duplicate for variations, cook mode (large text, tap-to-check steps, screen stays awake). Scaling servings never changes the saved recipe.
- **Shopping** — one tap builds a list from all eight days of the plan: ingredients are scaled per meal, consolidated and grouped by aisle. Add your own items ("2 lb apples"), edit or delete anything, check items off with large tap targets, clear checked items, reorder, and keep several lists. When the menu changes, **Update list** shows exactly what will change before applying it.
- **Occasional items** (desktop) — a saved list of things you buy now and then (shampoo, paper towels, batteries). Check it whenever you like and tap **Need it** to add an item to the current shopping list; tap **✓ On list** to take it back off. Items stay saved after shopping, never duplicate on a list, and are included in backups. Quick add understands amounts like "2 packs paper towels".
- **Ingredients & pantry** — an optional catalog (aisle, default unit, aliases, grams-per-cup density) and an optional pantry (have it / ran out, with or without amounts).
- **Shopping checklist:** A simple line-by-line list without category headings or recipe-source clutter. Existing aisle/custom order and checked-item preferences are preserved. Tap the ingredient name or large checkbox to toggle it; purchase checks persist automatically. A separate **Edit** button keeps amounts, notes, and recipe sources accessible. Pantry items remain set aside.

## How the shopping list is calculated
1. Every recipe meal in all eight plan days contributes its ingredients × (meal servings ÷ recipe servings). Water/ice are skipped; optional ingredients follow the setting.
2. Names are normalized so variants merge (`Garlic cloves`, `Cloves of garlic`, `Fresh garlic` → garlic) while meaningful qualifiers keep products apart (ground beef ≠ beef steak, whole ≠ skim milk, fresh ≠ dried basil). Catalog aliases merge anything else you choose.
3. Quantities only combine when compatible: volume with volume (tsp/tbsp/cup/fl oz/ml/l…), weight with weight (g/kg/oz/lb), or identical count units (cloves, cans…). Volume ↔ weight happens **only** with a catalog grams-per-cup value. Anything else stays a separate line. "To taste" folds into a measured line of the same ingredient. Count items round up (you can't buy 1.5 onions).
4. Display units: if every source used the same unit it's kept; otherwise the most readable unit in the sources' system (US/metric setting breaks ties).
5. **Reconciliation** on update: your own items are untouched; checked items stay checked unless you now need more (then they're unchecked and show what you had); quantities you edited are kept with a note of the new requirement; items no longer needed are removed only if you never touched them — otherwise they stay, marked "not on menu". Cleared (checked + cleared) items don't come back unless more is needed.
6. Pantry: *Set aside* moves things you have into an "Already in your pantry" section (tap **Need it** to bring one back); *Subtract* deducts known compatible amounts first.

## Data Model
`localStorage["velum_cloud_data"]` — `{ schemaVersion, settings, recipes, menus, meals, lists, items, ingredients, pantry, meta }`
- **settings:** `{ servings{breakfast,lunch,dinner}, measurement "us"|"metric", groupBy "category"|"none", categoryOrder[], purchased "bottom"|"inline"|"hide", includeOptional, pantryMode "off"|"flag"|"subtract", autoBackup, cloudPhotos }`
- **recipe:** `{ id, name, description, imageId, categories[], cuisine, prepMin, cookMin, totalMin, servings, difficulty, tags[], ingredients[{id, ingredientId, name, qty|null, unit, prep, group, optional, sortOrder}], steps[{id, text}], notes, sourceUrl, favorite, archived, createdAt, updatedAt, lastUsedAt }`
- **menu:** `{ id, name, notes, createdAt, updatedAt }` — at most one reusable plan.
- **meal** (MealAssignment): `{ id, day, meal "breakfast"|"lunch"|"dinner", recipeId|null, title, servings, note, done, sortOrder }` — `day` is `saturday|sunday|monday|tuesday|wednesday|thursday|friday|following-saturday`.
- **list:** `{ id, menuId|null, name, status, createdAt, updatedAt, generatedAt, signature }`
- **item:** `{ id, listId, key, ingredientId, name, qty, unit, category, note, purchased, manual, optional, toTaste, qtyEdited, nameEdited, categoryEdited, genQty, genUnit, boughtQty, boughtUnit, stale, cleared, inPantry, pantryOverride, change, sources[{mealId, recipeId, recipe, day, meal}], sortOrder }`
- **ingredient:** `{ id, name, defaultUnit, category, aliases[], gramsPerCup, notes }`
- **pantry:** `{ id, ingredientId, name, qty|null, unit, available, updatedAt }`
- **occasional:** `{ id, name, qty|null, unit, category, note, sortOrder }` — saved occasional items; matched to list items by normalized name.
- Recipes referenced by any meal are **archived**, never erased, so planned meals stay intact. `normalizeDb()` repairs dangling references on load and restore.
- **Schema v2 migration:** Older local data and verified backups are converted to named weekdays. All legacy dated meals are retained, grouped by weekday (legacy Saturdays map to the first Saturday); the first menu becomes the reusable plan and old menu-linked lists are relinked to it without changing their items or purchase checks. Export a new backup after upgrading, and use the updated app on every device.

Other keys: `velum_cloud_theme`, `velum_cloud_phrase` (opt-in), `velum_cloud_backup_log`, `velum_cloud_revision`. IndexedDB `velum`: `images` (id → JPEG data URL), `snapshots` (pre-restore safety copy).

## Backup & restore
- **Encrypted cloud backup** uses the suite's shared Cloudflare Worker (`nimbus-sync`, Workers KV) exactly like the other apps: a 16-word recovery phrase → `SHA-256("kashikoi-cloud-sync-v1:" + phrase)` storage key; PBKDF2-SHA-256 (600,000 iterations, random salt) → AES-GCM-256 (random IV) in the browser. The worker stores only ciphertext and can't decrypt it. Saving merges into the unified `kashikoi-app-backup-v1` blob under `apps.velum`, preserving every other app's slice.
- Velum's slice adds a **revision number**, device label, counts and a **SHA-256 checksum** of the data + photos. Success is only reported after the stored copy is read back, decrypted and its checksum matches.
- **Restore** (cloud or file) shows a preview — date, version, device, counts, integrity status — and requires confirmation. A safety copy of current data is kept in IndexedDB first; **Undo last restore** puts it back. The restored data is re-read from storage to verify.
- Photos are included by default (re-encoded JPEG ≤ 1000 px). Turn off "Include recipe photos" if the backup grows large; restores then keep this device's photos. Restored photos must be `data:image/(jpeg|png|webp);base64` or they're dropped.
- **Automatic backup** (opt-in) runs 45 s after changes when the phrase is remembered on the device.

## Settings
Atmosphere (Day / Twilight / Night / Random) · Meal planning (fixed eight-day plan, default servings per meal, US/metric) · Shopping (group by aisle or flat, checked-item behavior, pantry mode, optional ingredients, aisle order) · Encrypted Cloud Backup (status, phrase, remember, automatic backup, photos, back up now, restore) · Data (export/restore file, undo restore, starter recipes, clear all, about).

## Keyboard
`N` new recipe · `/` search recipes · `⌘/Ctrl+S` save the open dialog · `Esc` close dialogs / exit cook mode · arrow keys + Enter in the recipe picker.

## Tests
`node --test` — engine and view tests (parsing, normalization, unit conversion, aggregation, reconciliation, pantry, eight-day operations, both Saturdays, no calendar rollover, v1 migration, date-free views, archive-on-delete, backup checksum/tamper detection, encrypted round-trip against a mocked worker).

## Files
`index.html`, `styles.css`, `js/` (`util`, `units`, `model`, `planner`, `store`, `sync`, `images`, `demo`, `views`, `shell`, `editors`, `backup`, `app`), `icon.svg`, `manifest.webmanifest`, `tests/`, `build/` (release mirror).
