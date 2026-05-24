'use client';

import React, { useState } from 'react';
import {
  Store, GraduationCap, Factory, Landmark, TreePine, Search,
  Zap, Mountain, Ship, Swords, Globe, Users, ChevronRight,
  Activity,
} from 'lucide-react';

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

const CONCORDIA_DISTRICTS: ConcordiaDistrict[] = [
  {
    id: 'exchange', name: 'The Exchange', description: 'Economic hub — marketplace, trading floor, auctions',
    lens: 'marketplace', icon: Store, color: '#F59E0B', buildingCount: 24, population: 1800, activeUsers: 42,
  },
  {
    id: 'academy', name: 'The Academy', description: 'Education — libraries, lecture halls, research labs',
    lens: 'education', icon: GraduationCap, color: '#3B82F6', buildingCount: 18, population: 1200, activeUsers: 28,
  },
  {
    id: 'forge', name: 'The Forge', description: 'Manufacturing — factories, workshops, material processing',
    lens: 'manufacturing', icon: Factory, color: '#EF4444', buildingCount: 15, population: 900, activeUsers: 19,
  },
  {
    id: 'nexus', name: 'The Nexus', description: 'Governance — policy debates, voting halls, district management',
    lens: 'government', icon: Landmark, color: '#8B5CF6', buildingCount: 12, population: 600, activeUsers: 15,
  },
  {
    id: 'commons', name: 'The Commons', description: 'Social space — parks, amphitheaters, event grounds',
    lens: 'forum', icon: TreePine, color: '#22C55E', buildingCount: 20, population: 2000, activeUsers: 55,
  },
  {
    id: 'observatory', name: 'The Observatory', description: 'Science — telescopes, physics labs, astronomy',
    lens: 'physics', icon: Search, color: '#06B6D4', buildingCount: 8, population: 400, activeUsers: 12,
  },
  {
    id: 'grid', name: 'The Grid', description: 'Infrastructure — power plants, water treatment, telecom',
    lens: 'energy', icon: Zap, color: '#FBBF24', buildingCount: 10, population: 300, activeUsers: 8,
  },
  {
    id: 'frontier', name: 'The Frontier', description: 'Edge of Concordia — new district founding',
    lens: 'geology', icon: Mountain, color: '#78716C', buildingCount: 5, population: 150, activeUsers: 6,
  },
  {
    id: 'docks', name: 'The Docks', description: 'Maritime — shipyards, ports, naval architecture',
    lens: 'ocean', icon: Ship, color: '#0EA5E9', buildingCount: 7, population: 350, activeUsers: 10,
  },
  {
    id: 'arena', name: 'The Arena', description: 'Competitive — stress tests, design battles, challenges',
    lens: 'sim', icon: Swords, color: '#DC2626', buildingCount: 6, population: 500, activeUsers: 35,
  },
];

interface LiveFeedEvent {
  id: string;
  type: 'building' | 'material' | 'discovery' | 'event' | 'trade' | 'validation';
  message: string;
  district: string;
  lens: string;
  timestamp: string;
}

const SEED_FEED: LiveFeedEvent[] = [
  { id: 'f1', type: 'building', message: '@architect_alex placed "Community Library" in The Academy', district: 'academy', lens: 'education', timestamp: '2m ago' },
  { id: 'f2', type: 'material', message: 'New material "USB-G Composite" published by @materials_lab', district: 'forge', lens: 'materials', timestamp: '8m ago' },
  { id: 'f3', type: 'trade', message: '342 citations earned by @engineer_jane this hour', district: 'exchange', lens: 'marketplace', timestamp: '12m ago' },
  { id: 'f4', type: 'validation', message: 'Seismic retest passed for "Solar Tower" in The Grid', district: 'grid', lens: 'energy', timestamp: '15m ago' },
  { id: 'f5', type: 'event', message: 'Design Battle: "Best Bridge Under 500kg" starts in 2h', district: 'arena', lens: 'sim', timestamp: '20m ago' },
  { id: 'f6', type: 'discovery', message: 'Geology survey reveals aquifer beneath The Frontier', district: 'frontier', lens: 'geology', timestamp: '25m ago' },
  { id: 'f7', type: 'building', message: '@power_mike upgraded Wind Turbine Array in The Grid', district: 'grid', lens: 'energy', timestamp: '30m ago' },
  { id: 'f8', type: 'event', message: 'Lecture: "Advanced Seismic Design" at The Academy Auditorium', district: 'academy', lens: 'education', timestamp: '45m ago' },
];

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

  const totalPop = CONCORDIA_DISTRICTS.reduce((s, d) => s + d.population, 0);
  const totalBuildings = CONCORDIA_DISTRICTS.reduce((s, d) => s + d.buildingCount, 0);
  const totalActive = CONCORDIA_DISTRICTS.reduce((s, d) => s + d.activeUsers, 0);

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
        {CONCORDIA_DISTRICTS.map(d => {
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
        const d = CONCORDIA_DISTRICTS.find(d => d.id === selectedDistrict);
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
          {SEED_FEED.map(event => (
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
