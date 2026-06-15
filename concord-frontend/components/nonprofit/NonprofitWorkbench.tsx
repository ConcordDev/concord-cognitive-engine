'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * NonprofitWorkbench — the Bloomerang/Givebutter feature surface.
 *
 * Real full-stack wiring of every nonprofit-lens backlog macro:
 *  - Donor CRM (donor-create/list/update/delete, gift log, comm log)
 *  - Donor segmentation (donor-segment)
 *  - Recurring-giving management (pledge-create/list/update/cancel/charge)
 *  - Email / communications (comm-send/compose/log, thankyou-run)
 *  - Tax receipts (receipt-generate, receipt-annual)
 *  - Online donation pages (donation-page-create/list/update/delete/give)
 *  - Volunteer management (volunteer-signup/list/delete, shift-schedule, shift-log-hours)
 *  - Event / peer-to-peer fundraising (event-create/list/delete, p2p-team-create, p2p-donate, p2p-leaderboard)
 *
 * Every value rendered comes from a real macro call — no mock data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, Repeat, Mail, Receipt, Globe, HeartHandshake, Trophy,
  Plus, Trash2, Loader2, X, ChevronDown, ChevronRight,
  CheckCircle2, FileText, Send, CreditCard, PauseCircle, PlayCircle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type WBTab = 'crm' | 'recurring' | 'comms' | 'receipts' | 'pages' | 'volunteers' | 'events';

interface Gift { id: string; amount: number; at: string; fund: string; campaign: string; method: string; receiptIssued: boolean; ackSent: boolean }
interface Pledge { id: string; amount: number; frequency: string; status: string; paid: number; payments: number; nextDue: string; fund: string; donorId?: string; donorName?: string }
interface Comm { id: string; kind: string; channel: string; subject: string; body: string; sentAt: string }
interface Donor {
  id: string; name: string; email: string; phone: string; address: string; type: string; notes: string;
  gifts: Gift[]; comms: Comm[]; pledges: Pledge[];
  totalGiven: number; giftCount: number; avgGift: number;
  lastGiftAt: string | null; firstGiftAt: string | null; pledgeBalance: number; commCount: number;
}
interface Segments { major: Donor[]; midLevel: Donor[]; firstTime: Donor[]; lapsed: Donor[]; recurring: Donor[]; prospect: Donor[] }
interface DonationPage {
  id: string; slug: string; title: string; story: string; goal: number;
  suggestedAmounts: number[]; accentColor: string; coverImage: string;
  published: boolean; raised: number; donations: { id: string; amount: number; donor: string; at: string }[];
  donorCount: number; progressPct: number; publicUrl: string;
}
interface Shift { id: string; role: string; date: string; startTime: string; endTime: string; scheduledHours: number; loggedHours: number; status: string }
interface Volunteer { id: string; name: string; email: string; phone: string; skills: string[]; availability: string; shifts: Shift[]; totalHours: number; status: string }
interface P2PTeam { id: string; teamName: string; captain: string; personalGoal: number; raised: number; donations: { id: string; amount: number; donor: string }[] }
interface NPEvent { id: string; name: string; description: string; date: string | null; goal: number; ticketPrice: number; type: string; teams: P2PTeam[]; status: string; raised: number; donorCount: number; teamCount: number; progressPct: number }

const TABS: { id: WBTab; label: string; icon: typeof Users }[] = [
  { id: 'crm', label: 'Donor CRM', icon: Users },
  { id: 'recurring', label: 'Recurring Giving', icon: Repeat },
  { id: 'comms', label: 'Communications', icon: Mail },
  { id: 'receipts', label: 'Tax Receipts', icon: Receipt },
  { id: 'pages', label: 'Donation Pages', icon: Globe },
  { id: 'volunteers', label: 'Volunteers', icon: HeartHandshake },
  { id: 'events', label: 'Events & P2P', icon: Trophy },
];

function money(n: number): string { return `$${(n || 0).toLocaleString()}`; }
function shortDate(d: string | null | undefined): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return String(d); }
}

// Small shared input style
const inp = 'bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-400';
const btnP = 'px-2.5 py-1 text-xs rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold disabled:opacity-40';
const btnS = 'px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40';
const card = 'bg-zinc-900/60 border border-zinc-800 rounded-lg';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function NonprofitWorkbench() {
  const [tab, setTab] = useState<WBTab>('crm');

  // shared donor pool (used by CRM, recurring, comms, receipts)
  const [donors, setDonors] = useState<Donor[]>([]);
  const [donorsLoaded, setDonorsLoaded] = useState(false);
  const [loadingDonors, setLoadingDonors] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadDonors = useCallback(async () => {
    setLoadingDonors(true); setErr(null);
    const r = await lensRun('nonprofit', 'donor-list', {});
    if (r.data?.ok) setDonors((r.data.result?.donors as Donor[]) || []);
    else setErr(r.data?.error || 'Failed to load donors');
    setDonorsLoaded(true); setLoadingDonors(false);
  }, []);

  useEffect(() => { void loadDonors(); }, [loadDonors]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-rose-400" />
        <h3 className="text-sm font-bold text-zinc-100">Fundraising Workbench</h3>
      </div>

      <nav className="flex items-center gap-1 flex-wrap border-b border-zinc-800 pb-2 mb-3">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                tab === t.id ? 'bg-rose-500/20 text-rose-300' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              }`}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
      </nav>

      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}

      {tab === 'crm' && <CRMTab donors={donors} loaded={donorsLoaded} loading={loadingDonors} reload={loadDonors} />}
      {tab === 'recurring' && <RecurringTab donors={donors} reloadDonors={loadDonors} />}
      {tab === 'comms' && <CommsTab donors={donors} reloadDonors={loadDonors} />}
      {tab === 'receipts' && <ReceiptsTab donors={donors} reloadDonors={loadDonors} />}
      {tab === 'pages' && <PagesTab />}
      {tab === 'volunteers' && <VolunteersTab />}
      {tab === 'events' && <EventsTab />}
    </div>
  );
}

// ===========================================================================
// Donor CRM + Segmentation
// ===========================================================================
function CRMTab({ donors, loaded, loading, reload }: { donors: Donor[]; loaded: boolean; loading: boolean; reload: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', type: 'Individual', notes: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [gift, setGift] = useState({ amount: '', fund: 'General', method: 'check' });
  const [segments, setSegments] = useState<Segments | null>(null);
  const [segSummary, setSegSummary] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);

  const addDonor = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    await lensRun('nonprofit', 'donor-create', { ...form, name: form.name.trim() });
    setForm({ name: '', email: '', phone: '', address: '', type: 'Individual', notes: '' });
    await reload(); setBusy(false);
  };
  const delDonor = async (id: string) => { await lensRun('nonprofit', 'donor-delete', { id }); await reload(); };
  const logGift = async (donorId: string) => {
    if (!gift.amount || Number(gift.amount) <= 0) return;
    setBusy(true);
    await lensRun('nonprofit', 'donor-gift-log', { donorId, amount: Number(gift.amount), fund: gift.fund, method: gift.method });
    setGift({ amount: '', fund: 'General', method: 'check' });
    await reload(); setBusy(false);
  };
  const runSegment = async () => {
    setBusy(true);
    const r = await lensRun('nonprofit', 'donor-segment', {});
    if (r.data?.ok) { setSegments(r.data.result?.segments as Segments); setSegSummary(r.data.result?.summary as Record<string, number>); }
    setBusy(false);
  };

  const totalRaised = useMemo(() => donors.reduce((s, d) => s + d.totalGiven, 0), [donors]);

  return (
    <div className="space-y-3">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Donors" value={String(donors.length)} />
        <Stat label="Lifetime Given" value={money(totalRaised)} />
        <Stat label="Pledge Balance" value={money(donors.reduce((s, d) => s + d.pledgeBalance, 0))} />
      </div>

      {/* New donor form */}
      <div className={`${card} p-2.5 flex flex-wrap gap-1.5`}>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Donor name *" className={`${inp} flex-1 min-w-[130px]`} />
        <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email" className={`${inp} w-40`} />
        <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="phone" className={`${inp} w-28`} />
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={inp}>
          {['Individual', 'Foundation', 'Corporation', 'Government'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="address" className={`${inp} flex-1 min-w-[120px]`} />
        <button onClick={addDonor} disabled={!form.name.trim() || busy} className={btnP}><Plus className="w-3 h-3 inline" /> Add donor</button>
      </div>

      {/* Segmentation */}
      <div className={`${card} p-2.5`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-200">Donor Segmentation</span>
          <button onClick={runSegment} disabled={busy} className={btnS}>{busy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Analyze segments'}</button>
        </div>
        {segSummary && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-2">
            {(['major', 'midLevel', 'firstTime', 'lapsed', 'recurring', 'prospect'] as const).map(k => (
              <div key={k} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-center">
                <p className="text-sm font-bold text-rose-300">{segSummary[k] ?? 0}</p>
                <p className="text-[9px] text-zinc-400 capitalize">{k.replace(/([A-Z])/g, ' $1')}</p>
              </div>
            ))}
          </div>
        )}
        {segments && segments.lapsed.length > 0 && (
          <p className="text-[10px] text-amber-400 mt-1.5">{segments.lapsed.length} lapsed donor(s) — consider a re-engagement appeal.</p>
        )}
      </div>

      {/* Donor list */}
      {loading && <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-zinc-400" /></div>}
      {loaded && donors.length === 0 && <p className="text-xs text-zinc-400 italic text-center py-3">No donors yet. Add your first donor above.</p>}
      <ul className="space-y-1">
        {donors.map(d => (
          <li key={d.id} className={`${card} px-3 py-2`}>
            <div className="group flex items-center gap-2">
              <button onClick={() => setExpanded(expanded === d.id ? null : d.id)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">
                  {expanded === d.id ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />} {d.name}
                  <span className="text-zinc-400 font-normal"> · {d.type}</span>
                </p>
                <p className="text-[10px] text-zinc-400">
                  {money(d.totalGiven)} lifetime · {d.giftCount} gift(s) · avg {money(d.avgGift)} · last {shortDate(d.lastGiftAt)}
                </p>
              </button>
              <button onClick={() => delDonor(d.id)} className="opacity-0 group-hover:opacity-100 text-rose-400" aria-label="Delete donor"><Trash2 className="w-3 h-3" /></button>
            </div>
            {expanded === d.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800 space-y-2">
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
                  {d.email && <span>✉ {d.email}</span>}
                  {d.phone && <span>☎ {d.phone}</span>}
                  {d.address && <span className="col-span-2">⌂ {d.address}</span>}
                  {d.notes && <span className="col-span-2 italic">{d.notes}</span>}
                </div>
                {/* Giving history */}
                {d.gifts.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-0.5">Giving history</p>
                    {d.gifts.map(g => (
                      <p key={g.id} className="text-[11px] text-zinc-400">
                        <span className="text-emerald-400">{money(g.amount)}</span> · {shortDate(g.at)} · {g.fund} · {g.method}
                        {g.receiptIssued && <span className="text-cyan-400"> · receipted</span>}
                      </p>
                    ))}
                  </div>
                )}
                {/* Communication log */}
                {d.comms.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-0.5">Communications ({d.comms.length})</p>
                    {d.comms.slice(-4).map(c => (
                      <p key={c.id} className="text-[11px] text-zinc-400 truncate">{c.kind.replace(/_/g, ' ')} · {c.subject} · {shortDate(c.sentAt)}</p>
                    ))}
                  </div>
                )}
                {/* Log a gift */}
                <div className="flex flex-wrap gap-1 items-center">
                  <input value={gift.amount} onChange={e => setGift({ ...gift, amount: e.target.value })} placeholder="$ gift" className={`${inp} w-20`} />
                  <input value={gift.fund} onChange={e => setGift({ ...gift, fund: e.target.value })} placeholder="fund" className={`${inp} w-24`} />
                  <select value={gift.method} onChange={e => setGift({ ...gift, method: e.target.value })} className={inp}>
                    {['check', 'credit_card', 'ach', 'cash', 'stock', 'daf'].map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                  </select>
                  <button onClick={() => logGift(d.id)} className={btnS}><Plus className="w-3 h-3 inline" /> Log gift</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// Recurring Giving
// ===========================================================================
function RecurringTab({ donors, reloadDonors }: { donors: Donor[]; reloadDonors: () => Promise<void> }) {
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [meta, setMeta] = useState<{ count: number; active: number; monthlyValue: number } | null>(null);
  const [form, setForm] = useState({ donorId: '', amount: '', frequency: 'monthly', fund: 'General' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun('nonprofit', 'pledge-list', {});
    if (r.data?.ok) {
      setPledges((r.data.result?.pledges as Pledge[]) || []);
      setMeta({ count: r.data.result?.count ?? 0, active: r.data.result?.active ?? 0, monthlyValue: r.data.result?.monthlyValue ?? 0 });
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!form.donorId || !form.amount || Number(form.amount) <= 0) return;
    setBusy(true);
    await lensRun('nonprofit', 'pledge-create', { donorId: form.donorId, amount: Number(form.amount), frequency: form.frequency, fund: form.fund });
    setForm({ donorId: '', amount: '', frequency: 'monthly', fund: 'General' });
    await refresh(); await reloadDonors(); setBusy(false);
  };
  const toggle = async (p: Pledge) => {
    await lensRun('nonprofit', 'pledge-update', { donorId: p.donorId, pledgeId: p.id, status: p.status === 'active' ? 'paused' : 'active' });
    await refresh();
  };
  const charge = async (p: Pledge) => {
    await lensRun('nonprofit', 'pledge-charge', { donorId: p.donorId, pledgeId: p.id });
    await refresh(); await reloadDonors();
  };
  const cancel = async (p: Pledge) => {
    await lensRun('nonprofit', 'pledge-cancel', { donorId: p.donorId, pledgeId: p.id });
    await refresh(); await reloadDonors();
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Pledges" value={String(meta?.count ?? 0)} />
        <Stat label="Active" value={String(meta?.active ?? 0)} />
        <Stat label="Monthly Value" value={money(Math.round(meta?.monthlyValue ?? 0))} />
      </div>

      <div className={`${card} p-2.5 flex flex-wrap gap-1.5`}>
        <select value={form.donorId} onChange={e => setForm({ ...form, donorId: e.target.value })} className={`${inp} flex-1 min-w-[140px]`}>
          <option value="">Select donor…</option>
          {donors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="$ amount" className={`${inp} w-24`} />
        <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} className={inp}>
          {['weekly', 'monthly', 'quarterly', 'annual'].map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <input value={form.fund} onChange={e => setForm({ ...form, fund: e.target.value })} placeholder="fund" className={`${inp} w-24`} />
        <button onClick={create} disabled={!form.donorId || !form.amount || busy} className={btnP}><Plus className="w-3 h-3 inline" /> New pledge</button>
      </div>

      {donors.length === 0 && <p className="text-[10px] text-amber-400">Add donors in the CRM tab first — recurring pledges attach to a donor.</p>}
      {pledges.length === 0 && <p className="text-xs text-zinc-400 italic text-center py-3">No recurring pledges yet.</p>}
      <ul className="space-y-1">
        {pledges.map(p => (
          <li key={p.id} className={`${card} px-3 py-2 flex items-center gap-2`}>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-100 truncate">{p.donorName} · {money(p.amount)} / {p.frequency}</p>
              <p className="text-[10px] text-zinc-400">
                {money(p.paid)} paid over {p.payments} charge(s) · next {shortDate(p.nextDue)} · {p.fund}
                <span className={p.status === 'active' ? ' text-emerald-400' : p.status === 'paused' ? ' text-amber-400' : ' text-zinc-400'}> · {p.status}</span>
              </p>
            </div>
            {p.status !== 'cancelled' && (
              <>
                <button onClick={() => charge(p)} disabled={p.status !== 'active'} className={btnS} title="Process scheduled payment"><CreditCard className="w-3 h-3 inline" /> Charge</button>
                <button onClick={() => toggle(p)} className={btnS} title={p.status === 'active' ? 'Pause' : 'Resume'}>
                  {p.status === 'active' ? <PauseCircle className="w-3 h-3 inline" /> : <PlayCircle className="w-3 h-3 inline" />}
                </button>
                <button onClick={() => cancel(p)} className="text-rose-400" aria-label="Cancel pledge"><X className="w-3.5 h-3.5" /></button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// Communications
// ===========================================================================
function CommsTab({ donors, reloadDonors }: { donors: Donor[]; reloadDonors: () => Promise<void> }) {
  const [donorId, setDonorId] = useState('');
  const [kind, setKind] = useState<'thank_you' | 'appeal' | 'receipt' | 'custom'>('thank_you');
  const [cause, setCause] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoResult, setAutoResult] = useState<{ sent: number; queued: { donor: string; gifts: number }[] } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const compose = async () => {
    setBusy(true); setFeedback(null);
    const r = await lensRun('nonprofit', 'comm-compose', { donorId, donorName: donors.find(d => d.id === donorId)?.name, kind, cause, subject, body });
    if (r.data?.ok) setPreview({ subject: r.data.result?.subject, body: r.data.result?.body });
    setBusy(false);
  };
  const send = async () => {
    if (!donorId) { setFeedback('Pick a donor to send to.'); return; }
    setBusy(true); setFeedback(null);
    const r = await lensRun('nonprofit', 'comm-send', { donorId, kind, cause, subject, body });
    if (r.data?.ok) { setFeedback(`Sent ${kind.replace(/_/g, ' ')} to ${r.data.result?.donor}.`); setPreview(null); await reloadDonors(); }
    else setFeedback(r.data?.error || 'Send failed.');
    setBusy(false);
  };
  const runThankYou = async () => {
    setBusy(true); setFeedback(null);
    const r = await lensRun('nonprofit', 'thankyou-run', {});
    if (r.data?.ok) { setAutoResult({ sent: r.data.result?.sent ?? 0, queued: (r.data.result?.queued as { donor: string; gifts: number }[]) || [] }); await reloadDonors(); }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className={`${card} p-2.5`}>
        <p className="text-xs font-semibold text-zinc-200 mb-1.5">Thank-you automation</p>
        <p className="text-[10px] text-zinc-400 mb-1.5">Finds every gift not yet acknowledged and queues a thank-you to that donor.</p>
        <button onClick={runThankYou} disabled={busy} className={btnP}>{busy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <><Send className="w-3 h-3 inline" /> Run thank-you sweep</>}</button>
        {autoResult && (
          <div className="mt-2 text-[11px] text-zinc-300">
            {autoResult.sent === 0 ? 'All gifts already acknowledged.' : `Queued ${autoResult.sent} thank-you message(s):`}
            {autoResult.queued.map((q, i) => <p key={i} className="text-zinc-400">· {q.donor} ({q.gifts} gift{q.gifts !== 1 ? 's' : ''})</p>)}
          </div>
        )}
      </div>

      <div className={`${card} p-2.5 space-y-1.5`}>
        <p className="text-xs font-semibold text-zinc-200">Compose appeal / receipt / message</p>
        <div className="flex flex-wrap gap-1.5">
          <select value={donorId} onChange={e => setDonorId(e.target.value)} className={`${inp} flex-1 min-w-[140px]`}>
            <option value="">Select donor…</option>
            {donors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} className={inp}>
            <option value="thank_you">Thank you</option>
            <option value="appeal">Appeal</option>
            <option value="receipt">Receipt</option>
            <option value="custom">Custom</option>
          </select>
          {kind === 'appeal' && <input value={cause} onChange={e => setCause(e.target.value)} placeholder="cause" className={`${inp} w-32`} />}
        </div>
        {kind === 'custom' && (
          <div className="space-y-1.5">
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="subject" className={`${inp} w-full`} />
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="message body" rows={3} className={`${inp} w-full`} />
          </div>
        )}
        <div className="flex gap-1.5">
          <button onClick={compose} disabled={busy} className={btnS}><FileText className="w-3 h-3 inline" /> Preview</button>
          <button onClick={send} disabled={busy || !donorId} className={btnP}><Send className="w-3 h-3 inline" /> Send</button>
        </div>
        {preview && (
          <div className="bg-zinc-950 border border-zinc-800 rounded p-2 mt-1">
            <p className="text-[11px] font-semibold text-zinc-200">{preview.subject}</p>
            <pre className="whitespace-pre-wrap font-sans text-[10px] text-zinc-400 mt-1">{preview.body}</pre>
          </div>
        )}
        {feedback && <p className="text-[11px] text-emerald-400">{feedback}</p>}
      </div>
    </div>
  );
}

// ===========================================================================
// Tax Receipts
// ===========================================================================
function ReceiptsTab({ donors, reloadDonors }: { donors: Donor[]; reloadDonors: () => Promise<void> }) {
  const [donorId, setDonorId] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [receipt, setReceipt] = useState<any | null>(null);
  const [annual, setAnnual] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const donor = donors.find(d => d.id === donorId);

  const genReceipt = async (giftId: string) => {
    setBusy(true);
    const r = await lensRun('nonprofit', 'receipt-generate', { donorId, giftId });
    if (r.data?.ok) { setReceipt(r.data.result?.receipt); setAnnual(null); await reloadDonors(); }
    setBusy(false);
  };
  const genAnnual = async () => {
    if (!donorId) return;
    setBusy(true);
    const r = await lensRun('nonprofit', 'receipt-annual', { donorId, year: Number(year) });
    if (r.data?.ok) { setAnnual(r.data.result?.statement); setReceipt(null); }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className={`${card} p-2.5 flex flex-wrap gap-1.5 items-center`}>
        <select value={donorId} onChange={e => { setDonorId(e.target.value); setReceipt(null); setAnnual(null); }} className={`${inp} flex-1 min-w-[140px]`}>
          <option value="">Select donor…</option>
          {donors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input value={year} onChange={e => setYear(e.target.value.replace(/\D/g, ''))} placeholder="year" className={`${inp} w-20`} />
        <button onClick={genAnnual} disabled={!donorId || busy} className={btnP}><Receipt className="w-3 h-3 inline" /> Annual statement</button>
      </div>

      {donorId && donor && (
        <div className={`${card} p-2.5`}>
          <p className="text-xs font-semibold text-zinc-200 mb-1.5">Per-gift receipts — {donor.name}</p>
          {donor.gifts.length === 0 && <p className="text-[11px] text-zinc-400 italic">No gifts logged for this donor.</p>}
          {donor.gifts.map(g => (
            <div key={g.id} className="flex items-center gap-2 py-0.5">
              <span className="text-[11px] text-zinc-400 flex-1">{money(g.amount)} · {shortDate(g.at)} · {g.fund}</span>
              {g.receiptIssued
                ? <span className="text-[10px] text-emerald-400"><CheckCircle2 className="w-3 h-3 inline" /> receipted</span>
                : <button onClick={() => genReceipt(g.id)} disabled={busy} className={btnS}>Generate receipt</button>}
            </div>
          ))}
        </div>
      )}

      {receipt && (
        <div className={`${card} p-3 text-[11px] text-zinc-300`}>
          <p className="text-xs font-bold text-zinc-100 mb-1">Tax Receipt {receipt.receiptNo}</p>
          <p>{receipt.donorName}{receipt.donorAddress ? ` · ${receipt.donorAddress}` : ''}</p>
          <p className="text-emerald-400 text-base font-bold my-1">{money(receipt.amount)}</p>
          <p className="text-zinc-400">Gift date {shortDate(receipt.giftDate)} · {receipt.fund} · {receipt.method}</p>
          <p className="text-zinc-400 mt-1 italic">{receipt.statement}</p>
        </div>
      )}
      {annual && (
        <div className={`${card} p-3 text-[11px] text-zinc-300`}>
          <p className="text-xs font-bold text-zinc-100 mb-1">{annual.year} Annual Giving Statement — {annual.donorName}</p>
          {annual.gifts.map((g: any, i: number) => (
            <p key={i} className="text-zinc-400">{shortDate(g.date)} · {money(g.amount)} · {g.fund}</p>
          ))}
          <p className="text-emerald-400 font-bold mt-1">Total deductible: {money(annual.totalDeductible)} ({annual.giftCount} gift{annual.giftCount !== 1 ? 's' : ''})</p>
          <p className="text-zinc-400 mt-1 italic">{annual.statement}</p>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Online Donation Pages
// ===========================================================================
function PagesTab() {
  const [pages, setPages] = useState<DonationPage[]>([]);
  const [form, setForm] = useState({ title: '', story: '', goal: '', accentColor: '#f43f5e' });
  const [busy, setBusy] = useState(false);
  const [giveFor, setGiveFor] = useState<string | null>(null);
  const [give, setGive] = useState({ amount: '', donor: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('nonprofit', 'donation-page-list', {});
    if (r.data?.ok) setPages((r.data.result?.pages as DonationPage[]) || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    await lensRun('nonprofit', 'donation-page-create', { title: form.title.trim(), story: form.story, goal: Number(form.goal) || 0, accentColor: form.accentColor });
    setForm({ title: '', story: '', goal: '', accentColor: '#f43f5e' });
    await refresh(); setBusy(false);
  };
  const togglePub = async (p: DonationPage) => {
    await lensRun('nonprofit', 'donation-page-update', { id: p.id, published: !p.published });
    await refresh();
  };
  const del = async (id: string) => { await lensRun('nonprofit', 'donation-page-delete', { id }); await refresh(); };
  const submitGive = async (pageId: string) => {
    if (!give.amount || Number(give.amount) <= 0) return;
    setBusy(true);
    const r = await lensRun('nonprofit', 'donation-page-give', { pageId, amount: Number(give.amount), donor: give.donor });
    if (r.data?.ok) { setGive({ amount: '', donor: '' }); setGiveFor(null); await refresh(); }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className={`${card} p-2.5 flex flex-wrap gap-1.5`}>
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Page title *" className={`${inp} flex-1 min-w-[140px]`} />
        <input value={form.goal} onChange={e => setForm({ ...form, goal: e.target.value })} placeholder="goal $" className={`${inp} w-24`} />
        <input type="color" value={form.accentColor} onChange={e => setForm({ ...form, accentColor: e.target.value })} className="h-7 w-9 bg-zinc-950 border border-zinc-800 rounded" aria-label="Accent color" />
        <input value={form.story} onChange={e => setForm({ ...form, story: e.target.value })} placeholder="story / mission" className={`${inp} w-full`} />
        <button onClick={create} disabled={!form.title.trim() || busy} className={btnP}><Plus className="w-3 h-3 inline" /> New page</button>
      </div>

      {pages.length === 0 && <p className="text-xs text-zinc-400 italic text-center py-3">No donation pages yet.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {pages.map(p => (
          <div key={p.id} className={`${card} p-3`} style={{ borderTopColor: p.accentColor, borderTopWidth: 3 }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-zinc-100 truncate">{p.title}</p>
                <p className="text-[10px] text-zinc-400 font-mono">{p.publicUrl}</p>
              </div>
              <button onClick={() => del(p.id)} className="text-rose-400" aria-label="Delete page"><Trash2 className="w-3 h-3" /></button>
            </div>
            {p.story && <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2">{p.story}</p>}
            <p className="text-sm font-bold mt-1.5" style={{ color: p.accentColor }}>{money(p.raised)}<span className="text-[10px] text-zinc-400"> raised{p.goal > 0 ? ` of ${money(p.goal)}` : ''}</span></p>
            {p.goal > 0 && (
              <div className="h-1.5 bg-zinc-800 rounded overflow-hidden mt-1">
                <div className="h-full" style={{ width: `${Math.min(100, p.progressPct)}%`, backgroundColor: p.accentColor }} />
              </div>
            )}
            <p className="text-[10px] text-zinc-400 mt-1">{p.donorCount} donor(s) · suggested {p.suggestedAmounts.map(a => `$${a}`).join(' / ')}</p>
            <div className="flex gap-1.5 mt-2">
              <button onClick={() => togglePub(p)} className={p.published ? btnS : btnP}>{p.published ? 'Unpublish' : 'Publish'}</button>
              {p.published && <button onClick={() => setGiveFor(giveFor === p.id ? null : p.id)} className={btnS}>Test donation</button>}
            </div>
            {giveFor === p.id && p.published && (
              <div className="flex gap-1 mt-1.5 items-center">
                <input value={give.amount} onChange={e => setGive({ ...give, amount: e.target.value })} placeholder="$" className={`${inp} w-20`} />
                <input value={give.donor} onChange={e => setGive({ ...give, donor: e.target.value })} placeholder="donor name" className={`${inp} flex-1`} />
                <button onClick={() => submitGive(p.id)} disabled={busy} className={btnP}>Give</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Volunteer Management
// ===========================================================================
function VolunteersTab() {
  const [vols, setVols] = useState<Volunteer[]>([]);
  const [meta, setMeta] = useState<{ totalHours: number; estValue: number } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', skills: '', availability: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [shift, setShift] = useState({ role: '', date: '', hours: '' });
  const [logHrs, setLogHrs] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun('nonprofit', 'volunteer-list', {});
    if (r.data?.ok) {
      setVols((r.data.result?.volunteers as Volunteer[]) || []);
      setMeta({ totalHours: r.data.result?.totalHours ?? 0, estValue: r.data.result?.estValue ?? 0 });
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const signup = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    await lensRun('nonprofit', 'volunteer-signup', { name: form.name.trim(), email: form.email, skills: form.skills, availability: form.availability });
    setForm({ name: '', email: '', skills: '', availability: '' });
    await refresh(); setBusy(false);
  };
  const del = async (id: string) => { await lensRun('nonprofit', 'volunteer-delete', { id }); await refresh(); };
  const schedule = async (volunteerId: string) => {
    if (!shift.role.trim()) return;
    setBusy(true);
    await lensRun('nonprofit', 'shift-schedule', { volunteerId, role: shift.role.trim(), date: shift.date, hours: Number(shift.hours) || 0 });
    setShift({ role: '', date: '', hours: '' });
    await refresh(); setBusy(false);
  };
  const logHours = async (volunteerId: string, shiftId: string) => {
    if (!logHrs || Number(logHrs) <= 0) return;
    setBusy(true);
    await lensRun('nonprofit', 'shift-log-hours', { volunteerId, shiftId, hours: Number(logHrs) });
    setLogHrs('');
    await refresh(); setBusy(false);
  };

  const hoursChart = useMemo(
    () => vols.map(v => ({ name: v.name.split(' ')[0] || v.name, hours: v.totalHours })),
    [vols],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Volunteers" value={String(vols.length)} />
        <Stat label="Total Hours" value={String(Math.round(meta?.totalHours ?? 0))} />
        <Stat label="Est. Value" value={money(meta?.estValue ?? 0)} />
      </div>

      <div className={`${card} p-2.5 flex flex-wrap gap-1.5`}>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Volunteer name *" className={`${inp} flex-1 min-w-[130px]`} />
        <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email" className={`${inp} w-40`} />
        <input value={form.skills} onChange={e => setForm({ ...form, skills: e.target.value })} placeholder="skills (comma-sep)" className={`${inp} flex-1 min-w-[120px]`} />
        <input value={form.availability} onChange={e => setForm({ ...form, availability: e.target.value })} placeholder="availability" className={`${inp} w-32`} />
        <button onClick={signup} disabled={!form.name.trim() || busy} className={btnP}><Plus className="w-3 h-3 inline" /> Sign up</button>
      </div>

      {vols.length >= 2 && (
        <div className={`${card} p-2.5`}>
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Hours by volunteer</p>
          <ChartKit kind="bar" data={hoursChart} xKey="name" series={[{ key: 'hours', label: 'Hours', color: '#f43f5e' }]} height={160} showLegend={false} />
        </div>
      )}

      {vols.length === 0 && <p className="text-xs text-zinc-400 italic text-center py-3">No volunteers yet.</p>}
      <ul className="space-y-1">
        {vols.map(v => (
          <li key={v.id} className={`${card} px-3 py-2`}>
            <div className="group flex items-center gap-2">
              <button onClick={() => setExpanded(expanded === v.id ? null : v.id)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">
                  {expanded === v.id ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />} {v.name}
                </p>
                <p className="text-[10px] text-zinc-400">{Math.round(v.totalHours)} hrs · {v.shifts.length} shift(s) · {v.availability || 'availability n/a'}</p>
              </button>
              <button onClick={() => del(v.id)} className="opacity-0 group-hover:opacity-100 text-rose-400" aria-label="Delete volunteer"><Trash2 className="w-3 h-3" /></button>
            </div>
            {expanded === v.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800 space-y-2">
                {v.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {v.skills.map(s => <span key={s} className="text-[9px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">{s}</span>)}
                  </div>
                )}
                {v.shifts.map(sh => (
                  <div key={sh.id} className="flex items-center gap-2 text-[11px]">
                    <span className="text-zinc-400 flex-1">{sh.role} · {shortDate(sh.date)} · scheduled {sh.scheduledHours}h · logged {sh.loggedHours}h · {sh.status}</span>
                    {sh.status !== 'completed' && (
                      <span className="flex items-center gap-1">
                        <input value={logHrs} onChange={e => setLogHrs(e.target.value)} placeholder="hrs" className={`${inp} w-14`} />
                        <button onClick={() => logHours(v.id, sh.id)} className={btnS}>Log</button>
                      </span>
                    )}
                  </div>
                ))}
                <div className="flex flex-wrap gap-1 items-center">
                  <input value={shift.role} onChange={e => setShift({ ...shift, role: e.target.value })} placeholder="shift role" className={`${inp} flex-1 min-w-[100px]`} />
                  <input value={shift.date} onChange={e => setShift({ ...shift, date: e.target.value })} placeholder="date" type="date" className={inp} />
                  <input value={shift.hours} onChange={e => setShift({ ...shift, hours: e.target.value })} placeholder="hrs" className={`${inp} w-16`} />
                  <button onClick={() => schedule(v.id)} className={btnS}><Plus className="w-3 h-3 inline" /> Schedule shift</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// Events & Peer-to-Peer
// ===========================================================================
function EventsTab() {
  const [events, setEvents] = useState<NPEvent[]>([]);
  const [form, setForm] = useState({ name: '', date: '', goal: '', ticketPrice: '', type: 'fundraiser' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [team, setTeam] = useState({ captain: '', teamName: '', personalGoal: '' });
  const [p2pGive, setP2pGive] = useState({ teamId: '', amount: '', donor: '' });
  const [board, setBoard] = useState<Record<string, { rank: number; teamName: string; captain: string; raised: number; progressPct: number; donorCount: number }[]>>({});
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun('nonprofit', 'event-list', {});
    if (r.data?.ok) setEvents((r.data.result?.events as NPEvent[]) || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    await lensRun('nonprofit', 'event-create', { name: form.name.trim(), date: form.date, goal: Number(form.goal) || 0, ticketPrice: Number(form.ticketPrice) || 0, type: form.type });
    setForm({ name: '', date: '', goal: '', ticketPrice: '', type: 'fundraiser' });
    await refresh(); setBusy(false);
  };
  const del = async (id: string) => { await lensRun('nonprofit', 'event-delete', { id }); await refresh(); };
  const addTeam = async (eventId: string) => {
    if (!team.captain.trim()) return;
    setBusy(true);
    await lensRun('nonprofit', 'p2p-team-create', { eventId, captain: team.captain.trim(), teamName: team.teamName, personalGoal: Number(team.personalGoal) || 0 });
    setTeam({ captain: '', teamName: '', personalGoal: '' });
    await refresh(); setBusy(false);
  };
  const donate = async (eventId: string) => {
    if (!p2pGive.teamId || !p2pGive.amount || Number(p2pGive.amount) <= 0) return;
    setBusy(true);
    await lensRun('nonprofit', 'p2p-donate', { eventId, teamId: p2pGive.teamId, amount: Number(p2pGive.amount), donor: p2pGive.donor });
    setP2pGive({ teamId: '', amount: '', donor: '' });
    await refresh(); setBusy(false);
  };
  const loadBoard = async (eventId: string) => {
    const r = await lensRun('nonprofit', 'p2p-leaderboard', { eventId });
    if (r.data?.ok) setBoard(prev => ({ ...prev, [eventId]: r.data.result?.leaderboard || [] }));
  };

  return (
    <div className="space-y-3">
      <div className={`${card} p-2.5 flex flex-wrap gap-1.5`}>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Event name *" className={`${inp} flex-1 min-w-[130px]`} />
        <input value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} placeholder="date" type="date" className={inp} />
        <input value={form.goal} onChange={e => setForm({ ...form, goal: e.target.value })} placeholder="goal $" className={`${inp} w-24`} />
        <input value={form.ticketPrice} onChange={e => setForm({ ...form, ticketPrice: e.target.value })} placeholder="ticket $" className={`${inp} w-24`} />
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={inp}>
          {['fundraiser', 'gala', 'walkathon', 'auction', 'virtual'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={create} disabled={!form.name.trim() || busy} className={btnP}><Plus className="w-3 h-3 inline" /> New event</button>
      </div>

      {events.length === 0 && <p className="text-xs text-zinc-400 italic text-center py-3">No fundraising events yet.</p>}
      <ul className="space-y-1">
        {events.map(ev => (
          <li key={ev.id} className={`${card} px-3 py-2`}>
            <div className="group flex items-center gap-2">
              <button onClick={() => setExpanded(expanded === ev.id ? null : ev.id)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">
                  {expanded === ev.id ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />} {ev.name}
                  <span className="text-zinc-400 font-normal"> · {ev.type}</span>
                </p>
                <p className="text-[10px] text-zinc-400">{money(ev.raised)} raised · {ev.progressPct}% of goal · {ev.teamCount} team(s) · {ev.donorCount} donor(s)</p>
                {ev.goal > 0 && (
                  <div className="h-1 bg-zinc-800 rounded overflow-hidden mt-1">
                    <div className="h-full bg-rose-500" style={{ width: `${Math.min(100, ev.progressPct)}%` }} />
                  </div>
                )}
              </button>
              <button onClick={() => del(ev.id)} className="opacity-0 group-hover:opacity-100 text-rose-400" aria-label="Delete event"><Trash2 className="w-3 h-3" /></button>
            </div>
            {expanded === ev.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800 space-y-2">
                {/* teams */}
                {ev.teams.map(t => (
                  <p key={t.id} className="text-[11px] text-zinc-400">
                    <Trophy className="w-3 h-3 inline text-amber-400" /> {t.teamName} ({t.captain}) — <span className="text-emerald-400">{money(t.raised)}</span> of {money(t.personalGoal)} · {t.donations.length} donor(s)
                  </p>
                ))}
                {/* create team */}
                <div className="flex flex-wrap gap-1 items-center">
                  <input value={team.captain} onChange={e => setTeam({ ...team, captain: e.target.value })} placeholder="captain *" className={`${inp} w-28`} />
                  <input value={team.teamName} onChange={e => setTeam({ ...team, teamName: e.target.value })} placeholder="team name" className={`${inp} flex-1 min-w-[100px]`} />
                  <input value={team.personalGoal} onChange={e => setTeam({ ...team, personalGoal: e.target.value })} placeholder="goal $" className={`${inp} w-20`} />
                  <button onClick={() => addTeam(ev.id)} className={btnS}><Plus className="w-3 h-3 inline" /> Add team</button>
                </div>
                {/* donate to a team */}
                {ev.teams.length > 0 && (
                  <div className="flex flex-wrap gap-1 items-center">
                    <select value={p2pGive.teamId} onChange={e => setP2pGive({ ...p2pGive, teamId: e.target.value })} className={`${inp} flex-1 min-w-[120px]`}>
                      <option value="">Pick team…</option>
                      {ev.teams.map(t => <option key={t.id} value={t.id}>{t.teamName}</option>)}
                    </select>
                    <input value={p2pGive.amount} onChange={e => setP2pGive({ ...p2pGive, amount: e.target.value })} placeholder="$" className={`${inp} w-20`} />
                    <input value={p2pGive.donor} onChange={e => setP2pGive({ ...p2pGive, donor: e.target.value })} placeholder="donor" className={`${inp} w-24`} />
                    <button onClick={() => donate(ev.id)} className={btnP}>Donate</button>
                  </div>
                )}
                {/* leaderboard */}
                <div>
                  <button onClick={() => loadBoard(ev.id)} className={btnS}><Trophy className="w-3 h-3 inline" /> Leaderboard</button>
                  {board[ev.id] && board[ev.id].length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {board[ev.id].map(t => (
                        <p key={t.rank} className="text-[11px] text-zinc-400">
                          <span className="text-amber-400 font-bold">#{t.rank}</span> {t.teamName} ({t.captain}) — <span className="text-emerald-400">{money(t.raised)}</span> · {t.progressPct}%
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
      <p className="text-sm font-bold text-zinc-100">{value}</p>
      <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
