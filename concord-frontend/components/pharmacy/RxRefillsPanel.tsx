'use client';

/**
 * RxRefillsPanel — refills running low, refill requests and the
 * user's pharmacy list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertTriangle, Plus, Building2, RefreshCw, MapPin, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface DueRow { medId: string; name: string; quantity: number; daysOfSupply: number; refillsRemaining: number; urgency: string }
interface Refill { id: string; medName: string; pharmacy: string | null; status: string; requestedAt: string }
interface Pharmacy { id: string; name: string; address: string | null; phone: string | null }
interface Medication { id: string; name: string }

// pharmacy.locate result row — ONLY fields the real NPPES NPI Registry
// returns (name / npi / address / city / state / postalCode / phone). No
// rating, hours, or distance field exists here because NPPES doesn't
// provide them — rendering must never invent one.
interface LocateRow {
  name: string | null; npi: string | null; address: string | null;
  city: string | null; state: string | null; postalCode: string | null; phone: string | null;
}

const STATUS_FLOW: Record<string, string> = {
  requested: 'processing', processing: 'ready', ready: 'picked_up',
};
const STATUS_COLOR: Record<string, string> = {
  requested: 'text-amber-400', processing: 'text-sky-400', ready: 'text-emerald-400',
  picked_up: 'text-zinc-400', cancelled: 'text-zinc-600',
};

export function RxRefillsPanel({ onChange }: { onChange: () => void }) {
  const [due, setDue] = useState<DueRow[]>([]);
  const [refills, setRefills] = useState<Refill[]>([]);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phForm, setPhForm] = useState({ name: '', address: '', phone: '' });
  const [showPh, setShowPh] = useState(false);

  // Real physical-pharmacy locator (CMS NPPES NPI Registry) — see
  // pharmacy.locate in server/domains/pharmacy.js. Keyless, federal,
  // honest: no fabricated ratings/hours/distance.
  const [showLocate, setShowLocate] = useState(false);
  const [locateForm, setLocateForm] = useState({ city: '', state: '' });
  const [locateResults, setLocateResults] = useState<LocateRow[] | null>(null);
  const [locateLoading, setLocateLoading] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [locateDisclaimer, setLocateDisclaimer] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [d, r, p, m] = await Promise.all([
      lensRun('pharmacy', 'refills-due', {}),
      lensRun('pharmacy', 'refill-list', {}),
      lensRun('pharmacy', 'pharmacy-list', {}),
      lensRun('pharmacy', 'med-list', {}),
    ]);
    setDue(d.data?.result?.due || []);
    setRefills(r.data?.result?.refills || []);
    setPharmacies(p.data?.result?.pharmacies || []);
    setMeds(m.data?.result?.medications || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const request = async (medId: string) => {
    const r = await lensRun('pharmacy', 'refill-request', { medId, pharmacy: pharmacies[0]?.name });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh(); onChange();
  };
  const advance = async (rf: Refill) => {
    const next = STATUS_FLOW[rf.status];
    if (!next) return;
    await lensRun('pharmacy', 'refill-update', { id: rf.id, status: next, quantityAdded: 30 });
    await refresh(); onChange();
  };
  const addPharmacy = async () => {
    if (!phForm.name.trim()) { setError('Pharmacy name is required.'); return; }
    const r = await lensRun('pharmacy', 'pharmacy-add', { name: phForm.name.trim(), address: phForm.address.trim(), phone: phForm.phone.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setPhForm({ name: '', address: '', phone: '' });
    setShowPh(false); setError(null);
    await refresh();
  };

  const runLocate = async () => {
    if (!locateForm.city.trim() || !locateForm.state.trim()) {
      setLocateError('City and state are required.'); return;
    }
    setLocateLoading(true); setLocateError(null); setLocateResults(null); setLocateDisclaimer(null);
    const r = await lensRun('pharmacy', 'locate', {
      city: locateForm.city.trim(), state: locateForm.state.trim(),
    });
    if (r.data?.ok === false) {
      // Honest failure surfaced verbatim — never a silently-empty list
      // masquerading as "no pharmacies found".
      setLocateError(r.data?.error || 'Pharmacy locator unreachable');
      setLocateLoading(false);
      return;
    }
    const result = r.data?.result as { results: LocateRow[]; disclaimer?: string } | null;
    setLocateResults(result?.results || []);
    setLocateDisclaimer(result?.disclaimer || null);
    setLocateLoading(false);
  };

  const addLocatedPharmacy = async (row: LocateRow) => {
    const name = row.name || 'Unnamed pharmacy';
    const address = [row.address, row.city, row.state, row.postalCode].filter(Boolean).join(', ');
    const r = await lensRun('pharmacy', 'pharmacy-add', { name, address, phone: row.phone || '' });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Running low */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Running low
        </h3>
        {due.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No medications running low.</p>
        ) : (
          <ul className="space-y-1">
            {due.map((d) => (
              <li key={d.medId} className={cn('flex items-center justify-between bg-zinc-900/70 border rounded-lg px-3 py-2',
                d.urgency === 'critical' ? 'border-rose-900/60' : 'border-amber-900/50')}>
                <div>
                  <p className="text-xs text-zinc-200">{d.name}</p>
                  <p className={cn('text-[10px]', d.urgency === 'critical' ? 'text-rose-400' : 'text-amber-400')}>
                    {d.daysOfSupply} days left · {d.refillsRemaining} refills
                  </p>
                </div>
                <button type="button" onClick={() => request(d.medId)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] bg-amber-600 hover:bg-amber-500 text-white rounded-lg">
                  <RefreshCw className="w-3 h-3" /> Request
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Refill requests */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Refill requests</h3>
        {refills.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No refill requests.</p>
        ) : (
          <ul className="space-y-1">
            {refills.map((rf) => (
              <li key={rf.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{rf.medName}</p>
                  <p className="text-[10px] text-zinc-400">{rf.pharmacy || 'No pharmacy'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-[10px] capitalize', STATUS_COLOR[rf.status])}>{rf.status.replace(/_/g, ' ')}</span>
                  {STATUS_FLOW[rf.status] && (
                    <button type="button" onClick={() => advance(rf)}
                      className="text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg capitalize">
                      → {STATUS_FLOW[rf.status].replace(/_/g, ' ')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {meds.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {meds.map((m) => (
              <button key={m.id} type="button" onClick={() => request(m.id)}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 hover:border-amber-700/50 hover:text-amber-300">
                <Plus className="w-3 h-3" /> {m.name}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Pharmacies */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Building2 className="w-3.5 h-3.5 text-amber-400" /> My pharmacies
          </h3>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setShowLocate((v) => !v)}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] bg-sky-900/50 hover:bg-sky-900/70 text-sky-200 rounded-lg">
              <MapPin className="w-3 h-3" /> Find nearby
            </button>
            <button type="button" onClick={() => setShowPh((v) => !v)}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
              <Plus className="w-3 h-3" /> Add manually
            </button>
          </div>
        </div>

        {showLocate && (
          <div className="mb-3 rounded-lg border border-sky-900/50 bg-sky-950/20 p-2.5 space-y-2">
            <p className="text-[10px] text-zinc-400">
              Real search of the CMS NPPES NPI Registry (federal directory, no key required) — not a
              live inventory, hours, or ratings feed. Verify by calling ahead.
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              <input placeholder="City" value={locateForm.city}
                onChange={(e) => setLocateForm({ ...locateForm, city: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void runLocate(); }}
                className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="State (e.g. CA)" maxLength={2} value={locateForm.state}
                onChange={(e) => setLocateForm({ ...locateForm, state: e.target.value.toUpperCase() })}
                onKeyDown={(e) => { if (e.key === 'Enter') void runLocate(); }}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 uppercase" />
            </div>
            <button type="button" onClick={runLocate} disabled={locateLoading}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-sky-700/60 hover:bg-sky-700/80 disabled:opacity-40 text-sky-100 rounded-lg">
              {locateLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Search
            </button>

            {locateError && (
              <p role="alert" className="text-[11px] text-rose-400">{locateError}</p>
            )}

            {locateResults && (
              locateResults.length === 0 ? (
                <p className="text-[11px] text-zinc-400 italic">No pharmacies matched that city/state in the NPPES registry.</p>
              ) : (
                <ul className="space-y-1 max-h-56 overflow-y-auto">
                  {locateResults.map((row) => (
                    <li key={row.npi || row.name} className="flex items-center justify-between gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs text-zinc-100 truncate">{row.name || 'Unnamed pharmacy'}</p>
                        <p className="text-[10px] text-zinc-400 truncate">
                          {[row.address, row.city, row.state, row.postalCode].filter(Boolean).join(', ') || 'Address not on file'}
                          {row.phone ? ` · ${row.phone}` : ''}
                        </p>
                      </div>
                      <button type="button" onClick={() => addLocatedPharmacy(row)}
                        className="shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] bg-emerald-700/50 hover:bg-emerald-700/70 text-emerald-100 rounded-lg">
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
            {locateDisclaimer && <p className="text-[10px] text-zinc-500 italic">{locateDisclaimer}</p>}
          </div>
        )}

        {showPh && (
          <div className="grid grid-cols-3 gap-2 mb-2">
            <input placeholder="Name" value={phForm.name} onChange={(e) => setPhForm({ ...phForm, name: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Address" value={phForm.address} onChange={(e) => setPhForm({ ...phForm, address: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Phone" value={phForm.phone} onChange={(e) => setPhForm({ ...phForm, phone: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addPharmacy}
              className="col-span-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add pharmacy</button>
          </div>
        )}
        {pharmacies.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No pharmacies added.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {pharmacies.map((p) => (
              <li key={p.id} className="text-[11px] px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300">
                {p.name}{p.phone ? ` · ${p.phone}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
