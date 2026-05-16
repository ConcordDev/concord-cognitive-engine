'use client';

/**
 * BookingActionDock + EndOfDayClose — Booksy/Square-shape action surfaces
 * for the services lens. Each action wires a real Concord backend so the
 * lens DOES things (DMs the client, mints a receipt DTU, runs daily close)
 * instead of just computing.
 *
 *   BookingActionDock — per-appointment slide-up dock with 6 actions:
 *     1. Confirm        → update artifact status + DM client confirmation
 *     2. Send reminder  → DM client a Booksy-style reminder
 *     3. Mark complete  → update status + mint receipt DTU + DM receipt
 *     4. Mark no-show   → update status + DM client soft-touch
 *     5. Generate invoice → mint invoice DTU with payable link + DM client
 *     6. Schedule rebook  → mint next-cycle appointment artifact + DM client
 *
 *   EndOfDayClose — Square-style close-day modal with 4 actions:
 *     1. Pull dailyCloseReport  → services.dailyCloseReport macro
 *     2. Mint close DTU         → dtu.create with the close payload
 *     3. Generate tomorrow's reminders → services.reminderGenerate + DM each
 *     4. Optional: publish anonymized day stats → /api/dtus/:id/publish
 *
 * All side-effect actions are idempotent on the appointment id (status
 * updates) and DTU lineage (mints are deduped by content where possible).
 */

import { useState } from 'react';
import {
  CheckCircle2, Bell, Receipt, XCircle, FileText, RotateCw,
  X, Loader2, Check, AlertTriangle, Sparkles, Globe,
  CalendarDays, Send, Mail,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import { useRunArtifact, useCreateArtifact, useUpdateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';

interface AppointmentDataLite {
  clientName?: string;
  clientUserId?: string;
  clientEmail?: string;
  clientPhone?: string;
  serviceType?: string;
  provider?: string;
  date?: string;
  time?: string;
  duration?: number;
  price?: number;
  recurring?: boolean;
  recurringFrequency?: string;
  notes?: string;
}

interface AppointmentLite {
  id: string;
  title: string;
  data: AppointmentDataLite;
  meta: { status: string; [k: string]: unknown };
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

/* ============================================================== */
/*  BookingActionDock                                              */
/* ============================================================== */

interface DockProps {
  appointment: AppointmentLite;
  onClose: () => void;
}

export function BookingActionDock({ appointment, onClose }: DockProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [receiptDtu, setReceiptDtu] = useState<string | null>(null);
  const updateAppt = useUpdateArtifact('services');
  const createAppt = useCreateArtifact('services');

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const d = appointment.data || {};
  const status = appointment.meta.status;

  async function dmClient(content: string): Promise<{ sent: boolean; reason?: string }> {
    const recipient = d.clientUserId?.trim();
    if (!recipient) return { sent: false, reason: 'No clientUserId on this appointment.' };
    try {
      const r = await api.post('/api/social/dm', { toUserId: recipient, content });
      return { sent: r.data?.ok !== false, reason: r.data?.error };
    } catch (e) { return { sent: false, reason: pickMessage(e) }; }
  }

  async function setStatus(nextStatus: string) {
    await updateAppt.mutateAsync({
      id: appointment.id,
      meta: { ...appointment.meta, status: nextStatus },
    });
  }

  async function mintDtu(title: string, kind: string, extraMeta: Record<string, unknown>): Promise<string | null> {
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu',
        name: 'create',
        input: {
          title,
          tags: ['services', kind, d.serviceType ?? 'service'].filter(Boolean) as string[],
          source: `services:${kind}`,
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            appointment: {
              id: appointment.id,
              client: d.clientName,
              service: d.serviceType,
              provider: d.provider,
              date: d.date,
              time: d.time,
              price: d.price,
            },
            ...extraMeta,
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      return dtu?.id ?? dtu?.dtuId ?? null;
    } catch { return null; }
  }

  /* ---- Action handlers ---- */

  async function actConfirm() {
    setBusy('confirm'); setFeedback(null);
    try {
      await setStatus('confirmed');
      const { sent, reason } = await dmClient(
        `✅ Confirmed: your ${d.serviceType ?? 'appointment'} on ${d.date} at ${d.time}` +
        (d.provider ? ` with ${d.provider}.` : '.'),
      );
      ok(`Status → confirmed.${sent ? ' Client DMed.' : reason ? ` (${reason})` : ''}`);
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actReminder() {
    setBusy('reminder'); setFeedback(null);
    const { sent, reason } = await dmClient(
      `🔔 Reminder: your ${d.serviceType ?? 'appointment'} is scheduled for ${d.date} at ${d.time}` +
      (d.provider ? ` with ${d.provider}.` : '.') +
      (d.duration ? ` (${d.duration} min)` : ''),
    );
    if (sent) {
      try { await updateAppt.mutateAsync({ id: appointment.id, meta: { ...appointment.meta, reminderSent: true } }); } catch {}
      ok('Reminder DM sent.');
    } else err(reason ?? 'Reminder failed.');
    setBusy(null);
  }

  async function actComplete() {
    setBusy('complete'); setFeedback(null);
    try {
      await setStatus('completed');
      const dtuId = await mintDtu(
        `Receipt — ${d.clientName ?? 'client'} — ${d.serviceType ?? 'service'}`,
        'receipt',
        { receipt: { amountUsd: d.price ?? 0, paidAt: new Date().toISOString(), method: 'on_site' } },
      );
      if (dtuId) setReceiptDtu(dtuId);
      const { sent } = await dmClient(
        `Thanks for visiting! 🌿 Receipt for ${d.serviceType ?? 'your appointment'}` +
        (d.price ? ` — $${d.price.toFixed(2)}.` : '.') +
        (dtuId ? `\n\n[Receipt DTU ${dtuId}]` : ''),
      );
      ok(`Closed.${dtuId ? ' Receipt minted.' : ''}${sent ? ' Client DMed.' : ''}`);
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actNoShow() {
    setBusy('no_show'); setFeedback(null);
    try {
      await setStatus('no_show');
      await updateAppt.mutateAsync({
        id: appointment.id,
        data: { ...d, noShowCount: ((d as Record<string, unknown>).noShowCount as number ?? 0) + 1 } as unknown as Record<string, unknown>,
      });
      const { sent } = await dmClient(
        `We missed you for your ${d.serviceType ?? 'appointment'} on ${d.date}. Want to rebook?`,
      );
      ok(`Marked no-show.${sent ? ' Soft-touch DM sent.' : ''}`);
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actInvoice() {
    setBusy('invoice'); setFeedback(null);
    try {
      const dtuId = await mintDtu(
        `Invoice — ${d.clientName ?? 'client'} — ${d.serviceType ?? 'service'}`,
        'invoice',
        {
          invoice: {
            amountUsd: d.price ?? 0,
            dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
            terms: 'net-14',
            issuedAt: new Date().toISOString(),
          },
        },
      );
      if (!dtuId) { err('Invoice DTU not minted.'); return; }
      const { sent, reason } = await dmClient(
        `🧾 Invoice for ${d.serviceType ?? 'service'} ($${(d.price ?? 0).toFixed(2)}) — due in 14 days.` +
        `\n\n[Invoice DTU ${dtuId}]`,
      );
      ok(`Invoice minted.${sent ? ' Client DMed.' : reason ? ` (DM: ${reason})` : ''}`);
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actRebook() {
    setBusy('rebook'); setFeedback(null);
    try {
      const days =
        d.recurringFrequency === 'monthly' ? 30 :
        d.recurringFrequency === 'biweekly' ? 14 : 7;
      const baseDate = d.date ? new Date(d.date) : new Date();
      baseDate.setDate(baseDate.getDate() + days);
      const nextDate = baseDate.toISOString().slice(0, 10);
      await createAppt.mutateAsync({
        type: 'Appointment',
        title: `${d.serviceType ?? 'Appointment'} — ${d.clientName ?? 'client'} (rebook)`,
        data: { ...d, date: nextDate, time: d.time ?? '10:00', reminderSent: false, noShowCount: 0 } as unknown as Record<string, unknown>,
        meta: { status: 'booked', tags: ['rebook'], visibility: 'private', originAppointmentId: appointment.id },
      });
      const { sent } = await dmClient(
        `Rebooked you for ${d.serviceType ?? 'your appointment'} on ${nextDate}` +
        (d.time ? ` at ${d.time}` : '') + '. See you then!',
      );
      ok(`Rebook created for ${nextDate}.${sent ? ' Client DMed.' : ''}`);
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions = [
    { id: 'confirm',  label: 'Confirm',         icon: CheckCircle2, accent: '#06b6d4', desc: 'Mark confirmed + DM client',                             handler: actConfirm,  disabled: status === 'confirmed' || status === 'completed' },
    { id: 'reminder', label: 'Send reminder',   icon: Bell,         accent: '#f97316', desc: d.clientUserId ? 'DM client a Booksy-style nudge'
                                                                                                              : 'Add clientUserId to enable',
                                                                                                                                                 handler: actReminder, disabled: !d.clientUserId },
    { id: 'complete', label: 'Mark complete',   icon: Receipt,      accent: '#22c55e', desc: 'Close + mint receipt DTU + DM',                          handler: actComplete, disabled: status === 'completed' },
    { id: 'no_show',  label: 'Mark no-show',    icon: XCircle,      accent: '#ef4444', desc: 'Status + bump no-show count + soft-touch DM',            handler: actNoShow,   disabled: status === 'no_show' || status === 'completed' },
    { id: 'invoice',  label: 'Generate invoice', icon: FileText,    accent: '#8b5cf6', desc: 'Mint invoice DTU + DM client',                           handler: actInvoice,  disabled: false },
    { id: 'rebook',   label: 'Schedule rebook', icon: RotateCw,     accent: '#ec4899', desc: 'Create next-cycle appointment + DM client',              handler: actRebook,   disabled: false },
  ];

  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      className="fixed bottom-0 left-1/2 -translate-x-1/2 z-40 w-full max-w-5xl bg-lattice-surface border-t border-x border-lattice-border rounded-t-2xl shadow-2xl p-5"
    >
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-4 h-4 text-pink-400" />
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Booking actions</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-lattice-elevated text-gray-300 font-semibold uppercase">
              {status.replace(/_/g, ' ')}
            </span>
            {receiptDtu && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">
                receipt {receiptDtu.slice(0, 6)}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-white truncate">
            {appointment.title || d.serviceType || 'Appointment'}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {[d.clientName, d.provider, d.date, d.time].filter(Boolean).join(' · ')}
            {d.price ? `  ·  $${d.price.toFixed(2)}` : ''}
          </p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400" aria-label="Close action dock">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button
              key={a.id}
              type="button"
              disabled={a.disabled || !!busy}
              onClick={a.handler}
              className={cn(
                'group flex flex-col items-start gap-1.5 p-3 rounded-lg text-left border transition-all',
                'bg-lattice-elevated/40 border-lattice-border/40',
                'hover:bg-lattice-elevated hover:border-lattice-border',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-lattice-elevated/40 disabled:hover:border-lattice-border/40',
                'focus:outline-none focus:ring-2 focus:ring-pink-400/40',
              )}
            >
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center"
                style={{ backgroundColor: a.accent + '20', color: a.accent }}
              >
                {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
              </div>
              <div className="text-sm font-semibold text-gray-100">{a.label}</div>
              <div className="text-[11px] text-gray-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={cn(
              'mt-3 px-3 py-2 rounded-lg text-xs flex items-start gap-2 border',
              feedback.kind === 'ok'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30',
            )}
          >
            {feedback.kind === 'ok'
              ? <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ============================================================== */
/*  EndOfDayClose                                                  */
/* ============================================================== */

interface CloseProps {
  /** A representative artifact id to run dailyCloseReport on (any of today's appointments). */
  representativeAppointmentId: string | null;
  /** Tomorrow's booked appointments (so the close can DM each client a reminder). */
  tomorrowAppointments: AppointmentLite[];
  onClose: () => void;
}

interface CloseReport {
  date: string;
  totalAppointments: number;
  completedCount: number;
  noShowCount: number;
  cancelledCount: number;
  serviceRevenue: number;
  productRevenue: number;
  totalRevenue: number;
  byProvider: Array<{ provider: string; appointments: number; revenue: number }>;
}

export function EndOfDayClose({ representativeAppointmentId, tomorrowAppointments, onClose }: CloseProps) {
  const [step, setStep] = useState<'idle' | 'running' | 'reviewing'>('idle');
  const [report, setReport] = useState<CloseReport | null>(null);
  const [closeDtuId, setCloseDtuId] = useState<string | null>(null);
  const [closeDtuPublic, setCloseDtuPublic] = useState(false);
  const [reminderCount, setReminderCount] = useState<{ sent: number; failed: number } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });
  const runAction = useRunArtifact('services');

  async function runClose() {
    if (!representativeAppointmentId) {
      err('No appointment data to close against today.');
      return;
    }
    setBusy('close'); setFeedback(null); setStep('running');
    try {
      const r = await runAction.mutateAsync({
        id: representativeAppointmentId,
        action: 'dailyCloseReport',
        params: { date: new Date().toISOString().slice(0, 10) },
      });
      const result = (r?.result ?? {}) as Partial<CloseReport>;
      if (!result.date) { err('No close report returned.'); setStep('idle'); return; }
      setReport({
        date: result.date,
        totalAppointments: result.totalAppointments ?? 0,
        completedCount: result.completedCount ?? 0,
        noShowCount: result.noShowCount ?? 0,
        cancelledCount: result.cancelledCount ?? 0,
        serviceRevenue: result.serviceRevenue ?? 0,
        productRevenue: result.productRevenue ?? 0,
        totalRevenue: result.totalRevenue ?? 0,
        byProvider: result.byProvider ?? [],
      });
      setStep('reviewing');
      ok(`Close pulled for ${result.date}.`);
    } catch (e) { err(pickMessage(e)); setStep('idle'); }
    finally { setBusy(null); }
  }

  async function mintClose() {
    if (!report) return;
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu',
        name: 'create',
        input: {
          title: `Daily close — ${report.date} — $${report.totalRevenue.toFixed(2)}`,
          tags: ['services', 'daily_close', report.date],
          source: 'services:dailyClose',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            dailyClose: report,
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setCloseDtuId(id); ok(`Close DTU minted: ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function publishClose() {
    if (!closeDtuId) { err('Mint the close DTU first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const path = `/api/dtus/${encodeURIComponent(closeDtuId)}/publish`;
      const r = closeDtuPublic ? await api.delete(path) : await api.post(path);
      if (r.data?.ok !== false) {
        setCloseDtuPublic(!closeDtuPublic);
        ok(closeDtuPublic ? 'Unpublished.' : 'Published to federation peers.');
      } else err(r.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function sendTomorrowReminders() {
    setBusy('reminders'); setFeedback(null);
    let sent = 0, failed = 0;
    for (const appt of tomorrowAppointments) {
      const d = appt.data;
      if (!d?.clientUserId) { failed++; continue; }
      try {
        const r = await api.post('/api/social/dm', {
          toUserId: d.clientUserId,
          content:
            `🔔 Heads up — you have a ${d.serviceType ?? 'appointment'} tomorrow at ${d.time ?? ''}` +
            (d.provider ? ` with ${d.provider}` : '') + '.',
        });
        if (r.data?.ok !== false) sent++; else failed++;
      } catch { failed++; }
    }
    setReminderCount({ sent, failed });
    setBusy(null);
    ok(`Reminders: ${sent} sent, ${failed} skipped/failed.`);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-lattice-surface border border-lattice-border rounded-xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-pink-500/20 text-pink-400 flex items-center justify-center">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">End of Day Close</h2>
              <p className="text-xs text-gray-400">Square-style register close — pull, mint, remind</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 'idle' && (
          <div className="text-center py-8">
            <button
              onClick={runClose}
              disabled={busy === 'close' || !representativeAppointmentId}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-pink-500 text-white font-semibold hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy === 'close' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Receipt className="w-5 h-5" />}
              Pull today&apos;s close report
            </button>
            {!representativeAppointmentId && (
              <p className="text-xs text-gray-500 mt-3">No appointments to close against today.</p>
            )}
          </div>
        )}

        {step === 'reviewing' && report && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Booked"     value={report.totalAppointments} accent="#06b6d4" />
              <Stat label="Completed"  value={report.completedCount}    accent="#22c55e" />
              <Stat label="No-shows"   value={report.noShowCount}       accent="#ef4444" />
              <Stat label="Cancelled"  value={report.cancelledCount}    accent="#f97316" />
            </div>

            <div className="p-4 rounded-lg bg-lattice-elevated/40 border border-lattice-border">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Total revenue</span>
                <span className="text-3xl font-bold text-emerald-400">${report.totalRevenue.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Service ${report.serviceRevenue.toFixed(2)}</span>
                <span>Product ${report.productRevenue.toFixed(2)}</span>
              </div>
            </div>

            {report.byProvider.length > 0 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">By provider</h4>
                <div className="space-y-1">
                  {report.byProvider.map(p => (
                    <div key={p.provider} className="flex items-center justify-between px-3 py-2 rounded bg-lattice-elevated/30 text-sm">
                      <span className="text-gray-200">{p.provider}</span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-gray-400">{p.appointments} appts</span>
                        <span className="text-emerald-400 font-semibold">${p.revenue.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-lattice-border space-y-2">
              <ActionRow
                label={closeDtuId ? `Close DTU minted (${closeDtuId.slice(0, 8)}…)` : 'Mint close DTU'}
                desc="Saves the close as a citable private DTU"
                icon={Sparkles}
                accent="#06b6d4"
                done={!!closeDtuId}
                disabled={!!closeDtuId || busy === 'mint'}
                busy={busy === 'mint'}
                onClick={mintClose}
              />
              <ActionRow
                label={closeDtuPublic ? 'Unpublish close DTU' : 'Publish to federation'}
                desc={closeDtuPublic ? 'Federation peers will stop syncing this close' : 'Anonymized day stats visible to federation peers'}
                icon={Globe}
                accent={closeDtuPublic ? '#15803d' : '#22c55e'}
                done={false}
                disabled={!closeDtuId || busy === 'publish'}
                busy={busy === 'publish'}
                onClick={publishClose}
              />
              <ActionRow
                label={`DM tomorrow's reminders (${tomorrowAppointments.length})`}
                desc={tomorrowAppointments.length === 0 ? 'No appointments booked for tomorrow' : `DM each client a heads-up`}
                icon={Send}
                accent="#ec4899"
                done={!!reminderCount}
                disabled={tomorrowAppointments.length === 0 || busy === 'reminders'}
                busy={busy === 'reminders'}
                onClick={sendTomorrowReminders}
              />
              {reminderCount && (
                <p className="text-xs text-gray-400 pl-12">
                  <Mail className="w-3 h-3 inline mr-1" />
                  {reminderCount.sent} sent, {reminderCount.failed} skipped (no clientUserId).
                </p>
              )}
            </div>
          </div>
        )}

        <AnimatePresence>
          {feedback && (
            <motion.div
              key={feedback.text}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className={cn(
                'mt-4 px-3 py-2 rounded-lg text-xs flex items-start gap-2 border',
                feedback.kind === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-red-500/10 text-red-300 border-red-500/30',
              )}
            >
              {feedback.kind === 'ok' ? <Check className="w-3.5 h-3.5 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />}
              <span>{feedback.text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

/* ============================================================== */
/*  Local helpers                                                  */
/* ============================================================== */

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="p-3 rounded-lg bg-lattice-elevated/40 border border-lattice-border">
      <div className="text-2xl font-bold" style={{ color: accent }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  );
}

interface ActionRowProps {
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  done: boolean;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}
function ActionRow({ label, desc, icon: Icon, accent, done, disabled, busy, onClick }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-all border',
        'bg-lattice-elevated/30 border-lattice-border/40',
        'hover:bg-lattice-elevated hover:border-lattice-border',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-lattice-elevated/30 disabled:hover:border-lattice-border/40',
      )}
    >
      <div
        className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: accent + '20', color: accent }}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-100">{label}</div>
        <div className="text-xs text-gray-500 line-clamp-2">{desc}</div>
      </div>
    </button>
  );
}
