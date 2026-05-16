#!/usr/bin/env node
/**
 * bin/import-piece.mjs <slug>
 *
 * Pulls a piece from production into the repo so an agent can edit it
 * in-place. Use this when a piece was originally uploaded via /upload/
 * (so it lives only in Vercel Blob) and you want to move to the
 * git-managed workflow for future edits.
 *
 *   node bin/import-piece.mjs editorial-template
 *
 * Hits ${ORIGIN}/api/export/<slug> (default ORIGIN:
 * https://slides.elijahfrost.com) and writes the response body to
 * <slug>/index.html, then rewrites framework URLs back to root-relative.
 * Does NOT delete the Blob copy. After your edits are committed and
 * deployed, hard-delete the Blob copy from the hub's Trash so the git
 * copy becomes canonical.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativizeFrameworkUrls } from '../lib/parse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DEFAULT_ORIGIN = 'https://slides.elijahfrost.com';

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function main() {
  const [, , slug] = process.argv;
  if (!slug) {
    console.error('usage: node bin/import-piece.mjs <slug>');
    console.error('       ORIGIN=https://... node bin/import-piece.mjs <slug>');
    process.exit(2);
  }
  if (!slugPattern.test(slug)) {
    console.error(`error: "${slug}" is not a valid slug`);
    process.exit(1);
  }

  const dir = join(ROOT, slug);
  const indexPath = join(dir, 'index.html');
  if (await exists(indexPath)) {
    console.error(`error: ${slug}/index.html already exists. Edit it in place — no import needed.`);
    process.exit(1);
  }

  const origin = (process.env.ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
  const url = `${origin}/api/export/${encodeURIComponent(slug)}`;
  console.log(`Fetching ${url} ...`);

  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error('error: fetch failed:', e.message);
    process.exit(1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`error: HTTP ${res.status} from ${url}`);
    if (body) console.error(body.slice(0, 500));
    process.exit(1);
  }
  const html = await res.text();
  // The export endpoint absolutizes framework URLs for standalone use;
  // for in-repo editing we want them root-relative so local dev works.
  const rewritten = relativizeFrameworkUrls(html, origin);

  await mkdir(dir, { recursive: true });
  await writeFile(indexPath, rewritten);

  console.log(`Wrote ${slug}/index.html (${rewritten.length} bytes)`);
  console.log('');
  console.log('Next:');
  console.log(`  1. Edit ${slug}/index.html.`);
  console.log(`  2. git add ${slug}/ && git commit -m "Import ${slug} from Blob" && git push origin main`);
  console.log(`  3. After deploy, hard-delete the Blob copy of "${slug}" from the hub`);
  console.log(`     (Decks/Templates tab → × → Trash → ⌫) so the git version is canonical.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
