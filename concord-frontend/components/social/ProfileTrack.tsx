'use client';

/**
 * ProfileTrack — the one Studio track a profile owner pins to their
 * profile (job oc-social-5, Social identity / JOB 8).
 *
 * Substrate (all real):
 *   - Viewer: the chosen track is the owner's own published marketplace
 *     listing; playback uses the listing's public /preview stream via the
 *     existing PostMediaCard player. NEVER autoplay — play() happens
 *     only from the click.
 *   - Owner: a picker over their own published listings
 *     (GET /api/social/identity/track-options), saved through
 *     POST /api/social/identity/track. The server refuses anything the
 *     owner doesn't own or that isn't a published listing with a preview.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Music } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { PostMediaCard } from './PostMediaCard';

export interface ProfileTrackData {
  listingId: string;
  title: string;
  artist?: string | null;
  genre?: string | null;
  previewUrl: string;
}

export interface TrackOption {
  listingId: string;
  title: string;
  artist?: string | null;
}

interface ProfileTrackProps {
  userId: string;
  /** The sanitized track from the profile response; null when unset or no longer public. */
  track?: ProfileTrackData | null;
  /** Only the owner gets the picker. */
  isOwner: boolean;
  className?: string;
}

export function ProfileTrack({ userId, track, isOwner, className }: ProfileTrackProps) {
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    void queryClient.invalidateQueries({ queryKey: ['social-profiles'] });
  };

  const optionsQuery = useQuery({
    queryKey: ['social-track-options', userId],
    queryFn: async () => {
      const res = await api.get<{ ok?: boolean; options?: TrackOption[]; error?: string }>(
        '/api/social/identity/track-options',
      );
      if (res.data?.ok === false) throw new Error(res.data.error || 'Could not load your tracks.');
      return (res.data?.options || []) as TrackOption[];
    },
    enabled: isOwner,
    staleTime: 30_000,
  });

  const saveTrack = useMutation({
    mutationFn: async (listingId: string | null) => {
      const res = await api.post<{ ok?: boolean; error?: string }>('/api/social/identity/track', {
        listingId,
      });
      if (res.data && res.data.ok === false) {
        throw new Error(res.data.error || 'Could not set that profile track.');
      }
      return res.data;
    },
    onSuccess: () => refresh(),
  });

  // Nothing pinned and no owner picker to offer → render nothing.
  if (!track && !isOwner) return null;

  return (
    <div className={cn('rounded-2xl border border-white/10 bg-[#111] p-3', className)}>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400 font-mono">
        <Music className="h-3 w-3" aria-hidden="true" />
        Profile track
      </div>

      {track ? (
        <div>
          <p className="mb-1 truncate text-sm text-zinc-100">
            {track.title}
            {track.artist ? <span className="text-zinc-400"> · {track.artist}</span> : null}
            {track.genre && !track.artist ? <span className="text-zinc-400"> · {track.genre}</span> : null}
          </p>
          {/* Existing player component, listing /preview stream — tap to
              play, never autoplay, preload="none". */}
          <PostMediaCard mediaType="audio" mediaUrl={track.previewUrl} />
        </div>
      ) : (
        <p className="text-xs text-zinc-400">No profile track yet.</p>
      )}

      {isOwner && (
        <div className="mt-2">
          <label className="block text-xs text-zinc-400" htmlFor="profile-track-select">
            Choose from your published tracks
          </label>
          <div className="mt-1 flex items-center gap-2">
            <select
              id="profile-track-select"
              aria-label="Profile track"
              value={track?.listingId || ''}
              disabled={optionsQuery.isLoading || saveTrack.isPending}
              onChange={(e) => {
                const value = e.target.value;
                saveTrack.mutate(value === '' ? null : value);
              }}
              className="min-h-[44px] w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-zinc-100"
            >
              <option value="">No profile track</option>
              {(optionsQuery.data || []).map((option) => (
                <option key={option.listingId} value={option.listingId}>
                  {option.title}
                </option>
              ))}
            </select>
            {saveTrack.isPending ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" aria-hidden="true" />
            ) : null}
          </div>
          {optionsQuery.isError ? (
            <p className="mt-1 text-xs text-rose-300" role="alert">
              {optionsQuery.error instanceof Error ? optionsQuery.error.message : 'Could not load your tracks.'}
            </p>
          ) : null}
          {saveTrack.isError ? (
            <p className="mt-1 text-xs text-rose-300" role="alert">
              {saveTrack.error instanceof Error ? saveTrack.error.message : 'Could not set that profile track.'}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default ProfileTrack;