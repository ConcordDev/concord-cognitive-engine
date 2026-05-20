'use client';

import { useState } from 'react';
import { MapPin, Phone, Mail, Globe, Search, Loader2, Users, Twitter } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface Rep {
  name: string;
  party: 'D' | 'R' | 'I' | 'L' | 'G' | string;
  office: string;
  level: 'federal' | 'state' | 'local';
  district?: string;
  phone?: string;
  email?: string;
  website?: string;
  twitter?: string;
  photoUrl?: string;
  termEnd?: string;
}

export function RepresentativeFinder() {
  const [address, setAddress] = useState('');
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!address.trim()) { setError('Enter address or ZIP'); return; }
    setError(null); setLoading(true); setReps([]);
    try {
      const res = await lensRun({
        domain: 'government', action: 'representatives-find', input: { address: address.trim() },
      });
      setReps((res.data?.result?.representatives || []) as Rep[]);
      if ((res.data?.result?.representatives || []).length === 0) setError('No representatives found for that address.');
    } catch (e) { setError(e instanceof Error ? e.message : 'lookup failed'); }
    finally { setLoading(false); }
  }

  const byLevel = {
    federal: reps.filter(r => r.level === 'federal'),
    state: reps.filter(r => r.level === 'state'),
    local: reps.filter(r => r.level === 'local'),
  };

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Find my reps</span>
      </header>
      <div className="p-4 space-y-3">
        <form onSubmit={(e) => { e.preventDefault(); lookup(); }} className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-gray-500" />
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Address or ZIP" className="flex-1 px-3 py-2 text-sm bg-lattice-deep border border-lattice-border rounded text-white" />
          <button type="submit" disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Find
          </button>
        </form>
        {error && <p className="text-xs text-red-400">{error}</p>}

        {(['federal', 'state', 'local'] as const).map(level => byLevel[level].length > 0 && (
          <div key={level}>
            <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">{level}</h3>
            <ul className="space-y-2">
              {byLevel[level].map((r, i) => (
                <li key={`${level}-${i}`} className="p-3 bg-white/[0.02] border border-white/10 rounded">
                  <div className="flex items-start gap-3">
                    {r.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.photoUrl} alt={r.name} className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-cyan-500/20 inline-flex items-center justify-center text-cyan-300 text-lg font-bold">{r.name.charAt(0)}</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{r.name}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          r.party === 'D' ? 'bg-blue-500/30 text-blue-200' :
                          r.party === 'R' ? 'bg-red-500/30 text-red-200' :
                          'bg-gray-500/30 text-gray-200'
                        }`}>{r.party}</span>
                      </div>
                      <div className="text-xs text-gray-400">{r.office}{r.district ? ` · District ${r.district}` : ''}</div>
                      <div className="flex items-center gap-3 mt-1 text-[10px]">
                        {r.phone && <a href={`tel:${r.phone}`} className="inline-flex items-center gap-0.5 text-cyan-300 hover:text-cyan-100"><Phone className="w-3 h-3" /> {r.phone}</a>}
                        {r.email && <a href={`mailto:${r.email}`} className="inline-flex items-center gap-0.5 text-cyan-300 hover:text-cyan-100"><Mail className="w-3 h-3" /> Email</a>}
                        {r.website && <a href={r.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-cyan-300 hover:text-cyan-100"><Globe className="w-3 h-3" /> Site</a>}
                        {r.twitter && <a href={`https://twitter.com/${r.twitter.replace('@', '')}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-cyan-300 hover:text-cyan-100"><Twitter className="w-3 h-3" /> @{r.twitter.replace('@', '')}</a>}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RepresentativeFinder;
