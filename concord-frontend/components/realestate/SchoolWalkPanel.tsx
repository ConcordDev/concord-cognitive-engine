'use client';

import { useState } from 'react';
import { GraduationCap, Footprints, Car, Bike, Bus, Loader2, MapPin } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Schools {
  schools: Array<{ kind: string; name: string; rating: number; distance: number }>;
  averageRating: number;
  districtName: string;
}
interface Walk { walkScore: number; walkDesc: string; transitScore: number; transitDesc: string; bikeScore: number; bikeDesc: string }
interface Commute { minutes: number; distanceMi: number; mode: string; rushHourMinutes: number }

export function SchoolWalkPanel() {
  const [address, setAddress] = useState('');
  const [commuteTo, setCommuteTo] = useState('');
  const [commuteMode, setCommuteMode] = useState<'drive' | 'transit' | 'bike' | 'walk'>('drive');
  const [schools, setSchools] = useState<Schools | null>(null);
  const [walk, setWalk] = useState<Walk | null>(null);
  const [commute, setCommute] = useState<Commute | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchAll() {
    if (!address.trim()) return;
    setLoading(true);
    try {
      const requests = [
        api.post('/api/lens/run', { domain: 'realestate', action: 'school-ratings', input: { address } }),
        api.post('/api/lens/run', { domain: 'realestate', action: 'walk-score', input: { address } }),
      ];
      if (commuteTo.trim()) {
        requests.push(api.post('/api/lens/run', { domain: 'realestate', action: 'commute-estimate', input: { from: address, to: commuteTo, mode: commuteMode } }));
      }
      const [s, w, c] = await Promise.all(requests);
      setSchools(s.data?.result || null);
      setWalk(w.data?.result || null);
      setCommute(c?.data?.result || null);
    } catch (e) { console.error('[SchoolWalk] failed', e); }
    finally { setLoading(false); }
  }

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
          <button onClick={fetchAll} disabled={loading || !address.trim()} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Fetch'}
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {!schools && !walk && !commute && (
          <div className="px-3 py-8 text-center text-xs text-gray-500">Enter an address to see schools, walk score & commute.</div>
        )}
        {walk && (
          <div className="grid grid-cols-3 gap-2">
            <ScoreTile icon={Footprints} label="Walk" score={walk.walkScore} desc={walk.walkDesc} />
            <ScoreTile icon={Bus} label="Transit" score={walk.transitScore} desc={walk.transitDesc} />
            <ScoreTile icon={Bike} label="Bike" score={walk.bikeScore} desc={walk.bikeDesc} />
          </div>
        )}
        {schools && (
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2">
              <GraduationCap className="w-4 h-4 text-emerald-300" />
              <span className="text-xs text-gray-300">{schools.districtName}</span>
              <span className="ml-auto text-[10px] font-mono text-gray-400">Avg <span className="text-emerald-300">{schools.averageRating.toFixed(1)}</span>/10</span>
            </div>
            <ul className="space-y-1.5">
              {schools.schools.map(s => (
                <li key={s.kind} className="flex items-center gap-2 text-xs">
                  <span className="text-[10px] uppercase tracking-wider w-16 text-gray-500">{s.kind}</span>
                  <span className="flex-1 truncate text-white">{s.name}</span>
                  <span className="text-[10px] text-gray-500">{s.distance}mi</span>
                  <span className={cn('font-mono font-bold w-6 text-right', s.rating >= 8 ? 'text-emerald-300' : s.rating >= 6 ? 'text-amber-300' : 'text-rose-300')}>{s.rating}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {commute && (
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Car className="w-4 h-4 text-cyan-300" />
              <span className="text-xs text-gray-300">Commute · {commute.mode}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="text-[10px] uppercase tracking-wider text-gray-500">Time</div><div className="text-lg font-mono tabular-nums text-white">{commute.minutes}m</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-gray-500">Rush hour</div><div className="text-lg font-mono tabular-nums text-amber-300">{commute.rushHourMinutes}m</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-gray-500">Distance</div><div className="text-lg font-mono tabular-nums text-white">{commute.distanceMi}mi</div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreTile({ icon: Icon, label, score, desc }: { icon: typeof Footprints; label: string; score: number; desc: string }) {
  const colour = score >= 70 ? 'text-emerald-300' : score >= 50 ? 'text-amber-300' : 'text-rose-300';
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2.5 text-center">
      <Icon className={cn('w-4 h-4 mx-auto mb-0.5', colour)} />
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={cn('text-2xl font-mono font-bold tabular-nums', colour)}>{score}</div>
      <div className="text-[9px] text-gray-500 truncate">{desc}</div>
    </div>
  );
}

export default SchoolWalkPanel;
