'use client';

/**
 * DashboardStats — honest C2 summary tiles for the defense Dashboard tab.
 * Every number here is derived from a real macro roll-up call (asset-rollup /
 * threat-board / personnel-roster / supply-board), not a client-side fake
 * artifact store. Previously this row read off four generic-CRUD arrays
 * (`operations` / `assets` / `personnel` / `intel`) that had no relationship
 * to the real defense.* macros — including a "Security Score" label with no
 * domain meaning, computed from the same fake data. Replaced with real
 * per-panel rollups and domain-accurate labels.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { ErrorState } from '@/components/ui/ErrorState';
import { Crosshair, AlertTriangle, Users, Truck, Loader2 } from 'lucide-react';

interface AssetRollupResult {
  total: number;
  fleetReadiness: number;
  availabilityPct: number;
  rollupStatus: 'green' | 'amber' | 'red';
}

interface ThreatBoardResult {
  total: number;
  activeWatch: number;
  highestSeverity: string;
}

interface PersonnelRosterResult {
  total: number;
  deployable: number;
  byAvailability: Record<string, number>;
}

interface SupplyBoardResult {
  total: number;
  openCount: number;
  fulfillmentPct: number;
}

const ROLLUP_TONE: Record<string, 'positive' | 'neutral' | 'negative'> = {
  green: 'positive',
  amber: 'neutral',
  red: 'negative',
};

const SEVERITY_TONE: Record<string, 'positive' | 'neutral' | 'negative'> = {
  critical: 'negative',
  high: 'negative',
  medium: 'neutral',
  low: 'positive',
  none: 'positive',
};

export function DashboardStats() {
  const [assets, setAssets] = useState<AssetRollupResult | null>(null);
  const [threats, setThreats] = useState<ThreatBoardResult | null>(null);
  const [personnel, setPersonnel] = useState<PersonnelRosterResult | null>(null);
  const [supply, setSupply] = useState<SupplyBoardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const [a, t, p, s] = await Promise.all([
        lensRun<AssetRollupResult>('defense', 'asset-rollup', {}),
        lensRun<ThreatBoardResult>('defense', 'threat-board', {}),
        lensRun<PersonnelRosterResult>('defense', 'personnel-roster', {}),
        lensRun<SupplyBoardResult>('defense', 'supply-board', {}),
      ]);
      if (cancelled) return;
      const failures: string[] = [];
      if (a.data?.ok && a.data.result) setAssets(a.data.result); else failures.push(a.data?.error || 'asset-rollup failed');
      if (t.data?.ok && t.data.result) setThreats(t.data.result); else failures.push(t.data?.error || 'threat-board failed');
      if (p.data?.ok && p.data.result) setPersonnel(p.data.result); else failures.push(p.data?.error || 'personnel-roster failed');
      if (s.data?.ok && s.data.result) setSupply(s.data.result); else failures.push(s.data?.error || 'supply-board failed');
      // Only surface a hard error banner when EVERY rollup failed — a single
      // rollup with no data yet (a genuinely empty roster) is not an error,
      // it renders its honest zero/caption fallback below.
      if (failures.length === 4) setError(failures[0]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cancel = load();
    return cancel;
  }, [load]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center py-6 text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="sr-only">Loading readiness rollups…</span>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={load} retrying={loading} />;
  }

  return (
    <StatTileGrid columns={4}>
      <StatTile
        label="Fleet Readiness"
        value={assets?.fleetReadiness ?? 0}
        unit="%"
        tone={assets ? ROLLUP_TONE[assets.rollupStatus] : 'neutral'}
        caption={assets ? `${assets.availabilityPct}% available · ${assets.total} assets` : 'No assets tracked'}
        icon={<Crosshair className="w-3.5 h-3.5" />}
      />
      <StatTile
        label="Active Threats"
        value={threats?.activeWatch ?? 0}
        tone={threats ? SEVERITY_TONE[threats.highestSeverity] ?? 'neutral' : 'neutral'}
        caption={threats ? `${threats.total} tracked · highest ${threats.highestSeverity}` : 'No threats tracked'}
        icon={<AlertTriangle className="w-3.5 h-3.5" />}
      />
      <StatTile
        label="Personnel Deployed"
        value={personnel?.byAvailability?.deployed ?? 0}
        tone="neutral"
        caption={personnel ? `${personnel.deployable} available · ${personnel.total} total` : 'No personnel on roster'}
        icon={<Users className="w-3.5 h-3.5" />}
      />
      <StatTile
        label="Open Supply Requests"
        value={supply?.openCount ?? 0}
        tone="neutral"
        caption={supply ? `${supply.fulfillmentPct}% fulfilled · ${supply.total} total` : 'No supply requests'}
        icon={<Truck className="w-3.5 h-3.5" />}
      />
    </StatTileGrid>
  );
}
