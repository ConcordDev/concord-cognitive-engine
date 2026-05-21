'use client';

import { useEffect, useState, useCallback } from 'react';
import { Vote, Loader2, UserCheck, MapPin, CalendarClock, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Registration {
  id: string; fullName: string; residentialAddress: string; dateOfBirth: string; stateCode: string;
  partyPreference: string; mailInRequested: boolean; status: string; submittedAt: string;
}
interface Election { id: string; name: string; electionDay: string; ocdDivisionId: string }
interface PollingLocation { name: string; line1: string; city: string; state: string; zip: string; pollingHours: string; notes: string }
interface EarlyVoteSite { name: string; line1: string; city: string; state: string }

export function ElectionsPanel() {
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [loading, setLoading] = useState(true);
  const [regForm, setRegForm] = useState({ fullName: '', residentialAddress: '', dateOfBirth: '', stateCode: '', partyPreference: 'unaffiliated', mailInRequested: false });
  const [regError, setRegError] = useState<string | null>(null);

  const [elections, setElections] = useState<Election[]>([]);
  const [electionsError, setElectionsError] = useState<string | null>(null);
  const [electionsLoading, setElectionsLoading] = useState(false);
  const [stateFilter, setStateFilter] = useState('');

  const [pollAddress, setPollAddress] = useState('');
  const [polling, setPolling] = useState<PollingLocation[]>([]);
  const [earlySites, setEarlySites] = useState<EarlyVoteSite[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollLoading, setPollLoading] = useState(false);

  const loadRegistration = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'voter-registration-status', input: {} });
      setRegistration((res.data?.result?.registration || null) as Registration | null);
    } catch (e) { console.error('[Elections] registration', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRegistration(); }, [loadRegistration]);

  async function submitRegistration() {
    setRegError(null);
    if (!regForm.fullName.trim() || !regForm.residentialAddress.trim() || !regForm.dateOfBirth || regForm.stateCode.length !== 2) {
      setRegError('All fields required, state must be 2-letter code.');
      return;
    }
    try {
      const res = await lensRun({ domain: 'government', action: 'voter-registration-submit', input: regForm });
      if (res.data?.ok === false) { setRegError((res.data?.error as string) || 'submit failed'); return; }
      await loadRegistration();
    } catch (e) { setRegError(e instanceof Error ? e.message : 'failed'); }
  }

  async function lookupElections() {
    setElectionsLoading(true); setElectionsError(null);
    try {
      const res = await lensRun({ domain: 'government', action: 'elections-upcoming', input: { stateCode: stateFilter } });
      if (res.data?.ok === false) { setElectionsError((res.data?.error as string) || 'lookup failed'); setElections([]); }
      else setElections((res.data?.result?.elections || []) as Election[]);
    } catch (e) { setElectionsError(e instanceof Error ? e.message : 'failed'); }
    finally { setElectionsLoading(false); }
  }

  async function lookupPolling() {
    if (!pollAddress.trim()) return;
    setPollLoading(true); setPollError(null);
    try {
      const res = await lensRun({ domain: 'government', action: 'polling-place-lookup', input: { address: pollAddress } });
      if (res.data?.ok === false) {
        setPollError((res.data?.error as string) || 'lookup failed'); setPolling([]); setEarlySites([]);
      } else {
        setPolling((res.data?.result?.pollingLocations || []) as PollingLocation[]);
        setEarlySites((res.data?.result?.earlyVoteSites || []) as EarlyVoteSite[]);
      }
    } catch (e) { setPollError(e instanceof Error ? e.message : 'failed'); }
    finally { setPollLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Vote className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Elections &amp; voter registration</span>
      </header>

      {/* Voter registration */}
      <div className="p-3 border-b border-white/10">
        <div className="text-[10px] uppercase text-gray-500 mb-1.5 inline-flex items-center gap-1"><UserCheck className="w-3 h-3" />Voter registration</div>
        {loading ? (
          <div className="text-xs text-gray-500"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Loading…</div>
        ) : registration ? (
          <div className="text-xs text-gray-300 space-y-0.5 bg-white/[0.03] rounded p-2">
            <div><span className="text-gray-500">Name:</span> {registration.fullName}</div>
            <div><span className="text-gray-500">State:</span> {registration.stateCode} · <span className="text-gray-500">Party:</span> {registration.partyPreference}</div>
            <div><span className="text-gray-500">Mail-in ballot:</span> {registration.mailInRequested ? 'requested' : 'no'}</div>
            <div><span className="text-gray-500">Status:</span> <span className="text-emerald-300">{registration.status}</span> · filed {new Date(registration.submittedAt).toLocaleDateString()}</div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-6 gap-2">
              <input value={regForm.fullName} onChange={e => setRegForm({ ...regForm, fullName: e.target.value })} placeholder="Full legal name" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <input value={regForm.dateOfBirth} onChange={e => setRegForm({ ...regForm, dateOfBirth: e.target.value })} type="date" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <input value={regForm.stateCode} onChange={e => setRegForm({ ...regForm, stateCode: e.target.value.toUpperCase().slice(0, 2) })} placeholder="ST" maxLength={2} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            </div>
            <input value={regForm.residentialAddress} onChange={e => setRegForm({ ...regForm, residentialAddress: e.target.value })} placeholder="Residential address" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <div className="flex items-center gap-2">
              <select value={regForm.partyPreference} onChange={e => setRegForm({ ...regForm, partyPreference: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                <option value="unaffiliated">Unaffiliated</option>
                <option value="democratic">Democratic</option>
                <option value="republican">Republican</option>
                <option value="independent">Independent</option>
                <option value="green">Green</option>
                <option value="libertarian">Libertarian</option>
              </select>
              <label className="text-[10px] text-gray-400 inline-flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={regForm.mailInRequested} onChange={e => setRegForm({ ...regForm, mailInRequested: e.target.checked })} className="accent-cyan-500" />
                Request mail-in ballot
              </label>
              <button onClick={submitRegistration} className="ml-auto px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Submit registration</button>
            </div>
            {regError && <div className="text-[10px] text-rose-400">{regError}</div>}
          </div>
        )}
      </div>

      {/* Upcoming elections */}
      <div className="p-3 border-b border-white/10">
        <div className="text-[10px] uppercase text-gray-500 mb-1.5 inline-flex items-center gap-1"><CalendarClock className="w-3 h-3" />Upcoming elections</div>
        <div className="flex items-center gap-2">
          <input value={stateFilter} onChange={e => setStateFilter(e.target.value.toUpperCase().slice(0, 2))} placeholder="ST (optional)" maxLength={2} className="w-24 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={lookupElections} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1">
            {electionsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}Look up
          </button>
        </div>
        {electionsError && <div className="mt-1.5 text-[10px] text-amber-400">{electionsError}</div>}
        {elections.length > 0 && (
          <ul className="mt-2 space-y-1">
            {elections.map(e => (
              <li key={e.id} className="text-xs text-gray-300 bg-white/[0.03] rounded px-2 py-1.5 flex items-center gap-2">
                <CalendarClock className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="flex-1">{e.name}</span>
                <span className="text-cyan-300 font-mono">{e.electionDay}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Polling place lookup */}
      <div className="p-3">
        <div className="text-[10px] uppercase text-gray-500 mb-1.5 inline-flex items-center gap-1"><MapPin className="w-3 h-3" />Polling place lookup</div>
        <div className="flex items-center gap-2">
          <input value={pollAddress} onChange={e => setPollAddress(e.target.value)} placeholder="Your registered address" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={lookupPolling} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1">
            {pollLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}Find
          </button>
        </div>
        {pollError && <div className="mt-1.5 text-[10px] text-amber-400">{pollError}</div>}
        {polling.length > 0 && (
          <div className="mt-2">
            <div className="text-[10px] text-gray-500 mb-1">Election-day polling locations</div>
            <ul className="space-y-1">
              {polling.map((p, i) => (
                <li key={i} className="text-xs text-gray-300 bg-white/[0.03] rounded px-2 py-1.5">
                  <div className="text-white">{p.name || p.line1}</div>
                  <div className="text-[10px] text-gray-500">{[p.line1, p.city, p.state, p.zip].filter(Boolean).join(', ')}</div>
                  {p.pollingHours && <div className="text-[10px] text-cyan-300">Hours: {p.pollingHours}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {earlySites.length > 0 && (
          <div className="mt-2">
            <div className="text-[10px] text-gray-500 mb-1">Early-voting sites</div>
            <ul className="space-y-1">
              {earlySites.map((p, i) => (
                <li key={i} className="text-xs text-gray-300 bg-white/[0.03] rounded px-2 py-1">
                  {p.name || p.line1} — {[p.line1, p.city, p.state].filter(Boolean).join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default ElectionsPanel;
