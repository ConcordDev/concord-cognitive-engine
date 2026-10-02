'use client';

/**
 * Temporal north star — one imported series and its forecast.
 * The line is the stored values; the dash is temporal.forecast. Tooling stays under More.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { GraphFamilyPill, SERIES_LINKS } from '@/components/graph/GraphFamilyChrome';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

type DatasetSummary = { id: string; name?: string };
type ForecastPoint = { forecast?: number };

function SeriesChart({ observed, forecast }: { observed: number[]; forecast: number[] }) {
  const nums = [...observed, ...forecast].filter((n) => Number.isFinite(n));
  if (observed.length < 2 || nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const w = 640;
  const h = 180;
  const pad = 16;
  const last = observed.length + forecast.length - 1;
  const x = (i: number) => pad + (i / Math.max(1, last)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const obs = observed.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const dashed = forecast.length
    ? [observed[observed.length - 1], ...forecast].map((v, i) => `${x(observed.length - 1 + i)},${y(v)}`).join(' ')
    : '';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-44 w-full" role="img" aria-label="Imported series, forecast dashed">
      <polyline fill="none" stroke="#2dd4bf" strokeWidth="2.5" points={obs} />
      {dashed && <polyline fill="none" stroke="#c4b5fd" strokeWidth="2.5" strokeDasharray="7 6" points={dashed} />}
    </svg>
  );
}

export function TemporalNorthStar({ onOpenDesk }: { onOpenDesk: () => void }) {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [csv, setCsv] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const list = useQuery({
    queryKey: ['temporal-north', 'list'],
    queryFn: async () => {
      const r = await lensRun<{ datasets?: DatasetSummary[] }>('temporal', 'dataset-list', {});
      if (!r.data?.ok) throw new Error(r.data?.error || 'Series list failed');
      return r.data.result?.datasets ?? [];
    },
  });

  const first = list.data?.[0];
  const series = useQuery({
    queryKey: ['temporal-north', 'series', first?.id],
    enabled: !!first?.id,
    queryFn: async () => {
      const got = await lensRun<{ dataset?: { name?: string; values?: number[] } }>('temporal', 'dataset-get', { datasetId: first!.id });
      if (!got.data?.ok || !got.data.result?.dataset) throw new Error(got.data?.error || 'Series missing');
      const values = (got.data.result.dataset.values ?? []).map(Number).filter((n) => Number.isFinite(n));
      const cast = await lensRun<{ predictions?: ForecastPoint[] }>('temporal', 'forecast', { datasetId: first!.id, horizon: 8 });
      const forecast = cast.data?.ok
        ? (cast.data.result?.predictions ?? []).map((p) => Number(p.forecast)).filter((n) => Number.isFinite(n))
        : [];
      return { name: got.data.result.dataset.name || first!.name || 'Imported series', values, forecast };
    },
  });

  const save = async () => {
    if (!csv.trim()) {
      setError('Paste the series.');
      return;
    }
    setSaving(true);
    setError('');
    const r = await lensRun('temporal', 'dataset-import', { name: name.trim() || 'Imported series', csv });
    setSaving(false);
    if (!r.data?.ok) {
      setError(r.data?.error || 'Import failed.');
      return;
    }
    setComposing(false);
    setName('');
    setCsv('');
    await qc.invalidateQueries({ queryKey: ['temporal-north'] });
  };

  return (
    <LensShell lensId="temporal" asMain={false} disableAgentFab>
      <div data-lens-theme="temporal" className="relative min-h-[calc(100vh-3rem)] px-8 pb-28 pt-8">
        <div className="absolute right-8 top-8">
          <QuietMore items={[{ id: 'desk', label: 'Time-series tooling' }]} onPick={() => onOpenDesk()} />
        </div>
        <NorthGreeting kicker="Temporal" title={`What the series says${who ? `, ${who}` : ''}`} />
        <GraphFamilyPill active="temporal" links={SERIES_LINKS} />

        {list.isError && <p role="alert" className="mt-8 text-[14px] text-rose-300">Series list didn’t load.</p>}
        {list.isSuccess && !first && <p className="mt-10 text-[15px] text-zinc-500">No series yet.</p>}
        {series.data && series.data.values.length > 0 && (
          <div className="mt-8 max-w-3xl rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-3 text-[12px] text-zinc-500">{series.data.name} · forecast dashed</p>
            <SeriesChart observed={series.data.values} forecast={series.data.forecast} />
          </div>
        )}
        {series.isError && <p role="alert" className="mt-6 text-[14px] text-rose-300">This series didn’t load.</p>}

        {composing && (
          <form className="mt-6 max-w-lg space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <input
              aria-label="Series name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Series name"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
            />
            <textarea
              aria-label="Series values"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder="One value per line, or CSV"
              rows={5}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
            />
          </form>
        )}
        {error && <p role="alert" className="mt-3 text-[14px] text-rose-300">{error}</p>}
        <button type="button" className={northCtaClass} disabled={saving} onClick={() => { if (composing) void save(); else setComposing(true); }}>
          {composing ? (saving ? 'Importing…' : 'Import') : '+ Import series'}
        </button>
      </div>
    </LensShell>
  );
}
