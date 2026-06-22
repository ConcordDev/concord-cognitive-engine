'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Heart, Shield, Zap, Swords, Target,
  ShieldAlert, ScrollText, Eye,
} from 'lucide-react';
import { PlayerDeathSequence } from '@/components/world/PlayerDeathSequence';

/* ── Types ─────────────────────────────────────────────────────── */

type CombatMode = 'pve' | 'pvp';

interface WeaponInfo {
  name: string;
  damage: number;
  speed: number;
  type: string;
}

interface TargetInfo {
  name: string;
  health: number;
  maxHealth: number;
  level: number;
  type: 'enemy' | 'player';
}

interface DamageNumber {
  id: string;
  amount: number;
  isCrit: boolean;
  timestamp: number;
}

interface CombatLogEntry {
  id: string;
  message: string;
  type: 'damage-dealt' | 'damage-taken' | 'block' | 'heal' | 'death' | 'info';
  timestamp: string;
}

interface CombatState {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  armor: number;
  weapon: WeaponInfo | null;
  target: TargetInfo | null;
  coverBonus: number;
  isDead: boolean;
  damageNumbers: DamageNumber[];
  combatLog: CombatLogEntry[];
  damageFlash: boolean;
}

interface CombatSystemProps {
  combatState?: CombatState;
  onAttack?: () => void;
  onBlock?: () => void;
  onUseItem?: () => void;
  combatMode?: CombatMode;
  onRespawn?: () => void;
  onClose?: () => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const LOG_TYPE_COLORS: Record<CombatLogEntry['type'], string> = {
  'damage-dealt': 'text-orange-400',
  'damage-taken': 'text-red-400',
  block:          'text-blue-400',
  heal:           'text-green-400',
  death:          'text-red-500',
  info:           'text-gray-400',
};

// Neutral idle state — this HUD is prop-driven by the live world-lens combat
// path (combat:impact / combat:hit socket events feed the parent, which passes
// a real CombatState down). When no live combat is in progress we render a
// blank/idle HUD rather than fabricated HP/target/log values.
const IDLE_STATE: CombatState = {
  health: 0,
  maxHealth: 0,
  stamina: 0,
  maxStamina: 0,
  armor: 0,
  weapon: null,
  target: null,
  coverBonus: 0,
  isDead: false,
  damageNumbers: [],
  combatLog: [],
  damageFlash: false,
};

/* ── Sub-components ────────────────────────────────────────────── */

function HealthBar({ current, max, label, color, icon: Icon }: {
  current: number;
  max: number;
  label: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Icon className={`w-3 h-3 ${color}`} />
          <span className="text-[10px] text-gray-400">{label}</span>
        </div>
        <span className="text-[10px] text-gray-400">{current}/{max}</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            color === 'text-red-400' ? 'bg-red-500/70' :
            color === 'text-yellow-400' ? 'bg-yellow-500/70' :
            'bg-green-500/70'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────── */

export default function CombatSystem({
  combatState = IDLE_STATE,
  onAttack,
  onBlock,
  onUseItem,
  combatMode = 'pve',
  onRespawn,
}: CombatSystemProps) {
  const [state, setState] = useState(combatState);
  const [floatingDmg, setFloatingDmg] = useState<DamageNumber[]>([]);
  const dmgIdRef = useRef(0);

  // Sync from props
  useEffect(() => {
    setState(combatState);
  }, [combatState]);

  // Clean up floating damage numbers
  useEffect(() => {
    if (floatingDmg.length === 0) return;
    const timer = setTimeout(() => {
      setFloatingDmg((prev) => prev.filter((d) => Date.now() - d.timestamp < 1500));
    }, 1600);
    return () => clearTimeout(timer);
  }, [floatingDmg]);

  const simulateHit = useCallback(() => {
    const dmg = Math.floor(Math.random() * 15) + 5;
    const isCrit = Math.random() > 0.8;
    const finalDmg = isCrit ? dmg * 2 : dmg;
    dmgIdRef.current++;
    setFloatingDmg((prev) => [
      ...prev,
      { id: `dmg-${dmgIdRef.current}`, amount: finalDmg, isCrit, timestamp: Date.now() },
    ]);
    onAttack?.();
  }, [onAttack]);

  const healthFrac = state.maxHealth > 0 ? state.health / state.maxHealth : 0;
  const healthColor = healthFrac > 0.5
    ? 'text-green-400'
    : healthFrac > 0.25
    ? 'text-yellow-400'
    : 'text-red-400';

  // Death overlay — cinematic fade-to-black sequence (Phase 7).
  if (state.isDead) {
    return <PlayerDeathSequence onRespawn={onRespawn ?? (() => {})} />;
  }

  return (
    <>
      {/* Damage flash overlay */}
      {state.damageFlash && (
        <div className="fixed inset-0 z-40 pointer-events-none bg-red-500/15 animate-pulse" />
      )}

      {/* Main HUD — top-left */}
      <div className={`fixed top-4 left-4 z-30 w-64 ${panel} p-3 space-y-2`}>
        {/* Mode indicator */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Swords className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-400">
              Combat — {combatMode.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Health */}
        <HealthBar current={state.health} max={state.maxHealth} label="Health" color={healthColor} icon={Heart} />

        {/* Stamina */}
        <HealthBar current={state.stamina} max={state.maxStamina} label="Stamina" color="text-yellow-400" icon={Zap} />

        {/* Armor + Cover */}
        <div className="flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-1 text-gray-400">
            <Shield className="w-3 h-3 text-blue-400" />
            Armor: <span className="text-blue-400">{state.armor}</span>
          </div>
          {state.coverBonus > 0 && (
            <div className="flex items-center gap-1 text-gray-400">
              <ShieldAlert className="w-3 h-3 text-green-400" />
              Cover: <span className="text-green-400">+{state.coverBonus}</span>
            </div>
          )}
        </div>

        {/* Weapon */}
        {state.weapon && (
          <div className="flex items-center gap-2 p-1.5 rounded bg-white/5 border border-white/5">
            <Swords className="w-3.5 h-3.5 text-orange-400" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-white truncate">{state.weapon.name}</p>
              <p className="text-[9px] text-gray-400">
                DMG {state.weapon.damage} &middot; SPD {state.weapon.speed} &middot; {state.weapon.type}
              </p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5">
          <button
            onClick={simulateHit}
            className="flex-1 py-1.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
          >
            Attack
          </button>
          <button
            onClick={onBlock}
            className="flex-1 py-1.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
          >
            Block
          </button>
          <button
            onClick={onUseItem}
            className="flex-1 py-1.5 rounded text-[10px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors"
          >
            Item
          </button>
        </div>
      </div>

      {/* Target panel — top-right */}
      {state.target && (
        <div className={`fixed top-4 right-4 z-30 w-56 ${panel} p-3`}>
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3.5 h-3.5 text-red-400" />
            <span className="text-xs font-semibold text-white">{state.target.name}</span>
            <span className="text-[9px] text-gray-400 ml-auto">Lv{state.target.level}</span>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[10px] text-gray-400">
              <span>HP</span>
              <span>{state.target.health}/{state.target.maxHealth}</span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-red-500/70 transition-all duration-300"
                style={{ width: `${(state.target.health / state.target.maxHealth) * 100}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-1 mt-1.5">
            <Eye className="w-3 h-3 text-gray-600" />
            <span className="text-[9px] text-gray-400 uppercase">
              {state.target.type === 'enemy' ? 'Hostile' : 'Player'}
            </span>
          </div>
        </div>
      )}

      {/* Floating damage numbers */}
      <div className="fixed inset-0 z-40 pointer-events-none overflow-hidden">
        {floatingDmg.map((d) => {
          const age = Date.now() - d.timestamp;
          const opacity = Math.max(0, 1 - age / 1500);
          const yOffset = Math.min(80, age / 10);
          return (
            <div
              key={d.id}
              className={`absolute left-1/2 top-1/3 text-sm font-bold ${
                d.isCrit ? 'text-yellow-400 text-base' : 'text-red-400'
              }`}
              style={{
                transform: `translate(-50%, -${yOffset}px)`,
                opacity,
              }}
            >
              {d.isCrit && '!! '}
              -{d.amount}
            </div>
          );
        })}
      </div>

      {/* Combat log — bottom-left */}
      <div className={`fixed bottom-4 left-4 z-30 w-72 ${panel} overflow-hidden`}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
          <ScrollText className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Combat Log</span>
        </div>
        <div className="max-h-36 overflow-y-auto px-3 py-1.5 space-y-0.5">
          {state.combatLog.length === 0 && (
            <p className="text-[10px] text-gray-600 italic py-1">No combat activity.</p>
          )}
          {state.combatLog.map((entry) => (
            <div key={entry.id} className="flex gap-2 text-[10px]">
              <span className="text-gray-600 shrink-0">{entry.timestamp}</span>
              <span className={LOG_TYPE_COLORS[entry.type]}>{entry.message}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
