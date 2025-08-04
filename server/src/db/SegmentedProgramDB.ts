import { inject, injectable } from 'inversify';
import { v4 as uuidv4 } from 'uuid';
import type {
  SegmentedProgramDao,
  NewSegmentedProgramDao,
  SegmentedProgramDaoUpdate,
} from './schema/SegmentedProgram.js';
import type { Segment } from '@tunarr/types';
import { KEYS } from '@/types/inject.js';
import type { Kysely } from 'kysely';
import type { DB } from './schema/db.js';
import { LoggerFactory } from '@/util/logging/LoggerFactory.js';

@injectable()
export class SegmentedProgramDB {
  private logger = LoggerFactory.child({
    caller: import.meta,
    className: SegmentedProgramDB.name,
  });

  constructor(
    @inject(KEYS.Database) private db: Kysely<DB>,
  ) {}
  async getSegmentedProgram(id: string): Promise<SegmentedProgramDao | null> {
    const result = await this.db
      .selectFrom('segmented_program')
      .selectAll()
      .where('uuid', '=', id)
      .executeTakeFirst();
    
    return result ?? null;
  }

  async getSegmentedProgramById(id: string): Promise<SegmentedProgramDao | null> {
    return this.getSegmentedProgram(id);
  }

  async getAllSegmentedPrograms(): Promise<SegmentedProgramDao[]> {
    return await this.db
      .selectFrom('segmented_program')
      .selectAll()
      .execute();
  }

  async createSegmentedProgram(
    program: Omit<NewSegmentedProgramDao, 'uuid' | 'createdAt' | 'updatedAt' | 'segments'> & {
      segments: Segment[];
    }
  ): Promise<SegmentedProgramDao> {
    return await this.db.transaction().execute(async (trx) => {
      const now = Date.now();
      const uuid = uuidv4();
      
      const newProgram: NewSegmentedProgramDao = {
        ...program,
        uuid,
        created_at: now,
        updated_at: now,
        segments: JSON.stringify(program.segments),
      };

      this.logger.debug('Creating segmented program with data: %O', newProgram);

      try {
        await trx
          .insertInto('segmented_program')
          .values(newProgram)
          .execute();
      } catch (dbError) {
        this.logger.error('Database insert error: %O', dbError);
        throw dbError;
      }

      this.logger.debug('Fetching created program with uuid: %s', uuid);
      const created = await trx
        .selectFrom('segmented_program')
        .selectAll()
        .where('uuid', '=', uuid)
        .executeTakeFirst();
      
      this.logger.debug('Fetched program: %O', created);
      if (!created) {
        throw new Error('Failed to create segmented program');
      }

      return created;
    });
  }

  async updateSegmentedProgram(
    id: string,
    update: Omit<SegmentedProgramDaoUpdate, 'uuid' | 'createdAt' | 'updatedAt' | 'segments'> & {
      segments?: Segment[];
    }
  ): Promise<SegmentedProgramDao | null> {
    return await this.db.transaction().execute(async (trx) => {
      const updateData: SegmentedProgramDaoUpdate = {
        updated_at: Date.now(),
      };

      if (update.title) {
        updateData.title = update.title;
      }
      if (update.duration) {
        updateData.duration = update.duration;
      }
      if (update.external_key) {
        updateData.external_key = update.external_key;
      }
      if (update.segments) {
        updateData.segments = JSON.stringify(update.segments);
      }

      await trx
        .updateTable('segmented_program')
        .set(updateData)
        .where('uuid', '=', id)
        .execute();

      const result = await trx
        .selectFrom('segmented_program')
        .selectAll()
        .where('uuid', '=', id)
        .executeTakeFirst();
      
      return result ?? null;
    });
  }

  async deleteSegmentedProgram(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('segmented_program')
      .where('uuid', '=', id)
      .execute();

    return result.length > 0 && result[0].numDeletedRows > 0;
  }

  async getSegmentedProgramsByExternalKey(externalKey: string): Promise<SegmentedProgramDao[]> {
    return await this.db
      .selectFrom('segmented_program')
      .selectAll()
      .where('external_key', '=', externalKey)
      .execute();
  }

  // Helper method to parse segments from JSON
  parseSegments(dao: SegmentedProgramDao): SegmentedProgramDao & { parsedSegments: Segment[] } {
    return {
      ...dao,
      parsedSegments: JSON.parse(dao.segments) as Segment[],
    };
  }
}