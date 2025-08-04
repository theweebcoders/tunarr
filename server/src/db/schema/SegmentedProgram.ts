import type { Selectable, Insertable, Updateable } from 'kysely';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import type { KyselifyBetter } from './KyselifyBetter.ts';

// Table for storing segmented programs
export const SegmentedProgram = sqliteTable(
  'segmented_program',
  {
    uuid: text().primaryKey(),
    createdAt: integer('created_at'),
    updatedAt: integer('updated_at'),
    externalKey: text('external_key').notNull(), // Primary content reference
    title: text().notNull(),
    duration: integer().notNull(),
    segments: text().notNull(), // JSON string of segments array
  },
  (table) => [
    index('segmented_program_external_key_index').on(table.externalKey),
  ],
);

export type SegmentedProgramTable = KyselifyBetter<typeof SegmentedProgram>;
export type SegmentedProgramDao = Selectable<SegmentedProgramTable>;
export type NewSegmentedProgramDao = Insertable<SegmentedProgramTable>;
export type SegmentedProgramDaoUpdate = Updateable<SegmentedProgramTable>;