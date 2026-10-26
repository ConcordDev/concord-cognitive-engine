'use client';

/**
 * PostMediaCard — media cards for posts that attach a Studio track or a
 * Marketplace item (job oc-social-3b item d).
 *
 * Substrate (all real — see server/lib/social-share.js):
 *   - Audio tracks: posts shared from Studio carry mediaType 'audio' plus a
 *     public https mediaUrl (the server only attaches playable URLs —
 *     owner-only studio audio never leaks). Rendered as a card with a real
 *     play/pause button — playback starts ONLY on the click; nothing
 *     autoplays.
 *   - Marketplace items: posts shared from a marketplace listing carry a
 *     `listing` object the server copied from the listing row (title,
 *     price/priceCents, currency, fee rates from economy/fees.js). Shown
 *     with the existing SocialCommerceTag card; opening it navigates to
 *     the real marketplace listing page.
 *
 * If a post has neither attachment, nothing renders.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Music, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SocialCommerceTag } from './SocialCommerceTag';

export interface PostListingAttachment {
  id?: string;
  title?: string | null;
  price?: number;
  priceCents?: number;
  currency?: string;
  transferRate?: number;
  marketplaceRate?: number;
}

export interface PostMediaCardProps {
  mediaType?: string;
  mediaUrl?: string | null;
  listing?: PostListingAttachment | null;
  className?: string;
}

function listingPrice(listing: PostListingAttachment): number | null {
  if (typeof listing.price === 'number' && Number.isFinite(listing.price)) return listing.price;
  // price_cents is the marketplace listings table's canonical column —
  // cents of the listing currency, so /100 is a unit conversion, not a
  // made-up number.
  if (typeof listing.priceCents === 'number' && Number.isFinite(listing.priceCents)) return listing.priceCents / 100;
  return null;
}

export function PostMediaCard({ mediaType, mediaUrl, listing, className }: PostMediaCardProps) {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState(false);

  // The audio element is unmounted (or replaced) when posts refresh —
  // make sure the toggle state can't outlive the element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnd = () => setPlaying(false);
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('play', onPlay);
    return () => {
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('play', onPlay);
    };
  }, [mediaUrl]);

  if (listing && listing.id) {
    const price = listingPrice(listing);
    // Only show the commerce card when the listing row carried a real
    // price — without one, the card would be a claim the data never made.
    if (price === null) {
      return (
        <p className={cn('mt-1 text-xs text-zinc-400', className)}>
          Shared a marketplace item: {listing.title || listing.id}
          {typeof listing.transferRate === 'number' ? ` · transfer fee ${(listing.transferRate * 100).toFixed(2)}%` : ''}
          {typeof listing.marketplaceRate === 'number' ? ` · marketplace fee ${(listing.marketplaceRate * 100).toFixed(2)}%` : ''}
        </p>
      );
    }
    return (
      <div className={cn('mt-2', className)}>
        <SocialCommerceTag
          listing={{
            listingId: String(listing.id),
            title: listing.title || 'Marketplace item',
            price,
            currency: listing.currency,
          }}
          onNavigateToListing={(listingId) => router.push(`/lenses/marketplace/music/${encodeURIComponent(listingId)}`)}
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          {typeof listing.transferRate === 'number' ? `transfer fee ${(listing.transferRate * 100).toFixed(2)}%` : null}
          {typeof listing.transferRate === 'number' && typeof listing.marketplaceRate === 'number' ? ' · ' : null}
          {typeof listing.marketplaceRate === 'number' ? `marketplace fee ${(listing.marketplaceRate * 100).toFixed(2)}%` : null}
        </p>
      </div>
    );
  }

  if (mediaType === 'audio' && mediaUrl) {
    const toggle = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (playing) {
        audio.pause();
        return;
      }
      setPlayError(false);
      // User-initiated play only — this is the ONLY call to play().
      // (Promise.resolve: browsers return a promise from play(); jsdom
      // doesn't, and this must never crash the click handler either way.)
      Promise.resolve(audio.play()).catch(() => setPlayError(true));
    };
    return (
      <div className={cn('mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2', className)}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-teal-400/40 bg-teal-400/10 text-teal-200 hover:bg-teal-400/20"
            aria-label={playing ? 'Pause attached audio track' : 'Play attached audio track'}
          >
            {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </button>
          <span className="flex items-center gap-1 text-xs text-zinc-400">
            <Music className="h-3.5 w-3.5" aria-hidden="true" />
            Audio track
          </span>
          {playError && (
            <span className="flex items-center gap-1 text-xs text-rose-300" role="alert">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Couldn’t play this track.
            </span>
          )}
        </div>
        {/* Real audio element. No autoPlay attribute and preload="none" —
            it only plays via the button above (or its own controls). */}
        <audio ref={audioRef} src={mediaUrl} preload="none" controls className="mt-2 w-full" onError={() => setPlayError(true)} />
      </div>
    );
  }

  return null;
}

export default PostMediaCard;