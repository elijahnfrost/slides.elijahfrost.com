import test from 'node:test';
import { strict as assert } from 'node:assert';
import { extractFence, verifyFences, normalizeFences } from '../lib/fences.js';
import { validDeckHtml } from './fixtures.mjs';

test('extractFence returns trimmed content for both fences', () => {
  const html = validDeckHtml();
  const head = extractFence(html, 'head-pin');
  const boot = extractFence(html, 'deck-bootstrap');
  assert.match(head, /<meta charset="utf-8">/);
  assert.match(boot, /deck-stage\.js/);
});

test('extractFence returns null for an unknown fence', () => {
  assert.equal(extractFence(validDeckHtml(), 'missing'), null);
});

test('verifyFences accepts canonical content', () => {
  const r = verifyFences(validDeckHtml(), 'v1');
  assert.equal(r.ok, true);
});

test('verifyFences rejects a tampered fence', () => {
  const html = validDeckHtml().replace(
    '/_framework/v1/tokens.css',
    '/_framework/v1/EVIL.css'
  );
  const r = verifyFences(html, 'v1');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_FRAMEWORK_FENCE_MODIFIED');
  assert.equal(r.fence, 'head-pin');
});

test('verifyFences rejects a missing fence', () => {
  const html = validDeckHtml().replace(
    /<!-- FRAMEWORK-MANAGED:deck-bootstrap[\s\S]*?<!-- \/FRAMEWORK-MANAGED:deck-bootstrap -->/,
    ''
  );
  const r = verifyFences(html, 'v1');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_FRAMEWORK_FENCE_MODIFIED');
  assert.equal(r.fence, 'deck-bootstrap');
});

test('normalizeFences restores canonical content', () => {
  const html = validDeckHtml().replace(
    '<link rel="stylesheet" href="/_framework/v1/tokens.css">',
    '<!-- broken -->'
  );
  const fixed = normalizeFences(html, 'v1');
  assert.equal(verifyFences(fixed, 'v1').ok, true);
});

test('verifyFences rejects an unknown framework', () => {
  const r = verifyFences(validDeckHtml(), 'v99');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_FRAMEWORK_UNKNOWN');
});
