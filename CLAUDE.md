# Agent guide

You're working on **slides.elijahfrost.com** — a personal slide hub.
Pieces are single self-contained HTML files served at `/<slug>/`. The
hub at `/` lists them.

You can author and edit pieces **directly in the repo**. Commit and push
to `main`; Vercel auto-deploys. No tokens, no `/upload` round-trip, no
API calls needed for the common case.

## New piece

```sh
node bin/new-piece.mjs <slug> "Optional title"
```

Scaffolds `<slug>/index.html` from `_framework/v1/templates/blank-deck.html`
with the slug, title, and a fresh `version_id` pre-filled. Then edit the
file: fill in `<deck-meta>` (description, tags, slide_types_used) and
add sections inside `<deck-stage>`.

Read once before your first piece:

- [_framework/v1/DECK-FORMAT.md](_framework/v1/DECK-FORMAT.md) — file
  skeleton, `<deck-meta>` schema, hard rules.
- [_framework/v1/SLIDE-TYPES.md](_framework/v1/SLIDE-TYPES.md) — the 18
  canonical slide layouts.

Then:

```sh
git add <slug>/
git commit -m "Add <slug> deck"
git push origin main
```

Vercel's build step runs `node bin/build-catalog.mjs`, which scans every
piece directory and writes `catalog.json`. The piece is live at
`/<slug>/` on the next request.

## Edit an existing piece

**If it's already in the repo** (look for `<slug>/index.html`): edit it
in place, commit, push.

**If it isn't** (a piece originally uploaded via the `/upload/` page —
look for it in `catalog.json` but no matching directory): pull it down
first:

```sh
node bin/import-piece.mjs <slug>
```

That fetches the current production HTML and writes it to
`<slug>/index.html`. Edit, commit, push as above. After the deploy
goes live, you can hard-delete the now-redundant Blob copy from the hub
(Decks/Templates tab → `×` to move to trash → Trash tab → `⌫` to delete
permanently) so the git copy is the only one.

## Hard rules

These are enforced by `bin/build-catalog.mjs` and by the `/upload`
validator — but they apply to git-committed pieces too, because uploads
and disk pieces share the same format:

- **Don't touch the FRAMEWORK-MANAGED fences.** Two regions in every
  piece have a `<!-- FRAMEWORK-MANAGED:... — do not edit -->` marker.
  Their content is byte-stable for each framework version. Edits to the
  bytes between the markers are rejected.
- **`<deck-meta>.slug` must match the directory name.** kebab-case only
  (`[a-z0-9]+(-[a-z0-9]+)*`).
- **Speaker notes are required and length-matched.** The
  `<script id="speaker-notes">` JSON array must have one entry per
  non-skipped `<section>`. Empty strings are fine.
- **No inline `on*` event handlers, no extra `<script>` tags**
  (`#piece-script` is the one allowed slot for inline JS).
- **`<iframe>`/`<video>`/`<audio>` src** must be a `data:` URI, a
  same-origin path, or one of the allow-listed embed hosts (YouTube,
  Vimeo, slides.elijahfrost.com).

The validator on `/upload` returns `E_*` codes documented in
[_framework/v1/DECK-FORMAT.md](_framework/v1/DECK-FORMAT.md); the
catalog builder logs warnings and skips invalid pieces.

## Local check before pushing

```sh
python3 -m http.server 8765
# open http://localhost:8765/<slug>/ — confirms the deck renders
npm test
# runs the schema/parse/fence test suite (~22 tests)
```

There's no full validator CLI; the upload validator lives in
`lib/upload-pipeline.js` if you want to import its checks for a custom
smoke test.

## What's where

- `_framework/v1/` — the deck framework. Pinned, immutable per version.
  `deck-stage.js`, `slide-types.css`, `tokens.css`, the presenter, the
  templates manifest. Treat as read-only unless you're versioning the
  framework.
- `bin/` — `build-catalog.mjs`, `new-piece.mjs`, `import-piece.mjs`.
- `lib/` — pure modules used by `api/` and the bin scripts.
- `api/` — Vercel serverless functions (catalog, deck, export, upload,
  item-update, item-delete, item-restore, item-rename, catalog-rebuild).
- `<slug>/index.html` — a piece. That's it.

Push to `main` triggers deploy. Push to a feature branch does not — the
hub only shows pieces present on the deployed branch.
