#!/usr/bin/env node
/**
 * bin/new-piece.mjs <slug> ["title"]
 *
 * Scaffolds <slug>/index.html from _framework/v1/templates/blank-deck.html
 * with slug + title + today's date + a fresh version_id pre-filled.
 *
 *   node bin/new-piece.mjs history-of-typography "History of Typography"
 *
 * After this, edit <slug>/index.html (fill in description, tags, sections),
 * then `git add <slug>/ && git commit && git push origin main`.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulid';
import { parseDeckHtml, extractDeckMetaText, rewriteDeckMeta } from '../lib/parse.js';
import { parseDeckMeta } from '../lib/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function main() {
  const [, , slug, title] = process.argv;
  if (!slug) {
    console.error('usage: node bin/new-piece.mjs <slug> ["title"]');
    process.exit(2);
  }
  if (!slugPattern.test(slug)) {
    console.error(`error: "${slug}" is not a valid slug (kebab-case: a-z, 0-9, -)`);
    process.exit(1);
  }

  const dir = join(ROOT, slug);
  const indexPath = join(dir, 'index.html');
  if (await exists(indexPath)) {
    console.error(`error: ${slug}/index.html already exists. Pick a different slug or edit in place.`);
    process.exit(1);
  }

  const templatePath = join(ROOT, '_framework', 'v1', 'templates', 'blank-deck.html');
  const template = await readFile(templatePath, 'utf8');

  const parsed = parseDeckHtml(template);
  if (!parsed.ok) {
    console.error('error: could not parse blank-deck.html:', parsed.message);
    process.exit(1);
  }
  const metaText = extractDeckMetaText(parsed.document);
  if (!metaText) {
    console.error('error: blank-deck.html is missing <deck-meta>');
    process.exit(1);
  }
  const p = parseDeckMeta(metaText);
  if (!p.ok) {
    console.error('error: blank-deck.html has invalid deck-meta:', p.message);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const fresh = {
    ...p.meta,
    slug,
    title: title || p.meta.title,
    version_id: ulid(),
    parent_version_id: null,
    created_at: null,
    updated_at: null,
    date: today,
  };
  const html = rewriteDeckMeta(template, fresh);

  await mkdir(dir, { recursive: true });
  await writeFile(indexPath, html);

  console.log(`Wrote ${slug}/index.html`);
  console.log('');
  console.log('Next:');
  console.log(`  1. Edit ${slug}/index.html — fill in description, tags, sections.`);
  console.log('     Format: _framework/v1/DECK-FORMAT.md');
  console.log('     Layouts: _framework/v1/SLIDE-TYPES.md');
  console.log(`  2. git add ${slug}/ && git commit -m "Add ${slug} deck" && git push origin main`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
