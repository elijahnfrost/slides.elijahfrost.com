/**
 * lib/parse.js — HTML parsing + structural validation.
 *
 * Splits the validation pipeline's parse/structure steps away from the
 * api/upload handler so it's testable and the upload handler stays a
 * sequence of named steps with one purpose each.
 */
import { parseHTML } from 'linkedom';

const ALLOWED_TOP_SCRIPTS = new Set([
  'deck-meta',         // <script type="application/json" id="deck-meta">
  'speaker-notes',     // <script type="application/json" id="speaker-notes">
  'piece-script',      // <script id="piece-script">
  '__framework__',     // the deck-bootstrap script (matched by src)
]);

const DEFAULT_ALLOWED_EMBED_HOSTS = [
  'youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
  'player.vimeo.com', 'vimeo.com',
  'slides.elijahfrost.com',
];

/**
 * Parse the HTML into a DOM. Returns { ok: true, document } or { ok: false, code, message }.
 */
export function parseDeckHtml(html) {
  try {
    const { document } = parseHTML(html);
    if (!document) return { ok: false, code: 'E_PARSE', message: 'Parsed document was null' };
    return { ok: true, document };
  } catch (e) {
    return { ok: false, code: 'E_PARSE', message: e.message };
  }
}

/**
 * Extract the deck-meta JSON text. Returns the text or null if absent.
 */
export function extractDeckMetaText(document) {
  const tag = document.getElementById('deck-meta');
  if (!tag) return null;
  if (tag.getAttribute('type') !== 'application/json') return null;
  return tag.textContent || '';
}

/**
 * Extract the speaker-notes JSON text. Returns the text or null if absent.
 */
export function extractSpeakerNotesText(document) {
  const tag = document.getElementById('speaker-notes');
  if (!tag) return null;
  if (tag.getAttribute('type') !== 'application/json') return null;
  return tag.textContent || '';
}

/**
 * Hard rules from DECK-FORMAT.md, items 1–10. Returns { ok: true } or
 * { ok: false, code, rule, message }.
 *
 * @param {Document} document  parsed DOM
 * @param {object} meta        validated deck-meta
 * @param {string[]} [allowedEmbedHosts]
 */
export function validateStructure(document, meta, allowedEmbedHosts) {
  const allowList = (allowedEmbedHosts && allowedEmbedHosts.length)
    ? allowedEmbedHosts
    : DEFAULT_ALLOWED_EMBED_HOSTS;

  // Rule 1: exactly one <deck-stage>
  const deckStages = document.querySelectorAll('deck-stage');
  if (deckStages.length === 0) {
    return rule('no-deck-stage', 'No <deck-stage> element found');
  }
  if (deckStages.length > 1) {
    return rule('multiple-deck-stages', `Expected exactly one <deck-stage>, found ${deckStages.length}`);
  }
  const deckStage = deckStages[0];

  // Rule 2: speaker-notes array length == count of non-skip sections
  const sections = Array.from(deckStage.querySelectorAll(':scope > section'));
  const activeSections = sections.filter(s => !s.hasAttribute('data-deck-skip'));
  let notesParsed;
  try {
    notesParsed = JSON.parse(extractSpeakerNotesText(document) || '[]');
  } catch (e) {
    return rule('speaker-notes-bad-json', `speaker-notes is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(notesParsed)) {
    return rule('speaker-notes-not-array', 'speaker-notes must be a JSON array');
  }
  if (notesParsed.length !== activeSections.length) {
    return rule('speaker-notes-length-mismatch',
      `speaker-notes has ${notesParsed.length} entries; deck has ${activeSections.length} active sections`);
  }

  // Rule 3: each <section> has data-numeral and data-name
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!s.getAttribute('data-numeral')) {
      return rule('missing-data-numeral', `Section ${i + 1} is missing data-numeral`);
    }
    if (!s.getAttribute('data-name')) {
      return rule('missing-data-name', `Section ${i + 1} is missing data-name`);
    }
  }

  // data-slide-types declares every slide-type used. Check classes on sections.
  const declared = new Set((deckStage.getAttribute('data-slide-types') || '').split(',').map(s => s.trim()).filter(Boolean));
  for (let i = 0; i < sections.length; i++) {
    const classes = (sections[i].getAttribute('class') || '').split(/\s+/).filter(c => c.startsWith('slide-'));
    for (const c of classes) {
      if (!declared.has(c)) {
        return rule('undeclared-slide-type', `Section ${i + 1} uses class "${c}" not in data-slide-types`);
      }
    }
  }

  // Rule 6: exactly four top-level script slots
  const allScripts = Array.from(document.querySelectorAll('script'));
  const offenders = [];
  for (const s of allScripts) {
    const id = s.getAttribute('id');
    const src = s.getAttribute('src') || '';
    if (id === 'deck-meta' || id === 'speaker-notes' || id === 'piece-script') continue;
    if (src.includes('/_framework/') && src.includes('deck-stage.js')) continue;
    offenders.push(src ? `src="${src}"` : `inline${id ? ` id="${id}"` : ''}`);
  }
  if (offenders.length > 0) {
    return {
      ok: false, code: 'E_DISALLOWED_SCRIPT',
      message: `Unexpected <script> tag(s): ${offenders.join(', ')}. Use #piece-script for inline JS.`,
    };
  }

  // Rule 7: no inline event handlers anywhere
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (!el.attributes) continue;
    for (const attr of el.attributes) {
      if (attr.name.startsWith('on')) {
        return {
          ok: false, code: 'E_DISALLOWED_SCRIPT',
          message: `Inline event handler "${attr.name}" on <${el.tagName.toLowerCase()}>. Move into #piece-script.`,
        };
      }
    }
  }

  // Rule 8: no <base>, no <meta http-equiv> beyond charset
  if (document.querySelector('base')) {
    return rule('base-tag-present', '<base> tag is not allowed');
  }
  for (const m of document.querySelectorAll('meta[http-equiv]')) {
    return rule('meta-http-equiv', `<meta http-equiv="${m.getAttribute('http-equiv')}"> is not allowed`);
  }

  // Rule 9: media src on allow-list
  const mediaTags = document.querySelectorAll('iframe, video, audio, source');
  for (const m of mediaTags) {
    const src = m.getAttribute('src');
    if (!src) continue;
    if (src.startsWith('data:')) continue;          // data URIs are OK
    if (src.startsWith('/') && !src.startsWith('//')) continue;  // root-relative OK
    let host;
    try {
      host = new URL(src).hostname;
    } catch {
      return {
        ok: false, code: 'E_DISALLOWED_EMBED',
        message: `Unparseable src on <${m.tagName.toLowerCase()}>: ${src}`,
      };
    }
    const ok = allowList.some(h => host === h || host.endsWith('.' + h));
    if (!ok) {
      return {
        ok: false, code: 'E_DISALLOWED_EMBED',
        message: `<${m.tagName.toLowerCase()} src="…"> host "${host}" is not allow-listed`,
      };
    }
  }

  return { ok: true, deckStage, sections, activeSections, speakerNotes: notesParsed };
}

function rule(name, message) {
  return { ok: false, code: 'E_STRUCTURE', rule: name, message };
}

/**
 * Replace the existing deck-meta block in `html` with `metaObj` re-serialized.
 * Used by the server to stamp `version_id`, `parent_version_id`,
 * `created_at`, `updated_at`. Returns new HTML.
 */
export function rewriteDeckMeta(html, metaObj) {
  const json = JSON.stringify(metaObj, null, 2);
  const re = /<script type="application\/json" id="deck-meta">([\s\S]*?)<\/script>/;
  return html.replace(re, `<script type="application/json" id="deck-meta">${json}</script>`);
}

/**
 * Rewrite framework imports for download. On disk we store root-relative
 * (`/_framework/v1/...`) so local dev works. On download, rewrite to
 * absolute prod URLs so the file renders standalone.
 */
export function absolutizeFrameworkUrls(html, origin) {
  return html.replace(/\/_framework\/v(\d+)\//g, `${origin}/_framework/v$1/`);
}

/**
 * Inverse of absolutizeFrameworkUrls. Strip the prod origin so uploaded
 * files store as root-relative.
 */
export function relativizeFrameworkUrls(html, origin) {
  const re = new RegExp(escapeRe(origin) + '/_framework/v(\\d+)/', 'g');
  return html.replace(re, '/_framework/v$1/');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
