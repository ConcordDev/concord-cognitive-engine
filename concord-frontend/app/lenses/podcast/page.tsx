'use client';

import { useState, useCallback, useMemo } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic2, Play, Pause, Plus, Search, Rss, BarChart3,
  Clock, Upload, Users, X, Headphones, ListMusic,
  Image as ImageIcon, Hash, TrendingUp, Edit3, Trash2,
  ExternalLink, Copy, Check,
} from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useMusicStore } from '@/lib/music/store';
import { getPlayer } from '@/lib/music/player';
import { MediaUpload } from '@/components/media/MediaUpload';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ViewTab = 'episodes' | 'create' | 'analytics';

interface PodcastEpisode {
  title: string;
  description: string;
  episodeNumber: number;
  seasonNumber: number;
  coverArtUrl: string | null;
  mediaId: string | null;
  audioUrl: string | null;
  duration: number;
  publishedAt: string;
  status: 'draft' | 'published' | 'scheduled';
  playCount: number;
  tags: string[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function PodcastLensPage() {
  useLensNav('podcast');
  const { isLive, lastUpdated, insights: realtimeInsights } = useRealtimeLens('podcast');
  const {
    isLoading, items: episodeItems,
    create: createEpisode, update: updateEpisode, remove: removeEpisode,
  } = useLensData<Record<string, unknown>>('podcast', 'episode');
  const {
    contextDTUs: _contextDTUs, hyperDTUs: _hyperDTUs, megaDTUs: _megaDTUs, regularDTUs: _regularDTUs,
    publishToMarketplace: _publishToMarketplace, isLoading: _dtusLoading,
  } = useLensDTUs({ lens: 'podcast' });

  const { items: subscriberItems } = useLensData<Record<string, unknown>>('podcast', 'subscriber');

  // ---- State ----
  const [activeTab, setActiveTab] = useState<ViewTab>('episodes');
  const [searchQuery, setSearchQuery] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [rssCopied, setRssCopied] = useState(false);

  // ---- Create form state ----
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formEpisodeNum, setFormEpisodeNum] = useState(1);
  const [formSeasonNum, setFormSeasonNum] = useState(1);
  const [formCoverArt, setFormCoverArt] = useState<string | null>(null);
  const [formMediaId, setFormMediaId] = useState<string | null>(null);
  const [formDuration, setFormDuration] = useState(0);

  const { playTrack, nowPlaying } = useMusicStore();

  // ---- Transform items ----
  const episodes = useMemo<(PodcastEpisode & { id: string })[]>(() =>
    episodeItems.map(item => ({
      ...(item.data as unknown as PodcastEpisode),
      id: item.id,
      title: item.title || (item.data as Record<string, unknown>)?.title as string || 'Untitled',
    })).sort((a, b) => (b.episodeNumber || 0) - (a.episodeNumber || 0)),
    [episodeItems]
  );

  // ---- Search ----
  const filteredEpisodes = useMemo(() => {
    if (!searchQuery.trim()) return episodes;
    const q = searchQuery.toLowerCase();
    return episodes.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.tags?.some(t => t.toLowerCase().includes(q))
    );
  }, [searchQuery, episodes]);

  // ---- Analytics ----
  const analytics = useMemo(() => {
    const totalPlays = episodes.reduce((sum, e) => sum + (e.playCount || 0), 0);
    const totalEpisodes = episodes.length;
    const publishedEpisodes = episodes.filter(e => e.status === 'published').length;
    const totalDuration = episodes.reduce((sum, e) => sum + (e.duration || 0), 0);
    const subscriberCount = subscriberItems.length;
    return { totalPlays, totalEpisodes, publishedEpisodes, totalDuration, subscriberCount };
  }, [episodes, subscriberItems]);

  // ---- Playback ----
  const handlePlay = useCallback((episode: PodcastEpisode & { id: string }) => {
    if (playingId === episode.id) {
      const player = getPlayer();
      if (nowPlaying.playbackState === 'playing') {
        player.pause();
      } else {
        player.play().catch(() => {});
      }
      return;
    }
    setPlayingId(episode.id);
    const track = {
      id: episode.id,
      title: episode.title,
      artistName: `S${episode.seasonNumber || 1}E${episode.episodeNumber || 1}`,
      genre: 'podcast',
      duration: episode.duration || 0,
      coverArtUrl: episode.coverArtUrl || null,
      audioUrl: episode.audioUrl || (episode.mediaId ? `/api/media/${episode.mediaId}/stream` : null),
      tags: episode.tags || [],
      waveformPeaks: [],
    };
    playTrack(track as unknown as Parameters<typeof playTrack>[0]);
  }, [playingId, nowPlaying.playbackState, playTrack]);

  // ---- Create episode ----
  const handleCreateEpisode = useCallback(async () => {
    if (!formTitle.trim()) return;
    const episodeData: PodcastEpisode = {
      title: formTitle,
      description: formDescription,
      episodeNumber: formEpisodeNum,
      seasonNumber: formSeasonNum,
      coverArtUrl: formCoverArt,
      mediaId: formMediaId,
      audioUrl: formMediaId ? `/api/media/${formMediaId}/stream` : null,
      duration: formDuration,
      publishedAt: new Date().toISOString(),
      status: 'draft',
      playCount: 0,
      tags: [],
    };
    try {
      await createEpisode({ title: formTitle, data: episodeData as unknown as Record<string, unknown> });
      setFormTitle('');
      setFormDescription('');
      setFormEpisodeNum(formEpisodeNum + 1);
      setFormCoverArt(null);
      setFormMediaId(null);
      setActiveTab('episodes');
    } catch (err) {
      console.error('Failed to create episode:', err instanceof Error ? err.message : err);
    }
  }, [formTitle, formDescription, formEpisodeNum, formSeasonNum, formCoverArt, formMediaId, createEpisode]);

  // ---- RSS link ----
  const handleCopyRss = useCallback(async () => {
    const feedUrl = `${window.location.origin}/api/podcast/default/feed.xml`;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setRssCopied(true);
      setTimeout(() => setRssCopied(false), 2000);
    } catch {
      // clipboard API may not be available
    }
  }, []);

  // ---- Upload handler ----
  const handleAudioUpload = useCallback((_data: unknown, _file: File) => {
    const uploadData = _data as Record<string, unknown>;
    const mediaDTU = uploadData?.mediaDTU as Record<string, unknown> | undefined;
    const mediaId = (mediaDTU?.id || uploadData?.mediaId || uploadData?.id) as string | undefined;
    if (mediaId) {
      setFormMediaId(mediaId);
    }
    // Extract duration from media response or file
    const dur = (mediaDTU?.duration || uploadData?.duration) as number | undefined;
    if (dur) setFormDuration(dur);
  }, []);

  // ---- Tabs ----
  const tabs: Array<{ id: ViewTab; label: string; icon: React.ReactNode }> = [
    { id: 'episodes', label: 'Episodes', icon: <ListMusic className="w-4 h-4" /> },
    { id: 'create', label: 'New Episode', icon: <Plus className="w-4 h-4" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" /> },
  ];

  return (
    <div data-lens-theme="podcast" className="min-h-screen bg-lattice-void text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-lattice-surface/50 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-400/20 flex items-center justify-center">
                <Mic2 className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Podcast Studio</h1>
                <p className="text-xs text-gray-400">Create, publish, and distribute your podcast</p>
              </div>
              {isLive && <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />}
            </div>
            <button
              onClick={handleCopyRss}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors text-sm"
            >
              {rssCopied ? <Check className="w-4 h-4" /> : <Rss className="w-4 h-4" />}
              {rssCopied ? 'Copied!' : 'Copy RSS Feed'}
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-white/10 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <AnimatePresence mode="wait">
          {/* ---- Episodes Tab ---- */}
          {activeTab === 'episodes' && (
            <motion.div key="episodes" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {/* Search */}
              <div className="relative mb-6">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search episodes..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-400/50"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Episode list */}
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredEpisodes.length === 0 ? (
                <div className="text-center py-20 text-gray-500">
                  <Mic2 className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No episodes yet. Create your first episode!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredEpisodes.map(episode => {
                    const isCurrentlyPlaying = playingId === episode.id && nowPlaying.playbackState === 'playing';
                    return (
                      <div
                        key={episode.id}
                        className="flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-colors group"
                      >
                        {/* Cover art */}
                        <div className="relative w-16 h-16 rounded-lg bg-white/10 overflow-hidden flex-shrink-0">
                          {episode.coverArtUrl ? (
                            <Image src={episode.coverArtUrl} alt={episode.title} fill className="object-cover" unoptimized />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-600">
                              <Headphones className="w-6 h-6" />
                            </div>
                          )}
                          {/* Play overlay */}
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

                        {/* Episode info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-purple-400 font-medium">
                              S{episode.seasonNumber || 1}E{episode.episodeNumber || 1}
                            </span>
                            <span className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                              episode.status === 'published' ? 'bg-green-500/20 text-green-400' :
                              episode.status === 'scheduled' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-gray-500/20 text-gray-400'
                            )}>
                              {episode.status || 'draft'}
                            </span>
                          </div>
                          <p className="text-sm font-medium truncate mt-0.5">{episode.title}</p>
                          <p className="text-xs text-gray-500 truncate mt-0.5">{episode.description}</p>
                        </div>

                        {/* Meta */}
                        <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(episode.duration || 0)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Headphones className="w-3 h-3" />
                            {episode.playCount || 0}
                          </span>
                        </div>

                        {/* Delete */}
                        <button
                          onClick={() => removeEpisode(episode.id)}
                          className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* ---- Create Tab ---- */}
          {activeTab === 'create' && (
            <motion.div key="create" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="max-w-2xl mx-auto space-y-6">
                <h2 className="text-lg font-semibold">Create New Episode</h2>

                {/* Title */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Title</label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={e => setFormTitle(e.target.value)}
                    placeholder="Episode title"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-400/50"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Description</label>
                  <textarea
                    value={formDescription}
                    onChange={e => setFormDescription(e.target.value)}
                    placeholder="Episode description..."
                    rows={4}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-400/50 resize-none"
                  />
                </div>

                {/* Episode / Season numbers */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Episode Number</label>
                    <input
                      type="number"
                      value={formEpisodeNum}
                      onChange={e => setFormEpisodeNum(parseInt(e.target.value) || 1)}
                      min={1}
                      className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-purple-400/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Season Number</label>
                    <input
                      type="number"
                      value={formSeasonNum}
                      onChange={e => setFormSeasonNum(parseInt(e.target.value) || 1)}
                      min={1}
                      className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-purple-400/50"
                    />
                  </div>
                </div>

                {/* Audio upload */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Episode Audio</label>
                  {formMediaId ? (
                    <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-xl">
                      <Check className="w-4 h-4 text-green-400" />
                      <span className="text-sm text-green-400">Audio uploaded (ID: {formMediaId.slice(0, 8)}...)</span>
                      <button onClick={() => setFormMediaId(null)} className="ml-auto text-gray-500 hover:text-white">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <MediaUpload
                      defaultMediaType="audio"
                      onUploadComplete={(media) => handleAudioUpload(media, new File([], 'audio'))}
                    />
                  )}
                </div>

                {/* Cover art URL */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Cover Art URL (optional)</label>
                  <input
                    type="text"
                    value={formCoverArt || ''}
                    onChange={e => setFormCoverArt(e.target.value || null)}
                    placeholder="https://example.com/cover.jpg"
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-400/50"
                  />
                </div>

                {/* Submit */}
                <button
                  onClick={handleCreateEpisode}
                  disabled={!formTitle.trim()}
                  className="w-full py-3 rounded-xl bg-purple-400/20 text-purple-400 font-medium hover:bg-purple-400/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Create Episode
                </button>
              </div>
            </motion.div>
          )}

          {/* ---- Analytics Tab ---- */}
          {activeTab === 'analytics' && (
            <motion.div key="analytics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                  { label: 'Total Plays', value: analytics.totalPlays, icon: <Headphones className="w-5 h-5" />, color: 'text-neon-cyan' },
                  { label: 'Subscribers', value: analytics.subscriberCount, icon: <Users className="w-5 h-5" />, color: 'text-purple-400' },
                  { label: 'Episodes', value: `${analytics.publishedEpisodes}/${analytics.totalEpisodes}`, icon: <Mic2 className="w-5 h-5" />, color: 'text-neon-green' },
                  { label: 'Total Duration', value: formatDuration(analytics.totalDuration), icon: <Clock className="w-5 h-5" />, color: 'text-orange-400' },
                ].map(stat => (
                  <div key={stat.label} className="p-4 bg-white/5 rounded-xl border border-white/5">
                    <div className={cn('mb-2', stat.color)}>{stat.icon}</div>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* Top episodes by plays */}
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Top Episodes</h3>
              <div className="space-y-2">
                {[...episodes]
                  .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
                  .slice(0, 10)
                  .map((ep, i) => (
                    <div key={ep.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
                      <span className="text-xs text-gray-600 w-5 text-right font-mono">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{ep.title}</p>
                        <p className="text-xs text-gray-500">S{ep.seasonNumber || 1}E{ep.episodeNumber || 1}</p>
                      </div>
                      <span className="text-xs text-gray-400">{ep.playCount || 0} plays</span>
                    </div>
                  ))}
              </div>

              {realtimeInsights.length > 0 && (
                <RealtimeDataPanel data={null} insights={realtimeInsights} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
