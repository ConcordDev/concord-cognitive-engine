'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Heart, Coins, Star, Swords, Shield, MapPin,
  ChevronDown, ChevronUp, Trophy, Target, LogIn, Compass, Map,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ──────────────────────────── Types ──────────────────────────────

interface Quest {
  id: string;
  title: string;
  description: string;
  progress: number;
  maxProgress: number;
  completed: boolean;
  reward?: { type: string; amount: number };
}

interface CombatState {
  active: boolean;
  playerHp: number;
  playerMaxHp: number;
  enemyName: string;
  enemyHp: number;
  enemyMaxHp: number;
}

interface WorldHUDProps {
  activeDistrict: { id: string; name: string; lens: string } | null;
  quests: Quest[];
  combatState: CombatState | null;
  wantedLevel: number;
  playerStats: { hp: number; maxHp: number; coins: number; xp: number; rank: number };
  onNavigateToLens: (lens: string) => void;
  onQuestClick: (questId: string) => void;
  onCombatAction: (action: 'attack' | 'defend' | 'flee') => void;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  districtEntryBanner: string | null;
}

// ──────────────────────────── Helpers ────────────────────────────

const panel = 'bg-black/70 backdrop-blur-sm border border-white/10 rounded-lg';

function hpColor(pct: number): string {
  if (pct > 0.6) return 'from-green-500 to-green-400';
  if (pct > 0.3) return 'from-yellow-500 to-yellow-400';
  return 'from-red-600 to-red-400';
}

function HPBar({ current, max, className }: { current: number; max: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, current / max));
  return (
    <div className={cn('h-2.5 w-full rounded-full bg-white/10 overflow-hidden', className)}>
      <div
        className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-300', hpColor(pct))}
        style={{ width: `${pct * 100}%` }}
      />
    </div>
  );
}

// ──────────────────────────── Sub-components ─────────────────────

/** TOP-LEFT: Player stats */
function PlayerStats({ stats }: { stats: WorldHUDProps['playerStats'] }) {
  return (
    <div className={cn(panel, 'absolute top-4 left-4 p-3 min-w-[220px] select-none')}>
      {/* HP row */}
      <div className="flex items-center gap-2 mb-1.5">
        <Heart className="w-4 h-4 text-red-400 fill-red-400 shrink-0" />
        <HPBar current={stats.hp} max={stats.maxHp} className="flex-1" />
        <span className="text-xs text-white tabular-nums">
          {stats.hp}/{stats.maxHp}
        </span>
      </div>
      {/* Coins + Rank row */}
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-yellow-300">
          <Coins className="w-3.5 h-3.5" />
          {stats.coins.toLocaleString()}
        </span>
        <span className="flex items-center gap-1 text-gray-400">
          <Trophy className="w-3.5 h-3.5 text-amber-400" />
          Rank {stats.rank}
        </span>
        <span className="text-gray-400 tabular-nums">
          XP: {stats.xp.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

/** TOP-RIGHT: Quest tracker */
function QuestTracker({
  quests,
  onQuestClick,
}: {
  quests: Quest[];
  onQuestClick: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const active = quests.filter((q) => !q.completed);

  return (
    <div className={cn(panel, 'absolute top-4 right-4 w-64 select-none')}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-white"
      >
        <span className="flex items-center gap-1.5">
          <Target className="w-4 h-4 text-cyan-400" />
          Active Quests
        </span>
        {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {active.length === 0 && (
            <p className="text-xs text-gray-500 italic">No active quests</p>
          )}
          {active.slice(0, 4).map((q) => {
            const pct = q.maxProgress > 0 ? q.progress / q.maxProgress : 0;
            return (
              <button
                key={q.id}
                onClick={() => onQuestClick(q.id)}
                className="w-full text-left group"
              >
                <p className="text-xs text-white group-hover:text-cyan-300 transition-colors truncate">
                  {q.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-cyan-500 transition-all duration-300"
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                    {q.progress}/{q.maxProgress}
                  </span>
                </div>
              </button>
            );
          })}
          {active.length > 4 && (
            <p className="text-[10px] text-gray-500 text-center">
              +{active.length - 4} more quests
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** TOP-CENTER: District entry banner */
function DistrictBanner({ name }: { name: string | null }) {
  const [visible, setVisible] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (name) {
      setDisplayName(name);
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [name]);

  if (!displayName) return null;

  return (
    <div
      className={cn(
        'absolute top-20 left-1/2 -translate-x-1/2 z-10 transition-all duration-500 select-none pointer-events-none',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4',
      )}
      onTransitionEnd={() => {
        if (!visible) setDisplayName(null);
      }}
    >
      <div className={cn(panel, 'px-8 py-3 text-center')}>
        <p className="text-lg font-bold text-white tracking-wide flex items-center gap-2 justify-center">
          <MapPin className="w-5 h-5 text-cyan-400" />
          {displayName.toUpperCase()}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">Press E to enter</p>
      </div>
    </div>
  );
}

/** CENTER: Combat overlay */
function CombatOverlay({
  state,
  onAction,
}: {
  state: CombatState;
  onAction: (action: 'attack' | 'defend' | 'flee') => void;
}) {
  if (!state.active) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/40">
      <div className={cn(panel, 'w-80 p-5 select-none')}>
        <h3 className="text-center text-sm font-bold text-red-400 tracking-widest mb-4 flex items-center justify-center gap-2">
          <Swords className="w-5 h-5" />
          COMBAT
        </h3>

        {/* Player HP */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-white mb-1">
            <span>You</span>
            <span className="tabular-nums">{state.playerHp}/{state.playerMaxHp}</span>
          </div>
          <HPBar current={state.playerHp} max={state.playerMaxHp} />
        </div>

        <p className="text-center text-[10px] text-gray-500 my-1">vs</p>

        {/* Enemy HP */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-white mb-1">
            <span>{state.enemyName}</span>
            <span className="tabular-nums">{state.enemyHp}/{state.enemyMaxHp}</span>
          </div>
          <HPBar current={state.enemyHp} max={state.enemyMaxHp} />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => onAction('attack')}
            className="flex-1 flex items-center justify-center gap-1 rounded-md border border-red-500/50 bg-red-500/20 hover:bg-red-500/40 text-red-300 text-xs py-2 transition-colors"
          >
            <Swords className="w-3.5 h-3.5" /> Attack
          </button>
          <button
            onClick={() => onAction('defend')}
            className="flex-1 flex items-center justify-center gap-1 rounded-md border border-blue-500/50 bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 text-xs py-2 transition-colors"
          >
            <Shield className="w-3.5 h-3.5" /> Defend
          </button>
          <button
            onClick={() => onAction('flee')}
            className="flex-1 flex items-center justify-center gap-1 rounded-md border border-white/20 bg-white/5 hover:bg-white/10 text-gray-300 text-xs py-2 transition-colors"
          >
            Flee
          </button>
        </div>
      </div>
    </div>
  );
}

/** Wanted level stars */
function WantedStars({ level }: { level: number }) {
  if (level <= 0) return null;

  return (
    <div className="absolute top-[4.5rem] right-4 select-none">
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            className={cn(
              'w-4 h-4 transition-colors',
              i < level
                ? 'text-yellow-400 fill-yellow-400'
                : 'text-gray-600 fill-gray-600/30',
              level >= 4 && i < level && 'animate-pulse',
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** BOTTOM-CENTER: District action bar */
function DistrictActionBar({
  district,
  onNavigateToLens,
}: {
  district: WorldHUDProps['activeDistrict'];
  onNavigateToLens: (lens: string) => void;
}) {
  if (!district) return null;

  return (
    <div className={cn(panel, 'absolute bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 select-none')}>
      <p className="text-sm font-medium text-white mb-2 flex items-center gap-1.5">
        <MapPin className="w-4 h-4 text-cyan-400" />
        {district.name}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onNavigateToLens(district.lens)}
          className="flex items-center gap-1 rounded-md border border-cyan-500/50 bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-300 text-xs px-3 py-1.5 transition-colors"
        >
          <LogIn className="w-3.5 h-3.5" /> Enter Lens
        </button>
        <button className="flex items-center gap-1 rounded-md border border-white/20 bg-white/5 hover:bg-white/10 text-gray-300 text-xs px-3 py-1.5 transition-colors">
          <Coins className="w-3.5 h-3.5" /> Trade
        </button>
        <button className="flex items-center gap-1 rounded-md border border-white/20 bg-white/5 hover:bg-white/10 text-gray-300 text-xs px-3 py-1.5 transition-colors">
          <Compass className="w-3.5 h-3.5" /> Explore
        </button>
      </div>
    </div>
  );
}

/** Minimap toggle button */
function MinimapToggle({
  show,
  onToggle,
}: {
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        panel,
        'absolute bottom-6 right-4 p-2 hover:bg-white/10 transition-colors',
      )}
      title={show ? 'Hide minimap' : 'Show minimap'}
    >
      <Map className={cn('w-5 h-5', show ? 'text-cyan-400' : 'text-gray-500')} />
    </button>
  );
}

// ──────────────────────────── Main Component ─────────────────────

export default function WorldHUD({
  activeDistrict,
  quests,
  combatState,
  wantedLevel,
  playerStats,
  onNavigateToLens,
  onQuestClick,
  onCombatAction,
  showMinimap,
  onToggleMinimap,
  districtEntryBanner,
}: WorldHUDProps) {
  return (
    <div className="absolute inset-0 pointer-events-none z-10" aria-label="World HUD">
      {/* All interactive children re-enable pointer events */}
      <div className="pointer-events-auto">
        <PlayerStats stats={playerStats} />
        <QuestTracker quests={quests} onQuestClick={onQuestClick} />
        <WantedStars level={wantedLevel} />
        <MinimapToggle show={showMinimap} onToggle={onToggleMinimap} />
      </div>

      {/* Banner (non-interactive) */}
      <DistrictBanner name={districtEntryBanner} />

      {/* Combat overlay */}
      {combatState?.active && (
        <div className="pointer-events-auto">
          <CombatOverlay state={combatState} onAction={onCombatAction} />
        </div>
      )}

      {/* District action bar */}
      {activeDistrict && (
        <div className="pointer-events-auto">
          <DistrictActionBar district={activeDistrict} onNavigateToLens={onNavigateToLens} />
        </div>
      )}

      {/* Mobile joystick mount */}
      <div
        id="joystick-mount"
        className="absolute bottom-6 left-4 w-20 h-20 md:hidden pointer-events-auto"
      />
    </div>
  );
}
