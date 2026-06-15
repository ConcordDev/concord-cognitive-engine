'use client';

/**
 * CreatorGrid — a cover-grid feed that puts creator art up front.
 *
 * The visual signature of a creator-economy storefront where the
 * artist gets paid: chunky cover-art grid, audio preview on hover /
 * tap, "name your price" minimum + suggested, "support the creator"
 * CTA in the artist's own colour. Concord's marketplace is already
 * 95/5 to creators, so this grid is the *honest* version of what
 * a creator-first marketplace surfaces.
 *
 * Drop-in for the marketplace lens browse tab. Each tile carries
 * audio preview, royalty-aware pricing, and the creator chip.
 */

import React, { useRef, useState } from 'react';
import { Play, Pause, Coins, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CreatorGridItem {
  id: string;
  title: string;
  creator: string;
  /** Cover art URL; falls back to a generated gradient if absent. */
  coverUrl?: string;
  /** Audio preview URL (m4a / mp3 / opus). */
  previewUrl?: string;
  /** Minimum allowed price; "name your price" allows ≥ this. */
  minPriceCc: number;
  /** Suggested price, surfaced separately so users can see what most pay. */
  suggestedPriceCc?: number;
  /** Royalty rate at this generation in the cascade (0..1). */
  royaltyRate?: number;
  /** Color hint for the artist accent. */
  accent?: string;
  /** Tag list ("ambient", "study", "lofi"). */
  tags?: string[];
}

export interface CreatorGridProps {
  items: CreatorGridItem[];
  onSupport?: (item: CreatorGridItem, priceCc: number) => void;
  onOpen?: (item: CreatorGridItem) => void;
  /** Optional grid density override. */
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}

function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) & 0xfffffff;
  const h1 = hash % 360;
  const h2 = (h1 + 60 + (hash >> 8) % 80) % 360;
  return `linear-gradient(135deg, hsl(${h1} 70% 28%), hsl(${h2} 70% 18%))`;
}

export function CreatorGrid({ items, onSupport, onOpen, columns = 3, className }: CreatorGridProps) {
  if (items.length === 0) return null;
  const gridCols =
    columns === 5 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
    : columns === 4 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
    : columns === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
    : 'grid-cols-1 sm:grid-cols-2';
  return (
    <div className={cn('grid gap-4', gridCols, className)}>
      {items.map((item) => (
        <CreatorTile key={item.id} item={item} onSupport={onSupport} onOpen={onOpen} />
      ))}
    </div>
  );
}

interface CreatorTileProps {
  item: CreatorGridItem;
  onSupport?: (item: CreatorGridItem, priceCc: number) => void;
  onOpen?: (item: CreatorGridItem) => void;
}

function CreatorTile({ item, onSupport, onOpen }: CreatorTileProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [price, setPrice] = useState(item.suggestedPriceCc ?? item.minPriceCc);

  function togglePreview() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function support() {
    if (price < item.minPriceCc) return;
    onSupport?.(item, price);
  }

  return (
    <article
      className="group rounded-lg overflow-hidden border border-white/10 bg-black/40 hover:border-amber-500/40 transition-colors"
      data-creator-tile
    >
      <button
        type="button"
        onClick={() => onOpen?.(item)}
        className="block w-full aspect-square relative"
        style={item.coverUrl ? undefined : { background: gradientFor(item.id) }}
        aria-label={`Open ${item.title}`}
      >
        {item.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/30 font-mono text-2xl">
            {item.title.slice(0, 2).toUpperCase()}
          </div>
        )}
        {item.previewUrl && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePreview();
            }}
            aria-label={playing ? 'Pause preview' : 'Play preview'}
            className="absolute bottom-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 hover:bg-amber-500/30 transition"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
          </button>
        )}
        {item.previewUrl && (
          <audio
            ref={audioRef}
            src={item.previewUrl}
            preload="none"
            onEnded={() => setPlaying(false)}
          />
        )}
      </button>
      <div className="p-3 space-y-2">
        <div>
          <div
            className="text-sm font-semibold text-white truncate"
            style={{ color: item.accent }}
          >
            {item.title}
          </div>
          <div className="text-xs text-gray-400 truncate">{item.creator}</div>
        </div>

        {item.tags && item.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {item.tags.slice(0, 4).map((t) => (
              <li
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10"
              >
                {t}
              </li>
            ))}
          </ul>
        )}

        {/* Name-your-price row. */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">name your price</span>
          {item.suggestedPriceCc !== undefined && (
            <span className="text-[10px] text-amber-400/80 font-mono">
              suggested {item.suggestedPriceCc}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={item.minPriceCc}
            step={1}
            value={price}
            onChange={(e) => setPrice(Math.max(item.minPriceCc, Number(e.target.value) || item.minPriceCc))}
            className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-sm font-mono text-amber-200"
            aria-label="Support price"
          />
          <button
            type="button"
            onClick={support}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-semibold hover:bg-amber-500/30"
          >
            <Coins className="w-3 h-3" />
            Support
          </button>
        </div>

        {/* Royalty cascade reminder — the moment the cover-grid stops
            being just merch and starts being equity. */}
        {item.royaltyRate !== undefined && item.royaltyRate > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-emerald-300/80">
            <Sparkles className="w-3 h-3" />
            {(item.royaltyRate * 100).toFixed(2)}% royalty cascades back forever
          </div>
        )}
      </div>
    </article>
  );
}

export default CreatorGrid;
