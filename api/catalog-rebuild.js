/**
 * api/catalog-rebuild.js — rebuild the catalog from Blob + disk pieces.
 *
 * Useful when the catalog has drifted from storage (concurrent-write race,
 * a botched manual edit, etc.). Walks every piece, re-reads its
 * <deck-meta>, and writes a fresh catalog. Preserves user-state fields
 * from the existing catalog: pinned, kind override, deleted_at, and the
 * tombstones list.
 *
 * Request:  POST /api/catalog-rebuild
 * Response: { ok: true, pieces: <n>, tombstones: <n> }
 *
 * Rate limit: 10/hour per IP — this fans out across every piece.
 */
import {
  getPieceFromBlob, getPieceFromDisk,
  listBlobPieceSlugs, listDiskPieceSlugs,
  getCatalog, putCatalog,
} from '../lib/blob-storage.js';
import { parseDeckHtml, extractDeckMetaText } from '../lib/parse.js';
import { parseDeckMeta } from '../lib/schema.js';

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const memoryWindow = new Map();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = memoryWindow.get(ip) || [];
  const fresh = bucket.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) return false;
  fresh.push(now);
  memoryWindow.set(ip, fresh);
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'E_METHOD', message: 'POST required' });
    return;
  }
  if (!checkRateLimit(getClientIp(req))) {
    res.status(429).json({ ok: false, code: 'E_RATE_LIMIT', message: `> ${RATE_LIMIT_MAX} rebuilds/hour from this IP` });
    return;
  }

  const existing = await getCatalog();
  const tombstones = existing.tombstones || [];
  const stateBySlug = new Map(existing.pieces.map(p => [p.slug, p]));

  const [blobSlugs, diskSlugs] = await Promise.all([
    listBlobPieceSlugs(),
    listDiskPieceSlugs(),
  ]);
  const allSlugs = [...new Set([...blobSlugs, ...diskSlugs])]
    .filter(s => !tombstones.includes(s));

  const pieces = [];
  for (const slug of allSlugs) {
    const piece = (await getPieceFromBlob(slug)) ?? (await getPieceFromDisk(slug));
    if (!piece) continue;
    const parsed = parseDeckHtml(piece.content);
    if (!parsed.ok) continue;
    const metaText = extractDeckMetaText(parsed.document);
    if (!metaText) continue;
    const m = parseDeckMeta(metaText);
    if (!m.ok) continue;

    const prev = stateBySlug.get(slug) || {};
    pieces.push({
      slug: m.meta.slug,
      // user state wins over file meta for organizational fields
      kind: prev.kind ?? (m.meta.kind || 'deck'),
      title: m.meta.title,
      description: m.meta.description || '',
      date: m.meta.date,
      tags: m.meta.tags || [],
      parent_template: m.meta.parent_template || null,
      pinned: prev.pinned ?? !!m.meta.pinned,
      ...(prev.deleted_at ? { deleted_at: prev.deleted_at } : {}),
    });
  }

  pieces.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  try {
    await putCatalog({ pieces, tombstones });
  } catch (e) {
    res.status(502).json({ ok: false, code: 'E_STORAGE', message: `Catalog write failed: ${e.message}` });
    return;
  }

  res.status(200).json({ ok: true, pieces: pieces.length, tombstones: tombstones.length });
}
