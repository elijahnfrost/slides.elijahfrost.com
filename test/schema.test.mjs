import test from 'node:test';
import { strict as assert } from 'node:assert';
import { parseDeckMeta, currentSchema } from '../lib/schema.js';

test('parseDeckMeta accepts a minimal valid deck-meta', () => {
  const meta = {
    schema: 'deck/1', framework: 'v1', slug: 'ok',
    title: 'Title', date: null,
    version_id: null, parent_version_id: null,
    created_at: null, updated_at: null,
  };
  const r = parseDeckMeta(JSON.stringify(meta));
  assert.equal(r.ok, true);
  assert.equal(r.meta.kind, 'deck');         // default
  assert.equal(r.meta.pinned, false);        // default
  assert.deepEqual(r.meta.tags, []);         // default
});

test('parseDeckMeta rejects malformed JSON', () => {
  const r = parseDeckMeta('not json');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_SCHEMA_MISSING_FIELD');
});

test('parseDeckMeta rejects unknown schema', () => {
  const r = parseDeckMeta(JSON.stringify({ schema: 'deck/99' }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_SCHEMA_UNKNOWN');
});

test('parseDeckMeta rejects bad slug', () => {
  const r = parseDeckMeta(JSON.stringify({
    schema: 'deck/1', framework: 'v1', slug: 'Not-Kebab',
    title: 't', date: null,
    version_id: null, parent_version_id: null,
    created_at: null, updated_at: null,
  }));
  assert.equal(r.ok, false);
  assert.equal(r.field, 'slug');
});

test('parseDeckMeta rejects bad framework', () => {
  const r = parseDeckMeta(JSON.stringify({
    schema: 'deck/1', framework: 'nope', slug: 'ok',
    title: 't', date: null,
    version_id: null, parent_version_id: null,
    created_at: null, updated_at: null,
  }));
  assert.equal(r.ok, false);
  assert.equal(r.field, 'framework');
});

test('currentSchema is deck/1', () => {
  assert.equal(currentSchema, 'deck/1');
});
