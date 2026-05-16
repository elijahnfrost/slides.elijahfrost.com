/**
 * lib/item-mutate.js — in-place edits to a stored piece's organizational
 * metadata (kind, pinned). Does NOT bump version_id — these are user
 * organization actions, not content edits, and we don't want a pin/unpin
 * to invalidate an in-flight agent's parent_version_id.
 *
 * Used by /api/item-update. Reads piece from Blob (or disk fallback),
 * rewrites the deck-meta JSON inside the HTML, writes back to Blob, and
 * patches the same fields in the catalog entry.
 */
import { getPiece, putPiece, getCatalog, putCatalog } from './blob-storage.js';
import { parseDeckHtml, extractDeckMetaText, rewriteDeckMeta } from './parse.js';
import { parseDeckMeta } from './schema.js';

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
    const pieces = catalog.pieces || [];
    const idx = pieces.findIndex(p => p.slug === slug);
    if (idx >= 0) {
      pieces[idx] = { ...pieces[idx], kind: newMeta.kind, pinned: !!newMeta.pinned };
    } else {
      pieces.push({
        slug: newMeta.slug,
        kind: newMeta.kind,
        title: newMeta.title,
        description: newMeta.description || '',
        date: newMeta.date,
        tags: newMeta.tags || [],
        parent_template: newMeta.parent_template || null,
        pinned: !!newMeta.pinned,
      });
    }
    await putCatalog({ pieces });
  } catch (e) {
    console.warn('[item-mutate] Catalog update failed (piece updated, catalog may be stale):', e.message);
  }

  return { ok: true, slug, kind: newMeta.kind, pinned: !!newMeta.pinned };
}
