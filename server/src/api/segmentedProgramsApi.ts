import type { RouterPluginAsyncCallback } from '@/types/serverType.js';
import { LoggerFactory } from '@/util/logging/LoggerFactory.js';
import { z } from 'zod/v4';
import {
  CreateSegmentedProgramRequestSchema,
  SegmentedProgramResponseSchema,
  SegmentedProgramValidationResponseSchema,
  CalculateSegmentOffsetsRequestSchema,
  CalculateSegmentOffsetsResponseSchema,
} from '@tunarr/types/api';
import type { Segment } from '@tunarr/types';
import { sumBy } from 'lodash-es';
import type { FillerDB } from '@/db/FillerListDB.js';
import type { IProgramDB } from '@/db/interfaces/IProgramDB.js';

const ValidationErrorSchema = z.object({
  error: z.string(),
  details: z.array(z.string()).optional(),
});

// Duration tolerance: 100ms or 0.1% of total duration, whichever is larger
const DURATION_TOLERANCE_MS = 100;
const DURATION_TOLERANCE_PERCENT = 0.001; // 0.1%

// Helper to convert DAO to response format
function segmentedProgramDaoToResponse(dao: { 
  uuid: string;
  externalKey: string;
  title: string;
  duration: number;
  segments: string | Segment[];
}): z.infer<typeof SegmentedProgramResponseSchema> {
  return {
    id: dao.uuid,
    type: 'segmented' as const,
    externalKey: dao.externalKey,
    title: dao.title,
    duration: dao.duration,
    segments: typeof dao.segments === 'string' ? JSON.parse(dao.segments) as Segment[] : dao.segments,
    persisted: true,
  };
}

// Validation helper to ensure segment durations match total duration
function validateSegmentDurations(
  segments: Segment[],
  totalDuration: number,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check for empty segments array
  if (segments.length === 0) {
    errors.push('Segments array cannot be empty');
    return { valid: false, errors };
  }
  
  const segmentDurationSum = sumBy(segments, (s) => s.duration);
  const tolerance = Math.max(DURATION_TOLERANCE_MS, totalDuration * DURATION_TOLERANCE_PERCENT);
  
  if (Math.abs(segmentDurationSum - totalDuration) > tolerance) {
    errors.push(
      `Segment durations sum (${segmentDurationSum}ms) does not match total duration (${totalDuration}ms) within tolerance (${Math.round(tolerance)}ms)`
    );
  }

  // Validate each segment
  segments.forEach((segment, index) => {
    // Check for zero or negative duration
    if (segment.duration <= 0) {
      errors.push(`Segment ${index}: duration must be positive (got ${segment.duration})`);
    }
    
    if (segment.type === 'media-slice') {
      if (segment.start >= segment.stop) {
        errors.push(
          `Segment ${index}: start time (${segment.start}) must be less than stop time (${segment.stop})`
        );
      }
      if (segment.stop - segment.start !== segment.duration) {
        errors.push(
          `Segment ${index}: duration (${segment.duration}) does not match stop - start (${segment.stop - segment.start})`
        );
      }
      if (segment.start < 0) {
        errors.push(`Segment ${index}: start time cannot be negative`);
      }
    }
    
    // Validate external key format
    if (segment.type === 'media-slice' || segment.type === 'media-item') {
      const parts = segment.externalKey.split('|');
      if (parts.length < 3) {
        errors.push(
          `Segment ${index}: invalid external key format '${segment.externalKey}' (expected 'type|serverId|itemId')`
        );
      } else {
        // Validate that the parts are not empty
        const [sourceType, serverId, ...itemIdParts] = parts;
        if (!sourceType || !serverId || itemIdParts.length === 0) {
          errors.push(
            `Segment ${index}: external key parts cannot be empty in '${segment.externalKey}'`
          );
        }
      }
    }
  });

  // Check for overlapping media-slice segments from the same source
  const mediaSlicesBySource = new Map<string, Array<{ index: number; start: number; stop: number }>>();
  
  segments.forEach((segment, index) => {
    if (segment.type === 'media-slice') {
      const key = segment.externalKey;
      if (!mediaSlicesBySource.has(key)) {
        mediaSlicesBySource.set(key, []);
      }
      mediaSlicesBySource.get(key)!.push({ index, start: segment.start, stop: segment.stop });
    }
  });
  
  // Check for overlaps within each source
  mediaSlicesBySource.forEach((slices, externalKey) => {
    if (slices.length > 1) {
      // Sort by start time
      slices.sort((a, b) => a.start - b.start);
      
      for (let i = 1; i < slices.length; i++) {
        if (slices[i].start < slices[i-1].stop) {
          errors.push(
            `Segments ${slices[i-1].index} and ${slices[i].index}: media slices from '${externalKey}' overlap (${slices[i-1].start}-${slices[i-1].stop} and ${slices[i].start}-${slices[i].stop})`
          );
        }
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

// Async validation helper to check if referenced content exists
async function validateReferencedContent(
  segments: Segment[],
  programDB: IProgramDB,
  fillerDB: FillerDB,
  parentExternalKey?: string, // For circular reference checking
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Collect all external keys to validate
  const externalKeysToValidate = new Set<string>();
  const fillerListIdsToValidate = new Set<string>();
  
  segments.forEach((segment, index) => {
    if (segment.type === 'media-slice' || segment.type === 'media-item') {
      // Check for circular reference
      if (parentExternalKey && segment.externalKey === parentExternalKey) {
        errors.push(`Segment ${index}: circular reference detected - segment references its own parent program`);
      } else {
        externalKeysToValidate.add(segment.externalKey);
      }
    } else if (segment.type === 'filler-item') {
      fillerListIdsToValidate.add(segment.fillerListId);
    }
  });
  
  // Validate external keys exist
  if (externalKeysToValidate.size > 0) {
    const externalKeyTuples = [...externalKeysToValidate].map(key => {
      const parts = key.split('|');
      const [type, serverId, ...itemIdParts] = parts;
      const itemId = itemIdParts.join('|'); // Handle | in itemId
      return [type, serverId, itemId] as [string, string, string];
    });
    
    const lookupResults = await programDB.lookupByExternalIds(
      new Set(externalKeyTuples)
    );
    
    // Check which keys weren't found and validate media-slice durations
    const foundPrograms = new Map<string, { duration: number }>();
    Object.values(lookupResults).forEach((program) => {
      if (program.externalKey) {
        const key = `${program.externalSourceType}|${program.externalSourceId}|${program.externalKey}`;
        foundPrograms.set(key, program);
      }
    });
    
    externalKeysToValidate.forEach(key => {
      if (!foundPrograms.has(key)) {
        const segmentIndex = segments.findIndex(
          s => (s.type === 'media-slice' || s.type === 'media-item') && s.externalKey === key
        );
        errors.push(`Segment ${segmentIndex}: referenced content '${key}' not found`);
      }
    });
    
    // Validate media-slice segments don't exceed source duration
    segments.forEach((segment, index) => {
      if (segment.type === 'media-slice') {
        const program = foundPrograms.get(segment.externalKey);
        if (program && segment.stop > program.duration) {
          errors.push(
            `Segment ${index}: media-slice stop time (${segment.stop}ms) exceeds source media duration (${program.duration}ms)`
          );
        }
      }
    });
  }
  
  // Validate filler lists exist
  if (fillerListIdsToValidate.size > 0) {
    for (const fillerListId of fillerListIdsToValidate) {
      const fillerList = await fillerDB.getFiller(fillerListId);
      if (!fillerList) {
        const segmentIndex = segments.findIndex(
          s => s.type === 'filler-item' && s.fillerListId === fillerListId
        );
        errors.push(`Segment ${segmentIndex}: filler list '${fillerListId}' not found`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

const segmentedProgramsApiInternal: RouterPluginAsyncCallback = async (fastify) => {
  const logger = LoggerFactory.child({
    caller: import.meta,
    className: 'SegmentedProgramsApi',
  });

  // Validate a segmented program structure
  fastify.post(
    '/segmented-programs/validate',
    {
      schema: {
        tags: ['Segmented Programs'],
        body: CreateSegmentedProgramRequestSchema,
        response: {
          200: SegmentedProgramValidationResponseSchema,
          400: ValidationErrorSchema,
        },
      },
    },
    async (req, res) => {
      try {
        const { segments, duration } = req.body;
        
        // Basic validation
        const validation = validateSegmentDurations(segments, duration);
        if (!validation.valid) {
          return res.status(400).send({
            error: 'Invalid segment durations',
            details: validation.errors,
          });
        }
        
        // Check if referenced content exists
        const contentValidation = await validateReferencedContent(
          segments,
          req.serverCtx.programDB,
          req.serverCtx.fillerDB,
        );
        
        const allErrors = [...validation.errors, ...contentValidation.errors];
        const isValid = validation.valid && contentValidation.valid;
        
        if (isValid) {
          return res.status(200).send({
            valid: true,
            errors: [],
          });
        } else {
          return res.status(400).send({
            error: 'Validation failed',
            details: allErrors,
          });
        }
      } catch (error) {
        logger.error('Error validating segmented program: %O', error);
        return res.status(400).send({
          error: 'Invalid request format',
        });
      }
    },
  );

  // Create a segmented program
  fastify.post(
    '/segmented-programs',
    {
      schema: {
        tags: ['Segmented Programs'],
        body: CreateSegmentedProgramRequestSchema,
        response: {
          201: SegmentedProgramResponseSchema,
          400: ValidationErrorSchema,
          500: z.object({ error: z.string() }),
        },
      },
    },
    async (req, res) => {
      const { segments, duration, externalKey, title } = req.body;
      
      // Validate segment durations
      const validation = validateSegmentDurations(segments, duration);
      if (!validation.valid) {
        return res.status(400).send({
          error: 'Invalid segment durations',
          details: validation.errors,
        });
      }
      
      // Check if referenced content exists
      const contentValidation = await validateReferencedContent(
        segments,
        req.serverCtx.programDB,
        req.serverCtx.fillerDB,
        externalKey,
      );
      
      if (!contentValidation.valid) {
        logger.error('Invalid segment references: %O', contentValidation.errors);
        return res.status(400).send({
          error: 'Invalid segment references',
          details: contentValidation.errors,
        });
      }

      try {
        // Store in database
        const created = await req.serverCtx.segmentedProgramDB.createSegmentedProgram({
          external_key: externalKey,
          title,
          duration,
          segments,
        });
        
        const response = segmentedProgramDaoToResponse(created);
        logger.info('Created segmented program: %s', created.uuid);
        return res.status(201).send(response);
      } catch (error) {
        logger.error('Error creating segmented program: %O', error);
        logger.error('Full error details:', error);
        return res.status(500).send({
          error: 'Failed to create segmented program',
        });
      }
    },
  );

  // Get all segmented programs
  fastify.get(
    '/segmented-programs',
    {
      schema: {
        tags: ['Segmented Programs'],
        response: {
          200: z.array(SegmentedProgramResponseSchema),
          500: z.object({ error: z.string() }),
        },
      },
    },
    async (req, res) => {
      try {
        const programs = await req.serverCtx.segmentedProgramDB.getAllSegmentedPrograms();
        
        const response = programs.map(segmentedProgramDaoToResponse);
        
        return res.send(response);
      } catch (error) {
        logger.error('Error getting segmented programs: %O', error);
        return res.status(500).send({
          error: 'Failed to get segmented programs',
        });
      }
    },
  );

  // Get a segmented program by ID
  fastify.get(
    '/segmented-programs/:id',
    {
      schema: {
        tags: ['Segmented Programs'],
        params: z.object({ id: z.string() }),
        response: {
          200: SegmentedProgramResponseSchema,
          404: z.object({ error: z.string() }),
          500: z.object({ error: z.string() }),
        },
      },
    },
    async (req, res) => {
      const { id } = req.params as { id: string };
      
      try {
        const program = await req.serverCtx.segmentedProgramDB.getSegmentedProgramById(id);
        
        if (!program) {
          return res.status(404).send({
            error: 'Segmented program not found',
          });
        }
        
        const response = segmentedProgramDaoToResponse(program);
        
        return res.send(response);
      } catch (error) {
        logger.error('Error getting segmented program: %O', error);
        return res.status(500).send({
          error: 'Failed to get segmented program',
        });
      }
    },
  );

  // Update a segmented program
  fastify.put(
    '/segmented-programs/:id',
    {
      schema: {
        tags: ['Segmented Programs'],
        params: z.object({ id: z.string() }),
        body: CreateSegmentedProgramRequestSchema,
        response: {
          200: SegmentedProgramResponseSchema,
          400: ValidationErrorSchema,
          404: z.object({ error: z.string() }),
          500: z.object({ error: z.string() }),
        },
      },
    },
    async (req, res) => {
      const { id } = req.params as { id: string };
      const { segments, duration, externalKey, title } = req.body;
      
      // Validate segment durations
      const validation = validateSegmentDurations(segments, duration);
      if (!validation.valid) {
        return res.status(400).send({
          error: 'Invalid segment durations',
          details: validation.errors,
        });
      }
      
      // Check if referenced content exists
      const contentValidation = await validateReferencedContent(
        segments,
        req.serverCtx.programDB,
        req.serverCtx.fillerDB,
        externalKey,
      );
      
      if (!contentValidation.valid) {
        return res.status(400).send({
          error: 'Invalid segment references',
          details: contentValidation.errors,
        });
      }

      try {
        // Check if the program exists
        const existingProgram = await req.serverCtx.segmentedProgramDB.getSegmentedProgramById(id);
        if (!existingProgram) {
          return res.status(404).send({
            error: 'Segmented program not found',
          });
        }
        
        // Update in database
        const updated = await req.serverCtx.segmentedProgramDB.updateSegmentedProgram(id, {
          external_key: externalKey,
          title,
          duration,
          segments,
        });
        
        if (!updated) {
          return res.status(500).send({
            error: 'Failed to update segmented program',
          });
        }
        
        const response = segmentedProgramDaoToResponse(updated);
        logger.info('Updated segmented program: %s', id);
        return res.status(200).send(response);
      } catch (error) {
        logger.error('Error updating segmented program: %O', error);
        return res.status(500).send({
          error: 'Failed to update segmented program',
        });
      }
    },
  );

  // Delete a segmented program
  fastify.delete(
    '/segmented-programs/:id',
    {
      schema: {
        tags: ['Segmented Programs'],
        params: z.object({ id: z.string() }),
        response: {
          204: z.null(),
          404: z.object({ error: z.string() }),
          500: z.object({ error: z.string() }),
        },
      },
    },
    async (req, res) => {
      const { id } = req.params as { id: string };
      
      try {
        const deleted = await req.serverCtx.segmentedProgramDB.deleteSegmentedProgram(id);
        
        if (deleted) {
          logger.info('Deleted segmented program: %s', id);
          return res.status(204).send();
        } else {
          return res.status(404).send({
            error: 'Segmented program not found',
          });
        }
      } catch (error) {
        logger.error('Error deleting segmented program: %O', error);
        return res.status(500).send({
          error: 'Failed to delete segmented program',
        });
      }
    },
  );

  // Calculate segment offsets helper endpoint
  fastify.post(
    '/segmented-programs/calculate-offsets',
    {
      schema: {
        tags: ['Segmented Programs'],
        body: CalculateSegmentOffsetsRequestSchema,
        response: {
          200: CalculateSegmentOffsetsResponseSchema,
          400: ValidationErrorSchema,
        },
      },
    },
    async (req, res) => {
      const { segments, viewerJoinTime } = req.body;
      
      let segmentOffset = 0;
      let activeSegmentIndex = -1;
      let offsetWithinSegment = viewerJoinTime;

      // Find which segment contains the viewer join time
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (offsetWithinSegment < segment.duration) {
          activeSegmentIndex = i;
          break;
        }
        segmentOffset += segment.duration;
        offsetWithinSegment -= segment.duration;
      }

      if (activeSegmentIndex === -1) {
        return res.status(400).send({
          error: 'Viewer join time exceeds total program duration',
        });
      }

      return res.send({
        activeSegmentIndex,
        offsetWithinSegment,
        segmentStartTime: segmentOffset,
      });
    },
  );
};

export const segmentedProgramsApi: RouterPluginAsyncCallback = segmentedProgramsApiInternal;