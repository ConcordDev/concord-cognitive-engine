'use client';

/**
 * EpisodesPanel — creator desk episode list (search, play, publish, delete).
 * Extracted from former podcast/page.tsx Episodes tab.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Mic2, Play, Pause, Search, Clock, Headphones, Trash2, Check, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { useMusicStore } from '@/lib/music/store';
import { getPlayer } from '@/lib/music/player';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useMyPodcastShow } from './useMyPodcastShow';
import { formatDuration, type PodcastEpisode } from './types';

export function EpisodesPanel() {
  const { episodes, isLoading, setEpisodeStatus, removeEpisode } = useMyPodcastShow();
  const [searchQuery, setSearchQuery] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { playTrack, nowPlaying } = useMusicStore();

  const filteredEpisodes = useMemo(() => {
    if (!searchQuery.trim()) return episodes;
    const q = searchQuery.toLowerCase();
    return episodes.filter((e) =>
      e.title.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [searchQuery, episodes]);

  const handlePlay = useCallback((episode: PodcastEpisode) => {
    if (playingId === episode.id) {
      const player = getPlayer();
      if (nowPlaying.playbackState === 'playing') {
        player.pause();
      } else {
        player.play().catch((e) => { console.error('[Podcast] Playback failed:', e); showToast('error', 'Playback failed'); });
      }
      return;
    }
    setPlayingId(episode.id);
    const track = {
      id: episode.id,
      title: episode.title,
      artistName: `S${episode.seasonNumber || 1}E${episode.episodeNumber || 1}`,
      genre: 'podcast',
      duration: episode.durationSec || 0,
      coverArtUrl: episode.coverArtUrl || null,
      audioUrl: episode.audioUrl || (episode.mediaId ? `/api/media/${episode.mediaId}/stream` : null),
      tags: episode.tags || [],
      waveformPeaks: [],
    };
    playTrack(track as unknown as Parameters<typeof playTrack>[0]);
  }, [playingId, nowPlaying.playbackState, playTrack]);

  useLensCommand(
    [{ id: 'focus-search', keys: '/', description: 'Focus search', category: 'navigation', action: () => searchInputRef.current?.focus() }],
    { lensId: 'podcast' },
  );

  return (
    <div>
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search episodes…  /"
          className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-400 focus:outline-none focus:border-purple-400/50"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredEpisodes.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Mic2 className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No episodes yet. Create your first episode!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredEpisodes.map((episode) => {
            const isCurrentlyPlaying = playingId === episode.id && nowPlaying.playbackState === 'playing';
            return (
              <div
                key={episode.id}
                className="flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-colors group"
              >
                <div className="relative w-16 h-16 rounded-lg bg-white/10 overflow-hidden flex-shrink-0">
                  {episode.coverArtUrl ? (
                    <Image src={episode.coverArtUrl} alt={episode.title} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                      <Headphones className="w-6 h-6" />
                    </div>
                  )}
                  <button
                    onClick={() => handlePlay(episode)}
                    className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {isCurrentlyPlaying ? (
                      <Pause className="w-6 h-6 text-white" />
                    ) : (
                      <Play className="w-6 h-6 text-white ml-0.5" />
                    )}
                  </button>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-purple-400 font-medium">
                      S{episode.seasonNumber || 1}E{episode.episodeNumber || 1}
                    </span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                      episode.status === 'published' ? 'bg-green-500/20 text-green-400' :
                      episode.status === 'scheduled' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-gray-500/20 text-gray-400',
                    )}>
                      {episode.status || 'draft'}
                    </span>
                  </div>
                  <p className="text-sm font-medium truncate mt-0.5">{episode.title}</p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{episode.description}</p>
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-400 flex-shrink-0">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(episode.durationSec || 0)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Headphones className="w-3 h-3" />
                    {episode.playCount || 0}
                  </span>
                </div>

                <button
                  onClick={() => setEpisodeStatus(episode.id, episode.status === 'published' ? 'draft' : 'published')}
                  className="p-1.5 rounded-lg text-gray-600 hover:text-green-400 hover:bg-green-500/10 opacity-0 group-hover:opacity-100 transition-all"
                  title={episode.status === 'published' ? 'Unpublish' : 'Publish'}
                >
                  <Check className="w-4 h-4" />
                </button>

                <button
                  onClick={() => removeEpisode(episode.id)}
                  className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                  aria-label="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default EpisodesPanel;
