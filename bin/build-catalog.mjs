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
      title: m.meta.title,
      description: m.meta.description || '',
      date: m.meta.date,
      tags: m.meta.tags || [],
    });
  }

  pieces.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const out = JSON.stringify({ pieces }, null, 2) + '\n';
  await writeFile(join(ROOT, 'catalog.json'), out);
  console.log(`[build-catalog] wrote catalog.json with ${pieces.length} piece(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
