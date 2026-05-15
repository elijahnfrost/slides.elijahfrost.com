# slides.elijahfrost.com

A personal slide catalog. The hub at `/` is searchable; each piece lives at
`/<slug>/` and is a full-screen presentation built on the `<deck-stage>` Web
Component.

## Layout

```
slides.elijahfrost.com/
├── index.html              # the searchable hub (reads catalog.json)
├── hub.css                 # hub-specific styles
├── catalog.json            # the index of pieces
├── _framework/             # the deck framework (shared across all pieces)
│   ├── deck-stage.js
│   ├── tokens.css
│   └── templates/
│       └── blank-deck.html
├── soft-halo/              # a piece
│   ├── index.html
│   ├── deck-stage.js  →  ../_framework/deck-stage.js
│   └── tokens.css     →  ../_framework/tokens.css
└── (future pieces…)
```

Pieces symlink the framework files. Symlinks work here because everything is
in the same git repo — Vercel clones the whole thing and resolves them at
build time.

## Local dev

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Adding a piece

1. `cp -r _framework/templates/blank-deck.html <slug>/index.html`
2. `cd <slug> && ln -s ../_framework/deck-stage.js deck-stage.js && ln -s ../_framework/tokens.css tokens.css`
3. Edit `<slug>/index.html`.
4. Add an entry to `catalog.json` (slug, title, description, date, tags).
5. Commit and push. Vercel auto-deploys.

## Framework refinement

`_framework/` is the deck framework — the source of truth. Edits there
propagate to every piece on the next deploy via the symlinks. Planned work:
extract per-piece slide-type styles (`slide-title`, `slide-body`, etc.) from
each piece's HTML into `_framework/slide-types.css`; audit `deck-stage.js` for
incomplete features.

## Deploy

Connected to Vercel via GitHub. Pushing to `main` triggers a deploy.

Domain: `slides.elijahfrost.com` (via DNS CNAME → `cname.vercel-dns.com`).

## Per-piece assets

Each piece should have:
- `<slug>/index.html` — the deck
- `<slug>/og-image.png` (1200×630, optional) — referenced from the piece's OG tags
- `favicon.png` at the repo root — used by all pieces and the hub
