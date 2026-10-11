'use client';

import { useState } from 'react';
import { GraduationCap, Footprints, Car, Bike, Bus, Loader2, MapPin } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SchoolRow {
  kind?: string;
  name: string;
  rating?: number;
  distance?: number;
}
interface SchoolsResult {
  available?: boolean;
  reason?: string;
  schools?: SchoolRow[];
  averageRating?: number;
  districtName?: string;
  source?: string;
}
interface WalkResult {
  available?: boolean;
  reason?: string;
  walkScore?: number;
  walkDesc?: string;
  transitScore?: number;
  transitDesc?: string;
  bikeScore?: number;
  bikeDesc?: string;
  source?: string;
}
interface CommuteResult {
  available?: boolean;
  reason?: string;
  minutes?: number;
  distanceMi?: number;
  mode?: string;
  rushHourMinutes?: number;
  source?: string;
}

type LensPayload<T> = { ok?: boolean; result?: T | null; error?: string | null; reason?: string };

function isFiniteScore(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function readResult<T extends { available?: boolean; reason?: string }>(payload: LensPayload<T> | undefined): T | null {
  if (payload?.result && typeof payload.result === 'object') return payload.result;
  if (payload && payload.ok === false) {
    return { available: false, reason: payload.reason || payload.error || 'unavailable' } as T;
  }
  return null;
}

export function SchoolWalkPanel({ initialAddress }: { initialAddress?: string }) {
  const [address, setAddress] = useState(initialAddress ?? '');
  const [commuteTo, setCommuteTo] = useState('');
  const [commuteMode, setCommuteMode] = useState<'drive' | 'transit' | 'bike' | 'walk'>('drive');
  const [schools, setSchools] = useState<SchoolsResult | null>(null);
  const [walk, setWalk] = useState<WalkResult | null>(null);
  const [commute, setCommute] = useState<CommuteResult | null>(null);
  const [commuteRequested, setCommuteRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function fetchAll() {
    if (!address.trim()) return;
    setLoading(true);
    setFetchError(null);
    setSchools(null);
    setWalk(null);
    setCommute(null);
    const wantCommute = Boolean(commuteTo.trim());
    setCommuteRequested(wantCommute);
    try {
      const requests = [
        lensRun({ domain: 'realestate', action: 'school-ratings', input: { address } }),
        lensRun({ domain: 'realestate', action: 'walk-score', input: { address } }),
      ];
      if (wantCommute) {
        requests.push(lensRun({ domain: 'realestate', action: 'commute-estimate', input: { from: address, to: commuteTo, mode: commuteMode } }));
      }
      const [s, w, c] = await Promise.all(requests);
      setSchools(readResult<SchoolsResult>(s.data) ?? { available: false, reason: 'unavailable' });
      setWalk(readResult<WalkResult>(w.data) ?? { available: false, reason: 'unavailable' });
      setCommute(wantCommute ? (readResult<CommuteResult>(c?.data) ?? { available: false, reason: 'unavailable' }) : null);
    } catch (e) {
      console.error('[SchoolWalk] failed', e);
      setFetchError('unavailable');
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }

  const schoolsLive = schools?.available === true;
  const walkLive = walk?.available === true;
  const commuteLive = commute?.available === true;
  const walkTiles = walkLive
    ? [
        isFiniteScore(walk?.walkScore) ? { icon: Footprints, label: 'Walk', score: walk.walkScore, desc: walk.walkDesc } : null,
        isFiniteScore(walk?.transitScore) ? { icon: Bus, label: 'Transit', score: walk.transitScore, desc: walk.transitDesc } : null,
        isFiniteScore(walk?.bikeScore) ? { icon: Bike, label: 'Bike', score: walk.bikeScore, desc: walk.bikeDesc } : null,
      ].filter((tile): tile is { icon: typeof Footprints; label: string; score: number; desc?: string } => tile != null)
    : [];

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Schools, walk score & commute</span>
      </header>
      <div className="p-3 border-b border-white/10 space-y-2">
        <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Address (e.g. 123 Main St, Austin, TX)" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <div className="grid grid-cols-4 gap-2">
          <input value={commuteTo} onChange={e => setCommuteTo(e.target.value)} placeholder="Commute to (optional)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={commuteMode} onChange={e => setCommuteMode(e.target.value as typeof commuteMode)} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="drive">Drive</option><option value="transit">Transit</option><option value="bike">Bike</option><option value="walk">Walk</option>
          </select>
          <button type="button" onClick={fetchAll} disabled={loading || !address.trim()} aria-label="Fetch" className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Fetch'}
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {!fetched && (
          <div className="px-3 py-8 text-center text-xs text-gray-400">Enter an address to see schools, walk score & commute.</div>
        )}
        {fetched && fetchError && !schools && !walk && (
          <Unavailable label="Schools, walk score, and commute" reason={fetchError} />
        )}
        {fetched && walk && !walkLive && (
          <Unavailable label="Walk, transit, and bike scores" reason={walk.reason} />
        )}
        {walkTiles.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {walkTiles.map((tile) => (
              <ScoreTile key={tile.label} icon={tile.icon} label={tile.label} score={tile.score} desc={tile.desc || ''} />
            ))}
          </div>
        )}
        {walkLive && walkTiles.length === 0 && (
          <Unavailable label="Walk, transit, and bike scores" reason="walkscore_unavailable" />
        )}
        {walkLive && walk?.source && (
          <div className="text-[10px] text-gray-500">Source: {walk.source}</div>
        )}
        {fetched && schools && !schoolsLive && (
          <Unavailable label="Schools" reason={schools.reason} />
        )}
        {schoolsLive && (
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2">
              <GraduationCap className="w-4 h-4 text-emerald-300" />
              <span className="text-xs text-gray-300">{schools?.districtName || 'Schools'}</span>
              {isFiniteScore(schools?.averageRating) && (
                <span className="ml-auto text-[10px] font-mono text-gray-400">Avg <span className="text-emerald-300">{schools.averageRating.toFixed(1)}</span>/10</span>
              )}
            </div>
            {schools?.source && <div className="mb-2 text-[10px] text-gray-500">Source: {schools.source}</div>}
            {(schools?.schools || []).length === 0 ? (
              <div className="text-xs text-gray-400">No schools returned for this address.</div>
            ) : (
              <ul className="space-y-1.5">
                {(schools?.schools || []).map((s) => (
                  <li key={`${s.kind || ''}-${s.name}`} className="flex items-center gap-2 text-xs">
                    <span className="text-[10px] uppercase tracking-wider w-16 text-gray-400">{s.kind || ''}</span>
                    <span className="flex-1 truncate text-white">{s.name}</span>
                    {isFiniteScore(s.distance) && <span className="text-[10px] text-gray-400">{s.distance}mi</span>}
                    {isFiniteScore(s.rating) && (
                      <span className={cn('font-mono font-bold w-6 text-right', s.rating >= 8 ? 'text-emerald-300' : s.rating >= 6 ? 'text-amber-300' : 'text-rose-300')}>{s.rating}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {fetched && commuteRequested && commute && !commuteLive && (
          <Unavailable label="Commute" reason={commute.reason} />
        )}
        {commuteLive && (isFiniteScore(commute?.minutes) || isFiniteScore(commute?.distanceMi) || isFiniteScore(commute?.rushHourMinutes)) && (
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Car className="w-4 h-4 text-cyan-300" />
              <span className="text-xs text-gray-300">Commute{commute?.mode ? ` · ${commute.mode}` : ''}</span>
              {commute?.source && <span className="ml-auto text-[10px] text-gray-500">{commute.source}</span>}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {isFiniteScore(commute?.minutes) && (
                <div><div className="text-[10px] uppercase tracking-wider text-gray-400">Time</div><div className="text-lg font-mono tabular-nums text-white">{commute.minutes}m</div></div>
              )}
              {isFiniteScore(commute?.rushHourMinutes) && (
                <div><div className="text-[10px] uppercase tracking-wider text-gray-400">Rush hour</div><div className="text-lg font-mono tabular-nums text-amber-300">{commute.rushHourMinutes}m</div></div>
              )}
              {isFiniteScore(commute?.distanceMi) && (
                <div><div className="text-[10px] uppercase tracking-wider text-gray-400">Distance</div><div className="text-lg font-mono tabular-nums text-white">{commute.distanceMi}mi</div></div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Unavailable({ label, reason }: { label: string; reason?: string }) {
  return (
    <div role="status" className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-gray-300">
      <div className="text-gray-200">{label}</div>
      <div className="mt-1 text-amber-200/90">Not connected / unavailable</div>
      {reason ? <div className="mt-1 font-mono text-[10px] text-gray-500">{reason}</div> : null}
    </div>
  );
}

function ScoreTile({ icon: Icon, label, score, desc }: { icon: typeof Footprints; label: string; score: number; desc: string }) {
  const colour = score >= 70 ? 'text-emerald-300' : score >= 50 ? 'text-amber-300' : 'text-rose-300';
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2.5 text-center">
      <Icon className={cn('w-4 h-4 mx-auto mb-0.5', colour)} />
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={cn('text-2xl font-mono font-bold tabular-nums', colour)}>{score}</div>
      <div className="text-[9px] text-gray-400 truncate">{desc}</div>
    </div>
  );
}

export default SchoolWalkPanel;
