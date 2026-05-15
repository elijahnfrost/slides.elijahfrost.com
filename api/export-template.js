/**
 * api/export-template.js — return a fresh template file.
 *
 * GET /api/export-template?name=<name>     (raw)
 * GET /api/export/template/<name>           (clean, via vercel.json rewrite)
 *   200 text/html  with Content-Disposition: attachment; filename="new-deck.html"
 *   404            if no template by that name
 *
 * Templates live in _framework/v1/templates/. Currently the only one is
 * `blank-deck`. Future names map to files of the same basename.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { parseDeckHtml, extractDeckMetaText, rewriteDeckMeta, absolutizeFrameworkUrls } from '../lib/parse.js';
import { parseDeckMeta } from '../lib/schema.js';

const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, code: 'E_METHOD', message: 'GET required' });
    return;
  }
  const name = req.query?.name;
  if (typeof name !== 'string' || !namePattern.test(name)) {
    res.status(400).json({ ok: false, code: 'E_BAD_NAME', message: 'Bad template name' });
    return;
  }

  const filePath = join(process.cwd(), '_framework', 'v1', 'templates', `${name}.html`);
  let html;
  try {
    html = await readFile(filePath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.status(404).json({ ok: false, code: 'E_NOT_FOUND', message: `No template "${name}"` });
      return;
    }
    res.status(500).json({ ok: false, code: 'E_FS', message: e.message });
    return;
  }

  // Freshen deck-meta on every download — gives the file a starting
  // version_id and today's date, ready to be filled in by the agent.
  const parsed = parseDeckHtml(html);
  if (parsed.ok) {
    const metaText = extractDeckMetaText(parsed.document);
    if (metaText) {
      const p = parseDeckMeta(metaText);
      if (p.ok) {
        const today = new Date().toISOString().slice(0, 10);
        const fresh = {
          ...p.meta,
          version_id: ulid(),
          parent_version_id: null,
          created_at: null,
          updated_at: null,
          date: p.meta.date || today,
        };
        html = rewriteDeckMeta(html, fresh);
      }
    }
  }

  const origin = getOrigin(req);
  const finalHtml = absolutizeFrameworkUrls(html, origin);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="new-deck.html"`);
  res.status(200).send(finalHtml);
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  return `${proto}://${host}`;
}
