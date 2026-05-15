/**
 * api/convert.js — duplicate a piece, flipping kind between deck/template.
 *
 * POST /api/convert
 *   Headers: X-Deck-Auth: <DECK_UPLOAD_TOKEN>
 *   Body (JSON): { slug: string, to: "deck"|"template", new_slug?: string }
 *
 * Reads source from Vercel Blob (or disk fallback). Writes the converted
 * piece to Blob and updates the catalog incrementally.
 */
import { ulid } from 'ulid';
import { parseDeckMeta, currentSchema } from '../lib/schema.js';
import {
  parseDeckHtml, extractDeckMetaText, rewriteDeckMeta,
} from '../lib/parse.js';
import {
  getPiece, listAllPieceSlugs, putPiece, getCatalog, putCatalog,
} from '../lib/blob-storage.js';

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

  // Load source piece (Blob first, disk fallback).
  const source = await getPiece(slug);
  if (!source) {
    return send(res, 404, { ok: false, code: 'E_NOT_FOUND', message: `No piece "${slug}"` });
  }
  const parsed = parseDeckHtml(source.content);
  if (!parsed.ok) return send(res, 422, parsed);
  const metaText = extractDeckMetaText(parsed.document);
  if (metaText === null) {
    return send(res, 422, { ok: false, code: 'E_SCHEMA_MISSING_FIELD', message: 'Source missing <deck-meta>' });
  }
  const m = parseDeckMeta(metaText);
  if (!m.ok) return send(res, 422, m);
  const srcMeta = m.meta;

  // Pick destination slug.
  const existing = new Set(await listAllPieceSlugs());
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

  let finalHtml = rewriteDeckMeta(source.content, destMeta);
  finalHtml = finalHtml.replace(
    new RegExp(escapeRe(`/${slug}/`), 'g'),
    `/${destSlug}/`
  );

  // Write piece to Blob.
  try {
    await putPiece(destSlug, finalHtml);
  } catch (e) {
    return send(res, 502, { ok: false, code: 'E_STORAGE', message: `Blob write failed: ${e.message}` });
  }

  // Update catalog incrementally.
  try {
    const catalog = await getCatalog();
    const pieces = (catalog.pieces || []).filter(p => p.slug !== destSlug);
    pieces.push(toCatalogEntry(destMeta));
    pieces.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    await putCatalog({ pieces });
  } catch (e) {
    console.warn('[convert] Catalog update failed:', e.message);
  }

  return send(res, 200, {
    ok: true,
    source_slug: slug,
    slug: destSlug,
    kind: to,
    version_id: destMeta.version_id,
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
  return `${base}-${ulid().slice(-6).toLowerCase()}`;
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
