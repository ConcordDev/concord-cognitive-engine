'use client';

/**
 * CarbonCreditPanel — carbon-credit registry workflow:
 * issue → verify → retire, with vintage year, methodology, registry
 * and serial numbers. Wires forestry.carbon-credit-issue /
 * carbon-credit-verify / carbon-credit-retire / carbon-credit-list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Leaf, Loader2, Plus, BadgeCheck, Archive } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Credit {
  id: string;
  projectName: string;
  registry: string;
  vintageYear: number;
  tonsCO2: number;
  pricePerTon: number;
  methodology: string;
  status: 'pending_verification' | 'verified' | 'retired';
  verifier: string | null;
  verifiedDate: string | null;
  serialNumber: string | null;
  retiredBy: string | null;
  retiredDate: string | null;
  estimatedValue: number;
}
interface CreditList {
  credits: Credit[];
  count: number;
  totalTons: number;
  verifiedTons: number;
  retiredTons: number;
  totalValue: number;
}

const STATUS_STYLE: Record<string, string> = {
  pending_verification: 'text-yellow-400',
  verified: 'text-emerald-400',
  retired: 'text-zinc-400',
};

export function CarbonCreditPanel() {
  const [list, setList] = useState<CreditList | null>(null);
  const [projectName, setProjectName] = useState('');
  const [tons, setTons] = useState('');
  const [vintage, setVintage] = useState(String(new Date().getFullYear()));
  const [price, setPrice] = useState('25');
  const [registry, setRegistry] = useState('');
  const [methodology, setMethodology] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [verifierBy, setVerifierBy] = useState<Record<string, string>>({});
  const [retireBy, setRetireBy] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await lensRun<CreditList>('forestry', 'carbon-credit-list', {});
    if (r.data?.ok && r.data.result) setList(r.data.result);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const issue = useCallback(async () => {
    if (!projectName.trim()) { setErr('Project name required.'); return; }
    const t = Number(tons);
    if (!Number.isFinite(t) || t <= 0) { setErr('Tons CO2 must be greater than 0.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('forestry', 'carbon-credit-issue', {
      projectName: projectName.trim(), tonsCO2: t,
      vintageYear: Number(vintage) || new Date().getFullYear(),
      pricePerTon: Number(price) || 25,
      registry: registry.trim() || undefined,
      methodology: methodology.trim() || undefined,
    });
    if (r.data?.ok) { setProjectName(''); setTons(''); setMethodology(''); await load(); }
    else setErr(r.data?.error || 'Issue failed.');
    setBusy(false);
  }, [projectName, tons, vintage, price, registry, methodology, load]);

  const verify = useCallback(async (id: string) => {
    const verifier = (verifierBy[id] || '').trim();
    if (!verifier) { setErr('Verifier name required.'); return; }
    setErr(null);
    const r = await lensRun('forestry', 'carbon-credit-verify', { id, verifier });
    if (r.data?.ok) { setVerifierBy((m) => ({ ...m, [id]: '' })); await load(); }
    else setErr(r.data?.error || 'Verify failed.');
  }, [verifierBy, load]);

  const retire = useCallback(async (id: string) => {
    const r = await lensRun('forestry', 'carbon-credit-retire', {
      id, retiredBy: (retireBy[id] || '').trim() || undefined,
    });
    if (r.data?.ok) { setRetireBy((m) => ({ ...m, [id]: '' })); await load(); }
    else setErr(r.data?.error || 'Retire failed.');
  }, [retireBy, load]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Leaf className="w-4 h-4 text-teal-400" />
        <h3 className="text-sm font-bold text-zinc-100">Carbon-Credit Registry</h3>
      </div>

      {list && list.count > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([
            ['Total tons', list.totalTons.toLocaleString()],
            ['Verified', list.verifiedTons.toLocaleString()],
            ['Retired', list.retiredTons.toLocaleString()],
            ['Est. value', `$${list.totalValue.toLocaleString()}`],
          ] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-teal-300">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-1.5 mb-2">
        <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <div className="flex gap-1.5">
          <input value={tons} onChange={(e) => setTons(e.target.value.replace(/[^\d.]/g, ''))} placeholder="tons CO2"
            className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input value={vintage} onChange={(e) => setVintage(e.target.value.replace(/\D/g, ''))} placeholder="vintage yr"
            className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} placeholder="$/ton"
            className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        </div>
        <input value={registry} onChange={(e) => setRegistry(e.target.value)} placeholder="Registry (e.g. Verra, Gold Standard)"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <input value={methodology} onChange={(e) => setMethodology(e.target.value)} placeholder="Methodology (optional)"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
      </div>
      <button onClick={issue} disabled={busy}
        className="px-3 py-1.5 text-xs rounded bg-teal-600 hover:bg-teal-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Issue credit
      </button>
      {err && <p className="text-xs text-rose-400 mt-2">{err}</p>}

      <div className="mt-3 space-y-2">
        {list?.credits.map((c) => (
          <div key={c.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2.5 py-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-zinc-100">{c.projectName}</span>
              <span className="text-[10px] text-zinc-400">vintage {c.vintageYear}</span>
              <span className="text-[10px] text-zinc-400">{c.tonsCO2.toLocaleString()} t · ${c.estimatedValue.toLocaleString()}</span>
              <span className="text-[10px] text-zinc-400">{c.registry}</span>
              <span className={`ml-auto text-[10px] font-semibold ${STATUS_STYLE[c.status]}`}>
                {c.status.replace(/_/g, ' ')}
              </span>
            </div>
            {c.serialNumber && (
              <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                Serial {c.serialNumber}{c.verifier ? ` · verified by ${c.verifier} (${c.verifiedDate})` : ''}
              </p>
            )}
            {c.retiredBy && (
              <p className="text-[10px] text-zinc-400 mt-0.5">Retired by {c.retiredBy} on {c.retiredDate}</p>
            )}
            {c.status === 'pending_verification' && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                <input value={verifierBy[c.id] || ''} onChange={(e) => setVerifierBy((m) => ({ ...m, [c.id]: e.target.value }))}
                  placeholder="verifier (e.g. SCS Global)"
                  className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                <button onClick={() => verify(c.id)}
                  className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1">
                  <BadgeCheck className="w-3 h-3" /> Verify
                </button>
              </div>
            )}
            {c.status === 'verified' && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                <input value={retireBy[c.id] || ''} onChange={(e) => setRetireBy((m) => ({ ...m, [c.id]: e.target.value }))}
                  placeholder="retired by (offset claimant)"
                  className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                <button onClick={() => retire(c.id)}
                  className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1">
                  <Archive className="w-3 h-3" /> Retire
                </button>
              </div>
            )}
          </div>
        ))}
        {(!list || list.count === 0) && <p className="text-xs text-zinc-400 italic">No carbon credits issued yet.</p>}
      </div>
    </div>
  );
}
