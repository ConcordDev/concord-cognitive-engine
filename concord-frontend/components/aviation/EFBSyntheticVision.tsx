'use client';

/**
 * EFBSyntheticVision — synthetic-vision / EFIS-style attitude display.
 *
 * ForeFlight feature-parity backlog item 7. Derives an EFIS attitude +
 * state snapshot from a recorded GPS track log via the efis-snapshot
 * macro, and renders it as a primary-flight-display attitude indicator
 * with airspeed / altitude / VSI tapes and a heading bug.
 * All values come from the pilot's own recorded track points.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Gauge, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Track {
  id: string;
  tail: string;
  from: string | null;
  to: string | null;
  endedAt: string | null;
  points: unknown[];
}
interface Snapshot {
  trackId: string;
  tail: string;
  attitude: { pitchDeg: number; bankDeg: number };
  state: {
    altitudeFt: number;
    verticalSpeedFpm: number;
    groundSpeedKts: number;
    groundTrackDeg: number;
    headingDeg: number;
    lat: number;
    lng: number;
  };
  sampleIntervalSec: number;
  pointCount: number;
  note: string;
}

/** Attitude-indicator PFD rendered from a derived attitude snapshot. */
function AttitudeIndicator({ snap }: { snap: Snapshot }) {
  const { pitchDeg, bankDeg } = snap.attitude;
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  // Pitch translates the horizon vertically; ~3.2 px per degree.
  const pitchPx = pitchDeg * 3.2;
  const hdg = snap.state.headingDeg;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: 240, height: 240 }} role="img" aria-label="attitude indicator">
        <defs>
          <clipPath id="pfd-clip">
            <circle cx={cx} cy={cy} r={size / 2 - 8} />
          </clipPath>
        </defs>
        <circle cx={cx} cy={cy} r={size / 2 - 4} fill="#0a0a0f" stroke="#1f2937" strokeWidth={2} />
        <g clipPath="url(#pfd-clip)">
          {/* horizon ball, rotated for bank and translated for pitch */}
          <g transform={`rotate(${-bankDeg} ${cx} ${cy})`}>
            <g transform={`translate(0 ${pitchPx})`}>
              <rect x={-size} y={cy - size} width={size * 3} height={size} fill="#1d6fb8" />
              <rect x={-size} y={cy} width={size * 3} height={size} fill="#6b4423" />
              <line x1={-size} y1={cy} x2={size * 2} y2={cy} stroke="#e5e7eb" strokeWidth={2} />
              {/* pitch ladder */}
              {[-20, -10, 10, 20].map((p) => (
                <g key={p}>
                  <line
                    x1={cx - 26}
                    y1={cy - p * 3.2}
                    x2={cx + 26}
                    y2={cy - p * 3.2}
                    stroke="#e5e7eb"
                    strokeWidth={1.4}
                  />
                  <text
                    x={cx - 34}
                    y={cy - p * 3.2 + 3}
                    fontSize={9}
                    fill="#e5e7eb"
                    textAnchor="end"
                  >
                    {Math.abs(p)}
                  </text>
                </g>
              ))}
            </g>
          </g>
          {/* bank arc ticks */}
          {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((b) => {
            const ang = (b - 90) * (Math.PI / 180);
            const r1 = size / 2 - 10;
            const r2 = size / 2 - (b % 30 === 0 ? 22 : 16);
            return (
              <line
                key={b}
                x1={cx + r1 * Math.cos(ang)}
                y1={cy + r1 * Math.sin(ang)}
                x2={cx + r2 * Math.cos(ang)}
                y2={cy + r2 * Math.sin(ang)}
                stroke="#e5e7eb"
                strokeWidth={1.2}
              />
            );
          })}
          {/* bank pointer */}
          <g transform={`rotate(${-bankDeg} ${cx} ${cy})`}>
            <polygon
              points={`${cx},${cy - size / 2 + 10} ${cx - 6},${cy - size / 2 + 22} ${cx + 6},${cy - size / 2 + 22}`}
              fill="#fbbf24"
            />
          </g>
        </g>
        {/* fixed aircraft symbol */}
        <line x1={cx - 40} y1={cy} x2={cx - 14} y2={cy} stroke="#fbbf24" strokeWidth={3} />
        <line x1={cx + 14} y1={cy} x2={cx + 40} y2={cy} stroke="#fbbf24" strokeWidth={3} />
        <circle cx={cx} cy={cy} r={3} fill="#fbbf24" />
        {/* heading readout */}
        <rect x={cx - 22} y={size - 22} width={44} height={16} fill="#0a0a0f" stroke="#374151" />
        <text x={cx} y={size - 10} fontSize={11} fill="#e5e7eb" textAnchor="middle" fontFamily="monospace">
          {String(Math.round(hdg)).padStart(3, '0')}°
        </text>
      </svg>
      <div className="flex gap-3 mt-1 text-[10px] font-mono text-gray-400">
        <span>Pitch {pitchDeg.toFixed(1)}°</span>
        <span>Bank {bankDeg.toFixed(1)}°</span>
      </div>
    </div>
  );
}

export default function EFBSyntheticVision() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackId, setTrackId] = useState('');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTracks = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('aviation', 'track-logs-list', {});
    if (r.data?.ok && r.data.result) {
      const list = (r.data.result as { tracks?: Track[] }).tracks || [];
      setTracks(list);
      if (list.length > 0 && !trackId) setTrackId(list[0].id);
    }
    setLoading(false);
  }, [trackId]);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  const compute = useCallback(async () => {
    if (!trackId) {
      setError('Select a recorded track log.');
      return;
    }
    setComputing(true);
    setError(null);
    const r = await lensRun('aviation', 'efis-snapshot', { trackId });
    if (r.data?.ok && r.data.result) {
      setSnap(r.data.result as Snapshot);
    } else {
      setError(r.data?.error || 'Could not derive an attitude snapshot.');
      setSnap(null);
    }
    setComputing(false);
  }, [trackId]);

  const tape = (label: string, value: string, unit: string, tone: string) => (
    <div className="rounded border border-white/10 bg-black/30 px-3 py-2 text-center">
      <p className="text-[9px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={'text-lg font-mono ' + tone}>{value}</p>
      <p className="text-[9px] text-gray-400">{unit}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-sky-500/20 bg-black/20 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Gauge className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-gray-200 uppercase tracking-wider">
            Synthetic vision / EFIS attitude
          </span>
        </div>
        {loading ? (
          <div className="flex items-center py-3 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading tracks…
          </div>
        ) : tracks.length === 0 ? (
          <p className="text-xs text-gray-400">
            No recorded track logs yet. Record a flight with the track logger first.
          </p>
        ) : (
          <div className="flex gap-2">
            <select
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tail} · {t.from || '?'} → {t.to || '?'} · {t.points.length} pts
                  {t.endedAt ? '' : ' (active)'}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={compute}
              disabled={computing}
              className="px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40 inline-flex items-center gap-1"
            >
              {computing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Derive
            </button>
          </div>
        )}
        {error && <p className="text-xs text-rose-300 mt-2">{error}</p>}
      </div>

      {snap && (
        <div className="rounded-lg border border-white/10 bg-[#070b12] p-4">
          <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
            <AttitudeIndicator snap={snap} />
            <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
              {tape('Airspeed', String(snap.state.groundSpeedKts), 'kt GS', 'text-emerald-300')}
              {tape('Altitude', snap.state.altitudeFt.toLocaleString(), 'ft', 'text-sky-300')}
              {tape(
                'Vertical speed',
                (snap.state.verticalSpeedFpm > 0 ? '+' : '') + snap.state.verticalSpeedFpm,
                'fpm',
                snap.state.verticalSpeedFpm >= 0 ? 'text-emerald-300' : 'text-amber-300',
              )}
              {tape('Ground track', String(snap.state.groundTrackDeg).padStart(3, '0'), 'deg', 'text-fuchsia-300')}
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3 text-center">
            {snap.tail} · derived from {snap.pointCount} track points ·{' '}
            {snap.sampleIntervalSec}s sample interval
          </p>
          <p className="text-[10px] text-amber-400/70 mt-1 text-center">{snap.note}</p>
        </div>
      )}
    </div>
  );
}
