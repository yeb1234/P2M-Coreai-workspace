import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPlaylist, fetchVideo, type PlaylistItem, type VideoItem } from '../../lib/videoApi';
import { playlistItemToVideoItem } from './videoPlayerAdapters';

interface UseVideoPlaylistOptions {
  currentVideo: VideoItem | null;
  selectVideo: (video: VideoItem) => void;
}

export function useVideoPlaylist({ currentVideo, selectVideo }: UseVideoPlaylistOptions) {
  const playAfterLoadRef = useRef(false);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [playlistIdx, setPlaylistIdx] = useState(-1);

  useEffect(() => {
    if (!currentVideo) {
      queueMicrotask(() => {
        setPlaylist([]);
        setPlaylistIdx(-1);
      });
      return;
    }
    let cancelled = false;
    fetchPlaylist(currentVideo.id)
      .then((playlistResult) => {
        if (cancelled) return;
        setPlaylist(playlistResult.videos);
        setPlaylistIdx(playlistResult.current_index);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentVideo]);

  const selectPlaylistItem = useCallback(async (item: PlaylistItem, playAfterLoad = false) => {
    playAfterLoadRef.current = playAfterLoad;
    setPlaylistIdx((idx) => {
      const nextIdx = playlist.findIndex((playlistItem) => playlistItem.id === item.id);
      return nextIdx >= 0 ? nextIdx : idx;
    });
    try {
      selectVideo(await fetchVideo(item.id));
    } catch {
      selectVideo(playlistItemToVideoItem(item));
    }
  }, [playlist, selectVideo]);

  const playNextFromPlaylist = useCallback(() => {
    if (!currentVideo || playlist.length === 0) return false;
    const currentIdx = playlist.findIndex((item) => item.id === currentVideo.id);
    const nextIdx = (currentIdx >= 0 ? currentIdx : playlistIdx) + 1;
    if (nextIdx >= playlist.length) return false;
    void selectPlaylistItem(playlist[nextIdx], true);
    return true;
  }, [currentVideo, playlist, playlistIdx, selectPlaylistItem]);

  return {
    playlist,
    playlistIdx,
    playAfterLoadRef,
    selectPlaylistItem,
    playNextFromPlaylist,
  };
}
