import { useDragResize } from '../../hooks/useDragResize';

export function usePlaylistResize(initialWidth = 360) {
  return useDragResize({
    initialWidth,
    minWidth: 280,
    maxWidth: 560,
    side: 'left',
  });
}
