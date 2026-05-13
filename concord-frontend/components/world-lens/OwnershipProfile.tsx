'use client';

import React, { useCallback, useMemo, useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────── */

interface DTUEntry {
  id: string;
  name: string;
  type: string;
  district: string;
  citationCount: number;
  royaltyTotal: number;
  viewCount: number;
  placedAt: string;
  thumbnailColor: string;
  validationStatus: 'validated' | 'experimental' | 'at-risk';
}

interface TerritoryContribution {
  districtId: string;
  districtName: string;
  contributionPercent: number;
  buildingCount: number;
  color: string;
}

interface TourStop {
  buildingId: string;
  buildingName: string;
  description: string;
  order: number;
}

interface LegacyData {
  foundedAt: string;
  majorWorks: { date: string; title: string; description: string }[];
  apprenticesTrained: number;
  totalImpact: number;
  totalCitations: number;
  totalRoyalties: number;
  totalBuildings: number;
}

interface FirmTerritory {
  firmName: string;
  districts: { districtId: string; dominancePercent: number }[];
}

interface OwnershipProfileProps {
  userId?: string;
  portfolio?: DTUEntry[];
  contributions?: TerritoryContribution[];
  legacy?: LegacyData;
  firmTerritory?: FirmTerritory;
}

/* ── Constants ────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const STATUS_STYLES: Record<string, string> = {
  validated: 'bg-green-500/20 text-green-400 border-green-500/40',
  experimental: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  'at-risk': 'bg-red-500/20 text-red-400 border-red-500/40',
};

/* ── Component ────────────────────────────────────────────────── */

type TabId = 'creations' | 'territory' | 'legacy' | 'tour';

export default function OwnershipProfile({
  userId,
  portfolio = [],
  contributions = [],
  legacy,
  firmTerritory,
}: OwnershipProfileProps) {
  const [activeTab, setActiveTab] = useState<TabId>('creations');
  const [tourStops, setTourStops] = useState<TourStop[]>([]);
  const [editingTour, setEditingTour] = useState(false);
  const [sortBy, setSortBy] = useState<'citations' | 'royalties' | 'views' | 'date'>('citations');

  /* ── Computed values ──────────────────────────────────────────── */

  const sortedPortfolio = useMemo(() => {
    const sorted = [...portfolio];
    switch (sortBy) {
      case 'citations':
        return sorted.sort((a, b) => b.citationCount - a.citationCount);
      case 'royalties':
        return sorted.sort((a, b) => b.royaltyTotal - a.royaltyTotal);
      case 'views':
        return sorted.sort((a, b) => b.viewCount - a.viewCount);
      case 'date':
        return sorted.sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
      default:
        return sorted;
    }
  }, [portfolio, sortBy]);

  const topCited = useMemo(
    () => [...portfolio].sort((a, b) => b.citationCount - a.citationCount).slice(0, 5),
    [portfolio],
  );
  const topProfitable = useMemo(
    () => [...portfolio].sort((a, b) => b.royaltyTotal - a.royaltyTotal).slice(0, 5),
    [portfolio],
  );
  const topViewed = useMemo(
    () => [...portfolio].sort((a, b) => b.viewCount - a.viewCount).slice(0, 5),
    [portfolio],
  );

  const emotionalOwnership = useMemo(() => {
    if (!legacy) return 0;
    const buildingScore = Math.min(1, legacy.totalBuildings / 50) * 0.3;
    const citationScore = Math.min(1, legacy.totalCitations / 200) * 0.25;
    const timeScore = Math.min(1, (Date.now() - new Date(legacy.foundedAt).getTime()) / (365 * 24 * 60 * 60 * 1000)) * 0.2;
    const apprenticeScore = Math.min(1, legacy.apprenticesTrained / 10) * 0.15;
    const impactScore = Math.min(1, legacy.totalImpact / 1000) * 0.1;
    return Math.round((buildingScore + citationScore + timeScore + apprenticeScore + impactScore) * 100);
  }, [legacy]);

  /* ── Tour builder ─────────────────────────────────────────────── */

  const addTourStop = useCallback((building: DTUEntry) => {
    setTourStops((prev) => {
      if (prev.some((s) => s.buildingId === building.id)) return prev;
      return [...prev, {
        buildingId: building.id,
        buildingName: building.name,
        description: '',
        order: prev.length + 1,
      }];
    });
  }, []);

  const removeTourStop = useCallback((buildingId: string) => {
    setTourStops((prev) =>
      prev
        .filter((s) => s.buildingId !== buildingId)
        .map((s, i) => ({ ...s, order: i + 1 })),
    );
  }, []);

  const updateTourDescription = useCallback((buildingId: string, description: string) => {
    setTourStops((prev) =>
      prev.map((s) => (s.buildingId === buildingId ? { ...s, description } : s)),
    );
  }, []);

  /* ── Tabs ─────────────────────────────────────────────────────── */

  const tabs: { id: TabId; label: string }[] = [
    { id: 'creations', label: 'My Creations' },
    { id: 'territory', label: 'Territory' },
    { id: 'legacy', label: 'Legacy' },
    { id: 'tour', label: 'Guided Tour' },
  ];

  return (
    <div className={`${panel} p-4 w-full max-w-2xl`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-white">Ownership Profile</h2>
          {userId && <p className="text-[10px] text-gray-500">@{userId}</p>}
        </div>
        <div className="flex items-center gap-2">
          {emotionalOwnership > 0 && (
            <div className="text-right">
              <span className="text-[9px] text-gray-500 block">Ownership Score</span>
              <span className="text-sm font-bold text-cyan-400">{emotionalOwnership}</span>
            </div>
          )}
          <button
            onClick={() => { window.dispatchEvent(new CustomEvent('ownership:share-profile')); }}
            className="text-[10px] px-2 py-1 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors"
          >
            Share Profile
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-white/5 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`text-[10px] px-3 py-1.5 rounded-t transition-colors ${
              activeTab === tab.id
                ? 'text-white bg-white/10 border-b-2 border-cyan-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content: My Creations */}
      {activeTab === 'creations' && (
        <div>
          {/* Sort controls */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] text-gray-500">Sort by:</span>
            {(['citations', 'royalties', 'views', 'date'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`text-[9px] px-2 py-0.5 rounded transition-colors ${
                  sortBy === s
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                    : 'text-gray-500 hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Portfolio grid */}
          <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
            {sortedPortfolio.map((dtu) => (
              <div
                key={dtu.id}
                className="p-2.5 rounded bg-white/[0.03] border border-white/5 hover:border-white/15 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div
                    className="w-8 h-8 rounded"
                    style={{ backgroundColor: dtu.thumbnailColor || '#333' }}
                  />
                  <span className={`text-[8px] px-1 py-0.5 rounded border ${STATUS_STYLES[dtu.validationStatus]}`}>
                    {dtu.validationStatus}
                  </span>
                </div>
                <p className="text-[10px] font-medium text-white truncate">{dtu.name}</p>
                <p className="text-[8px] text-gray-600 truncate">{dtu.district} · {dtu.type}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[8px] text-cyan-400">{dtu.citationCount} cited</span>
                  <span className="text-[8px] text-yellow-400">{dtu.royaltyTotal.toLocaleString()} earned</span>
                </div>
                {editingTour && (
                  <button
                    onClick={(e) => { e.stopPropagation(); addTourStop(dtu); }}
                    className="mt-1 text-[8px] text-gray-500 hover:text-cyan-400 transition-colors"
                  >
                    + Add to tour
                  </button>
                )}
              </div>
            ))}
          </div>

          {portfolio.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-6">No creations yet. Start building!</p>
          )}

          {/* Portfolio highlights */}
          {portfolio.length > 0 && (
            <div className="mt-4 pt-3 border-t border-white/5">
              <h4 className="text-[10px] font-semibold text-gray-400 mb-2">Highlights</h4>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 rounded bg-white/[0.03]">
                  <p className="text-[8px] text-gray-500 mb-1">Most Cited</p>
                  {topCited.slice(0, 2).map((d) => (
                    <p key={d.id} className="text-[9px] text-cyan-400 truncate">{d.name} ({d.citationCount})</p>
                  ))}
                </div>
                <div className="p-2 rounded bg-white/[0.03]">
                  <p className="text-[8px] text-gray-500 mb-1">Most Profitable</p>
                  {topProfitable.slice(0, 2).map((d) => (
                    <p key={d.id} className="text-[9px] text-yellow-400 truncate">{d.name} ({d.royaltyTotal})</p>
                  ))}
                </div>
                <div className="p-2 rounded bg-white/[0.03]">
                  <p className="text-[8px] text-gray-500 mb-1">Most Viewed</p>
                  {topViewed.slice(0, 2).map((d) => (
                    <p key={d.id} className="text-[9px] text-purple-400 truncate">{d.name} ({d.viewCount})</p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Territory */}
      {activeTab === 'territory' && (
        <div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {contributions.map((c) => (
              <div key={c.districtId} className="flex items-center gap-3 p-2 rounded bg-white/[0.03]">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-white">{c.districtName}</span>
                    <span className="text-[10px] text-cyan-400">{c.contributionPercent.toFixed(1)}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/10 mt-1 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${c.contributionPercent}%`, backgroundColor: c.color }}
                    />
                  </div>
                  <span className="text-[8px] text-gray-600">{c.buildingCount} buildings</span>
                </div>
              </div>
            ))}
          </div>

          {contributions.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-6">No territory contributions yet.</p>
          )}

          {/* Firm territory */}
          {firmTerritory && (
            <div className="mt-4 pt-3 border-t border-white/5">
              <h4 className="text-[10px] font-semibold text-gray-400 mb-2">
                Firm: {firmTerritory.firmName}
              </h4>
              <div className="space-y-1">
                {firmTerritory.districts.map((d) => (
                  <div key={d.districtId} className="flex items-center justify-between text-[9px]">
                    <span className="text-gray-500 capitalize">{d.districtId}</span>
                    <span className={d.dominancePercent > 50 ? 'text-cyan-400 font-medium' : 'text-gray-500'}>
                      {d.dominancePercent.toFixed(1)}% dominance
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Legacy */}
      {activeTab === 'legacy' && (
        <div>
          {legacy ? (
            <>
              {/* Stats grid */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                  { label: 'Buildings', value: legacy.totalBuildings, color: 'text-white' },
                  { label: 'Citations', value: legacy.totalCitations, color: 'text-cyan-400' },
                  { label: 'Royalties', value: legacy.totalRoyalties.toLocaleString(), color: 'text-yellow-400' },
                  { label: 'Apprentices', value: legacy.apprenticesTrained, color: 'text-purple-400' },
                ].map((stat) => (
                  <div key={stat.label} className="p-2 rounded bg-white/[0.03] text-center">
                    <p className={`text-sm font-bold ${stat.color}`}>{stat.value}</p>
                    <p className="text-[8px] text-gray-500">{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* Founded date */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-gray-500">Founded</span>
                <span className="text-[10px] text-white">{legacy.foundedAt}</span>
              </div>

              {/* Impact score */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500">Total Impact</span>
                  <span className="text-xs font-bold text-cyan-300">{legacy.totalImpact.toLocaleString()}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500"
                    style={{ width: `${Math.min(100, legacy.totalImpact / 10)}%` }}
                  />
                </div>
              </div>

              {/* Major works timeline */}
              <h4 className="text-[10px] font-semibold text-gray-400 mb-2">Major Works</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {legacy.majorWorks.map((work, i) => (
                  <div key={i} className="flex gap-2 p-2 rounded bg-white/[0.03]">
                    <div className="flex flex-col items-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                      {i < legacy.majorWorks.length - 1 && (
                        <div className="w-px flex-1 bg-white/10 mt-0.5" />
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-medium text-white">{work.title}</p>
                      <p className="text-[8px] text-gray-500">{work.date}</p>
                      <p className="text-[9px] text-gray-400 mt-0.5">{work.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-600 text-center py-6">No legacy data available.</p>
          )}
        </div>
      )}

      {/* Tab Content: Guided Tour */}
      {activeTab === 'tour' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] text-gray-500">
              Select stops from your creations to build a guided walkthrough.
            </p>
            <button
              onClick={() => setEditingTour((prev) => !prev)}
              className={`text-[9px] px-2 py-1 rounded border transition-colors ${
                editingTour
                  ? 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10'
                  : 'border-white/10 text-gray-500 hover:text-white'
              }`}
            >
              {editingTour ? 'Done Editing' : 'Edit Tour'}
            </button>
          </div>

          {tourStops.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {tourStops.map((stop) => (
                <div key={stop.buildingId} className="flex items-start gap-2 p-2 rounded bg-white/[0.03]">
                  <span className="text-[10px] text-cyan-400 font-bold w-4 flex-shrink-0">
                    {stop.order}
                  </span>
                  <div className="flex-1">
                    <p className="text-[10px] font-medium text-white">{stop.buildingName}</p>
                    {editingTour ? (
                      <input
                        type="text"
                        value={stop.description}
                        onChange={(e) => updateTourDescription(stop.buildingId, e.target.value)}
                        placeholder="Add description..."
                        className="mt-1 w-full text-[9px] bg-transparent border-b border-white/10 text-gray-300 focus:outline-none focus:border-cyan-500/40 pb-0.5"
                      />
                    ) : (
                      stop.description && (
                        <p className="text-[9px] text-gray-500 mt-0.5">{stop.description}</p>
                      )
                    )}
                  </div>
                  {editingTour && (
                    <button
                      onClick={() => removeTourStop(stop.buildingId)}
                      className="text-[9px] text-red-400/50 hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-600 text-center py-6">
              No tour stops yet. Switch to &quot;My Creations&quot; tab and click &quot;Edit Tour&quot; to add stops.
            </p>
          )}

          {tourStops.length > 0 && (
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('ownership:walk-tour', { detail: { stopCount: tourStops.length } })); }}
              className="mt-3 w-full text-[10px] py-2 rounded border border-cyan-500/30 text-cyan-400 bg-cyan-500/5 hover:bg-cyan-500/10 transition-colors"
            >
              Walk Through My Work
            </button>
          )}
        </div>
      )}

      {/* Shareable profile card (compact preview) */}
      <div className="mt-4 pt-3 border-t border-white/5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-gray-600">
            {portfolio.length} creations · {contributions.reduce((a, c) => a + c.buildingCount, 0)} placements
          </span>
          <button
            onClick={() => { window.dispatchEvent(new CustomEvent('ownership:generate-share-card')); }}
            className="text-[9px] text-gray-500 hover:text-cyan-400 transition-colors"
          >
            Generate Share Card
          </button>
        </div>
      </div>
    </div>
  );
}
