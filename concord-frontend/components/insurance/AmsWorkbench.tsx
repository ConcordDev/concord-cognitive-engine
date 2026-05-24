'use client';

/**
 * AmsWorkbench — Agency Management System workbench.
 *
 * Surfaces the seven Applied Epic / EZLynx feature-parity backlog items as
 * real, purpose-built UI wired to the `insurance` domain macros:
 *   1. Carrier rating / comparative quote bridge   (carrier-* / carrier-rate)
 *   2. Policy renewal automation pipeline           (renewal-pipeline-*)
 *   3. Claims FNOL intake + adjuster routing        (fnol-*)
 *   4. Commission reconciliation vs statements      (statement-*)
 *   5. Certificate of insurance / ACORD export      (certificate-*)
 *   6. Producer / book-of-business leaderboard      (book-of-business / producer-leaderboard)
 *   7. Document e-signature + binder issuance       (esign-* / binder-issue)
 *
 * Every value is real user input or computed by the backend from real
 * platform state — no seed/mock/demo data anywhere.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Building2, RefreshCw, ClipboardList, Receipt, FileCheck2, Trophy,
  PenLine, Loader2, Plus, Trash2, ArrowRight, AlertTriangle, CheckCircle2,
  ChevronRight, Star, Send,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AmsTab = 'carriers' | 'renewals' | 'fnol' | 'reconcile' | 'certificates' | 'book' | 'esign';

interface Carrier {
  id: string;
  name: string;
  amBestRating: string | null;
  appointed: boolean;
  lines: string[];
  baseCommissionPct: number;
  rateIndex: number;
  claimsServiceScore: number;
}

interface RateQuote {
  carrierId: string;
  carrier: string;
  amBestRating: string | null;
  annualPremium: number;
  commission: number;
  commissionPct: number;
  claimsServiceScore: number;
  fitScore: number;
}

interface RenewalItem {
  id: string;
  policyId: string;
  carrier: string;
  kind: string;
  policyNumber: string;
  currentPremium: number;
  proposedPremium: number;
  rateChangePct: number;
  renewalDate: string;
  daysUntil: number;
  stage: string;
  remarketing: boolean;
  reminders: { at: string; label: string }[];
}

interface FnolItem {
  id: string;
  description: string;
  lossType: string;
  lossDate: string;
  severity: string;
  routedTo: string;
  assignedAdjuster: string | null;
  estimatedLoss: number;
  reservesSet: number;
  status: string;
  injuries: boolean;
  sla: { contactByHours: number };
}

interface PolicyLite { id: string; carrier: string; policyNumber: string; kind: string; annualPremium: number }

interface StmtLineDraft { policyNumber: string; premium: number; commission: number }

interface Statement {
  id: string;
  carrier: string;
  period: string;
  lines: StmtLineDraft[];
  statedTotal: number;
  reconciled: boolean;
  reconciliation?: {
    matched: number; unmatched: number; discrepancies: number;
    statedTotal: number; expectedTotal: number; netVariance: number;
  };
}

interface ReconResult {
  matched: number; unmatched: number; discrepancies: number;
  statedTotal: number; expectedTotal: number; netVariance: number;
  matchedRows: { policyNumber: string; statedCommission: number; expectedCommission: number; variance: number }[];
  unmatchedRows: { policyNumber: string; commission: number; reason: string }[];
}

interface Certificate {
  id: string;
  formType: string;
  policyNumber: string;
  carrier: string;
  certificateHolder: string;
  insured: string | null;
  additionalInsured: boolean;
  revoked: boolean;
}

interface BookOfBusiness {
  totalPolicies: number;
  activePolicies: number;
  writtenPremium: number;
  avgPremium: number;
  lossRatio: number;
  retentionRate: number;
  openClaims: number;
  lineMix: { kind: string; policies: number; premium: number; sharePct: number }[];
  topLine: { kind: string } | null;
}

interface LeaderRow { rank: number; name: string; policies: number; premium: number; estCommission: number }

interface Signer { name: string; email: string | null; role: string; signed: boolean; signedAt: string | null }
interface Envelope {
  id: string;
  title: string;
  docType: string;
  status: string;
  binderIssued: boolean;
  signers: Signer[];
  binder?: { id: string; carrier: string | null; termDays: number; effectiveDate: string; expiryDate: string };
}

/* ------------------------------------------------------------------ */
/*  Shared styles                                                      */
/* ------------------------------------------------------------------ */

const card = 'bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden';
const inputCls = 'px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white text-xs w-full';
const btnPrimary = 'px-3 py-1.5 rounded bg-cyan-500 text-black text-xs font-bold hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
const btnGhost = 'px-2 py-1 rounded text-[11px] text-gray-300 hover:text-white hover:bg-white/5 inline-flex items-center gap-1';

const TABS: { id: AmsTab; label: string; icon: typeof Building2 }[] = [
  { id: 'carriers', label: 'Carrier Rating', icon: Building2 },
  { id: 'renewals', label: 'Renewal Pipeline', icon: RefreshCw },
  { id: 'fnol', label: 'FNOL Intake', icon: ClipboardList },
  { id: 'reconcile', label: 'Commission Recon', icon: Receipt },
  { id: 'certificates', label: 'ACORD / COI', icon: FileCheck2 },
  { id: 'book', label: 'Book of Business', icon: Trophy },
  { id: 'esign', label: 'E-Sign & Binder', icon: PenLine },
];

const SEVERITY_COLOR: Record<string, string> = {
  catastrophic: 'bg-red-500/20 text-red-300',
  large_loss: 'bg-orange-500/20 text-orange-300',
  standard: 'bg-blue-500/20 text-blue-300',
  fast_track: 'bg-green-500/20 text-green-300',
};
const STAGE_ORDER = ['to_quote', 'quoted', 'proposed', 'bound', 'lapsed'];

function fmt(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 2 }); }

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */

export function AmsWorkbench() {
  const [tab, setTab] = useState<AmsTab>('carriers');
  const [policies, setPolicies] = useState<PolicyLite[]>([]);

  const loadPolicies = useCallback(async () => {
    try {
      const r = await lensRun('insurance', 'policy-list', {});
      if (r.data?.ok) setPolicies(((r.data.result as { policies?: PolicyLite[] })?.policies) || []);
    } catch (e) { console.error('[AMS] policy-list', e); }
  }, []);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);

  return (
    <div className={card}>
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Agency Management Workbench
        </span>
        <span className="ml-auto text-[10px] text-gray-400">Applied Epic / EZLynx parity</span>
      </header>

      <nav className="flex items-center gap-1 px-2 py-2 border-b border-white/10 flex-wrap">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap',
                tab === t.id ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:text-white hover:bg-white/5',
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'carriers' && <CarrierRating />}
        {tab === 'renewals' && <RenewalPipeline />}
        {tab === 'fnol' && <FnolIntake policies={policies} />}
        {tab === 'reconcile' && <CommissionRecon policies={policies} />}
        {tab === 'certificates' && <Certificates policies={policies} />}
        {tab === 'book' && <BookPanel />}
        {tab === 'esign' && <ESignBinder policies={policies} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  #1 Carrier rating / comparative quote bridge                       */
/* ------------------------------------------------------------------ */

function CarrierRating() {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amBest, setAmBest] = useState('');
  const [linesStr, setLinesStr] = useState('');
  const [commissionPct, setCommissionPct] = useState('');
  const [rateIndex, setRateIndex] = useState('1');
  const [serviceScore, setServiceScore] = useState('');
  const [busy, setBusy] = useState(false);

  const [rateLine, setRateLine] = useState('auto');
  const [basePremium, setBasePremium] = useState('');
  const [riskFactor, setRiskFactor] = useState('1');
  const [quotes, setQuotes] = useState<RateQuote[]>([]);
  const [rateErr, setRateErr] = useState('');
  const [rateMeta, setRateMeta] = useState<{ spread: number; cheapest: number; bestFitId: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('insurance', 'carrier-list', {});
      if (r.data?.ok) setCarriers(((r.data.result as { carriers?: Carrier[] })?.carriers) || []);
    } catch (e) { console.error('[AMS] carrier-list', e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function addCarrier() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await lensRun('insurance', 'carrier-add', {
        name: name.trim(),
        amBestRating: amBest.trim() || undefined,
        lines: linesStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
        baseCommissionPct: Number(commissionPct) || 0,
        rateIndex: Number(rateIndex) || 1,
        claimsServiceScore: Number(serviceScore) || 0,
      });
      if (r.data?.ok) {
        setName(''); setAmBest(''); setLinesStr(''); setCommissionPct('');
        setRateIndex('1'); setServiceScore(''); setAdding(false);
        await refresh();
      }
    } catch (e) { console.error('[AMS] carrier-add', e); }
    finally { setBusy(false); }
  }

  async function delCarrier(id: string) {
    try {
      const r = await lensRun('insurance', 'carrier-delete', { id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[AMS] carrier-delete', e); }
  }

  async function runRate() {
    setRateErr(''); setQuotes([]); setRateMeta(null);
    const bp = Number(basePremium);
    if (!(bp > 0)) { setRateErr('Enter your underwriting base-premium estimate.'); return; }
    setBusy(true);
    try {
      const r = await lensRun('insurance', 'carrier-rate', {
        line: rateLine, basePremium: bp, riskFactor: Number(riskFactor) || 1,
      });
      if (r.data?.ok) {
        const res = r.data.result as {
          quotes: RateQuote[]; spread: number; cheapest: number;
          bestFit: { carrierId: string } | null;
        };
        setQuotes(res.quotes || []);
        setRateMeta({ spread: res.spread, cheapest: res.cheapest, bestFitId: res.bestFit?.carrierId || '' });
      } else {
        setRateErr(r.data?.error || 'Comparative rate run failed.');
      }
    } catch (e) { console.error('[AMS] carrier-rate', e); setRateErr('Comparative rate run failed.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">
        Maintain your appointed-carrier roster, then run a comparative rate against your own
        underwriting base-premium estimate to find the best price and the best overall fit.
      </p>

      {/* roster */}
      <div className="border border-white/10 rounded-lg">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
          <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Carrier roster</span>
          <span className="text-[10px] text-gray-400">{carriers.length} appointed</span>
          <button onClick={() => setAdding(v => !v)} className={cn(btnGhost, 'ml-auto')}>
            <Plus className="w-3.5 h-3.5" /> Add carrier
          </button>
        </div>
        {adding && (
          <div className="p-3 border-b border-white/10 grid grid-cols-2 md:grid-cols-3 gap-2">
            <input className={inputCls} placeholder="Carrier name" value={name} onChange={e => setName(e.target.value)} />
            <input className={inputCls} placeholder="AM Best rating (A+, A…)" value={amBest} onChange={e => setAmBest(e.target.value)} />
            <input className={inputCls} placeholder="Lines (auto, home, life)" value={linesStr} onChange={e => setLinesStr(e.target.value)} />
            <input className={inputCls} type="number" placeholder="Base commission %" value={commissionPct} onChange={e => setCommissionPct(e.target.value)} />
            <input className={inputCls} type="number" step="0.1" placeholder="Rate index (1.0 = market avg)" value={rateIndex} onChange={e => setRateIndex(e.target.value)} />
            <input className={inputCls} type="number" placeholder="Claims service score (0-10)" value={serviceScore} onChange={e => setServiceScore(e.target.value)} />
            <button onClick={addCarrier} disabled={busy || !name.trim()} className={cn(btnPrimary, 'col-span-2 md:col-span-3 justify-center')}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save carrier
            </button>
          </div>
        )}
        {loading ? (
          <div className="px-3 py-6 text-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
        ) : carriers.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">No carriers on your roster yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {carriers.map(c => (
              <li key={c.id} className="px-3 py-2 flex items-center gap-2 group">
                <span className="text-sm text-white font-medium">{c.name}</span>
                {c.amBestRating && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold">AM Best {c.amBestRating}</span>}
                <span className="text-[10px] text-gray-400">{c.lines.length ? c.lines.join(', ') : 'all lines'}</span>
                <span className="text-[10px] text-gray-400">· {c.baseCommissionPct}% comm</span>
                <span className="text-[10px] text-gray-400">· rate {c.rateIndex}×</span>
                <span className="ml-auto text-[10px] text-cyan-300">service {c.claimsServiceScore}/10</span>
                <button onClick={() => delCarrier(c.id)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400" title="Remove">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* comparative rate run */}
      <div className="border border-white/10 rounded-lg">
        <div className="px-3 py-2 border-b border-white/10">
          <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Comparative rate run</span>
        </div>
        <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className={inputCls} placeholder="Line (auto, home…)" value={rateLine} onChange={e => setRateLine(e.target.value)} />
          <input className={inputCls} type="number" placeholder="Base premium estimate $" value={basePremium} onChange={e => setBasePremium(e.target.value)} />
          <input className={inputCls} type="number" step="0.1" placeholder="Risk factor (1.0 avg)" value={riskFactor} onChange={e => setRiskFactor(e.target.value)} />
          <button onClick={runRate} disabled={busy} className={cn(btnPrimary, 'justify-center')}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />} Compare
          </button>
        </div>
        {rateErr && (
          <div className="mx-3 mb-3 px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-[11px] text-red-300 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {rateErr}
          </div>
        )}
        {quotes.length > 0 && rateMeta && (
          <div className="px-3 pb-3 space-y-2">
            <div className="text-[10px] text-gray-400">
              Cheapest <span className="text-green-300">${fmt(rateMeta.cheapest)}</span> ·
              Spread <span className="text-yellow-300">${fmt(rateMeta.spread)}</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-gray-400 text-left">
                  <th className="py-1">Carrier</th>
                  <th className="py-1 text-right">Premium</th>
                  <th className="py-1 text-right">Commission</th>
                  <th className="py-1 text-right">Fit score</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q, i) => (
                  <tr key={q.carrierId} className={cn('border-t border-white/5', q.carrierId === rateMeta.bestFitId && 'bg-cyan-500/[0.06]')}>
                    <td className="py-1.5 text-white">
                      {i === 0 && <span className="text-[9px] px-1 rounded bg-green-500/20 text-green-300 mr-1">BEST PRICE</span>}
                      {q.carrierId === rateMeta.bestFitId && <Star className="w-3 h-3 text-yellow-300 inline mr-1" />}
                      {q.carrier}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-yellow-300">${fmt(q.annualPremium)}</td>
                    <td className="py-1.5 text-right tabular-nums text-cyan-300">${fmt(q.commission)}</td>
                    <td className="py-1.5 text-right tabular-nums text-gray-300">{q.fitScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  #2 Renewal pipeline automation                                     */
/* ------------------------------------------------------------------ */

function RenewalPipeline() {
  const [pipeline, setPipeline] = useState<RenewalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [horizon, setHorizon] = useState('90');
  const [rateChange, setRateChange] = useState('0');
  const [premiumAtRisk, setPremiumAtRisk] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('insurance', 'renewal-pipeline-list', {});
      if (r.data?.ok) setPipeline(((r.data.result as { pipeline?: RenewalItem[] })?.pipeline) || []);
    } catch (e) { console.error('[AMS] renewal-pipeline-list', e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function build() {
    setBusy(true);
    try {
      const r = await lensRun('insurance', 'renewal-pipeline-build', {
        horizonDays: Number(horizon) || 90,
        defaultRateChangePct: Number(rateChange) || 0,
      });
      if (r.data?.ok) {
        const res = r.data.result as { pipeline: RenewalItem[]; premiumAtRisk: number };
        setPipeline(res.pipeline || []);
        setPremiumAtRisk(res.premiumAtRisk || 0);
      }
    } catch (e) { console.error('[AMS] renewal-pipeline-build', e); }
    finally { setBusy(false); }
  }

  async function advance(id: string) {
    try {
      const r = await lensRun('insurance', 'renewal-advance', { id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[AMS] renewal-advance', e); }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">
        Build a renewal pipeline from your active policies. Each renewal carries a quote shell,
        an optional rate-change uplift you supply, and a 45/21/7-day reminder schedule.
      </p>

      <div className="border border-white/10 rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-2">
        <input className={inputCls} type="number" placeholder="Horizon days" value={horizon} onChange={e => setHorizon(e.target.value)} />
        <input className={inputCls} type="number" step="0.1" placeholder="Default rate change %" value={rateChange} onChange={e => setRateChange(e.target.value)} />
        <button onClick={build} disabled={busy} className={cn(btnPrimary, 'justify-center')}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Build pipeline
        </button>
      </div>

      {premiumAtRisk > 0 && (
        <div className="text-[11px] text-gray-400">
          Premium at risk this horizon: <span className="text-yellow-300 font-semibold">${fmt(premiumAtRisk)}</span>
        </div>
      )}

      {loading ? (
        <div className="px-3 py-6 text-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
      ) : pipeline.length === 0 ? (
        <div className="px-3 py-8 text-center text-xs text-gray-400 border border-white/10 rounded-lg">
          No renewals in the pipeline yet. Add active policies, then build the pipeline.
        </div>
      ) : (
        <ul className="space-y-2">
          {pipeline.map(r => (
            <li key={r.id} className="border border-white/10 rounded-lg p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-white font-medium">{r.carrier}</span>
                <span className="text-[10px] text-gray-400">#{r.policyNumber} · {r.kind}</span>
                <span className={cn(
                  'text-[9px] px-1.5 py-0.5 rounded font-bold uppercase',
                  r.stage === 'bound' ? 'bg-green-500/20 text-green-300' :
                  r.stage === 'lapsed' ? 'bg-red-500/20 text-red-300' :
                  'bg-cyan-500/20 text-cyan-300',
                )}>{r.stage.replace(/_/g, ' ')}</span>
                <span className={cn('ml-auto text-[10px]', r.daysUntil < 0 ? 'text-red-400' : r.daysUntil < 21 ? 'text-yellow-300' : 'text-gray-400')}>
                  {r.daysUntil < 0 ? `${Math.abs(r.daysUntil)}d overdue` : `renews in ${r.daysUntil}d`}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[11px]">
                <span className="text-gray-400">Current <span className="text-white tabular-nums">${fmt(r.currentPremium)}</span></span>
                <ArrowRight className="w-3 h-3 text-gray-600" />
                <span className="text-gray-400">Proposed <span className="text-yellow-300 tabular-nums">${fmt(r.proposedPremium)}</span></span>
                {r.rateChangePct !== 0 && (
                  <span className={cn('text-[10px]', r.rateChangePct > 0 ? 'text-red-300' : 'text-green-300')}>
                    {r.rateChangePct > 0 ? '+' : ''}{r.rateChangePct}%
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {r.reminders.map((rm, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{rm.at} · {rm.label}</span>
                ))}
              </div>
              {r.stage !== 'bound' && r.stage !== 'lapsed' && (
                <button onClick={() => advance(r.id)} className={cn(btnGhost, 'mt-1.5')}>
                  <ChevronRight className="w-3.5 h-3.5" /> Advance to {STAGE_ORDER[Math.min(STAGE_ORDER.indexOf(r.stage) + 1, 3)].replace(/_/g, ' ')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  #3 FNOL intake + adjuster routing                                  */
/* ------------------------------------------------------------------ */

function FnolIntake({ policies }: { policies: PolicyLite[] }) {
  const [fnols, setFnols] = useState<FnolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState('');
  const [lossType, setLossType] = useState('property');
  const [policyId, setPolicyId] = useState('');
  const [estimatedLoss, setEstimatedLoss] = useState('');
  const [location, setLocation] = useState('');
  const [injuries, setInjuries] = useState(false);
  const [adjusters, setAdjusters] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('insurance', 'fnol-list', {});
      if (r.data?.ok) setFnols(((r.data.result as { fnol?: FnolItem[] })?.fnol) || []);
    } catch (e) { console.error('[AMS] fnol-list', e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function intake() {
    if (!description.trim()) return;
    setBusy(true);
    try {
      const r = await lensRun('insurance', 'fnol-intake', {
        description: description.trim(),
        lossType: lossType.trim().toLowerCase(),
        policyId: policyId || undefined,
        estimatedLoss: Number(estimatedLoss) || 0,
        location: location.trim() || undefined,
        injuries,
        adjusters: adjusters.split(',').map(s => s.trim()).filter(Boolean),
      });
      if (r.data?.ok) {
        setDescription(''); setEstimatedLoss(''); setLocation('');
        setInjuries(false); setPolicyId('');
        await refresh();
      }
    } catch (e) { console.error('[AMS] fnol-intake', e); }
    finally { setBusy(false); }
  }

  async function setStatus(id: string, status: string) {
    try {
      const r = await lensRun('insurance', 'fnol-update', { id, status });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[AMS] fnol-update', e); }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">
        Take a First Notice of Loss. Severity is auto-derived from estimated loss and injuries,
        and the claim is routed to the correct queue with an adjuster assigned round-robin.
      </p>

      <div className="border border-white/10 rounded-lg p-3 space-y-2">
        <textarea
          className={cn(inputCls, 'min-h-[60px] resize-y')}
          placeholder="Loss description (what happened)…"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <input className={inputCls} placeholder="Loss type (property, collision…)" value={lossType} onChange={e => setLossType(e.target.value)} />
          <select className={inputCls} value={policyId} onChange={e => setPolicyId(e.target.value)}>
            <option value="">No linked policy</option>
            {policies.map(p => <option key={p.id} value={p.id}>{p.carrier} · {p.policyNumber}</option>)}
          </select>
          <input className={inputCls} type="number" placeholder="Estimated loss $" value={estimatedLoss} onChange={e => setEstimatedLoss(e.target.value)} />
          <input className={inputCls} placeholder="Loss location" value={location} onChange={e => setLocation(e.target.value)} />
          <input className={inputCls} placeholder="Adjuster pool (comma-sep)" value={adjusters} onChange={e => setAdjusters(e.target.value)} />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-300 px-1">
            <input type="checkbox" checked={injuries} onChange={e => setInjuries(e.target.checked)} /> Injuries reported
          </label>
        </div>
        <button onClick={intake} disabled={busy || !description.trim()} className={cn(btnPrimary, 'w-full justify-center')}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Submit FNOL
        </button>
      </div>

      {loading ? (
        <div className="px-3 py-6 text-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
      ) : fnols.length === 0 ? (
        <div className="px-3 py-8 text-center text-xs text-gray-400 border border-white/10 rounded-lg">No losses reported yet.</div>
      ) : (
        <ul className="space-y-2">
          {fnols.map(f => (
            <li key={f.id} className="border border-white/10 rounded-lg p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-bold uppercase', SEVERITY_COLOR[f.severity] || 'bg-gray-500/20 text-gray-300')}>
                  {f.severity.replace(/_/g, ' ')}
                </span>
                <span className="text-[10px] text-gray-400">{f.lossType} · {f.lossDate}</span>
                {f.injuries && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">INJURY</span>}
                <span className="ml-auto text-[10px] text-gray-400">routed → {f.routedTo.replace(/_/g, ' ')}</span>
              </div>
              <p className="text-xs text-gray-300 mt-1.5">{f.description}</p>
              <div className="mt-1.5 flex items-center gap-3 text-[10px] text-gray-400">
                {f.estimatedLoss > 0 && <span>est. loss <span className="text-yellow-300">${fmt(f.estimatedLoss)}</span></span>}
                <span>adjuster: <span className="text-cyan-300">{f.assignedAdjuster || 'unassigned'}</span></span>
                <span>contact SLA: {f.sla.contactByHours}h</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                {['investigating', 'estimating', 'settled', 'closed'].map(st => (
                  <button
                    key={st}
                    onClick={() => setStatus(f.id, st)}
                    disabled={f.status === st}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded',
                      f.status === st ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'bg-white/5 text-gray-400 hover:text-white',
                    )}
                  >{st}</button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  #4 Commission reconciliation vs carrier statements                 */
/* ------------------------------------------------------------------ */

function CommissionRecon({ policies }: { policies: PolicyLite[] }) {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [carrier, setCarrier] = useState('');
  const [period, setPeriod] = useState('');
  const [lines, setLines] = useState<StmtLineDraft[]>([{ policyNumber: '', premium: 0, commission: 0 }]);
  const [expectedRate, setExpectedRate] = useState('');
  const [recon, setRecon] = useState<Record<string, ReconResult>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('insurance', 'statement-list', {});
      if (r.data?.ok) setStatements(((r.data.result as { statements?: Statement[] })?.statements) || []);
    } catch (e) { console.error('[AMS] statement-list', e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  function updateLine(i: number, patch: Partial<StmtLineDraft>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  async function importStatement() {
    const clean = lines.filter(l => l.policyNumber.trim());
    if (!carrier.trim() || clean.length === 0) return;
    setBusy(true);
    try {
      const r = await lensRun('insurance', 'statement-import', {
        carrier: carrier.trim(),
        period: period.trim() || undefined,
        lines: clean,
      });
      if (r.data?.ok) {
        setCarrier(''); setPeriod('');
        setLines([{ policyNumber: '', premium: 0, commission: 0 }]);
        await refresh();
      }
    } catch (e) { console.error('[AMS] statement-import', e); }
    finally { setBusy(false); }
  }

  async function reconcile(statementId: string) {
    setBusy(true);
    try {
      const r = await lensRun('insurance', 'statement-reconcile', {
        statementId, expectedRatePct: Number(expectedRate) || 0,
      });
      if (r.data?.ok) {
        setRecon(prev => ({ ...prev, [statementId]: r.data.result as unknown as ReconResult }));
        await refresh();
      }
    } catch (e) { console.error('[AMS] statement-reconcile', e); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">
        Import a carrier commission statement line-by-line, then reconcile it against the
        commission expected from your own policies — surfacing every discrepancy.
      </p>

      <div className="border border-white/10 rounded-lg p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Carrier" value={carrier} onChange={e => setCarrier(e.target.value)} />
          <input className={inputCls} placeholder="Period (2026-05)" value={period} onChange={e => setPeriod(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-3 gap-1.5 items-center">
              <input
                className={inputCls}
                placeholder="Policy #"
                list="ams-recon-policies"
                value={l.policyNumber}
                onChange={e => updateLine(i, { policyNumber: e.target.value })}
              />
              <input className={inputCls} type="number" placeholder="Premium $" value={l.premium || ''} onChange={e => updateLine(i, { premium: Number(e.target.value) || 0 })} />
              <input className={inputCls} type="number" placeholder="Commission $" value={l.commission || ''} onChange={e => updateLine(i, { commission: Number(e.target.value) || 0 })} />
            </div>
          ))}
          <datalist id="ams-recon-policies">
            {policies.map(p => <option key={p.id} value={p.policyNumber} />)}
          </datalist>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setLines(prev => [...prev, { policyNumber: '', premium: 0, commission: 0 }])} className={btnGhost}>
            <Plus className="w-3.5 h-3.5" /> Add line
          </button>
          <button onClick={importStatement} disabled={busy || !carrier.trim()} className={cn(btnPrimary, 'ml-auto justify-center')}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Receipt className="w-3.5 h-3.5" />} Import statement
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input className={cn(inputCls, 'max-w-[200px]')} type="number" placeholder="Expected commission rate %" value={expectedRate} onChange={e => setExpectedRate(e.target.value)} />
        <span className="text-[10px] text-gray-400">used as the contracted rate for reconciliation</span>
      </div>

      {loading ? (
        <div className="px-3 py-6 text-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
      ) : statements.length === 0 ? (
        <div className="px-3 py-8 text-center text-xs text-gray-400 border border-white/10 rounded-lg">No statements imported yet.</div>
      ) : (
        <ul className="space-y-2">
          {statements.map(s => {
            const rc = recon[s.id] || (s.reconciliation
              ? { ...s.reconciliation, matchedRows: [], unmatchedRows: [] }
              : null);
            return (
              <li key={s.id} className="border border-white/10 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium">{s.carrier}</span>
                  <span className="text-[10px] text-gray-400">{s.period} · {s.lines.length} lines · stated ${fmt(s.statedTotal)}</span>
                  <button onClick={() => reconcile(s.id)} disabled={busy} className={cn(btnGhost, 'ml-auto')}>
                    <RefreshCw className="w-3.5 h-3.5" /> Reconcile
                  </button>
                </div>
                {rc && (
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-white/[0.03] rounded p-2">
                        <div className="text-sm font-bold text-green-300 tabular-nums">{rc.matched}</div>
                        <div className="text-[9px] uppercase text-gray-400">Matched</div>
                      </div>
                      <div className="bg-white/[0.03] rounded p-2">
                        <div className={cn('text-sm font-bold tabular-nums', rc.unmatched > 0 ? 'text-yellow-300' : 'text-gray-400')}>{rc.unmatched}</div>
                        <div className="text-[9px] uppercase text-gray-400">Unmatched</div>
                      </div>
                      <div className="bg-white/[0.03] rounded p-2">
                        <div className={cn('text-sm font-bold tabular-nums', rc.discrepancies > 0 ? 'text-red-300' : 'text-green-300')}>{rc.discrepancies}</div>
                        <div className="text-[9px] uppercase text-gray-400">Discrepancies</div>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-400">
                      Stated <span className="text-white">${fmt(rc.statedTotal)}</span> vs expected{' '}
                      <span className="text-white">${fmt(rc.expectedTotal)}</span> ·{' '}
                      Net variance{' '}
                      <span className={cn('font-semibold', rc.netVariance < 0 ? 'text-red-300' : rc.netVariance > 0 ? 'text-yellow-300' : 'text-green-300')}>
                        {rc.netVariance > 0 ? '+' : ''}${fmt(rc.netVariance)}
                      </span>
                    </div>
                    {rc.matchedRows.length > 0 && (
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-[9px] uppercase text-gray-400 text-left">
                            <th className="py-1">Policy</th>
                            <th className="py-1 text-right">Stated</th>
                            <th className="py-1 text-right">Expected</th>
                            <th className="py-1 text-right">Variance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rc.matchedRows.map((m, i) => (
                            <tr key={i} className="border-t border-white/5">
                              <td className="py-1 text-gray-300">#{m.policyNumber}</td>
                              <td className="py-1 text-right tabular-nums text-white">${fmt(m.statedCommission)}</td>
                              <td className="py-1 text-right tabular-nums text-gray-400">${fmt(m.expectedCommission)}</td>
                              <td className={cn('py-1 text-right tabular-nums', m.variance < 0 ? 'text-red-300' : m.variance > 0 ? 'text-yellow-300' : 'text-green-300')}>
                                {m.variance > 0 ? '+' : ''}${fmt(m.variance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {rc.unmatchedRows.length > 0 && (
                      <div className="text-[10px] text-yellow-300">
                        Unmatched: {rc.unmatchedRows.map(u => `#${u.policyNumber}`).join(', ')} — no policy on file
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  #5 Certificate of insurance / ACORD export                         */
/* ------------------------------------------------------------------ */

function Certificates({ policies }: { policies: PolicyLite[] }) {
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [policyId, setPolicyId] = useState('');
  const [holder, setHolder] = useState('');
  const [insuredName, setInsuredName] = useState('');
  const [formType, setFormType] = useState('ACORD_25');
  const [description, setDescription] = useState('');
  const [additionalInsured, setAdditionalInsured] = useState(false);
  const [preview, setPreview] = useState<{ id: string; text: string; filename: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('insurance', 'certificate-list', {});
      if (r.data?.ok) setCerts(((r.data.result as { certificates?: Certificate[] })?.certificates) || []);
    } catch (e) { console.error('[AMS] certificate-list', e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function issue() {
    if (!policyId || !holder.trim()) return;
    setBusy(true);
    try {
      const r = await lensRun('insurance', 'certificate-issue', {
        policyId,
        certificateHolder: holder.trim(),
        insuredName: insuredName.trim() || undefined,
        formType,
        description: description.trim() || undefined,
        additionalInsured,
      });
      if (r.data?.ok) {
        setHolder(''); setInsuredName(''); setDescription(''); setAdditionalInsured(false);
        await refresh();
      }
    } catch (e) { console.error('[AMS] certificate-issue', e); }
    finally { setBusy(false); }
  }

  async function exportCert(id: string) {
    try {
      const r = await lensRun('insurance', 'certificate-export', { id });
      if (r.data?.ok) {
        const res = r.data.result as { certificateId: string; text: string; filename: string };
        setPreview({ id: res.certificateId, text: res.text, filename: res.filename });
      }
    } catch (e) { console.error('[AMS] certificate-export', e); }
  }

  function download() {
    if (!preview) return;
    const blob = new Blob([preview.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = preview.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function revoke(id: string) {
    try {
      const r = await lensRun('insurance', 'certificate-revoke', { id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[AMS] certificate-revoke', e); }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">
        Issue a Certificate of Insurance against a real policy and export it in ACORD form
        layout (25 / 27 / 28) as a downloadable document.
      </p>

      <div className="border border-white/10 rounded-lg p-3 space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <select className={inputCls} value={policyId} onChange={e => setPolicyId(e.target.value)}>
            <option value="">Select policy…</option>
            {policies.map(p => <option key={p.id} value={p.id}>{p.carrier} · {p.policyNumber}</option>)}
          </select>
          <select className={inputCls} value={formType} onChange={e => setFormType(e.target.value)}>
            <option value="ACORD_25">ACORD 25 — Liability</option>
            <option value="ACORD_27">ACORD 27 — Property</option>
            <option value="ACORD_28">ACORD 28 — Commercial Property</option>
          </select>
          <input className={inputCls} placeholder="Certificate holder" value={holder} onChange={e => setHolder(e.target.value)} />
          <input className={inputCls} placeholder="Insured name" value={insuredName} onChange={e => setInsuredName(e.target.value)} />
          <input className={inputCls} placeholder="Description of operations" value={description} onChange={e => setDescription(e.target.value)} />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-300 px-1">
            <input type="checkbox" checked={additionalInsured} onChange={e => setAdditionalInsured(e.target.checked)} /> Additional insured
          </label>
        </div>
        <button onClick={issue} disabled={busy || !policyId || !holder.trim()} className={cn(btnPrimary, 'w-full justify-center')}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCheck2 className="w-3.5 h-3.5" />} Issue certificate
        </button>
      </div>

      {loading ? (
        <div className="px-3 py-6 text-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
      ) : certs.length === 0 ? (
        <div className="px-3 py-8 text-center text-xs text-gray-400 border border-white/10 rounded-lg">No certificates issued yet.</div>
      ) : (
        <ul className="space-y-2">
          {certs.map(c => (
            <li key={c.id} className="border border-white/10 rounded-lg p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">{c.formType.replace('_', ' ')}</span>
                <span className="text-sm text-white">{c.certificateHolder}</span>
                <span className="text-[10px] text-gray-400">#{c.policyNumber} · {c.carrier}</span>
                {c.additionalInsured && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">+AI</span>}
                {c.revoked && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">REVOKED</span>}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => exportCert(c.id)} className={btnGhost}><FileCheck2 className="w-3.5 h-3.5" /> Export</button>
                  {!c.revoked && (
                    <button onClick={() => revoke(c.id)} className={cn(btnGhost, 'text-red-400 hover:text-red-300')}>
                      <Trash2 className="w-3.5 h-3.5" /> Revoke
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="border border-cyan-500/30 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/[0.02]">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">ACORD form preview</span>
            <button onClick={download} className={cn(btnPrimary, 'ml-auto')}>Download .txt</button>
            <button onClick={() => setPreview(null)} className={btnGhost}>Close</button>
          </div>
          <pre className="p-3 text-[11px] text-gray-300 whitespace-pre-wrap font-mono max-h-72 overflow-y-auto">{preview.text}</pre>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  #6 Book of business + producer leaderboard                         */
/* ------------------------------------------------------------------ */

function BookPanel() {
  const [book, setBook] = useState<BookOfBusiness | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dimension, setDimension] = useState<'carrier' | 'kind'>('carrier');
  const [commissionRate, setCommissionRate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, l] = await Promise.all([
        lensRun('insurance', 'book-of-business', {}),
        lensRun('insurance', 'producer-leaderboard', { dimension, commissionRatePct: Number(commissionRate) || 0 }),
      ]);
      if (b.data?.ok) setBook(b.data.result as unknown as BookOfBusiness);
      if (l.data?.ok) setLeaderboard(((l.data.result as { leaderboard?: LeaderRow[] })?.leaderboard) || []);
    } catch (e) { console.error('[AMS] book panel', e); }
    finally { setLoading(false); }
  }, [dimension, commissionRate]);
  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="px-3 py-8 text-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>;
  }

  const hasBook = book && book.totalPolicies > 0;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">
        Your book-of-business performance and a producer leaderboard ranking your own carriers or
        lines of business by premium placed — every figure computed from your real policies.
      </p>

      {!hasBook ? (
        <div className="px-3 py-8 text-center text-xs text-gray-400 border border-white/10 rounded-lg">
          No policies on file yet — add policies to build your book of business.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: 'Written premium', value: `$${fmt(book!.writtenPremium)}`, color: 'text-green-300' },
              { label: 'Active policies', value: String(book!.activePolicies), color: 'text-white' },
              { label: 'Loss ratio', value: `${book!.lossRatio}%`, color: book!.lossRatio > 70 ? 'text-red-300' : 'text-cyan-300' },
              { label: 'Retention', value: `${book!.retentionRate}%`, color: 'text-cyan-300' },
            ].map(m => (
              <div key={m.label} className="bg-white/[0.03] rounded-lg p-3 text-center">
                <div className={cn('text-lg font-bold tabular-nums', m.color)}>{m.value}</div>
                <div className="text-[9px] uppercase tracking-wider text-gray-400">{m.label}</div>
              </div>
            ))}
          </div>

          {book!.lineMix.length > 0 && (
            <div className="border border-white/10 rounded-lg p-3">
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Line-of-business mix</div>
              <ChartKit
                kind="bar"
                data={book!.lineMix.map(l => ({ kind: l.kind, premium: l.premium }))}
                xKey="kind"
                series={[{ key: 'premium', label: 'Premium', color: '#06b6d4' }]}
                height={180}
                showLegend={false}
              />
            </div>
          )}
        </>
      )}

      <div className="border border-white/10 rounded-lg">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
          <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Producer leaderboard</span>
          <select className={cn(inputCls, 'ml-auto max-w-[120px]')} value={dimension} onChange={e => setDimension(e.target.value as 'carrier' | 'kind')}>
            <option value="carrier">By carrier</option>
            <option value="kind">By line</option>
          </select>
          <input className={cn(inputCls, 'max-w-[140px]')} type="number" placeholder="Commission rate %" value={commissionRate} onChange={e => setCommissionRate(e.target.value)} />
        </div>
        {leaderboard.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-gray-400">No active policies to rank.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase text-gray-400 text-left">
                <th className="py-1.5 px-3">#</th>
                <th className="py-1.5">{dimension === 'carrier' ? 'Carrier' : 'Line'}</th>
                <th className="py-1.5 text-right">Policies</th>
                <th className="py-1.5 text-right">Premium</th>
                <th className="py-1.5 text-right px-3">Est. commission</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map(row => (
                <tr key={row.name} className="border-t border-white/5">
                  <td className="py-1.5 px-3">
                    <span className={cn(
                      'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold',
                      row.rank === 1 ? 'bg-yellow-500/20 text-yellow-300' :
                      row.rank === 2 ? 'bg-gray-400/20 text-gray-300' :
                      row.rank === 3 ? 'bg-orange-500/20 text-orange-300' :
                      'bg-white/5 text-gray-400',
                    )}>{row.rank}</span>
                  </td>
                  <td className="py-1.5 text-white">{row.name}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-300">{row.policies}</td>
                  <td className="py-1.5 text-right tabular-nums text-yellow-300">${fmt(row.premium)}</td>
                  <td className="py-1.5 text-right tabular-nums text-cyan-300 px-3">${fmt(row.estCommission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  #7 Document e-signature + binder issuance                          */
/* ------------------------------------------------------------------ */

function ESignBinder({ policies }: { policies: PolicyLite[] }) {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('application');
  const [policyId, setPolicyId] = useState('');
  const [signers, setSigners] = useState<{ name: string; email: string; role: string }[]>([
    { name: '', email: '', role: 'applicant' },
  ]);
  const [binderTerm, setBinderTerm] = useState('30');
  const [binderCarrier, setBinderCarrier] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('insurance', 'esign-list', {});
      if (r.data?.ok) setEnvelopes(((r.data.result as { envelopes?: Envelope[] })?.envelopes) || []);
    } catch (e) { console.error('[AMS] esign-list', e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  function updateSigner(i: number, patch: Partial<{ name: string; email: string; role: string }>) {
    setSigners(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  async function createEnvelope() {
    const clean = signers.filter(s => s.name.trim());
    if (!title.trim() || clean.length === 0) return;
    setBusy(true);
    try {
      const r = await lensRun('insurance', 'esign-create', {
        title: title.trim(),
        docType,
        policyId: policyId || undefined,
        signers: clean.map(s => ({ name: s.name.trim(), email: s.email.trim() || undefined, role: s.role })),
      });
      if (r.data?.ok) {
        setTitle(''); setPolicyId('');
        setSigners([{ name: '', email: '', role: 'applicant' }]);
        await refresh();
      }
    } catch (e) { console.error('[AMS] esign-create', e); }
    finally { setBusy(false); }
  }

  async function sign(envelopeId: string, signerName: string) {
    setBusy(true);
    try {
      const r = await lensRun('insurance', 'esign-sign', { id: envelopeId, signerName });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[AMS] esign-sign', e); }
    finally { setBusy(false); }
  }

  async function issueBinder(envelopeId: string) {
    setBusy(true);
    try {
      const r = await lensRun('insurance', 'binder-issue', {
        envelopeId,
        termDays: Number(binderTerm) || 30,
        carrier: binderCarrier.trim() || undefined,
      });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[AMS] binder-issue', e); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">
        Send a document for signature, collect every signer&apos;s sign-off, then issue a
        temporary binder as proof of coverage once the envelope is fully executed.
      </p>

      <div className="border border-white/10 rounded-lg p-3 space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <input className={inputCls} placeholder="Document title" value={title} onChange={e => setTitle(e.target.value)} />
          <select className={inputCls} value={docType} onChange={e => setDocType(e.target.value)}>
            <option value="application">Application</option>
            <option value="endorsement">Endorsement</option>
            <option value="cancellation">Cancellation</option>
            <option value="acord_form">ACORD form</option>
          </select>
          <select className={inputCls} value={policyId} onChange={e => setPolicyId(e.target.value)}>
            <option value="">No linked policy</option>
            {policies.map(p => <option key={p.id} value={p.id}>{p.carrier} · {p.policyNumber}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          {signers.map((s, i) => (
            <div key={i} className="grid grid-cols-3 gap-1.5">
              <input className={inputCls} placeholder="Signer name" value={s.name} onChange={e => updateSigner(i, { name: e.target.value })} />
              <input className={inputCls} placeholder="Email" value={s.email} onChange={e => updateSigner(i, { email: e.target.value })} />
              <select className={inputCls} value={s.role} onChange={e => updateSigner(i, { role: e.target.value })}>
                <option value="applicant">Applicant</option>
                <option value="producer">Producer</option>
                <option value="insured">Insured</option>
                <option value="witness">Witness</option>
              </select>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSigners(prev => [...prev, { name: '', email: '', role: 'insured' }])} className={btnGhost}>
            <Plus className="w-3.5 h-3.5" /> Add signer
          </button>
          <button onClick={createEnvelope} disabled={busy || !title.trim()} className={cn(btnPrimary, 'ml-auto justify-center')}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send for signature
          </button>
        </div>
      </div>

      {loading ? (
        <div className="px-3 py-6 text-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
      ) : envelopes.length === 0 ? (
        <div className="px-3 py-8 text-center text-xs text-gray-400 border border-white/10 rounded-lg">No signature envelopes yet.</div>
      ) : (
        <ul className="space-y-2">
          {envelopes.map(env => {
            const signedCount = env.signers.filter(s => s.signed).length;
            return (
              <li key={env.id} className="border border-white/10 rounded-lg p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-white font-medium">{env.title}</span>
                  <span className="text-[10px] text-gray-400">{env.docType}</span>
                  <span className={cn(
                    'text-[9px] px-1.5 py-0.5 rounded font-bold uppercase',
                    env.status === 'completed' ? 'bg-green-500/20 text-green-300' :
                    env.status === 'voided' ? 'bg-red-500/20 text-red-300' :
                    'bg-yellow-500/20 text-yellow-300',
                  )}>{env.status}</span>
                  <span className="ml-auto text-[10px] text-gray-400">{signedCount}/{env.signers.length} signed</span>
                </div>
                <ul className="mt-2 space-y-1">
                  {env.signers.map((s, i) => (
                    <li key={i} className="flex items-center gap-2 text-[11px]">
                      {s.signed
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                        : <PenLine className="w-3.5 h-3.5 text-gray-400" />}
                      <span className="text-gray-300">{s.name}</span>
                      <span className="text-[9px] text-gray-400">{s.role}</span>
                      {s.signed
                        ? <span className="ml-auto text-[9px] text-green-300">signed</span>
                        : (
                          <button onClick={() => sign(env.id, s.name)} disabled={busy} className={cn(btnGhost, 'ml-auto')}>
                            Sign now
                          </button>
                        )}
                    </li>
                  ))}
                </ul>
                {env.status === 'completed' && !env.binderIssued && (
                  <div className="mt-2 flex items-center gap-1.5 pt-2 border-t border-white/5">
                    <input className={cn(inputCls, 'max-w-[120px]')} type="number" placeholder="Term days" value={binderTerm} onChange={e => setBinderTerm(e.target.value)} />
                    <input className={cn(inputCls, 'max-w-[160px]')} placeholder="Binder carrier" value={binderCarrier} onChange={e => setBinderCarrier(e.target.value)} />
                    <button onClick={() => issueBinder(env.id)} disabled={busy} className={cn(btnPrimary, 'ml-auto')}>
                      <FileCheck2 className="w-3.5 h-3.5" /> Issue binder
                    </button>
                  </div>
                )}
                {env.binder && (
                  <div className="mt-2 px-2.5 py-2 rounded bg-green-500/[0.06] border border-green-500/20 text-[11px] text-green-200">
                    Binder issued · {env.binder.termDays}-day term · effective {env.binder.effectiveDate} → {env.binder.expiryDate}
                    {env.binder.carrier ? ` · ${env.binder.carrier}` : ''}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default AmsWorkbench;
