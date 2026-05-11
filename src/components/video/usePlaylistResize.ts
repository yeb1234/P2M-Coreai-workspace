import { useDragResize } from '../../hooks/useDragResize';

export function usePlaylistResize(initialWidth = 300) {
  return useDragResize({
    initialWidth,
    minWidth: 240,
    maxWidth: 520,
    side: 'left',
  });
}
