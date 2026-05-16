/**
 * lib/upload-pipeline.js — validation + Blob-storage pipeline.
 *
 * Steps:
 *  1  Rate limit (handled at api/ layer)
 *  2  Size cap (2 MB)
 *  3  HTML parse
 *  4  Extract deck-meta
 *  5  Migration chain
 *  6  Framework version known
 *  7  Framework fences match canonical
 *  8  Optimistic concurrency (parent_version_id)
 *  9  Structural validation
 * 10  Mint version_id + timestamps
 * 11  Render OG image (best-effort)
 * 12  Store to Vercel Blob + update catalog
 * 13  Return success
 */
import { ulid } from 'ulid';
import { parseDeckMeta, currentSchema, knownFrameworks } from './schema.js';
import { migrateForward } from './migrations.js';
import { verifyFences } from './fences.js';
import {
  parseDeckHtml, extractDeckMetaText, validateStructure, rewriteDeckMeta,
  relativizeFrameworkUrls,
} from './parse.js';
import { getPiece, putPiece, getCatalog, putCatalog } from './blob-storage.js';

const MAX_BYTES = 2 * 1024 * 1024;

export async function runUpload({ rawHtml, origin, allowedEmbedHosts, kindOverride }) {
  // Step 2 — size cap
  const bytes = Buffer.byteLength(rawHtml, 'utf8');
  if (bytes > MAX_BYTES) {
    return err('E_TOO_LARGE', `File is ${bytes} bytes; cap is ${MAX_BYTES}`);
  }

  // Step 3 — HTML parse
  const parsed = parseDeckHtml(rawHtml);
  if (!parsed.ok) return parsed;
  const { document } = parsed;

  // Step 4 — extract deck-meta
  const metaText = extractDeckMetaText(document);
  if (metaText === null) return err('E_SCHEMA_MISSING_FIELD', 'Missing <script id="deck-meta">');

  // Step 5 — migration chain
  let workingHtml = rawHtml;
  let parsedMeta = parseDeckMeta(metaText);
  if (!parsedMeta.ok && parsedMeta.code === 'E_SCHEMA_UNKNOWN') return parsedMeta;
  if (!parsedMeta.ok) return parsedMeta;
  if (parsedMeta.meta.schema !== currentSchema) {
    try {
      const migrated = migrateForward(workingHtml, parsedMeta.meta.schema, currentSchema);
      workingHtml = migrated.html;
      const reparsed = parseDeckHtml(workingHtml);
      if (!reparsed.ok) return reparsed;
      const reMeta = parseDeckMeta(extractDeckMetaText(reparsed.document));
      if (!reMeta.ok) return reMeta;
      parsedMeta = reMeta;
    } catch (e) {
      return err('E_SCHEMA_UNKNOWN', e.message);
    }
  }
  const meta = parsedMeta.meta;

  // Step 6 — framework version known
  if (!knownFrameworks.includes(meta.framework)) {
    return err('E_FRAMEWORK_UNKNOWN', `Unknown framework "${meta.framework}". Known: ${knownFrameworks.join(', ')}`);
  }

  // Step 7 — framework fences match canonical
  const normalized = relativizeFrameworkUrls(workingHtml, origin);
  const fenceCheck = verifyFences(normalized, meta.framework);
  if (!fenceCheck.ok) return fenceCheck;

  // Step 8 — optimistic concurrency / slug-collision handling
  //
  // Two cases collapse to "the slug is already taken":
  //   a) parent_version_id is null — this is a fresh file (new from
  //      template, or hand-rolled). Slug collision is just a naming
  //      clash; auto-suffix so the upload succeeds and the user can
  //      delete either copy from the hub.
  //   b) parent_version_id is set and matches the stored version_id —
  //      this is the agent re-uploading the same piece. Normal update.
  //   c) parent_version_id is set but doesn't match — a genuine
  //      concurrent edit. Reject so work isn't silently overwritten.
  let renamedFrom = null;
  let onDisk = await getPiece(meta.slug);
  if (onDisk) {
    const currentVersion = readVersionId(onDisk.content);
    if (currentVersion && meta.parent_version_id === currentVersion) {
      // Case (b): normal update of an existing piece.
    } else if (currentVersion && meta.parent_version_id) {
      // Case (c): stale parent_version_id.
      return {
        ok: false, code: 'E_VERSION_CONFLICT',
        message: 'Another upload landed first. Re-download the piece and re-apply your edits.',
        current_version_id: currentVersion,
        slug: meta.slug,
      };
    } else {
      // Case (a): fresh file colliding with an existing slug — rename.
      const freshSlug = await findFreeSlug(meta.slug);
      renamedFrom = meta.slug;
      meta.slug = freshSlug;
      onDisk = null;
    }
  }

  // Step 9 — structural validation
  const reparsedForStructure = parseDeckHtml(normalized);
  if (!reparsedForStructure.ok) return reparsedForStructure;
  const structure = validateStructure(reparsedForStructure.document, meta, allowedEmbedHosts);
  if (!structure.ok) return structure;

  // Step 10 — mint version_id, set timestamps. Honor a kind override from
  // the upload client (the /upload page's Deck/Template toggle); falls
  // back to whatever the file declared.
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const newMeta = {
    ...meta,
    kind: kindOverride === 'deck' || kindOverride === 'template' ? kindOverride : meta.kind,
    version_id: ulid(),
    parent_version_id: onDisk ? meta.parent_version_id : null,
    created_at: meta.created_at || now,
    updated_at: now,
  };
  const finalHtml = rewriteDeckMeta(normalized, newMeta);

  // Step 11 — render OG image (best-effort)
  let ogBuffer = null;
  try {
    const { renderOg } = await import('./og.js');
    ogBuffer = await renderOg({ title: newMeta.title, subtitle: newMeta.description });
  } catch (e) {
    console.warn('[upload] OG render failed (proceeding without):', e.message);
  }

  // Step 12 — store to Vercel Blob + update catalog incrementally
  try {
    await putPiece(newMeta.slug, finalHtml, ogBuffer);
  } catch (e) {
    return err('E_STORAGE', `Blob write failed: ${e.message}`);
  }

  try {
    const catalog = await getCatalog();
    const pieces = (catalog.pieces || []).filter(p => p.slug !== newMeta.slug);
    pieces.push(catalogEntry(newMeta));
    pieces.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    await putCatalog({ pieces });
  } catch (e) {
    console.warn('[upload] Catalog update failed (piece is live, catalog may be stale):', e.message);
  }

  // Step 13 — success
  return {
    ok: true,
    slug: newMeta.slug,
    version_id: newMeta.version_id,
    deploy_url: `${origin}/${newMeta.slug}/`,
    renamed_from: renamedFrom,
  };
}

function readVersionId(html) {
  const parsed = parseDeckHtml(html);
  if (!parsed.ok) return null;
  const metaText = extractDeckMetaText(parsed.document);
  if (!metaText) return null;
  const m = parseDeckMeta(metaText);
  return m.ok ? (m.meta.version_id || null) : null;
}

// Walk slug, slug-2, slug-3, ... until we find one that doesn't exist.
// Falls back to a short random suffix after a sensible cap.
async function findFreeSlug(base) {
  for (let i = 2; i <= 999; i++) {
    const candidate = `${base}-${i}`;
    if (!(await getPiece(candidate))) return candidate;
  }
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${rand}`;
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

function err(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}
