'use client';

/**
 * Sparkline — a tiny inline SVG trend line for per-channel timeseries.
 * Fed by the event_timeline.timeseries macro (one counts[] array per
 * channel). No axes, no chrome — just the shape of the trend.
 */

export function Sparkline({
  counts,
  width = 96,
  height = 22,
  color = '#818cf8',
}: {
  counts: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!counts || counts.length === 0) {
    return <div style={{ width, height }} className="opacity-30" aria-hidden="true" />;
  }
  const max = Math.max(1, ...counts);
  const n = counts.length;
  const step = n > 1 ? width / (n - 1) : width;
  const pts = counts
    .map((c, i) => {
      const x = i * step;
      const y = height - (c / max) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = counts[counts.length - 1];
  const lastX = (n - 1) * step;
  const lastY = height - (last / max) * (height - 2) - 1;

  return (
    <svg width={width} height={height} className="overflow-visible" role="img" aria-label={`trend, ${counts.reduce((a, b) => a + b, 0)} events`}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2} fill={color} />
    </svg>
  );
}
