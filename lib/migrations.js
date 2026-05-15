/**
 * lib/migrations.js — schema migration chain.
 *
 * When the server reads a deck file whose `<deck-meta>.schema` is older
 * than the current schema, it walks the chain of migrators in order to
 * bring the file forward. Each migrator takes the raw HTML string and
 * returns a new HTML string with the meta block (and any other affected
 * regions) rewritten to the next schema.
 *
 * The agent NEVER migrates. Migrators run server-side, before validation.
 *
 * Current chain (deck/1 is the first schema, so the chain is empty):
 *   v1.0 is the current floor. Add migrate_1_to_2 here when deck/2 ships.
 */

/** @type {Record<string, (html: string) => string>} */
export const migrators = {
  // 'deck/1->deck/2': (html) => { ... rewrite ... },
};

/**
 * Apply migrations to bring `html` up to `targetSchema`. Throws if a
 * step is missing. Returns the migrated HTML and the new schema string.
 */
export function migrateForward(html, fromSchema, targetSchema) {
  if (fromSchema === targetSchema) return { html, schema: targetSchema };
  // For now there's nothing to migrate — the chain will fill in over time.
  // Walking the chain is implemented but currently a no-op for deck/1.
  let current = fromSchema;
  let working = html;
  const maxSteps = 16;
  for (let i = 0; i < maxSteps; i++) {
    if (current === targetSchema) return { html: working, schema: current };
    const next = nextSchema(current);
    if (!next) {
      throw new Error(`No migration path from ${current} toward ${targetSchema}`);
    }
    const key = `${current}->${next}`;
    const migrator = migrators[key];
    if (!migrator) {
      throw new Error(`Missing migrator ${key}`);
    }
    working = migrator(working);
    current = next;
  }
  throw new Error(`Migration chain exceeded ${maxSteps} steps`);
}

/** Increment the integer portion of "deck/N" by 1. Returns null if malformed. */
function nextSchema(s) {
  const m = /^deck\/(\d+)$/.exec(s);
  if (!m) return null;
  return `deck/${parseInt(m[1], 10) + 1}`;
}
