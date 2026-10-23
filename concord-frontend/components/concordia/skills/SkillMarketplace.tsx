'use client';

import React, { useEffect, useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Listing {
  id: string;
  seller_id: string;
  skill_dtu_id: string;
  origin_world_id: string;
  price_cc: number;
  description: string;
  effectiveness_ratings: Record<string, number>;
  listed_at: number;
  skill_title?: string;
  skill_level?: number;
}

interface SkillMarketplaceProps {
  currentUserId?: string;
  currentWorldId?: string;
  className?: string;
}

const UNIVERSE_ICONS: Record<string, string> = {
  'concordia-hub':     '🏙️',
  'fantasy':            '🧙',
  'superhero':          '⚡',
  'crime':              '🔫',
  'cyber':              '💾',
  'sere':               '🌑',
  'tunya':              '🌊',
  'sovereign-ruins':    '🏛️',
  'lattice-crucible':   '🔷',
  'concord-link-frontier': '🧭',
  'fable-world':       '🧙',
  'superhero-world':   '⚡',
  'wasteland-world':   '☢️',
  'crime-city':        '🔫',
  'war-zone':          '🪖',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ListingCard({
  listing,
  isMine,
  onBuy,
  buying,
}: { listing: Listing; isMine: boolean; onBuy: (id: string) => void; buying: boolean }) {
  const icon = UNIVERSE_ICONS[listing.origin_world_id] || '🌍';
  return (
    <div className="bg-black/50 border border-white/10 rounded-lg p-4 flex flex-col gap-2 hover:border-white/20 transition">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-white truncate">{listing.skill_title || 'Unknown Skill'}</div>
        <span className="text-lg shrink-0">{icon}</span>
      </div>
      <div className="text-xs text-white/40 font-mono">{listing.origin_world_id}</div>
      {listing.skill_level && (
        <div className="text-xs text-amber-400 font-mono">Lv {listing.skill_level.toFixed(1)}</div>
      )}
      <p className="text-xs text-white/60 line-clamp-2">{listing.description}</p>
      <div className="flex items-center justify-between mt-auto pt-2">
        <span className="text-sm font-bold text-emerald-400 font-mono">{listing.price_cc} CC</span>
        {!isMine ? (
          <button
            onClick={() => onBuy(listing.id)}
            disabled={buying}
            className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-1.5 font-semibold transition disabled:opacity-50"
          >
            {buying ? 'Buying…' : 'Buy'}
          </button>
        ) : (
          <span className="text-xs text-white/30 italic">Your listing</span>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SkillMarketplace({ currentUserId, currentWorldId, className = '' }: SkillMarketplaceProps) {
  const [listings,    setListings]    = useState<Listing[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [buying,      setBuying]      = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [success,     setSuccess]     = useState<string | null>(null);
  const [worldFilter, setWorldFilter] = useState(currentWorldId || '');

  const loadListings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (worldFilter) params.set('worldId', worldFilter);
      const res = await fetch(`/api/worlds/marketplace?${params}`);
      const d   = await res.json();
      setListings(d.listings || []);
    } catch (_e) {
      setError('Failed to load marketplace');
    } finally {
      setLoading(false);
    }
  }, [worldFilter]);

  useEffect(() => { loadListings(); }, [loadListings]);

  const handleBuy = useCallback(async (listingId: string) => {
    setBuying(listingId);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/worlds/marketplace/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Purchase failed');
      }
      setSuccess('Skill purchased! Check your skill inventory.');
      loadListings();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Purchase failed');
    } finally {
      setBuying(null);
    }
  }, [loadListings]);

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-white font-semibold">Skill Marketplace</span>
        <select
          value={worldFilter}
          onChange={e => setWorldFilter(e.target.value)}
          className="ml-auto bg-black/40 border border-white/10 text-white/70 text-xs rounded px-2 py-1"
        >
          <option value="">All worlds</option>
          {Object.keys(UNIVERSE_ICONS).map(id => (
            <option key={id} value={id}>{UNIVERSE_ICONS[id]} {id}</option>
          ))}
        </select>
        <button onClick={loadListings} className="text-xs text-white/40 hover:text-white/70 transition">↺</button>
      </div>

      {error   && <div className="text-red-400 text-xs bg-red-900/20 border border-red-500/30 rounded px-3 py-2">{error}</div>}
      {success && <div className="text-emerald-400 text-xs bg-emerald-900/20 border border-emerald-500/30 rounded px-3 py-2">{success}</div>}

      {loading ? (
        <div className="text-white/40 text-sm font-mono">Loading listings…</div>
      ) : listings.length === 0 ? (
        <div className="text-white/30 text-sm font-mono">No skills listed yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {listings.map(l => (
            <ListingCard
              key={l.id}
              listing={l}
              isMine={l.seller_id === currentUserId}
              onBuy={handleBuy}
              buying={buying === l.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
