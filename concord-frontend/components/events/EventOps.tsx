'use client';

// EventOps — full-stack event-operations console wired to the STATE-backed
// `events.*` domain macros (server/domains/events.js). Covers ticketing,
// the public registration page, the seating/floor-plan builder, the line-item
// budget builder, the run-of-show agenda, attendee check-in, and email blasts.
// Every macro listed in docs/lens-specs/events.md is invoked here via lensRun.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ChartKit, TimelineView } from '@/components/viz';
import {
  Ticket, Users, Armchair, DollarSign, ListChecks, ScanLine, Mail,
  Plus, Trash2, X, Globe, CheckCircle2, RefreshCw, Share2, Send,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types — shapes returned by the events.* macros
// ---------------------------------------------------------------------------
interface EvtSummary {
  id: string; name: string; type: string; date: string | null;
  venue: string | null; budget: number; guestCount: number; status: string;
  taskCount: number; doneTaskCount: number; vendorCost: number;
}
interface Tier {
  id: string; name: string; price: number; quantity: number; sold: number;
  description: string; perks: string; saleStart: string | null; saleEnd: string | null;
  remaining: number; soldOut: boolean; revenue: number;
}
interface Registration {
  id: string; name: string; email: string; tierId: string; tierName: string;
  quantity: number; amountPaid: number; checkedIn: boolean; checkedInAt: string | null;
  ticketCode: string; notes: string; registeredAt: string;
}
interface SeatTable {
  id: string; label: string; capacity: number; shape: string; x: number; y: number;
  seats: { guestName: string; registrationId: string | null }[];
}
interface BudgetLine {
  id: string; label: string; category: string; kind: 'expense' | 'revenue';
  budgeted: number; actual: number; paid: boolean;
}
interface AgendaItem {
  id: string; title: string; day: string; startTime: string; durationMin: number;
  track: string; owner: string; notes: string; endTime?: string;
}
interface Blast {
  id: string; subject: string; body: string; segment: string;
  recipientCount: number; sentAt: string;
}
interface PublicPage {
  slug: string | null; published: boolean; headline: string; blurb: string; views: number;
}

type OpsTab = 'tickets' | 'attendees' | 'seating' | 'budget' | 'agenda' | 'checkin' | 'blasts' | 'public';

const OPS_TABS: { id: OpsTab; label: string; icon: typeof Ticket }[] = [
  { id: 'tickets', label: 'Ticketing', icon: Ticket },
  { id: 'attendees', label: 'Attendees', icon: Users },
  { id: 'seating', label: 'Floor Plan', icon: Armchair },
  { id: 'budget', label: 'Budget', icon: DollarSign },
  { id: 'agenda', label: 'Run of Show', icon: ListChecks },
  { id: 'checkin', label: 'Check-in', icon: ScanLine },
  { id: 'blasts', label: 'Blasts', icon: Mail },
  { id: 'public', label: 'Public Page', icon: Globe },
];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EventOps() {
  const [events, setEvents] = useState<EvtSummary[]>([]);
  const [activeEvent, setActiveEvent] = useState<string | null>(null);
  const [tab, setTab] = useState<OpsTab>('tickets');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newEvtName, setNewEvtName] = useState('');
  const [newEvtType, setNewEvtType] = useState('conference');
  const [newEvtDate, setNewEvtDate] = useState('');

  // Per-tab collections
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [tierTotals, setTierTotals] = useState({ totalRevenue: 0, totalSold: 0, totalCapacity: 0 });
  const [regs, setRegs] = useState<Registration[]>([]);
  const [regStats, setRegStats] = useState({ totalTickets: 0, capacity: 0, revenue: 0, capacityPct: 0, checkedInCount: 0 });
  const [tables, setTables] = useState<SeatTable[]>([]);
  const [planStats, setPlanStats] = useState({ totalSeats: 0, assignedSeats: 0, openSeats: 0 });
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [budget, setBudget] = useState<{
    budgetedExpense: number; actualExpense: number; ticketRevenue: number;
    actualRevenue: number; netProfit: number; variance: number; overBudget: boolean;
    byCategory: Record<string, { budgeted: number; actual: number }>;
  } | null>(null);
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [agendaStats, setAgendaStats] = useState({ dayCount: 0, totalDurationMin: 0 });
  const [blasts, setBlasts] = useState<Blast[]>([]);
  const [publicPage, setPublicPage] = useState<PublicPage | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Inline form state
  const [tierForm, setTierForm] = useState({ name: '', price: '', quantity: '', perks: '' });
  const [regForm, setRegForm] = useState({ name: '', email: '', tierId: '', quantity: '1' });
  const [tableForm, setTableForm] = useState({ label: '', capacity: '8', shape: 'round' });
  const [lineForm, setLineForm] = useState({ label: '', category: 'venue', kind: 'expense', budgeted: '', actual: '' });
  const [agendaForm, setAgendaForm] = useState({ title: '', day: '', startTime: '09:00', durationMin: '30', track: 'Main', owner: '' });
  const [blastForm, setBlastForm] = useState({ subject: '', body: '', segment: 'all' });
  const [pageForm, setPageForm] = useState({ headline: '', blurb: '' });
  const [scanCode, setScanCode] = useState('');
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // -------------------------------------------------------------------------
  // Macro helpers
  // -------------------------------------------------------------------------
  const run = useCallback(async (action: string, input: Record<string, unknown> = {}) => {
    const r = await lensRun('events', action, input);
    if (!r.data.ok) throw new Error(r.data.error || `${action} failed`);
    return r.data.result as Record<string, unknown>;
  }, []);

  const loadEvents = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await run('event-list');
      const list = (res?.events as EvtSummary[]) || [];
      setEvents(list);
      setActiveEvent((prev) => prev && list.some((e) => e.id === prev) ? prev : (list[0]?.id ?? null));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [run]);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  // Per-tab data loaders ----------------------------------------------------
  const reloadTab = useCallback(async (eventId: string, which: OpsTab) => {
    setErr(null);
    try {
      if (which === 'tickets') {
        const r = await run('tier-list', { eventId });
        setTiers((r?.tiers as Tier[]) || []);
        setTierTotals({
          totalRevenue: Number(r?.totalRevenue || 0),
          totalSold: Number(r?.totalSold || 0),
          totalCapacity: Number(r?.totalCapacity || 0),
        });
      } else if (which === 'attendees') {
        const [r, t] = await Promise.all([
          run('registration-list', { eventId }),
          run('tier-list', { eventId }),
        ]);
        setRegs((r?.registrations as Registration[]) || []);
        setRegStats({
          totalTickets: Number(r?.totalTickets || 0),
          capacity: Number(r?.capacity || 0),
          revenue: Number(r?.revenue || 0),
          capacityPct: Number(r?.capacityPct || 0),
          checkedInCount: Number(r?.checkedInCount || 0),
        });
        setTiers((t?.tiers as Tier[]) || []);
      } else if (which === 'seating') {
        const r = await run('floor-plan', { eventId });
        setTables((r?.tables as SeatTable[]) || []);
        setPlanStats({
          totalSeats: Number(r?.totalSeats || 0),
          assignedSeats: Number(r?.assignedSeats || 0),
          openSeats: Number(r?.openSeats || 0),
        });
      } else if (which === 'budget') {
        const r = await run('budget-summary', { eventId });
        setBudget({
          budgetedExpense: Number(r?.budgetedExpense || 0),
          actualExpense: Number(r?.actualExpense || 0),
          ticketRevenue: Number(r?.ticketRevenue || 0),
          actualRevenue: Number(r?.actualRevenue || 0),
          netProfit: Number(r?.netProfit || 0),
          variance: Number(r?.variance || 0),
          overBudget: Boolean(r?.overBudget),
          byCategory: (r?.byCategory as Record<string, { budgeted: number; actual: number }>) || {},
        });
        const detail = await run('event-detail', { eventId });
        const ev = detail?.event as { budgetLines?: BudgetLine[] } | undefined;
        setLines(ev?.budgetLines || []);
      } else if (which === 'agenda') {
        const r = await run('agenda-timeline', { eventId });
        setAgenda((r?.items as AgendaItem[]) || []);
        setAgendaStats({
          dayCount: Number(r?.dayCount || 0),
          totalDurationMin: Number(r?.totalDurationMin || 0),
        });
      } else if (which === 'checkin') {
        const r = await run('check-in-status', { eventId });
        setRegStats((s) => ({
          ...s,
          checkedInCount: Number(r?.checkedInCount || 0),
          totalTickets: Number(r?.totalRegistered || 0),
          capacityPct: Number(r?.attendanceRate || 0),
        }));
        const detail = await run('registration-list', { eventId });
        setRegs((detail?.registrations as Registration[]) || []);
      } else if (which === 'blasts') {
        const r = await run('blast-list', { eventId });
        setBlasts((r?.blasts as Blast[]) || []);
      } else if (which === 'public') {
        const detail = await run('event-detail', { eventId });
        const ev = detail?.event as { publicPage?: PublicPage } | undefined;
        setPublicPage(ev?.publicPage || null);
        if (ev?.publicPage?.slug) setShareUrl(`/e/${ev.publicPage.slug}`);
        else setShareUrl(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [run]);

  useEffect(() => {
    if (activeEvent) void reloadTab(activeEvent, tab);
  }, [activeEvent, tab, reloadTab]);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------
  const createEvent = async () => {
    if (!newEvtName.trim()) return;
    try {
      const r = await run('event-create', { name: newEvtName.trim(), type: newEvtType, date: newEvtDate || undefined });
      setNewEvtName(''); setNewEvtDate(''); setCreating(false);
      await loadEvents();
      const id = (r?.event as { id?: string })?.id;
      if (id) setActiveEvent(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const guard = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const addTier = () => guard(async () => {
    if (!activeEvent || !tierForm.name.trim()) return;
    await run('tier-create', {
      eventId: activeEvent, name: tierForm.name.trim(),
      price: Number(tierForm.price) || 0, quantity: Number(tierForm.quantity) || 0,
      perks: tierForm.perks,
    });
    setTierForm({ name: '', price: '', quantity: '', perks: '' });
    await reloadTab(activeEvent, 'tickets');
  });
  const delTier = (tierId: string) => guard(async () => {
    if (!activeEvent) return;
    await run('tier-delete', { eventId: activeEvent, tierId });
    await reloadTab(activeEvent, 'tickets');
  });

  const addReg = () => guard(async () => {
    if (!activeEvent || !regForm.name.trim() || !regForm.email.trim() || !regForm.tierId) return;
    await run('register-attendee', {
      eventId: activeEvent, tierId: regForm.tierId, name: regForm.name.trim(),
      email: regForm.email.trim(), quantity: Number(regForm.quantity) || 1,
    });
    setRegForm({ name: '', email: '', tierId: regForm.tierId, quantity: '1' });
    await reloadTab(activeEvent, 'attendees');
  });
  const cancelReg = (registrationId: string) => guard(async () => {
    if (!activeEvent) return;
    await run('registration-cancel', { eventId: activeEvent, registrationId });
    await reloadTab(activeEvent, 'attendees');
  });

  const addTable = () => guard(async () => {
    if (!activeEvent || !tableForm.label.trim()) return;
    await run('table-add', {
      eventId: activeEvent, label: tableForm.label.trim(),
      capacity: Number(tableForm.capacity) || 8, shape: tableForm.shape,
      x: Math.round(Math.random() * 320), y: Math.round(Math.random() * 220),
    });
    setTableForm({ label: '', capacity: '8', shape: 'round' });
    await reloadTab(activeEvent, 'seating');
  });
  const moveTable = (tableId: string, x: number, y: number) => guard(async () => {
    if (!activeEvent) return;
    await run('table-move', { eventId: activeEvent, tableId, x, y });
    await reloadTab(activeEvent, 'seating');
  });
  const delTable = (tableId: string) => guard(async () => {
    if (!activeEvent) return;
    await run('table-remove', { eventId: activeEvent, tableId });
    await reloadTab(activeEvent, 'seating');
  });
  const assignSeat = (tableId: string, guestName: string) => guard(async () => {
    if (!activeEvent || !guestName.trim()) return;
    await run('seat-assign', { eventId: activeEvent, tableId, guestName: guestName.trim() });
    await reloadTab(activeEvent, 'seating');
  });
  const unseat = (guestName: string) => guard(async () => {
    if (!activeEvent) return;
    await run('seat-unassign', { eventId: activeEvent, guestName });
    await reloadTab(activeEvent, 'seating');
  });

  const addLine = () => guard(async () => {
    if (!activeEvent || !lineForm.label.trim()) return;
    await run('budget-line-add', {
      eventId: activeEvent, label: lineForm.label.trim(), category: lineForm.category,
      kind: lineForm.kind, budgeted: Number(lineForm.budgeted) || 0, actual: Number(lineForm.actual) || 0,
    });
    setLineForm({ label: '', category: 'venue', kind: 'expense', budgeted: '', actual: '' });
    await reloadTab(activeEvent, 'budget');
  });
  const updateLineActual = (lineId: string, actual: number) => guard(async () => {
    if (!activeEvent) return;
    await run('budget-line-update', { eventId: activeEvent, lineId, actual });
    await reloadTab(activeEvent, 'budget');
  });
  const delLine = (lineId: string) => guard(async () => {
    if (!activeEvent) return;
    await run('budget-line-delete', { eventId: activeEvent, lineId });
    await reloadTab(activeEvent, 'budget');
  });

  const addAgenda = () => guard(async () => {
    if (!activeEvent || !agendaForm.title.trim()) return;
    await run('agenda-item-add', {
      eventId: activeEvent, title: agendaForm.title.trim(), day: agendaForm.day || undefined,
      startTime: agendaForm.startTime, durationMin: Number(agendaForm.durationMin) || 30,
      track: agendaForm.track, owner: agendaForm.owner,
    });
    setAgendaForm({ ...agendaForm, title: '', owner: '' });
    await reloadTab(activeEvent, 'agenda');
  });
  const updateAgendaDuration = (itemId: string, durationMin: number) => guard(async () => {
    if (!activeEvent) return;
    await run('agenda-item-update', { eventId: activeEvent, itemId, durationMin });
    await reloadTab(activeEvent, 'agenda');
  });
  const delAgenda = (itemId: string) => guard(async () => {
    if (!activeEvent) return;
    await run('agenda-item-delete', { eventId: activeEvent, itemId });
    await reloadTab(activeEvent, 'agenda');
  });

  const doCheckIn = () => guard(async () => {
    if (!activeEvent || !scanCode.trim()) return;
    setScanMsg(null);
    const r = await lensRun('events', 'check-in', { eventId: activeEvent, ticketCode: scanCode.trim() });
    if (r.data.ok) {
      const reg = (r.data.result as { registration?: Registration })?.registration;
      setScanMsg({ ok: true, text: `Checked in: ${reg?.name || scanCode}` });
    } else {
      setScanMsg({ ok: false, text: r.data.error || 'Check-in failed' });
    }
    setScanCode('');
    await reloadTab(activeEvent, 'checkin');
  });
  const checkInById = (registrationId: string) => guard(async () => {
    if (!activeEvent) return;
    await run('check-in', { eventId: activeEvent, registrationId });
    await reloadTab(activeEvent, 'checkin');
  });
  const undoCheckIn = (registrationId: string) => guard(async () => {
    if (!activeEvent) return;
    await run('check-in-undo', { eventId: activeEvent, registrationId });
    await reloadTab(activeEvent, 'checkin');
  });

  const sendBlast = () => guard(async () => {
    if (!activeEvent || !blastForm.subject.trim() || !blastForm.body.trim()) return;
    await run('blast-send', {
      eventId: activeEvent, subject: blastForm.subject.trim(),
      body: blastForm.body.trim(), segment: blastForm.segment,
    });
    setBlastForm({ subject: '', body: '', segment: 'all' });
    await reloadTab(activeEvent, 'blasts');
  });
  const delBlast = (blastId: string) => guard(async () => {
    if (!activeEvent) return;
    await run('blast-delete', { eventId: activeEvent, blastId });
    await reloadTab(activeEvent, 'blasts');
  });

  const publishPage = (published: boolean) => guard(async () => {
    if (!activeEvent) return;
    const r = await run('publish-page', {
      eventId: activeEvent, published,
      headline: pageForm.headline || undefined, blurb: pageForm.blurb || undefined,
    });
    setPublicPage((r?.publicPage as PublicPage) || null);
    setShareUrl((r?.shareUrl as string) || null);
  });
  const previewPublic = () => guard(async () => {
    if (!publicPage?.slug) return;
    const r = await run('public-page', { slug: publicPage.slug });
    setPublicPage((r?.publicPage as PublicPage) || publicPage);
  });

  // -------------------------------------------------------------------------
  // Derived viz data
  // -------------------------------------------------------------------------
  const tierChartData = useMemo(
    () => tiers.map((t) => ({ tier: t.name, sold: t.sold, remaining: t.remaining })),
    [tiers],
  );

  const budgetChartData = useMemo(() => {
    if (!budget) return [];
    return Object.keys(budget.byCategory).map((c) => ({
      category: c,
      budgeted: budget.byCategory[c].budgeted,
      actual: budget.byCategory[c].actual,
    }));
  }, [budget]);

  const agendaTimeline = useMemo(() => agenda.map((a) => ({
    id: a.id,
    label: `${a.startTime} ${a.title}`,
    time: `${a.day}T${a.startTime}`,
    tone: 'info' as const,
    detail: `${a.track} · ${a.durationMin}min${a.owner ? ` · ${a.owner}` : ''}`,
  })), [agenda]);

  const activeEvtObj = events.find((e) => e.id === activeEvent) || null;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Ticket className="w-5 h-5 text-neon-cyan" />
          <h2 className={ds.heading3}>Event Operations</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void loadEvents()} className={cn(ds.btnGhost, 'text-xs')} aria-label="Refresh">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
          <button onClick={() => setCreating((v) => !v)} className={cn(ds.btnSecondary, 'text-xs')}>
            <Plus className="w-3.5 h-3.5" /> New Event
          </button>
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          <X className="w-4 h-4" /> {err}
        </div>
      )}

      {creating && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input className={ds.input} placeholder="Event name" value={newEvtName}
              onChange={(e) => setNewEvtName(e.target.value)} />
            <select className={ds.select} value={newEvtType} onChange={(e) => setNewEvtType(e.target.value)}>
              {['conference', 'wedding', 'concert', 'festival', 'corporate', 'social'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input className={ds.input} type="date" value={newEvtDate}
              onChange={(e) => setNewEvtDate(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button onClick={createEvent} className={ds.btnPrimary} disabled={!newEvtName.trim()}>Create</button>
            <button onClick={() => setCreating(false)} className={ds.btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {/* Event selector */}
      {events.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-8')}>
          <p className={ds.textMuted}>No events yet. Create one to manage ticketing, seating and check-in.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {events.map((e) => (
              <button key={e.id} onClick={() => setActiveEvent(e.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  activeEvent === e.id
                    ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40'
                    : 'bg-lattice-elevated text-gray-400 hover:text-white'
                )}>
                {e.name} <span className="opacity-60">· {e.type}</span>
              </button>
            ))}
          </div>

          {activeEvtObj && (
            <>
              {/* Ops tabs */}
              <nav className="flex items-center gap-1 border-b border-lattice-border pb-2 flex-wrap">
                {OPS_TABS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button key={t.id} onClick={() => setTab(t.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        tab === t.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400 hover:text-white'
                      )}>
                      <Icon className="w-3.5 h-3.5" /> {t.label}
                    </button>
                  );
                })}
              </nav>

              {/* --- TICKETING --- */}
              {tab === 'tickets' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Capacity" value={tierTotals.totalCapacity.toLocaleString()} />
                    <Stat label="Sold" value={tierTotals.totalSold.toLocaleString()} />
                    <Stat label="Revenue" value={fmt(tierTotals.totalRevenue)} accent="green-400" />
                  </div>
                  <div className={cn(ds.panel, 'grid grid-cols-2 sm:grid-cols-5 gap-2')}>
                    <input className={ds.input} placeholder="Tier name" value={tierForm.name}
                      onChange={(e) => setTierForm({ ...tierForm, name: e.target.value })} />
                    <input className={ds.input} type="number" placeholder="Price" value={tierForm.price}
                      onChange={(e) => setTierForm({ ...tierForm, price: e.target.value })} />
                    <input className={ds.input} type="number" placeholder="Quantity" value={tierForm.quantity}
                      onChange={(e) => setTierForm({ ...tierForm, quantity: e.target.value })} />
                    <input className={ds.input} placeholder="Perks" value={tierForm.perks}
                      onChange={(e) => setTierForm({ ...tierForm, perks: e.target.value })} />
                    <button onClick={addTier} className={ds.btnPrimary} disabled={!tierForm.name.trim()}>
                      <Plus className="w-4 h-4" /> Add Tier
                    </button>
                  </div>
                  {tiers.length === 0 ? (
                    <p className={cn(ds.textMuted, 'text-center py-4')}>No ticket tiers yet.</p>
                  ) : (
                    <>
                      <div className={ds.grid3}>
                        {tiers.map((t) => (
                          <div key={t.id} className={cn(ds.panel, 'relative')}>
                            {t.soldOut && (
                              <span className={cn(ds.badge('red-400'), 'absolute top-2 right-2')}>SOLD OUT</span>
                            )}
                            <h4 className="font-semibold text-sm">{t.name}</h4>
                            <p className="text-xl font-bold text-neon-cyan">{fmt(t.price)}</p>
                            <div className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden my-2">
                              <div className="h-full bg-neon-cyan rounded-full"
                                style={{ width: `${t.quantity > 0 ? Math.min(100, (t.sold / t.quantity) * 100) : 0}%` }} />
                            </div>
                            <p className="text-xs text-gray-400">{t.sold} sold · {t.remaining} left</p>
                            <p className="text-xs text-green-400">{fmt(t.revenue)} revenue</p>
                            {t.perks && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.perks}</p>}
                            <button onClick={() => delTier(t.id)}
                              className={cn(ds.btnGhost, 'hover:text-red-400 mt-2 text-xs')}>
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className={ds.panel}>
                        <p className={cn(ds.textMuted, 'mb-2')}>Tickets sold by tier</p>
                        <ChartKit
                          kind="bar"
                          data={tierChartData}
                          xKey="tier"
                          series={[
                            { key: 'sold', label: 'Sold', color: '#22d3ee' },
                            { key: 'remaining', label: 'Remaining', color: '#3f3f46' },
                          ]}
                          height={180}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* --- ATTENDEES --- */}
              {tab === 'attendees' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-3">
                    <Stat label="Registered" value={regStats.totalTickets.toLocaleString()} />
                    <Stat label="Capacity" value={`${regStats.capacityPct}%`} />
                    <Stat label="Checked In" value={regStats.checkedInCount.toLocaleString()} />
                    <Stat label="Revenue" value={fmt(regStats.revenue)} accent="green-400" />
                  </div>
                  <div className={cn(ds.panel, 'grid grid-cols-2 sm:grid-cols-5 gap-2')}>
                    <input className={ds.input} placeholder="Attendee name" value={regForm.name}
                      onChange={(e) => setRegForm({ ...regForm, name: e.target.value })} />
                    <input className={ds.input} placeholder="Email" value={regForm.email}
                      onChange={(e) => setRegForm({ ...regForm, email: e.target.value })} />
                    <select className={ds.select} value={regForm.tierId}
                      onChange={(e) => setRegForm({ ...regForm, tierId: e.target.value })}>
                      <option value="">Select tier...</option>
                      {tiers.map((t) => <option key={t.id} value={t.id}>{t.name} ({fmt(t.price)})</option>)}
                    </select>
                    <input className={ds.input} type="number" min="1" placeholder="Qty" value={regForm.quantity}
                      onChange={(e) => setRegForm({ ...regForm, quantity: e.target.value })} />
                    <button onClick={addReg} className={ds.btnPrimary}
                      disabled={!regForm.name.trim() || !regForm.email.trim() || !regForm.tierId}>
                      <Plus className="w-4 h-4" /> Register
                    </button>
                  </div>
                  {regs.length === 0 ? (
                    <p className={cn(ds.textMuted, 'text-center py-4')}>No attendees registered.</p>
                  ) : (
                    <div className={cn(ds.panel, 'overflow-x-auto')}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-500 border-b border-lattice-border">
                            <th className="pb-2 pr-4">Name</th><th className="pb-2 pr-4">Email</th>
                            <th className="pb-2 pr-4">Tier</th><th className="pb-2 pr-4">Code</th>
                            <th className="pb-2 pr-4">Paid</th><th className="pb-2 pr-4">Status</th><th className="pb-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-lattice-border">
                          {regs.map((r) => (
                            <tr key={r.id} className="text-gray-300">
                              <td className="py-2 pr-4 font-medium">{r.name}</td>
                              <td className="py-2 pr-4">{r.email}</td>
                              <td className="py-2 pr-4">{r.tierName}</td>
                              <td className="py-2 pr-4 font-mono text-xs text-neon-cyan">{r.ticketCode}</td>
                              <td className="py-2 pr-4">{fmt(r.amountPaid)}</td>
                              <td className="py-2 pr-4">
                                <span className={ds.badge(r.checkedIn ? 'green-400' : 'gray-400')}>
                                  {r.checkedIn ? 'checked-in' : 'registered'}
                                </span>
                              </td>
                              <td className="py-2">
                                <button onClick={() => cancelReg(r.id)}
                                  className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Cancel">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* --- SEATING --- */}
              {tab === 'seating' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Total Seats" value={planStats.totalSeats} />
                    <Stat label="Assigned" value={planStats.assignedSeats} />
                    <Stat label="Open" value={planStats.openSeats} />
                  </div>
                  <div className={cn(ds.panel, 'grid grid-cols-2 sm:grid-cols-4 gap-2')}>
                    <input className={ds.input} placeholder="Table label" value={tableForm.label}
                      onChange={(e) => setTableForm({ ...tableForm, label: e.target.value })} />
                    <input className={ds.input} type="number" placeholder="Seats" value={tableForm.capacity}
                      onChange={(e) => setTableForm({ ...tableForm, capacity: e.target.value })} />
                    <select className={ds.select} value={tableForm.shape}
                      onChange={(e) => setTableForm({ ...tableForm, shape: e.target.value })}>
                      {['round', 'rectangle', 'square'].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={addTable} className={ds.btnPrimary} disabled={!tableForm.label.trim()}>
                      <Plus className="w-4 h-4" /> Add Table
                    </button>
                  </div>
                  {/* Visual floor plan canvas */}
                  <div className={cn(ds.panel, 'relative h-[280px] bg-lattice-elevated/30 overflow-hidden')}>
                    {tables.length === 0 && (
                      <p className={cn(ds.textMuted, 'absolute inset-0 flex items-center justify-center')}>
                        Add tables to build the floor plan
                      </p>
                    )}
                    {tables.map((tbl) => (
                      <FloorTable key={tbl.id} table={tbl} onMove={moveTable} />
                    ))}
                  </div>
                  {/* Table detail list with seat assignment */}
                  <div className={ds.grid2}>
                    {tables.map((tbl) => (
                      <SeatTableCard key={tbl.id} table={tbl}
                        guests={regs.length ? regs.map((r) => r.name) : []}
                        onAssign={assignSeat} onUnseat={unseat} onDelete={delTable} />
                    ))}
                  </div>
                </div>
              )}

              {/* --- BUDGET --- */}
              {tab === 'budget' && budget && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Stat label="Budgeted Exp." value={fmt(budget.budgetedExpense)} />
                    <Stat label="Actual Exp." value={fmt(budget.actualExpense)}
                      accent={budget.overBudget ? 'red-400' : 'white'} />
                    <Stat label="Revenue" value={fmt(budget.actualRevenue)} accent="green-400" />
                    <Stat label="Net" value={fmt(budget.netProfit)}
                      accent={budget.netProfit >= 0 ? 'green-400' : 'red-400'} />
                  </div>
                  <div className={cn(ds.panel, 'grid grid-cols-2 sm:grid-cols-6 gap-2')}>
                    <input className={ds.input} placeholder="Line label" value={lineForm.label}
                      onChange={(e) => setLineForm({ ...lineForm, label: e.target.value })} />
                    <input className={ds.input} placeholder="Category" value={lineForm.category}
                      onChange={(e) => setLineForm({ ...lineForm, category: e.target.value })} />
                    <select className={ds.select} value={lineForm.kind}
                      onChange={(e) => setLineForm({ ...lineForm, kind: e.target.value })}>
                      <option value="expense">expense</option>
                      <option value="revenue">revenue</option>
                    </select>
                    <input className={ds.input} type="number" placeholder="Budgeted" value={lineForm.budgeted}
                      onChange={(e) => setLineForm({ ...lineForm, budgeted: e.target.value })} />
                    <input className={ds.input} type="number" placeholder="Actual" value={lineForm.actual}
                      onChange={(e) => setLineForm({ ...lineForm, actual: e.target.value })} />
                    <button onClick={addLine} className={ds.btnPrimary} disabled={!lineForm.label.trim()}>
                      <Plus className="w-4 h-4" /> Add Line
                    </button>
                  </div>
                  {lines.length > 0 && (
                    <div className={cn(ds.panel, 'overflow-x-auto')}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-500 border-b border-lattice-border">
                            <th className="pb-2 pr-4">Line</th><th className="pb-2 pr-4">Category</th>
                            <th className="pb-2 pr-4">Kind</th><th className="pb-2 pr-4 text-right">Budgeted</th>
                            <th className="pb-2 pr-4 text-right">Actual</th><th className="pb-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-lattice-border">
                          {lines.map((l) => (
                            <tr key={l.id} className="text-gray-300">
                              <td className="py-2 pr-4 font-medium">{l.label}</td>
                              <td className="py-2 pr-4 capitalize">{l.category}</td>
                              <td className="py-2 pr-4">
                                <span className={ds.badge(l.kind === 'revenue' ? 'green-400' : 'amber-400')}>
                                  {l.kind}
                                </span>
                              </td>
                              <td className="py-2 pr-4 text-right">{fmt(l.budgeted)}</td>
                              <td className="py-2 pr-4 text-right">
                                <input type="number" defaultValue={l.actual}
                                  className="w-24 bg-lattice-elevated rounded px-2 py-1 text-right text-xs"
                                  onBlur={(e) => {
                                    const v = Number(e.target.value);
                                    if (v !== l.actual) updateLineActual(l.id, v);
                                  }} />
                              </td>
                              <td className="py-2">
                                <button onClick={() => delLine(l.id)}
                                  className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Delete line">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {budgetChartData.length > 0 && (
                    <div className={ds.panel}>
                      <p className={cn(ds.textMuted, 'mb-2')}>Budgeted vs actual by category</p>
                      <ChartKit
                        kind="bar"
                        data={budgetChartData}
                        xKey="category"
                        series={[
                          { key: 'budgeted', label: 'Budgeted', color: '#a78bfa' },
                          { key: 'actual', label: 'Actual', color: '#f472b6' },
                        ]}
                        height={200}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* --- AGENDA --- */}
              {tab === 'agenda' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Items" value={agenda.length} />
                    <Stat label="Days" value={agendaStats.dayCount} />
                    <Stat label="Total Duration" value={`${Math.round(agendaStats.totalDurationMin / 60 * 10) / 10}h`} />
                  </div>
                  <div className={cn(ds.panel, 'grid grid-cols-2 sm:grid-cols-6 gap-2')}>
                    <input className={ds.input} placeholder="Session title" value={agendaForm.title}
                      onChange={(e) => setAgendaForm({ ...agendaForm, title: e.target.value })} />
                    <input className={ds.input} type="date" value={agendaForm.day}
                      onChange={(e) => setAgendaForm({ ...agendaForm, day: e.target.value })} />
                    <input className={ds.input} type="time" value={agendaForm.startTime}
                      onChange={(e) => setAgendaForm({ ...agendaForm, startTime: e.target.value })} />
                    <input className={ds.input} type="number" placeholder="Min" value={agendaForm.durationMin}
                      onChange={(e) => setAgendaForm({ ...agendaForm, durationMin: e.target.value })} />
                    <input className={ds.input} placeholder="Owner" value={agendaForm.owner}
                      onChange={(e) => setAgendaForm({ ...agendaForm, owner: e.target.value })} />
                    <button onClick={addAgenda} className={ds.btnPrimary} disabled={!agendaForm.title.trim()}>
                      <Plus className="w-4 h-4" /> Add
                    </button>
                  </div>
                  {agenda.length === 0 ? (
                    <p className={cn(ds.textMuted, 'text-center py-4')}>No agenda items yet.</p>
                  ) : (
                    <>
                      <div className={ds.panel}>
                        <TimelineView events={agendaTimeline} />
                      </div>
                      <div className={cn(ds.panel, 'overflow-x-auto')}>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-500 border-b border-lattice-border">
                              <th className="pb-2 pr-3">Day</th><th className="pb-2 pr-3">Start</th>
                              <th className="pb-2 pr-3">End</th><th className="pb-2 pr-3">Session</th>
                              <th className="pb-2 pr-3">Track</th><th className="pb-2 pr-3">Duration</th><th className="pb-2" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-lattice-border">
                            {agenda.map((a) => (
                              <tr key={a.id} className="text-gray-300">
                                <td className="py-2 pr-3 font-mono text-xs">{a.day}</td>
                                <td className="py-2 pr-3 font-mono text-neon-cyan">{a.startTime}</td>
                                <td className="py-2 pr-3 font-mono text-gray-500">{a.endTime || '—'}</td>
                                <td className="py-2 pr-3 font-medium">{a.title}</td>
                                <td className="py-2 pr-3">{a.track}</td>
                                <td className="py-2 pr-3">
                                  <input type="number" defaultValue={a.durationMin}
                                    className="w-16 bg-lattice-elevated rounded px-2 py-1 text-xs"
                                    onBlur={(e) => {
                                      const v = Number(e.target.value);
                                      if (v !== a.durationMin) updateAgendaDuration(a.id, v);
                                    }} />
                                </td>
                                <td className="py-2">
                                  <button onClick={() => delAgenda(a.id)}
                                    className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Delete item">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* --- CHECK-IN --- */}
              {tab === 'checkin' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Registered" value={regStats.totalTickets} />
                    <Stat label="Checked In" value={regStats.checkedInCount} accent="green-400" />
                    <Stat label="Attendance" value={`${regStats.capacityPct}%`} />
                  </div>
                  <div className={cn(ds.panel, 'space-y-2')}>
                    <p className={cn(ds.textMuted, 'flex items-center gap-2')}>
                      <ScanLine className="w-4 h-4" /> Scan ticket code
                    </p>
                    <div className="flex gap-2">
                      <input className={cn(ds.input, 'font-mono')} placeholder="TKT-XXXXXX" value={scanCode}
                        onChange={(e) => setScanCode(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') doCheckIn(); }} />
                      <button onClick={doCheckIn} className={ds.btnPrimary} disabled={!scanCode.trim()}>
                        <CheckCircle2 className="w-4 h-4" /> Check In
                      </button>
                    </div>
                    {scanMsg && (
                      <p className={cn('text-sm', scanMsg.ok ? 'text-green-400' : 'text-red-400')}>
                        {scanMsg.text}
                      </p>
                    )}
                  </div>
                  {regs.length > 0 && (
                    <div className={cn(ds.panel, 'overflow-x-auto')}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-500 border-b border-lattice-border">
                            <th className="pb-2 pr-4">Name</th><th className="pb-2 pr-4">Code</th>
                            <th className="pb-2 pr-4">Status</th><th className="pb-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-lattice-border">
                          {regs.map((r) => (
                            <tr key={r.id} className="text-gray-300">
                              <td className="py-2 pr-4 font-medium">{r.name}</td>
                              <td className="py-2 pr-4 font-mono text-xs text-neon-cyan">{r.ticketCode}</td>
                              <td className="py-2 pr-4">
                                <span className={ds.badge(r.checkedIn ? 'green-400' : 'gray-400')}>
                                  {r.checkedIn ? `in @ ${String(r.checkedInAt || '').slice(11, 16)}` : 'pending'}
                                </span>
                              </td>
                              <td className="py-2">
                                {r.checkedIn ? (
                                  <button onClick={() => undoCheckIn(r.id)} className={cn(ds.btnGhost, 'text-xs')}>
                                    Undo
                                  </button>
                                ) : (
                                  <button onClick={() => checkInById(r.id)}
                                    className={cn(ds.btnSecondary, 'text-xs')}>
                                    Check In
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* --- BLASTS --- */}
              {tab === 'blasts' && (
                <div className="space-y-3">
                  <div className={cn(ds.panel, 'space-y-2')}>
                    <input className={ds.input} placeholder="Subject" value={blastForm.subject}
                      onChange={(e) => setBlastForm({ ...blastForm, subject: e.target.value })} />
                    <textarea className={ds.textarea} rows={3} placeholder="Message body" value={blastForm.body}
                      onChange={(e) => setBlastForm({ ...blastForm, body: e.target.value })} />
                    <div className="flex gap-2">
                      <select className={ds.select} value={blastForm.segment}
                        onChange={(e) => setBlastForm({ ...blastForm, segment: e.target.value })}>
                        <option value="all">All registrants</option>
                        <option value="checked-in">Checked-in only</option>
                        <option value="not-checked-in">Not checked-in</option>
                      </select>
                      <button onClick={sendBlast} className={ds.btnPrimary}
                        disabled={!blastForm.subject.trim() || !blastForm.body.trim()}>
                        <Send className="w-4 h-4" /> Send Blast
                      </button>
                    </div>
                  </div>
                  {blasts.length === 0 ? (
                    <p className={cn(ds.textMuted, 'text-center py-4')}>No blasts sent yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {blasts.map((b) => (
                        <div key={b.id} className={cn(ds.panel, 'flex items-start justify-between gap-3')}>
                          <div className="min-w-0">
                            <p className="font-medium text-sm">{b.subject}</p>
                            <p className="text-xs text-gray-400 line-clamp-2">{b.body}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              {b.segment} · {b.recipientCount} recipient{b.recipientCount !== 1 ? 's' : ''} ·{' '}
                              {String(b.sentAt).slice(0, 16).replace('T', ' ')}
                            </p>
                          </div>
                          <button onClick={() => delBlast(b.id)}
                            className={cn(ds.btnGhost, 'hover:text-red-400 shrink-0')} aria-label="Delete blast">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* --- PUBLIC PAGE --- */}
              {tab === 'public' && (
                <div className="space-y-3">
                  <div className={cn(ds.panel, 'space-y-2')}>
                    <input className={ds.input} placeholder="Headline"
                      value={pageForm.headline || publicPage?.headline || ''}
                      onChange={(e) => setPageForm({ ...pageForm, headline: e.target.value })} />
                    <textarea className={ds.textarea} rows={3} placeholder="Event blurb / description"
                      value={pageForm.blurb || publicPage?.blurb || ''}
                      onChange={(e) => setPageForm({ ...pageForm, blurb: e.target.value })} />
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => publishPage(true)} className={ds.btnPrimary}>
                        <Globe className="w-4 h-4" /> {publicPage?.published ? 'Update Page' : 'Publish Page'}
                      </button>
                      {publicPage?.published && (
                        <button onClick={() => publishPage(false)} className={ds.btnSecondary}>
                          Unpublish
                        </button>
                      )}
                      {publicPage?.slug && (
                        <button onClick={previewPublic} className={ds.btnSecondary}>
                          <RefreshCw className="w-4 h-4" /> Preview / Refresh
                        </button>
                      )}
                    </div>
                  </div>
                  {publicPage?.slug && (
                    <div className={cn(ds.panel, 'space-y-2')}>
                      <div className="flex items-center gap-2">
                        <Share2 className="w-4 h-4 text-neon-cyan" />
                        <span className="text-sm">Shareable link</span>
                        <span className={ds.badge(publicPage.published ? 'green-400' : 'gray-400')}>
                          {publicPage.published ? 'live' : 'draft'}
                        </span>
                      </div>
                      <code className="block text-xs text-neon-cyan bg-lattice-elevated rounded px-3 py-2">
                        {shareUrl || `/e/${publicPage.slug}`}
                      </code>
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <Stat label="Page Views" value={publicPage.views} />
                        <Stat label="Headline" value={publicPage.headline || '—'} />
                      </div>
                      {publicPage.blurb && (
                        <p className="text-sm text-gray-300 border-t border-lattice-border pt-2">
                          {publicPage.blurb}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function Stat({ label, value, accent = 'white' }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className={cn(ds.panel, 'py-2')}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn('text-lg font-bold', `text-${accent}`)}>{value}</p>
    </div>
  );
}

function FloorTable({
  table, onMove,
}: {
  table: SeatTable;
  onMove: (id: string, x: number, y: number) => void;
}) {
  const [drag, setDrag] = useState(false);
  const filled = table.seats.length;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Table ${table.label}`}
      onMouseDown={() => setDrag(true)}
      onMouseUp={() => setDrag(false)}
      onMouseLeave={() => setDrag(false)}
      onMouseMove={(e) => {
        if (!drag) return;
        const parent = (e.currentTarget.parentElement as HTMLElement);
        const rect = parent.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width - 64, e.clientX - rect.left - 32));
        const y = Math.max(0, Math.min(rect.height - 64, e.clientY - rect.top - 32));
        onMove(table.id, Math.round(x), Math.round(y));
      }}
      className={cn(
        'absolute w-16 h-16 flex flex-col items-center justify-center text-center cursor-move select-none',
        'border-2 transition-colors',
        table.shape === 'round' ? 'rounded-full' : table.shape === 'square' ? 'rounded-md' : 'rounded-sm',
        filled >= table.capacity
          ? 'border-red-400/60 bg-red-400/10'
          : 'border-neon-cyan/50 bg-neon-cyan/10'
      )}
      style={{ left: table.x, top: table.y }}
    >
      <span className="text-[10px] font-semibold text-white truncate w-full px-1">{table.label}</span>
      <span className="text-[10px] text-gray-400">{filled}/{table.capacity}</span>
    </div>
  );
}

function SeatTableCard({
  table, guests, onAssign, onUnseat, onDelete,
}: {
  table: SeatTable;
  guests: string[];
  onAssign: (tableId: string, guestName: string) => void;
  onUnseat: (guestName: string) => void;
  onDelete: (tableId: string) => void;
}) {
  const [guestPick, setGuestPick] = useState('');
  const seatedNames = new Set(table.seats.map((s) => s.guestName));
  const free = guests.filter((g) => !seatedNames.has(g));
  return (
    <div className={ds.panel}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <Armchair className="w-4 h-4 text-neon-cyan" /> {table.label}
        </h4>
        <button onClick={() => onDelete(table.id)}
          className={cn(ds.btnGhost, 'hover:text-red-400')} aria-label="Delete table">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-2">
        {table.shape} · {table.seats.length}/{table.capacity} seated
      </p>
      <div className="flex flex-wrap gap-1 mb-2">
        {table.seats.map((s) => (
          <button key={s.guestName} onClick={() => onUnseat(s.guestName)}
            className="text-xs px-2 py-1 rounded-full bg-lattice-elevated text-gray-300 hover:text-red-400">
            {s.guestName} <X className="w-3 h-3 inline" />
          </button>
        ))}
        {table.seats.length === 0 && <span className="text-xs text-gray-600">No guests seated</span>}
      </div>
      {table.seats.length < table.capacity && (
        <div className="flex gap-2">
          <select className={cn(ds.select, 'text-xs')} value={guestPick}
            onChange={(e) => setGuestPick(e.target.value)}>
            <option value="">Assign guest...</option>
            {free.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <button onClick={() => { if (guestPick) { onAssign(table.id, guestPick); setGuestPick(''); } }}
            className={cn(ds.btnSecondary, 'text-xs')} disabled={!guestPick}>
            Seat
          </button>
        </div>
      )}
    </div>
  );
}
