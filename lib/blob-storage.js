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

// ---- Catalog (Blob first, disk fallback) ----

export async function getCatalog() {
  try {
    const { blobs } = await list({ prefix: CATALOG_PATH, limit: 1 });
    if (blobs.length > 0) {
      const res = await fetch(blobs[0].url);
      if (res.ok) return res.json();
    }
  } catch {}
  try {
    const content = await readFile(join(ROOT, 'catalog.json'), 'utf8');
    return JSON.parse(content);
  } catch {}
  return { pieces: [] };
}

export async function putCatalog(catalogObj) {
  await put(CATALOG_PATH, JSON.stringify(catalogObj, null, 2) + '\n', {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}
