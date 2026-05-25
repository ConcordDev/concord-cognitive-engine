/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

/**
 * FieldServiceConsole — the ServiceTitan/Jobber-shaped operations surface
 * for the plumbing lens. Every value rendered comes from a real
 * server/domains/plumbing.js macro: dispatch board, price book,
 * quote-to-invoice flow, technician mobile workflow, maintenance plans,
 * customer notifications, and parts-inventory deduction.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import {
  Calendar, Users, BookOpen, Receipt, ClipboardCheck, RefreshCw,
  Bell, Boxes, Plus, Trash2, Loader2, Check, AlertTriangle, Send,
} from 'lucide-react';

type Section =
  | 'dispatch' | 'pricebook' | 'invoicing' | 'workflow'
  | 'plans' | 'notify' | 'inventory';

interface Tech { id: string; name: string; skills: string[]; phone: string; baseColor: string; active: boolean; openJobs?: number; }
interface Assignment {
  id: string; jobTitle: string; client: string; address: string;
  techId: string | null; date: string; startHour: number; durationHours: number;
  priority: string; status: string; partsUsed?: { name: string; deducted: number }[];
}
interface Lane { techId: string; techName: string; baseColor: string; assignments: Assignment[]; loadHours: number; }
interface PriceItem { id: string; name: string; kind: string; unit: string; cost: number; markupPct: number; price: number; sku: string; }
interface InvoiceLine { priceItemId: string | null; name: string; quantity: number; unitPrice: number; total: number; }
interface Invoice {
  id: string; number: string; client: string; lines: InvoiceLine[];
  subtotal: number; taxPct: number; tax: number; total: number;
  status: string; amountPaid: number; dueDate: string;
  payments: { id: string; amount: number; method: string; at: string }[];
}
interface ChecklistItem { label: string; done: boolean; }
interface Workflow {
  id: string; assignmentId: string; checklist: ChecklistItem[];
  photos: { id: string; caption: string; at: string }[];
  signature: string | null; signedBy: string | null;
  startedAt: string; completedAt: string | null;
}
interface ServicePlan {
  id: string; client: string; title: string; cadence: string; fee: number;
  startDate: string; nextVisit: string; visitsCompleted: number; active: boolean;
}
interface Notice { id: string; client: string; kind: string; channel: string; message: string; status: string; sentAt: string; }
interface PartStock { id: string; name: string; sku: string; onHand: number; reorderAt: number; unitCost: number; }
interface OpsSummary {
  jobsToday: number; openJobs: number; unassigned: number;
  outstandingAR: number; collected: number; activePlans: number;
  recurringRevenue: number; lowStockParts: number;
}

const PRIORITY_COLOR: Record<string, string> = {
  low: 'text-zinc-400', normal: 'text-sky-300', high: 'text-amber-300', emergency: 'text-rose-400',
};
const STATUS_COLOR: Record<string, string> = {
  scheduled: 'bg-sky-500/20 text-sky-300', en_route: 'bg-indigo-500/20 text-indigo-300',
  on_site: 'bg-cyan-500/20 text-cyan-300', completed: 'bg-emerald-500/20 text-emerald-300',
  cancelled: 'bg-zinc-700/40 text-zinc-400',
};

const SECTIONS: { id: Section; label: string; icon: typeof Calendar }[] = [
  { id: 'dispatch', label: 'Dispatch', icon: Calendar },
  { id: 'pricebook', label: 'Price Book', icon: BookOpen },
  { id: 'invoicing', label: 'Quote → Invoice', icon: Receipt },
  { id: 'workflow', label: 'Tech Workflow', icon: ClipboardCheck },
  { id: 'plans', label: 'Service Plans', icon: RefreshCw },
  { id: 'notify', label: 'Notifications', icon: Bell },
  { id: 'inventory', label: 'Parts Inventory', icon: Boxes },
];

const inputCls = 'rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-400';
const btnCls = 'inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40';
const cardCls = 'rounded-lg border border-zinc-800 bg-zinc-950/60 p-3';

async function run<T = any>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const { data } = await lensRun<T>('plumbing', action, input);
  return data.ok ? data.result : null;
}

export function FieldServiceConsole() {
  const [section, setSection] = useState<Section>('dispatch');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [ops, setOps] = useState<OpsSummary | null>(null);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [unassigned, setUnassigned] = useState<Assignment[]>([]);
  const [emergencyCount, setEmergencyCount] = useState(0);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [avgMargin, setAvgMargin] = useState(0);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [arOutstanding, setArOutstanding] = useState(0);
  const [arCollected, setArCollected] = useState(0);
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [planRevenue, setPlanRevenue] = useState(0);
  const [planDueSoon, setPlanDueSoon] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [noticeKinds, setNoticeKinds] = useState<Record<string, number>>({});
  const [parts, setParts] = useState<PartStock[]>([]);
  const [lowStock, setLowStock] = useState<string[]>([]);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [activeWf, setActiveWf] = useState<Workflow | null>(null);
  const [wfProgress, setWfProgress] = useState(0);

  // ── form state ─────────────────────────────────────────────────
  const [techName, setTechName] = useState('');
  const [techSkills, setTechSkills] = useState('');
  const [techPhone, setTechPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobClient, setJobClient] = useState('');
  const [jobAddr, setJobAddr] = useState('');
  const [jobTech, setJobTech] = useState('');
  const [jobDate, setJobDate] = useState(new Date().toISOString().slice(0, 10));
  const [jobHour, setJobHour] = useState('8');
  const [jobDur, setJobDur] = useState('2');
  const [jobPriority, setJobPriority] = useState('normal');
  const [boardDate, setBoardDate] = useState('');

  const [piName, setPiName] = useState('');
  const [piKind, setPiKind] = useState('part');
  const [piCost, setPiCost] = useState('');
  const [piMarkup, setPiMarkup] = useState('50');
  const [piSku, setPiSku] = useState('');

  const [invClient, setInvClient] = useState('');
  const [invTax, setInvTax] = useState('0');
  const [invDue, setInvDue] = useState('');
  const [invLines, setInvLines] = useState<{ name: string; quantity: string; unitPrice: string; priceItemId: string | null }[]>([
    { name: '', quantity: '1', unitPrice: '', priceItemId: null },
  ]);

  const [wfAssignment, setWfAssignment] = useState('');
  const [wfPhotoCaption, setWfPhotoCaption] = useState('');
  const [wfSignedBy, setWfSignedBy] = useState('');

  const [planClient, setPlanClient] = useState('');
  const [planTitle, setPlanTitle] = useState('');
  const [planCadence, setPlanCadence] = useState('annual');
  const [planFee, setPlanFee] = useState('');
  const [planStart, setPlanStart] = useState(new Date().toISOString().slice(0, 10));

  const [ntfClient, setNtfClient] = useState('');
  const [ntfKind, setNtfKind] = useState('confirmation');
  const [ntfChannel, setNtfChannel] = useState('sms');
  const [ntfWhen, setNtfWhen] = useState('');
  const [ntfMessage, setNtfMessage] = useState('');

  const [partName, setPartName] = useState('');
  const [partSku, setPartSku] = useState('');
  const [partQty, setPartQty] = useState('');
  const [partReorder, setPartReorder] = useState('5');
  const [partCost, setPartCost] = useState('');

  const guarded = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  const refreshOps = useCallback(async () => {
    const s = await run<OpsSummary>('opsSummary');
    if (s) setOps(s);
  }, []);

  const refreshDispatch = useCallback(async () => {
    const t = await run<{ techs: Tech[] }>('techList');
    if (t) setTechs(t.techs);
    const b = await run<{ lanes: Lane[]; unassigned: Assignment[]; emergencyCount: number }>(
      'dispatchBoard', boardDate ? { date: boardDate } : {},
    );
    if (b) { setLanes(b.lanes); setUnassigned(b.unassigned); setEmergencyCount(b.emergencyCount); }
  }, [boardDate]);

  const refreshPriceBook = useCallback(async () => {
    const r = await run<{ items: PriceItem[]; avgMarginPct: number }>('priceBookList');
    if (r) { setPriceItems(r.items); setAvgMargin(r.avgMarginPct); }
  }, []);

  const refreshInvoices = useCallback(async () => {
    const r = await run<{ invoices: Invoice[]; outstanding: number; collected: number }>('invoiceList');
    if (r) { setInvoices(r.invoices); setArOutstanding(r.outstanding); setArCollected(r.collected); }
  }, []);

  const refreshPlans = useCallback(async () => {
    const r = await run<{ plans: ServicePlan[]; recurringRevenue: number; dueSoon: number }>('planList');
    if (r) { setPlans(r.plans); setPlanRevenue(r.recurringRevenue); setPlanDueSoon(r.dueSoon); }
  }, []);

  const refreshNotices = useCallback(async () => {
    const r = await run<{ notices: Notice[]; byKind: Record<string, number> }>('notifyLog');
    if (r) { setNotices(r.notices); setNoticeKinds(r.byKind); }
  }, []);

  const refreshParts = useCallback(async () => {
    const r = await run<{ parts: PartStock[]; lowStock: string[]; inventoryValue: number }>('partList');
    if (r) { setParts(r.parts); setLowStock(r.lowStock); setInventoryValue(r.inventoryValue); }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshOps(), refreshDispatch(), refreshPriceBook(),
      refreshInvoices(), refreshPlans(), refreshNotices(), refreshParts(),
    ]);
  }, [refreshOps, refreshDispatch, refreshPriceBook, refreshInvoices, refreshPlans, refreshNotices, refreshParts]);

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshDispatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardDate]);

  // ── handlers ───────────────────────────────────────────────────
  const addTech = () => guarded(async () => {
    if (!techName.trim()) { setErr('Technician name required'); return; }
    const r = await run('techAdd', {
      name: techName,
      skills: techSkills.split(',').map((s) => s.trim()).filter(Boolean),
      phone: techPhone,
    });
    if (!r) { setErr('techAdd failed'); return; }
    setTechName(''); setTechSkills(''); setTechPhone('');
    await refreshDispatch();
  });

  const removeTech = (id: string) => guarded(async () => {
    await run('techRemove', { techId: id });
    await refreshDispatch();
  });

  const assignJob = () => guarded(async () => {
    if (!jobTitle.trim()) { setErr('Job title required'); return; }
    const r = await run('dispatchAssign', {
      jobTitle, client: jobClient, address: jobAddr,
      techId: jobTech || undefined, date: jobDate,
      startHour: Number(jobHour), durationHours: Number(jobDur), priority: jobPriority,
    });
    if (!r) { setErr('dispatchAssign failed'); return; }
    setJobTitle(''); setJobClient(''); setJobAddr('');
    await Promise.all([refreshDispatch(), refreshOps()]);
  });

  const updateAssignment = (id: string, patch: Record<string, unknown>) => guarded(async () => {
    await run('dispatchUpdate', { assignmentId: id, ...patch });
    await Promise.all([refreshDispatch(), refreshOps()]);
  });

  const addPriceItem = () => guarded(async () => {
    if (!piName.trim()) { setErr('Item name required'); return; }
    const r = await run('priceItemAdd', {
      name: piName, kind: piKind, cost: Number(piCost) || 0,
      markupPct: Number(piMarkup) || 0, sku: piSku,
    });
    if (!r) { setErr('priceItemAdd failed'); return; }
    setPiName(''); setPiCost(''); setPiSku('');
    await refreshPriceBook();
  });

  const removePriceItem = (id: string) => guarded(async () => {
    await run('priceItemRemove', { itemId: id });
    await refreshPriceBook();
  });

  const updateMarkup = (id: string, markupPct: number) => guarded(async () => {
    await run('priceItemUpdate', { itemId: id, markupPct });
    await refreshPriceBook();
  });

  const setLine = (idx: number, patch: Partial<{ name: string; quantity: string; unitPrice: string; priceItemId: string | null }>) => {
    setInvLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const pickPriceItem = (idx: number, itemId: string) => {
    const pi = priceItems.find((p) => p.id === itemId);
    if (pi) setLine(idx, { name: pi.name, unitPrice: String(pi.price), priceItemId: pi.id });
    else setLine(idx, { priceItemId: null });
  };
  const addLine = () => setInvLines((ls) => [...ls, { name: '', quantity: '1', unitPrice: '', priceItemId: null }]);
  const removeLine = (idx: number) => setInvLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls));

  const createInvoice = () => guarded(async () => {
    const lines = invLines
      .filter((l) => l.name.trim())
      .map((l) => ({ name: l.name, quantity: Number(l.quantity) || 1, unitPrice: Number(l.unitPrice) || 0, priceItemId: l.priceItemId }));
    if (lines.length === 0) { setErr('Add at least one line item'); return; }
    const r = await run('invoiceFromQuote', { client: invClient, taxPct: Number(invTax) || 0, dueDate: invDue, lines });
    if (!r) { setErr('invoiceFromQuote failed'); return; }
    setInvClient(''); setInvDue(''); setInvLines([{ name: '', quantity: '1', unitPrice: '', priceItemId: null }]);
    await Promise.all([refreshInvoices(), refreshOps()]);
  });

  const recordPayment = (id: string, balance: number) => guarded(async () => {
    const amtStr = window.prompt('Payment amount', String(balance));
    if (amtStr == null) return;
    const amount = Number(amtStr);
    if (!(amount > 0)) { setErr('Invalid amount'); return; }
    await run('invoiceRecordPayment', { invoiceId: id, amount, method: 'card' });
    await Promise.all([refreshInvoices(), refreshOps()]);
  });

  const startWorkflow = () => guarded(async () => {
    if (!wfAssignment) { setErr('Select an assignment'); return; }
    const r = await run<{ workflow: Workflow }>('workflowStart', { assignmentId: wfAssignment });
    if (!r) { setErr('workflowStart failed'); return; }
    setActiveWf(r.workflow);
    setWfProgress(0);
  });

  const loadWorkflow = (assignmentId: string) => guarded(async () => {
    setWfAssignment(assignmentId);
    const r = await run<{ workflow: Workflow; progress: number }>('workflowGet', { assignmentId });
    if (r) { setActiveWf(r.workflow); setWfProgress(r.progress); }
    else { setActiveWf(null); setWfProgress(0); }
  });

  const toggleCheck = (idx: number, done: boolean) => guarded(async () => {
    if (!activeWf) return;
    await run('workflowUpdate', { assignmentId: activeWf.assignmentId, checkIndex: idx, done });
    const r = await run<{ workflow: Workflow; progress: number }>('workflowGet', { assignmentId: activeWf.assignmentId });
    if (r) { setActiveWf(r.workflow); setWfProgress(r.progress); }
  });

  const addPhoto = () => guarded(async () => {
    if (!activeWf || !wfPhotoCaption.trim()) { setErr('Photo caption required'); return; }
    await run('workflowUpdate', { assignmentId: activeWf.assignmentId, photoCaption: wfPhotoCaption });
    setWfPhotoCaption('');
    const r = await run<{ workflow: Workflow; progress: number }>('workflowGet', { assignmentId: activeWf.assignmentId });
    if (r) { setActiveWf(r.workflow); setWfProgress(r.progress); }
  });

  const captureSignature = () => guarded(async () => {
    if (!activeWf) return;
    const stamp = `signed:${Date.now()}`;
    await run('workflowUpdate', { assignmentId: activeWf.assignmentId, signature: stamp, signedBy: wfSignedBy || 'Customer' });
    const r = await run<{ workflow: Workflow; progress: number }>('workflowGet', { assignmentId: activeWf.assignmentId });
    if (r) { setActiveWf(r.workflow); setWfProgress(r.progress); }
  });

  const createPlan = () => guarded(async () => {
    if (!planClient.trim()) { setErr('Client required'); return; }
    const r = await run('planCreate', {
      client: planClient, title: planTitle, cadence: planCadence,
      fee: Number(planFee) || 0, startDate: planStart,
    });
    if (!r) { setErr('planCreate failed'); return; }
    setPlanClient(''); setPlanTitle(''); setPlanFee('');
    await Promise.all([refreshPlans(), refreshOps()]);
  });

  const logVisit = (id: string) => guarded(async () => {
    await run('planLogVisit', { planId: id });
    await refreshPlans();
  });

  const sendNotice = () => guarded(async () => {
    if (!ntfClient.trim()) { setErr('Client required'); return; }
    const r = await run('notifySend', {
      client: ntfClient, kind: ntfKind, channel: ntfChannel,
      when: ntfWhen, message: ntfMessage,
    });
    if (!r) { setErr('notifySend failed'); return; }
    setNtfMessage(''); setNtfWhen('');
    await refreshNotices();
  });

  const addPart = () => guarded(async () => {
    if (!partName.trim()) { setErr('Part name required'); return; }
    const r = await run('partStock', {
      name: partName, sku: partSku, quantity: Number(partQty) || 0,
      reorderAt: Number(partReorder) || 0, unitCost: Number(partCost) || 0,
    });
    if (!r) { setErr('partStock failed'); return; }
    setPartName(''); setPartSku(''); setPartQty(''); setPartCost('');
    await Promise.all([refreshParts(), refreshOps()]);
  });

  const completeJob = (assignmentId: string) => guarded(async () => {
    const sel = window.prompt('Parts used — comma-separated "name x qty" (blank for none)', '');
    if (sel == null) return;
    const partsUsed = sel.split(',').map((tok) => {
      const m = tok.trim().match(/^(.+?)\s*x\s*(\d+)$/i);
      if (m) return { name: m[1].trim(), quantity: Number(m[2]) };
      const name = tok.trim();
      return name ? { name, quantity: 1 } : null;
    }).filter(Boolean);
    await run('jobComplete', { assignmentId, partsUsed });
    await Promise.all([refreshDispatch(), refreshParts(), refreshOps()]);
  });

  // ── derived ────────────────────────────────────────────────────
  const allAssignments = useMemo(
    () => [...lanes.flatMap((l) => l.assignments), ...unassigned],
    [lanes, unassigned],
  );
  const loadChart = useMemo(
    () => lanes.map((l) => ({ tech: l.techName, hours: l.loadHours, jobs: l.assignments.length })),
    [lanes],
  );
  const planTimeline: TimelineEvent[] = useMemo(
    () => plans.filter((p) => p.active).map((p) => ({
      id: p.id,
      label: `${p.client} · ${p.title}`,
      time: p.nextVisit,
      tone: p.nextVisit <= new Date().toISOString().slice(0, 10) ? 'warn' : 'info',
      detail: `${p.cadence} · $${p.fee} · ${p.visitsCompleted} visits done`,
    })),
    [plans],
  );

  return (
    <div className="space-y-4">
      {/* ops summary strip */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Jobs Today" value={ops?.jobsToday ?? 0} />
        <Stat label="Open Jobs" value={ops?.openJobs ?? 0} />
        <Stat label="Unassigned" value={ops?.unassigned ?? 0} tone={ops && ops.unassigned > 0 ? 'warn' : undefined} />
        <Stat label="Outstanding AR" value={`$${(ops?.outstandingAR ?? 0).toLocaleString()}`} />
        <Stat label="Collected" value={`$${(ops?.collected ?? 0).toLocaleString()}`} />
        <Stat label="Active Plans" value={ops?.activePlans ?? 0} />
        <Stat label="Recurring Rev" value={`$${(ops?.recurringRevenue ?? 0).toLocaleString()}`} />
        <Stat label="Low Stock" value={ops?.lowStockParts ?? 0} tone={ops && ops.lowStockParts > 0 ? 'bad' : undefined} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium ${
                section === s.id ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              <s.icon className="h-3.5 w-3.5" />{s.label}
            </button>
          ))}
        </nav>
        <button onClick={() => guarded(refreshAll)} className="inline-flex items-center gap-1 rounded border border-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:text-white">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </button>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="h-4 w-4" /> {err}
        </div>
      )}

      {/* ── DISPATCH ─────────────────────────────────────────── */}
      {section === 'dispatch' && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className={cardCls}>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white"><Users className="h-3.5 w-3.5 text-blue-400" /> Add Technician</h4>
              <div className="space-y-2">
                <input className={`${inputCls} w-full`} placeholder="Name" value={techName} onChange={(e) => setTechName(e.target.value)} />
                <input className={`${inputCls} w-full`} placeholder="Skills (comma-separated)" value={techSkills} onChange={(e) => setTechSkills(e.target.value)} />
                <input className={`${inputCls} w-full`} placeholder="Phone" value={techPhone} onChange={(e) => setTechPhone(e.target.value)} />
                <button className={btnCls} onClick={addTech} disabled={busy}><Plus className="h-3.5 w-3.5" /> Add Tech</button>
              </div>
              <div className="mt-3 space-y-1.5">
                {techs.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1.5 text-xs">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.baseColor }} />
                      <span className="text-white">{t.name}</span>
                      <span className="text-zinc-400">{t.openJobs ?? 0} open</span>
                    </span>
                    <button onClick={() => removeTech(t.id)} aria-label="Remove technician" className="text-zinc-600 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                {techs.length === 0 && <p className="text-xs text-zinc-400">No technicians yet.</p>}
              </div>
            </div>

            <div className={cardCls}>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white"><Calendar className="h-3.5 w-3.5 text-blue-400" /> Schedule a Job</h4>
              <div className="grid grid-cols-2 gap-2">
                <input className={`${inputCls} col-span-2`} placeholder="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                <input className={inputCls} placeholder="Client" value={jobClient} onChange={(e) => setJobClient(e.target.value)} />
                <input className={inputCls} placeholder="Address" value={jobAddr} onChange={(e) => setJobAddr(e.target.value)} />
                <select className={inputCls} value={jobTech} onChange={(e) => setJobTech(e.target.value)}>
                  <option value="">Unassigned</option>
                  {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select className={inputCls} value={jobPriority} onChange={(e) => setJobPriority(e.target.value)}>
                  {['low', 'normal', 'high', 'emergency'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input type="date" className={inputCls} value={jobDate} onChange={(e) => setJobDate(e.target.value)} />
                <div className="flex gap-1">
                  <input type="number" className={`${inputCls} w-1/2`} placeholder="Hr" value={jobHour} onChange={(e) => setJobHour(e.target.value)} />
                  <input type="number" step="0.5" className={`${inputCls} w-1/2`} placeholder="Dur" value={jobDur} onChange={(e) => setJobDur(e.target.value)} />
                </div>
              </div>
              <button className={`${btnCls} mt-2`} onClick={assignJob} disabled={busy}><Plus className="h-3.5 w-3.5" /> Schedule</button>
            </div>
          </div>

          <div className={cardCls}>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white">Dispatch Board {emergencyCount > 0 && <span className="ml-2 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300">{emergencyCount} emergency</span>}</h4>
              <input type="date" className={inputCls} value={boardDate} onChange={(e) => setBoardDate(e.target.value)} title="Filter by date" />
            </div>
            {loadChart.length > 0 && (
              <div className="mb-3">
                <ChartKit kind="bar" data={loadChart} xKey="tech" series={[{ key: 'hours', label: 'Load (hrs)', color: '#3b82f6' }, { key: 'jobs', label: 'Jobs', color: '#22c55e' }]} height={180} />
              </div>
            )}
            <div className="space-y-3">
              {lanes.map((lane) => (
                <div key={lane.techId} className="rounded border border-zinc-800">
                  <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1.5 text-xs">
                    <span className="flex items-center gap-2 font-medium text-white">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: lane.baseColor }} />{lane.techName}
                    </span>
                    <span className="text-zinc-400">{lane.loadHours}h scheduled</span>
                  </div>
                  <div className="divide-y divide-zinc-900">
                    {lane.assignments.map((a) => <AssignmentRow key={a.id} a={a} onUpdate={updateAssignment} onComplete={completeJob} />)}
                    {lane.assignments.length === 0 && <p className="px-2 py-1.5 text-[11px] text-zinc-400">No jobs.</p>}
                  </div>
                </div>
              ))}
              {unassigned.length > 0 && (
                <div className="rounded border border-amber-500/30">
                  <div className="border-b border-amber-500/20 px-2 py-1.5 text-xs font-medium text-amber-300">Unassigned ({unassigned.length})</div>
                  <div className="divide-y divide-zinc-900">
                    {unassigned.map((a) => <AssignmentRow key={a.id} a={a} techs={techs} onUpdate={updateAssignment} onComplete={completeJob} />)}
                  </div>
                </div>
              )}
              {lanes.length === 0 && unassigned.length === 0 && <p className="text-xs text-zinc-400">No scheduled jobs.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── PRICE BOOK ───────────────────────────────────────── */}
      {section === 'pricebook' && (
        <div className="space-y-4">
          <div className={cardCls}>
            <h4 className="mb-2 text-xs font-semibold text-white">Add Price Book Item · avg margin {avgMargin}%</h4>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <input className={inputCls} placeholder="Name" value={piName} onChange={(e) => setPiName(e.target.value)} />
              <select className={inputCls} value={piKind} onChange={(e) => setPiKind(e.target.value)}>
                <option value="part">part</option><option value="labor">labor</option>
              </select>
              <input type="number" className={inputCls} placeholder="Cost" value={piCost} onChange={(e) => setPiCost(e.target.value)} />
              <input type="number" className={inputCls} placeholder="Markup %" value={piMarkup} onChange={(e) => setPiMarkup(e.target.value)} />
              <input className={inputCls} placeholder="SKU" value={piSku} onChange={(e) => setPiSku(e.target.value)} />
            </div>
            <button className={`${btnCls} mt-2`} onClick={addPriceItem} disabled={busy}><Plus className="h-3.5 w-3.5" /> Add Item</button>
          </div>
          <div className={cardCls}>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-zinc-400"><th className="py-1">Item</th><th>Kind</th><th>Cost</th><th>Markup</th><th>Price</th><th /></tr></thead>
              <tbody>
                {priceItems.map((i) => (
                  <tr key={i.id} className="border-t border-zinc-900 text-white">
                    <td className="py-1.5">{i.name} <span className="text-zinc-600">{i.sku}</span></td>
                    <td className="text-zinc-400">{i.kind}/{i.unit}</td>
                    <td>${i.cost.toFixed(2)}</td>
                    <td>
                      <input type="number" className={`${inputCls} w-16`} defaultValue={i.markupPct}
                        onBlur={(e) => { const v = Number(e.target.value); if (v !== i.markupPct) updateMarkup(i.id, v); }} />
                    </td>
                    <td className="font-medium text-emerald-300">${i.price.toFixed(2)}</td>
                    <td><button onClick={() => removePriceItem(i.id)} aria-label="Remove item" className="text-zinc-600 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {priceItems.length === 0 && <p className="text-xs text-zinc-400">No price book items yet.</p>}
          </div>
        </div>
      )}

      {/* ── INVOICING ────────────────────────────────────────── */}
      {section === 'invoicing' && (
        <div className="space-y-4">
          <div className={cardCls}>
            <h4 className="mb-2 text-xs font-semibold text-white">Build Quote → Invoice</h4>
            <div className="mb-2 grid grid-cols-3 gap-2">
              <input className={inputCls} placeholder="Client" value={invClient} onChange={(e) => setInvClient(e.target.value)} />
              <input type="number" className={inputCls} placeholder="Tax %" value={invTax} onChange={(e) => setInvTax(e.target.value)} />
              <input type="date" className={inputCls} value={invDue} onChange={(e) => setInvDue(e.target.value)} title="Due date" />
            </div>
            <div className="space-y-1.5">
              {invLines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5">
                  <select className={`${inputCls} col-span-3`} value={l.priceItemId ?? ''} onChange={(e) => pickPriceItem(idx, e.target.value)}>
                    <option value="">— free text —</option>
                    {priceItems.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input className={`${inputCls} col-span-4`} placeholder="Description" value={l.name} onChange={(e) => setLine(idx, { name: e.target.value })} />
                  <input type="number" className={`${inputCls} col-span-2`} placeholder="Qty" value={l.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} />
                  <input type="number" className={`${inputCls} col-span-2`} placeholder="Unit $" value={l.unitPrice} onChange={(e) => setLine(idx, { unitPrice: e.target.value })} />
                  <button onClick={() => removeLine(idx)} aria-label="Remove line" className="col-span-1 text-zinc-600 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button onClick={addLine} className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:text-white">+ Line</button>
              <button className={btnCls} onClick={createInvoice} disabled={busy}><Receipt className="h-3.5 w-3.5" /> Create Invoice</button>
            </div>
          </div>
          <div className={cardCls}>
            <h4 className="mb-2 text-xs font-semibold text-white">Invoices · ${arOutstanding.toLocaleString()} outstanding · ${arCollected.toLocaleString()} collected</h4>
            <div className="space-y-2">
              {invoices.map((inv) => {
                const balance = Math.round((inv.total - inv.amountPaid) * 100) / 100;
                return (
                  <div key={inv.id} className="rounded border border-zinc-800 p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">{inv.number} · {inv.client || 'No client'}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${inv.status === 'paid' ? 'bg-emerald-500/20 text-emerald-300' : inv.status === 'partial' ? 'bg-amber-500/20 text-amber-300' : 'bg-sky-500/20 text-sky-300'}`}>{inv.status}</span>
                    </div>
                    <div className="mt-1 text-zinc-400">{inv.lines.length} lines · subtotal ${inv.subtotal} · tax ${inv.tax} · <span className="text-white">total ${inv.total}</span></div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-zinc-400">Paid ${inv.amountPaid} · Balance <span className="text-amber-300">${balance}</span></span>
                      {balance > 0 && <button onClick={() => recordPayment(inv.id, balance)} className={btnCls}><Check className="h-3.5 w-3.5" /> Record Payment</button>}
                    </div>
                  </div>
                );
              })}
              {invoices.length === 0 && <p className="text-xs text-zinc-400">No invoices yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── WORKFLOW ─────────────────────────────────────────── */}
      {section === 'workflow' && (
        <div className="space-y-4">
          <div className={cardCls}>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white"><ClipboardCheck className="h-3.5 w-3.5 text-blue-400" /> On-Site Technician Workflow</h4>
            <div className="flex flex-wrap items-center gap-2">
              <select className={inputCls} value={wfAssignment} onChange={(e) => loadWorkflow(e.target.value)}>
                <option value="">Select assignment…</option>
                {allAssignments.map((a) => <option key={a.id} value={a.id}>{a.jobTitle} · {a.client || 'no client'}</option>)}
              </select>
              <button className={btnCls} onClick={startWorkflow} disabled={busy || !wfAssignment}>Start Workflow</button>
            </div>
          </div>
          {activeWf && (
            <div className={cardCls}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Checklist · {wfProgress}% complete</span>
                {activeWf.completedAt && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">Completed</span>}
              </div>
              <div className="h-1.5 w-full rounded bg-zinc-800"><div className="h-full rounded bg-blue-500" style={{ width: `${wfProgress}%` }} /></div>
              <div className="mt-2 space-y-1">
                {activeWf.checklist.map((c, idx) => (
                  <label key={idx} className="flex items-center gap-2 text-xs text-zinc-300">
                    <input type="checkbox" checked={c.done} onChange={(e) => toggleCheck(idx, e.target.checked)} />
                    <span className={c.done ? 'text-zinc-400 line-through' : ''}>{c.label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-zinc-400">Photo Capture ({activeWf.photos.length})</div>
                  <div className="flex gap-1.5">
                    <input className={`${inputCls} flex-1`} placeholder="Photo caption" value={wfPhotoCaption} onChange={(e) => setWfPhotoCaption(e.target.value)} />
                    <button className={btnCls} onClick={addPhoto} disabled={busy}>Add</button>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-[11px] text-zinc-400">
                    {activeWf.photos.map((p) => <li key={p.id}>📷 {p.caption}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-zinc-400">Customer Signature</div>
                  {activeWf.signature ? (
                    <p className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-300">Signed by {activeWf.signedBy}</p>
                  ) : (
                    <div className="flex gap-1.5">
                      <input className={`${inputCls} flex-1`} placeholder="Signed by" value={wfSignedBy} onChange={(e) => setWfSignedBy(e.target.value)} />
                      <button className={btnCls} onClick={captureSignature} disabled={busy}>Capture</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SERVICE PLANS ────────────────────────────────────── */}
      {section === 'plans' && (
        <div className="space-y-4">
          <div className={cardCls}>
            <h4 className="mb-2 text-xs font-semibold text-white">New Maintenance Plan · ${planRevenue.toLocaleString()} recurring · {planDueSoon} due soon</h4>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <input className={inputCls} placeholder="Client" value={planClient} onChange={(e) => setPlanClient(e.target.value)} />
              <input className={inputCls} placeholder="Plan title" value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} />
              <select className={inputCls} value={planCadence} onChange={(e) => setPlanCadence(e.target.value)}>
                {['weekly', 'monthly', 'quarterly', 'biannual', 'annual'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="number" className={inputCls} placeholder="Fee" value={planFee} onChange={(e) => setPlanFee(e.target.value)} />
              <input type="date" className={inputCls} value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
            </div>
            <button className={`${btnCls} mt-2`} onClick={createPlan} disabled={busy}><Plus className="h-3.5 w-3.5" /> Create Plan</button>
          </div>
          {planTimeline.length > 0 && (
            <div className={cardCls}>
              <h4 className="mb-2 text-xs font-semibold text-white">Upcoming Visits</h4>
              <TimelineView events={planTimeline} height={110} />
            </div>
          )}
          <div className={cardCls}>
            <div className="space-y-2">
              {plans.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded border border-zinc-800 p-2 text-xs">
                  <div>
                    <span className="font-medium text-white">{p.client} · {p.title}</span>
                    <div className="text-zinc-400">{p.cadence} · ${p.fee} · next {p.nextVisit} · {p.visitsCompleted} visits done</div>
                  </div>
                  <button onClick={() => logVisit(p.id)} className={btnCls}><Check className="h-3.5 w-3.5" /> Log Visit</button>
                </div>
              ))}
              {plans.length === 0 && <p className="text-xs text-zinc-400">No service plans yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICATIONS ────────────────────────────────────── */}
      {section === 'notify' && (
        <div className="space-y-4">
          <div className={cardCls}>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white"><Bell className="h-3.5 w-3.5 text-blue-400" /> Send Customer Notification</h4>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <input className={inputCls} placeholder="Client" value={ntfClient} onChange={(e) => setNtfClient(e.target.value)} />
              <select className={inputCls} value={ntfKind} onChange={(e) => setNtfKind(e.target.value)}>
                {['confirmation', 'on_the_way', 'reminder', 'follow_up', 'invoice'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <select className={inputCls} value={ntfChannel} onChange={(e) => setNtfChannel(e.target.value)}>
                <option value="sms">sms</option><option value="email">email</option>
              </select>
              <input className={inputCls} placeholder="When (optional)" value={ntfWhen} onChange={(e) => setNtfWhen(e.target.value)} />
            </div>
            <textarea className={`${inputCls} mt-2 w-full`} rows={2} placeholder="Custom message (blank = templated)" value={ntfMessage} onChange={(e) => setNtfMessage(e.target.value)} />
            <button className={`${btnCls} mt-2`} onClick={sendNotice} disabled={busy}><Send className="h-3.5 w-3.5" /> Send</button>
          </div>
          {Object.keys(noticeKinds).length > 0 && (
            <div className={cardCls}>
              <h4 className="mb-2 text-xs font-semibold text-white">Sent by Type</h4>
              <ChartKit kind="bar" data={Object.entries(noticeKinds).map(([k, v]) => ({ kind: k, count: v }))} xKey="kind" series={[{ key: 'count', label: 'Sent', color: '#06b6d4' }]} height={160} />
            </div>
          )}
          <div className={cardCls}>
            <h4 className="mb-2 text-xs font-semibold text-white">Notification Log</h4>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {notices.map((n) => (
                <div key={n.id} className="rounded border border-zinc-800 px-2 py-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{n.client}</span>
                    <span className="text-zinc-400">{n.kind} · {n.channel}</span>
                  </div>
                  <p className="mt-0.5 text-zinc-400">{n.message}</p>
                </div>
              ))}
              {notices.length === 0 && <p className="text-xs text-zinc-400">No notifications sent.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── INVENTORY ────────────────────────────────────────── */}
      {section === 'inventory' && (
        <div className="space-y-4">
          <div className={cardCls}>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white"><Boxes className="h-3.5 w-3.5 text-blue-400" /> Stock a Part · ${inventoryValue.toLocaleString()} inventory value</h4>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <input className={inputCls} placeholder="Part name" value={partName} onChange={(e) => setPartName(e.target.value)} />
              <input className={inputCls} placeholder="SKU" value={partSku} onChange={(e) => setPartSku(e.target.value)} />
              <input type="number" className={inputCls} placeholder="Qty to add" value={partQty} onChange={(e) => setPartQty(e.target.value)} />
              <input type="number" className={inputCls} placeholder="Reorder at" value={partReorder} onChange={(e) => setPartReorder(e.target.value)} />
              <input type="number" className={inputCls} placeholder="Unit cost" value={partCost} onChange={(e) => setPartCost(e.target.value)} />
            </div>
            <button className={`${btnCls} mt-2`} onClick={addPart} disabled={busy}><Plus className="h-3.5 w-3.5" /> Stock / Restock</button>
            {lowStock.length > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> Low stock: {lowStock.join(', ')}</p>
            )}
          </div>
          <div className={cardCls}>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-zinc-400"><th className="py-1">Part</th><th>SKU</th><th>On Hand</th><th>Reorder At</th><th>Unit Cost</th><th>Value</th></tr></thead>
              <tbody>
                {parts.map((p) => (
                  <tr key={p.id} className={`border-t border-zinc-900 ${p.onHand <= p.reorderAt ? 'text-amber-300' : 'text-white'}`}>
                    <td className="py-1.5">{p.name}</td>
                    <td className="text-zinc-400">{p.sku || '—'}</td>
                    <td>{p.onHand}</td>
                    <td>{p.reorderAt}</td>
                    <td>${p.unitCost.toFixed(2)}</td>
                    <td>${(p.onHand * p.unitCost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parts.length === 0 && <p className="text-xs text-zinc-400">No parts stocked. Parts deduct automatically when a job is completed on the dispatch board.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : 'text-blue-300';
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 font-mono text-lg ${color}`}>{value}</div>
    </div>
  );
}

function AssignmentRow({
  a, techs, onUpdate, onComplete,
}: {
  a: Assignment;
  techs?: Tech[];
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onComplete: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
      <div className="min-w-0">
        <span className="font-medium text-white">{a.jobTitle}</span>
        <span className={`ml-2 ${PRIORITY_COLOR[a.priority] || 'text-zinc-400'}`}>{a.priority}</span>
        <div className="truncate text-zinc-400">{a.client} · {a.address || 'no address'} · {a.date} {a.startHour}:00 ({a.durationHours}h)</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {techs && (
          <select
            className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white"
            value={a.techId ?? ''}
            onChange={(e) => onUpdate(a.id, { techId: e.target.value })}
          >
            <option value="">Assign…</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select
          className={`rounded px-1.5 py-1 text-[11px] ${STATUS_COLOR[a.status] || 'bg-zinc-800 text-zinc-300'}`}
          value={a.status}
          onChange={(e) => onUpdate(a.id, { status: e.target.value })}
        >
          {['scheduled', 'en_route', 'on_site', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {a.status !== 'completed' && a.status !== 'cancelled' && (
          <button onClick={() => onComplete(a.id)} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500">Complete</button>
        )}
      </div>
    </div>
  );
}
