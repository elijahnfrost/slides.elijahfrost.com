#!/usr/bin/env node
/**
 * bin/build-catalog.mjs — regenerate catalog.json from each piece's
 * <deck-meta> block on disk. Runs as Vercel's build step (npm run
 * vercel-build) and is callable locally.
 *
 * Usage: node bin/build-catalog.mjs
 *
 * Walks the repo root, finds directories that look like piece slugs
 * (kebab-case, not starting with _ or .), reads each one's index.html,
 * extracts <deck-meta>, and writes the aggregated catalog.json.
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeckHtml, extractDeckMetaText } from '../lib/parse.js';
import { parseDeckMeta } from '../lib/schema.js';
import { pruneBlobShadowsForDiskSlugs } from '../lib/blob-storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function main() {
  const entries = await readdir(ROOT, { withFileTypes: true });
  const pieces = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    if (!slugPattern.test(e.name)) continue;
    if (['api', 'lib', 'bin', 'node_modules', 'upload'].includes(e.name)) continue;

    const indexPath = join(ROOT, e.name, 'index.html');
    try {
      await stat(indexPath);
    } catch {
      continue;
    }
    const html = await readFile(indexPath, 'utf8');
    const parsed = parseDeckHtml(html);
    if (!parsed.ok) {
      console.warn(`[build-catalog] ${e.name}: ${parsed.message}`);
      continue;
    }
    const metaText = extractDeckMetaText(parsed.document);
    if (!metaText) {
      console.warn(`[build-catalog] ${e.name}: no <deck-meta> — skipping`);
      continue;
    }
    const m = parseDeckMeta(metaText);
    if (!m.ok) {
      console.warn(`[build-catalog] ${e.name}: ${m.message}`);
      continue;
    }
    pieces.push({
      slug: m.meta.slug,
      kind: m.meta.kind || 'deck',
      title: m.meta.title,
      description: m.meta.description || '',
      date: m.meta.date,
      tags: m.meta.tags || [],
      parent_template: m.meta.parent_template || null,
      pinned: !!m.meta.pinned,
    });
  }

  pieces.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const out = JSON.stringify({ pieces }, null, 2) + '\n';
  await writeFile(join(ROOT, 'catalog.json'), out);
  console.log(`[build-catalog] wrote catalog.json with ${pieces.length} piece(s)`);

  // Auto-supersede: wipe any Blob copy (storage + catalog entry) of a slug
  // that's now present on disk. Without this step the merge in
  // mergeCatalogs would keep showing the stale Blob version with its old
  // metadata and "blob" chip — exactly the editorial-template shadowing
  // we hit on 2026-05-19. No-op when BLOB_READ_WRITE_TOKEN is absent
  // (i.e. local `npm run build-catalog`), so local runs stay offline.
  try {
    const result = await pruneBlobShadowsForDiskSlugs(pieces.map(p => p.slug));
    if (result.skipped) {
      console.log('[build-catalog] blob prune skipped (no BLOB_READ_WRITE_TOKEN)');
    } else {
      console.log(`[build-catalog] blob prune: wiped ${result.wiped_storage} object(s), dropped ${result.wiped_catalog} catalog entry(ies)`);
    }
  } catch (e) {
    // Don't fail the build over a cleanup miss — the catalog.json on
    // disk is already correct; the worst case is a stale Blob shadow
    // that the next deploy will clean up.
    console.warn(`[build-catalog] blob prune failed (non-fatal): ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
