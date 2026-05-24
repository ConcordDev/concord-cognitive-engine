'use client';

/**
 * ReelsFeed — vertical-scroll list of reels with per-card analytics
 * + the existing pan-social primitives layered on top.
 *
 * Phase 11 (Item 6). Backed by the `reels.list_for_you` macro.
 *
 * No fake content — empty state says "Be the first to post a reel".
 * View counts come from the real reel_views ledger; watch-complete
 * events POST to `reels.record_view` after the user crosses 80% of
 * the duration so the algorithmic feed stays honest.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Play, Volume2, VolumeX, Camera } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ReactionBar } from '@/components/social/ReactionBar';
import { BookmarkButton } from '@/components/social/BookmarkButton';
import { ShareButton } from '@/components/social/ShareButton';
import { CommentThread } from '@/components/social/CommentThread';
import { UserLink } from '@/components/social/UserLink';
import { ReelRecorder } from '@/components/reels/ReelRecorder';

interface Reel {
  id: string;
  postId: string;
  userId: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds: number;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
  musicAttribution?: string | null;
  viewCount: number;
  completionCount: number;
  completionRate: number;
  createdAt: number;
}

interface ListResponse { ok: boolean; results?: Reel[]; total?: number; }

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try { const r = await api.post('/api/lens/run', { domain, name, input }); return r?.data as T; }
  catch { return null; }
}

export interface ReelsFeedProps { className?: string; }

export function ReelsFeed({ className }: ReelsFeedProps) {
  const [recorderOpen, setRecorderOpen] = useState(false);
  const { data, isLoading, refetch } = useQuery<ListResponse | null>({
    queryKey: ['reels-for-you'],
    queryFn: async () => runMacro<ListResponse>('reels', 'list_for_you', { limit: 20 }),
    staleTime: 60_000,
  });

  const reels = data?.results ?? [];

  const RecordFab = (
    <button
      type="button"
      onClick={() => setRecorderOpen(true)}
      className="fixed bottom-20 right-5 sm:bottom-6 sm:right-6 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium shadow-2xl shadow-rose-900/30"
      aria-label="Record a reel"
    >
      <Camera className="w-4 h-4" />
      Record
    </button>
  );

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 py-10 text-zinc-400 text-sm', className)}>
        <Loader2 className="w-4 h-4 animate-spin" /> Loading reels…
      </div>
    );
  }

  if (reels.length === 0) {
    return (
      <>
        <div className={cn('text-center py-12 text-zinc-400', className)}>
          <Play className="w-6 h-6 mx-auto mb-2 text-zinc-400" />
          <div className="font-medium text-zinc-200">No reels yet</div>
          <div className="text-sm mt-1">Be the first to post a reel.</div>
        </div>
        {RecordFab}
        {recorderOpen && <ReelRecorder onClose={() => setRecorderOpen(false)} onPosted={() => refetch()} />}
      </>
    );
  }

  return (
    <>
      <div className={cn('space-y-6 snap-y snap-mandatory max-h-[calc(100vh-12rem)] overflow-y-auto', className)}>
        {reels.map(r => (
          <ReelCard key={r.id} reel={r} onWatched={() => refetch()} />
        ))}
      </div>
      {RecordFab}
      {recorderOpen && <ReelRecorder onClose={() => setRecorderOpen(false)} onPosted={() => refetch()} />}
    </>
  );
}

function ReelCard({ reel, onWatched }: { reel: Reel; onWatched: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [watchedSeconds, setWatchedSeconds] = useState(0);
  const recordedRef = useRef(false);

  // Update watchedSeconds + once the viewer crosses 80% threshold,
  // POST a single record_view. We intentionally never POST more than
  // once per mount so the analytics ledger isn't double-counted.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTimeUpdate = () => {
      setWatchedSeconds(v.currentTime);
      if (!recordedRef.current && v.currentTime >= reel.durationSeconds * 0.8) {
        recordedRef.current = true;
        void runMacro('reels', 'record_view', { reelId: reel.id, watchedSeconds: v.currentTime });
        onWatched();
      }
    };
    v.addEventListener('timeupdate', onTimeUpdate);
    return () => v.removeEventListener('timeupdate', onTimeUpdate);
  }, [reel.id, reel.durationSeconds, onWatched]);

  // Pause when scrolled out of view; play when in view. Cheap
  // implementation via IntersectionObserver.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.intersectionRatio > 0.6) v.play().catch(() => { /* autoplay blocked */ });
        else v.pause();
      }
    }, { threshold: [0.6] });
    io.observe(v);
    return () => io.disconnect();
  }, []);

  const onToggleMute = useCallback(() => {
    setMuted(m => {
      const next = !m;
      if (videoRef.current) videoRef.current.muted = next;
      return next;
    });
  }, []);

  const ratio = reel.viewCount > 0 ? Math.round(reel.completionRate * 100) : 0;

  return (
    <article className="snap-start relative rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="relative aspect-[9/16] max-h-[80vh] bg-black">
        <video
          ref={videoRef}
          src={reel.videoUrl}
          poster={reel.thumbnailUrl || undefined}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          className="w-full h-full object-contain"
        />
        <button
          type="button"
          onClick={onToggleMute}
          className="absolute top-2 right-2 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        {/* progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
          <div className="h-full bg-white/80" style={{ width: `${Math.min(100, (watchedSeconds / reel.durationSeconds) * 100)}%` }} />
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <UserLink userId={reel.userId} prefix="@" />
          <div className="text-[10px] text-zinc-400 font-mono">
            {reel.viewCount} view{reel.viewCount === 1 ? '' : 's'}
            {reel.viewCount > 0 && ` · ${ratio}% complete`}
          </div>
        </div>
        {reel.caption && <p className="text-sm text-zinc-100 whitespace-pre-wrap">{reel.caption}</p>}
        {reel.musicAttribution && (
          <div className="text-[10px] text-zinc-400 italic">♫ {reel.musicAttribution}</div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <ReactionBar postId={reel.postId} compact />
          <ShareButton postId={reel.postId} compact />
          <BookmarkButton postId={reel.postId} />
        </div>
        <CommentThread postId={reel.postId} collapsed maxDepth={2} />
      </div>
    </article>
  );
}

export default ReelsFeed;
