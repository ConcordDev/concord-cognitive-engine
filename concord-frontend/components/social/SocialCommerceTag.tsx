'use client';

import { motion } from 'framer-motion';
import {
  ShoppingBag,
  Coins,
  Image as ImageIcon,
} from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface MarketplaceListing {
  listingId: string;
  title: string;
  imageUrl?: string;
  price: number;
  currency?: string;
}

interface SocialCommerceTagProps {
  listing: MarketplaceListing;
  earnings?: number;
  onBuy?: (listingId: string) => void;
  onNavigateToListing?: (listingId: string) => void;
  className?: string;
}

// ── Main Component ───────────────────────────────────────────────────────────

export function SocialCommerceTag({
  listing,
  earnings,
  onBuy,
  onNavigateToListing,
  className,
}: SocialCommerceTagProps) {
  const handleBuy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onBuy) {
      onBuy(listing.listingId);
    } else {
      onNavigateToListing?.(listing.listingId);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl bg-lattice-deep border border-lattice-border hover:border-neon-green/30 transition-all',
        className
      )}
    >
      {/* Item image / placeholder */}
      <div className="w-14 h-14 rounded-lg bg-lattice-surface border border-lattice-border flex-shrink-0 overflow-hidden">
        {listing.imageUrl ? (
          <img
            src={listing.imageUrl}
            alt={listing.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-6 h-6 text-gray-600" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <button
          onClick={() => onNavigateToListing?.(listing.listingId)}
          className="text-sm text-white font-medium hover:text-neon-cyan transition-colors truncate block text-left w-full"
        >
          {listing.title}
        </button>

        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm font-bold text-neon-green">
            {listing.price} {listing.currency || 'CC'}
          </span>
          {earnings !== undefined && earnings > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400/80 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
              <Coins className="w-2.5 h-2.5" />
              Earned {formatNumber(earnings)} CC
            </span>
          )}
        </div>
      </div>

      {/* Buy button */}
      <button
        onClick={handleBuy}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neon-green/15 text-neon-green text-xs font-semibold border border-neon-green/30 hover:bg-neon-green/25 transition-all flex-shrink-0"
      >
        <ShoppingBag className="w-3.5 h-3.5" />
        Buy
      </button>
    </motion.div>
  );
}

export default SocialCommerceTag;
