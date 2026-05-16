/**
 * api/item-delete.js — remove a piece from Blob storage and the catalog.
 *
 * Request:  POST /api/item-delete
 *   Headers: Content-Type: application/json
 *   Body:    { "slug": "<slug>" }
 *
 * Response: 200 { ok: true, slug, blob_deleted, catalog_updated } on success;
 *           4xx/5xx { ok: false, code, message } on failure.
 *
 * Disk-only pieces (the git-committed ones like soft-halo) can't be
 * physically removed here — we just drop the catalog entry, which hides
 * them from the hub. Direct /<slug>/ URLs continue to work for those.
 *
 * Rate limit: 30/hour per IP, same pattern as /api/upload.
 */
import { removeItem } from '../lib/item-mutate.js';

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

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    res.status(429).json({ ok: false, code: 'E_RATE_LIMIT', message: `> ${RATE_LIMIT_MAX} deletes/hour from this IP` });
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

  const result = await removeItem({ slug: body.slug });

  if (result.ok) {
    res.status(200).json(result);
    return;
  }

  const status = {
    E_BAD_SLUG: 400,
    E_NOT_FOUND: 404,
    E_STORAGE: 502,
  }[result.code] || 500;
  res.status(status).json(result);
}
