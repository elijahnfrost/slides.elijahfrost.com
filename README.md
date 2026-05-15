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
   commit to GitHub → Vercel auto-deploys
```

## Layout

```
.
├── index.html              # hub (reads catalog.json, lists pieces)
├── hub.css                 # hub styles
├── catalog.json            # generated — do not hand-edit
├── upload/                 # the /upload page client
│   ├── index.html
│   ├── upload.css
│   └── upload.js
├── api/                    # Vercel serverless functions
│   ├── upload.js                            # POST: validate + commit
│   └── export/
│       ├── [slug].js                        # GET: download a piece
│       └── template/[name].js               # GET: download a fresh template
├── lib/                    # shared modules used by api/*
│   ├── schema.js           # deck-meta validator (zod)
│   ├── fences.js           # FRAMEWORK-MANAGED region fingerprints
│   ├── migrations.js       # schema migration chain (currently empty)
│   ├── parse.js            # HTML parsing + structural validation
│   ├── github.js           # Octokit multi-file commit wrapper
│   ├── og.js               # server-side OG image (1200×630 PNG)
│   └── upload-pipeline.js  # the 15-step validation pipeline
├── bin/
│   ├── build-catalog.mjs   # regenerates catalog.json from each piece's <deck-meta>
│   ├── gen-og.py           # legacy local OG generator (server uses lib/og.js)
│   └── new-piece           # deprecated; see /api/export/template/blank-deck
├── _framework/v1/          # the deck framework. pinned, immutable per version.
│   ├── deck-stage.js               # the <deck-stage> Web Component
│   ├── tokens.css                  # design tokens
│   ├── slide-types.css             # canonical 18 slide-types
│   ├── present.html / present.js / present.css   # the presenter view
│   ├── templates/blank-deck.html   # the agent's starting point
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
cp .env.example .env.local && $EDITOR .env.local   # set DECK_UPLOAD_TOKEN, GITHUB_PAT
vercel dev
```

## Creating a new deck (the workflow)

1. **Download a blank template** from the hub ("New from template") or:

   ```sh
   curl -s https://slides.elijahfrost.com/api/export/template/blank-deck > new.html
   ```

2. **Hand `new.html` to an agent** (Claude.ai or similar). Tell it what
   the deck is about. The agent reads
   [_framework/v1/DECK-FORMAT.md](_framework/v1/DECK-FORMAT.md) and
   [_framework/v1/SLIDE-TYPES.md](_framework/v1/SLIDE-TYPES.md) to know
   the format and slide vocabulary.

3. **Upload the result** via [/upload/](upload/). The server validates
   schema, fences, structure, embed/script allow-lists, optimistic
   concurrency, then commits to GitHub. Vercel deploys in ~30s.

## Editing an existing deck

Same loop. On the hub, click the ⇣ button on a card to download the
piece. The download stamps a fresh `version_id` so optimistic concurrency
catches the case where two parallel agent sessions try to publish.

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

Connected to Vercel via GitHub. Pushing to `main` triggers a deploy.
The upload endpoint commits via the GitHub REST API; Vercel picks it up
on the next webhook.

Required env vars (set in Vercel + `.env.local` for `vercel dev`):

- `DECK_UPLOAD_TOKEN` — shared bearer token the `/upload` page sends
- `GITHUB_PAT` — fine-grained PAT with `contents:write` on this repo

Optional:

- `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH` (defaults shown in `.env.example`)
- `ALLOWED_EMBED_HOSTS` — comma-separated extra hosts for `<iframe>`/`<video>`/`<audio>`

Domain: `slides.elijahfrost.com` (DNS CNAME → `cname.vercel-dns.com`).
