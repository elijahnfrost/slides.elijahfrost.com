/**
 * lib/upload-pipeline.js — the 15-step validation + commit pipeline.
 *
 * Lifted out of api/upload.js so the steps can be unit-tested without
 * spinning up the Vercel function harness. Each step has a single name
 * (matching the plan's catalogue) and returns either a partial result
 * to merge into context or an error object that aborts the pipeline.
 */
import { ulid } from 'ulid';
import { parseDeckMeta, currentSchema, knownFrameworks } from './schema.js';
import { migrateForward } from './migrations.js';
import { verifyFences } from './fences.js';
import {
  parseDeckHtml, extractDeckMetaText, validateStructure, rewriteDeckMeta,
  relativizeFrameworkUrls,
} from './parse.js';
import { getFile, commitFiles, listPieceSlugs } from './github.js';
// lib/og.js is loaded lazily inside the pipeline so a missing optional
// dep there (e.g. @vercel/og runtime issues) doesn't crash the whole
// upload route at module-load time. OG rendering is best-effort.

const MAX_BYTES = 2 * 1024 * 1024;
const TOKEN_ENV = 'DECK_UPLOAD_TOKEN';

/**
 * @typedef {Object} UploadResult
 * @property {boolean} ok
 * @property {string} [code]
 * @property {string} [message]
 * @property {string} [field]
 * @property {string} [fence]
 * @property {string} [rule]
 * @property {string} [slug]
 * @property {string} [version_id]
 * @property {string} [commit_sha]
 */

/**
 * @param {{ rawHtml: string; authHeader: string; origin: string; allowedEmbedHosts?: string[] }} input
 * @returns {Promise<UploadResult>}
 */
export async function runUpload({ rawHtml, authHeader, origin, allowedEmbedHosts }) {
  // Step 1 — auth
  const expected = process.env[TOKEN_ENV];
  if (!expected) return err('E_AUTH', 'Server is missing DECK_UPLOAD_TOKEN env var');
  if (!authHeader || authHeader !== expected) {
    return err('E_AUTH', 'Wrong upload token');
  }

  // Step 2 — rate limit (handled at the api/ layer; runUpload assumes ok)

  // Step 3 — size cap
  const bytes = Buffer.byteLength(rawHtml, 'utf8');
  if (bytes > MAX_BYTES) {
    return err('E_TOO_LARGE', `File is ${bytes} bytes; cap is ${MAX_BYTES}`);
  }

  // Step 4 — HTML parse
  const parsed = parseDeckHtml(rawHtml);
  if (!parsed.ok) return parsed;
  const { document } = parsed;

  // Step 5 — extract deck-meta
  const metaText = extractDeckMetaText(document);
  if (metaText === null) return err('E_SCHEMA_MISSING_FIELD', 'Missing <script id="deck-meta">');

  // Step 6 — migration chain
  let workingHtml = rawHtml;
  let parsedMeta = parseDeckMeta(metaText);
  if (!parsedMeta.ok && parsedMeta.code === 'E_SCHEMA_UNKNOWN') {
    return parsedMeta;
  }
  if (!parsedMeta.ok) return parsedMeta;
  if (parsedMeta.meta.schema !== currentSchema) {
    try {
      const migrated = migrateForward(workingHtml, parsedMeta.meta.schema, currentSchema);
      workingHtml = migrated.html;
      // Re-parse the new meta after migration
      const reparsed = parseDeckHtml(workingHtml);
      if (!reparsed.ok) return reparsed;
      const reMetaText = extractDeckMetaText(reparsed.document);
      const reParsedMeta = parseDeckMeta(reMetaText);
      if (!reParsedMeta.ok) return reParsedMeta;
      parsedMeta = reParsedMeta;
    } catch (e) {
      return err('E_SCHEMA_UNKNOWN', e.message);
    }
  }
  const meta = parsedMeta.meta;

  // Step 7 — framework version known
  if (!knownFrameworks.includes(meta.framework)) {
    return err('E_FRAMEWORK_UNKNOWN', `Unknown framework "${meta.framework}". Known: ${knownFrameworks.join(', ')}`);
  }

  // Step 8 — framework fences match canonical
  // The downloaded file uses absolute URLs in fences; normalize to
  // root-relative before checking (the on-disk canonical is root-relative).
  const normalized = relativizeFrameworkUrls(workingHtml, origin);
  const fenceCheck = verifyFences(normalized, meta.framework);
  if (!fenceCheck.ok) return fenceCheck;

  // Step 9 — optimistic concurrency
  const onDisk = await getFile(`${meta.slug}/index.html`);
  if (onDisk) {
    // Existing piece — parent_version_id must match the current version_id on disk.
    const onDiskParsed = parseDeckHtml(onDisk.content);
    if (onDiskParsed.ok) {
      const onDiskMetaText = extractDeckMetaText(onDiskParsed.document);
      const onDiskMeta = onDiskMetaText ? parseDeckMeta(onDiskMetaText) : null;
      if (onDiskMeta && onDiskMeta.ok) {
        const current = onDiskMeta.meta.version_id;
        if (current && meta.parent_version_id !== current) {
          return {
            ok: false, code: 'E_VERSION_CONFLICT',
            message: 'Another upload landed first. Re-download the piece and re-apply your edits.',
            current_version_id: current,
            slug: meta.slug,
          };
        }
      }
    }
  }

  // Step 10 — structural validation
  const reparsedForStructure = parseDeckHtml(normalized);
  if (!reparsedForStructure.ok) return reparsedForStructure;
  const structure = validateStructure(reparsedForStructure.document, meta, allowedEmbedHosts);
  if (!structure.ok) return structure;

  // Step 11 — already enforced inside validateStructure (script slots, handlers, embeds)

  // Step 12 — mint version_id, set timestamps
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const newMeta = {
    ...meta,
    version_id: ulid(),
    parent_version_id: onDisk ? meta.parent_version_id : null,
    created_at: meta.created_at || now,
    updated_at: now,
  };
  let finalHtml = rewriteDeckMeta(normalized, newMeta);

  // Step 13 — render OG image (best-effort; failure logs but doesn't abort)
  let ogBuffer = null;
  try {
    const { renderOg } = await import('./og.js');
    ogBuffer = await renderOg({ title: newMeta.title, subtitle: newMeta.description });
  } catch (e) {
    console.warn('[upload] OG render failed (proceeding without):', e.message);
  }

  // Step 14 — commit to GitHub (atomic multi-file)
  const files = [
    { path: `${newMeta.slug}/index.html`, content: finalHtml },
  ];
  if (ogBuffer) {
    files.push({ path: `${newMeta.slug}/og-image.png`, content: ogBuffer });
  }
  // Regenerate catalog.json from the future state (current files + this one)
  try {
    const slugs = new Set(await listPieceSlugs());
    slugs.add(newMeta.slug);
    const entries = [];
    for (const slug of slugs) {
      if (slug === newMeta.slug) {
        entries.push(catalogEntry(newMeta));
        continue;
      }
      const f = await getFile(`${slug}/index.html`);
      if (!f) continue;
      const doc = parseDeckHtml(f.content);
      if (!doc.ok) continue;
      const t = extractDeckMetaText(doc.document);
      const p = t ? parseDeckMeta(t) : null;
      if (p && p.ok) entries.push(catalogEntry(p.meta));
    }
    entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    files.push({
      path: 'catalog.json',
      content: JSON.stringify({ pieces: entries }, null, 2) + '\n',
    });
  } catch (e) {
    console.warn('[upload] Catalog regen failed (proceeding):', e.message);
  }

  let commitInfo;
  try {
    commitInfo = await commitFiles(
      files,
      `upload(${newMeta.slug}): ${newMeta.title} [${newMeta.version_id}]`
    );
  } catch (e) {
    return err('E_GITHUB', `GitHub API error: ${e.status || ''} ${e.message}`);
  }

  // Step 15 — success
  return {
    ok: true,
    slug: newMeta.slug,
    version_id: newMeta.version_id,
    commit_sha: commitInfo.commit_sha,
    deploy_url: `${origin}/${newMeta.slug}/`,
  };
}

function catalogEntry(meta) {
  return {
    slug: meta.slug,
    kind: meta.kind || 'deck',
    title: meta.title,
    description: meta.description || '',
    date: meta.date,
    tags: meta.tags || [],
    parent_template: meta.parent_template || null,
  };
}

function err(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}
