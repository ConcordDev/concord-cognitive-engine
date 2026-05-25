'use client';

/**
 * StravaBeaconPanel — live activity sharing ("Beacon"). Starts a live
 * session, streams real browser-geolocation position fixes to followers
 * via fitness.beacon-ping, and surfaces the share token. A second tab
 * lets a follower watch a live beacon by its share token.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Radio, Square, Share2, MapPin, Eye, Copy, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { MapView, type MapMarker } from '@/components/viz/MapView';
import { cn } from '@/lib/utils';

interface BeaconState {
  id?: string;
  shareToken?: string;
  status: string;
  type: string;
  position: { lat: number; lon: number; at: string } | null;
  distanceKm: number;
  durationSec: number;
  followerCount?: number;
  track?: { lat: number; lon: number }[];
  lastUpdate?: string;
}

const TYPES = ['run', 'ride', 'walk', 'hike'];

function durLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function StravaBeaconPanel() {
  const [view, setView] = useState<'mine' | 'follow'>('mine');
  const [type, setType] = useState('run');
  const [active, setActive] = useState<BeaconState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [followToken, setFollowToken] = useState('');
  const [followed, setFollowed] = useState<BeaconState | null>(null);
  const [followErr, setFollowErr] = useState<string | null>(null);

  const watchRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const distRef = useRef<number>(0);
  const lastRef = useRef<{ lat: number; lon: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (watchRef.current != null && typeof navigator !== 'undefined') {
      navigator.geolocation?.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => () => {
    cleanup();
    if (pollRef.current) clearInterval(pollRef.current);
  }, [cleanup]);

  const startBeacon = async () => {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation is not available in this browser.');
      return;
    }
    setBusy(true);
    const r = await lensRun('fitness', 'beacon-start', { type });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not start beacon'); return; }
    const beacon = r.data?.result?.beacon as BeaconState;
    setActive(beacon);
    startRef.current = Date.now();
    distRef.current = 0;
    lastRef.current = null;
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000));
    }, 1000);
    watchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const cur = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (lastRef.current) {
          const R = 6371000;
          const toRad = (d: number) => (d * Math.PI) / 180;
          const dLat = toRad(cur.lat - lastRef.current.lat);
          const dLon = toRad(cur.lon - lastRef.current.lon);
          const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lastRef.current.lat)) * Math.cos(toRad(cur.lat)) * Math.sin(dLon / 2) ** 2;
          distRef.current += 2 * R * Math.asin(Math.sqrt(h)) / 1000;
        }
        lastRef.current = cur;
        const durSec = Math.round((Date.now() - startRef.current) / 1000);
        await lensRun('fitness', 'beacon-ping', {
          id: beacon.id,
          lat: cur.lat,
          lon: cur.lon,
          distanceKm: Math.round(distRef.current * 1000) / 1000,
          durationSec: durSec,
        });
        setActive((prev) => prev ? {
          ...prev,
          position: { ...cur, at: new Date().toISOString() },
          distanceKm: Math.round(distRef.current * 1000) / 1000,
          durationSec: durSec,
        } : prev);
      },
      (err) => setError(`GPS error: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  };

  const stopBeacon = async () => {
    if (!active?.id) return;
    cleanup();
    setBusy(true);
    await lensRun('fitness', 'beacon-stop', { id: active.id });
    setBusy(false);
    setActive((prev) => prev ? { ...prev, status: 'ended' } : prev);
  };

  const copyToken = async () => {
    if (!active?.shareToken) return;
    try {
      await navigator.clipboard.writeText(active.shareToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const fetchFollowed = useCallback(async (token: string) => {
    const r = await lensRun('fitness', 'beacon-status', { shareToken: token });
    if (r.data?.ok === false) { setFollowErr(r.data?.error || 'Beacon not found'); setFollowed(null); return; }
    setFollowErr(null);
    setFollowed(r.data?.result?.beacon as BeaconState);
  }, []);

  const startFollowing = async () => {
    const token = followToken.trim();
    if (!token) { setFollowErr('Enter a share token.'); return; }
    await fetchFollowed(token);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => { void fetchFollowed(token); }, 10000);
  };

  const ownerMarkers: MapMarker[] = active?.position
    ? [{ id: 'me', lat: active.position.lat, lon: active.position.lon, label: 'You', tone: 'good' }]
    : [];
  const followMarkers: MapMarker[] = followed?.position
    ? [{ id: 'them', lat: followed.position.lat, lon: followed.position.lon, label: 'Athlete', tone: 'info' }]
    : [];

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(['mine', 'follow'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              view === v ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200',
            )}
          >
            {v === 'mine' ? 'My Beacon' : 'Follow a Beacon'}
          </button>
        ))}
      </div>

      {view === 'mine' && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Radio className={cn('w-4 h-4', active?.status === 'live' ? 'text-rose-400 animate-pulse' : 'text-orange-400')} />
            <h3 className="text-sm font-semibold text-zinc-100">Live Beacon</h3>
          </div>

          {!active || active.status !== 'live' ? (
            <div className="flex items-center gap-2">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
              >
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                type="button"
                onClick={startBeacon}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
                Go live
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5">
                <Share2 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <code className="text-xs text-zinc-200 truncate flex-1">{active.shareToken}</code>
                <button type="button" onClick={copyToken} className="text-zinc-400 hover:text-orange-300">
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[11px] text-zinc-400">Share this token with people you want to track you live.</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5">
                  <p className="text-[10px] uppercase text-zinc-400">Time</p>
                  <p className="text-sm font-bold text-zinc-100">{durLabel(elapsed)}</p>
                </div>
                <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5">
                  <p className="text-[10px] uppercase text-zinc-400">Distance</p>
                  <p className="text-sm font-bold text-zinc-100">{active.distanceKm} km</p>
                </div>
                <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5">
                  <p className="text-[10px] uppercase text-zinc-400">Last fix</p>
                  <p className="text-sm font-bold text-zinc-100 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-orange-400" />
                    {active.position ? '✓' : '—'}
                  </p>
                </div>
              </div>
              {active.position && <MapView markers={ownerMarkers} height={220} />}
              <button
                type="button"
                onClick={stopBeacon}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg"
              >
                <Square className="w-3.5 h-3.5" /> End beacon
              </button>
            </>
          )}
          {active?.status === 'ended' && (
            <p className="text-xs text-zinc-400">Beacon ended.</p>
          )}
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
      )}

      {view === 'follow' && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-zinc-100">Follow a live athlete</h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              placeholder="Paste a beacon share token"
              value={followToken}
              onChange={(e) => setFollowToken(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
            />
            <button
              type="button"
              onClick={startFollowing}
              className="px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg"
            >
              Watch
            </button>
          </div>
          {followErr && <p className="text-xs text-rose-400">{followErr}</p>}
          {followed && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5">
                  <p className="text-[10px] uppercase text-zinc-400">Status</p>
                  <p className={cn('text-sm font-bold capitalize', followed.status === 'live' ? 'text-rose-400' : 'text-zinc-400')}>
                    {followed.status}
                  </p>
                </div>
                <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5">
                  <p className="text-[10px] uppercase text-zinc-400">Distance</p>
                  <p className="text-sm font-bold text-zinc-100">{followed.distanceKm} km</p>
                </div>
                <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5">
                  <p className="text-[10px] uppercase text-zinc-400">Duration</p>
                  <p className="text-sm font-bold text-zinc-100">{durLabel(followed.durationSec)}</p>
                </div>
              </div>
              {followed.position ? (
                <MapView markers={followMarkers} height={220} />
              ) : (
                <p className="text-xs text-zinc-400 italic">Waiting for the first position fix…</p>
              )}
              <p className="text-[11px] text-zinc-400">Auto-refreshes every 10 seconds.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
