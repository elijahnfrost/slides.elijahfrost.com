/**
 * api/upload.js — Vercel serverless function that accepts an HTML deck
 * file and commits it to the repo after running the validation pipeline.
 *
 * Request:  POST /api/upload
 *   Headers: X-Deck-Auth (token), Content-Type: text/html
 *   Body:    the raw HTML bytes
 *
 * Response: JSON. 200 with { slug, version_id, commit_sha, deploy_url }
 *           on success; 4xx/5xx with { ok: false, code, message, ... }
 *           on failure.
 *
 * Rate limit: 30/hour per IP. Uses Vercel KV if KV_REST_API_URL is set;
 * otherwise an in-memory window per cold instance (best-effort).
 */
import { runUpload } from '../lib/upload-pipeline.js';

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const memoryWindow = new Map();

function getOrigin(req) {
  // Trust the host header on Vercel since the function is invoked at that
  // origin. Local dev sets `host` correctly.
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'];
  return `${proto}://${host}`;
}

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
    res.status(429).json({ ok: false, code: 'E_RATE_LIMIT', message: `> ${RATE_LIMIT_MAX} uploads/hour from this IP` });
    return;
  }

  let rawHtml;
  try {
    rawHtml = await readBody(req);
  } catch (e) {
    res.status(400).json({ ok: false, code: 'E_PARSE', message: 'Could not read body: ' + e.message });
    return;
  }

  const authHeader = req.headers['x-deck-auth'] || req.headers['X-Deck-Auth'] || '';
  const origin = getOrigin(req);
  const allowedEmbedHosts = (process.env.ALLOWED_EMBED_HOSTS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const result = await runUpload({ rawHtml, authHeader, origin, allowedEmbedHosts });

  if (result.ok) {
    res.status(200).json(result);
    return;
  }

  // Map error codes to HTTP status
  const status = {
    E_AUTH: 401,
    E_RATE_LIMIT: 429,
    E_TOO_LARGE: 413,
    E_PARSE: 400,
    E_SCHEMA_MISSING_FIELD: 422,
    E_SCHEMA_UNKNOWN: 422,
    E_FRAMEWORK_UNKNOWN: 422,
    E_FRAMEWORK_FENCE_MODIFIED: 422,
    E_STRUCTURE: 422,
    E_DISALLOWED_EMBED: 422,
    E_DISALLOWED_SCRIPT: 422,
    E_VERSION_CONFLICT: 409,
    E_STORAGE: 502,
  }[result.code] || 500;

  res.status(status).json(result);
}
