'use client';

import React, { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Users, Eye, EyeOff, Shield, Lock, UserPlus, MessageSquare,
  User, Hammer, TrendingUp, Compass, Heart, GraduationCap,
  Monitor, Clock, ChevronDown, X, Search, Swords,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type ActivityStatus =
  | 'building'
  | 'trading'
  | 'exploring'
  | 'socializing'
  | 'mentoring'
  | 'spectating'
  | 'idle';

type VisibilityMode = 'public' | 'friends-only' | 'firm-only' | 'invite-only' | 'private';

interface Player {
  id: string;
  name: string;
  avatar?: string;
  /** Optional — live presence data does not carry a profession, so it is
   *  omitted rather than fabricated. Callers passing rich rosters may set it. */
  profession?: string;
  firmName?: string;
  firmEmblem?: string;
  activity: ActivityStatus;
  online: boolean;
  reputationSummary?: string;
  distance?: number;
}

interface PlayerPresenceProps {
  players?: Player[];
  friends?: Player[];
  firmMembers?: Player[];
  myVisibility?: VisibilityMode;
  instancePlayerCount?: number;
  /**
   * When set, the panel fetches live presence for this world from the
   * `presence.active-list` lens-action and renders real users in the Nearby
   * tab. Caller-supplied `players` (if any) take precedence and disable the
   * fetch. Omit to keep the panel purely prop-driven.
   */
  worldId?: string;
  onMessage?: (playerId: string) => void;
  onAddFriend?: (playerId: string) => void;
  onViewProfile?: (playerId: string) => void;
  onVisibilityChange?: (mode: VisibilityMode) => void;
  /**
   * Called when the player targets another player for PvP combat.
   * Passes the target's id + name so the world page can set its
   * combat target and start firing attacks.
   */
  onTargetPlayer?: (target: { id: string; name: string; type: 'player' }) => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const ACTIVITY_META: Record<ActivityStatus, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  building:    { label: 'Building',    icon: Hammer,         color: '#F59E0B' },
  trading:     { label: 'Trading',     icon: TrendingUp,     color: '#22C55E' },
  exploring:   { label: 'Exploring',   icon: Compass,        color: '#3B82F6' },
  socializing: { label: 'Socializing', icon: Heart,          color: '#EC4899' },
  mentoring:   { label: 'Mentoring',   icon: GraduationCap,  color: '#8B5CF6' },
  spectating:  { label: 'Spectating',  icon: Monitor,        color: '#06B6D4' },
  idle:        { label: 'Idle',        icon: Clock,          color: '#6B7280' },
};

const VISIBILITY_META: Record<VisibilityMode, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  public:        { label: 'Public',       icon: Eye },
  'friends-only': { label: 'Friends Only', icon: Users },
  'firm-only':   { label: 'Firm Only',    icon: Shield },
  'invite-only': { label: 'Invite Only',  icon: Lock },
  private:       { label: 'Private',      icon: EyeOff },
};

type ListTab = 'nearby' | 'friends' | 'firm';

/* ── Presence wiring ───────────────────────────────────────────── */
// Nearby players come from the `presence.active-list` lens-action (REAL data —
// users who have sent a heartbeat in this world within the window). The macro
// returns only fields it can honestly know: { userId, name?, avatar?, activity,
// online }. It carries NO profession/firm/reputation/distance, so those are
// omitted here rather than invented; the list still shows "No players found"
// until real heartbeats exist.

const PRESENCE_POLL_MS = 30_000;

interface PresenceRow {
  userId: string;
  name?: string;
  avatar?: string;
  activity?: ActivityStatus;
  online?: boolean;
}

function presenceRowToPlayer(row: PresenceRow): Player {
  const activity = ACTIVITY_META[row.activity as ActivityStatus] ? (row.activity as ActivityStatus) : 'idle';
  return {
    id: row.userId,
    name: row.name || row.userId,
    avatar: row.avatar,
    activity,
    online: row.online !== false,
    // profession / firmName / reputationSummary / distance intentionally omitted —
    // live presence does not provide them and we never fabricate.
  };
}

/* ── Component ─────────────────────────────────────────────────── */

export default function PlayerPresence({
  players = [],
  friends = [],
  firmMembers = [],
  myVisibility = 'public',
  instancePlayerCount = 0,
  worldId,
  onMessage,
  onAddFriend,
  onViewProfile,
  onVisibilityChange,
  onTargetPlayer,
}: PlayerPresenceProps) {
  const [tab, setTab] = useState<ListTab>('nearby');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [visibility, setVisibility] = useState<VisibilityMode>(myVisibility);
  const [visDropdown, setVisDropdown] = useState(false);
  const [search, setSearch] = useState('');
  // Live nearby roster fetched from presence.active-list (empty until heartbeats).
  const [livePlayers, setLivePlayers] = useState<Player[]>([]);

  // Caller-supplied players win for back-compat; otherwise poll live presence.
  const usePropPlayers = players.length > 0;

  useEffect(() => {
    if (usePropPlayers || !worldId) {
      setLivePlayers([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const r = await lensRun<{ players?: PresenceRow[] }>(
          'presence',
          'active-list',
          { worldId },
        );
        if (cancelled) return;
        const rows = Array.isArray(r.data?.result?.players) ? r.data!.result!.players! : [];
        setLivePlayers(rows.map(presenceRowToPlayer));
      } catch {
        if (!cancelled) setLivePlayers([]);
      }
    };
    load();
    const t = setInterval(load, PRESENCE_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [worldId, usePropPlayers]);

  const visInfo = VISIBILITY_META[visibility];

  const nearbyList = usePropPlayers ? players : livePlayers;

  const listMap: Record<ListTab, Player[]> = {
    nearby: nearbyList,
    friends,
    firm: firmMembers,
  };

  const filtered = listMap[tab].filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  // Presence rows carry no distance; treat undefined distance as "nearby" so
  // the live roster still reflects the count rather than reading 0.
  const nearbyCount = nearbyList.filter(p => (p.distance ?? 0) <= 15).length;

  const handleVisibility = (mode: VisibilityMode) => {
    setVisibility(mode);
    setVisDropdown(false);
    onVisibilityChange?.(mode);
  };

  /* ── Player Card Modal ───────────────────────────────────────── */
  const renderPlayerCard = (player: Player) => (
    <div className={`${panel} p-5 w-80 space-y-4`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-lg font-bold text-white/70">
            {player.name.charAt(0)}
          </div>
          <div>
            <h3 className="text-white font-semibold">{player.name}</h3>
            {player.profession && <span className="text-xs text-white/50">{player.profession}</span>}
          </div>
        </div>
        <button onClick={() => setSelectedPlayer(null)} className="text-white/40 hover:text-white" aria-label="Close"><X size={16} /></button>
      </div>

      {player.firmName && (
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Shield size={12} />
          <span>{player.firmName}</span>
        </div>
      )}

      {player.reputationSummary && (
        <p className="text-xs text-white/60 bg-white/5 rounded p-2">{player.reputationSummary}</p>
      )}

      <div className="flex items-center gap-2 text-xs" style={{ color: ACTIVITY_META[player.activity].color }}>
        {React.createElement(ACTIVITY_META[player.activity].icon, { className: 'w-3 h-3' })}
        <span>{ACTIVITY_META[player.activity].label}</span>
      </div>

      <div className="flex gap-2">
        <button onClick={() => onMessage?.(player.id)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-blue-600/80 hover:bg-blue-500 text-white text-xs font-medium transition-colors">
          <MessageSquare size={12} /> Message
        </button>
        <button onClick={() => onAddFriend?.(player.id)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors">
          <UserPlus size={12} /> Add Friend
        </button>
      </div>
      {onTargetPlayer && (
        <button
          onClick={() => {
            onTargetPlayer({ id: player.id, name: player.name, type: 'player' });
            setSelectedPlayer(null);
          }}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-red-600/80 hover:bg-red-500 text-white text-xs font-medium transition-colors"
        >
          <Swords size={12} /> Target for Combat
        </button>
      )}
      <button onClick={() => onViewProfile?.(player.id)} className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70 text-xs transition-colors">
        <User size={12} /> View Profile
      </button>
    </div>
  );

  /* ── Main Render ─────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-3 w-full max-w-md">
      {/* Nearby indicator */}
      <div className={`${panel} px-3 py-2 flex items-center justify-between`}>
        <div className="flex items-center gap-2 text-white/70 text-sm">
          <Users size={14} className="text-cyan-400" />
          <span>{instancePlayerCount} players in this instance</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-white/50 bg-white/5 px-2 py-1 rounded-full">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          {nearbyCount} nearby
        </div>
      </div>

      {/* Visibility toggle */}
      <div className={`${panel} px-3 py-2 relative`}>
        <button
          onClick={() => setVisDropdown(!visDropdown)}
          className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors w-full"
        >
          {React.createElement(visInfo.icon, { className: 'w-4 h-4' })}
          <span>Visibility: <span className="text-white font-medium">{visInfo.label}</span></span>
          <ChevronDown size={14} className="ml-auto" />
        </button>
        {visDropdown && (
          <div className={`${panel} absolute left-0 right-0 top-full mt-1 z-20 py-1`}>
            {(Object.keys(VISIBILITY_META) as VisibilityMode[]).map(mode => {
              const meta = VISIBILITY_META[mode];
              return (
                <button
                  key={mode}
                  onClick={() => handleVisibility(mode)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/10 transition-colors ${
                    mode === visibility ? 'text-cyan-400' : 'text-white/60'
                  }`}
                >
                  {React.createElement(meta.icon, { className: 'w-4 h-4' })}
                  {meta.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className={`${panel} p-1 flex gap-1`}>
        {(['nearby', 'friends', 'firm'] as ListTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              tab === t ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            {t === 'nearby' ? 'Nearby' : t === 'friends' ? 'Friends' : 'Firm'}
            <span className="ml-1 text-white/30">({listMap[t].length})</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search players..."
          className="w-full bg-black/60 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
        />
      </div>

      {/* Player list */}
      <div className={`${panel} divide-y divide-white/5 max-h-96 overflow-y-auto`}>
        {filtered.length === 0 && (
          <p className="text-center text-white/30 text-xs py-6">No players found</p>
        )}
        {filtered.map(player => {
          const act = ACTIVITY_META[player.activity];
          return (
            <button
              key={player.id}
              onClick={() => setSelectedPlayer(player)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-white/60">
                  {player.name.charAt(0)}
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-black ${
                    player.online ? 'bg-green-400' : 'bg-gray-500'
                  }`}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium truncate">{player.name}</span>
                  {player.profession && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 shrink-0">{player.profession}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {player.firmName && (
                    <span className="text-[10px] text-white/40 flex items-center gap-1">
                      <Shield size={9} /> {player.firmName}
                    </span>
                  )}
                </div>
              </div>

              {/* Activity indicator */}
              <div className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: act.color }}>
                {React.createElement(act.icon, { className: 'w-3 h-3' })}
                <span>{act.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected player card overlay */}
      {selectedPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setSelectedPlayer(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            {renderPlayerCard(selectedPlayer)}
          </div>
        </div>
      )}
    </div>
  );
}
