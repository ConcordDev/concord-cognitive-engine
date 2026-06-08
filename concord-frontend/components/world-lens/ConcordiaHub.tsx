'use client';

import React, { useState, useEffect } from 'react';
import {
  Store, GraduationCap, Factory, Landmark, TreePine, Search,
  Zap, Mountain, Ship, Swords, Globe, Users, ChevronRight,
  Activity,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

export interface ConcordiaDistrict {
  id: string;
  name: string;
  description: string;
  lens: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  buildingCount: number;
  population: number;
  activeUsers: number;
}

// Authored district layout (static config — the named districts of Concordia
// and which lens each maps to). KEEP this layout. Runtime stats
// (buildingCount / population / activeUsers) are NOT hardcoded — they default
// to 0 and are populated from the real `hub` lens-action domain
// (`district-stats` / `hub-totals`) via the effect below. They stay 0 honestly
// until real data exists.
const DISTRICT_LAYOUT: Omit<ConcordiaDistrict, 'buildingCount' | 'population' | 'activeUsers'>[] = [
  { id: 'exchange', name: 'The Exchange', description: 'Economic hub — marketplace, trading floor, auctions', lens: 'marketplace', icon: Store, color: '#F59E0B' },
  { id: 'academy', name: 'The Academy', description: 'Education — libraries, lecture halls, research labs', lens: 'education', icon: GraduationCap, color: '#3B82F6' },
  { id: 'forge', name: 'The Forge', description: 'Manufacturing — factories, workshops, material processing', lens: 'manufacturing', icon: Factory, color: '#EF4444' },
  { id: 'nexus', name: 'The Nexus', description: 'Governance — policy debates, voting halls, district management', lens: 'government', icon: Landmark, color: '#8B5CF6' },
  { id: 'commons', name: 'The Commons', description: 'Social space — parks, amphitheaters, event grounds', lens: 'forum', icon: TreePine, color: '#22C55E' },
  { id: 'observatory', name: 'The Observatory', description: 'Science — telescopes, physics labs, astronomy', lens: 'physics', icon: Search, color: '#06B6D4' },
  { id: 'grid', name: 'The Grid', description: 'Infrastructure — power plants, water treatment, telecom', lens: 'energy', icon: Zap, color: '#FBBF24' },
  { id: 'frontier', name: 'The Frontier', description: 'Edge of Concordia — new district founding', lens: 'geology', icon: Mountain, color: '#78716C' },
  { id: 'docks', name: 'The Docks', description: 'Maritime — shipyards, ports, naval architecture', lens: 'ocean', icon: Ship, color: '#0EA5E9' },
  { id: 'arena', name: 'The Arena', description: 'Competitive — stress tests, design battles, challenges', lens: 'sim', icon: Swords, color: '#DC2626' },
];

// Districts with runtime stats zeroed — honest defaults until the real
// `district-stats` macro returns data (populated in the effect below).
const CONCORDIA_DISTRICTS: ConcordiaDistrict[] = DISTRICT_LAYOUT.map((d) => ({
  ...d, buildingCount: 0, population: 0, activeUsers: 0,
}));

interface BackendDistrictStats {
  districtId?: string;
  buildingCount?: number;
  population?: number;
  activeUsers?: number;
}

interface BackendActivityEvent {
  id?: string;
  districtId?: string | null;
  kind?: string;
  actor?: string | null;
  summary?: string;
  at?: string | null;
}

interface LiveFeedEvent {
  id: string;
  type: 'building' | 'material' | 'discovery' | 'event' | 'trade' | 'validation';
  message: string;
  district: string;
  lens: string;
  timestamp: string;
}

const FEED_TYPE_COLORS: Record<string, string> = {
  building: 'text-cyan-400',
  material: 'text-purple-400',
  discovery: 'text-green-400',
  event: 'text-yellow-400',
  trade: 'text-orange-400',
  validation: 'text-blue-400',
};

interface ConcordiaHubProps {
  onDistrictSelect: (district: ConcordiaDistrict) => void;
  onNavigateToLens: (lens: string) => void;
}

export default function ConcordiaHub({ onDistrictSelect, onNavigateToLens }: ConcordiaHubProps) {
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  // District runtime stats — start from the authored layout (zeroed) and fill
  // in real counts from the `hub` lens-action domain. Stays 0 honestly when no
  // source data exists.
  const [districts, setDistricts] = useState<ConcordiaDistrict[]>(CONCORDIA_DISTRICTS);

  // Live feed starts empty — populated from the real `hub.activity-feed` macro
  // (recorded hub activity + world_events). Honest empty state below.
  const [feed, setFeed] = useState<LiveFeedEvent[]>([]);

  // Pull real per-district stats for every authored district on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          DISTRICT_LAYOUT.map((d) => lensRun('hub', 'district-stats', { districtId: d.id })),
        );
        if (cancelled) return;
        setDistricts(
          DISTRICT_LAYOUT.map((d, i): ConcordiaDistrict => {
            const stats = (results[i]?.data?.result as BackendDistrictStats) || {};
            return {
              ...d,
              buildingCount: Number(stats.buildingCount) || 0,
              population: Number(stats.population) || 0,
              activeUsers: Number(stats.activeUsers) || 0,
            };
          }),
        );
      } catch {
        if (!cancelled) setDistricts(CONCORDIA_DISTRICTS);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pull the real activity feed — scoped to the selected district when one is
  // chosen, world-wide otherwise. Empty when no source has data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const input = selectedDistrict ? { districtId: selectedDistrict, limit: 50 } : { limit: 50 };
        const r = await lensRun('hub', 'activity-feed', input);
        const rows = (r.data?.result?.events as BackendActivityEvent[]) || [];
        if (cancelled) return;
        setFeed(
          rows.map((e, i): LiveFeedEvent => ({
            id: e.id || `feed-${i}`,
            type: (e.kind as LiveFeedEvent['type']) || 'event',
            message: e.summary || '',
            district: e.districtId || '',
            lens: '',
            timestamp: e.at || '',
          })),
        );
      } catch {
        if (!cancelled) setFeed([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDistrict]);

  const totalPop = districts.reduce((s, d) => s + d.population, 0);
  const totalBuildings = districts.reduce((s, d) => s + d.buildingCount, 0);
  const totalActive = districts.reduce((s, d) => s + d.activeUsers, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="w-6 h-6 text-cyan-400" />
          <div>
            <h2 className="text-lg font-bold text-white">Concordia</h2>
            <p className="text-xs text-gray-400">The shared central world — everything built by users, validated by physics</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5 text-green-400" /> {totalActive} online</span>
          <span>{totalBuildings} buildings</span>
          <span>Pop: {totalPop.toLocaleString()}</span>
        </div>
      </div>

      {/* District Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {districts.map(d => {
          const Icon = d.icon;
          const isSelected = selectedDistrict === d.id;
          return (
            <button
              key={d.id}
              onClick={() => {
                setSelectedDistrict(d.id);
                onDistrictSelect(d);
              }}
              className={`p-3 rounded-lg border text-left transition-all ${
                isSelected
                  ? 'border-cyan-500/50 bg-cyan-500/10'
                  : 'border-white/10 hover:border-white/20 hover:bg-white/5'
              }`}
            >
              <span style={{ color: d.color }}><Icon className="w-5 h-5 mb-1" /></span>
              <p className="text-xs font-medium text-white">{d.name}</p>
              <p className="text-[9px] text-gray-400 mt-0.5 line-clamp-2">{d.description}</p>
              <div className="flex items-center justify-between mt-2 text-[9px] text-gray-400">
                <span>{d.buildingCount} bldgs</span>
                <span className="text-green-500">{d.activeUsers} online</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected district detail */}
      {selectedDistrict && (() => {
        const d = districts.find(d => d.id === selectedDistrict);
        if (!d) return null;
        const Icon = d.icon;
        return (
          <div className={`${panel} p-4`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span style={{ color: d.color }}><Icon className="w-5 h-5" /></span>
                <h3 className="text-sm font-semibold text-white">{d.name}</h3>
              </div>
              <button
                onClick={() => onNavigateToLens(d.lens)}
                className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300"
              >
                Open {d.lens} lens <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">{d.description}</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 rounded bg-white/5 text-center">
                <p className="text-gray-400">Buildings</p>
                <p className="font-bold text-white">{d.buildingCount}</p>
              </div>
              <div className="p-2 rounded bg-white/5 text-center">
                <p className="text-gray-400">Population</p>
                <p className="font-bold text-white">{d.population}</p>
              </div>
              <div className="p-2 rounded bg-white/5 text-center">
                <p className="text-gray-400">Online</p>
                <p className="font-bold text-green-400">{d.activeUsers}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Live Feed */}
      <div className={`${panel} p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold text-gray-300">Live World Feed</h3>
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {feed.length === 0 && (
            <p className="text-[10px] text-gray-500 italic py-2">No recent activity.</p>
          )}
          {feed.map(event => (
            <div key={event.id} className="flex items-start gap-2 text-[10px]">
              <span className={`mt-0.5 ${FEED_TYPE_COLORS[event.type] || 'text-gray-400'}`}>
                {event.type === 'building' && '🏗'}
                {event.type === 'material' && '🧪'}
                {event.type === 'trade' && '💰'}
                {event.type === 'validation' && '✅'}
                {event.type === 'event' && '📢'}
                {event.type === 'discovery' && '🔍'}
              </span>
              <div className="flex-1">
                <p className="text-gray-300">{event.message}</p>
                <p className="text-gray-600">{event.timestamp}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
