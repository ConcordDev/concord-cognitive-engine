'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CombatState } from '@/hooks/useCombatState';
import { VATSTarget, BodyPart } from '@/lib/concordia/combat/vats';
import { cooldownProgress } from '@/lib/concordia/combat/hotbar';
import { useKeyboardInput } from '@/hooks/useKeyboardInput';

// ── Sub-components ───────────────────────────────────────────────────

function Bar({
  value, max, color, label,
}: { value: number; max: number; color: string; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex flex-col gap-0.5 min-w-[120px]">
      <div className="flex justify-between text-xs text-white/70 font-mono">
        <span>{label}</span>
        <span>{Math.round(value)}/{max}</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-100"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function HotbarSlot({
  skill, index, active, onActivate,
}: {
  skill: CombatState['hotbar']['slots'][number];
  index: number;
  active: boolean;
  onActivate: () => void;
}) {
  const cooldown = skill ? cooldownProgress(skill) : 1;
  const onCD = skill ? cooldown < 1 : false;

  return (
    <button
      onClick={onActivate}
      className={`relative w-12 h-12 rounded border text-white/90 text-xs font-bold
        flex flex-col items-center justify-center gap-0.5
        ${active ? 'border-yellow-400 bg-yellow-400/20' : 'border-white/20 bg-black/60'}
        ${onCD ? 'opacity-50' : 'hover:border-white/50'}
        transition-all`}
    >
      <span className="text-[10px] text-white/40 absolute top-0.5 left-1">{index + 1}</span>
      {skill ? (
        <>
          <span className="truncate w-10 text-center">{skill.name.slice(0, 6)}</span>
          {onCD && (
            <div
              className="absolute inset-0 bg-black/50 rounded"
              style={{ clipPath: `inset(${Math.round((1 - cooldown) * 100)}% 0 0 0)` }}
            />
          )}
        </>
      ) : (
        <span className="text-white/20">—</span>
      )}
    </button>
  );
}

function TargetIndicator({
  target,
  comboCount = 0,
}: {
  target: NonNullable<CombatState['target']>;
  comboCount?: number;
}) {
  const targetPct = (target.health / target.maxHealth) * 100;
  // Lerped display health — drains smoothly instead of snapping
  const displayPctRef = useRef(targetPct);
  const [displayPct, setDisplayPct] = useState(targetPct);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const animate = () => {
      const diff = targetPct - displayPctRef.current;
      if (Math.abs(diff) < 0.2) {
        displayPctRef.current = targetPct;
        setDisplayPct(targetPct);
        return;
      }
      // Ease-out: move 18% of remaining gap per frame (~60fps)
      displayPctRef.current += diff * 0.18;
      setDisplayPct(displayPctRef.current);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [targetPct]);

  const color = displayPct > 60 ? '#22c55e' : displayPct > 30 ? '#eab308' : '#ef4444';
  const typeLabel = target.type === 'player' ? 'Player' : 'Enemy';

  return (
    <div className="bg-black/80 border border-white/10 rounded-lg px-3 py-2 min-w-[200px]">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-white text-sm font-semibold">{target.name}</span>
          <span className="text-[10px] text-white/30 font-mono">Lv{target.level}</span>
          <span className="text-[9px] text-white/20">{typeLabel}</span>
        </div>
        {/* Combo counter — only shows when player is on a streak */}
        {comboCount >= 2 && (
          <div
            className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{
              color: comboCount >= 5 ? '#facc15' : '#f97316',
              textShadow: comboCount >= 5 ? '0 0 8px rgba(250,204,21,0.8)' : '0 0 6px rgba(249,115,22,0.7)',
              transform: `scale(${1 + Math.min(comboCount * 0.04, 0.3)})`,
              transition: 'transform 120ms ease-out',
            }}
          >
            {comboCount}×
          </div>
        )}
      </div>
      {/* Health bar — lerped drain */}
      <div className="h-2.5 bg-white/10 rounded-full overflow-hidden relative">
        <div
          className="h-full rounded-full"
          style={{ width: `${displayPct}%`, backgroundColor: color, transition: 'background-color 300ms' }}
        />
        {/* Damage ghost — shows where health was before drain */}
        <div
          className="absolute top-0 h-full rounded-full bg-red-400/30"
          style={{ width: `${Math.max(displayPct, targetPct + 0.1)}%`, transition: 'width 600ms ease-out' }}
        />
      </div>
      <div className="text-right text-xs text-white/40 mt-0.5 font-mono">
        {Math.round(target.health)}/{target.maxHealth}
      </div>
    </div>
  );
}

function VATSOverlay({
  targets, apCurrent, apMax, onSelectPart, onExit,
}: {
  targets: VATSTarget[];
  apCurrent: number;
  apMax: number;
  onSelectPart: (targetId: string, part: BodyPart, apCost: number) => void;
  onExit: () => void;
}) {
  return (
    <div className="absolute inset-0 bg-green-900/40 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-black/90 border border-green-400/60 rounded-xl p-6 min-w-[340px] text-green-300 font-mono">
        <div className="flex justify-between items-center mb-4">
          <span className="text-lg font-bold text-green-400">V.A.T.S.</span>
          <span className="text-sm">AP: {Math.round(apCurrent)}/{apMax}</span>
        </div>
        {targets.map(t => (
          <div key={t.entityId} className="mb-4">
            <div className="text-sm font-semibold mb-2">{t.entityName} ({Math.round(t.distance)}m)</div>
            <div className="grid grid-cols-2 gap-1">
              {t.bodyParts.map(bp => (
                <button
                  key={bp.part}
                  onClick={() => onSelectPart(t.entityId, bp.part, bp.apCost)}
                  disabled={apCurrent < bp.apCost}
                  className="flex justify-between items-center px-2 py-1 rounded border border-green-400/30
                    hover:bg-green-400/10 disabled:opacity-40 text-xs text-left"
                >
                  <span className="capitalize">{bp.part.replace('_', ' ')}</span>
                  <span className="text-green-400">{bp.hitChance}%</span>
                  <span className="text-green-600">{bp.apCost}AP</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <button onClick={onExit} className="mt-2 w-full text-sm text-green-400/60 hover:text-green-400">
          Exit VATS [V]
        </button>
      </div>
    </div>
  );
}

// ── Main HUD ─────────────────────────────────────────────────────────

// Limb tissue HP + armor integrity per zone
export interface LimbState {
  head:       number; // 0–100 tissue HP
  torso:      number;
  left_arm:   number;
  right_arm:  number;
  left_leg:   number;
  right_leg:  number;
}

export interface LimbArmorState {
  head:       number; // 0–100 armor integrity
  torso:      number;
  left_arm:   number;
  right_arm:  number;
  left_leg:   number;
  right_leg:  number;
}

interface CombatHUDProps {
  state: CombatState;
  vatsTargets?: VATSTarget[];
  comboCount?: number;
  staggered?: boolean;
  limbState?: LimbState;
  limbArmorState?: LimbArmorState;
  onActivateSkill: (slot: number) => void;
  onDodge: () => void;
  onBlock: (held: boolean) => void;
  onToggleVATS: () => void;
  onQueueShot: (targetId: string, part: BodyPart, apCost: number) => void;
}

function LimbIndicator({ limbs, armor }: { limbs: LimbState; armor?: LimbArmorState }) {
  const parts: { key: keyof LimbState; label: string; row: number; col: number }[] = [
    { key: 'head',      label: 'HD',  row: 0, col: 1 },
    { key: 'torso',     label: 'TR',  row: 1, col: 1 },
    { key: 'left_arm',  label: 'LA',  row: 1, col: 0 },
    { key: 'right_arm', label: 'RA',  row: 1, col: 2 },
    { key: 'left_leg',  label: 'LL',  row: 2, col: 0 },
    { key: 'right_leg', label: 'RL',  row: 2, col: 2 },
  ];
  const tissueColor = (hp: number) =>
    hp > 66 ? '#22c55e' : hp > 33 ? '#eab308' : '#ef4444';
  const armorColor = (pct: number) =>
    pct > 67 ? '#60a5fa' : pct > 33 ? '#f59e0b' : '#ef4444';
  const armorLabel = (pct: number) =>
    pct <= 0 ? '✕' : pct <= 33 ? '▣' : pct <= 67 ? '▤' : '▦';

  // Only render zones that have taken any damage (tissue OR armor degraded)
  const damaged = parts.filter(p => limbs[p.key] < 100 || (armor && armor[p.key] < 100));
  if (damaged.length === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-0.5 w-24">
      {parts.map(p => {
        const hp = limbs[p.key];
        const armorPct = armor?.[p.key] ?? 100;
        const isVisible = hp < 100 || armorPct < 100;
        if (!isVisible) return <div key={p.key} style={{ gridRow: p.row + 1, gridColumn: p.col + 1 }} />;

        const zoneName = p.key.replace(/_/g, ' ');
        const armorStatus = armorPct <= 0 ? 'destroyed' : armorPct <= 33 ? 'cracked' : armorPct <= 67 ? 'damaged' : 'intact';
        return (
          <div
            key={p.key}
            title={`${zoneName} — tissue: ${Math.round(hp)}%  armor: ${Math.round(armorPct)}% (${armorStatus})`}
            style={{ gridRow: p.row + 1, gridColumn: p.col + 1 }}
            className="flex flex-col items-center justify-center rounded-sm h-5 gap-0"
          >
            {/* Armor integrity glyph — top layer */}
            {armorPct < 100 && (
              <span
                className="text-[7px] leading-none"
                style={{ color: armorColor(armorPct), textShadow: `0 0 3px ${armorColor(armorPct)}` }}
              >
                {armorLabel(armorPct)}
              </span>
            )}
            {/* Tissue label */}
            <span
              className="text-[8px] font-mono font-bold leading-none"
              style={{ color: tissueColor(hp), textShadow: `0 0 4px ${tissueColor(hp)}` }}
            >
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function CombatHUD({
  state,
  vatsTargets = [],
  comboCount = 0,
  staggered = false,
  limbState,
  limbArmorState,
  onActivateSkill,
  onDodge,
  onBlock,
  onToggleVATS,
  onQueueShot,
}: CombatHUDProps) {
  // Hotbar keys 1–9 + combat bindings
  useKeyboardInput({
    Digit1: () => onActivateSkill(0),
    Digit2: () => onActivateSkill(1),
    Digit3: () => onActivateSkill(2),
    Digit4: () => onActivateSkill(3),
    Digit5: () => onActivateSkill(4),
    Digit6: () => onActivateSkill(5),
    Digit7: () => onActivateSkill(6),
    Digit8: () => onActivateSkill(7),
    Digit9: () => onActivateSkill(8),
    KeyQ: onDodge,
    ShiftLeft: { onDown: () => onBlock(true), onUp: () => onBlock(false) },
    KeyV: onToggleVATS,
  });

  return (
    <>
      {/* VATS overlay */}
      {state.vats.active && (
        <VATSOverlay
          targets={vatsTargets}
          apCurrent={state.vats.ap}
          apMax={state.vats.maxAp}
          onSelectPart={onQueueShot}
          onExit={onToggleVATS}
        />
      )}

      {/* Bottom-left: health + stamina + AP + stagger indicator + limb state */}
      <div className="absolute bottom-24 left-4 flex flex-col gap-2">
        <Bar value={state.health} max={state.maxHealth} color="#ef4444" label="HP" />
        <Bar
          value={state.stamina}
          max={state.maxStamina}
          color={state.stamina < 8 ? '#ef4444' : '#22c55e'}
          label="STA"
        />
        <Bar value={state.vats.ap} max={state.vats.maxAp} color="#22d3ee" label="AP" />
        {/* Stagger indicator */}
        {staggered && (
          <div className="text-xs font-bold text-amber-400 animate-pulse"
            style={{ textShadow: '0 0 6px rgba(251,191,36,0.8)' }}>
            ⚡ STAGGERED
          </div>
        )}
        {/* Limb damage body map — tissue HP + armor integrity */}
        {limbState && <LimbIndicator limbs={limbState} armor={limbArmorState} />}
      </div>

      {/* Top-center: target */}
      {state.target && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2">
          <TargetIndicator target={state.target} comboCount={comboCount} />
        </div>
      )}

      {/* Bottom-center: hotbar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1">
        {state.hotbar.slots.map((skill, i) => (
          <HotbarSlot
            key={i}
            skill={skill}
            index={i}
            active={state.hotbar.activeSlot === i}
            onActivate={() => onActivateSkill(i)}
          />
        ))}
      </div>

      {/* Bottom-right: combat log */}
      <div className="absolute bottom-24 right-4 w-48 flex flex-col gap-0.5 pointer-events-none">
        {state.log.slice(0, 6).map(entry => (
          <div
            key={entry.id}
            className={`text-xs font-mono px-2 py-0.5 rounded bg-black/50
              ${entry.type === 'hit'  ? 'text-yellow-300' : ''}
              ${entry.type === 'crit' ? 'text-orange-400 font-bold' : ''}
              ${entry.type === 'miss' ? 'text-white/40' : ''}
              ${entry.type === 'death' ? 'text-red-400' : ''}
              ${entry.type === 'dodge' ? 'text-cyan-300' : ''}
              ${entry.type === 'info' ? 'text-white/60' : ''}
            `}
          >
            {entry.text}
          </div>
        ))}
      </div>
    </>
  );
}
