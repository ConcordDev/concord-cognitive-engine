'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Loader2, Heart, Stethoscope, DollarSign, RefreshCw } from 'lucide-react';
import { SPECIES_EMOJI } from './vet-types';

interface DashboardData {
  patients: number;
  visits: number;
  revenue: number;
  bySpecies: Record<string, number>;
}

export function DashboardPanel({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('veterinary', 'vet-dashboard', {});
    if (r.data.ok && r.data.result) {
      setData(r.data.result as DashboardData);
      setError(null);
    } else {
      setError(r.data.error || 'failed to load dashboard');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const speciesChart = data
    ? Object.entries(data.bySpecies).map(([species, count]) => ({
        species: `${SPECIES_EMOJI[species] || '🐾'} ${species}`,
        count,
      }))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Practice overview</h3>
        <button
          onClick={load}
          className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading dashboard…
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat
              icon={<Heart className="h-5 w-5 text-pink-400" />}
              label="Patients"
              value={data.patients}
              bg="bg-pink-400/10"
            />
            <Stat
              icon={<Stethoscope className="h-5 w-5 text-blue-400" />}
              label="Visits logged"
              value={data.visits}
              bg="bg-blue-400/10"
            />
            <Stat
              icon={<DollarSign className="h-5 w-5 text-emerald-400" />}
              label="Revenue"
              value={`$${data.revenue.toFixed(2)}`}
              bg="bg-emerald-400/10"
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Patients by species
            </p>
            {speciesChart.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-600">
                Register patients to populate this chart.
              </p>
            ) : (
              <ChartKit
                kind="bar"
                data={speciesChart}
                xKey="species"
                series={[{ key: 'count', label: 'Patients', color: '#ec4899' }]}
                height={220}
                showLegend={false}
              />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  bg: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>{icon}</div>
      <div>
        <p className="text-lg font-bold text-white">{value}</p>
        <p className="text-xs text-zinc-400">{label}</p>
      </div>
    </div>
  );
}
