/**
 * api/catalog.js — serve the unified piece catalog.
 *
 * Called via the vercel.json rewrite: /catalog.json → /api/catalog
 *
 * On first deploy the Blob catalog doesn't exist yet; getCatalog() falls
 * back to the static catalog.json built by bin/build-catalog.mjs. After the
 * first upload, the Blob catalog includes both static and uploaded pieces.
 */
import { getCatalog } from '../lib/blob-storage.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const catalog = await getCatalog();
  res.status(200).json(catalog);
}
