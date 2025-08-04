import type { TabProps } from '@mui/material';
import { Tab, Tabs, Typography } from '@mui/material';
import { seq } from '@tunarr/shared/util';
import type { ContentProgram, ContentProgramParent, SegmentedProgram } from '@tunarr/types';
import {
  ContentProgramTypeSchema,
  type ContentProgramType,
} from '@tunarr/types/schemas';
import { groupBy, isNil, keys, mapValues, omitBy } from 'lodash-es';
import { useMemo, useState } from 'react';
import { useChannelAndProgramming } from '../../hooks/useChannelLineup.ts';
import { TabPanel } from '../TabPanel.tsx';
import { ChannelProgramGrid } from './ChannelProgramGrid.tsx';

type Props = {
  channelId: string;
};

type ProgramTabProps = TabProps & {
  selected: boolean;
  programCount: number;
  programType: ContentProgramType | 'segmented';
};

const ProgramTypeToLabel: Record<ContentProgramType | 'segmented', string> = {
  episode: 'Shows',
  movie: 'Movies',
  music_video: 'Music Videos',
  other_video: 'Other Videos',
  track: 'Artists',
  segmented: 'Segmented',
};

const ProgramTypeToGridType: Record<
  ContentProgramType,
  ContentProgramType | ContentProgramParent['type']
> = {
  episode: 'show',
  movie: 'movie',
  music_video: 'music_video',
  other_video: 'other_video',
  track: 'artist',
};

const ProgramTypeTab = ({
  programCount,
  programType,
  selected,
  ...rest
}: ProgramTabProps) => {
  return (
    <Tab
      {...rest}
      label={
        <>
          <Typography
            component="span"
            sx={{ verticalAlign: 'middle', fontSize: '0.875rem' }}
          >
            {ProgramTypeToLabel[programType]}
            <Typography
              component="span"
              sx={{
                display: 'inline-block',
                ml: 1,
                height: 21,
                minWidth: 21,
                backgroundColor: (theme) =>
                  selected
                    ? theme.palette.primary.main
                    : theme.palette.mode === 'dark'
                      ? theme.palette.grey[800]
                      : theme.palette.grey[400],
                color: (theme) =>
                  selected
                    ? theme.palette.getContrastText(theme.palette.primary.main)
                    : 'inherit',
                borderRadius: 10,
                px: 0.8,
                fontSize: 'inherit',
              }}
            >
              {programCount}
            </Typography>
          </Typography>
        </>
      }
      disabled={programCount === 0}
    />
  );
};

// Component to display segmented programs
const SegmentedProgramsList = ({ programs }: { programs: SegmentedProgram[] }) => {
  return (
    <div style={{ padding: 16 }}>
      <Typography variant="h6" gutterBottom>
        Segmented Programs ({programs.length})
      </Typography>
      {programs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No segmented programs in this channel.
        </Typography>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {programs.map((program) => (
            <div
              key={program.externalKey}
              style={{
                border: '1px solid #e0e0e0',
                borderRadius: 4,
                padding: 12,
                backgroundColor: '#008080',
              }}
            >
              <Typography variant="subtitle1" fontWeight="bold">
                {program.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {program.segments.length} segment{program.segments.length !== 1 ? 's' : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Duration: {Math.floor(program.duration / 60000)} minutes
              </Typography>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const ChannelPrograms = ({ channelId }: Props) => {
  const {
    data: {
      lineup: { lineup, programs },
    },
  } = useChannelAndProgramming(channelId);

  const { contentPrograms, segmentedPrograms } = useMemo(() => {
    const content: ContentProgram[] = [];
    const segmented: SegmentedProgram[] = [];
    
    lineup.forEach((p) => {
      if (p.type === 'content' && p.id && programs[p.id]) {
        const program = programs[p.id];
        if (program.type === 'content') {
          content.push(program);
        }
      } else if (p.type === 'custom' && p.id && programs[p.id]) {
        const program = programs[p.id];
        if (program && program.type === 'content') {
          content.push(program);
        }
      } else if (p.type === 'segmented') {
        segmented.push(p);
      }
    });
    
    return { contentPrograms: content, segmentedPrograms: segmented };
  }, [lineup, programs]);

  const programsByType = useMemo(
    () => groupBy(contentPrograms, (p) => p.subtype) as Record<ContentProgramType, ContentProgram[]>,
    [contentPrograms]
  );

  // TODO: Do this in the database
  const [epsByShow] = useMemo(() => {
    const epsByProgram = mapValues(
      omitBy(
        groupBy(programsByType['episode'], (ep) => ep.grandparent?.id),
        isNil,
      ),
      (p) => p.length,
    );
    const epsBySeason = mapValues(
      omitBy(
        groupBy(programsByType['episode'], (ep) => ep.parent?.id),
        isNil,
      ),
      (p) => p.length,
    );
    return [epsByProgram, epsBySeason];
  }, [programsByType]);

  const [tracksByArtist] = useMemo(() => {
    const epsByProgram = mapValues(
      omitBy(
        groupBy(programsByType['track'], (ep) => ep.grandparent?.id),
        isNil,
      ),
      (p) => p.length,
    );
    const epsBySeason = mapValues(
      omitBy(
        groupBy(programsByType['track'], (ep) => ep.parent?.id),
        isNil,
      ),
      (p) => p.length,
    );
    return [epsByProgram, epsBySeason];
  }, [programsByType]);

  const [tab, setTab] = useState(() => {
    // Check segmented programs first
    if (segmentedPrograms.length > 0) {
      return 5; // Segmented tab index
    }
    
    // Then check content programs
    for (const [key, programs] of Object.entries(programsByType)) {
      if (programs.length > 0) {
        switch (key as ContentProgramType) {
          case 'movie':
            return 0;
          case 'episode':
            return 1;
          case 'track':
            return 2;
          case 'music_video':
            return 3;
          case 'other_video':
            return 4;
        }
      }
    }

    return 0;
  });

  return (
    <>
      <Tabs value={tab} onChange={(_, v) => setTab(v as number)}>
        {Object.values(ContentProgramTypeSchema.enum).map((v, idx) => (
          <ProgramTypeTab
            key={v}
            value={idx}
            selected={tab === idx}
            programCount={
              v === 'episode'
                ? keys(epsByShow).length
                : v === 'track'
                  ? keys(tracksByArtist).length
                  : (programsByType[v]?.length ?? 0)
            }
            programType={v}
          />
        ))}
        <ProgramTypeTab
          key="segmented"
          value={5}
          selected={tab === 5}
          programCount={segmentedPrograms.length}
          programType="segmented"
        />
      </Tabs>
      {Object.values(ContentProgramTypeSchema.enum).map((programType, idx) => (
        <TabPanel key={programType} value={tab} index={idx}>
          <ChannelProgramGrid
            channelId={channelId}
            programType={ProgramTypeToGridType[programType]}
          />
        </TabPanel>
      ))}
      <TabPanel value={tab} index={5}>
        <SegmentedProgramsList programs={segmentedPrograms} />
      </TabPanel>
    </>
  );
};