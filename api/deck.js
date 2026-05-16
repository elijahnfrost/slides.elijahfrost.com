/**
 * api/deck.js — serve a piece's HTML from Vercel Blob.
 *
 * Called via the vercel.json rewrite:
 *   /:slug/  →  /api/deck?slug=:slug  (check: true)
 *
 * "check: true" means Vercel serves a static file at /:slug/ if one exists
 * (e.g. the git-committed soft-halo piece). This function is only reached
 * for pieces that live exclusively in Blob (newly uploaded ones).
 *
 * The disk fallback below handles the edge case where check:true doesn't
 * intercept a static piece — belt-and-suspenders.
 */
import { getPieceFromBlob, getPieceFromDisk, getCatalog } from '../lib/blob-storage.js';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const slug = req.query?.slug;
  if (typeof slug !== 'string' || !slugPattern.test(slug)) {
    return res.status(400).json({ ok: false, code: 'E_BAD_SLUG', message: 'Bad slug' });
  }

  // Tombstoned slugs (hard-deleted disk pieces) 404 even though the disk
  // file still exists.
  const catalog = await getCatalog();
  if (catalog.tombstones.includes(slug)) {
    return res.status(404).send(
      `<!doctype html><html><body><h1>404</h1><p>No piece &ldquo;${slug}&rdquo;</p><p><a href="/">← Back to hub</a></p></body></html>`
    );
  }

  // Blob-stored piece (new uploads)
  const blobPiece = await getPieceFromBlob(slug);
  if (blobPiece) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(blobPiece.content);
  }

  // Disk fallback (static git pieces)
  const diskPiece = await getPieceFromDisk(slug);
  if (diskPiece) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(diskPiece.content);
  }

  return res.status(404).send(
    `<!doctype html><html><body><h1>404</h1><p>No piece &ldquo;${slug}&rdquo;</p><p><a href="/">← Back to hub</a></p></body></html>`
  );
}
