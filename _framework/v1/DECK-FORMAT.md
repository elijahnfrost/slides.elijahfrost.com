# Deck file format (schema deck/1, framework v1)

A deck is a single self-contained HTML file. This document specifies the contract between the agent and the system. The slide-type vocabulary lives in [SLIDE-TYPES.md](SLIDE-TYPES.md).

## File skeleton

Every deck file follows this exact structure, in this exact order. Comment fences delimit regions the agent must not edit.

```html
<!doctype html>
<html lang="en">
<head>
  <!-- FRAMEWORK-MANAGED:head-pin — do not edit -->
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300..600&family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700&display=swap">
  <link rel="stylesheet" href="/_framework/v1/tokens.css">
  <link rel="stylesheet" href="/_framework/v1/slide-types.css">
  <!-- /FRAMEWORK-MANAGED:head-pin -->

  <title>Deck title</title>                                         <!-- writable -->
  <meta name="description" content="…">                             <!-- writable -->
  <meta property="og:type" content="website">                       <!-- writable -->
  <meta property="og:title" content="…">                            <!-- writable -->
  <meta property="og:description" content="…">                      <!-- writable -->
  <meta property="og:image" content="https://slides.elijahfrost.com/<slug>/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="…">
  <meta name="twitter:description" content="…">
  <meta name="twitter:image" content="https://slides.elijahfrost.com/<slug>/og-image.png">

  <script type="application/json" id="deck-meta">{
    "schema": "deck/1",
    "framework": "v1",
    "slug": "<slug>",
    "title": "…",
    "description": "…",
    "tags": ["…"],
    "date": "YYYY-MM-DD",
    "version_id": null,
    "parent_version_id": null,
    "created_at": null,
    "updated_at": null,
    "slide_types_used": ["slide-title", "…"],
    "agent": { "model": "", "session": "" }
  }</script>

  <style id="piece-style">
    /* piece-specific CSS — animations, color accents, custom slide-types */
    deck-stage:not(:defined) { visibility: hidden; }
  </style>
</head>
<body>

<deck-stage width="1920" height="1080" data-slide-types="slide-title,…">
  <section class="slide-title" data-numeral="I" data-name="Title">
    <div class="slide center">
      <h1 class="display hero-name">Deck title</h1>
    </div>
  </section>
  <!-- more sections … -->
</deck-stage>

<!-- writable: optional overlay region (e.g. tile-grid background, brand chrome) -->

<script type="application/json" id="speaker-notes">[""]</script>

<!-- FRAMEWORK-MANAGED:deck-bootstrap — do not edit -->
<script src="/_framework/v1/deck-stage.js"></script>
<!-- /FRAMEWORK-MANAGED:deck-bootstrap -->

<script id="piece-script">
  /* piece-specific JS — listens for slidechange, drives motion, etc. */
</script>

</body>
</html>
```

## `<deck-meta>` JSON schema

```json
{
  "schema": "deck/1",
  "framework": "v1",
  "slug": "soft-halo",
  "title": "Grid Studies — soft halo",
  "description": "A typographic study about backgrounds.",
  "tags": ["typography", "grid"],
  "date": "2026-05-14",
  "version_id": "01HZXX…ULID",
  "parent_version_id": "01HZWW…ULID",
  "created_at": "2026-05-14T20:50:00Z",
  "updated_at": "2026-05-14T21:30:00Z",
  "slide_types_used": ["slide-title", "slide-list", "slide-quote"],
  "agent": { "model": "claude-opus-4-7", "session": "free-text" }
}
```

### Read-only fields

The server overwrites these on every upload. The agent must preserve them verbatim from the file it read in.

- `schema` — the contract version (`deck/<integer>`)
- `framework` — the framework version pin (`v<integer>`)
- `version_id` — ULID minted by the server
- `parent_version_id` — the `version_id` of the file the agent received
- `created_at` — ISO-8601 UTC timestamp of first upload
- `updated_at` — ISO-8601 UTC timestamp of latest upload

### Writable fields

- `slug` — kebab-case URL slug; required; locked once published (changing it is escalated)
- `title` — display title
- `description` — short description for the hub card and meta tags
- `tags` — array of strings
- `date` — ISO-8601 date (`YYYY-MM-DD`)
- `slide_types_used` — array; should match the classes actually used on `<section>` children
- `agent` — free-form record of who edited (model name, session label)

## Hard rules

The upload validator enforces these. Violations return `E_STRUCTURE` with the rule name.

1. Exactly one `<deck-stage>` element.
2. Exactly one `<script id="speaker-notes">`. Its JSON array length equals the count of `<section>` children that don't have `data-deck-skip`.
3. Every `<section>` carries `data-numeral` and `data-name`.
4. The two FRAMEWORK-MANAGED regions are byte-stable. Server fingerprints them; tampering returns `E_FRAMEWORK_FENCE_MODIFIED`.
5. All asset URLs are absolute (`https://…`) or root-relative (`/…`). No `./tokens.css` style relative paths.
6. Exactly four top-level `<script>` slots in this order: `#deck-meta` (in head), `#speaker-notes` (in body), framework bootstrap (FRAMEWORK-MANAGED, in body), `#piece-script` (in body). No extras.
7. No inline event handlers (`onclick=`, `onload=`, etc.). Use `#piece-script` and `addEventListener`.
8. No `<base>` tag. No `<meta http-equiv>` other than the charset declaration inside the FRAMEWORK-MANAGED head fence.
9. `<iframe>`, `<video>`, `<audio>` `src` must resolve to a host on the allow-list (`youtube.com`, `youtube-nocookie.com`, `vimeo.com`, `slides.elijahfrost.com`, plus any host in env `ALLOWED_EMBED_HOSTS`).
10. `<script src="…">` outside the framework bootstrap is forbidden. Inline `#piece-script` is the only execution surface.

## What the agent owns

- All slide content: text, headings, body, speaker notes
- Adding / removing / reordering `<section>` children, with matching `speaker-notes` array
- Choosing slide-type class from [SLIDE-TYPES.md](SLIDE-TYPES.md) or defining new ones in `#piece-style`
- Editing `#piece-style` and `#piece-script` freely
- `data-numeral`, `data-name`, `data-halo`, `data-screen-label`, `data-label` on sections
- Updating writable fields in `<deck-meta>` (title, description, tags, date, slide_types_used, agent)
- Adding `<link>` to whitelisted font hosts (Google Fonts, Adobe Fonts)
- Embedding allow-listed media (`<video>`, `<audio>`, `<iframe>` from the allow-list)

## What the agent must NOT do silently (escalate)

- Change `schema`, `framework`, `version_id`, `parent_version_id`, `created_at`, `updated_at`
- Change the `slug` after a piece has been published
- Touch anything inside FRAMEWORK-MANAGED fences
- Add scripts or embed media from non-allow-listed origins
- Remove required `data-*` attributes from a `<section>`
- Mint `version_id`s — only the server does that
- Touch `catalog.json` — the server regenerates it from `<deck-meta>`

## Output format

The agent emits one complete HTML file in a single fenced ` ```html ` code block. No diffs, no partial files, no commentary inside the file. The server replaces the prior file wholesale — there is no merge step.

## Failure handling

The upload validator returns structured errors. Names map to recovery paths:

| Code | Trigger | Recovery |
|---|---|---|
| `E_TOO_LARGE` | > 2 MB | strip heavy inlines, externalize media |
| `E_PARSE` | HTML parser threw | send excerpt back to agent |
| `E_SCHEMA_MISSING_FIELD` | required `<deck-meta>` field absent | agent regenerates with field |
| `E_SCHEMA_UNKNOWN` | `meta.schema` newer than server | wait for site update |
| `E_FRAMEWORK_UNKNOWN` | `meta.framework` not a known version | pin to a known version |
| `E_FRAMEWORK_FENCE_MODIFIED` | fingerprint mismatch | re-download piece, re-apply agent edits |
| `E_STRUCTURE` | one of the hard rules above failed | send rule back to agent |
| `E_DISALLOWED_EMBED` | media `src` off allow-list | remove, or admin adds to env |
| `E_DISALLOWED_SCRIPT` | extra `<script>` or inline handler | strip / move into `#piece-script` |
| `E_VERSION_CONFLICT` | optimistic concurrency lost | re-download, re-apply, re-upload |
| `E_GITHUB` | GitHub API failed | retry; client auto-retries |
| `E_DEPLOY_PENDING` | informational | wait ~30s for Vercel |
