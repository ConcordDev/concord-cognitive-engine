'use client';

/**
 * Shared my-show + episode list hook for creator desk panels.
 * Episodes created here are the same episodes Listening Hub / library /
 * playback read — Model B single STATE, no separate creator copy.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { PodcastEpisode } from './types';

export function useMyPodcastShow() {
  const [myShowId, setMyShowId] = useState<string | null>(null);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [episodeList, setEpisodeList] = useState<PodcastEpisode[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshEpisodes = useCallback(async (showId: string) => {
    const r = await lensRun<{ episodes: PodcastEpisode[] }>('podcast', 'episode-list', { showId });
    if (r.data.ok && r.data.result) setEpisodeList(r.data.result.episodes ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ensured = await lensRun<{ show: { id: string; subscriberCount?: number } }>('podcast', 'my-show-ensure', {});
      if (cancelled) return;
      const show = ensured.data?.result?.show;
      if (show?.id) {
        setMyShowId(show.id);
        setSubscriberCount(show.subscriberCount ?? 0);
        await refreshEpisodes(show.id);
      }
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshEpisodes]);

  const createEpisode = useCallback(async (episodeData: Partial<PodcastEpisode>) => {
    if (!myShowId) throw new Error('Your show is not ready yet');
    const r = await lensRun<{ episode: PodcastEpisode }>('podcast', 'episode-add', { ...episodeData, showId: myShowId });
    if (!r.data?.ok || !r.data.result?.episode) {
      throw new Error(r.data?.error || 'Could not create episode');
    }
    await refreshEpisodes(myShowId);
    return r.data.result.episode;
  }, [myShowId, refreshEpisodes]);

  const setEpisodeStatus = useCallback(async (episodeId: string, status: PodcastEpisode['status']) => {
    if (!myShowId) return;
    await lensRun('podcast', 'episode-set-status', { episodeId, status });
    await refreshEpisodes(myShowId);
  }, [myShowId, refreshEpisodes]);

  const removeEpisode = useCallback(async (episodeId: string) => {
    if (!myShowId) return;
    await lensRun('podcast', 'episode-delete', { episodeId });
    await refreshEpisodes(myShowId);
  }, [myShowId, refreshEpisodes]);

  const episodes = useMemo(
    () => [...episodeList].sort((a, b) => (b.episodeNumber || 0) - (a.episodeNumber || 0)),
    [episodeList],
  );

  return {
    myShowId,
    subscriberCount,
    episodes,
    isLoading,
    createEpisode,
    setEpisodeStatus,
    removeEpisode,
    refreshEpisodes,
  };
}
