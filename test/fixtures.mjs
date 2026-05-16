/**
 * Test fixtures shared by the lib/ unit tests. The HEAD_PIN and BOOTSTRAP
 * strings must stay byte-identical to lib/fences.js's fenceContents.v1.
 */
export const HEAD_PIN =
`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300..600&family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700&display=swap">
<link rel="stylesheet" href="/_framework/v1/tokens.css">
<link rel="stylesheet" href="/_framework/v1/slide-types.css">`;

export const BOOTSTRAP = `<script src="/_framework/v1/deck-stage.js"></script>`;

export function validDeckHtml(overrides = {}) {
  const meta = {
    schema: 'deck/1',
    framework: 'v1',
    slug: 'fixture',
    kind: 'deck',
    parent_template: null,
    pinned: false,
    title: 'Fixture',
    description: 'A test deck.',
    tags: ['test'],
    date: '2026-05-16',
    version_id: null,
    parent_version_id: null,
    created_at: null,
    updated_at: null,
    slide_types_used: ['slide-title'],
    agent: { model: '', session: '' },
    ...overrides,
  };
  return `<!doctype html>
<html lang="en">
<head>
<!-- FRAMEWORK-MANAGED:head-pin — do not edit -->
${HEAD_PIN}
<!-- /FRAMEWORK-MANAGED:head-pin -->
<title>${meta.title}</title>
<script type="application/json" id="deck-meta">${JSON.stringify(meta, null, 2)}</script>
</head>
<body>
<deck-stage width="1920" height="1080" data-slide-types="slide-title">
  <section class="slide-title" data-numeral="I" data-name="Title">
    <div class="slide center"><h1>${meta.title}</h1></div>
  </section>
</deck-stage>
<script type="application/json" id="speaker-notes">[""]</script>
<!-- FRAMEWORK-MANAGED:deck-bootstrap — do not edit -->
${BOOTSTRAP}
<!-- /FRAMEWORK-MANAGED:deck-bootstrap -->
</body>
</html>`;
}
