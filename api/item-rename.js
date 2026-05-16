/**
 * api/item-rename.js — change a piece's slug. Copies storage, rewrites the
 * slug field inside <deck-meta>, and tombstones the old disk slug if needed.
 *
 * Request:  POST /api/item-rename
 *   Body:    { "slug": "<old>", "new_slug": "<new>" }
 *
 * Rate limit: 30/hour per IP.
 */
import { renameItem } from '../lib/item-mutate.js';

const RATE_LIMIT_MAX = 30;
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
  if (!checkRateLimit(getClientIp(req))) {
    res.status(429).json({ ok: false, code: 'E_RATE_LIMIT', message: `> ${RATE_LIMIT_MAX} renames/hour from this IP` });
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

  const result = await renameItem({ slug: body.slug, new_slug: body.new_slug });

  if (result.ok) {
    res.status(200).json(result);
    return;
  }
  const status = {
    E_BAD_SLUG: 400,
    E_NO_OP: 400,
    E_NOT_FOUND: 404,
    E_SLUG_TAKEN: 409,
    E_SCHEMA_MISSING_FIELD: 422,
    E_STORAGE: 502,
  }[result.code] || 500;
  res.status(status).json(result);
}
