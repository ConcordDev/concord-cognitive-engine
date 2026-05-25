'use client';

import React, { useState, useEffect } from 'react';
import {
  MapPin, Loader2, Building2, Users, Zap, Cloud, Network,
  Sparkles, ScrollText,
} from 'lucide-react';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

// ── Types ──────────────────────────────────────────────────────────

export type TransitionType =
  | 'district'
  | 'portal'
  | 'fast-travel'
  | 'assembly'
  | 'seamless';

export type AssemblyPhase =
  | 'terrain'
  | 'infrastructure'
  | 'buildings'
  | 'npcs'
  | 'weather';

export interface DestinationInfo {
  name: string;
  description?: string;
  playerCount?: number;
  buildingCount?: number;
  previewColor?: string; // fallback color for preview area
}

export interface DistrictStats {
  population: number;
  buildings: number;
  powerCapacity: number;
  environmentScore: number;
}

interface LoadingTransitionsProps {
  transition: TransitionType;
  destination: DestinationInfo;
  progress: number; // 0-1
  phase: AssemblyPhase;
  tip?: string;
  districtStats?: DistrictStats;
  minimized?: boolean;
}

// ── Tips ───────────────────────────────────────────────────────────

interface Tip { kind: 'lore' | 'gameplay'; text: string }

// Lore tips draw from the authored world (lore.json + factions.json) — the
// Founding Compact, the Purge, the Trade Wars, the Gate Crisis, etc. They're
// authored for the load screen specifically: shorter than the full lore
// entries, written to land on a player who hasn't read any of it yet.
const loreTips: string[] = [
  'The Founding Compact has held for seventy-five years. Some of it has been honored.',
  'The Wardens closed the investigation into the burning of the Scholars\' archive in four days.',
  'The locks on the Scholars\' vaults were opened from the outside. No one has answered for it yet.',
  '"Pre-Year 70 historical materials" appears on every Warden confiscation list. The category is undefined on purpose.',
  'The Shadow Network has leverage over the Wardens, the Scholars, and the Merchants — all three, at the same time.',
  'Cipher leaked enough to keep the wound open. Not enough to close anyone\'s door.',
  'The Trade Wars ended with a cartel that locked out independent merchants permanently.',
  'For eleven days during the Gate Crisis, no caravan moved. No one was ever told why.',
  'Lady Voss never reads the texts she orders confiscated. That is not a kindness.',
  'The east gate processes new arrivals like a ledger. Most of them don\'t notice they\'ve been logged.',
  'The Compact says no single power controls what Concordia knows. Four factions counts as one when they all agree.',
  'Captain Rael has never failed to follow an order. She has refused to give a few.',
  'The Lorekeeper line was forty-three names long before the Purge. Three of those names survived.',
  'Citation chains are public. Citation motives are not.',
  'The Academy district was built where the first archive stood. The new vaults are deeper.',
  'The Forge district keeps a cold furnace lit. Nobody remembers why; nobody puts it out.',
  'A merchant who refuses the Compact is asked to leave. A merchant who agrees but doesn\'t mean it is allowed to stay.',
];

const gameplayTips: string[] = [
  'Buildings cited by other creators earn passive royalties.',
  'Infrastructure must be validated before it becomes permanent.',
  'The Exchange is the busiest trading district in Concordia.',
  'Press I to inspect any building and view its citation tree.',
  'Higher environmental scores attract more NPC settlers.',
  'Combine materials from different creators for bonus synergies.',
  'Guard NPCs will patrol near validated structures automatically.',
  'Weather affects construction speed — plan around rain.',
  'Your reputation level unlocks advanced building materials.',
  'Districts with balanced infrastructure grow faster.',
  'Place waypoints with M to navigate efficiently.',
  'Validated structures resist disaster events better.',
  'Check the notification feed for overnight royalty summaries.',
];

// Combined pool — 70% lore, 30% gameplay. Lore tips appear weighted heavier
// because that's the polish goal: tell the player something about the world
// every time the loading screen is up.
const tips: Tip[] = [
  ...loreTips.flatMap((t) => [
    { kind: 'lore' as const, text: t },
    { kind: 'lore' as const, text: t }, // 2× weight ≈ 70% of pool
  ]),
  ...gameplayTips.map((t) => ({ kind: 'gameplay' as const, text: t })),
];

// ── Phase Config ──────────────────────────────────────────────────

const phaseConfig: Record<
  AssemblyPhase,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  terrain: { label: 'Loading Terrain', icon: MapPin, color: 'text-amber-400' },
  infrastructure: { label: 'Connecting Infrastructure', icon: Network, color: 'text-blue-400' },
  buildings: { label: 'Placing Buildings', icon: Building2, color: 'text-cyan-400' },
  npcs: { label: 'Spawning NPCs', icon: Users, color: 'text-green-400' },
  weather: { label: 'Initializing Weather', icon: Cloud, color: 'text-gray-400' },
};

const phaseOrder: AssemblyPhase[] = ['terrain', 'infrastructure', 'buildings', 'npcs', 'weather'];

// ── Animated Text ─────────────────────────────────────────────────

function AnimatedArrival({ name }: { name: string }) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-lg font-semibold text-white">
      Arriving at {name}
      <span className="text-gray-400">{dots}</span>
    </span>
  );
}

// ── Portal Archway ────────────────────────────────────────────────

function PortalArchway({ destination }: { destination: DestinationInfo }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      {/* Archway */}
      <div className="relative w-40 h-56 flex items-center justify-center">
        {/* Outer arch */}
        <div className="absolute inset-0 rounded-t-full border-2 border-purple-500/40" />
        {/* Inner glow */}
        <div className="absolute inset-2 rounded-t-full bg-gradient-to-b from-purple-500/20 to-cyan-500/10 animate-pulse" />
        {/* Shimmer rings */}
        <div className="absolute inset-4 rounded-t-full border border-purple-400/20 animate-spin" style={{ animationDuration: '8s' }} />
        <div className="absolute inset-6 rounded-t-full border border-cyan-400/20 animate-spin" style={{ animationDuration: '12s', animationDirection: 'reverse' }} />
        {/* Center content */}
        <div className="relative text-center z-10">
          <Sparkles className="w-6 h-6 text-purple-400 mx-auto mb-2 animate-pulse" />
          <span className="text-sm text-purple-300 font-medium">{destination.name}</span>
        </div>
      </div>
    </div>
  );
}

// ── Fast Travel Path ──────────────────────────────────────────────

function FastTravelMap({ progress }: { progress: number }) {
  const pathLength = 200;
  const dashOffset = pathLength * (1 - progress);

  return (
    <div className={`${panel} w-48 h-48 flex items-center justify-center`}>
      <svg width="160" height="120" viewBox="0 0 160 120">
        {/* Background path */}
        <path
          d="M 20 100 Q 50 20, 80 60 T 140 20"
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
        {/* Animated path */}
        <path
          d="M 20 100 Q 50 20, 80 60 T 140 20"
          fill="none"
          stroke="#22D3EE"
          strokeWidth="2"
          strokeDasharray={pathLength}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
        {/* Start dot */}
        <circle cx="20" cy="100" r="4" fill="#60A5FA" />
        {/* End dot */}
        <circle cx="140" cy="20" r="4" fill="#22D3EE" opacity={progress > 0.9 ? 1 : 0.3} />
        {/* Moving dot */}
        <circle
          cx={20 + progress * 120}
          cy={100 - progress * 80}
          r="3"
          fill="#FFFFFF"
          className="drop-shadow-lg"
        />
      </svg>
    </div>
  );
}

// ── Assembly Phases ───────────────────────────────────────────────

function AssemblyProgress({ phase, progress }: { phase: AssemblyPhase; progress: number }) {
  const currentIdx = phaseOrder.indexOf(phase);

  return (
    <div className="w-full max-w-sm space-y-3">
      {phaseOrder.map((p, i) => {
        const cfg = phaseConfig[p];
        const Icon = cfg.icon;
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;
        const _isFuture = i > currentIdx;
        const phaseProgress = isDone ? 1 : isActive ? progress : 0;

        return (
          <div key={p} className="flex items-center gap-3">
            <div
              className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 ${
                isDone
                  ? 'bg-green-500/20'
                  : isActive
                  ? 'bg-white/10'
                  : 'bg-white/5'
              }`}
            >
              <Icon
                className={`w-4 h-4 ${
                  isDone ? 'text-green-400' : isActive ? cfg.color : 'text-gray-700'
                } ${isActive ? 'animate-pulse' : ''}`}
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-0.5">
                <span
                  className={`text-[11px] ${
                    isDone
                      ? 'text-green-400'
                      : isActive
                      ? 'text-white'
                      : 'text-gray-600'
                  }`}
                >
                  {cfg.label}
                </span>
                {isActive && (
                  <span className="text-[9px] text-gray-400">
                    {Math.round(phaseProgress * 100)}%
                  </span>
                )}
                {isDone && (
                  <span className="text-[9px] text-green-500">Done</span>
                )}
              </div>
              <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isDone
                      ? 'bg-green-400'
                      : isActive
                      ? 'bg-cyan-400'
                      : 'bg-transparent'
                  }`}
                  style={{ width: `${phaseProgress * 100}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────

export default function LoadingTransitions({
  transition,
  destination,
  progress,
  phase,
  tip: externalTip,
  districtStats,
  minimized = false,
}: LoadingTransitionsProps) {
  const [currentTipIdx, setCurrentTipIdx] = useState(
    () => Math.floor(Math.random() * tips.length),
  );

  // Rotate tips every 4 seconds (polish-pass cadence)
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTipIdx((prev) => (prev + 1) % tips.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const currentTip = tips[currentTipIdx];
  const displayTip = externalTip || currentTip.text;
  const displayKind: Tip['kind'] = externalTip ? 'gameplay' : currentTip.kind;

  // ── Seamless transition (brief blur) ──────────────────
  if (transition === 'seamless') {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm pointer-events-none animate-pulse" />
    );
  }

  // ── Minimized state (fast connection flash) ───────────
  if (minimized) {
    return (
      <div className="fixed inset-0 z-50 pointer-events-none">
        <div className="absolute inset-0 bg-black/20 animate-pulse" />
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className={`${panel} px-4 py-2 flex items-center gap-2 text-xs`}>
            <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
            <span className="text-gray-300">Loading {destination.name}...</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Full-screen transitions ───────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center">
      {/* Background gradient */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background: `radial-gradient(ellipse at center, ${
            destination.previewColor || '#0E7490'
          }33 0%, transparent 70%)`,
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-6 max-w-lg w-full px-4">
        {/* Destination name */}
        <AnimatedArrival name={destination.name} />

        {/* Destination description */}
        {destination.description && (
          <p className="text-xs text-gray-400 text-center max-w-xs">{destination.description}</p>
        )}

        {/* District stats */}
        {districtStats && transition === 'district' && (
          <div className={`${panel} px-4 py-3 flex gap-4 text-[10px]`}>
            <span className="flex items-center gap-1 text-gray-400">
              <Users className="w-3 h-3" />
              Pop: {districtStats.population.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 text-gray-400">
              <Building2 className="w-3 h-3" />
              {districtStats.buildings} buildings
            </span>
            <span className="flex items-center gap-1 text-yellow-400">
              <Zap className="w-3 h-3" />
              {districtStats.powerCapacity.toLocaleString()} kW
            </span>
          </div>
        )}

        {/* Portal archway */}
        {transition === 'portal' && <PortalArchway destination={destination} />}

        {/* Fast travel map */}
        {transition === 'fast-travel' && <FastTravelMap progress={progress} />}

        {/* Assembly progress */}
        {transition === 'assembly' && (
          <AssemblyProgress phase={phase} progress={progress} />
        )}

        {/* General progress bar (for district and portal transitions) */}
        {(transition === 'district' || transition === 'portal') && (
          <div className="w-full max-w-xs">
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300 transition-all duration-300"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-[9px] text-gray-400">
              <span>Loading</span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
          </div>
        )}

        {/* Tip — lore tips get the scroll icon + warmer tint, gameplay tips
            keep the sparkle. Crossfade key on the index so the text actually
            re-renders with the keyframe animation rather than a hard swap. */}
        <div className={`${panel} px-4 py-2 max-w-sm transition-opacity`} key={currentTipIdx}>
          <div className="flex items-start gap-2">
            {displayKind === 'lore' ? (
              <ScrollText className="w-3.5 h-3.5 text-amber-300 flex-shrink-0 mt-0.5" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 mt-0.5" />
            )}
            <p
              className={`text-[11px] leading-relaxed ${displayKind === 'lore' ? 'text-amber-100/80 italic' : 'text-gray-400'}`}
              style={{ animation: 'tipFadeIn 600ms ease-out' }}
            >
              {displayTip}
            </p>
          </div>
          <style jsx>{`
            @keyframes tipFadeIn {
              from { opacity: 0; transform: translateY(4px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>

        {/* Destination preview info */}
        {(destination.playerCount !== undefined || destination.buildingCount !== undefined) && (
          <div className="flex items-center gap-3 text-[10px] text-gray-400">
            {destination.playerCount !== undefined && (
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {destination.playerCount} players online
              </span>
            )}
            {destination.buildingCount !== undefined && (
              <span className="flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {destination.buildingCount} structures
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
