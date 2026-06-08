'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Train, Search, Star, Users, Globe, ArrowRight,
  Bookmark, BookmarkCheck, Home, Sparkles, Filter, ChevronDown,
  X, Eye, Lock, Building2, Palette, Swords, TreePine,
} from 'lucide-react';
import { ds } from '@/lib/design-system';
import { lensRun } from '@/lib/api/client';

/* ── Types ─────────────────────────────────────────────────────── */

type WorldMode = 'realistic' | 'fantasy' | 'creative' | 'competitive';
type WorldStatus = 'public' | 'invite' | 'firm-only';
type SortOption = 'popular' | 'newest' | 'friends-visiting' | 'firm-worlds' | 'recently-visited' | 'recommended';

interface WorldEntry {
  id: string;
  name: string;
  owner: string;
  playerCount: number;
  mode: WorldMode;
  status: WorldStatus;
  description: string;
  rules?: string;
  visitorCount: number;
  screenshot?: string;
  bookmarked?: boolean;
  friendsHere?: string[];
}

interface WorldInvite {
  id: string;
  fromUser: string;
  worldName: string;
  worldId: string;
  timestamp: string;
}

interface WorldTravelProps {
  worlds?: WorldEntry[];
  bookmarks?: WorldEntry[];
  recentWorlds?: WorldEntry[];
  invites?: WorldInvite[];
  onTravel?: (worldId: string) => void;
  onBookmark?: (worldId: string) => void;
  onAcceptInvite?: (inviteId: string) => void;
  onDeclineInvite?: (inviteId: string) => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = ds.panelFloating;

const MODE_META: Record<WorldMode, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  realistic:   { label: 'Realistic',   icon: TreePine,  color: 'text-green-400' },
  fantasy:     { label: 'Fantasy',     icon: Sparkles,  color: 'text-purple-400' },
  creative:    { label: 'Creative',    icon: Palette,   color: 'text-pink-400' },
  competitive: { label: 'Competitive', icon: Swords,    color: 'text-red-400' },
};

const STATUS_META: Record<WorldStatus, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  public:      { label: 'Public',    icon: Eye,       color: 'text-green-400' },
  invite:      { label: 'Invite',    icon: Lock,      color: 'text-yellow-400' },
  'firm-only': { label: 'Firm Only', icon: Building2, color: 'text-purple-400' },
};

const SORT_LABELS: Record<SortOption, string> = {
  popular: 'Popular',
  newest: 'Newest',
  'friends-visiting': 'Friends Visiting',
  'firm-worlds': 'Firm Worlds',
  'recently-visited': 'Recently Visited',
  recommended: 'Recommended',
};

/* ── Backend mapping ───────────────────────────────────────────── */

/** Shape returned by the `sub_worlds.discover` macro (publicView). */
interface BackendWorld {
  world_id: string;
  name: string;
  description?: string;
  kind?: string;
  privacy?: string;
  visits?: number;
  unique_visitors?: number;
  favorites?: number;
  spawned_by_user_id?: string;
  is_owner?: boolean;
  can_edit?: boolean;
}

// Map the backend world `kind` taxonomy onto the four display modes.
function kindToMode(kind?: string): WorldMode {
  if (!kind) return 'creative';
  if (/physics|simulat|real|city|infra/i.test(kind)) return 'realistic';
  if (/fantasy|magic|myth/i.test(kind)) return 'fantasy';
  if (/arena|battle|compet|tournament/i.test(kind)) return 'competitive';
  return 'creative';
}

function privacyToStatus(privacy?: string): WorldStatus {
  if (privacy === 'public') return 'public';
  if (privacy === 'unlisted') return 'firm-only';
  return 'invite';
}

function backendToWorld(w: BackendWorld): WorldEntry {
  return {
    id: w.world_id,
    name: w.name,
    owner: w.spawned_by_user_id || 'unknown',
    playerCount: w.unique_visitors || 0,
    mode: kindToMode(w.kind),
    status: privacyToStatus(w.privacy),
    description: w.description || '',
    visitorCount: w.visits || 0,
  };
}

/* ── Component ─────────────────────────────────────────────────── */

export default function WorldTravel({
  worlds: worldsProp,
  bookmarks: initialBookmarks,
  recentWorlds: recentProp,
  invites: invitesProp,
  onTravel,
  onBookmark,
  onAcceptInvite,
  onDeclineInvite,
}: WorldTravelProps) {
  // When the parent doesn't supply worlds, fetch real ones from the
  // creator-platform sub-worlds layer. Empty (not fabricated) until loaded.
  const [fetchedWorlds, setFetchedWorlds] = useState<WorldEntry[]>([]);
  const [worldsLoading, setWorldsLoading] = useState(!worldsProp);

  const loadWorlds = useCallback(async () => {
    if (worldsProp) return; // parent owns the data
    setWorldsLoading(true);
    try {
      const r = await lensRun<{ worlds?: BackendWorld[] }>('sub_worlds', 'discover', { sort: 'popular', limit: 60 });
      const list = r.data?.result?.worlds;
      setFetchedWorlds(Array.isArray(list) ? list.map(backendToWorld) : []);
    } catch {
      setFetchedWorlds([]); // honest empty on error
    } finally {
      setWorldsLoading(false);
    }
  }, [worldsProp]);

  useEffect(() => {
    loadWorlds();
  }, [loadWorlds]);

  const worlds = worldsProp ?? fetchedWorlds;
  // Invites have no discovery macro; show only what the parent passes.
  const invites = invitesProp ?? [];
  // Recent worlds: use parent prop, else fall back to the loaded set.
  const recentWorlds = recentProp ?? worlds;

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('popular');
  const [sortDropdown, setSortDropdown] = useState(false);
  const [selectedWorld, setSelectedWorld] = useState<WorldEntry | null>(null);
  const [activeTab, setActiveTab] = useState<'departures' | 'bookmarks' | 'recent'>('departures');
  const [traveling, setTraveling] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(
    new Set((initialBookmarks ?? []).map(b => b.id))
  );

  const filtered = worlds.filter(w =>
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    w.owner.toLowerCase().includes(search.toLowerCase())
  );

  const handleTravel = (worldId: string) => {
    setTraveling(true);
    onTravel?.(worldId);
    setTimeout(() => setTraveling(false), 2000);
  };

  const toggleBookmark = (worldId: string) => {
    setBookmarkedIds(prev => {
      const next = new Set(prev);
      if (next.has(worldId)) next.delete(worldId);
      else next.add(worldId);
      return next;
    });
    onBookmark?.(worldId);
  };

  /* ── Portal Transition ─────────────────────────────────────── */
  if (traveling) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="w-24 h-24 rounded-full bg-cyan-500/20 border-2 border-cyan-400/50 flex items-center justify-center animate-pulse">
          <Globe size={40} className="text-cyan-400 animate-spin" />
        </div>
        <p className="text-cyan-400 text-sm font-medium animate-pulse">Traveling through portal...</p>
        <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-cyan-400 rounded-full animate-[grow_2s_ease-in-out]" style={{ width: '80%' }} />
        </div>
      </div>
    );
  }

  /* ── World Preview Card ────────────────────────────────────── */
  const renderWorldPreview = (world: WorldEntry) => {
    const mode = MODE_META[world.mode];
    const status = STATUS_META[world.status];
    return (
      <div className={`${panel} p-5 w-96 space-y-4`}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-white font-semibold text-lg">{world.name}</h3>
            <span className="text-xs text-white/50">by {world.owner}</span>
          </div>
          <button onClick={() => setSelectedWorld(null)} className="text-white/40 hover:text-white" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Screenshot placeholder */}
        <div className="w-full h-36 rounded bg-gradient-to-br from-white/5 to-white/10 flex items-center justify-center">
          <Globe size={32} className="text-white/20" />
        </div>

        <p className="text-sm text-white/70">{world.description}</p>

        {world.rules && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-2">
            <p className="text-xs text-yellow-400/80"><strong>Rules:</strong> {world.rules}</p>
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-white/50">
          <span className="flex items-center gap-1">
            <Users size={12} /> {world.playerCount} online
          </span>
          <span className="flex items-center gap-1">
            <Eye size={12} /> {world.visitorCount.toLocaleString()} visitors
          </span>
          <span className={`flex items-center gap-1 ${mode.color}`}>
            {React.createElement(mode.icon, { className: 'w-3 h-3' })} {mode.label}
          </span>
          <span className={`flex items-center gap-1 ${status.color}`}>
            {React.createElement(status.icon, { className: 'w-3 h-3' })} {status.label}
          </span>
        </div>

        {world.friendsHere && world.friendsHere.length > 0 && (
          <div className="text-xs text-green-400/80 flex items-center gap-1">
            <Users size={12} />
            Friends here: {world.friendsHere.join(', ')}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => handleTravel(world.id)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-cyan-600/80 hover:bg-cyan-500 text-white text-sm font-medium transition-colors"
          >
            <ArrowRight size={14} /> Travel
          </button>
          <button
            onClick={() => toggleBookmark(world.id)}
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 transition-colors"
          >
            {bookmarkedIds.has(world.id) ? <BookmarkCheck size={16} className="text-yellow-400" /> : <Bookmark size={16} />}
          </button>
        </div>
      </div>
    );
  };

  /* ── Departure Board Row ───────────────────────────────────── */
  const renderWorldRow = (world: WorldEntry) => {
    const mode = MODE_META[world.mode];
    const status = STATUS_META[world.status];
    return (
      <button
        key={world.id}
        onClick={() => setSelectedWorld(world)}
        className="w-full grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
      >
        <div className="min-w-0">
          <span className="text-sm text-white font-medium truncate block">{world.name}</span>
          <span className="text-[10px] text-white/40">by {world.owner}</span>
        </div>
        <span className="text-xs text-white/50 flex items-center gap-1">
          <Users size={10} /> {world.playerCount}
        </span>
        <span className={`text-xs flex items-center gap-1 ${mode.color}`}>
          {React.createElement(mode.icon, { className: 'w-3 h-3' })}
          <span className="hidden sm:inline">{mode.label}</span>
        </span>
        <span className={`text-xs flex items-center gap-1 ${status.color}`}>
          {React.createElement(status.icon, { className: 'w-3 h-3' })}
          <span className="hidden sm:inline">{status.label}</span>
        </span>
        {bookmarkedIds.has(world.id) && <Star size={12} className="text-yellow-400 fill-yellow-400" />}
      </button>
    );
  };

  /* ── Main Render ─────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-3 w-full max-w-lg">
      {/* Header */}
      <div className={`${panel} px-4 py-3 flex items-center gap-3`}>
        <Train size={20} className="text-cyan-400" />
        <div>
          <h2 className="text-white font-semibold text-sm">World Terminal</h2>
          <p className="text-[10px] text-white/40">Travel between worlds</p>
        </div>
        <button
          onClick={() => handleTravel('concordia')}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
        >
          <Home size={12} /> Return to Concordia
        </button>
      </div>

      {/* Invites */}
      {invites.length > 0 && (
        <div className="flex flex-col gap-2">
          {invites.map(inv => (
            <div key={inv.id} className={`${panel} px-3 py-2.5 flex items-center gap-3`}>
              <Sparkles size={14} className="text-yellow-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/80">
                  <span className="font-medium text-white">@{inv.fromUser}</span> invited you to <span className="font-medium text-cyan-400">{inv.worldName}</span>
                </p>
                <span className="text-[10px] text-white/30">{inv.timestamp}</span>
              </div>
              <button onClick={() => onAcceptInvite?.(inv.id)} className="px-2.5 py-1 rounded bg-green-600/80 hover:bg-green-500 text-white text-xs font-medium transition-colors">
                Accept
              </button>
              <button onClick={() => onDeclineInvite?.(inv.id)} className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white/60 text-xs transition-colors">
                Decline
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className={`${panel} p-1 flex gap-1`}>
        {(['departures', 'bookmarks', 'recent'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === t ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            {t === 'departures' ? 'Departures' : t === 'bookmarks' ? 'Bookmarks' : 'Recent'}
          </button>
        ))}
      </div>

      {/* Search & Sort (departures only) */}
      {activeTab === 'departures' && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search worlds..."
              className="w-full bg-black/60 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setSortDropdown(!sortDropdown)}
              className={`${panel} px-3 py-2 flex items-center gap-1.5 text-xs text-white/60 hover:text-white/80 transition-colors`}
            >
              <Filter size={12} />
              {SORT_LABELS[sort]}
              <ChevronDown size={12} />
            </button>
            {sortDropdown && (
              <div className={`${panel} absolute right-0 top-full mt-1 z-20 py-1 w-44`}>
                {(Object.keys(SORT_LABELS) as SortOption[]).map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setSort(opt); setSortDropdown(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors ${
                      sort === opt ? 'text-cyan-400' : 'text-white/60'
                    }`}
                  >
                    {SORT_LABELS[opt]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Departure board header */}
      {activeTab === 'departures' && (
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-3 py-1.5 text-[10px] text-white/30 uppercase tracking-wider">
          <span>World</span>
          <span>Players</span>
          <span>Mode</span>
          <span>Status</span>
          <span />
        </div>
      )}

      {/* World list */}
      <div className={`${panel} divide-y divide-white/5 max-h-96 overflow-y-auto`}>
        {activeTab === 'departures' && (
          worldsLoading
            ? <p className="text-center text-white/30 text-xs py-6">Loading worlds…</p>
            : filtered.length === 0
              ? <p className="text-center text-white/30 text-xs py-6">No worlds found</p>
              : filtered.map(renderWorldRow)
        )}
        {activeTab === 'bookmarks' && (
          worlds.filter(w => bookmarkedIds.has(w.id)).length === 0
            ? <p className="text-center text-white/30 text-xs py-6">No bookmarked worlds</p>
            : worlds.filter(w => bookmarkedIds.has(w.id)).map(renderWorldRow)
        )}
        {activeTab === 'recent' && (
          recentWorlds.length === 0
            ? <p className="text-center text-white/30 text-xs py-6">No recent worlds</p>
            : recentWorlds.slice(0, 5).map(renderWorldRow)
        )}
      </div>

      {/* Selected world overlay */}
      {selectedWorld && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setSelectedWorld(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            {renderWorldPreview(selectedWorld)}
          </div>
        </div>
      )}
    </div>
  );
}
