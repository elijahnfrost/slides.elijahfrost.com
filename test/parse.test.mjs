import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseDeckHtml, extractDeckMetaText, validateStructure, rewriteDeckMeta,
  absolutizeFrameworkUrls, relativizeFrameworkUrls,
} from '../lib/parse.js';
import { parseDeckMeta } from '../lib/schema.js';
import { validDeckHtml } from './fixtures.mjs';

function meta(html) {
  const doc = parseDeckHtml(html).document;
  const m = parseDeckMeta(extractDeckMetaText(doc));
  return { doc, meta: m.meta };
}

test('parseDeckHtml returns a document for valid HTML', () => {
  const r = parseDeckHtml('<!doctype html><html><body>x</body></html>');
  assert.equal(r.ok, true);
  assert.ok(r.document);
});

test('extractDeckMetaText returns the JSON text', () => {
  const doc = parseDeckHtml(validDeckHtml()).document;
  const text = extractDeckMetaText(doc);
  assert.ok(text);
  assert.match(text, /"slug":\s*"fixture"/);
});

test('validateStructure accepts a clean deck', () => {
  const { doc, meta: m } = meta(validDeckHtml());
  const r = validateStructure(doc, m);
  assert.equal(r.ok, true);
});

test('validateStructure rejects multiple <deck-stage>', () => {
  const html = validDeckHtml().replace(
    '</deck-stage>',
    '</deck-stage><deck-stage></deck-stage>'
  );
  const { doc, meta: m } = meta(html);
  const r = validateStructure(doc, m);
  assert.equal(r.ok, false);
  assert.equal(r.rule, 'multiple-deck-stages');
});

test('validateStructure rejects mismatched speaker-notes length', () => {
  const html = validDeckHtml().replace(
    '<script type="application/json" id="speaker-notes">[""]</script>',
    '<script type="application/json" id="speaker-notes">["a", "b"]</script>'
  );
  const { doc, meta: m } = meta(html);
  const r = validateStructure(doc, m);
  assert.equal(r.ok, false);
  assert.equal(r.rule, 'speaker-notes-length-mismatch');
});

test('validateStructure rejects inline event handlers', () => {
  const html = validDeckHtml().replace(
    '<section class="slide-title"',
    '<section onclick="alert(1)" class="slide-title"'
  );
  const { doc, meta: m } = meta(html);
  const r = validateStructure(doc, m);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_DISALLOWED_SCRIPT');
});

test('validateStructure rejects disallowed iframe host', () => {
  const html = validDeckHtml().replace(
    '</deck-stage>',
    '<iframe src="https://evil.example.com/x"></iframe></deck-stage>'
  );
  const { doc, meta: m } = meta(html);
  const r = validateStructure(doc, m);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_DISALLOWED_EMBED');
});

test('rewriteDeckMeta replaces the deck-meta block', () => {
  const html = validDeckHtml();
  const newMeta = { ...meta(html).meta, title: 'Different' };
  const out = rewriteDeckMeta(html, newMeta);
  assert.match(out, /"title":\s*"Different"/);
  // Only one deck-meta in the output.
  const matches = out.match(/id="deck-meta"/g) || [];
  assert.equal(matches.length, 1);
});

test('absolutize / relativize are inverses', () => {
  const html = validDeckHtml();
  const abs = absolutizeFrameworkUrls(html, 'https://example.com');
  assert.match(abs, /https:\/\/example\.com\/_framework\/v1\//);
  const rel = relativizeFrameworkUrls(abs, 'https://example.com');
  assert.equal(rel, html);
});
