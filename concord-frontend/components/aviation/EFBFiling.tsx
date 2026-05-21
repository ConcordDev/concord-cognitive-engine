'use client';

/**
 * EFBFiling — flight plan filing to ATC (simulated DUATS-style filing).
 *
 * ForeFlight feature-parity backlog item 4. Files a real user-saved plan
 * through the plan-file macro, tracks filed → activated → closed status
 * transitions via plan-filing-update, lists filings via plan-filings-list.
 * Every filing references the user's own plan — no fabricated flights.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, FileCheck, Send, PlayCircle, CheckCircle, XCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Plan {
  id: string;
  from: string;
  to: string;
  distance_nm: number | null;
  altitude: number;
  tas: number;
}
interface Filing {
  id: string;
  planId: string;
  confirmation: string;
  flightRules: string;
  departureTime: string;
  pilotName: string;
  soulsOnBoard: number;
  from: string;
  to: string;
  route: string[];
  status: 'filed' | 'activated' | 'closed' | 'cancelled';
  validationIssues: string[];
  filedAt: string;
  history: { status: string; at: string }[];
}

const STATUS_STYLE: Record<Filing['status'], string> = {
  filed: 'bg-sky-500/15 text-sky-300',
  activated: 'bg-emerald-500/15 text-emerald-300',
  closed: 'bg-gray-500/15 text-gray-400',
  cancelled: 'bg-rose-500/15 text-rose-300',
};

export default function EFBFiling() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [filings, setFilings] = useState<Filing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [planId, setPlanId] = useState('');
  const [flightRules, setFlightRules] = useState<'VFR' | 'IFR'>('VFR');
  const [departureTime, setDepartureTime] = useState('');
  const [pilotName, setPilotName] = useState('');
  const [soulsOnBoard, setSoulsOnBoard] = useState(1);
  const [filing, setFiling] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [pl, fl] = await Promise.all([
      lensRun('aviation', 'plan-list', {}),
      lensRun('aviation', 'plan-filings-list', {}),
    ]);
    if (pl.data?.ok && pl.data.result) {
      setPlans((pl.data.result as { plans?: Plan[] }).plans || []);
    }
    if (fl.data?.ok && fl.data.result) {
      setFilings((fl.data.result as { filings?: Filing[] }).filings || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submitFiling = useCallback(async () => {
    if (!planId) {
      setError('Select a saved flight plan to file.');
      return;
    }
    if (!departureTime.trim() || !pilotName.trim()) {
      setError('Departure time and pilot name are required for an ATC filing.');
      return;
    }
    setFiling(true);
    setError(null);
    const r = await lensRun('aviation', 'plan-file', {
      planId,
      flightRules,
      departureTime: departureTime.trim(),
      pilotName: pilotName.trim(),
      soulsOnBoard,
    });
    if (r.data?.ok) {
      setDepartureTime('');
      await refresh();
    } else {
      setError(r.data?.error || 'Filing failed.');
    }
    setFiling(false);
  }, [planId, flightRules, departureTime, pilotName, soulsOnBoard, refresh]);

  const transition = useCallback(
    async (id: string, status: 'activated' | 'closed' | 'cancelled') => {
      const r = await lensRun('aviation', 'plan-filing-update', { id, status });
      if (r.data?.ok) {
        await refresh();
      } else {
        setError(r.data?.error || 'Status change rejected.');
      }
    },
    [refresh],
  );

  return (
    <div className="space-y-4">
      {/* New filing */}
      <div className="rounded-lg border border-sky-500/20 bg-black/20 p-3">
        <div className="flex items-center gap-2 mb-3">
          <Send className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-gray-200 uppercase tracking-wider">
            File a flight plan
          </span>
        </div>
        {plans.length === 0 ? (
          <p className="text-xs text-gray-500">
            No saved plans yet. Compose a flight plan first, then file it here.
          </p>
        ) : (
          <div className="space-y-2">
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
            >
              <option value="">Select a plan…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.from} → {p.to}
                  {p.distance_nm != null ? ` (${p.distance_nm} nm)` : ''}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={flightRules}
                onChange={(e) => setFlightRules(e.target.value as 'VFR' | 'IFR')}
                className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
              >
                <option value="VFR">VFR</option>
                <option value="IFR">IFR</option>
              </select>
              <input
                type="number"
                min={1}
                value={soulsOnBoard}
                onChange={(e) => setSoulsOnBoard(Math.max(1, Number(e.target.value)))}
                placeholder="Souls on board"
                className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
              />
            </div>
            <input
              type="text"
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              placeholder="Departure time (HHMM Zulu or ISO)"
              className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
            />
            <input
              type="text"
              value={pilotName}
              onChange={(e) => setPilotName(e.target.value)}
              placeholder="Pilot in command name"
              className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
            />
            <button
              type="button"
              onClick={submitFiling}
              disabled={filing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40"
            >
              {filing ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileCheck className="w-3 h-3" />}
              File with ATC
            </button>
          </div>
        )}
        {error && <p className="text-xs text-rose-300 mt-2">{error}</p>}
        <p className="text-[10px] text-gray-600 mt-2">
          Simulated DUATS-style filing — assigns a confirmation and tracks status.
        </p>
      </div>

      {/* Filings list */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
          Filed flight plans
        </p>
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : filings.length === 0 ? (
          <p className="text-center text-xs text-gray-500 py-4">No filings yet.</p>
        ) : (
          <div className="space-y-2">
            {filings.map((f) => (
              <div key={f.id} className="rounded border border-white/10 bg-black/30 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-mono text-gray-100">
                      {f.from} → {f.to}
                      <span className="text-cyan-300 ml-2">{f.flightRules}</span>
                    </p>
                    <p className="text-[10px] text-gray-500 font-mono">
                      {f.confirmation} · dep {f.departureTime} · {f.soulsOnBoard} SOB · {f.pilotName}
                    </p>
                  </div>
                  <span
                    className={
                      'text-[10px] px-2 py-0.5 rounded uppercase font-mono ' + STATUS_STYLE[f.status]
                    }
                  >
                    {f.status}
                  </span>
                </div>
                {f.route.length > 0 && (
                  <p className="text-[10px] text-gray-500 font-mono mt-1">
                    Route: {f.route.join(' ')}
                  </p>
                )}
                {f.validationIssues.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {f.validationIssues.map((iss, i) => (
                      <li key={i} className="text-[10px] text-amber-300">
                        ⚠ {iss}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-1.5 mt-2">
                  {f.status === 'filed' && (
                    <>
                      <button
                        type="button"
                        onClick={() => transition(f.id, 'activated')}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-200"
                      >
                        <PlayCircle className="w-3 h-3" /> Activate
                      </button>
                      <button
                        type="button"
                        onClick={() => transition(f.id, 'cancelled')}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-200"
                      >
                        <XCircle className="w-3 h-3" /> Cancel
                      </button>
                    </>
                  )}
                  {f.status === 'activated' && (
                    <button
                      type="button"
                      onClick={() => transition(f.id, 'closed')}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-500/30 bg-gray-500/10 text-[10px] text-gray-300"
                    >
                      <CheckCircle className="w-3 h-3" /> Close
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
