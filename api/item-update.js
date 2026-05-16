/**
 * api/item-update.js — toggle a piece's kind (deck/template) or pinned
 * flag in place. Rewrites the stored HTML's <deck-meta> and patches the
 * catalog entry. Does not mint a new version_id; pin/reclassify are
 * organizational, not content edits.
 *
 * Request:  POST /api/item-update
 *   Headers: Content-Type: application/json
 *   Body:    { "slug": "<slug>", "kind"?: "deck"|"template", "pinned"?: boolean }
 *
 * Response: 200 { ok: true, slug, kind, pinned } on success;
 *           4xx/5xx { ok: false, code, message } on failure.
 *
 * Rate limit: 60/hour per IP. Same memory-window pattern as /api/upload.
 */
import { mutateItem } from '../lib/item-mutate.js';

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const memoryWindow = new Map();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = memoryWindow.get(ip) || [];
  const fresh = bucket.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) return false;
  fresh.push(now);
  memoryWindow.set(ip, fresh);
  return true;
}

export const config = { api: { bodyParser: false } };

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'E_METHOD', message: 'POST required' });
    return;
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    res.status(429).json({ ok: false, code: 'E_RATE_LIMIT', message: `> ${RATE_LIMIT_MAX} updates/hour from this IP` });
    return;
  }

  let body;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (e) {
    res.status(400).json({ ok: false, code: 'E_PARSE', message: 'Body must be JSON: ' + e.message });
    return;
  }

  const result = await mutateItem({
    slug: body.slug,
    kind: body.kind,
    pinned: body.pinned,
  });

  if (result.ok) {
    res.status(200).json(result);
    return;
  }

  const status = {
    E_NO_OP: 400,
    E_BAD_KIND: 400,
    E_BAD_PINNED: 400,
    E_NOT_FOUND: 404,
    E_PARSE: 400,
    E_SCHEMA_MISSING_FIELD: 422,
    E_SCHEMA_UNKNOWN: 422,
    E_STORAGE: 502,
  }[result.code] || 500;
  res.status(status).json(result);
}
