import test from 'node:test';
import { strict as assert } from 'node:assert';
import { mergeCatalogs } from '../lib/blob-storage.js';

function piece(slug, extra = {}) {
  return {
    slug,
    kind: 'deck',
    title: slug,
    description: '',
    date: '2026-05-16',
    tags: [],
    parent_template: null,
    pinned: false,
    ...extra,
  };
}

test('Blob-only piece survives with source=blob', () => {
  const r = mergeCatalogs({
    blobCatalog: { pieces: [piece('a')], tombstones: [] },
    diskCatalog: { pieces: [] },
    blobSlugs: ['a'],
    diskSlugs: [],
  });
  assert.equal(r.pieces.length, 1);
  assert.equal(r.pieces[0].source, 'blob');
});

test('Disk-only piece appears with source=disk', () => {
  const r = mergeCatalogs({
    blobCatalog: null,
    diskCatalog: { pieces: [piece('b')] },
    blobSlugs: [],
    diskSlugs: ['b'],
  });
  assert.equal(r.pieces.length, 1);
  assert.equal(r.pieces[0].source, 'disk');
});

test('Same slug in both: Blob entry wins, source=blob (Blob serves)', () => {
  const r = mergeCatalogs({
    blobCatalog: { pieces: [piece('c', { pinned: true })], tombstones: [] },
    diskCatalog: { pieces: [piece('c', { pinned: false, description: 'disk' })] },
    blobSlugs: ['c'],
    diskSlugs: ['c'],
  });
  assert.equal(r.pieces.length, 1);
  assert.equal(r.pieces[0].pinned, true);    // blob state preserved
  assert.equal(r.pieces[0].source, 'blob');
});

test('Pinned disk piece: Blob catalog entry exists, no Blob storage', () => {
  // mutateItem synthesizes a Blob catalog entry when the user pins a
  // disk piece. The piece HTML stays only on disk.
  const r = mergeCatalogs({
    blobCatalog: { pieces: [piece('soft-halo', { pinned: true })], tombstones: [] },
    diskCatalog: { pieces: [piece('soft-halo', { pinned: false })] },
    blobSlugs: [],            // no Blob storage
    diskSlugs: ['soft-halo'],
  });
  assert.equal(r.pieces.length, 1);
  assert.equal(r.pieces[0].pinned, true);
  assert.equal(r.pieces[0].source, 'disk');
});

test('Tombstoned slug is dropped from both sides', () => {
  const r = mergeCatalogs({
    blobCatalog: {
      pieces: [piece('a'), piece('gone')],
      tombstones: ['gone'],
    },
    diskCatalog: { pieces: [piece('gone'), piece('b')] },
    blobSlugs: ['a'],
    diskSlugs: ['gone', 'b'],
  });
  const slugs = r.pieces.map(p => p.slug).sort();
  assert.deepEqual(slugs, ['a', 'b']);
  assert.deepEqual(r.tombstones, ['gone']);
});

test('deleted_at on a Blob entry is preserved', () => {
  const r = mergeCatalogs({
    blobCatalog: {
      pieces: [piece('x', { deleted_at: '2026-05-16T12:00:00Z' })],
      tombstones: [],
    },
    diskCatalog: { pieces: [] },
    blobSlugs: ['x'],
    diskSlugs: [],
  });
  assert.equal(r.pieces[0].deleted_at, '2026-05-16T12:00:00Z');
});

test('Disk piece not in Blob catalog appears with source=disk', () => {
  // The "I just committed a new piece" case.
  const r = mergeCatalogs({
    blobCatalog: { pieces: [piece('existing')], tombstones: [] },
    diskCatalog: { pieces: [piece('existing'), piece('fresh')] },
    blobSlugs: ['existing'],
    diskSlugs: ['existing', 'fresh'],
  });
  const fresh = r.pieces.find(p => p.slug === 'fresh');
  assert.ok(fresh);
  assert.equal(fresh.source, 'disk');
});

test('Empty inputs return empty catalog', () => {
  const r = mergeCatalogs({
    blobCatalog: null,
    diskCatalog: null,
    blobSlugs: [],
    diskSlugs: [],
  });
  assert.deepEqual(r.pieces, []);
  assert.deepEqual(r.tombstones, []);
});
