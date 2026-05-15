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
│   ├── present.html        # presenter controller (see below)
│   ├── present.css
│   ├── present.js
│   └── templates/
│       └── blank-deck.html
├── soft-halo/              # a piece
│   ├── index.html
│   ├── deck-stage.js  →  ../_framework/deck-stage.js
│   ├── tokens.css     →  ../_framework/tokens.css
│   └── present/
│       └── index.html  →  ../../_framework/present.html
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

```sh
bin/new-piece <slug> "Title" "Short description"
```

The script copies the template, symlinks the framework files (deck-stage.js,
tokens.css, slide-types.css, present/), and appends a catalog entry dated
today with empty tags. Then edit `<slug>/index.html` and update the catalog
tags as needed. Commit and push — Vercel auto-deploys.

## Presenter view

Every piece gets a presenter at `/<slug>/present/`. Open it from the deck by
clicking **Present** in the bottom overlay or pressing **P**.

Layout: clock + elapsed timer up top, current and next slide thumbnails
side-by-side, speaker notes from the deck's `#speaker-notes` JSON below,
prev/next + slide count at the foot.

The deck and presenter sync over a same-origin `BroadcastChannel` named
`deck-stage:/<slug>/`. Navigation from either window drives the other.
Channel name is derived from `location.pathname`; the presenter strips its
own `present/` suffix to match.

Keys in the presenter window: **←/→** prev/next, **PgUp/PgDn**, **Space**,
**Home/End**, **T** start/pause timer, **F** fullscreen.

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
- `favicon.svg` at the repo root — used by all pieces, the hub, and the presenter
