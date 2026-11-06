'use client';

/**
 * EpisodesPanel — creator desk episode list (search, play, publish, delete).
 * Extracted from former podcast/page.tsx Episodes tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Mic2, Play, Pause, Search, Clock, Headphones, Trash2, Check, X, Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { lensRun } from '@/lib/api/client';
import { useMusicStore } from '@/lib/music/store';
import { getPlayer } from '@/lib/music/player';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useMyPodcastShow } from './useMyPodcastShow';
import { notifyPodcastChanged } from './podcast-events';
import { formatDuration, type PodcastEpisode } from './types';

export function EpisodesPanel() {
  const { episodes, isLoading, setEpisodeStatus, removeEpisode, updateEpisode } = useMyPodcastShow();
  const [searchQuery, setSearchQuery] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PodcastEpisode | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', seasonNumber: 1, episodeNumber: 1, coverArtUrl: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { playTrack, nowPlaying } = useMusicStore();

  // ── Playback ledger bridge ──────────────────────────────────────
  // This panel plays episodes through the shared music player, which
  // knows nothing about the podcast ledger — so a play from the creator
  // desk recorded nothing: no play count, no saved position, no
  // Continue listening entry. The bridge reports the player's real
  // position into the ledger via sync-push (the same write the Hub's
  // streaming player makes), throttled while playing and flushed on
  // pause and on end, so Listen / Analytics / Sync read the truth.
  const episodeIdsRef = useRef<Set<string>>(new Set());
  episodeIdsRef.current = new Set(episodes.map((e) => e.id));
  useEffect(() => {
    const player = getPlayer();
    let lastEp = '';
    let lastPos = -10;
    const currentPodcastTrackId = (): string | null => {
      const t = useMusicStore.getState().nowPlaying.track;
      if (!t || !episodeIdsRef.current.has(t.id)) return null;
      if ((t as { genre?: string }).genre !== 'podcast') return null;
      return t.id;
    };
    const push = (episodeId: string, pos: number) => {
      let device = 'web';
      try { device = window.localStorage.getItem('podcast:deviceLabel') || 'web'; } catch { /* storage unavailable */ }
      void lensRun('podcast', 'sync-push', {
        episodeId,
        positionSec: Math.round(Math.max(0, pos)),
        device,
        reportedAt: new Date().toISOString(),
      });
    };
    const offTime = player.on('timeupdate', (d) => {
      const id = currentPodcastTrackId();
      if (!id) return;
      const raw = d?.currentTime;
      const ct = typeof raw === 'number' ? raw : useMusicStore.getState().nowPlaying.currentTime;
      if (id !== lastEp || ct - lastPos >= 10) { lastEp = id; lastPos = ct; push(id, ct); }
    });
    const offPause = player.on('pause', () => {
      const id = currentPodcastTrackId();
      if (id) { lastPos = player.getCurrentTime(); push(id, lastPos); }
    });
    const offEnded = player.on('ended', () => {
      const id = currentPodcastTrackId();
      if (id) { lastPos = player.getDuration(); push(id, lastPos); }
    });
    return () => { offTime(); offPause(); offEnded(); };
  }, []);

  const handleDelete = useCallback(async (episode: PodcastEpisode) => {
    // Deleting the episode that is loaded in the shared player stops the
    // player first — a deleted episode must not keep playing or sit on
    // the player bar as if it still existed.
    const t = useMusicStore.getState().nowPlaying.track;
    if (t && t.id === episode.id) getPlayer().stop();
    await removeEpisode(episode.id);
    setConfirmDeleteId(null);
    if (editing?.id === episode.id) setEditing(null);
    notifyPodcastChanged();
  }, [removeEpisode, editing]);

  const startEdit = useCallback((episode: PodcastEpisode) => {
    setEditing(episode);
    setEditForm({
      title: episode.title,
      description: episode.description || '',
      seasonNumber: episode.seasonNumber || 1,
      episodeNumber: episode.episodeNumber || 1,
      coverArtUrl: episode.coverArtUrl || '',
    });
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editing || savingEdit) return;
    if (!editForm.title.trim()) { showToast('error', 'Episode title is required'); return; }
    setSavingEdit(true);
    try {
      await updateEpisode(editing.id, {
        title: editForm.title.trim(),
        description: editForm.description.trim() || null,
        seasonNumber: editForm.seasonNumber,
        episodeNumber: editForm.episodeNumber,
        coverArtUrl: editForm.coverArtUrl.trim() || null,
      });
      showToast('success', 'Episode saved');
      setEditing(null);
      notifyPodcastChanged();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Could not save episode');
    } finally {
      setSavingEdit(false);
    }
  }, [editing, editForm, savingEdit, updateEpisode]);

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

                {confirmDeleteId === episode.id ? (
                  <span className="flex items-center gap-2 text-xs flex-shrink-0">
                    <span className="text-gray-300">Delete this episode?</span>
                    <button
                      onClick={() => void handleDelete(episode)}
                      className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1 rounded-lg text-gray-400 hover:text-white"
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => startEdit(episode)}
                      className="p-1.5 rounded-lg text-gray-600 hover:text-violet-300 hover:bg-violet-500/10 opacity-0 group-hover:opacity-100 transition-all"
                      title="Edit episode"
                      aria-label="Edit episode"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => { void setEpisodeStatus(episode.id, episode.status === 'published' ? 'draft' : 'published').then(() => notifyPodcastChanged()); }}
                      className="p-1.5 rounded-lg text-gray-600 hover:text-green-400 hover:bg-green-500/10 opacity-0 group-hover:opacity-100 transition-all"
                      title={episode.status === 'published' ? 'Unpublish' : 'Publish'}
                    >
                      <Check className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => setConfirmDeleteId(episode.id)}
                      className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="mt-4 p-4 bg-white/5 rounded-xl border border-white/10">
          <h3 className="text-sm font-semibold text-zinc-100 mb-3">Edit episode — {editing.title}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block md:col-span-2">
              <span className="text-xs text-gray-400">Title</span>
              <input
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-purple-400/50"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs text-gray-400">Description</span>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-purple-400/50"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Season</span>
              <input
                type="number" min={1}
                value={editForm.seasonNumber}
                onChange={(e) => setEditForm({ ...editForm, seasonNumber: Math.max(1, Number(e.target.value) || 1) })}
                className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-purple-400/50"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Episode</span>
              <input
                type="number" min={1}
                value={editForm.episodeNumber}
                onChange={(e) => setEditForm({ ...editForm, episodeNumber: Math.max(1, Number(e.target.value) || 1) })}
                className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-purple-400/50"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs text-gray-400">Cover Art URL</span>
              <input
                value={editForm.coverArtUrl}
                onChange={(e) => setEditForm({ ...editForm, coverArtUrl: e.target.value })}
                placeholder="https://…"
                className="mt-1 w-full px-3 py-2 bg-zinc-950 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-purple-400/50"
              />
            </label>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button" onClick={() => void saveEdit()} disabled={savingEdit}
              className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium"
            >
              {savingEdit ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button" onClick={() => setEditing(null)}
              className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default EpisodesPanel;
