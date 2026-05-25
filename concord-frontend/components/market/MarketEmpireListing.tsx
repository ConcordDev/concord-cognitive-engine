'use client';

import React from 'react';
import { Store, Tag, Clock, User } from 'lucide-react';

interface Listing {
  id: string;
  title?: string;
  description?: string;
  price?: number;
  seller?: string;
  createdAt?: string;
  tags?: string[];
  type?: string;
}

interface MarketEmpireListingProps {
  listing: Listing;
  onPurchase?: (id: string) => void;
}

function MarketEmpireListingInner({ listing, onPurchase }: MarketEmpireListingProps) {
  return (
    <div className="lens-card hover:border-neon-green/50 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Store className="w-5 h-5 text-neon-green" />
          <span className="text-xs px-2 py-0.5 bg-neon-green/20 text-neon-green rounded">
            {listing.type || 'DTU'}
          </span>
        </div>
        {listing.price !== undefined && (
          <span className="text-lg font-bold text-neon-cyan">
            {listing.price} CC
          </span>
        )}
      </div>

      <h3 className="font-semibold text-white mb-2 truncate">
        {listing.title || 'Untitled Listing'}
      </h3>

      <p className="text-sm text-gray-400 line-clamp-2 mb-3">
        {listing.description || 'No description provided.'}
      </p>

      {listing.tags && listing.tags.length > 0 && (
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          <Tag className="w-3 h-3 text-gray-400" />
          {listing.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 bg-lattice-surface rounded text-gray-400"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-400 pt-3 border-t border-lattice-border">
        <div className="flex items-center gap-1">
          <User className="w-3 h-3" />
          <span>{listing.seller || 'Anonymous'}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>
            {listing.createdAt
              ? new Date(listing.createdAt).toLocaleDateString()
              : 'Recently'}
          </span>
        </div>
      </div>

      {onPurchase && (
        <button
          onClick={() => onPurchase(listing.id)}
          className="btn-neon w-full mt-3 text-sm"
        >
          Purchase
        </button>
      )}
    </div>
  );
}

export const MarketEmpireListing = React.memo(MarketEmpireListingInner);
export default MarketEmpireListing;
