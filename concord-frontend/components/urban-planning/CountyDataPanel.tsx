'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Building2, Loader2, BarChart3, Home, Wallet } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface CensusData {
  stateFips: string; countyFips: string; year: number;
  countyName?: string;
  totalPopulation?: number;
  medianHouseholdIncome?: number;
  medianAge?: number;
  bachelorsPlusPct?: number | null;
  // The server macro returns ownerOccupiedPct — this interface previously
  // declared ownerPct, a field the server never sends, so the
  // Owner-occupied cell rendered blank on every pull (Review 5 F2).
  ownerOccupiedPct?: number | null;
  longCommutePct?: number | null;
  totalCommuters?: number;
  source?: string;
}
// HUD tiers arrive shaped by the server into household-size rows
// ({ householdSize, limit }) — the raw il*_pNp API keys never reach this
// panel (Review 5 F2). The legacy object shape is still tolerated here so
// the panel degrades gracefully against an older server deploy.
interface HudTierRow { householdSize: number; limit: number }
type HudTier = HudTierRow[] | Record<string, number> | null | undefined;
interface HudData { areaName?: string; medianIncome?: number; veryLowIncome50Pct?: HudTier; extremelyLowIncome30Pct?: HudTier; lowIncome80Pct?: HudTier; year: number }

function tierRows(tier: HudTier): HudTierRow[] {
  if (!tier) return [];
  if (Array.isArray(tier)) return tier;
  const rows: HudTierRow[] = [];
  for (const [k, v] of Object.entries(tier)) {
    const m = /p(\d+)p/i.exec(k) || /^(\d+)$/.exec(k.trim());
    if (m && Number.isFinite(v)) rows.push({ householdSize: Number(m[1]), limit: v });
  }
  return rows.sort((a, b) => a.householdSize - b.householdSize);
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('urban-planning', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const PRESETS: { label: string; stateFips: string; countyFips: string; stateAbbr: string }[] = [
  { label: 'Manhattan, NY', stateFips: '36', countyFips: '061', stateAbbr: 'NY' },
  { label: 'Cook, IL', stateFips: '17', countyFips: '031', stateAbbr: 'IL' },
  { label: 'Los Angeles, CA', stateFips: '06', countyFips: '037', stateAbbr: 'CA' },
  { label: 'Harris, TX', stateFips: '48', countyFips: '201', stateAbbr: 'TX' },
  { label: 'King, WA', stateFips: '53', countyFips: '033', stateAbbr: 'WA' },
  { label: 'Miami-Dade, FL', stateFips: '12', countyFips: '086', stateAbbr: 'FL' },
];

export function CountyDataPanel() {
  const [preset, setPreset] = useState(PRESETS[0]);
  const [census, setCensus] = useState<CensusData | null>(null);
  const [hud, setHud] = useState<HudData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hudError, setHudError] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => {
      setError(null); setHudError(null);
      const env = await callMacro<CensusData>('census-acs-county', { stateFips: preset.stateFips, countyFips: preset.countyFips });
      if (env.ok && env.result) setCensus(env.result); else { setCensus(null); setError(env.error || 'census failed'); }
      const h = await callMacro<HudData>('hud-income-limits', { stateAbbr: preset.stateAbbr, countyFips: preset.countyFips });
      if (h.ok && h.result) setHud(h.result); else { setHud(null); setHudError(h.error || 'hud unavailable'); }
    },
  });

  const fmtCurrency = (v?: number) => v ? `$${v.toLocaleString()}` : '—';
  const familySize = (size: number) => (size === 1 ? '1 person' : `${size} people`);
  const tierLine = (label: string, tier: HudTier) => {
    const rows = tierRows(tier);
    return rows.length ? `${label}: ${rows.map((r) => `${familySize(r.householdSize)} ${fmtCurrency(r.limit)}`).join(' · ')}` : `${label}: —`;
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">County Data</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">census acs 5-yr · hud income limits</span>
        </div>
      </header>

      <p className="text-[11px] text-zinc-400">
        Six preset metro counties. Figures are fetched live from US Census ACS and HUD on each pull — counties outside the six presets are not covered yet.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select value={`${preset.stateFips}-${preset.countyFips}`} onChange={(e) => { const p = PRESETS.find((x) => `${x.stateFips}-${x.countyFips}` === e.target.value); if (p) setPreset(p); }} className="flex-1 min-w-[200px] rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
          {PRESETS.map((p) => <option key={`${p.stateFips}-${p.countyFips}`} value={`${p.stateFips}-${p.countyFips}`}>{p.label}</option>)}
        </select>
        <button onClick={() => load.mutate()} disabled={load.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
          Pull county data
        </button>
        {(census || hud) && (
          <SaveAsDtuButton
            compact
            apiSource="census-hud"
            title={`${preset.label} county snapshot (ACS ${census?.year}, HUD ${hud?.year})`}
            content={`${preset.label}\n\nCensus ACS:\n  Pop ${census?.totalPopulation?.toLocaleString()}\n  Median income ${fmtCurrency(census?.medianHouseholdIncome)}\n  Median age ${census?.medianAge}\n  Bach+: ${census?.bachelorsPlusPct}%\n  Owner-occupied: ${census?.ownerOccupiedPct}%\n  Long commute (60+min): ${census?.longCommutePct}%\n\nHUD Income Limits:\n  Area: ${hud?.areaName}\n  Median: ${fmtCurrency(hud?.medianIncome)}\n  ${tierLine('Extremely-low (30%)', hud?.extremelyLowIncome30Pct)}\n  ${tierLine('Very-low (50%)', hud?.veryLowIncome50Pct)}\n  ${tierLine('Low (80%)', hud?.lowIncome80Pct)}`}
            extraTags={['urban-planning', 'census-acs', 'hud', preset.stateAbbr.toLowerCase()]}
            rawData={{ preset, census, hud }}
          />
        )}
      </div>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Census: {error}</div>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><BarChart3 className="h-3.5 w-3.5 text-cyan-400" /> Demographics (ACS {census?.year})</div>
          {census ? (
            <>
              <h3 className="mb-2 text-sm text-white">{census.countyName}</h3>
              <div className="grid grid-cols-2 gap-2">
                <Cell label="Population" value={census.totalPopulation?.toLocaleString() || '—'} />
                <Cell label="Median income" value={fmtCurrency(census.medianHouseholdIncome)} />
                <Cell label="Median age" value={census.medianAge ? `${census.medianAge.toFixed(1)} yr` : '—'} />
                <Cell label="Bachelors+" value={census.bachelorsPlusPct != null ? `${census.bachelorsPlusPct}%` : '—'} />
                <Cell label="Owner-occupied" value={census.ownerOccupiedPct != null ? `${census.ownerOccupiedPct}%` : '—'} icon={Home} />
                <Cell label="60+ min commute" value={census.longCommutePct != null ? `${census.longCommutePct}%` : '—'} />
              </div>
              <p className="mt-2 text-[10px] text-zinc-400">FIPS {census.stateFips}/{census.countyFips} · {census.source}</p>
            </>
          ) : (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Click pull to load.</div>
          )}
        </div>

        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><Wallet className="h-3.5 w-3.5 text-cyan-400" /> HUD Income Limits ({hud?.year || ''})</div>
          {hud ? (
            <>
              <h3 className="mb-2 text-sm text-white">{hud.areaName || preset.stateAbbr}</h3>
              <Cell label="HUD median income" value={fmtCurrency(hud.medianIncome)} />
              <div className="mt-3 space-y-2">
                {(['extremelyLowIncome30Pct', 'veryLowIncome50Pct', 'lowIncome80Pct'] as const).map((k) => {
                  const rows = tierRows(hud[k]);
                  const label = k === 'extremelyLowIncome30Pct' ? 'Extremely low (30% AMI)' : k === 'veryLowIncome50Pct' ? 'Very low (50% AMI)' : 'Low (80% AMI)';
                  if (rows.length === 0) return null;
                  return (
                    <div key={k}>
                      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
                      <div className="flex flex-wrap gap-1">
                        {rows.map((r) => (
                          <span key={r.householdSize} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">{familySize(r.householdSize)} {fmtCurrency(r.limit)}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : hudError ? (
            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] text-amber-200">{hudError}</div>
          ) : (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Click pull to load (requires HUD_API_TOKEN).</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className="mt-0.5 font-mono text-sm text-cyan-300">{value}</div>
    </div>
  );
}
