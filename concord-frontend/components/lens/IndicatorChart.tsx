'use client';

// IndicatorChart — FRED / IMF Data style line chart over years.
// Mounted in the accounting lens to render the World Bank economy
// feed (GDP / Inflation / Unemployment time series) as a real chart
// rather than the JSON-dump fallback.
//
// Data shape (from server/emergent/realtime-feeds.js#tickEconomyFeeds):
//   indicators: [{ indicator, code, values: [{ year, value }] }]
//
// Pure SVG — no charting library dependency. Sized via viewBox so it
// scales to any container width.

import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Wifi, WifiOff } from 'lucide-react';

export interface IndicatorPayload {
  indicators?: Array<{
    indicator: string;
    code: string;
    values: Array<{ year: string | number; value: number }>;
  }>;
  fetchedAt?: string;
}

interface IndicatorChartProps {
  data: IndicatorPayload | null | undefined;
  isLive?: boolean;
  lastUpdated?: string | null;
  className?: string;
}

const COLORS = ['#22d3ee', '#a78bfa', '#fb923c', '#34d399', '#f472b6'];

export default function IndicatorChart({ data, isLive, lastUpdated, className = '' }: IndicatorChartProps) {
  const indicators = data?.indicators || [];
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (indicators.length === 0) return null;
    const want = selectedCode || indicators[0].code;
    return indicators.find(i => i.code === want) || indicators[0];
  }, [indicators, selectedCode]);

  if (indicators.length === 0) {
    return (
      <section className={`rounded-xl border border-white/10 bg-zinc-900/40 backdrop-blur-sm p-6 ${className}`}>
        <div className="text-xs text-zinc-500">World Bank economic indicators connecting…</div>
      </section>
    );
  }

  const sortedValues = useMemo(() => {
    if (!selected) return [];
    return [...selected.values]
      .map(v => ({ year: Number(v.year), value: Number(v.value) }))
      .filter(v => Number.isFinite(v.year) && Number.isFinite(v.value))
      .sort((a, b) => a.year - b.year);
  }, [selected]);

  const latest = sortedValues[sortedValues.length - 1];
  const prior = sortedValues[sortedValues.length - 2];
  const yoyDelta = (latest && prior) ? latest.value - prior.value : null;
  const yoyPct = (yoyDelta != null && prior && prior.value !== 0) ? (yoyDelta / Math.abs(prior.value)) * 100 : null;
  const TrendIcon = yoyDelta == null ? Minus : (yoyDelta > 0 ? TrendingUp : (yoyDelta < 0 ? TrendingDown : Minus));
  const trendColor = yoyDelta == null ? 'text-zinc-500' : (yoyDelta > 0 ? 'text-emerald-400' : (yoyDelta < 0 ? 'text-rose-400' : 'text-zinc-400'));

  // SVG geometry — viewBox-driven, no fixed pixels
  const W = 600, H = 200, PAD_L = 50, PAD_R = 12, PAD_T = 12, PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const { minY, maxY, path, points } = useMemo(() => {
    if (sortedValues.length < 2) return { minY: 0, maxY: 1, path: '', points: [] as Array<{ x: number; y: number; year: number; value: number }> };
    const vals = sortedValues.map(v => v.value);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = Math.max(0.0001, maxV - minV);
    const minYears = sortedValues[0].year;
    const maxYears = sortedValues[sortedValues.length - 1].year;
    const xSpan = Math.max(1, maxYears - minYears);
    const pts = sortedValues.map(v => ({
      x: PAD_L + ((v.year - minYears) / xSpan) * innerW,
      y: PAD_T + innerH - ((v.value - minV) / span) * innerH,
      year: v.year,
      value: v.value,
    }));
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    return { minY: minV, maxY: maxV, path: d, points: pts };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedValues]);

  const lineColor = COLORS[indicators.findIndex(i => i.code === (selected?.code ?? '')) % COLORS.length] || COLORS[0];

  return (
    <section className={`rounded-xl border border-white/10 bg-zinc-900/40 backdrop-blur-sm overflow-hidden ${className}`}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gradient-to-r from-zinc-900/60 to-zinc-900/20">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">Economic Indicators</span>
          {isLive ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
              <Wifi className="w-3 h-3 animate-pulse" /><span>live</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
              <WifiOff className="w-3 h-3" /><span>offline</span>
            </span>
          )}
        </div>
        <span className="text-[10px] text-zinc-500">World Bank</span>
      </header>

      <div className="p-4 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
        {/* Indicator picker */}
        <nav className="space-y-1">
          {indicators.map((ind) => {
            const isActive = (selected?.code ?? indicators[0].code) === ind.code;
            const color = COLORS[indicators.indexOf(ind) % COLORS.length];
            return (
              <button
                key={ind.code}
                onClick={() => setSelectedCode(ind.code)}
                className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
                  isActive
                    ? 'bg-white/[0.04] border-white/15 text-zinc-100'
                    : 'border-transparent text-zinc-400 hover:bg-white/[0.02] hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="truncate">{ind.indicator}</span>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{ind.code}</div>
              </button>
            );
          })}
        </nav>

        {/* Detail + chart */}
        <div>
          {selected && (
            <div className="mb-3 flex items-baseline gap-3">
              <h3 className="text-base font-semibold text-zinc-200">{selected.indicator}</h3>
              {latest && (
                <span className="text-2xl font-light text-zinc-100">
                  {formatValue(latest.value, selected.code)}
                </span>
              )}
              {latest && (
                <span className="text-xs text-zinc-500">({latest.year})</span>
              )}
              {yoyPct != null && (
                <span className={`inline-flex items-center gap-1 text-xs ${trendColor}`}>
                  <TrendIcon className="w-3 h-3" />
                  {yoyPct >= 0 ? '+' : ''}{yoyPct.toFixed(1)}% YoY
                </span>
              )}
            </div>
          )}

          {sortedValues.length >= 2 ? (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" role="img" aria-label={selected?.indicator}>
              {/* Y-axis grid + labels */}
              {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
                const y = PAD_T + innerH * (1 - frac);
                const v = minY + (maxY - minY) * frac;
                return (
                  <g key={i}>
                    <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#3f3f46" strokeDasharray="2 4" strokeWidth="0.5" />
                    <text x={PAD_L - 4} y={y + 3} fontSize="8" fill="#71717a" textAnchor="end">{formatValueShort(v)}</text>
                  </g>
                );
              })}
              {/* X-axis labels (first / mid / last) */}
              {points.length > 0 && [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].map((p, i) => (
                <text key={i} x={p.x} y={H - PAD_B + 14} fontSize="9" fill="#71717a" textAnchor="middle">{p.year}</text>
              ))}
              {/* Line */}
              <path d={path} fill="none" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              {/* Points */}
              {points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="2.4" fill={lineColor}>
                  <title>{p.year}: {formatValue(p.value, selected?.code || '')}</title>
                </circle>
              ))}
            </svg>
          ) : (
            <div className="text-xs text-zinc-500">Not enough data points for a chart.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function formatValue(v: number, code: string): string {
  if (code?.includes('GDP')) return `$${(v / 1e12).toFixed(2)}T`;
  if (code?.includes('CPI') || code?.includes('UEM')) return `${v.toFixed(2)}%`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(2)}k`;
  return v.toFixed(2);
}

function formatValueShort(v: number): string {
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (Math.abs(v) >= 1e9)  return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6)  return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3)  return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(1);
}
