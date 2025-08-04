import { 
  TextField, 
  Typography, 
  Box, 
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormHelperText,
  IconButton,
  Chip,
} from '@mui/material';
import {
  Movie as MovieIcon,
  VideoLibrary as VideoLibraryIcon,
  PlaylistPlay as PlaylistPlayIcon,
  Delete as DeleteIcon,
  DragIndicator as DragIndicatorIcon,
} from '@mui/icons-material';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import type { Segment } from '@tunarr/types';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import { isUndefined, omit, sumBy } from 'lodash-es';
import { useCallback, useEffect, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { addProgramsToCurrentChannel, setProgramAtIndex } from '../../store/channelEditor/actions.ts';
import type { UISegmentedProgram } from '../../types/index.ts';
import { useFillerLists } from '../../hooks/useFillerLists.ts';
import { useTunarrApi } from '../../hooks/useTunarrApi.ts';
import { MediaSelectorDialog } from './MediaSelectorDialog.tsx';

dayjs.extend(duration);

type AddSegmentedProgramModalProps = {
  open: boolean;
  onClose: () => void;
  initialProgram?: UISegmentedProgram & { index: number };
};

type DialogMode = 'main' | 'segment-type' | 'media-slice' | 'media-item' | 'filler-item' | 'media-selector';

type DragItem = {
  index: number;
  type: 'segment';
};

type DraggableSegmentProps = {
  segment: Segment;
  index: number;
  moveSegment: (fromIndex: number, toIndex: number) => void;
  onDelete: () => void;
  getSegmentLabel: (segment: Segment) => string;
  getSegmentIcon: (segment: Segment) => React.ReactNode;
  formatMsToTime: (ms: number) => string;
};

const DraggableSegment = ({ 
  segment, 
  index, 
  moveSegment, 
  onDelete, 
  getSegmentLabel, 
  getSegmentIcon,
  formatMsToTime 
}: DraggableSegmentProps) => {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'segment',
    item: { index, type: 'segment' } as DragItem,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [index]);

  const [, drop] = useDrop(() => ({
    accept: 'segment',
    hover: (item: DragItem) => {
      if (item.index !== index) {
        moveSegment(item.index, index);
        item.index = index;
      }
    },
  }), [index, moveSegment]);

  return (
    <ListItem
      ref={(node) => drag(drop(node))}
      secondaryAction={
        <IconButton 
          edge="end" 
          aria-label="delete"
          onClick={onDelete}
        >
          <DeleteIcon />
        </IconButton>
      }
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        mb: 1,
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
    >
      <ListItemIcon>
        <DragIndicatorIcon />
      </ListItemIcon>
      <ListItemIcon>
        {getSegmentIcon(segment)}
      </ListItemIcon>
      <ListItemText
        primary={getSegmentLabel(segment)}
        secondary={
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
            <Chip 
              label={formatMsToTime(segment.duration)} 
              size="small"
              variant="outlined"
            />
            {segment.type === 'media-slice' && (
              <Typography variant="caption" color="text.secondary">
                {formatMsToTime(segment.start)} - {formatMsToTime(segment.stop)}
              </Typography>
            )}
          </Box>
        }
      />
    </ListItem>
  );
};

const AddSegmentedProgramModal = ({
  open,
  onClose,
  initialProgram,
}: AddSegmentedProgramModalProps) => {
  const [title, setTitle] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [dialogMode, setDialogMode] = useState<DialogMode>('main');
  const [selectedSegmentType, setSelectedSegmentType] = useState<'media-slice' | 'media-item' | 'filler-item' | null>(null);
  
  // Segment form state
  const [segmentExternalKey, setSegmentExternalKey] = useState('');
  const [segmentStart, setSegmentStart] = useState('00:00:00');
  const [segmentStop, setSegmentStop] = useState('00:00:00');
  const [segmentDuration, setSegmentDuration] = useState(0);
  const [selectedFillerId, setSelectedFillerId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [segmentTitles, setSegmentTitles] = useState<Record<string, string>>({});

  // Hooks
  const { data: fillerLists } = useFillerLists();
  const apiClient = useTunarrApi();
  
  // Media selector state
  const [mediaSelectionType, setMediaSelectionType] = useState<'slice' | 'item' | null>(null);
  const [selectedMediaTitle, setSelectedMediaTitle] = useState('');

  // Calculate total duration
  const totalDuration = sumBy(segments, 'duration');
  const formattedDuration = dayjs.duration(totalDuration).format('HH:mm:ss');

  // Helper functions
  const parseTimeToMs = (timeStr: string): number => {
    const parts = timeStr.split(':').map(Number);
    if (parts.length !== 3) return 0;
    const [hours, minutes, seconds] = parts;
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  };

  const formatMsToTime = (ms: number): string => {
    const duration = dayjs.duration(ms);
    return duration.format('HH:mm:ss');
  };

  // Load initial program if editing
  useEffect(() => {
    if (initialProgram) {
      setTitle(initialProgram.title || '');
      setSegments(initialProgram.segments || []);
    } else {
      // Reset for new program
      setTitle('');
      setSegments([]);
    }
    // Reset state when modal opens/closes
    setDialogMode('main');
    setSelectedSegmentType(null);
    resetSegmentForm();
  }, [initialProgram, open]);


  const resetSegmentForm = () => {
    setSegmentExternalKey('');
    setSegmentStart('00:00:00');
    setSegmentStop('00:00:00');
    setSegmentDuration(0);
    setSelectedFillerId('');
    setSelectedMediaTitle('');
  };
  
  const handleMediaSelect = (externalKey: string, duration: number, title: string) => {
    setSegmentExternalKey(externalKey);
    setSelectedMediaTitle(title);
    if (mediaSelectionType === 'item') {
      setSegmentDuration(duration);
    }
    setDialogMode(mediaSelectionType === 'slice' ? 'media-slice' : 'media-item');
    setMediaSelectionType(null);
  };

  const handleSaveSegment = () => {
    let newSegment: Segment | null = null;

    if (selectedSegmentType === 'media-slice') {
      const start = parseTimeToMs(segmentStart);
      const stop = parseTimeToMs(segmentStop);
      const duration = stop - start;
      
      if (segmentExternalKey && duration > 0) {
        newSegment = {
          type: 'media-slice',
          externalKey: segmentExternalKey,
          title: selectedMediaTitle || undefined,
          start,
          stop,
          duration,
        };
        // Store the title for display
        if (selectedMediaTitle) {
          setSegmentTitles(prev => ({ ...prev, [segmentExternalKey]: selectedMediaTitle }));
        }
      }
    } else if (selectedSegmentType === 'media-item') {
      if (segmentExternalKey && segmentDuration > 0) {
        newSegment = {
          type: 'media-item',
          externalKey: segmentExternalKey,
          title: selectedMediaTitle || undefined,
          duration: segmentDuration,
        };
        // Store the title for display
        if (selectedMediaTitle) {
          setSegmentTitles(prev => ({ ...prev, [segmentExternalKey]: selectedMediaTitle }));
        }
      }
    } else if (selectedSegmentType === 'filler-item') {
      if (selectedFillerId && segmentDuration > 0) {
        newSegment = {
          type: 'filler-item',
          fillerListId: selectedFillerId,
          duration: segmentDuration,
        };
      }
    }

    if (newSegment) {
      setSegments(prev => [...prev, newSegment]);
      setDialogMode('main');
      setSelectedSegmentType(null);
      resetSegmentForm();
    }
  };

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      if (!isUndefined(initialProgram)) {
        // Edit mode - update existing program
        if (initialProgram.id) {
          // Update via API if it has an ID
          await apiClient.updateSegmentedProgram(
            {
              title,
              externalKey: initialProgram.externalKey,
              duration: totalDuration,
              segments,
            },
            {
              params: { id: initialProgram.id }
            }
          );
        }
        
        // Update in channel lineup
        setProgramAtIndex(
          {
            ...omit(initialProgram, 'index'),
            title,
            segments,
            duration: totalDuration,
            persisted: true,
          },
          initialProgram.index,
        );
      } else {
        // Create mode - new program
        // Generate a simple external key
        const timestamp = Date.now();
        const externalKey = `segmented|local|${timestamp}`;
        
        // Create via API
        const response = await apiClient.createSegmentedProgram({
          title,
          externalKey,
          duration: totalDuration,
          segments,
        });
        
        // Add to channel lineup
        addProgramsToCurrentChannel([{
          ...response,
          persisted: true,
        }]);
      }
      
      onClose();
    } catch (error) {
      console.error('Failed to save segmented program:', error);
      // TODO: Show error message to user
    } finally {
      setIsSaving(false);
    }
  }, [apiClient, title, segments, totalDuration, initialProgram, onClose]);

  const isValid = title.trim().length > 0 && segments.length > 0;

  const handleDeleteSegment = (index: number) => {
    setSegments(segments.filter((_, i) => i !== index));
  };

  const moveSegment = useCallback((fromIndex: number, toIndex: number) => {
    setSegments((prevSegments) => {
      const updatedSegments = [...prevSegments];
      const [movedSegment] = updatedSegments.splice(fromIndex, 1);
      updatedSegments.splice(toIndex, 0, movedSegment);
      return updatedSegments;
    });
  }, []);

  const getSegmentLabel = (segment: Segment): string => {
    switch (segment.type) {
      case 'media-slice': {
        // First check if segment has title
        if (segment.title) {
          return `Media Slice: ${segment.title}`;
        }
        // Then check local state (for newly added segments)
        const title = segmentTitles[segment.externalKey];
        if (title) {
          return `Media Slice: ${title}`;
        }
        // Parse external key for better display
        const parts = segment.externalKey.split('|');
        const id = parts[parts.length - 1];
        const source = parts[0];
        return `Media Slice: ${source ? `${source} - ` : ''}${id}`;
      }
      case 'media-item': {
        // First check if segment has title
        if (segment.title) {
          return `Media Item: ${segment.title}`;
        }
        // Then check local state (for newly added segments)
        const title = segmentTitles[segment.externalKey];
        if (title) {
          return `Media Item: ${title}`;
        }
        // Parse external key for better display
        const parts = segment.externalKey.split('|');
        const id = parts[parts.length - 1];
        const source = parts[0];
        return `Media Item: ${source ? `${source} - ` : ''}${id}`;
      }
      case 'filler-item':
        const filler = fillerLists?.find(f => f.id === segment.fillerListId);
        return `Filler: ${filler?.name || segment.fillerListId}`;
      default:
        return 'Unknown segment';
    }
  };

  const getSegmentIcon = (segment: Segment) => {
    switch (segment.type) {
      case 'media-slice':
        return <MovieIcon />;
      case 'media-item':
        return <VideoLibraryIcon />;
      case 'filler-item':
        return <PlaylistPlayIcon />;
      default:
        return null;
    }
  };

  // Main dialog
  if (dialogMode === 'main') {
    return (
      <Dialog open={open} maxWidth="md" fullWidth>
        <DialogTitle>
          {!isUndefined(initialProgram) ? 'Edit' : 'Add'} Segmented Program
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              fullWidth
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              error={title.trim().length === 0}
              helperText={title.trim().length === 0 ? 'Title is required' : ''}
            />

            <Box>
              <Typography variant="body2" color="text.secondary">
                Total Duration: {formattedDuration}
              </Typography>
            </Box>

            <Divider />

            <Box>
              <Typography variant="h6" gutterBottom>
                Segments
              </Typography>
              {segments.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  No segments added yet. Click "Add Segment" to begin.
                </Typography>
              ) : (
                <List sx={{ mb: 2 }}>
                  {segments.map((segment, index) => (
                    <DraggableSegment
                      key={index}
                      segment={segment}
                      index={index}
                      moveSegment={moveSegment}
                      onDelete={() => handleDeleteSegment(index)}
                      getSegmentLabel={getSegmentLabel}
                      getSegmentIcon={getSegmentIcon}
                      formatMsToTime={formatMsToTime}
                    />
                  ))}
                </List>
              )}
              <Button
                variant="outlined"
                onClick={() => setDialogMode('segment-type')}
              >
                Add Segment
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={handleSave}
            disabled={!isValid || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // Segment type selector
  if (dialogMode === 'segment-type') {
    return (
      <Dialog 
        open={true} 
        onClose={() => setDialogMode('main')}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Choose Segment Type</DialogTitle>
        <DialogContent>
          <List>
            <ListItem disablePadding>
              <ListItemButton onClick={() => {
                setSelectedSegmentType('media-slice');
                setDialogMode('media-slice');
              }}>
                <ListItemIcon>
                  <MovieIcon />
                </ListItemIcon>
                <ListItemText 
                  primary="Media Slice" 
                  secondary="Use a portion of a media file (e.g., part of an episode)"
                />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton onClick={() => {
                setSelectedSegmentType('media-item');
                setDialogMode('media-item');
              }}>
                <ListItemIcon>
                  <VideoLibraryIcon />
                </ListItemIcon>
                <ListItemText 
                  primary="Media Item" 
                  secondary="Use a complete media file (e.g., bumper, promo)"
                />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton onClick={() => {
                setSelectedSegmentType('filler-item');
                setDialogMode('filler-item');
              }}>
                <ListItemIcon>
                  <PlaylistPlayIcon />
                </ListItemIcon>
                <ListItemText 
                  primary="Filler Item" 
                  secondary="Use content from a filler list (e.g., commercials)"
                />
              </ListItemButton>
            </ListItem>
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setDialogMode('main');
            setSelectedSegmentType(null);
          }}>Cancel</Button>
        </DialogActions>
      </Dialog>
    );
  }

  // Media slice form
  if (dialogMode === 'media-slice') {
    return (
      <Dialog 
        open={true} 
        onClose={() => {
          setDialogMode('main');
          setSelectedSegmentType(null);
          resetSegmentForm();
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Media Slice</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <TextField
                fullWidth
                label="Media Item"
                value={selectedMediaTitle || ''}
                InputProps={{ readOnly: true }}
                helperText="Select a media item to use a portion of"
                placeholder="Click Select to choose media"
              />
              <Button 
                variant="outlined"
                onClick={() => {
                  setMediaSelectionType('slice');
                  setDialogMode('media-selector');
                }}
                sx={{ minWidth: 100 }}
              >
                Select
              </Button>
            </Box>
            <TextField
              fullWidth
              label="Start Time (HH:MM:SS)"
              value={segmentStart}
              onChange={(e) => setSegmentStart(e.target.value)}
              helperText="When to start playing in the media"
            />
            <TextField
              fullWidth
              label="Stop Time (HH:MM:SS)"
              value={segmentStop}
              onChange={(e) => setSegmentStop(e.target.value)}
              helperText="When to stop playing in the media"
            />
            <Typography variant="body2" color="text.secondary">
              Duration: {formatMsToTime(parseTimeToMs(segmentStop) - parseTimeToMs(segmentStart))}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setDialogMode('main');
            setSelectedSegmentType(null);
            resetSegmentForm();
          }}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={handleSaveSegment}
            disabled={!segmentExternalKey || parseTimeToMs(segmentStop) <= parseTimeToMs(segmentStart)}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // Media item form
  if (dialogMode === 'media-item') {
    return (
      <Dialog 
        open={true} 
        onClose={() => {
          setDialogMode('main');
          setSelectedSegmentType(null);
          resetSegmentForm();
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Media Item</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <TextField
                fullWidth
                label="Media Item"
                value={selectedMediaTitle || ''}
                InputProps={{ readOnly: true }}
                helperText="Select a complete media item (e.g., bumper, promo)"
                placeholder="Click Select to choose media"
              />
              <Button 
                variant="outlined"
                onClick={() => {
                  setMediaSelectionType('item');
                  setDialogMode('media-selector');
                }}
                sx={{ minWidth: 100 }}
              >
                Select
              </Button>
            </Box>
            <TextField
              fullWidth
              label="Duration"
              value={segmentDuration > 0 ? formatMsToTime(segmentDuration) : 'Auto-detected from media'}
              InputProps={{ readOnly: true }}
              helperText="Duration is automatically set from the selected media"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setDialogMode('main');
            setSelectedSegmentType(null);
            resetSegmentForm();
          }}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={handleSaveSegment}
            disabled={!segmentExternalKey || segmentDuration <= 0}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // Filler item form
  if (dialogMode === 'filler-item') {
    return (
      <Dialog 
        open={true} 
        onClose={() => {
          setDialogMode('main');
          setSelectedSegmentType(null);
          resetSegmentForm();
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Filler Item</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Filler List</InputLabel>
              <Select
                value={selectedFillerId}
                onChange={(e) => setSelectedFillerId(e.target.value)}
                label="Filler List"
              >
                {fillerLists?.map((filler) => (
                  <MenuItem key={filler.id} value={filler.id}>
                    {filler.name}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>Select a filler list to use for this segment</FormHelperText>
            </FormControl>
            <TextField
              fullWidth
              label="Duration (seconds)"
              type="number"
              value={segmentDuration / 1000}
              onChange={(e) => setSegmentDuration(parseFloat(e.target.value) * 1000 || 0)}
              helperText="How long to play content from the filler list"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setDialogMode('main');
            setSelectedSegmentType(null);
            resetSegmentForm();
          }}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={handleSaveSegment}
            disabled={!selectedFillerId || segmentDuration <= 0}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // Media selector
  if (dialogMode === 'media-selector') {
    return (
      <MediaSelectorDialog
        open={true}
        onClose={() => {
          setDialogMode(mediaSelectionType === 'slice' ? 'media-slice' : 'media-item');
          setMediaSelectionType(null);
        }}
        onSelect={handleMediaSelect}
        selectionMode="single"
        title={`Select Media for ${mediaSelectionType === 'slice' ? 'Media Slice' : 'Media Item'}`}
      />
    );
  }

  return null;
};

export default AddSegmentedProgramModal;