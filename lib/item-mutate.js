/**
 * lib/item-mutate.js — in-place edits to a stored piece's organizational
 * metadata (kind, pinned, deleted_at, slug). None of these bump version_id —
 * they're user organization actions, not content edits, and we don't want
 * a pin/unpin/rename to invalidate an in-flight agent's parent_version_id.
 *
 * Exports:
 *   mutateItem({ slug, kind?, pinned? })   — toggle kind / pinned
 *   removeItem({ slug, hard? })            — soft-delete (default) or hard
 *   restoreItem({ slug })                  — un-trash a soft-deleted piece
 *   renameItem({ slug, new_slug })         — change a piece's slug
 */
import {
  getPiece, getPieceFromBlob, putPiece, getCatalog, putCatalog,
  deletePieceFromBlob, copyBlobPiece,
} from './blob-storage.js';
import { parseDeckHtml, extractDeckMetaText, rewriteDeckMeta } from './parse.js';
import { parseDeckMeta } from './schema.js';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function mutateItem({ slug, kind, pinned }) {
  if (kind === undefined && pinned === undefined) {
    return { ok: false, code: 'E_NO_OP', message: 'Pass at least one of kind, pinned' };
  }
  if (kind !== undefined && kind !== 'deck' && kind !== 'template') {
    return { ok: false, code: 'E_BAD_KIND', message: 'kind must be "deck" or "template"' };
  }
  if (pinned !== undefined && typeof pinned !== 'boolean') {
    return { ok: false, code: 'E_BAD_PINNED', message: 'pinned must be boolean' };
  }

  const piece = await getPiece(slug);
  if (!piece) {
    return { ok: false, code: 'E_NOT_FOUND', message: `No piece "${slug}"` };
  }

  const parsed = parseDeckHtml(piece.content);
  if (!parsed.ok) return parsed;

  const metaText = extractDeckMetaText(parsed.document);
  if (metaText === null) {
    return { ok: false, code: 'E_SCHEMA_MISSING_FIELD', message: 'Stored piece is missing <deck-meta>' };
  }
  const metaResult = parseDeckMeta(metaText);
  if (!metaResult.ok) return metaResult;

  const newMeta = { ...metaResult.meta };
  if (kind !== undefined) newMeta.kind = kind;
  if (pinned !== undefined) newMeta.pinned = pinned;

  const newHtml = rewriteDeckMeta(piece.content, newMeta);

  try {
    await putPiece(slug, newHtml, null);
  } catch (e) {
    return { ok: false, code: 'E_STORAGE', message: `Blob write failed: ${e.message}` };
  }

  try {
    const catalog = await getCatalog();
    const pieces = catalog.pieces;
    const idx = pieces.findIndex(p => p.slug === slug);
    if (idx >= 0) {
      pieces[idx] = { ...pieces[idx], kind: newMeta.kind, pinned: !!newMeta.pinned };
    } else {
      pieces.push(catalogEntry(newMeta));
    }
    await putCatalog({ ...catalog, pieces });
  } catch (e) {
    console.warn('[item-mutate] Catalog update failed:', e.message);
  }

  return { ok: true, slug, kind: newMeta.kind, pinned: !!newMeta.pinned };
}

/**
 * Soft-delete (default) or hard-delete a piece.
 *
 *  Soft delete  — sets `deleted_at` on the catalog entry. The piece stays
 *                 in Blob (or on disk) and is restorable. The hub filters
 *                 it out of the main view and shows it under Trash.
 *
 *  Hard delete  — wipes the Blob objects under pieces/{slug}/ and drops
 *                 the catalog entry. For disk-only pieces (e.g.
 *                 git-committed soft-halo) we add the slug to the catalog's
 *                 `tombstones` list so api/deck.js 404s the URL.
 */
export async function removeItem({ slug, hard = false }) {
  if (typeof slug !== 'string' || !slugPattern.test(slug)) {
    return { ok: false, code: 'E_BAD_SLUG', message: 'Bad slug' };
  }

  const catalog = await getCatalog();
  const entry = catalog.pieces.find(p => p.slug === slug);
  const onBlob = !!(await getPieceFromBlob(slug));
  const piece = await getPiece(slug);

  if (!piece && !entry) {
    return { ok: false, code: 'E_NOT_FOUND', message: `No piece "${slug}"` };
  }

  if (!hard) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    if (entry) {
      entry.deleted_at = now;
    } else if (piece) {
      // Disk piece with no catalog entry yet — synthesize one so we can
      // mark it deleted.
      catalog.pieces.push({
        slug,
        kind: 'deck',
        title: slug,
        description: '',
        date: null,
        tags: [],
        parent_template: null,
        pinned: false,
        deleted_at: now,
      });
    }
    try {
      await putCatalog(catalog);
    } catch (e) {
      return { ok: false, code: 'E_STORAGE', message: `Catalog write failed: ${e.message}` };
    }
    return { ok: true, slug, soft: true, deleted_at: now };
  }

  // Hard delete
  let blobDeleted = 0;
  if (onBlob) {
    const r = await deletePieceFromBlob(slug);
    blobDeleted = r.deleted || 0;
  }

  const before = catalog.pieces.length;
  catalog.pieces = catalog.pieces.filter(p => p.slug !== slug);
  const droppedEntry = catalog.pieces.length !== before;

  // If the piece existed only on disk (or in addition to Blob), tombstone
  // the slug so api/deck.js refuses to serve it.
  if (!onBlob && piece) {
    if (!catalog.tombstones.includes(slug)) catalog.tombstones.push(slug);
  }

  try {
    await putCatalog(catalog);
  } catch (e) {
    return { ok: false, code: 'E_STORAGE', message: `Catalog write failed: ${e.message}` };
  }

  return {
    ok: true,
    slug,
    soft: false,
    blob_deleted: blobDeleted,
    catalog_dropped: droppedEntry,
    tombstoned: !onBlob && !!piece,
  };
}

/** Clear deleted_at on a soft-deleted entry. */
export async function restoreItem({ slug }) {
  if (typeof slug !== 'string' || !slugPattern.test(slug)) {
    return { ok: false, code: 'E_BAD_SLUG', message: 'Bad slug' };
  }
  const catalog = await getCatalog();
  const entry = catalog.pieces.find(p => p.slug === slug);
  if (!entry) {
    return { ok: false, code: 'E_NOT_FOUND', message: `No piece "${slug}"` };
  }
  delete entry.deleted_at;
  try {
    await putCatalog(catalog);
  } catch (e) {
    return { ok: false, code: 'E_STORAGE', message: `Catalog write failed: ${e.message}` };
  }
  return { ok: true, slug };
}

/**
 * Rename a piece. For Blob pieces: copy under new slug, delete old. For
 * disk pieces: read from disk, write to Blob under new slug, tombstone old
 * disk slug. Updates the catalog entry and the deck-meta inside the file.
 */
export async function renameItem({ slug, new_slug }) {
  if (typeof slug !== 'string' || !slugPattern.test(slug)) {
    return { ok: false, code: 'E_BAD_SLUG', message: 'Bad slug' };
  }
  if (typeof new_slug !== 'string' || !slugPattern.test(new_slug)) {
    return { ok: false, code: 'E_BAD_SLUG', message: 'Bad new_slug' };
  }
  if (new_slug === slug) {
    return { ok: false, code: 'E_NO_OP', message: 'new_slug equals slug' };
  }

  const target = await getPiece(new_slug);
  if (target) {
    return { ok: false, code: 'E_SLUG_TAKEN', message: `"${new_slug}" already exists` };
  }
  const catalog = await getCatalog();
  if (catalog.tombstones.includes(new_slug)) {
    return { ok: false, code: 'E_SLUG_TAKEN', message: `"${new_slug}" is tombstoned` };
  }

  const piece = await getPiece(slug);
  if (!piece) {
    return { ok: false, code: 'E_NOT_FOUND', message: `No piece "${slug}"` };
  }

  // Rewrite deck-meta.slug inside the file.
  const parsed = parseDeckHtml(piece.content);
  if (!parsed.ok) return parsed;
  const metaText = extractDeckMetaText(parsed.document);
  if (!metaText) {
    return { ok: false, code: 'E_SCHEMA_MISSING_FIELD', message: 'Stored piece is missing <deck-meta>' };
  }
  const parsedMeta = parseDeckMeta(metaText);
  if (!parsedMeta.ok) return parsedMeta;
  const newMeta = { ...parsedMeta.meta, slug: new_slug };
  const newHtml = rewriteDeckMeta(piece.content, newMeta);

  // Write to new location first, so a failure leaves the original intact.
  try {
    await putPiece(new_slug, newHtml, null);
  } catch (e) {
    return { ok: false, code: 'E_STORAGE', message: `Blob write failed: ${e.message}` };
  }

  // Copy any side artifacts (e.g. og-image.png) when the source was a Blob piece.
  const onBlob = !!(await getPieceFromBlob(slug));
  if (onBlob) {
    try { await copyBlobPiece(slug, new_slug); } catch {}
    await deletePieceFromBlob(slug);
  }

  // Patch the catalog.
  const idx = catalog.pieces.findIndex(p => p.slug === slug);
  if (idx >= 0) {
    catalog.pieces[idx] = { ...catalog.pieces[idx], slug: new_slug };
  } else {
    catalog.pieces.push(catalogEntry(newMeta));
  }
  // If the source was a disk piece, tombstone the old slug.
  if (!onBlob && !catalog.tombstones.includes(slug)) {
    catalog.tombstones.push(slug);
  }

  try {
    await putCatalog(catalog);
  } catch (e) {
    return { ok: false, code: 'E_STORAGE', message: `Catalog write failed: ${e.message}` };
  }

  return { ok: true, slug: new_slug, renamed_from: slug };
}

function catalogEntry(meta) {
  return {
    slug: meta.slug,
    kind: meta.kind || 'deck',
    title: meta.title,
    description: meta.description || '',
    date: meta.date,
    tags: meta.tags || [],
    parent_template: meta.parent_template || null,
    pinned: !!meta.pinned,
  };
}
