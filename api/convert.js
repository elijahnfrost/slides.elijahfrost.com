/**
 * api/convert.js — duplicate a piece, flipping kind between deck/template.
 *
 * POST /api/convert
 *   Headers: X-Deck-Auth: <DECK_UPLOAD_TOKEN>
 *   Body (JSON): { slug: string, to: "deck"|"template", new_slug?: string }
 *
 * Behavior:
 *   - Reads <slug>/index.html from the repo.
 *   - Validates its <deck-meta>.
 *   - Creates a NEW piece with the requested kind, a fresh slug, fresh
 *     version_id, and (for deck-from-template) parent_template = source slug.
 *   - Commits the new file + regenerated catalog.json.
 *   - Leaves the source piece untouched.
 *
 * Why duplicate-as: templates and decks have different ergonomic lifetimes
 * (a template is reusable, a deck is one-shot). Conversion creates a new
 * piece so the source's history isn't disturbed.
 */
import { ulid } from 'ulid';
import { parseDeckMeta, currentSchema } from '../lib/schema.js';
import {
  parseDeckHtml, extractDeckMetaText, rewriteDeckMeta,
} from '../lib/parse.js';
import { getFile, listPieceSlugs, commitFiles } from '../lib/github.js';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOKEN_ENV = 'DECK_UPLOAD_TOKEN';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, code: 'E_METHOD', message: 'POST required' });
  }

  const expected = process.env[TOKEN_ENV];
  if (!expected) return send(res, 500, { ok: false, code: 'E_AUTH', message: 'Server missing DECK_UPLOAD_TOKEN' });
  const auth = req.headers['x-deck-auth'];
  if (!auth || auth !== expected) {
    return send(res, 401, { ok: false, code: 'E_AUTH', message: 'Wrong upload token' });
  }

  const body = await readJsonBody(req);
  if (!body) return send(res, 400, { ok: false, code: 'E_BAD_BODY', message: 'Invalid JSON body' });
  const { slug, to, new_slug } = body;
  if (typeof slug !== 'string' || !slugPattern.test(slug)) {
    return send(res, 400, { ok: false, code: 'E_BAD_SLUG', message: 'Bad source slug' });
  }
  if (to !== 'deck' && to !== 'template') {
    return send(res, 400, { ok: false, code: 'E_BAD_KIND', message: 'to must be "deck" or "template"' });
  }
  if (new_slug != null && (typeof new_slug !== 'string' || !slugPattern.test(new_slug))) {
    return send(res, 400, { ok: false, code: 'E_BAD_SLUG', message: 'Bad new_slug' });
  }

  // Load the source piece.
  const onDisk = await getFile(`${slug}/index.html`);
  if (!onDisk) {
    return send(res, 404, { ok: false, code: 'E_NOT_FOUND', message: `No piece "${slug}"` });
  }
  const parsed = parseDeckHtml(onDisk.content);
  if (!parsed.ok) return send(res, 422, parsed);
  const metaText = extractDeckMetaText(parsed.document);
  if (metaText === null) {
    return send(res, 422, { ok: false, code: 'E_SCHEMA_MISSING_FIELD', message: 'Source missing <deck-meta>' });
  }
  const m = parseDeckMeta(metaText);
  if (!m.ok) return send(res, 422, m);
  const srcMeta = m.meta;

  // Pick a destination slug: prefer the caller's new_slug, fall back to
  // a prefix-derived one, then walk until we find a free slot.
  const existing = new Set(await listPieceSlugs());
  const baseSlug = new_slug || derivedSlug(srcMeta, to);
  const destSlug = pickFreeSlug(baseSlug, existing);

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const destMeta = {
    ...srcMeta,
    schema: currentSchema,
    slug: destSlug,
    kind: to,
    parent_template: to === 'deck' && srcMeta.kind === 'template' ? slug : srcMeta.parent_template || null,
    version_id: ulid(),
    parent_version_id: null,
    created_at: now,
    updated_at: now,
  };

  // Rewrite meta + per-piece path-bearing URLs in the file (og-image, etc.)
  let finalHtml = rewriteDeckMeta(onDisk.content, destMeta);
  finalHtml = finalHtml.replace(
    new RegExp(escapeRe(`/${slug}/`), 'g'),
    `/${destSlug}/`
  );

  // Regenerate catalog.json with the new piece included.
  const catalogJson = await rebuildCatalog(existing, destSlug, destMeta);

  const files = [
    { path: `${destSlug}/index.html`, content: finalHtml },
    { path: 'catalog.json', content: catalogJson },
  ];

  let commitInfo;
  try {
    commitInfo = await commitFiles(
      files,
      `convert(${slug}→${destSlug}): kind=${to} [${destMeta.version_id}]`
    );
  } catch (e) {
    return send(res, 502, { ok: false, code: 'E_GITHUB', message: `GitHub API: ${e.status || ''} ${e.message}` });
  }

  return send(res, 200, {
    ok: true,
    source_slug: slug,
    slug: destSlug,
    kind: to,
    version_id: destMeta.version_id,
    commit_sha: commitInfo.commit_sha,
    url: `/${destSlug}/`,
  });
}

function derivedSlug(srcMeta, to) {
  const base = srcMeta.slug;
  if (to === 'template') return base.startsWith('tpl-') ? base : `tpl-${base}`;
  return base.replace(/^tpl-/, '');
}

function pickFreeSlug(base, existing) {
  if (!existing.has(base)) return base;
  for (let i = 2; i < 200; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  // Astronomical fallback — append a short ULID suffix.
  return `${base}-${ulid().slice(-6).toLowerCase()}`;
}

async function rebuildCatalog(existingSlugs, newSlug, newMeta) {
  const slugs = new Set(existingSlugs);
  slugs.add(newSlug);
  const entries = [];
  for (const s of slugs) {
    if (s === newSlug) {
      entries.push(toCatalogEntry(newMeta));
      continue;
    }
    const f = await getFile(`${s}/index.html`);
    if (!f) continue;
    const d = parseDeckHtml(f.content);
    if (!d.ok) continue;
    const t = extractDeckMetaText(d.document);
    const p = t ? parseDeckMeta(t) : null;
    if (p && p.ok) entries.push(toCatalogEntry(p.meta));
  }
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return JSON.stringify({ pieces: entries }, null, 2) + '\n';
}

function toCatalogEntry(meta) {
  return {
    slug: meta.slug,
    kind: meta.kind || 'deck',
    title: meta.title,
    description: meta.description || '',
    date: meta.date,
    tags: meta.tags || [],
    parent_template: meta.parent_template || null,
  };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function send(res, status, body) {
  res.status(status).json(body);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
