import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPlaylist, fetchVideo, type PlaylistItem, type VideoItem } from '../../lib/videoApi';
import { useVideoStore } from '../../stores/videoStore';
import { playlistItemToVideoItem } from './videoPlayerAdapters';

export type PlaylistScope = 'leaf' | 'descendants';

interface UseVideoPlaylistOptions {
  currentVideo: VideoItem | null;
  selectVideo: (video: VideoItem) => void;
  currentCategoryId: number | null;
}

export function useVideoPlaylist({ currentVideo, selectVideo, currentCategoryId }: UseVideoPlaylistOptions) {
  const selectedFolderIds = useVideoStore((s) => s.selectedFolderIds);
  const playAfterLoadRef = useRef(false);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [playlistIdx, setPlaylistIdx] = useState(-1);
  const [playlistScope, setPlaylistScope] = useState<PlaylistScope>('descendants');

  useEffect(() => {
    if (!currentVideo) {
      queueMicrotask(() => {
        setPlaylist([]);
        setPlaylistIdx(-1);
      });
      return;
    }
    let cancelled = false;

    if (playlistScope === 'descendants') {
      if (selectedFolderIds.length > 0) {
        // Checkbox selection active: use selected folder IDs
        // Fetch playlists for each selected folder and merge
        Promise.all(selectedFolderIds.map((catId) => fetchPlaylist(currentVideo.id, 'descendants', catId)))
          .then((results) => {
            if (cancelled) return;
            // Merge and deduplicate by video ID, preserving order from first result
            const seen = new Set<number>();
            const merged: PlaylistItem[] = [];
            for (const r of results) {
              for (const item of r.videos) {
                if (!seen.has(item.id)) {
                  seen.add(item.id);
                  merged.push(item);
                }
              }
            }
            // Find current video index in merged list
            const idx = merged.findIndex((item) => item.id === currentVideo.id);
            setPlaylist(merged);
            setPlaylistIdx(idx >= 0 ? idx : 0);
          })
          .catch(() => {});
      } else {
        // No checkbox: use browsing context (currentCategoryId)
        fetchPlaylist(currentVideo.id, 'descendants', currentCategoryId)
          .then((playlistResult) => {
            if (cancelled) return;
            setPlaylist(playlistResult.videos);
            setPlaylistIdx(playlistResult.current_index);
          })
          .catch(() => {});
      }
    } else {
      // Leaf mode: video's own folder only
      fetchPlaylist(currentVideo.id, 'leaf')
        .then((playlistResult) => {
          if (cancelled) return;
          setPlaylist(playlistResult.videos);
          setPlaylistIdx(playlistResult.current_index);
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [currentVideo, playlistScope, currentCategoryId, selectedFolderIds]);

  const togglePlaylistScope = useCallback(() => {
    setPlaylistScope((prev) => (prev === 'leaf' ? 'descendants' : 'leaf'));
  }, []);

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
    playlistScope,
    playAfterLoadRef,
    selectPlaylistItem,
    playNextFromPlaylist,
    togglePlaylistScope,
  };
}
