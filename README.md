# slides.elijahfrost.com

A personal slide hub. Each piece is a single self-contained HTML file
rendered by a custom Web Component, `<deck-stage>`. The hub at `/` lists
every piece and supports search.

The site uses a **file-passing agent workflow**:

```
   site (hub)                                       agent
       │  ────────── download .html ──────────►      │
       │                                             │
       │  ──────── you save / share file ────────►   │
       │                                             │
       │  ◄──────── upload edited .html ─────────    │
       │                                             │
   server: validate → mint version_id →
   write to Vercel Blob → live on next request
```

## Layout

```
.
├── index.html              # hub (lists pieces; fetches /api/catalog/)
├── hub.css                 # hub styles
├── catalog.json            # disk fallback for /api/catalog; do not hand-edit
├── upload/                 # the /upload page client
│   ├── index.html
│   ├── upload.css
│   └── upload.js
├── api/                    # Vercel serverless functions (flat layout)
│   ├── catalog.js          # GET /catalog.json — unified piece catalog
│   ├── deck.js             # GET /<slug>/ — serve a piece's HTML
│   ├── export-piece.js     # GET /api/export/<slug> — download a piece
│   ├── export-template.js  # GET /api/export/template/<name> — download a fresh template
│   ├── item-update.js      # POST /api/item-update — toggle kind / pinned
│   └── upload.js           # POST /api/upload — validate + store in Blob
├── lib/                    # shared modules used by api/*
│   ├── schema.js           # deck-meta validator (zod)
│   ├── fences.js           # FRAMEWORK-MANAGED region fingerprints
│   ├── migrations.js       # schema migration chain (currently empty)
│   ├── parse.js            # HTML parsing + structural validation
│   ├── og.js               # server-side OG image (1200×630 PNG)
│   ├── blob-storage.js     # Vercel Blob piece + catalog read/write
│   ├── item-mutate.js      # in-place kind/pinned edits for /api/item-update
│   └── upload-pipeline.js  # the upload validation pipeline
├── bin/
│   └── build-catalog.mjs   # regenerates catalog.json from each piece's <deck-meta>
├── _framework/v1/          # the deck framework. pinned, immutable per version.
│   ├── deck-stage.js               # the <deck-stage> Web Component
│   ├── tokens.css                  # design tokens
│   ├── slide-types.css             # canonical 18 slide-types
│   ├── present.html / present.js / present.css   # the presenter view
│   ├── templates/blank-deck.html   # the agent's starting point
│   ├── templates/index.json        # manifest of pinned seed templates
│   ├── SLIDE-TYPES.md              # agent reference: the 18 layouts
│   └── DECK-FORMAT.md              # agent reference: the file contract
├── soft-halo/              # an example piece using the new format
│   ├── index.html
│   ├── og-image.png
│   └── present/index.html          # symlink → ../../_framework/v1/present.html
└── vercel.json
```

## Local development

```sh
# Static dev server
python3 -m http.server 8765
# open http://localhost:8765/
```

To run the serverless functions locally:

```sh
npm install
cp .env.example .env.local && $EDITOR .env.local   # set BLOB_READ_WRITE_TOKEN
vercel dev
```

## Creating a new deck

There are two workflows. Both produce the same kind of piece. Pick by
whether you have the repo checked out.

### A — Agent in the repo (preferred)

Open the repo in an agent that can run `git` (Claude Code on the Web,
Claude Code CLI, an IDE with Claude/Cursor plugin, etc.). Tell it what
you want; it follows [CLAUDE.md](CLAUDE.md):

```sh
node bin/new-piece.mjs <slug> "Title"
# scaffolds <slug>/index.html from the blank-deck template
# agent edits <slug>/index.html
git add <slug>/ && git commit -m "Add <slug>" && git push origin main
```

Vercel builds (`node bin/build-catalog.mjs` regenerates `catalog.json`),
the piece is live at `/<slug>/`, and the hub shows it with a `git` chip.
No API tokens.

### B — Browser, no checkout

1. Download a blank template from the hub ("New from template") or
   `curl -s https://slides.elijahfrost.com/api/export/template/blank-deck > new.html`.
2. Hand `new.html` to an agent that can edit text but not commit.
3. Upload the edited file at [/upload/](upload/). The server validates
   schema, fences, structure, embed/script allow-lists, optimistic
   concurrency, then writes to Vercel Blob. Hub shows it with a `blob`
   chip.

## Editing an existing piece

**Git-managed pieces** (chip says `git`, directory exists in the repo):
edit `<slug>/index.html` in place, commit, push.

**Blob-managed pieces** (chip says `blob`, no directory in the repo):
either use the download-edit-upload loop (download stamps
`parent_version_id` so re-upload satisfies optimistic concurrency), or
import once and switch to in-repo:

```sh
node bin/import-piece.mjs <slug>
# writes <slug>/index.html from prod
# edit, commit, push as above
# then hard-delete the Blob copy from the hub Trash so git becomes canonical
```

## Deck file format

See [_framework/v1/DECK-FORMAT.md](_framework/v1/DECK-FORMAT.md) for the
full contract: file skeleton, `<deck-meta>` schema, FRAMEWORK-MANAGED
regions, hard rules, the failure codes the upload endpoint can return.

## Presenter view

Every piece serves a presenter at `/<slug>/present/` — a Vercel rewrite
maps it to [_framework/v1/present.html](_framework/v1/present.html). On
the deck, click **Present** (bottom overlay) or press **P** to open it
in a popup. Sync happens via a same-origin `BroadcastChannel`. Press
**H** on the deck to toggle the thumbnail rail.

## Deploy

Connected to Vercel via GitHub. Pushing to `main` triggers a deploy of
the static site + serverless functions. The upload endpoint writes
pieces to Vercel Blob, so a published piece is live on the next request
without waiting for a redeploy.

Required env vars (set in Vercel + `.env.local` for `vercel dev`):

- `BLOB_READ_WRITE_TOKEN` — Vercel Blob token; created when you connect a Blob store to the project

Optional:

- `ALLOWED_EMBED_HOSTS` — comma-separated extra hosts for `<iframe>`/`<video>`/`<audio>`

Domain: `slides.elijahfrost.com` (DNS CNAME → `cname.vercel-dns.com`).
