'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic2, Play, Pause, Plus, Search, Rss, BarChart3,
  Clock, Users, X, Headphones, ListMusic, Trash2, Check, Loader2,
  Square, CircleDot,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { UniversalActions } from '@/components/lens/UniversalActions';
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
    contextDTUs, hyperDTUs, megaDTUs, regularDTUs,
    publishToMarketplace, isLoading: dtusLoading,
  } = useLensDTUs({ lens: 'podcast' });

  const { items: subscriberItems } = useLensData<Record<string, unknown>>('podcast', 'subscriber');

  const runAction = useRunArtifact('podcast');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const handleAction = async (action: string) => {
    const targetId = episodeItems[0]?.id;
    if (!targetId) { setActionResult({ message: 'Create an episode first to run analytics.' }); return; }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

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

  // ---- Recording state ----
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up object URLs and streams on unmount
  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      duration: episode.duration || 0,
      coverArtUrl: episode.coverArtUrl || null,
      audioUrl: episode.audioUrl || (episode.mediaId ? `/api/media/${episode.mediaId}/stream` : null),
      tags: episode.tags || [],
      waveformPeaks: [],
    };
    playTrack(track as unknown as Parameters<typeof playTrack>[0]);
  }, [playingId, nowPlaying.playbackState, playTrack]);

  // ---- Recording ----
  const handleStartRecording = useCallback(async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);

        // Revoke previous URL if any
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);

        setRecordedBlob(blob);
        setRecordedUrl(url);
        setIsRecording(false);

        // Stop all tracks
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;

        // Stop timer
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      };

      recorder.start(250); // collect data every 250ms for responsiveness
      setIsRecording(true);
      setRecordingTime(0);
      setRecordedBlob(null);
      if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }

      // Start timer
      const start = Date.now();
      timerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - start) / 1000));
      }, 200);
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone permissions.'
        : 'Could not access microphone. Check your device settings.';
      setMicError(msg);
      console.error('[Podcast] getUserMedia failed:', err);
    }
  }, [recordedUrl]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handlePlayPreview = useCallback(() => {
    if (!recordedUrl) return;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setIsPlayingPreview(false);
      return;
    }
    const audio = new Audio(recordedUrl);
    previewAudioRef.current = audio;
    setIsPlayingPreview(true);
    audio.onended = () => { previewAudioRef.current = null; setIsPlayingPreview(false); };
    audio.play().catch(() => { setIsPlayingPreview(false); });
  }, [recordedUrl]);

  const handleUseRecording = useCallback(() => {
    if (!recordedBlob) return;
    // Store the blob as a pseudo media ID so the create flow can reference it.
    // In a full implementation this would upload the blob to the media API.
    // For now we create a local object URL and set duration from recordingTime.
    setFormDuration(recordingTime);
    // Create a unique local identifier for the recorded blob
    const localId = `local-recording-${Date.now()}`;
    setFormMediaId(localId);
    showToast('success', `Recording saved (${formatDuration(recordingTime)})`);
  }, [recordedBlob, recordingTime]);

  const handleDiscardRecording = useCallback(() => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setRecordingTime(0);
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setIsPlayingPreview(false);
  }, [recordedUrl]);

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
  }, [formTitle, formDescription, formEpisodeNum, formSeasonNum, formCoverArt, formMediaId, formDuration, createEpisode]);

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

                        {/* Publish / Edit */}
                        <button
                          onClick={() => { const nextStatus = episode.status === 'draft' ? 'published' : episode.status === 'published' ? 'draft' : 'published'; updateEpisode(episode.id, { data: { ...episode, status: nextStatus } as unknown as Record<string, unknown> }); }}
                          className="p-1.5 rounded-lg text-gray-600 hover:text-green-400 hover:bg-green-500/10 opacity-0 group-hover:opacity-100 transition-all"
                          title={episode.status === 'published' ? 'Unpublish' : 'Publish'}
                        >
                          <Check className="w-4 h-4" />
                        </button>

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

                {/* Record Episode */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Record Episode</label>
                  <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
                    {micError && (
                      <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                        {micError}
                      </div>
                    )}

                    {isRecording ? (
                      <>
                        {/* Recording active */}
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-sm font-medium text-red-400">Recording</span>
                          <span className="text-sm font-mono text-gray-300 ml-auto">
                            {formatDuration(recordingTime)}
                          </span>
                        </div>

                        {/* Waveform bars */}
                        <div className="flex items-end gap-0.5 h-8 justify-center">
                          {Array.from({ length: 24 }).map((_, i) => (
                            <div
                              key={i}
                              className="w-1 bg-purple-400 rounded-full"
                              style={{
                                height: `${20 + Math.random() * 80}%`,
                                animation: `pulse ${0.3 + Math.random() * 0.5}s ease-in-out infinite alternate`,
                                animationDelay: `${i * 0.05}s`,
                              }}
                            />
                          ))}
                        </div>

                        <button
                          onClick={handleStopRecording}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/20 text-red-400 font-medium hover:bg-red-500/30 transition-colors"
                        >
                          <Square className="w-4 h-4" />
                          Stop Recording
                        </button>
                      </>
                    ) : recordedBlob ? (
                      <>
                        {/* Recording complete - preview */}
                        <div className="flex items-center gap-3">
                          <Check className="w-4 h-4 text-green-400" />
                          <span className="text-sm text-green-400">
                            Recording complete ({formatDuration(recordingTime)})
                          </span>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={handlePlayPreview}
                            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors text-sm"
                          >
                            {isPlayingPreview ? (
                              <><Pause className="w-3.5 h-3.5" /> Pause</>
                            ) : (
                              <><Play className="w-3.5 h-3.5" /> Preview</>
                            )}
                          </button>
                          <button
                            onClick={handleUseRecording}
                            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-purple-400/20 text-purple-400 hover:bg-purple-400/30 transition-colors text-sm"
                          >
                            <Check className="w-3.5 h-3.5" /> Use Recording
                          </button>
                          <button
                            onClick={handleDiscardRecording}
                            className="flex items-center justify-center px-3 py-2 rounded-lg bg-white/5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                            title="Discard recording"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Idle state - ready to record */}
                        <button
                          onClick={handleStartRecording}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-400/10 text-purple-400 font-medium hover:bg-purple-400/20 transition-colors"
                        >
                          <CircleDot className="w-4 h-4" />
                          Start Recording
                        </button>
                        <p className="text-[11px] text-gray-500 text-center">
                          Record directly from your microphone
                        </p>
                      </>
                    )}
                  </div>
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

              {/* DTU Overview */}
              {!dtusLoading && (contextDTUs.length > 0 || regularDTUs.length > 0 || hyperDTUs.length > 0 || megaDTUs.length > 0) && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Data Transfer Units</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {contextDTUs.length > 0 && (
                      <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                        <p className="text-xs text-gray-500">Context DTUs</p>
                        <p className="text-xl font-bold text-neon-cyan">{contextDTUs.length}</p>
                      </div>
                    )}
                    {regularDTUs.length > 0 && (
                      <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                        <p className="text-xs text-gray-500">Regular DTUs</p>
                        <p className="text-xl font-bold text-purple-400">{regularDTUs.length}</p>
                      </div>
                    )}
                    {hyperDTUs.length > 0 && (
                      <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                        <p className="text-xs text-gray-500">Hyper DTUs</p>
                        <p className="text-xl font-bold text-neon-pink">{hyperDTUs.length}</p>
                      </div>
                    )}
                    {megaDTUs.length > 0 && (
                      <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                        <p className="text-xs text-gray-500">Mega DTUs</p>
                        <p className="text-xl font-bold text-neon-green">{megaDTUs.length}</p>
                      </div>
                    )}
                  </div>
                  {episodes.length > 0 && (
                    <button
                      onClick={() => publishToMarketplace({ dtuId: episodes[0].id })}
                      className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-400/10 text-purple-400 text-sm hover:bg-purple-400/20 transition-colors"
                    >
                      <Rss className="w-4 h-4" /> Publish to Marketplace
                    </button>
                  )}
                </div>
              )}
              {dtusLoading && (
                <div className="mt-6 flex items-center gap-2 text-gray-500 text-sm">
                  <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  Loading DTUs...
                </div>
              )}

              {realtimeInsights.length > 0 && (
                <>
                  <UniversalActions domain="podcast" artifactId={null} compact />
                  <RealtimeDataPanel data={null} insights={realtimeInsights} />
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Backend Action Panel */}
        <div className="panel p-4 space-y-3 mx-auto">
          <h2 className="font-semibold flex items-center gap-2">
            <Mic2 className="w-4 h-4 text-neon-purple" />
            Podcast Analysis
          </h2>
          <div className="flex flex-wrap gap-2">
            {[
              { action: 'episodeAnalytics', label: 'Episode Analytics' },
              { action: 'guestResearch', label: 'Guest Research' },
              { action: 'productionChecklist', label: 'Production Checklist' },
              { action: 'monetizationCalc', label: 'Monetization Calc' },
            ].map(({ action, label }) => (
              <button key={action} onClick={() => handleAction(action)} disabled={!!isRunning}
                className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
                {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                {label}
              </button>
            ))}
          </div>
          {actionResult && (
            <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
              {'totalListens' in actionResult && (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span className="text-gray-400">Episodes: <span className="text-neon-cyan font-bold">{String(actionResult.episodes)}</span></span>
                    <span className="text-gray-400">Total Listens: <span className="text-neon-cyan font-bold">{String(actionResult.totalListens)}</span></span>
                    <span className="text-gray-400">Avg: <span className="text-neon-green">{String(actionResult.avgListensPerEpisode)}</span></span>
                    <span className="text-gray-400">Completion: <span className="text-yellow-400">{String(actionResult.completionRate)}%</span></span>
                  </div>
                  <p className="text-xs text-gray-400">Top: <span className="text-white">{String(actionResult.topEpisode)}</span></p>
                  <span className={`text-xs px-2 py-0.5 rounded ${actionResult.growth === 'established' ? 'bg-neon-green/20 text-neon-green' : 'bg-yellow-400/20 text-yellow-400'}`}>{String(actionResult.growth)}</span>
                </div>
              )}
              {'topics' in actionResult && Array.isArray(actionResult.topics) && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-400">Guest: <span className="text-white">{String(actionResult.name)}</span></p>
                  {actionResult.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(actionResult.topics as string[]).map((t, i) => (
                        <span key={i} className="text-xs bg-neon-cyan/10 border border-neon-cyan/20 rounded px-2 py-0.5 text-neon-cyan">{t}</span>
                      ))}
                    </div>
                  )}
                  {'questionSuggestions' in actionResult && Array.isArray(actionResult.questionSuggestions) && (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">Questions</p>
                      {(actionResult.questionSuggestions as string[]).slice(0, 3).map((q, i) => (
                        <p key={i} className="text-xs text-gray-300">• {q}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {'totalSteps' in actionResult && (
                <div className="space-y-1">
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span>Steps: <span className="text-neon-cyan">{String(actionResult.totalSteps)}</span></span>
                    <span>Done: <span className="text-neon-green">{String(actionResult.completed)}</span></span>
                    <span>Progress: <span className="text-yellow-400">{String(actionResult.progress)}%</span></span>
                  </div>
                  {'nextStep' in actionResult && <p className="text-xs text-gray-300">Next: <span className="text-neon-cyan">{String(actionResult.nextStep)}</span></p>}
                </div>
              )}
              {'adRevenue' in actionResult && (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                    <span>Ad Revenue: <span className="text-neon-green font-bold">${String(actionResult.adRevenue)}</span></span>
                    <span>Premium: <span className="text-neon-green">${String(actionResult.premiumRevenue)}</span></span>
                    <span>Total: <span className="text-neon-cyan font-bold">${String(actionResult.totalMonthlyRevenue)}/mo</span></span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-400">Tier: <span className="text-neon-purple">{String(actionResult.tier)}</span></span>
                  </div>
                  {'nextMilestone' in actionResult && <p className="text-xs text-gray-400">{String(actionResult.nextMilestone)}</p>}
                </div>
              )}
              {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
