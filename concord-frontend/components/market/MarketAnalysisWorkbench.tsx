'use client';

/**
 * MarketAnalysisWorkbench — real bespoke UI for the three quant macros
 * (trendAnalysis / competitorMatrix / priceElasticity) that compute purely
 * from caller-supplied data via the virtual-artifact path
 * (POST /api/lens/run builds `artifact.data` directly from the input body —
 * no persisted artifact required, see server.js `_handleLensRun`).
 *
 * Before this component existed, the market lens page called these three
 * macros through `useRunArtifact('market')`, which requires a PERSISTED
 * artifact id (`marketItems[0]?.id`) from `useLensData('market','data')` —
 * a generic store nothing in this lens ever writes to. The three buttons
 * were permanently dead ("No market data artifact found"). Fixed by calling
 * `lensRun(domain, action, params)` directly with real, bespoke input forms
 * for each macro's actual data shape (OHLC price series / SWOT + feature
 * matrix / price-quantity observations).
 *
 * Working sets persist to localStorage (mirrors the Watchlist pattern) so a
 * user's in-progress price series / competitor matrix / elasticity table
 * survives a page reload — no server persistence is implied or faked.
 */

import { useEffect, useState } from 'react';
import {
  LineChart as LineChartIcon, Grid2x2, Percent, Plus, Trash2, Loader2,
  Play, Upload, AlertTriangle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

type Tab = 'trend' | 'competitors' | 'elasticity';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'trend', label: 'Trend Analysis', icon: <LineChartIcon className="w-3.5 h-3.5" /> },
  { id: 'competitors', label: 'Competitor Matrix', icon: <Grid2x2 className="w-3.5 h-3.5" /> },
  { id: 'elasticity', label: 'Price Elasticity', icon: <Percent className="w-3.5 h-3.5" /> },
];

const inputCls =
  'bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-cyan-500 outline-none';

function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function saveLS<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}

export function MarketAnalysisWorkbench() {
  const [tab, setTab] = useState<Tab>('trend');
  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-[#0d1117] p-4">
      <div className="flex items-center gap-2 mb-3">
        <LineChartIcon className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">Market Analysis</h3>
        <span className="text-[10px] text-zinc-400">SMA/MACD/RSI · SWOT scoring · elasticity regression</span>
      </div>
      <div className="flex flex-wrap gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg font-medium transition-colors ${
              tab === t.id ? 'bg-cyan-500 text-black' : 'bg-zinc-900/60 border border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'trend' && <TrendTab />}
      {tab === 'competitors' && <CompetitorMatrixTab />}
      {tab === 'elasticity' && <ElasticityTab />}
    </div>
  );
}

// ── Trend Analysis ──────────────────────────────────────────────────────
interface PriceRow { date: string; close: string }
interface TrendSignal { type: string; indicator?: string; detail?: string; value?: number; sentiment: 'bullish' | 'bearish' }
interface TrendResult {
  message?: string;
  dataPoints?: number;
  latestClose?: number;
  sma?: Record<string, number | null>;
  macd?: { line: number | null; signal: number | null; histogram: number | null };
  rsi?: number | null;
  signals?: TrendSignal[];
  overallTrend?: 'bullish' | 'bearish' | 'neutral';
}
const TREND_LS_KEY = 'concord:market:trendPrices:v1';

function TrendTab() {
  const [rows, setRows] = useState<PriceRow[]>(() => loadLS(TREND_LS_KEY, [] as PriceRow[]));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [smaShort, setSmaShort] = useState('20');
  const [smaLong, setSmaLong] = useState('50');
  const [rsiPeriod, setRsiPeriod] = useState('14');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrendResult | null>(null);

  useEffect(() => { saveLS(TREND_LS_KEY, rows); }, [rows]);

  function addRow() { setRows([...rows, { date: '', close: '' }]); }
  function updateRow(i: number, field: keyof PriceRow, value: string) {
    const next = [...rows]; next[i] = { ...next[i], [field]: value }; setRows(next);
  }
  function removeRow(i: number) { setRows(rows.filter((_, idx) => idx !== i)); }
  function clearAll() { setRows([]); }

  function importCsv() {
    setPasteError(null);
    const lines = pasteText.split('\n').map((l) => l.trim()).filter(Boolean);
    const parsed: PriceRow[] = [];
    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < 2) continue;
      const [date, close] = parts;
      if (!date || Number.isNaN(Number(close))) continue;
      parsed.push({ date, close });
    }
    if (parsed.length === 0) { setPasteError('No valid "date,close" rows found.'); return; }
    setRows([...rows, ...parsed]);
    setPasteText('');
    setPasteOpen(false);
  }

  async function run() {
    const prices = rows
      .filter((r) => r.date && r.close !== '' && !Number.isNaN(Number(r.close)))
      .map((r) => ({ date: r.date, close: Number(r.close) }));
    if (prices.length < 2) { setError('Need at least 2 valid price rows.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('market', 'trendAnalysis', {
      prices,
      smaPeriods: [Number(smaShort) || 20, Number(smaLong) || 50],
      rsiPeriod: Number(rsiPeriod) || 14,
    });
    if (r.data.ok) setResult(r.data.result as TrendResult);
    else setError(r.data.error || 'Trend analysis failed.');
    setBusy(false);
  }

  const chartData = rows
    .filter((r) => r.date && r.close !== '')
    .map((r) => ({ date: r.date, close: Number(r.close) || 0 }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={addRow} className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold inline-flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add price point
        </button>
        <button onClick={() => setPasteOpen(!pasteOpen)} className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 inline-flex items-center gap-1">
          <Upload className="w-3 h-3" /> Paste CSV
        </button>
        {rows.length > 0 && (
          <button onClick={clearAll} className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 inline-flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        )}
        <span className="text-[10px] text-zinc-400 ml-auto">{rows.length} price points (saved locally)</span>
      </div>

      {pasteOpen && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 space-y-1.5">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'One row per line: date,close\n2026-01-02,192.53\n2026-01-03,193.10'}
            rows={4}
            className={`w-full resize-none font-mono ${inputCls}`}
          />
          {pasteError && <ErrorRow msg={pasteError} />}
          <div className="flex gap-1.5">
            <button onClick={importCsv} className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold">Import rows</button>
            <button onClick={() => { setPasteOpen(false); setPasteText(''); setPasteError(null); }} className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">Cancel</button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="max-h-40 overflow-y-auto border border-zinc-800 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900/60 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left text-[9px] uppercase text-zinc-400">Date</th>
                <th className="px-2 py-1 text-left text-[9px] uppercase text-zinc-400">Close</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1"><input value={r.date} onChange={(e) => updateRow(i, 'date', e.target.value)} placeholder="2026-01-02" className={`w-28 ${inputCls}`} /></td>
                  <td className="px-2 py-1"><input value={r.close} onChange={(e) => updateRow(i, 'close', e.target.value)} placeholder="192.53" className={`w-24 ${inputCls}`} /></td>
                  <td className="px-2 py-1 text-right"><button aria-label="Delete" onClick={() => removeRow(i)} className="text-rose-400"><Trash2 className="w-3 h-3" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {chartData.length > 1 && (
        <ChartKit kind="line" data={chartData} xKey="date" series={[{ key: 'close', label: 'Close', color: '#22d3ee' }]} height={140} showLegend={false} />
      )}

      <div className="flex flex-wrap items-end gap-2 bg-zinc-900/40 border border-zinc-800 rounded-lg p-2.5">
        <label className="text-[10px] text-zinc-400">SMA short<input value={smaShort} onChange={(e) => setSmaShort(e.target.value)} className={`block w-16 mt-0.5 ${inputCls}`} /></label>
        <label className="text-[10px] text-zinc-400">SMA long<input value={smaLong} onChange={(e) => setSmaLong(e.target.value)} className={`block w-16 mt-0.5 ${inputCls}`} /></label>
        <label className="text-[10px] text-zinc-400">RSI period<input value={rsiPeriod} onChange={(e) => setRsiPeriod(e.target.value)} className={`block w-16 mt-0.5 ${inputCls}`} /></label>
        <button onClick={run} disabled={busy || rows.length < 2} className="px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1 ml-auto">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run trend analysis
        </button>
      </div>

      {error && <ErrorRow msg={error} />}

      {result && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
          {result.message ? (
            <p className="text-xs text-zinc-400">{result.message}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`text-sm font-bold uppercase px-2 py-0.5 rounded ${
                  result.overallTrend === 'bullish' ? 'bg-emerald-500/10 text-emerald-400' :
                  result.overallTrend === 'bearish' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'
                }`}>{result.overallTrend}</span>
                <span className="text-xs text-zinc-400">Close: <span className="text-zinc-100">{result.latestClose}</span></span>
                {result.rsi != null && <span className="text-xs text-zinc-400">RSI: <span className="text-cyan-300">{result.rsi}</span></span>}
                {result.macd?.histogram != null && <span className="text-xs text-zinc-400">MACD hist: <span className="text-cyan-300">{result.macd.histogram}</span></span>}
              </div>
              {result.sma && (
                <div className="flex gap-3 text-[11px] text-zinc-400">
                  {Object.entries(result.sma).map(([k, v]) => <span key={k}>{k.toUpperCase()}: <span className="text-zinc-200">{v ?? '—'}</span></span>)}
                </div>
              )}
              {result.signals && result.signals.length > 0 ? (
                <div className="space-y-1">
                  {result.signals.map((s, i) => (
                    <div key={i} className={`text-[11px] px-2 py-1 rounded ${s.sentiment === 'bullish' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      <span className="font-semibold">{s.indicator || s.type}</span> — {s.detail || (s.value != null ? `value ${s.value}` : s.type)}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-400 italic">No crossover/overbought/oversold signals on this window.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Competitor Matrix (SWOT + weighted feature scoring) ─────────────────
interface MatrixCompetitor {
  id: string; name: string; revenue: string;
  strengths: string; weaknesses: string; opportunities: string; threats: string;
  scores: Record<string, string>;
}
interface MatrixEntry { name: string; compositeScore: number; revenue: number; marketShare: number | null; swot: { swotBalance: number } }
interface MatrixGap { name: string; gaps: { feature: string; gap: number; leader: string }[] }
interface MatrixResult {
  message?: string;
  features?: string[];
  matrix?: MatrixEntry[];
  featureLeaders?: Record<string, { name: string; score: number }>;
  competitiveGaps?: MatrixGap[];
}
const MATRIX_LS_KEY = 'concord:market:competitorMatrix:v1';
const FEATURES_LS_KEY = 'concord:market:competitorMatrixFeatures:v1';

function CompetitorMatrixTab() {
  const [comps, setComps] = useState<MatrixCompetitor[]>(() => loadLS(MATRIX_LS_KEY, [] as MatrixCompetitor[]));
  const [features, setFeatures] = useState<string[]>(() => loadLS(FEATURES_LS_KEY, ['pricing', 'ux', 'integrations'] as string[]));
  const [newFeature, setNewFeature] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MatrixResult | null>(null);

  useEffect(() => { saveLS(MATRIX_LS_KEY, comps); }, [comps]);
  useEffect(() => { saveLS(FEATURES_LS_KEY, features); }, [features]);

  function addCompetitor() {
    setComps([...comps, { id: `mc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: '', revenue: '', strengths: '', weaknesses: '', opportunities: '', threats: '', scores: {} }]);
  }
  function updateComp(id: string, field: keyof MatrixCompetitor, value: string) {
    setComps(comps.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }
  function updateScore(id: string, feature: string, value: string) {
    setComps(comps.map((c) => (c.id === id ? { ...c, scores: { ...c.scores, [feature]: value } } : c)));
  }
  function removeComp(id: string) { setComps(comps.filter((c) => c.id !== id)); }
  function addFeature() {
    const f = newFeature.trim();
    if (!f || features.includes(f)) { setNewFeature(''); return; }
    setFeatures([...features, f]); setNewFeature('');
  }
  function removeFeature(f: string) { setFeatures(features.filter((x) => x !== f)); }

  async function run() {
    const named = comps.filter((c) => c.name.trim());
    if (named.length === 0) { setError('Add at least one named competitor.'); return; }
    setBusy(true); setError(null);
    const toLines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
    const payload = {
      competitors: named.map((c) => ({
        name: c.name.trim(),
        revenue: c.revenue ? Number(c.revenue) : undefined,
        strengths: toLines(c.strengths),
        weaknesses: toLines(c.weaknesses),
        opportunities: toLines(c.opportunities),
        threats: toLines(c.threats),
        features: Object.fromEntries(features.map((f) => [f, Number(c.scores[f]) || 0])),
      })),
    };
    const r = await lensRun('market', 'competitorMatrix', payload);
    if (r.data.ok) setResult(r.data.result as MatrixResult);
    else setError(r.data.error || 'Competitor matrix failed.');
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 bg-zinc-900/40 border border-zinc-800 rounded-lg p-2.5">
        <span className="text-[10px] text-zinc-400 uppercase tracking-wide">Features scored 0–10</span>
        {features.map((f) => (
          <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-900/50 inline-flex items-center gap-1">
            {f}
            <button aria-label="Delete" onClick={() => removeFeature(f)} className="text-cyan-400/70 hover:text-rose-400"><Trash2 className="w-2.5 h-2.5" /></button>
          </span>
        ))}
        <input value={newFeature} onChange={(e) => setNewFeature(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addFeature()} placeholder="add feature" className={`w-24 ${inputCls}`} />
        <button onClick={addFeature} className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300" aria-label="Add feature"><Plus className="w-3 h-3" aria-hidden="true" /></button>
      </div>

      <button onClick={addCompetitor} className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold inline-flex items-center gap-1">
        <Plus className="w-3 h-3" /> Add competitor
      </button>

      <ul className="space-y-1.5">
        {comps.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No competitors in the matrix yet.</li>}
        {comps.map((c) => (
          <li key={c.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <input value={c.name} onChange={(e) => updateComp(c.id, 'name', e.target.value)} placeholder="Competitor name" className={`flex-1 min-w-[100px] ${inputCls}`} />
              <input value={c.revenue} onChange={(e) => updateComp(c.id, 'revenue', e.target.value)} placeholder="revenue $" className={`w-24 ${inputCls}`} />
              {features.map((f) => (
                <label key={f} className="text-[9px] text-zinc-400">{f}
                  <input value={c.scores[f] || ''} onChange={(e) => updateScore(c.id, f, e.target.value)} placeholder="0-10" className={`block w-12 mt-0.5 ${inputCls}`} />
                </label>
              ))}
              <button onClick={() => setExpanded(expanded === c.id ? null : c.id)} className="text-[10px] text-cyan-400 hover:text-cyan-300">SWOT</button>
              <button aria-label="Delete" onClick={() => removeComp(c.id)} className="text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
            {expanded === c.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800 grid grid-cols-2 gap-1.5">
                <textarea value={c.strengths} onChange={(e) => updateComp(c.id, 'strengths', e.target.value)} placeholder="Strengths (one per line)" rows={2} className={`resize-none ${inputCls}`} />
                <textarea value={c.weaknesses} onChange={(e) => updateComp(c.id, 'weaknesses', e.target.value)} placeholder="Weaknesses (one per line)" rows={2} className={`resize-none ${inputCls}`} />
                <textarea value={c.opportunities} onChange={(e) => updateComp(c.id, 'opportunities', e.target.value)} placeholder="Opportunities (one per line)" rows={2} className={`resize-none ${inputCls}`} />
                <textarea value={c.threats} onChange={(e) => updateComp(c.id, 'threats', e.target.value)} placeholder="Threats (one per line)" rows={2} className={`resize-none ${inputCls}`} />
              </div>
            )}
          </li>
        ))}
      </ul>

      <button onClick={run} disabled={busy || comps.filter((c) => c.name.trim()).length === 0} className="px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run competitor matrix
      </button>

      {error && <ErrorRow msg={error} />}

      {result && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
          {result.message && <p className="text-xs text-zinc-400">{result.message}</p>}
          {result.matrix && result.matrix.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Ranked by composite score</p>
              {result.matrix.map((m, i) => (
                <div key={i} className="flex items-center justify-between bg-zinc-950/60 rounded px-2 py-1 text-[11px]">
                  <span className="text-zinc-200 font-medium">{i + 1}. {m.name}</span>
                  <span className="text-zinc-400">score <span className="text-cyan-300">{m.compositeScore}</span>{m.marketShare != null && ` · share ${m.marketShare}%`} · SWOT {m.swot.swotBalance >= 0 ? '+' : ''}{m.swot.swotBalance}</span>
                </div>
              ))}
            </div>
          )}
          {result.competitiveGaps && result.competitiveGaps.some((g) => g.gaps.length > 0) && (
            <div>
              <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">Competitive gaps (trailing by ≥3 pts)</p>
              {result.competitiveGaps.filter((g) => g.gaps.length > 0).map((g, i) => (
                <p key={i} className="text-[11px] text-amber-400">{g.name}: {g.gaps.map((x) => `${x.feature} (−${x.gap} vs ${x.leader})`).join(', ')}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Price Elasticity ─────────────────────────────────────────────────────
interface ObsRow { price: string; quantity: string }
interface ElasticityResult {
  message?: string;
  method?: string;
  primaryElasticity?: number | null;
  classification?: string;
  loglogRegression?: { elasticity: number; rSquared: number; slopeStdErr: number };
  averageArcElasticity?: number | null;
}
const ELASTICITY_LS_KEY = 'concord:market:elasticityObs:v1';

function ElasticityTab() {
  const [rows, setRows] = useState<ObsRow[]>(() => loadLS(ELASTICITY_LS_KEY, [] as ObsRow[]));
  const [method, setMethod] = useState<'loglog' | 'arc'>('loglog');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ElasticityResult | null>(null);

  useEffect(() => { saveLS(ELASTICITY_LS_KEY, rows); }, [rows]);

  function addRow() { setRows([...rows, { price: '', quantity: '' }]); }
  function updateRow(i: number, field: keyof ObsRow, value: string) {
    const next = [...rows]; next[i] = { ...next[i], [field]: value }; setRows(next);
  }
  function removeRow(i: number) { setRows(rows.filter((_, idx) => idx !== i)); }

  async function run() {
    const observations = rows
      .filter((r) => r.price !== '' && r.quantity !== '' && !Number.isNaN(Number(r.price)) && !Number.isNaN(Number(r.quantity)))
      .map((r) => ({ price: Number(r.price), quantity: Number(r.quantity) }));
    if (observations.length < 2) { setError('Need at least 2 valid price/quantity observations.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('market', 'priceElasticity', { observations, method });
    if (r.data.ok) setResult(r.data.result as ElasticityResult);
    else setError(r.data.error || 'Elasticity computation failed.');
    setBusy(false);
  }

  const chartData = rows
    .filter((r) => r.price !== '' && r.quantity !== '')
    .map((r) => ({ price: Number(r.price) || 0, quantity: Number(r.quantity) || 0 }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={addRow} className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold inline-flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add observation
        </button>
        <div className="flex gap-1 ml-auto">
          {(['loglog', 'arc'] as const).map((m) => (
            <button key={m} onClick={() => setMethod(m)} className={`px-2.5 py-1 text-xs rounded font-medium ${method === m ? 'bg-cyan-500 text-black' : 'bg-zinc-900/60 border border-zinc-800 text-zinc-400'}`}>{m}</button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="max-h-40 overflow-y-auto border border-zinc-800 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900/60 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left text-[9px] uppercase text-zinc-400">Price</th>
                <th className="px-2 py-1 text-left text-[9px] uppercase text-zinc-400">Quantity demanded</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1"><input value={r.price} onChange={(e) => updateRow(i, 'price', e.target.value)} placeholder="9.99" className={`w-20 ${inputCls}`} /></td>
                  <td className="px-2 py-1"><input value={r.quantity} onChange={(e) => updateRow(i, 'quantity', e.target.value)} placeholder="1200" className={`w-24 ${inputCls}`} /></td>
                  <td className="px-2 py-1 text-right"><button aria-label="Delete" onClick={() => removeRow(i)} className="text-rose-400"><Trash2 className="w-3 h-3" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {chartData.length > 1 && (
        <ChartKit kind="scatter" data={chartData} xKey="price" series={[{ key: 'quantity', label: 'Quantity vs price', color: '#22d3ee' }]} height={140} showLegend={false} />
      )}

      <button onClick={run} disabled={busy || rows.length < 2} className="px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Compute elasticity
      </button>

      {error && <ErrorRow msg={error} />}

      {result && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-1">
          {result.message ? (
            <p className="text-xs text-zinc-400">{result.message}</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-cyan-300">{result.primaryElasticity}</span>
                <span className="text-xs text-zinc-400">{result.classification}</span>
              </div>
              {result.loglogRegression && (
                <p className="text-[11px] text-zinc-400">log-log slope {result.loglogRegression.elasticity} · R² {result.loglogRegression.rSquared} · SE {result.loglogRegression.slopeStdErr}</p>
              )}
              {result.averageArcElasticity != null && (
                <p className="text-[11px] text-zinc-400">avg arc elasticity {result.averageArcElasticity}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorRow({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-950/30 border border-rose-900/40 rounded-lg px-3 py-2">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}

export default MarketAnalysisWorkbench;
