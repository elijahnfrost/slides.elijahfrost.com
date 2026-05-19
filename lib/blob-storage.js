/**
 * lib/blob-storage.js — unified storage layer using Vercel Blob.
 *
 * Pieces are stored at: pieces/{slug}/index.html
 * OG images at:         pieces/{slug}/og-image.png
 * Catalog at:           catalog.json
 *
 * All reads try Blob first, then fall back to the static files on disk
 * (the git-committed pieces that existed before this storage layer).
 */
import { put, list, del } from '@vercel/blob';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const PIECE_PREFIX = 'pieces/';
const CATALOG_PATH = 'catalog.json';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DISK_SKIP = new Set(['api', 'lib', 'bin', 'node_modules', 'upload']);

// ---- Blob piece writes ----

export async function putPiece(slug, html, ogBuffer) {
  const writes = [
    put(`${PIECE_PREFIX}${slug}/index.html`, html, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'text/html; charset=utf-8',
    }),
  ];
  if (ogBuffer) {
    writes.push(
      put(`${PIECE_PREFIX}${slug}/og-image.png`, ogBuffer, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'image/png',
      })
    );
  }
  await Promise.all(writes);
}

// ---- Blob piece reads ----

export async function getPieceFromBlob(slug) {
  try {
    const { blobs } = await list({ prefix: `${PIECE_PREFIX}${slug}/index.html`, limit: 1 });
    if (blobs.length === 0) return null;
    const res = await fetch(blobs[0].url);
    if (!res.ok) return null;
    return { content: await res.text() };
  } catch {
    return null;
  }
}

// Best-effort delete of every blob under pieces/{slug}/ (index.html, og-image.png,
// and anything else the slug may accumulate later). No-op when nothing matches —
// the caller may still want to drop the catalog entry for a disk-only piece.
export async function deletePieceFromBlob(slug) {
  try {
    const { blobs } = await list({ prefix: `${PIECE_PREFIX}${slug}/`, limit: 100 });
    if (blobs.length === 0) return { deleted: 0 };
    await del(blobs.map(b => b.url));
    return { deleted: blobs.length };
  } catch (e) {
    return { deleted: 0, error: e.message };
  }
}

export async function listBlobPieceSlugs() {
  try {
    const { blobs } = await list({ prefix: PIECE_PREFIX });
    const slugs = new Set();
    for (const blob of blobs) {
      const m = blob.pathname.match(/^pieces\/([^/]+)\/index\.html$/);
      if (m && SLUG_RE.test(m[1])) slugs.add(m[1]);
    }
    return [...slugs];
  } catch {
    return [];
  }
}

// ---- Disk piece reads (static git-committed pieces) ----

export async function getPieceFromDisk(slug) {
  try {
    const content = await readFile(join(ROOT, slug, 'index.html'), 'utf8');
    return { content };
  } catch {
    return null;
  }
}

export async function listDiskPieceSlugs() {
  try {
    const entries = await readdir(ROOT, { withFileTypes: true });
    const slugs = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
      if (!SLUG_RE.test(e.name) || DISK_SKIP.has(e.name)) continue;
      try {
        await stat(join(ROOT, e.name, 'index.html'));
        slugs.push(e.name);
      } catch {}
    }
    return slugs;
  } catch {
    return [];
  }
}

// ---- Combined reads (Blob first, disk fallback) ----

export async function getPiece(slug) {
  return (await getPieceFromBlob(slug)) ?? (await getPieceFromDisk(slug));
}

export async function listAllPieceSlugs() {
  const [blobSlugs, diskSlugs] = await Promise.all([
    listBlobPieceSlugs(),
    listDiskPieceSlugs(),
  ]);
  return [...new Set([...blobSlugs, ...diskSlugs])];
}

// ---- Catalog (Blob overlay over disk base, with source annotation) ----

const CATALOG_DEFAULTS = { pieces: [], tombstones: [] };

function normalizeCatalog(obj) {
  return {
    pieces: Array.isArray(obj?.pieces) ? obj.pieces : [],
    tombstones: Array.isArray(obj?.tombstones) ? obj.tombstones : [],
  };
}

/**
 * Pure merge: combine the Blob catalog (user-state overlay) with the
 * disk catalog (base list of git-committed pieces), drop tombstoned
 * slugs, and annotate each entry with `source: 'disk' | 'blob'`.
 *
 *   blobCatalog : { pieces, tombstones } | null
 *   diskCatalog : { pieces, tombstones } | null
 *   blobSlugs   : slugs that have a piece at pieces/{slug}/ in Blob
 *   diskSlugs   : slugs that have <slug>/index.html on disk
 *
 * Rules:
 *  - Blob entries are kept (they carry pinned, deleted_at, kind override).
 *  - Disk-only entries (slug in diskCatalog but not in blobCatalog) are
 *    appended so newly-committed git pieces appear without a rebuild.
 *  - Tombstones from the Blob catalog filter out matching slugs from both.
 *  - `source` is 'disk' iff the slug exists on disk and NOT in Blob storage.
 *    A piece that exists in both storages is reported as 'blob' (which is
 *    what api/deck.js serves).
 */
export function mergeCatalogs({ blobCatalog, diskCatalog, blobSlugs, diskSlugs }) {
  const blob = normalizeCatalog(blobCatalog);
  const disk = normalizeCatalog(diskCatalog);
  const tombs = new Set(blob.tombstones);
  const blobSet = new Set(blobSlugs || []);
  const diskSet = new Set(diskSlugs || []);

  const sourceFor = (slug) => (blobSet.has(slug) ? 'blob' : (diskSet.has(slug) ? 'disk' : 'blob'));

  const out = [];
  const seen = new Set();

  for (const p of blob.pieces) {
    if (tombs.has(p.slug)) continue;
    out.push({ ...p, source: sourceFor(p.slug) });
    seen.add(p.slug);
  }
  for (const p of disk.pieces) {
    if (seen.has(p.slug) || tombs.has(p.slug)) continue;
    out.push({ ...p, source: sourceFor(p.slug) });
    seen.add(p.slug);
  }

  return { pieces: out, tombstones: [...tombs] };
}

/**
 * Wipe Blob copies (storage + catalog entries) for every slug now present
 * on disk. Called by bin/build-catalog.mjs on every Vercel deploy so a
 * git push of a slug automatically supersedes any earlier /upload/ copy
 * of the same slug — no manual Trash step required. No-op outside the
 * build environment: if BLOB_READ_WRITE_TOKEN is absent the function
 * returns { skipped: true } and writes nothing.
 *
 * The merge in mergeCatalogs prefers Blob entries when both storages
 * have a slug. Removing the Blob shadow lets the disk piece surface
 * with source: 'disk' (→ "git" chip in the hub) automatically.
 *
 * Returns: { wiped_storage: number, wiped_catalog: number, skipped?: true }
 */
export async function pruneBlobShadowsForDiskSlugs(diskSlugs) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { skipped: true };
  const slugs = Array.isArray(diskSlugs) ? diskSlugs.filter(s => SLUG_RE.test(s)) : [];
  if (slugs.length === 0) return { wiped_storage: 0, wiped_catalog: 0 };

  let wiped_storage = 0;
  for (const slug of slugs) {
    const r = await deletePieceFromBlob(slug);
    wiped_storage += r.deleted || 0;
  }

  // Drop matching entries from the Blob catalog so the merge doesn't
  // still surface the old metadata.
  const blobCatalog = await readBlobCatalogRaw();
  if (!blobCatalog) return { wiped_storage, wiped_catalog: 0 };
  const slugSet = new Set(slugs);
  const before = blobCatalog.pieces.length;
  const filtered = {
    pieces: blobCatalog.pieces.filter(p => !slugSet.has(p.slug)),
    tombstones: blobCatalog.tombstones,
  };
  const wiped_catalog = before - filtered.pieces.length;
  if (wiped_catalog > 0) {
    await putCatalog(filtered);
  }
  return { wiped_storage, wiped_catalog };
}

async function readBlobCatalogRaw() {
  try {
    const { blobs } = await list({ prefix: CATALOG_PATH, limit: 1 });
    if (blobs.length === 0) return null;
    const res = await fetch(blobs[0].url);
    if (!res.ok) return null;
    return normalizeCatalog(await res.json());
  } catch {
    return null;
  }
}

async function readDiskCatalogRaw() {
  try {
    const content = await readFile(join(ROOT, 'catalog.json'), 'utf8');
    return normalizeCatalog(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function getCatalog() {
  const [blobCatalog, diskCatalog, blobSlugs, diskSlugs] = await Promise.all([
    readBlobCatalogRaw(),
    readDiskCatalogRaw(),
    listBlobPieceSlugs(),
    listDiskPieceSlugs(),
  ]);
  if (!blobCatalog && !diskCatalog) return { ...CATALOG_DEFAULTS };
  return mergeCatalogs({ blobCatalog, diskCatalog, blobSlugs, diskSlugs });
}

export async function putCatalog(catalogObj) {
  const normalized = normalizeCatalog(catalogObj);
  // `source` is derived (from current storage membership) and recomputed
  // on every read. Don't persist it — otherwise we'd bake in a stale
  // value next to a fresh one.
  const stripped = {
    ...normalized,
    pieces: normalized.pieces.map(({ source, ...rest }) => rest),
  };
  await put(CATALOG_PATH, JSON.stringify(stripped, null, 2) + '\n', {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

// Copy a Blob piece (HTML + og image) from one slug to another. Used by
// rename. Returns true if anything was copied.
export async function copyBlobPiece(srcSlug, dstSlug) {
  const { blobs } = await list({ prefix: `${PIECE_PREFIX}${srcSlug}/`, limit: 100 });
  if (blobs.length === 0) return false;
  await Promise.all(blobs.map(async (b) => {
    const m = b.pathname.match(/^pieces\/[^/]+\/(.+)$/);
    if (!m) return;
    const res = await fetch(b.url);
    if (!res.ok) return;
    const body = await res.arrayBuffer();
    await put(`${PIECE_PREFIX}${dstSlug}/${m[1]}`, Buffer.from(body), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: b.contentType || 'application/octet-stream',
    });
  }));
  return true;
}
