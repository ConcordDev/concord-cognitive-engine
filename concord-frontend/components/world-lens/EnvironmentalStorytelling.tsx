'use client';

import React, { createContext, useCallback, useContext, useMemo } from 'react';

/* ── Types ─────────────────────────────────────────────────────── */

type WeatheringStage = 'pristine' | 'light-wear' | 'weathered' | 'aged' | 'historic';

type DisasterType = 'seismic' | 'hurricane' | 'flood' | 'fire';

type PrestigeLevel = 'standard' | 'notable' | 'renowned' | 'legendary';

interface DisasterBadge {
  type: DisasterType;
  magnitude: number;
  survivedAt: string;
  label: string;
}

interface BuildingHistory {
  builderId: string;
  builderName: string;
  builtAt: string;
  disastersSurvived: DisasterBadge[];
  citationCount: number;
  prestige: PrestigeLevel;
  weathering: WeatheringStage;
  repairHistory: { date: string; reason: string }[];
}

interface DistrictAge {
  districtId: string;
  foundedAt: string;
  ageInDays: number;
  label: string;
}

interface RoadWear {
  pathId: string;
  trafficLevel: number; // 0–1
  wearClass: 'pristine' | 'light' | 'moderate' | 'heavy' | 'worn';
}

interface LotStatus {
  cellId: string;
  status: 'vacant' | 'construction' | 'occupied' | 'demolished';
  previousBuilding?: string;
  demolishedAt?: string;
  constructionProgress?: number;
}

interface EnvironmentalStorytellingAPI {
  getWeathering: (buildingAge: number, climate: string) => { stage: WeatheringStage; opacity: number; description: string };
  getBadges: (disasters: { type: DisasterType; magnitude: number; date: string }[]) => DisasterBadge[];
  getPrestige: (citationCount: number) => { level: PrestigeLevel; glowColor: string; glowIntensity: number; label: string };
  getHistory: (building: {
    creator: string;
    creatorName: string;
    placedAt: string;
    disasters?: { type: DisasterType; magnitude: number; date: string }[];
    citations?: number;
    age?: number;
    climate?: string;
  }) => BuildingHistory;
}

/* ── Constants ────────────────────────────────────────────────── */

const WEATHERING_THRESHOLDS: { maxDays: number; stage: WeatheringStage; description: string }[] = [
  { maxDays: 30, stage: 'pristine', description: 'Freshly built, materials gleaming.' },
  { maxDays: 180, stage: 'light-wear', description: 'Slight patina developing, minor surface wear.' },
  { maxDays: 365, stage: 'weathered', description: 'Visible weathering, character developing.' },
  { maxDays: 730, stage: 'aged', description: 'Well-worn surfaces, established presence.' },
  { maxDays: Infinity, stage: 'historic', description: 'A landmark. Deep patina, storied walls.' },
];

const CLIMATE_MULTIPLIERS: Record<string, number> = {
  tropical: 1.5,
  coastal: 1.3,
  arid: 0.8,
  temperate: 1.0,
  arctic: 1.2,
  humid: 1.4,
};

const PRESTIGE_TIERS: { min: number; level: PrestigeLevel; glowColor: string; label: string }[] = [
  { min: 200, level: 'legendary', glowColor: 'rgba(250,204,21,0.6)', label: 'Legendary Creation' },
  { min: 50, level: 'renowned', glowColor: 'rgba(168,85,247,0.5)', label: 'Renowned Design' },
  { min: 10, level: 'notable', glowColor: 'rgba(56,189,248,0.4)', label: 'Notable Work' },
  { min: 0, level: 'standard', glowColor: 'transparent', label: '' },
];

const DISASTER_LABELS: Record<DisasterType, (mag: number) => string> = {
  seismic: (m) => `Survived M${m.toFixed(1)} earthquake`,
  hurricane: (m) => `Weathered Cat ${Math.min(5, Math.ceil(m / 2))} hurricane`,
  flood: (m) => `Endured ${m.toFixed(1)}m flood`,
  fire: (m) => `Survived ${m.toFixed(0)}-hour fire`,
};

const DISASTER_ICONS: Record<DisasterType, string> = {
  seismic: '🌍',
  hurricane: '🌀',
  flood: '🌊',
  fire: '🔥',
};

/* ── Context ──────────────────────────────────────────────────── */

const EnvironmentalStorytellingContext = createContext<EnvironmentalStorytellingAPI>({
  getWeathering: () => ({ stage: 'pristine', opacity: 0, description: '' }),
  getBadges: () => [],
  getPrestige: () => ({ level: 'standard', glowColor: 'transparent', glowIntensity: 0, label: '' }),
  getHistory: () => ({
    builderId: '',
    builderName: '',
    builtAt: '',
    disastersSurvived: [],
    citationCount: 0,
    prestige: 'standard',
    weathering: 'pristine',
    repairHistory: [],
  }),
});

export function useEnvironmentalStorytelling(): EnvironmentalStorytellingAPI {
  return useContext(EnvironmentalStorytellingContext);
}

/* ── Component ────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

interface EnvironmentalStorytellingProps {
  buildings?: {
    id: string;
    creator: string;
    creatorName: string;
    placedAt: string;
    age: number;
    climate: string;
    citations: number;
    disasters: { type: DisasterType; magnitude: number; date: string }[];
  }[];
  lots?: LotStatus[];
  roads?: RoadWear[];
  districtAge?: DistrictAge;
  selectedBuildingId?: string | null;
}

export default function EnvironmentalStorytelling({
  buildings = [],
  lots = [],
  roads = [],
  districtAge,
  selectedBuildingId,
}: EnvironmentalStorytellingProps) {
  const getWeathering = useCallback(
    (buildingAge: number, climate: string): { stage: WeatheringStage; opacity: number; description: string } => {
      const multiplier = CLIMATE_MULTIPLIERS[climate] ?? 1.0;
      const effectiveAge = buildingAge * multiplier;

      for (const tier of WEATHERING_THRESHOLDS) {
        if (effectiveAge <= tier.maxDays) {
          const opacity = Math.min(1, effectiveAge / tier.maxDays) * 0.8;
          return { stage: tier.stage, opacity, description: tier.description };
        }
      }

      return { stage: 'historic', opacity: 0.8, description: WEATHERING_THRESHOLDS[4].description };
    },
    [],
  );

  const getBadges = useCallback(
    (disasters: { type: DisasterType; magnitude: number; date: string }[]): DisasterBadge[] => {
      return disasters.map((d) => ({
        type: d.type,
        magnitude: d.magnitude,
        survivedAt: d.date,
        label: DISASTER_LABELS[d.type](d.magnitude),
      }));
    },
    [],
  );

  const getPrestige = useCallback(
    (citationCount: number): { level: PrestigeLevel; glowColor: string; glowIntensity: number; label: string } => {
      for (const tier of PRESTIGE_TIERS) {
        if (citationCount >= tier.min) {
          const glowIntensity = tier.level === 'standard' ? 0 : Math.min(1, citationCount / 300);
          return { level: tier.level, glowColor: tier.glowColor, glowIntensity, label: tier.label };
        }
      }
      return { level: 'standard', glowColor: 'transparent', glowIntensity: 0, label: '' };
    },
    [],
  );

  const getHistory = useCallback(
    (building: {
      creator: string;
      creatorName: string;
      placedAt: string;
      disasters?: { type: DisasterType; magnitude: number; date: string }[];
      citations?: number;
      age?: number;
      climate?: string;
    }): BuildingHistory => {
      const disasters = building.disasters || [];
      const citations = building.citations || 0;
      const age = building.age || 0;
      const climate = building.climate || 'temperate';

      return {
        builderId: building.creator,
        builderName: building.creatorName,
        builtAt: building.placedAt,
        disastersSurvived: getBadges(disasters),
        citationCount: citations,
        prestige: getPrestige(citations).level,
        weathering: getWeathering(age, climate).stage,
        repairHistory: [],
      };
    },
    [getBadges, getPrestige, getWeathering],
  );

  const api = useMemo<EnvironmentalStorytellingAPI>(
    () => ({ getWeathering, getBadges, getPrestige, getHistory }),
    [getWeathering, getBadges, getPrestige, getHistory],
  );

  // Find the selected building for the tooltip
  const selectedBuilding = selectedBuildingId
    ? buildings.find((b) => b.id === selectedBuildingId)
    : null;
  const selectedHistory = selectedBuilding ? getHistory(selectedBuilding) : null;
  const selectedPrestige = selectedBuilding ? getPrestige(selectedBuilding.citations) : null;

  return (
    <EnvironmentalStorytellingContext.Provider value={api}>
      {/* Prestige glow overlays for buildings in the viewport */}
      {buildings.map((b) => {
        const prestige = getPrestige(b.citations);
        if (prestige.level === 'standard') return null;
        return (
          <div
            key={`prestige-${b.id}`}
            className="pointer-events-none absolute"
            data-building-id={b.id}
            data-prestige={prestige.level}
            style={{
              boxShadow: `0 0 ${prestige.glowIntensity * 30}px ${prestige.glowIntensity * 15}px ${prestige.glowColor}`,
              borderRadius: '4px',
            }}
          />
        );
      })}

      {/* Disaster survival badges */}
      {buildings
        .filter((b) => b.disasters.length > 0)
        .map((b) => (
          <div
            key={`badges-${b.id}`}
            className="pointer-events-none absolute"
            data-building-id={b.id}
          >
            {getBadges(b.disasters).map((badge, i) => (
              <span
                key={i}
                className="inline-block text-[10px] mr-0.5"
                title={badge.label}
              >
                {DISASTER_ICONS[badge.type]}
              </span>
            ))}
          </div>
        ))}

      {/* Lot status indicators */}
      {lots.map((lot) => (
        <div
          key={`lot-${lot.cellId}`}
          className="pointer-events-none absolute"
          data-cell-id={lot.cellId}
          data-status={lot.status}
        >
          {lot.status === 'vacant' && (
            <div className="w-full h-full border border-dashed border-gray-600/30 rounded bg-gray-900/20" />
          )}
          {lot.status === 'construction' && (
            <div className="w-full h-full border border-dashed border-yellow-500/30 rounded bg-yellow-900/10">
              <div
                className="h-0.5 bg-yellow-500/50 rounded-full"
                style={{ width: `${(lot.constructionProgress || 0) * 100}%` }}
              />
            </div>
          )}
          {lot.status === 'demolished' && (
            <div className="w-full h-full border border-dashed border-red-900/20 rounded bg-red-950/10" />
          )}
        </div>
      ))}

      {/* Road wear visualization */}
      {roads.map((road) => (
        <div
          key={`road-${road.pathId}`}
          className="pointer-events-none absolute"
          data-path-id={road.pathId}
          data-wear={road.wearClass}
          style={{
            opacity: 0.3 + road.trafficLevel * 0.5,
          }}
        />
      ))}

      {/* District age indicator */}
      {districtAge && (
        <div className={`absolute top-2 left-2 ${panel} px-2 py-1`}>
          <span className="text-[9px] text-gray-500">
            Est. {districtAge.foundedAt} — {districtAge.label}
          </span>
        </div>
      )}

      {/* Building history tooltip */}
      {selectedHistory && selectedBuilding && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[8800] max-w-sm ${panel} p-3`}>
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: selectedPrestige?.glowColor || 'gray',
                boxShadow: selectedPrestige?.glowIntensity
                  ? `0 0 8px ${selectedPrestige.glowColor}`
                  : 'none',
              }}
            />
            <span className="text-xs font-medium text-white">{selectedBuilding.id}</span>
            {selectedPrestige && selectedPrestige.level !== 'standard' && (
              <span className="text-[9px] text-purple-400">{selectedPrestige.label}</span>
            )}
          </div>
          <p className="text-[10px] text-gray-400 mb-1.5">
            Built by @{selectedHistory.builderName} on {selectedHistory.builtAt}.
            {selectedHistory.disastersSurvived.length > 0 && (
              <> {selectedHistory.disastersSurvived.map((d) => d.label).join('. ')}.</>
            )}
            {' '}Cited {selectedHistory.citationCount} times.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 capitalize">
              {selectedHistory.weathering}
            </span>
            {selectedHistory.disastersSurvived.map((badge, i) => (
              <span key={i} className="text-[10px]" title={badge.label}>
                {DISASTER_ICONS[badge.type]}
              </span>
            ))}
          </div>
        </div>
      )}
    </EnvironmentalStorytellingContext.Provider>
  );
}
