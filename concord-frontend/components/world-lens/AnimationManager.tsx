'use client';

import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

// ── Types ──────────────────────────────────────────────────────────

export type AvatarAnimation =
  | 'idle'
  | 'walk'
  | 'run'
  | 'build'
  | 'inspect'
  | 'craft'
  | 'sit'
  | 'wave'
  | 'celebrate'
  | 'attack-light'
  | 'attack-heavy'
  | 'block'
  | 'dodge-left'
  | 'dodge-right'
  | 'dodge-back'
  | 'parry'
  | 'hit-flinch'
  | 'death'
  // Wave G1 — interactable-prop verbs (procedurally keyframed in AvatarSystem3D).
  | 'drink'
  | 'kneel-pickup'
  | 'light-torch'
  | 'lean'
  | 'hand-extend'
  | 'read'
  | 'hammer'
  | 'sleep';

export type NPCOccupation =
  | 'blacksmith'
  | 'scholar'
  | 'farmer'
  | 'guard'
  | 'trader'
  | 'builder';

export type NPCAnimation =
  | 'blacksmith-hammering'
  | 'scholar-reading'
  | 'farmer-tending'
  | 'guard-patrolling'
  | 'trader-counting'
  | 'builder-constructing';

export type ConstructionPhase = 'foundation' | 'frame' | 'walls' | 'roof' | 'finish';

export type WeatherType = 'rain' | 'snow' | 'dust' | 'leaves' | 'ash';

export interface WeatherConfig {
  type: WeatherType;
  density: number; // 0–1
  windSpeed: number; // 0–1
  windDirection: number; // degrees
}

export interface AnimationQueueItem {
  id: string;
  animation: string;
  duration: number;
  blendTime: number;
  onComplete?: () => void;
}

export interface ConstructionState {
  buildingId: string;
  phase: ConstructionPhase;
  progress: number; // 0–1
  active: boolean;
}

export interface DestructionState {
  buildingId: string;
  progress: number; // 0–1
  active: boolean;
}

export interface AnimationManagerAPI {
  playAnimation: (entityId: string, animation: AvatarAnimation | NPCAnimation) => void;
  setWeatherParticles: (config: WeatherConfig | null) => void;
  triggerConstruction: (buildingId: string, phase: ConstructionPhase) => void;
  triggerDestruction: (buildingId: string) => void;
}

// ── Transition map ────────────────────────────────────────────────

const avatarTransitions: Record<AvatarAnimation, AvatarAnimation[]> = {
  idle: ['walk', 'build', 'inspect', 'craft', 'sit', 'wave', 'celebrate', 'attack-light', 'attack-heavy', 'block', 'dodge-left', 'dodge-right', 'dodge-back', 'parry', 'hit-flinch', 'death', 'drink', 'kneel-pickup', 'light-torch', 'lean', 'hand-extend', 'read', 'hammer', 'sleep'],
  walk: ['idle', 'run', 'build', 'inspect', 'attack-light', 'block', 'dodge-left', 'dodge-right', 'dodge-back', 'hit-flinch'],
  run: ['walk', 'idle', 'attack-light', 'dodge-back'],
  build: ['idle', 'walk'],
  inspect: ['idle', 'walk'],
  craft: ['idle'],
  sit: ['idle', 'lean', 'sleep', 'drink'],
  wave: ['idle'],
  celebrate: ['idle'],
  // Combat states all return to idle (or chain into hit-flinch / death on damage).
  'attack-light':  ['idle', 'attack-heavy', 'hit-flinch'],
  'attack-heavy':  ['idle', 'hit-flinch'],
  block:           ['idle', 'parry', 'hit-flinch'],
  parry:           ['idle', 'attack-light'],
  'dodge-left':    ['idle', 'walk'],
  'dodge-right':   ['idle', 'walk'],
  'dodge-back':    ['idle', 'walk'],
  'hit-flinch':    ['idle', 'death'],
  death:           ['death'],
  // Wave G1 — interactable-prop verbs return to idle by default.
  drink:         ['idle'],
  'kneel-pickup': ['idle'],
  'light-torch': ['idle'],
  lean:          ['idle', 'sit'],
  'hand-extend': ['idle'],
  read:          ['idle'],
  hammer:        ['idle'],
  sleep:         ['idle', 'sit'],
};

// Per-animation duration & blend timing (ms). Combat is faster than locomotion.
const animationTimings: Partial<Record<AvatarAnimation, { duration: number; blend: number }>> = {
  'attack-light': { duration: 450,  blend: 80  },
  'attack-heavy': { duration: 900,  blend: 120 },
  block:          { duration: 1200, blend: 100 },
  parry:          { duration: 350,  blend: 60  },
  'dodge-left':   { duration: 500,  blend: 80  },
  'dodge-right':  { duration: 500,  blend: 80  },
  'dodge-back':   { duration: 600,  blend: 80  },
  'hit-flinch':   { duration: 350,  blend: 60  },
  death:          { duration: 2000, blend: 200 },
  // Wave G1 — prop interaction timings.
  drink:          { duration: 1400, blend: 150 },
  'kneel-pickup': { duration: 1200, blend: 150 },
  'light-torch':  { duration: 1100, blend: 150 },
  lean:           { duration: 1500, blend: 200 },
  'hand-extend':  { duration:  800, blend: 120 },
  read:           { duration: 2200, blend: 200 },
  hammer:         { duration: 1000, blend: 150 },
  sleep:          { duration: 3000, blend: 400 },
};

const constructionPhases: ConstructionPhase[] = [
  'foundation',
  'frame',
  'walls',
  'roof',
  'finish',
];

const npcAnimationMap: Record<NPCOccupation, NPCAnimation> = {
  blacksmith: 'blacksmith-hammering',
  scholar: 'scholar-reading',
  farmer: 'farmer-tending',
  guard: 'guard-patrolling',
  trader: 'trader-counting',
  builder: 'builder-constructing',
};

// ── Context ───────────────────────────────────────────────────────

const AnimationContext = createContext<AnimationManagerAPI | null>(null);

export function useAnimationManager(): AnimationManagerAPI {
  const ctx = useContext(AnimationContext);
  if (!ctx) {
    throw new Error('useAnimationManager must be used within an AnimationManager');
  }
  return ctx;
}

// ── Component ─────────────────────────────────────────────────────

interface AnimationManagerProps {
  children: React.ReactNode;
  debug?: boolean;
}

export default function AnimationManager({ children, debug = false }: AnimationManagerProps) {
  // Entity animation states
  const entityAnimations = useRef<Map<string, { current: string; blending: boolean }>>(new Map());
  const animationQueue = useRef<Map<string, AnimationQueueItem[]>>(new Map());

  // Weather
  const [weather, setWeather] = useState<WeatherConfig | null>(null);

  // Construction / destruction state
  const [constructions, setConstructions] = useState<Map<string, ConstructionState>>(new Map());
  const [destructions, setDestructions] = useState<Map<string, DestructionState>>(new Map());

  // Debug display
  const [activeAnimations, setActiveAnimations] = useState<Map<string, string>>(new Map());

  // Animation queue processor
  const processQueue = useCallback((entityId: string) => {
    const queue = animationQueue.current.get(entityId);
    if (!queue || queue.length === 0) return;

    const next = queue[0];
    const state = entityAnimations.current.get(entityId);

    if (state) {
      state.blending = true;
      state.current = next.animation;
    } else {
      entityAnimations.current.set(entityId, { current: next.animation, blending: true });
    }

    if (debug) {
      setActiveAnimations((prev) => {
        const next2 = new Map(prev);
        next2.set(entityId, next.animation);
        return next2;
      });
    }

    // Simulate blend transition then mark complete
    setTimeout(() => {
      const s = entityAnimations.current.get(entityId);
      if (s) s.blending = false;
    }, next.blendTime);

    // After duration, process next in queue
    setTimeout(() => {
      queue.shift();
      next.onComplete?.();
      processQueue(entityId);
    }, next.duration);
  }, [debug]);

  const playAnimation = useCallback(
    (entityId: string, animation: AvatarAnimation | NPCAnimation) => {
      const timing = animationTimings[animation as AvatarAnimation];
      const blendTime = timing?.blend ?? 150;
      const duration  = timing?.duration ?? 2000;

      const item: AnimationQueueItem = {
        id: `${entityId}-${animation}-${Date.now()}`,
        animation,
        duration,
        blendTime,
      };

      const queue = animationQueue.current.get(entityId) || [];
      queue.push(item);
      animationQueue.current.set(entityId, queue);

      // Start processing if this is the only item
      if (queue.length === 1) {
        processQueue(entityId);
      }
    },
    [processQueue],
  );

  const setWeatherParticles = useCallback((config: WeatherConfig | null) => {
    setWeather(config);
  }, []);

  const triggerConstruction = useCallback((buildingId: string, phase: ConstructionPhase) => {
    setConstructions((prev) => {
      const next = new Map(prev);
      const phaseIdx = constructionPhases.indexOf(phase);
      next.set(buildingId, {
        buildingId,
        phase,
        progress: phaseIdx / (constructionPhases.length - 1),
        active: true,
      });
      return next;
    });

    // Auto-advance progress
    const interval = setInterval(() => {
      setConstructions((prev) => {
        const next = new Map(prev);
        const state = next.get(buildingId);
        if (!state || state.progress >= 1) {
          clearInterval(interval);
          if (state) next.set(buildingId, { ...state, active: false });
          return next;
        }
        next.set(buildingId, {
          ...state,
          progress: Math.min(1, state.progress + 0.02),
          phase: constructionPhases[
            Math.min(
              constructionPhases.length - 1,
              Math.floor((state.progress + 0.02) * constructionPhases.length),
            )
          ],
        });
        return next;
      });
    }, 100);
  }, []);

  const triggerDestruction = useCallback((buildingId: string) => {
    setDestructions((prev) => {
      const next = new Map(prev);
      next.set(buildingId, { buildingId, progress: 0, active: true });
      return next;
    });

    const interval = setInterval(() => {
      setDestructions((prev) => {
        const next = new Map(prev);
        const state = next.get(buildingId);
        if (!state || state.progress >= 1) {
          clearInterval(interval);
          if (state) next.set(buildingId, { ...state, active: false });
          return next;
        }
        next.set(buildingId, { ...state, progress: Math.min(1, state.progress + 0.05) });
        return next;
      });
    }, 50);
  }, []);

  // Subscribe to global combat-anim events so callers (combat handlers, AI,
  // network) can drive animations without holding the context ref.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as {
        entityId?: string;
        animation?: string;
      } | undefined;
      if (!detail?.entityId || !detail?.animation) return;
      playAnimation(detail.entityId, detail.animation as AvatarAnimation);
    };
    window.addEventListener('concordia:combat-anim', handler);
    // Hit-reaction events also drive a flinch animation on the target.
    const hitHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as {
        targetId?: string;
        severity?: 'light' | 'heavy' | 'crit';
      } | undefined;
      if (!detail?.targetId) return;
      playAnimation(detail.targetId, detail.severity === 'crit' ? 'death' : 'hit-flinch');
    };
    window.addEventListener('concordia:hit-reaction', hitHandler);
    return () => {
      window.removeEventListener('concordia:combat-anim', handler);
      window.removeEventListener('concordia:hit-reaction', hitHandler);
    };
  }, [playAnimation]);

  const api: AnimationManagerAPI = {
    playAnimation,
    setWeatherParticles,
    triggerConstruction,
    triggerDestruction,
  };

  return (
    <AnimationContext.Provider value={api}>
      {children}

      {/* Debug overlay */}
      {debug && (
        <div className={`${panel} fixed bottom-4 left-4 z-50 p-3 max-w-xs`}>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">
            Animation Debug
          </div>

          {/* Active animations */}
          {activeAnimations.size > 0 && (
            <div className="mb-2">
              <div className="text-[9px] text-gray-400 mb-1">Active Animations</div>
              {Array.from(activeAnimations.entries()).map(([entityId, anim]) => (
                <div key={entityId} className="flex items-center gap-2 text-[10px]">
                  <span className="text-gray-400">{entityId}</span>
                  <span className="text-cyan-400">{anim}</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {/* Weather */}
          {weather && (
            <div className="mb-2">
              <div className="text-[9px] text-gray-400 mb-1">Weather</div>
              <div className="text-[10px] text-gray-400">
                {weather.type} | density: {(weather.density * 100).toFixed(0)}% | wind:{' '}
                {(weather.windSpeed * 100).toFixed(0)}%
              </div>
            </div>
          )}

          {/* Construction */}
          {constructions.size > 0 && (
            <div className="mb-2">
              <div className="text-[9px] text-gray-400 mb-1">Construction</div>
              {Array.from(constructions.values())
                .filter((c) => c.active)
                .map((c) => (
                  <div key={c.buildingId} className="text-[10px]">
                    <div className="flex items-center justify-between text-gray-400">
                      <span>{c.buildingId}</span>
                      <span className="text-amber-400 capitalize">{c.phase}</span>
                    </div>
                    <div className="h-1 rounded-full bg-white/10 overflow-hidden mt-0.5">
                      <div
                        className="h-full bg-amber-400 rounded-full transition-all"
                        style={{ width: `${c.progress * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Destruction */}
          {destructions.size > 0 && (
            <div>
              <div className="text-[9px] text-gray-400 mb-1">Destruction</div>
              {Array.from(destructions.values())
                .filter((d) => d.active)
                .map((d) => (
                  <div key={d.buildingId} className="text-[10px]">
                    <span className="text-gray-400">{d.buildingId}</span>
                    <div className="h-1 rounded-full bg-white/10 overflow-hidden mt-0.5">
                      <div
                        className="h-full bg-red-500 rounded-full transition-all"
                        style={{ width: `${d.progress * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* State machine transitions */}
          <div className="mt-2 border-t border-white/5 pt-2">
            <div className="text-[9px] text-gray-400 mb-1">Avatar State Machine</div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(avatarTransitions) as AvatarAnimation[]).map((state) => (
                <span
                  key={state}
                  className="px-1.5 py-0.5 rounded text-[8px] bg-white/5 text-gray-400"
                >
                  {state}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-2 border-t border-white/5 pt-2">
            <div className="text-[9px] text-gray-400 mb-1">NPC Occupation Animations</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(npcAnimationMap).map(([occ, anim]) => (
                <span
                  key={occ}
                  className="px-1.5 py-0.5 rounded text-[8px] bg-white/5 text-gray-400"
                >
                  {occ}: {anim}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </AnimationContext.Provider>
  );
}
