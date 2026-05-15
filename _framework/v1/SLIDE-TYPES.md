# Slide-type vocabulary (framework v1)

Canonical layouts. Each is a class on `<section>` inside `<deck-stage>`. The framework supplies the layout bones (type sizes, grids, spacing, hairlines); the piece supplies the content and any motion.

The piece's `<deck-stage>` element should declare which types it uses:

```html
<deck-stage data-slide-types="slide-title,slide-body,slide-list,...">
```

Custom slide-types (defined in the piece's own `#piece-style`) go on the same list. The upload validator uses this attribute to confirm every class used is declared.

## Conventions every slide follows

Every `<section>` inside `<deck-stage>` must carry:

- `data-numeral` — short identifier (e.g. `"I"`, `"§1"`, `"01"`). Author-chosen.
- `data-name` — short slide name shown in chrome (e.g. `"Title"`, `"Catalogue"`).

Optional but useful:

- `data-label` — explicit override for the auto-derived label.
- `data-halo` — for pieces with a halo/cascade motion system, the radius (in cells) to light up around this slide's content.
- `data-screen-label` — the framework auto-fills this; only set explicitly if you need a custom value.

Layout helpers usable on the inner `.slide` div:

- `.center` — flex-center both axes, centered text, 8px gap
- `.left` — flex column, left-aligned, vertically centered

Type-utility classes usable anywhere inside a slide:

- `.eyebrow` — 28px italic serif, dim color (above-the-heading kicker)
- `.label` — 26px uppercase, wide letter-spacing (small-caps label)
- `.display` — large display serif, tight letter-spacing (hero type)
- `.serif-italic` — italic display serif at body size
- `.body` — 30px sans, 1.5 line-height (body copy)
- `.placeholder` + `.placeholder-tag` — hatched placeholder rectangle with a monospace label inside

Tokens you may override on `:root` from the piece's `#piece-style`:

- `--slide-pad-x` (default 120px) — horizontal padding
- `--slide-pad-y` (default 96px) — vertical padding
- `--slide-pad-bottom` (default = `--slide-pad-y`) — bottom padding (bump if your piece has footer chrome)
- `--slide-hairline` — visible-but-quiet rule color
- `--slide-divider` — barely-there row divider

---

## The 18 standard types

Each entry: purpose, required child structure (HTML skeleton), notes. Class on `<section>`.

### 01 · `slide-title`
Cover / hero. Uses `.slide.center` layout.

```html
<section class="slide-title" data-numeral="I" data-name="Title">
  <div class="slide center">
    <p class="eyebrow">An eyebrow</p>
    <h1 class="display hero-name">Hero Title</h1>
    <div class="hero-rule"></div>
    <p class="sub">A subtitle line</p>
  </div>
</section>
```

### 02 · `slide-colophon`
Printed title-page details. Key/value pairs.

```html
<section class="slide-colophon" data-numeral="II" data-name="Colophon">
  <div class="slide left">
    <p class="colophon-head label">Colophon</p>
    <h2 class="colophon-title display">Grid Studies — soft halo</h2>
    <dl class="colophon">
      <dt>Author</dt><dd>Elijah Frost</dd>
      <dt>Set in</dt><dd>Cormorant Garamond and Inter</dd>
      <dt>Pages</dt><dd>18</dd>
    </dl>
  </div>
</section>
```

### 03 · `slide-contents`
Agenda / table of contents.

```html
<section class="slide-contents" data-numeral="III" data-name="Contents">
  <div class="slide left">
    <div class="toc-wrap">
      <div class="toc-head">
        <p class="label">Contents</p>
        <h2 class="display">Eighteen movements</h2>
      </div>
      <ol class="toc-list">
        <li class="toc-item">
          <span class="toc-num">I</span>
          <span class="toc-name">Ouverture</span>
          <span class="toc-page">01</span>
        </li>
        <!-- … more items … -->
      </ol>
    </div>
  </div>
</section>
```

### 04 · `slide-section`
Section opener — a label, a big heading, a one-line lede.

```html
<section class="slide-section" data-numeral="IV" data-name="Movement I">
  <div class="slide left">
    <div class="opener">
      <div class="label-row"><span class="pip"></span><span class="label">Movement I</span></div>
      <h2 class="display">A name for what the grid does.</h2>
      <p class="lede serif-italic">It carries weight. It admits hierarchy. It survives translation.</p>
    </div>
  </div>
</section>
```

### 05 · `slide-body`
Eyebrow + heading + one or two paragraphs of body copy.

```html
<section class="slide-body" data-numeral="V" data-name="Body">
  <div class="slide left">
    <div class="body-stack">
      <h2 class="display">A heading that runs three or four words.</h2>
      <p class="lede">First paragraph. Sets up the point.</p>
      <p class="lede">Second paragraph, optional. Adds nuance.</p>
    </div>
  </div>
</section>
```

### 06 · `slide-list`
Numbered list — each item has a title and a brief description.

```html
<section class="slide-list" data-numeral="VI" data-name="Catalogue">
  <div class="slide left">
    <div class="list-wrap">
      <div class="list-lede">
        <p class="label">Catalogue</p>
        <h2 class="display">Five things the grid does besides decorate.</h2>
        <p>An informal taxonomy.</p>
      </div>
      <ol class="num-list">
        <li class="num-item">
          <span class="num-tag">i.</span>
          <div class="num-text">
            <h3>It establishes scale</h3>
            <p>The cell is a unit. Headlines that span six cells read as headlines without further announcement.</p>
          </div>
        </li>
        <!-- … more items … -->
      </ol>
    </div>
  </div>
</section>
```

### 07 · `slide-pull`
A single huge italic statement (full-bleed pull).

```html
<section class="slide-pull" data-numeral="VII" data-name="Pull">
  <div class="slide center">
    <p class="pull serif-italic"><span class="accent">Hierarchy</span> is not a hierarchy of size.</p>
    <p class="pull-foot label">— from the colophon</p>
  </div>
</section>
```

### 08 · `slide-quote`
A pull-quote with attribution. Centered.

```html
<section class="slide-quote" data-numeral="VIII" data-name="Quote">
  <div class="slide center">
    <blockquote class="quote serif-italic"><span class="marks">“</span>Design is the silent ambassador of your brand.<span class="marks">”</span></blockquote>
    <p class="attrib label">— Paul Rand</p>
  </div>
</section>
```

### 09 · `slide-quote-portrait`
Quote beside a portrait. Two-column.

```html
<section class="slide-quote-portrait" data-numeral="IX" data-name="Portrait">
  <div class="slide left">
    <div class="qp">
      <div class="portrait placeholder" data-halo="6">
        <div class="placeholder-tag">Portrait · 3:4</div>
      </div>
      <div>
        <blockquote class="qp-quote serif-italic"><span class="marks">“</span>The grid is a service, not a master.<span class="marks">”</span></blockquote>
        <p class="qp-attrib"><span class="name">Anna Wong</span><span class="sep"> · </span><span class="role">Type designer</span></p>
      </div>
    </div>
  </div>
</section>
```

### 10 · `slide-stat`
One large statistic plus a small explanatory column.

```html
<section class="slide-stat" data-numeral="X" data-name="Stat">
  <div class="slide left">
    <div class="stat-wrap">
      <div class="stat-num display"><span class="times">×</span>3<span class="unit">.4</span></div>
      <div class="stat-meta">
        <h3>Average increase in reading speed</h3>
        <p>across all body sizes tested, when a grid is present.</p>
      </div>
    </div>
  </div>
</section>
```

### 11 · `slide-stat-grid`
Three KPIs in a row with vertical dividers.

```html
<section class="slide-stat-grid" data-numeral="XI" data-name="KPIs">
  <div class="slide left">
    <div class="grid-lede">
      <p class="label">By the numbers</p>
      <h2 class="display">Three readings of the same instrument.</h2>
    </div>
    <div class="grid3">
      <div class="kpi"><div class="kpi-num display">12</div><p class="kpi-label">columns</p><p class="kpi-note">at the design canvas</p></div>
      <div class="kpi"><div class="kpi-num display">8</div><p class="kpi-label">rows</p><p class="kpi-note">in the working zone</p></div>
      <div class="kpi"><div class="kpi-num display">96</div><p class="kpi-label">cells</p><p class="kpi-note">addressable</p></div>
    </div>
  </div>
</section>
```

### 12 · `slide-split`
Two equal columns with a center divider rule.

```html
<section class="slide-split" data-numeral="XII" data-name="Split">
  <div class="slide left">
    <div class="cols">
      <div>
        <div class="label-row"><span class="label">Before</span></div>
        <h2 class="display">Loose ribbon</h2>
        <p>One paragraph of supporting text.</p>
      </div>
      <div>
        <div class="label-row"><span class="label">After</span></div>
        <h2 class="display">Held column</h2>
        <p>One paragraph of supporting text.</p>
      </div>
    </div>
  </div>
</section>
```

### 13 · `slide-triptych`
Three equal columns with top rules.

```html
<section class="slide-triptych" data-numeral="XIII" data-name="Triptych">
  <div class="slide left">
    <div class="tri-lede">
      <p class="label">Triptych</p>
      <h2 class="display">Three readings.</h2>
    </div>
    <div class="tri">
      <div class="tri-col"><h3>One</h3><p>…</p></div>
      <div class="tri-col"><h3>Two</h3><p>…</p></div>
      <div class="tri-col"><h3>Three</h3><p>…</p></div>
    </div>
  </div>
</section>
```

### 14 · `slide-plate`
Full-bleed image with a caption.

```html
<section class="slide-plate" data-numeral="XIV" data-name="Plate">
  <div class="slide left">
    <div class="plate-wrap">
      <div class="plate placeholder" data-halo="10">
        <div class="placeholder-tag">Plate · 16:9</div>
      </div>
      <div class="plate-cap">
        <p class="caption">A caption running one or two lines.</p>
        <p class="credit label">Credit · 2026</p>
      </div>
    </div>
  </div>
</section>
```

### 15 · `slide-image-text`
50/50 image + text layout.

```html
<section class="slide-image-text" data-numeral="XV" data-name="Image + text">
  <div class="slide left">
    <div class="it">
      <div class="it-image placeholder" data-halo="8">
        <div class="placeholder-tag">Image · 4:5</div>
      </div>
      <div class="it-text">
        <p class="label">Pairing</p>
        <h2 class="display">Image plus a paragraph.</h2>
        <p>Body copy, two or three lines.</p>
      </div>
    </div>
  </div>
</section>
```

### 16 · `slide-timeline`
Horizontal four-beat sequence with dots.

```html
<section class="slide-timeline" data-numeral="XVI" data-name="Timeline">
  <div class="slide left">
    <div class="tl-lede">
      <p class="label">Timeline</p>
      <h2 class="display">Four beats.</h2>
    </div>
    <div class="tl">
      <div class="tl-beat"><span class="dot"></span><p class="year">2020</p><h3>One</h3><p>…</p></div>
      <div class="tl-beat"><span class="dot"></span><p class="year">2022</p><h3>Two</h3><p>…</p></div>
      <div class="tl-beat"><span class="dot"></span><p class="year">2024</p><h3>Three</h3><p>…</p></div>
      <div class="tl-beat"><span class="dot"></span><p class="year">2026</p><h3>Four</h3><p>…</p></div>
    </div>
  </div>
</section>
```

### 17 · `slide-sources`
Numbered citations.

```html
<section class="slide-sources" data-numeral="XVII" data-name="Sources">
  <div class="slide left">
    <div class="src-wrap">
      <p class="src-head label">Sources</p>
      <ol class="src-list">
        <li class="src-item">
          <span class="src-num">1</span>
          <div class="src-cite">
            <span class="work">Title of the work</span>
            <span class="meta">Author · 2024</span>
          </div>
        </li>
        <!-- … more items … -->
      </ol>
    </div>
  </div>
</section>
```

### 18 · `slide-close`
Thank-you / coda.

```html
<section class="slide-close" data-numeral="XVIII" data-name="Close">
  <div class="slide center">
    <p class="end-eyebrow eyebrow">Coda</p>
    <div class="dash"></div>
    <p class="end-name display">— Elijah Frost</p>
  </div>
</section>
```

---

## Defining custom slide-types

A piece can define its own slide-types in `#piece-style`. Use a unique class name (not in the list above), add it to `data-slide-types` on `<deck-stage>`, and supply layout rules:

```css
.slide-mood-board { /* layout rules */ }
.slide-mood-board .grid { /* … */ }
```

```html
<section class="slide-mood-board" data-numeral="XIX" data-name="Mood">
  <div class="slide left">
    <div class="grid"><!-- … --></div>
  </div>
</section>
```

The upload validator confirms every class used appears in `data-slide-types`, but does not require classes to be from the standard 18.
