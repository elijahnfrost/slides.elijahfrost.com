/**
 * api/export-piece.js — return a piece's HTML with framework imports
 * rewritten to absolute prod URLs and <deck-meta> freshened for download.
 *
 * GET /api/export-piece?slug=<slug>     (raw)
 * GET /api/export/<slug>                 (clean, via vercel.json rewrite)
 *   200 text/html  with Content-Disposition: attachment; filename="<slug>.html"
 *   404            if no piece with that slug exists
 *
 * Reads from Vercel Blob first, then falls back to static files on disk
 * (git-committed pieces that predate the Blob storage layer).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { getPieceFromBlob } from '../lib/blob-storage.js';
import { parseDeckHtml, extractDeckMetaText, rewriteDeckMeta, absolutizeFrameworkUrls } from '../lib/parse.js';
import { parseDeckMeta } from '../lib/schema.js';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'E_METHOD', message: 'GET required' });
    return;
  }
  const slug = req.query?.slug;
  if (typeof slug !== 'string' || !slugPattern.test(slug)) {
    res.status(400).json({ ok: false, code: 'E_BAD_SLUG', message: 'Bad slug' });
    return;
  }

  // Try Blob first (uploaded pieces), then disk (git-committed pieces).
  let html;
  const blobPiece = await getPieceFromBlob(slug);
  if (blobPiece) {
    html = blobPiece.content;
  } else {
    try {
      html = await readFile(join(process.cwd(), slug, 'index.html'), 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        res.status(404).json({ ok: false, code: 'E_NOT_FOUND', message: `No piece "${slug}"` });
        return;
      }
      res.status(500).json({ ok: false, code: 'E_FS', message: e.message });
      return;
    }
  }

  const parsed = parseDeckHtml(html);
  if (!parsed.ok) {
    res.status(500).json(parsed);
    return;
  }
  const metaText = extractDeckMetaText(parsed.document);
  let metaObj;
  if (metaText) {
    const p = parseDeckMeta(metaText);
    metaObj = p.ok ? p.meta : null;
  }
  if (metaObj) {
    metaObj.version_id = metaObj.version_id || ulid();
    metaObj.updated_at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    html = rewriteDeckMeta(html, metaObj);
  }

  const origin = getOrigin(req);
  const finalHtml = absolutizeFrameworkUrls(html, origin);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.html"`);
  res.status(200).send(finalHtml);
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  return `${proto}://${host}`;
}
