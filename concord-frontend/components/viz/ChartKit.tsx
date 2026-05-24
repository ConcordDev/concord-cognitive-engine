'use client';

/**
 * ChartKit — one wrapper over recharts for the common lens chart needs:
 * line / bar / area / scatter. Lens features that need a data chart
 * mount <ChartKit/> instead of hand-rolling SVG or re-importing recharts.
 */

import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

export type ChartKind = 'line' | 'bar' | 'area' | 'scatter';

export interface ChartSeries {
  key: string;
  label?: string;
  color?: string;
}

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#ef4444'];

export function ChartKit({
  kind = 'line',
  data,
  xKey,
  series,
  height = 240,
  stacked = false,
  showLegend = true,
  showGrid = true,
}: {
  kind?: ChartKind;
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: ChartSeries[];
  height?: number;
  stacked?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
}) {
  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/40 text-xs text-zinc-400"
        style={{ height }}
      >
        No data to chart yet.
      </div>
    );
  }

  const color = (s: ChartSeries, i: number) => s.color || PALETTE[i % PALETTE.length];
  const axis = { stroke: '#52525b', fontSize: 11 };
  const grid = showGrid ? <CartesianGrid strokeDasharray="3 3" stroke="#27272a" /> : null;
  const common = (
    <>
      {grid}
      <XAxis dataKey={xKey} {...axis} />
      <YAxis {...axis} />
      <Tooltip
        contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
        labelStyle={{ color: '#e4e4e7' }}
      />
      {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
    </>
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      {kind === 'bar' ? (
        <BarChart data={data}>
          {common}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label || s.key} fill={color(s, i)}
              stackId={stacked ? 'a' : undefined} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      ) : kind === 'area' ? (
        <AreaChart data={data}>
          {common}
          {series.map((s, i) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label || s.key}
              stroke={color(s, i)} fill={color(s, i)} fillOpacity={0.25}
              stackId={stacked ? 'a' : undefined} />
          ))}
        </AreaChart>
      ) : kind === 'scatter' ? (
        <ScatterChart>
          {common}
          {series.map((s, i) => (
            <Scatter key={s.key} data={data} dataKey={s.key} name={s.label || s.key} fill={color(s, i)} />
          ))}
        </ScatterChart>
      ) : (
        <LineChart data={data}>
          {common}
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label || s.key}
              stroke={color(s, i)} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}
