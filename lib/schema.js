/**
 * lib/schema.js — deck-meta schema validators.
 *
 * Each entry under `schemas` is a zod schema for one major version of the
 * deck-meta block. `currentSchema` is the version the server writes.
 * `parseDeckMeta` is the public entrypoint: it returns either the parsed
 * value or a structured error.
 */
import { z } from 'zod';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slideTypePattern = /^[a-z][a-z0-9-]*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const deck1 = z.object({
  schema: z.literal('deck/1'),
  framework: z.string().regex(/^v\d+$/),
  slug: z.string().regex(slugPattern, 'slug must be kebab-case (lowercase letters, digits, hyphens)'),
  title: z.string().min(1).max(200),
  description: z.string().max(500).default(''),
  tags: z.array(z.string().min(1).max(40)).default([]),
  date: z.string().regex(datePattern, 'date must be YYYY-MM-DD').nullable(),
  version_id: z.string().regex(ulidPattern).nullable(),
  parent_version_id: z.string().regex(ulidPattern).nullable(),
  created_at: z.string().regex(isoPattern).nullable(),
  updated_at: z.string().regex(isoPattern).nullable(),
  slide_types_used: z.array(z.string().regex(slideTypePattern)).default([]),
  agent: z.object({
    model: z.string().default(''),
    session: z.string().default(''),
  }).default({ model: '', session: '' }),
});

export const schemas = {
  'deck/1': deck1,
};

export const currentSchema = 'deck/1';
export const knownFrameworks = ['v1'];

/**
 * @typedef {{ ok: true; meta: any }} ParseOk
 * @typedef {{ ok: false; code: string; field?: string; message: string }} ParseErr
 *
 * @param {string} jsonText  raw JSON text from the <script id="deck-meta"> tag
 * @returns {ParseOk | ParseErr}
 */
export function parseDeckMeta(jsonText) {
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, code: 'E_SCHEMA_MISSING_FIELD', message: 'deck-meta is not valid JSON: ' + e.message };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'E_SCHEMA_MISSING_FIELD', message: 'deck-meta must be a JSON object' };
  }
  const schemaName = raw.schema;
  if (typeof schemaName !== 'string') {
    return { ok: false, code: 'E_SCHEMA_MISSING_FIELD', field: 'schema', message: 'deck-meta.schema is required' };
  }
  const schema = schemas[schemaName];
  if (!schema) {
    return { ok: false, code: 'E_SCHEMA_UNKNOWN', message: `Unknown schema "${schemaName}". Server supports: ${Object.keys(schemas).join(', ')}` };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      code: 'E_SCHEMA_MISSING_FIELD',
      field: issue.path.join('.'),
      message: `${issue.path.join('.')}: ${issue.message}`,
    };
  }
  return { ok: true, meta: result.data };
}
