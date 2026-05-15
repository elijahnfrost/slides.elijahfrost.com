/**
 * lib/fences.js — extract and fingerprint FRAMEWORK-MANAGED regions.
 *
 * Every deck file declares two regions the agent must not edit:
 *   <!-- FRAMEWORK-MANAGED:head-pin — do not edit --> ... <!-- /FRAMEWORK-MANAGED:head-pin -->
 *   <!-- FRAMEWORK-MANAGED:deck-bootstrap — do not edit --> ... <!-- /FRAMEWORK-MANAGED:deck-bootstrap -->
 *
 * For a given framework version (e.g. "v1"), each region has a canonical
 * byte-stable content. The server hashes the region from the uploaded file
 * and compares to the canonical hash. Mismatch → E_FRAMEWORK_FENCE_MODIFIED.
 *
 * Whitespace at the very start/end of the region content is normalized
 * (trimmed leading/trailing whitespace) so trivial newline differences
 * between editors don't trigger false rejects. Internal content is exact.
 */
import { createHash } from 'node:crypto';

const FENCE_NAMES = ['head-pin', 'deck-bootstrap'];

/** Canonical content of each fence for each framework version. */
export const fenceContents = {
  v1: {
    'head-pin':
`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300..600&family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700&display=swap">
<link rel="stylesheet" href="/_framework/v1/tokens.css">
<link rel="stylesheet" href="/_framework/v1/slide-types.css">`,
    'deck-bootstrap':
`<script src="/_framework/v1/deck-stage.js"></script>`,
  },
};

/** Pre-computed canonical fingerprints for fast comparison. */
export const fenceHashes = computeFenceHashes();

function computeFenceHashes() {
  const out = {};
  for (const [framework, fences] of Object.entries(fenceContents)) {
    out[framework] = {};
    for (const [name, content] of Object.entries(fences)) {
      out[framework][name] = sha256(content);
    }
  }
  return out;
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Extract a fenced region's body from raw HTML. Returns the inner content
 * (trimmed) or null if the fence is missing or malformed.
 */
export function extractFence(html, name) {
  const open = `<!-- FRAMEWORK-MANAGED:${name} — do not edit -->`;
  const close = `<!-- /FRAMEWORK-MANAGED:${name} -->`;
  const openIdx = html.indexOf(open);
  if (openIdx === -1) return null;
  const closeIdx = html.indexOf(close, openIdx + open.length);
  if (closeIdx === -1) return null;
  return html.slice(openIdx + open.length, closeIdx).trim();
}

/**
 * Validate every fence against the canonical for the given framework version.
 * Returns { ok: true } or { ok: false, code, fence, message }.
 */
export function verifyFences(html, framework) {
  const canonical = fenceContents[framework];
  if (!canonical) {
    return { ok: false, code: 'E_FRAMEWORK_UNKNOWN', message: `Unknown framework "${framework}"` };
  }
  for (const name of FENCE_NAMES) {
    const got = extractFence(html, name);
    if (got === null) {
      return {
        ok: false,
        code: 'E_FRAMEWORK_FENCE_MODIFIED',
        fence: name,
        message: `Missing FRAMEWORK-MANAGED:${name} fence. Re-download the piece and re-apply edits.`,
      };
    }
    if (sha256(got) !== fenceHashes[framework][name]) {
      return {
        ok: false,
        code: 'E_FRAMEWORK_FENCE_MODIFIED',
        fence: name,
        message: `FRAMEWORK-MANAGED:${name} content was edited. Re-download the piece and re-apply edits.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Replace a fence's content with the canonical for the given framework.
 * Used by the export endpoint to ensure downloads always carry the latest
 * fenced bytes (even if the on-disk file drifted slightly).
 */
export function normalizeFences(html, framework) {
  const canonical = fenceContents[framework];
  if (!canonical) return html;
  let out = html;
  for (const name of FENCE_NAMES) {
    const open = `<!-- FRAMEWORK-MANAGED:${name} — do not edit -->`;
    const close = `<!-- /FRAMEWORK-MANAGED:${name} -->`;
    const re = new RegExp(
      `${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}`,
      'g'
    );
    out = out.replace(re, `${open}\n${canonical[name]}\n${close}`);
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
