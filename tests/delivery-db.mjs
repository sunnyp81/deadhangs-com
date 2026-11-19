// Execute production claim SQL against a private in-memory SQLite database.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function deliveryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0004_drip_deliveries.sql', import.meta.url), 'utf8'));
  return { prepare(sql) { return { bind(...args) { return {
    async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
    async first() { return db.prepare(sql).get(...args) || null; }
  }; } }; } };
}
