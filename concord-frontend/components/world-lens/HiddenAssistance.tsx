'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────── */

type ExpertiseLevel = 'newcomer' | 'beginner' | 'intermediate' | 'advanced' | 'expert';

interface NearMissResult {
  isNearMiss: boolean;
  score: number;
  suggestion: string | null;
  encouragement: string | null;
}

interface Suggestion {
  id: string;
  type: 'material' | 'dimension' | 'connection' | 'configuration';
  message: string;
  confidence: number;
}

interface Nudge {
  id: string;
  type: 'infrastructure' | 'validation' | 'material' | 'tutorial';
  message: string;
  priority: 'low' | 'medium' | 'high';
  dismissable: boolean;
}

interface SmartDefault {
  field: string;
  value: string | number;
  reason: string;
}

interface HiddenAssistanceAPI {
  checkNearMiss: (category: string, score: number, details?: Record<string, number>) => NearMissResult;
  getSuggestion: (context: string, currentConfig?: Record<string, unknown>) => Suggestion | null;
  getNudge: (action: string, state?: Record<string, unknown>) => Nudge | null;
  getSmartDefaults: (buildingType: string) => SmartDefault[];
}

interface HiddenAssistanceProps {
  children: React.ReactNode;
  expertiseLevel?: ExpertiseLevel;
  enabled?: boolean;
}

/* ── Constants ────────────────────────────────────────────────── */

const NEAR_MISS_THRESHOLD = 0.10; // within 10% of passing
const ALMOST_THERE_MIN = 0.90;
const ALMOST_THERE_MAX = 0.99;
const TUTORIAL_BUILD_COUNT = 5;
const TUTORIAL_LENIENCY = 0.05; // 5% more lenient for first builds

const NEAR_MISS_SUGGESTIONS: Record<string, (deficit: number) => string> = {
  loadBearing: (d) => `Increase beam cross-section by ${(d * 100).toFixed(0)}% or switch to steel I-beam for this span.`,
  windShear: (d) => `Add lateral bracing or increase column diameter by ${Math.ceil(d * 20)}cm to handle wind loads.`,
  seismic: (d) => `Consider base isolation or increase foundation depth by ${Math.ceil(d * 50)}cm.`,
  thermal: (d) => `Add ${Math.ceil(d * 10)}cm of insulation or switch to composite cladding.`,
  fire: (d) => `Apply fire-resistant coating or switch to fire-rated material (${(d * 60).toFixed(0)} min deficit).`,
  habitability: (d) => `Improve ventilation or add ${Math.ceil(d * 3)} additional windows per floor.`,
  drainage: (d) => `Increase pipe diameter by ${Math.ceil(d * 5)}cm or add a secondary drain path.`,
  power: (d) => `Switch to USB-B connector for ${Math.ceil(d * 15)}% better throughput in this configuration.`,
};

const ENCOURAGEMENT_MESSAGES = [
  'Almost there! Just a small tweak away from passing.',
  'So close — you\'re within striking distance of full validation.',
  'Nearly perfect. One small adjustment should do it.',
  'Great work so far — just nudge that last parameter a bit.',
  'You\'re 90%+ there. The finish line is right ahead.',
];

const NUDGE_TEMPLATES: Record<string, (ctx: Record<string, unknown>) => Nudge | null> = {
  'pre-validate': (ctx) => {
    if (!ctx.hasInfrastructure) {
      return {
        id: 'nudge-infra',
        type: 'infrastructure',
        message: 'Connect to water and power infrastructure before validating — it affects habitability scores.',
        priority: 'medium',
        dismissable: true,
      };
    }
    return null;
  },
  'first-placement': (ctx) => {
    const buildCount = (ctx.buildCount as number) || 0;
    if (buildCount < TUTORIAL_BUILD_COUNT) {
      return {
        id: 'nudge-tutorial',
        type: 'tutorial',
        message: buildCount === 0
          ? 'Welcome! Start by selecting a material, then define your structural members. The system will guide you.'
          : `Build ${buildCount + 1} of ${TUTORIAL_BUILD_COUNT} — you're getting the hang of it. Try experimenting with different cross-sections.`,
        priority: 'low',
        dismissable: true,
      };
    }
    return null;
  },
  'material-select': (ctx) => {
    if (!ctx.selectedMaterial) {
      return {
        id: 'nudge-material',
        type: 'material',
        message: 'Choose a material first. For beginners, Concrete or Timber are forgiving choices.',
        priority: 'medium',
        dismissable: true,
      };
    }
    return null;
  },
  'pre-submit': (ctx) => {
    if (!ctx.hasRanValidation) {
      return {
        id: 'nudge-validate',
        type: 'validation',
        message: 'Run validation before placing — it\'ll save you from having to rebuild later.',
        priority: 'high',
        dismissable: true,
      };
    }
    return null;
  },
};

const SMART_DEFAULTS_DB: Record<string, SmartDefault[]> = {
  residential: [
    { field: 'material', value: 'reinforced-concrete', reason: 'Most common for residential; good balance of cost and durability.' },
    { field: 'floorHeight', value: 3.0, reason: 'Standard residential floor height.' },
    { field: 'wallThickness', value: 0.2, reason: 'Adequate for most residential loads.' },
    { field: 'insulation', value: 'mineral-wool', reason: 'Best thermal performance for residential cost.' },
  ],
  commercial: [
    { field: 'material', value: 'steel-frame', reason: 'Allows open floor plans common in commercial spaces.' },
    { field: 'floorHeight', value: 4.0, reason: 'Standard commercial floor height with plenum.' },
    { field: 'fireRating', value: 2, reason: 'Minimum 2-hour fire rating for commercial occupancy.' },
  ],
  bridge: [
    { field: 'material', value: 'steel', reason: 'Best strength-to-weight ratio for spanning.' },
    { field: 'deckThickness', value: 0.25, reason: 'Standard for mid-span vehicular bridges.' },
    { field: 'cableType', value: 'wire-rope', reason: 'Reliable and widely validated in Concordia.' },
  ],
  tower: [
    { field: 'material', value: 'composite', reason: 'Combines steel core with concrete shell for tall structures.' },
    { field: 'coreRatio', value: 0.25, reason: 'Core-to-floor-plate ratio for efficient tall buildings.' },
    { field: 'dampening', value: 'tuned-mass', reason: 'Recommended for structures over 20 stories.' },
  ],
  infrastructure: [
    { field: 'material', value: 'hdpe', reason: 'Durable, corrosion-resistant pipe material.' },
    { field: 'redundancy', value: 'dual-path', reason: 'Ensures service continuity during maintenance.' },
  ],
};

/* ── Context ──────────────────────────────────────────────────── */

const HiddenAssistanceContext = createContext<HiddenAssistanceAPI>({
  checkNearMiss: () => ({ isNearMiss: false, score: 0, suggestion: null, encouragement: null }),
  getSuggestion: () => null,
  getNudge: () => null,
  getSmartDefaults: () => [],
});

export function useHiddenAssistance(): HiddenAssistanceAPI {
  return useContext(HiddenAssistanceContext);
}

/* ── Component ────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

export default function HiddenAssistance({
  children,
  expertiseLevel: _expertiseLevel = 'beginner',
  enabled = true,
}: HiddenAssistanceProps) {
  const [buildCount, setBuildCount] = useState(0);
  const [dismissedNudges, setDismissedNudges] = useState<Set<string>>(new Set());
  const [activeNudge, setActiveNudge] = useState<Nudge | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<NearMissResult | null>(null);

  const isNewUser = buildCount < TUTORIAL_BUILD_COUNT;

  const checkNearMiss = useCallback(
    (category: string, score: number, _details?: Record<string, number>): NearMissResult => {
      if (!enabled) return { isNearMiss: false, score, suggestion: null, encouragement: null };

      const passingScore = 1.0;
      // Apply tutorial leniency for new users
      const effectiveThreshold = isNewUser ? passingScore - TUTORIAL_LENIENCY : passingScore;
      const deficit = effectiveThreshold - score;

      // Check if it's a near miss
      if (score < effectiveThreshold && deficit <= NEAR_MISS_THRESHOLD) {
        const suggestionFn = NEAR_MISS_SUGGESTIONS[category];
        const suggestion = suggestionFn ? suggestionFn(deficit) : `Increase ${category} performance by ${(deficit * 100).toFixed(1)}% to pass.`;

        // Pick encouragement for almost-there scores
        let encouragement: string | null = null;
        if (score >= ALMOST_THERE_MIN && score <= ALMOST_THERE_MAX) {
          encouragement = ENCOURAGEMENT_MESSAGES[Math.floor(Math.random() * ENCOURAGEMENT_MESSAGES.length)];
        }

        const result: NearMissResult = { isNearMiss: true, score, suggestion, encouragement };
        setActiveSuggestion(result);
        return result;
      }

      // If they passed, maybe increment build count
      if (score >= effectiveThreshold) {
        setBuildCount((prev) => prev + 1);
      }

      return { isNearMiss: false, score, suggestion: null, encouragement: null };
    },
    [enabled, isNewUser],
  );

  const getSuggestion = useCallback(
    (context: string, _currentConfig?: Record<string, unknown>): Suggestion | null => {
      if (!enabled) return null;

      // Context-specific suggestions
      const suggestions: Record<string, Suggestion> = {
        'beam-undersized': {
          id: 'sug-beam',
          type: 'dimension',
          message: 'Increase beam diameter by 2cm to pass load-bearing validation for this span.',
          confidence: 0.85,
        },
        'connector-mismatch': {
          id: 'sug-connector',
          type: 'connection',
          message: 'Switch to USB-B for 15% better performance in this configuration.',
          confidence: 0.78,
        },
        'material-suboptimal': {
          id: 'sug-material',
          type: 'material',
          message: 'Steel performs 30% better than aluminum for this span-to-depth ratio.',
          confidence: 0.72,
        },
        'config-incomplete': {
          id: 'sug-config',
          type: 'configuration',
          message: 'Adding cross-bracing will improve seismic performance by approximately 25%.',
          confidence: 0.80,
        },
      };

      return suggestions[context] || null;
    },
    [enabled],
  );

  const getNudge = useCallback(
    (action: string, state?: Record<string, unknown>): Nudge | null => {
      if (!enabled) return null;

      const ctx = { ...state, buildCount };
      const template = NUDGE_TEMPLATES[action];
      if (!template) return null;

      const nudge = template(ctx);
      if (!nudge || dismissedNudges.has(nudge.id)) return null;

      setActiveNudge(nudge);
      return nudge;
    },
    [enabled, buildCount, dismissedNudges],
  );

  const getSmartDefaults = useCallback(
    (buildingType: string): SmartDefault[] => {
      if (!enabled) return [];
      return SMART_DEFAULTS_DB[buildingType.toLowerCase()] || SMART_DEFAULTS_DB.residential || [];
    },
    [enabled],
  );

  const dismissNudge = useCallback((id: string) => {
    setDismissedNudges((prev) => new Set(prev).add(id));
    setActiveNudge(null);
  }, []);

  const dismissSuggestion = useCallback(() => {
    setActiveSuggestion(null);
  }, []);

  const api = useMemo<HiddenAssistanceAPI>(
    () => ({ checkNearMiss, getSuggestion, getNudge, getSmartDefaults }),
    [checkNearMiss, getSuggestion, getNudge, getSmartDefaults],
  );

  return (
    <HiddenAssistanceContext.Provider value={api}>
      {children}

      {/* Near-miss suggestion overlay — appears subtly at bottom */}
      {activeSuggestion?.isNearMiss && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-[9000] max-w-md ${panel} p-3`}>
          {activeSuggestion.encouragement && (
            <p className="text-xs text-yellow-300 mb-1.5">{activeSuggestion.encouragement}</p>
          )}
          <p className="text-xs text-gray-300">{activeSuggestion.suggestion}</p>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-gray-500">
              Score: {(activeSuggestion.score * 100).toFixed(1)}%
            </span>
            <button
              onClick={dismissSuggestion}
              className="text-[10px] text-gray-500 hover:text-white transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Active nudge overlay — appears subtly at bottom-right */}
      {activeNudge && (
        <div className={`fixed bottom-20 right-4 z-[8999] max-w-xs ${panel} p-3`}>
          <div className="flex items-start gap-2">
            <div
              className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                activeNudge.priority === 'high'
                  ? 'bg-yellow-400'
                  : activeNudge.priority === 'medium'
                    ? 'bg-blue-400'
                    : 'bg-gray-400'
              }`}
            />
            <p className="text-xs text-gray-300">{activeNudge.message}</p>
          </div>
          {activeNudge.dismissable && (
            <button
              onClick={() => dismissNudge(activeNudge.id)}
              className="text-[10px] text-gray-500 hover:text-white mt-2 transition-colors"
            >
              Got it
            </button>
          )}
        </div>
      )}
    </HiddenAssistanceContext.Provider>
  );
}
