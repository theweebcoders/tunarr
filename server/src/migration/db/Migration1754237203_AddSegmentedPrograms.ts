import { CompiledQuery } from 'kysely';
import { isNonEmptyString } from '../../util/index.ts';
import type { TunarrDatabaseMigration } from '../DirectMigrationProvider.ts';

const expr = String.raw`
CREATE TABLE IF NOT EXISTS segmented_program (
    uuid TEXT PRIMARY KEY,
    created_at INTEGER,
    updated_at INTEGER,
    external_key TEXT NOT NULL,
    title TEXT NOT NULL,
    duration INTEGER NOT NULL,
    segments TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS segmented_program_external_key_index 
ON segmented_program(external_key);
`;

export default {
  fullCopy: false,
  async up(db) {
    const queries = expr
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(isNonEmptyString)
      .map((s) => CompiledQuery.raw(s));

    for (const query of queries) {
      await db.executeQuery(query);
    }
  },
} satisfies TunarrDatabaseMigration;