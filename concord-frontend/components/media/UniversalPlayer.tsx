'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Radio,
  Eye,
  Heart,
  MessageCircle,
  Coins,
  Download,
  Share2,
  FileText,
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface MediaResolution {
  width: number;
  height: number;
}

interface StreamInfo {
  isLive: boolean;
  viewerCount: number;
  startedAt: string | null;
  endedAt: string | null;
}

interface MediaEngagement {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

interface MediaDTU {
  id: string;
  title: string;
  description?: string;
  mediaType: 'audio' | 'video' | 'image' | 'document' | 'stream';
  mimeType?: string;
  duration?: number | null;
  resolution?: MediaResolution | null;
  thumbnail?: string | null;
  hlsManifest?: string | null;
  transcodeStatus?: string;
  transcodeVariants?: Array<{ quality: string; ready: boolean }>;
  engagement?: MediaEngagement;
  waveform?: number[] | null;
  stream?: StreamInfo | null;
  author?: string;
  authorName?: string;
  tags?: string[];
  liked?: boolean;
}

interface UniversalPlayerProps {
  mediaDTU: MediaDTU;
  autoplay?: boolean;
  onEnd?: () => void;
  onTimeUpdate?: (time: number) => void;
  className?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatViewCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1000000).toFixed(1)}M`;
}

// ── Audio Player ─────────────────────────────────────────────────────────────

function AudioPlayer({
  mediaDTU,
  autoplay,
  onEnd,
  onTimeUpdate,
}: Omit<UniversalPlayerProps, 'className'>) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(autoplay ?? false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(mediaDTU.duration || 0);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  const duration = audioDuration || mediaDTU.duration || 0;
  const waveform = mediaDTU.waveform || Array.from({ length: 64 }, () => Math.random() * 80 + 20);
  const audioSrc = useMemo(
    () => `/api/media/${encodeURIComponent(mediaDTU.id)}/stream`,
    [mediaDTU.id],
  );

  const togglePlay = useCallback(() => {
    // Optimistic flip — onPlay/onPause from the real element will
    // correct the state if playback ultimately fails. Without the
    // optimistic step the icon never updates in jsdom (where
    // HTMLMediaElement.play is "Not implemented") and the real-DOM
    // tap-to-play feels laggy by ~1 frame.
    const el = audioRef.current;
    setPlaying((prev) => !prev);
    if (!el) return;
    try {
      if (el.paused) {
        const result = el.play();
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => undefined);
        }
      } else {
        el.pause();
      }
    } catch {
      // jsdom or autoplay-blocked browsers throw synchronously;
      // the optimistic state already covers the visual.
    }
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, volume / 100));
    el.muted = muted;
  }, [volume, muted]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = pct * duration;
    if (audioRef.current && Number.isFinite(target)) {
      audioRef.current.currentTime = target;
    }
    setCurrentTime(target);
  }, [duration]);

  return (
    <div className="rounded-xl bg-lattice-deep border border-lattice-border overflow-hidden">
      <audio
        ref={audioRef}
        src={audioSrc}
        autoPlay={autoplay ?? false}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrentTime(t);
          onTimeUpdate?.(t);
        }}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) {
            setAudioDuration(e.currentTarget.duration);
          }
        }}
        onEnded={() => { setPlaying(false); onEnd?.(); }}
      />
      {/* Album art / thumbnail area */}
      <div className="relative h-48 bg-gradient-to-br from-neon-purple/20 to-neon-cyan/20 flex items-center justify-center">
        <div className="absolute inset-0 backdrop-blur-sm" />
        <motion.div
          animate={{ rotate: playing ? 360 : 0 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="relative z-10 w-24 h-24 rounded-full bg-gradient-to-br from-neon-cyan to-neon-purple flex items-center justify-center shadow-lg shadow-neon-cyan/20"
        >
          <div className="w-8 h-8 rounded-full bg-lattice-deep" />
        </motion.div>

        {/* Live indicator for streams */}
        {mediaDTU.stream?.isLive && (
          <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/90 text-white text-xs font-bold">
            <Radio className="w-3 h-3 animate-pulse" />
            LIVE
          </div>
        )}
      </div>

      {/* Waveform */}
      <div
        ref={progressRef}
        onClick={handleSeek}
        className="px-4 py-3 cursor-pointer"
      >
        <div className="flex items-end gap-[2px] h-12">
          {waveform.map((h, i) => {
            const filled = (i / waveform.length) * 100 < progress;
            return (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-sm transition-colors duration-100',
                  filled ? 'bg-neon-cyan' : 'bg-gray-700/60'
                )}
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400 tabular-nums">{formatTime(currentTime)}</span>
          <span className="text-xs text-gray-400 tabular-nums">{formatDuration(duration)}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button className="text-gray-400 hover:text-white transition-colors">
              <SkipBack className="w-5 h-5" />
            </button>
            <button
              onClick={togglePlay}
              className="w-12 h-12 rounded-full bg-neon-cyan/20 text-neon-cyan flex items-center justify-center hover:bg-neon-cyan/30 transition-colors"
            >
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <button className="text-gray-400 hover:text-white transition-colors">
              <SkipForward className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setMuted(prev => !prev)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              onChange={e => { setVolume(parseInt(e.target.value)); setMuted(false); }}
              className="w-20 h-1 appearance-none bg-gray-700 rounded-full accent-neon-cyan"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Video Player ─────────────────────────────────────────────────────────────

function VideoPlayer({
  mediaDTU,
  autoplay,
  onEnd,
  onTimeUpdate,
}: Omit<UniversalPlayerProps, 'className'>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(autoplay ?? false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(mediaDTU.duration || 0);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [selectedQuality, setSelectedQuality] = useState('auto');
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const duration = videoDuration || mediaDTU.duration || 0;
  const availableQualities = useMemo(() => {
    const quals = mediaDTU.transcodeVariants
      ?.filter(v => v.ready)
      .map(v => v.quality) || [];
    return ['auto', ...quals];
  }, [mediaDTU.transcodeVariants]);

  // Build the streaming URL. Quality propagates to backend via ?quality=.
  const videoSrc = useMemo(() => {
    const q = selectedQuality === 'auto' ? '' : `?quality=${encodeURIComponent(selectedQuality)}`;
    return `/api/media/${encodeURIComponent(mediaDTU.id)}/stream${q}`;
  }, [mediaDTU.id, selectedQuality]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    setPlaying((prev) => !prev);
    if (!el) return;
    try {
      if (el.paused) {
        const result = el.play();
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => setBuffering(false));
        }
      } else {
        el.pause();
      }
    } catch {
      setBuffering(false);
    }
  }, []);

  // Sync volume + muted state to the element.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, volume / 100));
    el.muted = muted;
  }, [volume, muted]);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  }, [playing]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = pct * duration;
    if (videoRef.current && Number.isFinite(target)) {
      videoRef.current.currentTime = target;
    }
    setCurrentTime(target);
  }, [duration]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!fullscreen) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setFullscreen(prev => !prev);
  }, [fullscreen]);

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl bg-black overflow-hidden group"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => playing && setShowControls(false)}
    >
      {/* Video area */}
      <div
        className="relative aspect-video bg-black flex items-center justify-center cursor-pointer"
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          src={videoSrc}
          poster={mediaDTU.thumbnail || undefined}
          autoPlay={autoplay ?? false}
          playsInline
          preload="metadata"
          className="w-full h-full object-contain"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setCurrentTime(t);
            onTimeUpdate?.(t);
          }}
          onLoadedMetadata={(e) => {
            if (Number.isFinite(e.currentTarget.duration)) {
              setVideoDuration(e.currentTarget.duration);
            }
          }}
          onEnded={() => { setPlaying(false); onEnd?.(); }}
        />

        {mediaDTU.resolution && (
          <div className="absolute bottom-2 right-2 text-xs text-gray-500 bg-black/40 px-1.5 rounded pointer-events-none">
            {mediaDTU.resolution.width}x{mediaDTU.resolution.height}
          </div>
        )}

        {/* Play/pause overlay */}
        <AnimatePresence>
          {!playing && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="w-16 h-16 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center"
            >
              <Play className="w-8 h-8 text-white ml-1" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Buffering spinner */}
        {buffering && playing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-neon-cyan animate-spin" />
          </div>
        )}

        {/* Live indicator */}
        {mediaDTU.stream?.isLive && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/90 text-white text-xs font-bold">
            <Radio className="w-3 h-3 animate-pulse" />
            LIVE
            <span className="ml-1 text-white/80">
              <Eye className="w-3 h-3 inline mr-0.5" />
              {formatViewCount(mediaDTU.stream.viewerCount)}
            </span>
          </div>
        )}
      </div>

      {/* Controls overlay */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-12"
          >
            {/* Progress bar */}
            <div
              className="h-1 bg-gray-600 rounded-full mb-3 cursor-pointer group/progress"
              onClick={handleSeek}
            >
              <div
                className="h-full bg-neon-cyan rounded-full relative group-hover/progress:h-1.5 transition-all"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-neon-cyan rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity" />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlay}
                  className="text-white hover:text-neon-cyan transition-colors"
                >
                  {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </button>

                <button className="text-gray-300 hover:text-white transition-colors">
                  <SkipForward className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setMuted(prev => !prev)}
                    className="text-gray-300 hover:text-white transition-colors"
                  >
                    {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={muted ? 0 : volume}
                    onChange={e => { setVolume(parseInt(e.target.value)); setMuted(false); }}
                    className="w-16 h-1 appearance-none bg-gray-600 rounded-full accent-neon-cyan"
                  />
                </div>

                <span className="text-xs text-gray-300 tabular-nums">
                  {formatTime(currentTime)} / {formatDuration(duration)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Quality selector */}
                <div className="relative">
                  <button
                    onClick={() => setShowQualityMenu(prev => !prev)}
                    className="text-gray-300 hover:text-white transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <AnimatePresence>
                    {showQualityMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-8 right-0 bg-lattice-surface border border-lattice-border rounded-lg p-2 min-w-[120px] z-50"
                      >
                        <div className="text-xs text-gray-400 px-2 mb-1">Quality</div>
                        {availableQualities.map(q => (
                          <button
                            key={q}
                            onClick={() => { setSelectedQuality(q); setShowQualityMenu(false); }}
                            className={cn(
                              'block w-full text-left px-2 py-1 text-sm rounded hover:bg-lattice-deep transition-colors',
                              selectedQuality === q ? 'text-neon-cyan' : 'text-gray-300'
                            )}
                          >
                            {q === 'auto' ? 'Auto' : q}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  onClick={toggleFullscreen}
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  {fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Image Gallery ────────────────────────────────────────────────────────────

function ImageViewer({
  mediaDTU,
}: Pick<UniversalPlayerProps, 'mediaDTU'>) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleZoomIn = useCallback(() => setZoom(prev => Math.min(5, prev + 0.5)), []);
  const handleZoomOut = useCallback(() => setZoom(prev => Math.max(0.5, prev - 0.5)), []);
  const handleRotate = useCallback(() => setRotation(prev => (prev + 90) % 360), []);
  const handleReset = useCallback(() => {
    setZoom(1);
    setRotation(0);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
  }, [zoom, panOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  return (
    <div className="rounded-xl bg-lattice-deep border border-lattice-border overflow-hidden">
      {/* Image display */}
      <div
        className="relative aspect-video bg-gray-900 flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          className="flex items-center justify-center"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            transition: isDragging ? 'none' : 'transform 0.2s ease',
          }}
        >
          {/* Real image — falls back to icon placeholder if the artifact
              hasn't landed yet (transient 404 during background fetch). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/media/${encodeURIComponent(mediaDTU.id)}/stream`}
            alt={mediaDTU.title || 'image'}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
            onError={(e) => {
              const el = e.currentTarget;
              el.style.display = 'none';
              const fallback = el.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = 'flex';
            }}
          />
          <div className="hidden w-full h-full items-center justify-center">
            <div className="bg-gradient-to-br from-neon-cyan/20 to-neon-purple/20 rounded-lg p-8">
              <ImageIcon className="w-16 h-16 text-neon-cyan/60" />
            </div>
          </div>
        </div>

        {/* Resolution badge */}
        {mediaDTU.resolution && (
          <div className="absolute bottom-3 right-3 text-xs text-gray-400 bg-black/50 px-2 py-1 rounded">
            {mediaDTU.resolution.width} x {mediaDTU.resolution.height}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2 p-3 border-t border-lattice-border">
        <button
          onClick={handleZoomOut}
          className="p-2 text-gray-400 hover:text-white hover:bg-lattice-surface rounded-lg transition-colors"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-400 tabular-nums w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button
          onClick={handleZoomIn}
          className="p-2 text-gray-400 hover:text-white hover:bg-lattice-surface rounded-lg transition-colors"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-lattice-border mx-1" />
        <button
          onClick={handleRotate}
          className="p-2 text-gray-400 hover:text-white hover:bg-lattice-surface rounded-lg transition-colors"
          title="Rotate"
        >
          <RotateCw className="w-4 h-4" />
        </button>
        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-lattice-surface rounded-lg transition-colors"
          title="Reset view"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// ── Document Viewer ──────────────────────────────────────────────────────────

function DocumentViewer({
  mediaDTU,
}: Pick<UniversalPlayerProps, 'mediaDTU'>) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = 1; // Simulated

  return (
    <div className="rounded-xl bg-lattice-deep border border-lattice-border overflow-hidden">
      {/* Document display */}
      <div className="relative min-h-[400px] bg-white/5 flex items-center justify-center">
        <div className="text-center p-8">
          <FileText className="w-16 h-16 text-neon-cyan/40 mx-auto mb-4" />
          <h3 className="text-white font-medium mb-2">{mediaDTU.title}</h3>
          <p className="text-sm text-gray-400">{mediaDTU.mimeType || 'Document'}</p>
          {mediaDTU.description && (
            <p className="text-sm text-gray-500 mt-3 max-w-md mx-auto">{mediaDTU.description}</p>
          )}
        </div>
      </div>

      {/* Page navigation */}
      <div className="flex items-center justify-between p-3 border-t border-lattice-border">
        <button
          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
          disabled={currentPage <= 1}
          className="p-2 text-gray-400 hover:text-white disabled:opacity-30 transition-colors rounded-lg"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-400 tabular-nums">
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
          disabled={currentPage >= totalPages}
          className="p-2 text-gray-400 hover:text-white disabled:opacity-30 transition-colors rounded-lg"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-lattice-border mx-1" />
        <button className="p-2 text-gray-400 hover:text-white hover:bg-lattice-surface rounded-lg transition-colors">
          <Download className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Live Stream Viewer ───────────────────────────────────────────────────────

function StreamViewer({
  mediaDTU,
}: Pick<UniversalPlayerProps, 'mediaDTU'>) {
  const [showTipping, setShowTipping] = useState(false);
  const isLive = mediaDTU.stream?.isLive ?? false;

  return (
    <div className="rounded-xl bg-black overflow-hidden">
      {/* Stream display */}
      <div className="relative aspect-video bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center">
        {isLive ? (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/5 to-neon-cyan/5" />
            <div className="absolute top-3 left-3 flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/90 text-white text-xs font-bold">
                <Radio className="w-3 h-3 animate-pulse" />
                LIVE
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 text-white text-xs">
                <Eye className="w-3 h-3" />
                {formatViewCount(mediaDTU.stream?.viewerCount || 0)}
              </div>
            </div>

            <div className="flex items-center gap-1 text-gray-500">
              <Wifi className="w-8 h-8" />
              <span className="text-sm">Stream Active</span>
            </div>
          </>
        ) : (
          <div className="text-center p-8">
            <WifiOff className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Stream Offline</p>
            {mediaDTU.stream?.endedAt && (
              <p className="text-gray-500 text-xs mt-1">
                Ended {new Date(mediaDTU.stream.endedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Stream controls */}
      {isLive && (
        <div className="flex items-center justify-between p-3 border-t border-lattice-border bg-lattice-deep">
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neon-cyan/10 text-neon-cyan text-sm hover:bg-neon-cyan/20 transition-colors">
              <Heart className="w-4 h-4" />
              Like
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lattice-surface text-gray-300 text-sm hover:text-white transition-colors">
              <MessageCircle className="w-4 h-4" />
              Chat
            </button>
          </div>

          <button
            onClick={() => setShowTipping(prev => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neon-pink/10 text-neon-pink text-sm hover:bg-neon-pink/20 transition-colors"
          >
            <Coins className="w-4 h-4" />
            Tip
          </button>

          <AnimatePresence>
            {showTipping && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-16 right-4 bg-lattice-surface border border-lattice-border rounded-xl p-4 z-50 shadow-xl"
              >
                <div className="text-sm text-white mb-3">Send a tip</div>
                <div className="flex gap-2">
                  {[5, 10, 25, 50, 100].map(amount => (
                    <button
                      key={amount}
                      className="px-3 py-1.5 rounded-lg bg-lattice-deep text-neon-cyan text-sm hover:bg-neon-cyan/20 transition-colors"
                    >
                      {amount}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ── Universal Player (Main Export) ───────────────────────────────────────────

export function UniversalPlayer({
  mediaDTU,
  autoplay = false,
  onEnd,
  onTimeUpdate,
  className,
}: UniversalPlayerProps) {
  const [liked, setLiked] = useState(mediaDTU.liked ?? false);

  const renderPlayer = useCallback(() => {
    switch (mediaDTU.mediaType) {
      case 'audio':
        return <AudioPlayer mediaDTU={mediaDTU} autoplay={autoplay} onEnd={onEnd} onTimeUpdate={onTimeUpdate} />;
      case 'video':
        return <VideoPlayer mediaDTU={mediaDTU} autoplay={autoplay} onEnd={onEnd} onTimeUpdate={onTimeUpdate} />;
      case 'image':
        return <ImageViewer mediaDTU={mediaDTU} />;
      case 'document':
        return <DocumentViewer mediaDTU={mediaDTU} />;
      case 'stream':
        return <StreamViewer mediaDTU={mediaDTU} />;
      default:
        return (
          <div className="rounded-xl bg-lattice-deep border border-lattice-border p-8 text-center">
            <FileText className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">Unsupported media type: {mediaDTU.mediaType}</p>
          </div>
        );
    }
  }, [mediaDTU, autoplay, onEnd, onTimeUpdate]);

  return (
    <div className={cn('space-y-3', className)}>
      {/* Media player */}
      {renderPlayer()}

      {/* Media info & engagement bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-medium truncate">{mediaDTU.title}</h3>
          <div className="flex items-center gap-3 mt-1">
            {mediaDTU.authorName && (
              <span className="text-sm text-gray-400">{mediaDTU.authorName}</span>
            )}
            {mediaDTU.engagement && (
              <span className="text-xs text-gray-500">
                {formatViewCount(mediaDTU.engagement.views)} views
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setLiked(prev => !prev)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              liked ? 'text-neon-pink' : 'text-gray-400 hover:text-neon-pink'
            )}
          >
            <Heart className={cn('w-5 h-5', liked && 'fill-current')} />
          </button>
          <button className="p-2 text-gray-400 hover:text-white rounded-lg transition-colors">
            <MessageCircle className="w-5 h-5" />
          </button>
          <button className="p-2 text-gray-400 hover:text-white rounded-lg transition-colors">
            <Share2 className="w-5 h-5" />
          </button>
          <button className="p-2 text-gray-400 hover:text-white rounded-lg transition-colors">
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tags */}
      {mediaDTU.tags && mediaDTU.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {mediaDTU.tags.map(tag => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-full bg-neon-cyan/10 text-neon-cyan text-xs"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Transcode status */}
      {mediaDTU.transcodeStatus === 'processing' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neon-blue/10 border border-neon-blue/20">
          <Loader2 className="w-4 h-4 text-neon-blue animate-spin" />
          <span className="text-sm text-neon-blue">Processing media...</span>
        </div>
      )}
    </div>
  );
}

export default UniversalPlayer;
