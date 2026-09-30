'use client';

/**
 * DimensionsPanel — 7D ATS radar + event emitter (iMotions / Empatica desk).
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, Send, BarChart3, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useAffectAts } from '@/components/affect/useAffectAts';
import { DIMS, EVENT_TYPES, dimBgColor, radarPoints, radarLabelPos } from '@/components/affect/affect-model';
import { ErrorState } from '@/components/common/EmptyState';
import { LiveAffectStream } from '@/components/affect/LiveAffectStream';

export function DimensionsPanel() {
  const { sessionId, dimValues, eventList, isLoading, isError, errorMessage, refetchAll } = useAffectAts();
  const queryClient = useQueryClient();
  const [eventType, setEventType] = useState('USER_MESSAGE');
  const [intensity, setIntensity] = useState(0.5);
  const [polarity, setPolarity] = useState(0.0);

  const emitEvent = useMutation({
    mutationFn: () => apiHelpers.affect.emit(sessionId, { type: eventType, intensity, polarity }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['affect-state', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['affect-policy', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['affect-events', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['affect-health'] });
    },
    onError: (err) => {
      console.error('Failed to emit affect event:', err instanceof Error ? err.message : err);
    },
  });

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex items-center justify-center p-8">
        <div className="w-8 h-8 border-2 border-neon-pink border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (isError) {
    return <ErrorState error={errorMessage} onRetry={refetchAll} />;
  }

  return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar/Spider Chart */}
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <Eye className="w-4 h-4 text-neon-pink" />
                Dimensional Radar
              </h2>
              <div className="flex justify-center">
                <svg viewBox="0 0 200 200" className="w-full max-w-xs">
                  {/* Emissive glow — matches the platform's "emissive accent"
                      visual language (dome-barrier, refusal-field) instead of
                      a flat generic radar-chart-library look. */}
                  <defs>
                    <filter id="affect-radar-glow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {/* Background rings */}
                  {[0.25, 0.5, 0.75, 1].map((r) => (
                    <polygon
                      key={r}
                      points={radarPoints(
                        DIMS.map(() => ({ value: r })),
                        80
                      )}
                      fill="none"
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth="0.5"
                    />
                  ))}
                  {/* Axis lines */}
                  {DIMS.map((_, i) => {
                    const angle = (Math.PI * 2 * i) / DIMS.length - Math.PI / 2;
                    const x2 = 100 + 80 * Math.cos(angle);
                    const y2 = 100 + 80 * Math.sin(angle);
                    return (
                      <line
                        key={i}
                        x1="100"
                        y1="100"
                        x2={x2}
                        y2={y2}
                        stroke="rgba(255,255,255,0.06)"
                        strokeWidth="0.5"
                      />
                    );
                  })}
                  {/* Data polygon */}
                  <motion.polygon
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    points={radarPoints(dimValues, 80)}
                    fill="rgba(236, 72, 153, 0.15)"
                    stroke="rgba(236, 72, 153, 0.9)"
                    strokeWidth="1.5"
                    filter="url(#affect-radar-glow)"
                  />
                  {/* Data points */}
                  {dimValues.map((dim, i) => {
                    const angle = (Math.PI * 2 * i) / DIMS.length - Math.PI / 2;
                    const r = dim.value * 80;
                    const cx = 100 + r * Math.cos(angle);
                    const cy = 100 + r * Math.sin(angle);
                    return (
                      <circle
                        key={dim.key}
                        cx={cx}
                        cy={cy}
                        r="3"
                        fill={
                          (dim.key === 'f' ? 1 - dim.value : dim.value) >= 0.65
                            ? '#4ade80'
                            : (dim.key === 'f' ? 1 - dim.value : dim.value) >= 0.35
                              ? '#facc15'
                              : '#f87171'
                        }
                        stroke="white"
                        strokeWidth="0.5"
                        filter="url(#affect-radar-glow)"
                      />
                    );
                  })}
                  {/* Labels */}
                  {dimValues.map((dim, i) => {
                    const pos = radarLabelPos(i, DIMS.length, 80);
                    return (
                      <text
                        key={dim.key}
                        x={pos.x}
                        y={pos.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="fill-gray-400"
                        fontSize="7"
                      >
                        {dim.label}
                      </text>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Event Emitter */}
            <div className="panel p-4 space-y-4">
              <h2 className="font-semibold flex items-center gap-2">
                <Send className="w-4 h-4 text-neon-cyan" />
                Emit Affect Event
              </h2>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Event Type</label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className="input-lattice w-full"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Intensity: {intensity.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={intensity}
                  onChange={(e) => setIntensity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Polarity: {polarity.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={polarity}
                  onChange={(e) => setPolarity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <button
                onClick={() => emitEvent.mutate()}
                disabled={emitEvent.isPending}
                className="btn-neon purple w-full flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                {emitEvent.isPending ? 'Emitting...' : 'Emit Event'}
              </button>
            </div>
          </div>

          {/* Dimension Detail Cards */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-purple" />
              Dimension Details
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dimValues.map((dim) => {
                const adjustedVal = dim.key === 'f' ? 1 - dim.value : dim.value;
                const status =
                  adjustedVal >= 0.65 ? 'Healthy' : adjustedVal >= 0.35 ? 'Moderate' : 'Low';
                const statusColor =
                  adjustedVal >= 0.65
                    ? 'text-green-400'
                    : adjustedVal >= 0.35
                      ? 'text-yellow-400'
                      : 'text-red-400';
                return (
                  <div key={dim.key} className="lens-card">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`flex items-center gap-2 ${dim.color}`}>
                        {dim.icon}
                        <span className="font-medium text-sm">{dim.label}</span>
                      </div>
                      <span className={`text-xs font-medium ${statusColor}`}>{status}</span>
                    </div>
                    <p className="text-xs text-gray-400 mb-2">{dim.description}</p>
                    <div className="flex items-center gap-3">
                      <div className="h-2.5 flex-1 bg-lattice-deep rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${dimBgColor(adjustedVal)}`}
                          style={{ width: `${dim.value * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono font-bold text-gray-300 w-14 text-right">
                        {(dim.value * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Historical Trend (from events data) */}
          {eventList.length > 2 && (
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-neon-green" />
                Recent Trends
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {dimValues.map((dim) => {
                  // Extract historical values from events if they contain state snapshots
                  const recentEvents = eventList.slice(-10);
                  const vals = recentEvents
                    .map((evt: Record<string, unknown>) => {
                      const st = evt.state || evt.after_state || evt.dimensions;
                      if (st && typeof st === 'object')
                        return typeof (st as Record<string, unknown>)[dim.key] === 'number'
                          ? ((st as Record<string, unknown>)[dim.key] as number)
                          : null;
                      return null;
                    })
                    .filter((v): v is number => v != null);

                  if (vals.length < 2) return null;

                  const first = vals[0];
                  const last = vals[vals.length - 1];
                  const delta = last - first;

                  return (
                    <div key={dim.key} className="lens-card flex items-center gap-3">
                      <div className={`${dim.color}`}>{dim.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-400">{dim.label}</p>
                        <p className="text-sm font-mono font-bold">
                          {(last * 100).toFixed(0)}%
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {delta > 0.01 ? (
                          <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                        ) : delta < -0.01 ? (
                          <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                        ) : (
                          <Minus className="w-3.5 h-3.5 text-gray-400" />
                        )}
                        <span
                          className={`text-xs font-mono ${
                            delta > 0.01
                              ? 'text-green-400'
                              : delta < -0.01
                                ? 'text-red-400'
                                : 'text-gray-400'
                          }`}
                        >
                          {delta > 0 ? '+' : ''}
                          {(delta * 100).toFixed(1)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <LiveAffectStream />
          </section>
        </div>
  );
}
