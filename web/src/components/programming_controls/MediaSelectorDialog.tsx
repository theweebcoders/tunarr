import {
  Dialog,
  DialogContent,
  DialogTitle,
  Box,
  IconButton,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { ProgrammingSelector } from '../channel_config/ProgrammingSelector.tsx';
import { ProgrammingSelectionContext } from '../../context/ProgrammingSelectionContext.ts';
import { useCallback, useEffect, useState } from 'react';
import { clearSelectedMedia } from '../../store/programmingSelector/actions.ts';
import SelectedProgrammingList from '../channel_config/SelectedProgrammingList.tsx';
import { createExternalId } from '@tunarr/shared';
import { match } from 'ts-pattern';
import { type AddedMedia } from '../../types/index.ts';

type MediaSelectorDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (externalKey: string, duration: number, title: string) => void;
  selectionMode: 'single' | 'multiple';
  title?: string;
};

export const MediaSelectorDialog = ({
  open,
  onClose,
  onSelect,
  selectionMode = 'single',
  title = 'Select Media',
}: MediaSelectorDialogProps) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      clearSelectedMedia();
    }
  }, [open]);

  const handleAddSelectedMedia = useCallback(
    (media: AddedMedia[]) => {
      if (selectionMode === 'single' && media.length > 0) {
        const firstMedia = media[0];
        
        // Extract the relevant information based on media type
        const result = match(firstMedia)
          .with({ type: 'plex' }, ({ media }) => {
            const externalKey = createExternalId('plex', media.serverName, media.ratingKey);
            let title = media.title;
            if (media.type === 'episode' && media.grandparentTitle) {
              const seasonEpisode = media.parentIndex && media.index
                ? ` S${String(media.parentIndex).padStart(2, '0')}E${String(media.index).padStart(2, '0')}`
                : '';
              title = media.grandparentTitle + seasonEpisode + (seasonEpisode ? ' - ' : '') + media.title;
            }
            return { externalKey, duration: media.duration ?? 0, title };
          })
          .with({ type: 'jellyfin' }, ({ media }) => {
            const externalKey = createExternalId('jellyfin', media.serverName, media.Id);
            let title = media.Name;
            if (media.Type === 'Episode' && media.SeriesName) {
              const seasonEpisode = media.ParentIndexNumber && media.IndexNumber
                ? ` S${String(media.ParentIndexNumber).padStart(2, '0')}E${String(media.IndexNumber).padStart(2, '0')}`
                : '';
              title = media.SeriesName + seasonEpisode + (seasonEpisode ? ' - ' : '') + media.Name;
            }
            return { externalKey, duration: (media.RunTimeTicks ?? 0) / 10_000, title };
          })
          .with({ type: 'emby' }, ({ media }) => {
            const externalKey = createExternalId('emby', media.serverName, media.Id);
            let title = media.Name;
            if (media.Type === 'Episode' && media.SeriesName) {
              const seasonEpisode = media.ParentIndexNumber && media.IndexNumber
                ? ` S${String(media.ParentIndexNumber).padStart(2, '0')}E${String(media.IndexNumber).padStart(2, '0')}`
                : '';
              title = media.SeriesName + seasonEpisode + (seasonEpisode ? ' - ' : '') + media.Name;
            }
            return { externalKey, duration: (media.RunTimeTicks ?? 0) / 10_000, title };
          })
          .with({ type: 'custom-show' }, ({ program }) => {
            // For custom shows, we don't have an external key in the same sense
            const title = program.program?.title ?? 'Custom Program';
            return { 
              externalKey: `custom-show|${program.customShowId}|${program.id}`,
              duration: program.duration ?? 0,
              title
            };
          })
          .exhaustive();
        
        onSelect(result.externalKey, result.duration, result.title);
        onClose();
      }
    },
    [onSelect, onClose, selectionMode]
  );

  const handleClose = useCallback(() => {
    clearSelectedMedia();
    onClose();
  }, [onClose]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: { height: '90vh' }
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          {title}
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', height: 'calc(100% - 64px)' }}>
        <ProgrammingSelectionContext.Provider
          value={{
            onAddSelectedMedia: handleAddSelectedMedia,
            onAddMediaSuccess: useCallback(() => {
              // No-op, we handle success in onAddSelectedMedia
            }, []),
            entityType: 'channel',
          }}
        >
          <Box sx={{ height: '100%', overflow: 'auto' }}>
            <ProgrammingSelector
              toggleOrSetSelectedProgramsDrawer={setDrawerOpen}
            />
          </Box>
          <SelectedProgrammingList
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
          />
        </ProgrammingSelectionContext.Provider>
      </DialogContent>
    </Dialog>
  );
};