'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────── */

type DiscoveryType =
  | 'material-composition'
  | 'terrain-feature'
  | 'npc-secret'
  | 'easter-egg'
  | 'perfect-validation'
  | 'famous-structure-match';

type RewardType = 'title' | 'badge' | 'material' | 'cosmetic' | 'reputation';

interface Discovery {
  id: string;
  type: DiscoveryType;
  title: string;
  description: string;
  discoveredAt: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  rewards: Reward[];
}

interface Reward {
  type: RewardType;
  name: string;
  value: string | number;
  icon: string;
}

interface JournalEntry {
  discovery: Discovery;
  timestamp: number;
  location?: { district: string; cell?: string };
}

interface _FamousStructureMatch {
  structureName: string;
  matchPercentage: number;
  description: string;
  eraOrYear: string;
}

interface TerrainFeature {
  cellId: string;
  featureType: 'rare-mineral' | 'hot-spring' | 'stable-bedrock' | 'fossil' | 'crystal-formation' | 'underground-stream';
  label: string;
  bonus: string;
}

interface NpcSecret {
  npcId: string;
  npcName: string;
  secret: string;
  condition: 'time-based' | 'relationship' | 'item-trade' | 'quest-complete';
  unlocked: boolean;
}

interface SecretsDiscoveryAPI {
  checkDiscovery: (context: {
    type: DiscoveryType;
    data: Record<string, unknown>;
  }) => Discovery | null;
  getJournal: () => JournalEntry[];
  getNearbySecrets: (district: string, cellId?: string) => {
    terrainFeatures: TerrainFeature[];
    npcSecrets: NpcSecret[];
    hiddenCount: number;
  };
}

/* ── Constants ────────────────────────────────────────────────── */

const FAMOUS_STRUCTURES: {
  name: string;
  proportions: { widthRatio: number; heightRatio: number; depthRatio: number };
  tolerance: number;
  era: string;
  description: string;
}[] = [
  { name: 'Parthenon', proportions: { widthRatio: 1.0, heightRatio: 0.45, depthRatio: 2.25 }, tolerance: 0.15, era: '447 BC', description: 'Greek temple of perfect proportions' },
  { name: 'Empire State Building', proportions: { widthRatio: 1.0, heightRatio: 6.8, depthRatio: 1.2 }, tolerance: 0.12, era: '1931', description: 'Art Deco skyscraper icon' },
  { name: 'Golden Gate Bridge', proportions: { widthRatio: 1.0, heightRatio: 0.17, depthRatio: 47.0 }, tolerance: 0.2, era: '1937', description: 'Suspension bridge masterpiece' },
  { name: 'Pyramid of Giza', proportions: { widthRatio: 1.0, heightRatio: 0.63, depthRatio: 1.0 }, tolerance: 0.1, era: '2560 BC', description: 'Ancient wonder of the world' },
  { name: 'Burj Khalifa', proportions: { widthRatio: 1.0, heightRatio: 15.3, depthRatio: 1.0 }, tolerance: 0.15, era: '2010', description: 'Tallest structure ever built' },
  { name: 'Colosseum', proportions: { widthRatio: 1.0, heightRatio: 0.26, depthRatio: 1.18 }, tolerance: 0.12, era: '80 AD', description: 'Roman amphitheater of gladiators' },
  { name: 'Sydney Opera House', proportions: { widthRatio: 1.0, heightRatio: 0.44, depthRatio: 1.1 }, tolerance: 0.18, era: '1973', description: 'Sculptural concert hall' },
  { name: 'Eiffel Tower', proportions: { widthRatio: 1.0, heightRatio: 2.7, depthRatio: 1.0 }, tolerance: 0.12, era: '1889', description: 'Iron lattice tower of Paris' },
];

const TERRAIN_FEATURES_DB: Record<string, TerrainFeature[]> = {
  forge: [
    { cellId: 'F-7-3', featureType: 'rare-mineral', label: 'Adamantine Deposit', bonus: '+20% structural strength when used in alloys' },
    { cellId: 'F-12-8', featureType: 'hot-spring', label: 'Geothermal Vent', bonus: 'Free heating for adjacent buildings' },
  ],
  academy: [
    { cellId: 'A-3-5', featureType: 'fossil', label: 'Ancient Foundation Stones', bonus: 'Unlocks historic material recipe' },
    { cellId: 'A-9-2', featureType: 'crystal-formation', label: 'Quartz Cluster', bonus: 'Unique aesthetic material unlock' },
  ],
  docks: [
    { cellId: 'D-1-10', featureType: 'underground-stream', label: 'Freshwater Spring', bonus: 'Free water supply for adjacent buildings' },
    { cellId: 'D-5-5', featureType: 'stable-bedrock', label: 'Granite Shelf', bonus: '+30% foundation stability' },
  ],
  commons: [
    { cellId: 'C-8-8', featureType: 'fossil', label: 'Petrified Wood', bonus: 'Unique decorative material' },
  ],
  frontier: [
    { cellId: 'FR-2-2', featureType: 'rare-mineral', label: 'Orichalcum Vein', bonus: 'Legendary building material' },
    { cellId: 'FR-15-10', featureType: 'stable-bedrock', label: 'Deep Granite Foundation', bonus: '+50% seismic resistance' },
    { cellId: 'FR-8-6', featureType: 'crystal-formation', label: 'Amethyst Cave', bonus: 'Cosmetic unlock: Crystal Walls' },
  ],
  observatory: [
    { cellId: 'O-4-4', featureType: 'stable-bedrock', label: 'Vibration-Free Zone', bonus: 'Perfect for precision instruments' },
  ],
  grid: [
    { cellId: 'G-6-3', featureType: 'underground-stream', label: 'Cooling Flow', bonus: 'Natural cooling for power infrastructure' },
  ],
};

const NPC_SECRETS_DB: NpcSecret[] = [
  { npcId: 'npc-forge-master', npcName: 'Forge Master Kael', secret: 'Knows the recipe for Starmetal alloy — available after building 10 structures in The Forge.', condition: 'quest-complete', unlocked: false },
  { npcId: 'npc-academy-scholar', npcName: 'Scholar Miriam', secret: 'Has ancient blueprints for self-healing concrete. Visit between dusk and night.', condition: 'time-based', unlocked: false },
  { npcId: 'npc-dock-captain', npcName: 'Captain Rowe', secret: 'Knows hidden harbor layout that reduces flood risk by 40%.', condition: 'relationship', unlocked: false },
  { npcId: 'npc-commons-gardener', npcName: 'Gardener Lin', secret: 'Can teach living wall construction — trade 5 rare plant materials.', condition: 'item-trade', unlocked: false },
  { npcId: 'npc-frontier-surveyor', npcName: 'Surveyor Oakes', secret: 'Knows locations of all rare mineral deposits in The Frontier.', condition: 'relationship', unlocked: false },
  { npcId: 'npc-observatory-watcher', npcName: 'Starwatcher Yuna', secret: 'Can predict weather 3 days in advance if you visit at night.', condition: 'time-based', unlocked: false },
];

const RARITY_COLORS: Record<Discovery['rarity'], string> = {
  common: 'text-gray-400 border-gray-500/30',
  uncommon: 'text-green-400 border-green-500/30',
  rare: 'text-blue-400 border-blue-500/30',
  epic: 'text-purple-400 border-purple-500/30',
  legendary: 'text-yellow-400 border-yellow-500/30',
};

const RARITY_GLOW: Record<Discovery['rarity'], string> = {
  common: '',
  uncommon: '',
  rare: 'shadow-blue-500/20',
  epic: 'shadow-purple-500/30',
  legendary: 'shadow-yellow-500/40',
};

/* ── Context ──────────────────────────────────────────────────── */

const SecretsDiscoveryContext = createContext<SecretsDiscoveryAPI>({
  checkDiscovery: () => null,
  getJournal: () => [],
  getNearbySecrets: () => ({ terrainFeatures: [], npcSecrets: [], hiddenCount: 0 }),
});

export function useDiscovery(): SecretsDiscoveryAPI {
  return useContext(SecretsDiscoveryContext);
}

/* ── Component ────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

interface SecretsDiscoveryProps {
  children?: React.ReactNode;
  userId?: string;
}

export default function SecretsDiscovery({ children, userId: _userId }: SecretsDiscoveryProps) {
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [activeNotification, setActiveNotification] = useState<Discovery | null>(null);
  const [showJournal, setShowJournal] = useState(false);

  const addToJournal = useCallback((discovery: Discovery, location?: { district: string; cell?: string }) => {
    setJournal((prev) => {
      // Avoid duplicates
      if (prev.some((e) => e.discovery.id === discovery.id)) return prev;
      return [...prev, { discovery, timestamp: Date.now(), location }];
    });
  }, []);

  const checkDiscovery = useCallback(
    (context: { type: DiscoveryType; data: Record<string, unknown> }): Discovery | null => {
      const { type, data } = context;

      switch (type) {
        case 'perfect-validation': {
          const categories = data.categories as Record<string, { score: number }> | undefined;
          if (!categories) return null;
          const allPerfect = Object.values(categories).every((c) => c.score >= 0.95);
          if (!allPerfect) return null;

          const discovery: Discovery = {
            id: `perfect-${data.buildingId || Date.now()}`,
            type: 'perfect-validation',
            title: 'Perfect Validation',
            description: 'Every category passed with >95% — your building radiates a golden aura.',
            discoveredAt: new Date().toISOString(),
            rarity: 'rare',
            rewards: [
              { type: 'badge', name: 'Perfectionist', value: 'perfect-validation', icon: '✨' },
              { type: 'reputation', name: 'Engineering Excellence', value: 50, icon: '⭐' },
            ],
          };
          addToJournal(discovery, data.location as { district: string; cell?: string });
          setActiveNotification(discovery);
          setTimeout(() => setActiveNotification(null), 5000);
          return discovery;
        }

        case 'famous-structure-match': {
          const proportions = data.proportions as { width: number; height: number; depth: number } | undefined;
          if (!proportions) return null;

          const { width, height, depth } = proportions;
          const _wRatio = 1;
          const hRatio = height / width;
          const dRatio = depth / width;

          for (const structure of FAMOUS_STRUCTURES) {
            const hDiff = Math.abs(hRatio - structure.proportions.heightRatio) / structure.proportions.heightRatio;
            const dDiff = Math.abs(dRatio - structure.proportions.depthRatio) / structure.proportions.depthRatio;

            if (hDiff <= structure.tolerance && dDiff <= structure.tolerance) {
              const matchPct = (1 - (hDiff + dDiff) / 2) * 100;
              const discovery: Discovery = {
                id: `famous-${structure.name.toLowerCase().replace(/\s/g, '-')}-${data.buildingId || Date.now()}`,
                type: 'famous-structure-match',
                title: `${structure.name} Echo`,
                description: `Your building's proportions match the ${structure.name} (${structure.era}) with ${matchPct.toFixed(0)}% similarity. ${structure.description}.`,
                discoveredAt: new Date().toISOString(),
                rarity: matchPct > 90 ? 'epic' : 'rare',
                rewards: [
                  { type: 'title', name: `Echo of ${structure.name}`, value: structure.name, icon: '🏛️' },
                  { type: 'reputation', name: 'Architectural Echo', value: Math.round(matchPct), icon: '🏗️' },
                ],
              };
              addToJournal(discovery, data.location as { district: string; cell?: string });
              setActiveNotification(discovery);
              setTimeout(() => setActiveNotification(null), 6000);
              return discovery;
            }
          }
          return null;
        }

        case 'terrain-feature': {
          const cellId = data.cellId as string;
          const district = data.district as string;
          const features = TERRAIN_FEATURES_DB[district] || [];
          const feature = features.find((f) => f.cellId === cellId);
          if (!feature) return null;

          const discovery: Discovery = {
            id: `terrain-${feature.cellId}`,
            type: 'terrain-feature',
            title: feature.label,
            description: `Hidden geological feature discovered: ${feature.bonus}`,
            discoveredAt: new Date().toISOString(),
            rarity: feature.featureType === 'rare-mineral' ? 'epic' : 'uncommon',
            rewards: [
              { type: 'material', name: feature.label, value: feature.featureType, icon: '⛏️' },
            ],
          };
          addToJournal(discovery, { district, cell: cellId });
          setActiveNotification(discovery);
          setTimeout(() => setActiveNotification(null), 4000);
          return discovery;
        }

        case 'npc-secret': {
          const npcId = data.npcId as string;
          const npc = NPC_SECRETS_DB.find((n) => n.npcId === npcId);
          if (!npc || npc.unlocked) return null;

          const discovery: Discovery = {
            id: `npc-${npc.npcId}`,
            type: 'npc-secret',
            title: `${npc.npcName}'s Secret`,
            description: npc.secret,
            discoveredAt: new Date().toISOString(),
            rarity: 'rare',
            rewards: [
              { type: 'badge', name: 'Secret Keeper', value: npc.npcId, icon: '🤫' },
            ],
          };
          addToJournal(discovery, data.location as { district: string; cell?: string });
          setActiveNotification(discovery);
          setTimeout(() => setActiveNotification(null), 5000);
          return discovery;
        }

        case 'material-composition': {
          const discovery: Discovery = {
            id: `material-${data.materialId || Date.now()}`,
            type: 'material-composition',
            title: (data.title as string) || 'New Material Discovery',
            description: (data.description as string) || 'You discovered a unique material composition.',
            discoveredAt: new Date().toISOString(),
            rarity: 'uncommon',
            rewards: [
              { type: 'material', name: (data.materialName as string) || 'Unknown Material', value: 1, icon: '🧪' },
            ],
          };
          addToJournal(discovery);
          setActiveNotification(discovery);
          setTimeout(() => setActiveNotification(null), 4000);
          return discovery;
        }

        case 'easter-egg': {
          const discovery: Discovery = {
            id: `egg-${data.eggId || Date.now()}`,
            type: 'easter-egg',
            title: (data.title as string) || 'Easter Egg Found!',
            description: (data.description as string) || 'You found something hidden...',
            discoveredAt: new Date().toISOString(),
            rarity: 'legendary',
            rewards: [
              { type: 'cosmetic', name: (data.rewardName as string) || 'Secret Cosmetic', value: 1, icon: '🥚' },
              { type: 'reputation', name: 'Explorer', value: 100, icon: '🗺️' },
            ],
          };
          addToJournal(discovery);
          setActiveNotification(discovery);
          setTimeout(() => setActiveNotification(null), 7000);
          return discovery;
        }

        default:
          return null;
      }
    },
    [addToJournal],
  );

  const getJournal = useCallback((): JournalEntry[] => {
    return [...journal].sort((a, b) => b.timestamp - a.timestamp);
  }, [journal]);

  const getNearbySecrets = useCallback(
    (district: string, _cellId?: string) => {
      const terrainFeatures = TERRAIN_FEATURES_DB[district] || [];
      const npcSecrets = NPC_SECRETS_DB.filter((n) => {
        const npcDistrict = n.npcId.split('-')[1];
        return npcDistrict === district;
      });
      const discoveredIds = new Set(journal.map((e) => e.discovery.id));
      const hiddenCount =
        terrainFeatures.filter((f) => !discoveredIds.has(`terrain-${f.cellId}`)).length +
        npcSecrets.filter((n) => !discoveredIds.has(`npc-${n.npcId}`)).length;

      return { terrainFeatures, npcSecrets, hiddenCount };
    },
    [journal],
  );

  const api = useMemo<SecretsDiscoveryAPI>(
    () => ({ checkDiscovery, getJournal, getNearbySecrets }),
    [checkDiscovery, getJournal, getNearbySecrets],
  );

  return (
    <SecretsDiscoveryContext.Provider value={api}>
      {children}

      {/* Discovery notification */}
      {activeNotification && (
        <div
          className={`fixed top-16 right-4 z-[9500] max-w-sm ${panel} p-4 border ${
            RARITY_COLORS[activeNotification.rarity]
          } ${RARITY_GLOW[activeNotification.rarity]}`}
          style={{
            animation: 'discoverySlideIn 0.4s ease-out',
          }}
        >
          <div className="flex items-start gap-3">
            <div className="text-2xl">
              {activeNotification.type === 'perfect-validation' && '✨'}
              {activeNotification.type === 'famous-structure-match' && '🏛️'}
              {activeNotification.type === 'terrain-feature' && '⛏️'}
              {activeNotification.type === 'npc-secret' && '🤫'}
              {activeNotification.type === 'material-composition' && '🧪'}
              {activeNotification.type === 'easter-egg' && '🥚'}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-white">{activeNotification.title}</span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded border capitalize ${
                    RARITY_COLORS[activeNotification.rarity]
                  }`}
                >
                  {activeNotification.rarity}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mb-2">{activeNotification.description}</p>
              {activeNotification.rewards.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {activeNotification.rewards.map((r, i) => (
                    <span
                      key={i}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-300"
                    >
                      {r.icon} {r.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Discovery journal panel */}
      {showJournal && (
        <div className={`fixed top-16 left-4 z-[9400] w-80 max-h-[70vh] ${panel} p-4 overflow-y-auto`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Discovery Journal</h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">{journal.length} discoveries</span>
              <button
                onClick={() => setShowJournal(false)}
                className="text-[10px] text-gray-500 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>

          {journal.length === 0 ? (
            <p className="text-xs text-gray-600">No discoveries yet. Explore the world to find secrets!</p>
          ) : (
            <div className="space-y-2">
              {getJournal().map((entry) => (
                <div
                  key={entry.discovery.id}
                  className={`p-2.5 rounded border ${RARITY_COLORS[entry.discovery.rarity]} bg-white/[0.02]`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-white">{entry.discovery.title}</span>
                    <span
                      className={`text-[8px] px-1 py-0.5 rounded capitalize ${
                        RARITY_COLORS[entry.discovery.rarity]
                      }`}
                    >
                      {entry.discovery.rarity}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mb-1">{entry.discovery.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] text-gray-600">
                      {new Date(entry.timestamp).toLocaleDateString()}
                    </span>
                    {entry.location && (
                      <span className="text-[8px] text-gray-600">
                        {entry.location.district}
                        {entry.location.cell ? ` @ ${entry.location.cell}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Journal toggle button (unobtrusive) */}
      <button
        onClick={() => setShowJournal((prev) => !prev)}
        className={`fixed top-16 left-4 z-[9300] ${panel} px-2.5 py-1.5 text-[10px] text-gray-500 hover:text-white transition-colors ${
          showJournal ? 'hidden' : ''
        }`}
        title="Discovery Journal"
      >
        📖 {journal.length > 0 && <span className="text-cyan-400 ml-1">{journal.length}</span>}
      </button>

      <style jsx>{`
        @keyframes discoverySlideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </SecretsDiscoveryContext.Provider>
  );
}
