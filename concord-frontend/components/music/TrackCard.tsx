'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Play, Pause, Plus, Heart, ShoppingCart, MoreHorizontal,
  Music, Clock, Tag, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMusicStore } from '@/lib/music/store';
import { getPlayer } from '@/lib/music/player';
import type { MusicTrack, ArtifactTier } from '@/lib/music/types';
import { PullToSubstrate } from '@/components/lens/PullToSubstrate';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatPrice(price: number): string {
  return price === 0 ? 'Free' : `$${price.toFixed(2)}`;
}

const TIER_LABELS: Record<ArtifactTier, { icon: string; label: string; color: string }> = {
  listen: { icon: '🎧', label: 'Listen', color: 'text-neon-cyan' },
  create: { icon: '🎭', label: 'Create', color: 'text-neon-purple' },
  commercial: { icon: '🏢', label: 'Commercial', color: 'text-neon-green' },
};

interface TrackCardProps {
  track: MusicTrack;
  variant?: 'card' | 'row' | 'compact';
  showTiers?: boolean;
  showLineage?: boolean;
  onArtistClick?: (artistId: string) => void;
  onAlbumClick?: (albumId: string) => void;
  onPurchase?: (track: MusicTrack, tier: ArtifactTier) => void;
}

export function TrackCard({
  track,
  variant = 'card',
  showTiers = false,
  showLineage = false,
  onArtistClick,
  onAlbumClick,
  onPurchase,
}: TrackCardProps) {
  const { nowPlaying, playTrack, addToQueue } = useMusicStore();
  const [showTierMenu, setShowTierMenu] = useState(false);
  const [liked, setLiked] = useState(false);

  // Default purchase handler — when the parent doesn't pass one, hit
  // marketplace.purchaseWithRoyalties directly so the cascade still
  // executes. Pre-fix the buy buttons rendered but did nothing unless
  // the parent remembered to wire the handler.
  const handlePurchase = async (t: MusicTrack, tier: ArtifactTier) => {
    if (onPurchase) return onPurchase(t, tier);
    if (typeof window === 'undefined') return;
    const tierMeta = t.tiers?.find?.((tt) => tt.tier === tier);
    const priceCents = Math.round((tierMeta?.price ?? 0) * 100);
    if (priceCents === 0) return;
    const ok = window.confirm(
      `Purchase the ${tier} license for "${t.title}" at $${(priceCents / 100).toFixed(2)} CC? Royalty cascade pays every ancestor creator on the lineage chain.`
    );
    if (!ok) return;
    try {
      const { api } = await import('@/lib/api/client');
      await api.post('/api/marketplace/purchaseWithRoyalties', {
        dtuId: t.id,
        tier,
        priceCents,
      });
    } catch {
      // network error surfacing handled by global axios toast interceptor
    }
  };

  const isCurrentTrack = nowPlaying.track?.id === track.id;
  const isPlaying = isCurrentTrack && nowPlaying.playbackState === 'playing';

  const [noAudioWarning, setNoAudioWarning] = useState(false);

  const handlePlay = () => {
    // If the track has no audio URL, show a fallback warning and play a short tone
    if (!track.audioUrl) {
      setNoAudioWarning(true);
      setTimeout(() => setNoAudioWarning(false), 3000);
      // Play a short Web Audio API tone as fallback
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 440;
        gain.gain.value = 0.15;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.stop(ctx.currentTime + 0.5);
        setTimeout(() => ctx.close(), 600);
      } catch { /* Web Audio not available */ }
      return;
    }
    if (isCurrentTrack) {
      const player = getPlayer();
      if (isPlaying) player.pause();
      else player.play();
    } else {
      playTrack(track);
    }
  };

  const handleAddToQueue = () => {
    addToQueue(track);
  };

  // ---- Card Variant ----
  if (variant === 'card') {
    return (
      <div className={cn(
        'group bg-white/[0.03] rounded-xl border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all overflow-hidden',
        isPlaying && 'border-l-2 border-l-neon-cyan shadow-[inset_4px_0_12px_-4px_rgba(0,255,255,0.2)] ring-1 ring-neon-cyan/10',
      )}>
        {/* Cover */}
        <div className="relative aspect-square bg-white/5 overflow-hidden">
          {track.coverArtUrl ? (
            <Image src={track.coverArtUrl} alt={track.title || 'Track cover'} fill className="object-cover" unoptimized />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neon-purple/20 to-neon-cyan/20">
              <Music className="w-12 h-12 text-gray-600" />
            </div>
          )}

          {/* Play overlay */}
          <button
            onClick={handlePlay}
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30"
          >
            <div className="w-12 h-12 rounded-full bg-neon-cyan flex items-center justify-center shadow-lg shadow-neon-cyan/30">
              {isPlaying ? <Pause className="w-5 h-5 text-black" /> : <Play className="w-5 h-5 text-black ml-0.5" />}
            </div>
          </button>

          {/* Lineage badge */}
          {showLineage && track.lineageDepth > 0 && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-neon-purple/20 text-neon-purple text-[9px] font-medium backdrop-blur-sm">
              Remix {track.parentTitle ? `of "${track.parentTitle}"` : ''}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-3 space-y-1.5">
          <p className={cn('text-sm font-medium truncate', isCurrentTrack && 'text-neon-cyan')}>
            {track.title}
          </p>
          <p
            className="text-xs text-gray-400 truncate cursor-pointer hover:text-white transition-colors"
            onClick={() => onArtistClick?.(track.artistId)}
          >
            {track.artistName}
          </p>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-0.5">
                <Clock className="w-3 h-3" /> {formatTime(track.duration)}
              </span>
              {track.genre && (
                <span className="flex items-center gap-0.5">
                  <Tag className="w-3 h-3" /> {track.genre}
                </span>
              )}
              {track.bpm != null && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full bg-neon-purple/10 text-neon-purple font-medium">
                  <Activity className="w-2.5 h-2.5" /> {track.bpm}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <PullToSubstrate domain="music" artifactId={track.id} compact />
              <button
                onClick={() => setLiked(!liked)}
                className={cn('p-1 transition-colors', liked ? 'text-neon-pink' : 'text-gray-600 hover:text-white')}
              aria-label="Like">
                <Heart className="w-3.5 h-3.5" fill={liked ? 'currentColor' : 'none'} />
              </button>
              <button onClick={handleAddToQueue} className="p-1 text-gray-600 hover:text-white transition-colors" aria-label="Add">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* No audio fallback warning */}
          {noAudioWarning && (
            <p className="text-[10px] text-amber-400 pt-1">No audio file -- upload one</p>
          )}

          {/* Tier badges */}
          {showTiers && (
            <div className="flex gap-1 pt-1">
              {track.tiers.filter(t => t.enabled).map(tier => (
                <button
                  key={tier.tier}
                  onClick={() => handlePurchase(track, tier.tier)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium border transition-colors hover:bg-white/5',
                    TIER_LABELS[tier.tier].color,
                    'border-current/20',
                  )}
                >
                  <span>{TIER_LABELS[tier.tier].icon}</span>
                  <span>{formatPrice(tier.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Row Variant ----
  if (variant === 'row') {
    return (
      <div
        className={cn(
          'group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors',
          isCurrentTrack && 'bg-white/5',
          isPlaying && 'border-l-2 border-l-neon-cyan bg-neon-cyan/[0.04] shadow-[inset_4px_0_12px_-4px_rgba(0,255,255,0.15)]',
        )}
      >
        {/* Play button / track number */}
        <button
          onClick={handlePlay}
          className="w-8 h-8 flex-shrink-0 flex items-center justify-center text-gray-500 group-hover:text-white transition-colors relative"
        >
          {isPlaying ? (
            <>
              <span className="absolute inset-0 rounded-full bg-neon-cyan/20 animate-ping" />
              <Pause className="w-4 h-4 text-neon-cyan relative z-10" />
            </>
          ) : (
            <Play className="w-4 h-4" />
          )}
        </button>

        {/* Cover thumbnail */}
        <div className="w-10 h-10 rounded bg-white/5 overflow-hidden flex-shrink-0">
          {track.coverArtUrl ? (
            <Image src={track.coverArtUrl} alt={track.title || 'Track cover'} width={40} height={40} className="w-full h-full object-cover" unoptimized />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music className="w-4 h-4 text-gray-600" />
            </div>
          )}
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm truncate', isCurrentTrack ? 'text-neon-cyan' : 'text-white')}>
            {track.title}
          </p>
          <p
            className="text-xs text-gray-400 truncate cursor-pointer hover:text-white"
            onClick={() => onArtistClick?.(track.artistId)}
          >
            {track.artistName}
            {track.albumTitle && (
              <span
                className="text-gray-500 cursor-pointer hover:text-gray-300"
                onClick={(e) => { e.stopPropagation(); onAlbumClick?.(track.albumId || ''); }}
              >
                {' · '}{track.albumTitle}
              </span>
            )}
          </p>
          {noAudioWarning && (
            <p className="text-[10px] text-amber-400">No audio file -- upload one</p>
          )}
        </div>

        {/* Lineage */}
        {showLineage && track.lineageDepth > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[8px] bg-neon-purple/10 text-neon-purple flex-shrink-0">
            Remix
          </span>
        )}

        {/* Play count */}
        <span className="text-xs text-gray-500 w-16 text-right flex-shrink-0">
          {track.playCount.toLocaleString()} plays
        </span>

        {/* Duration */}
        <span className="text-xs text-gray-500 w-10 text-right flex-shrink-0 font-mono">
          {formatTime(track.duration)}
        </span>

        {/* BPM badge */}
        {track.bpm != null && (
          <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-neon-purple/10 text-neon-purple text-[10px] font-medium">
            <Activity className="w-2.5 h-2.5" /> {track.bpm}
          </span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <PullToSubstrate domain="music" artifactId={track.id} compact />
          <button
            onClick={() => setLiked(!liked)}
            className={cn('p-1', liked ? 'text-neon-pink' : 'text-gray-500 hover:text-white')}
          aria-label="Like">
            <Heart className="w-3.5 h-3.5" fill={liked ? 'currentColor' : 'none'} />
          </button>
          <button onClick={handleAddToQueue} className="p-1 text-gray-500 hover:text-white" aria-label="Add">
            <Plus className="w-3.5 h-3.5" />
          </button>
          {showTiers && (
            <div className="relative">
              <button
                onClick={() => setShowTierMenu(!showTierMenu)}
                className="p-1 text-gray-500 hover:text-white"
              aria-label="Cart">
                <ShoppingCart className="w-3.5 h-3.5" />
              </button>
              {showTierMenu && (
                <div className="absolute right-0 bottom-full mb-1 w-44 bg-lattice-elevated border border-white/10 rounded-lg shadow-xl p-2 space-y-1 z-50">
                  {track.tiers.filter(t => t.enabled).map(tier => (
                    <button
                      key={tier.tier}
                      onClick={() => { handlePurchase(track, tier.tier); setShowTierMenu(false); }}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5 text-xs"
                    >
                      <span className={TIER_LABELS[tier.tier].color}>
                        {TIER_LABELS[tier.tier].icon} {TIER_LABELS[tier.tier].label}
                      </span>
                      <span className="text-gray-400">{formatPrice(tier.price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('track:menu', { detail: { trackId: track.id } })); }}
            aria-label="Track menu"
            className="p-1 text-gray-500 hover:text-white"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // ---- Compact Variant ----
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer transition-colors',
        isCurrentTrack && 'bg-white/5',
        isPlaying && 'border-l-2 border-l-neon-cyan bg-neon-cyan/[0.04]',
      )}
      onClick={handlePlay} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="w-4 text-center">
        {isPlaying ? (
          <Pause className="w-3 h-3 text-neon-cyan" />
        ) : (
          <Play className="w-3 h-3 text-gray-500 group-hover:text-white" />
        )}
      </div>
      <span className={cn('text-xs truncate flex-1', isCurrentTrack ? 'text-neon-cyan' : 'text-gray-300')}>
        {track.title}
      </span>
      <span className="text-[10px] text-gray-500 font-mono">{formatTime(track.duration)}</span>
    </div>
  );
}
