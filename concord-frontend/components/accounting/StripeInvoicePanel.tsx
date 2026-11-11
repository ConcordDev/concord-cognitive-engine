'use client';

/**
 * StripeInvoicePanel — bespoke Stripe-backed invoice management for the
 * accounting lens. Backed by:
 *   accounting.invoice-list                 — list invoices
 *   accounting.invoice-create               — author a new invoice
 *   accounting.invoice-create-payment-link  — finalize via Stripe, return
 *                                             hosted invoice URL + PDF URL
 *   accounting.invoice-mark-paid            — manual mark-paid for non-
 *                                             Stripe payments
 *
 * An invoicing surface.
 *   • Status badge system (Draft / Open / Paid / Overdue) with sub-badges (Past due if dueAt < today)
 *   • Three-tab grouping (Draft / Unpaid / All)
 *   • Single-page invoice composer with customer + total + Send-via-
 *     Stripe split-button
 *   • Save-as-DTU on the Stripe hosted invoice URL so a sent invoice
 *     becomes a citable creator-economy artifact
 */

import { useState, useEffect, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Receipt, Loader2, Plus, ExternalLink, FileDown, Send, CheckCircle2,
  AlertCircle, Wallet,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { calendarDateKey } from '@/lib/calendar-date';
import { Skeleton } from '@/components/ui';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface LocalInvoice {
  id: string;
  number: string;
  customerId?: string | null;
  customerName: string;
  customerEmail?: string;
  total: number;
  status: 'draft' | 'open' | 'paid' | 'void' | 'credited' | 'voided';
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  stripeHostedInvoiceUrl?: string;
  stripeInvoicePdfUrl?: string;
  stripeInvoiceId?: string;
  stripeCustomerId?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('accounting', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type FilterTab = 'draft' | 'unpaid' | 'all';

export function StripeInvoicePanel() {
  const [filter, setFilter] = useState<FilterTab>('unpaid');
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [composer, setComposer] = useState(false);
  const [composerData, setComposerData] = useState({ customerName: '', customerEmail: '', total: '' });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const listMutation = useMutation({
    mutationFn: async () => callMacro<{ invoices: LocalInvoice[] }>('invoice-list', { status: 'all' }),
    onSuccess: (env) => {
      if (env.ok && env.result) setInvoices(env.result.invoices);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { customerName: string; total: number }) =>
      callMacro<{ invoice: LocalInvoice }>('invoice-create', { ...data }),
    onSuccess: (env) => {
      if (env.ok && env.result) {
        setInvoices((prev) => [env.result!.invoice, ...prev]);
        setComposer(false);
        setComposerData({ customerName: '', customerEmail: '', total: '' });
        setErrorMsg(null);
      } else {
        setErrorMsg(env.error || 'Create failed');
      }
    },
  });

  const stripeMutation = useMutation({
    mutationFn: async ({ id, email }: { id: string; email: string }) =>
      callMacro<{ invoice: LocalInvoice }>('invoice-create-payment-link', { id, customerEmail: email }),
    onSuccess: (env, { id }) => {
      if (env.ok && env.result) {
        setInvoices((prev) => prev.map((i) => i.id === id ? env.result!.invoice : i));
        setErrorMsg(null);
      } else {
        setErrorMsg(env.error || 'Stripe call failed');
      }
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => callMacro<{ invoice: LocalInvoice }>('invoice-mark-paid', { id }),
    onSuccess: (env, { id }) => {
      if (env.ok && env.result) setInvoices((prev) => prev.map((i) => i.id === id ? env.result!.invoice : i));
      else setErrorMsg(env.error || 'Could not mark that invoice paid.');
    },
  });

  const voidMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => callMacro<{ invoice: LocalInvoice }>('invoice-void', { id }),
    onSuccess: (env, { id }) => {
      if (env.ok && env.result) {
        setInvoices((prev) => prev.map((i) => i.id === id ? env.result!.invoice : i));
        setErrorMsg(null);
      } else setErrorMsg(env.error || 'Could not void that invoice.');
    },
  });

  const creditMutation = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: number }) =>
      callMacro<{ invoice: LocalInvoice }>('invoice-credit-note', { id, amount }),
    onSuccess: (env, { id }) => {
      if (env.ok && env.result) {
        setInvoices((prev) => prev.map((i) => i.id === id ? env.result!.invoice : i));
        setErrorMsg(null);
      } else setErrorMsg(env.error || 'Could not issue that credit note.');
    },
  });

  useEffect(() => {
    listMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stable
  }, []);

  const grouped = useMemo(() => {
    const drafts = invoices.filter((i) => i.status === 'draft');
    const unpaid = invoices.filter((i) => i.status === 'open');
    return {
      draft: drafts,
      unpaid: unpaid,
      all: invoices,
    };
  }, [invoices]);

  const visible = grouped[filter];

  const submitComposer = (e: React.FormEvent) => {
    e.preventDefault();
    const total = Number(composerData.total);
    if (!composerData.customerName.trim() || !Number.isFinite(total) || total <= 0) return;
    createMutation.mutate({ customerName: composerData.customerName.trim(), total });
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Invoices & Payments</h2>
          <span className="rounded bg-lattice-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-400">
            stripe live
          </span>
        </div>
        <button
          type="button"
          onClick={() => setComposer((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
        >
          <Plus className="h-3.5 w-3.5" />
          New invoice
        </button>
      </header>

      <AnimatePresence>
        {composer && (
          <motion.form
            onSubmit={submitComposer}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 gap-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3 sm:grid-cols-12">
              <input
                type="text"
                placeholder="Customer name"
                value={composerData.customerName}
                onChange={(e) => setComposerData({ ...composerData, customerName: e.target.value })}
                className="rounded-md border border-lattice-border bg-lattice-void px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-cyan-500/40 focus:outline-none sm:col-span-5"
              />
              <input
                type="email"
                placeholder="customer@example.com"
                value={composerData.customerEmail}
                onChange={(e) => setComposerData({ ...composerData, customerEmail: e.target.value })}
                className="rounded-md border border-lattice-border bg-lattice-void px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-cyan-500/40 focus:outline-none sm:col-span-4"
              />
              <input
                type="number"
                step="0.01"
                placeholder="Total $"
                value={composerData.total}
                onChange={(e) => setComposerData({ ...composerData, total: e.target.value })}
                className="rounded-md border border-lattice-border bg-lattice-void px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-cyan-500/40 focus:outline-none sm:col-span-2"
              />
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="inline-flex items-center justify-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-xs text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50 sm:col-span-1"
              >
                {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-200">×</button>
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-lattice-border">
        {([
          { id: 'draft' as const, label: 'Draft', count: grouped.draft.length },
          { id: 'unpaid' as const, label: 'Unpaid', count: grouped.unpaid.length },
          { id: 'all' as const, label: 'All', count: grouped.all.length },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === t.id ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
            <span className="rounded-full bg-lattice-elevated px-1.5 font-mono text-[10px] text-gray-400">{t.count}</span>
          </button>
        ))}
      </div>

      {listMutation.isPending && invoices.length === 0 && (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-md border border-lattice-border bg-lattice-surface/40 p-3">
              <Skeleton variant="line" lines={2} />
            </div>
          ))}
        </div>
      )}

      {!listMutation.isPending && visible.length === 0 && (
        <div className="rounded-md border border-dashed border-lattice-border bg-lattice-surface/40 px-3 py-6 text-center text-xs text-gray-400">
          No {filter} invoices yet — create one above and finalize via Stripe.
        </div>
      )}

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {visible.map((inv) => (
            <InvoiceRow
              key={inv.id}
              invoice={inv}
              onStripeSend={(email) => stripeMutation.mutate({ id: inv.id, email })}
              onMarkPaid={() => markPaidMutation.mutate({ id: inv.id })}
              onVoid={() => voidMutation.mutate({ id: inv.id })}
              onCredit={() => creditMutation.mutate({ id: inv.id, amount: inv.total })}
              isPending={stripeMutation.isPending || voidMutation.isPending || creditMutation.isPending}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function InvoiceRow({ invoice, onStripeSend, onMarkPaid, onVoid, onCredit, isPending }: {
  invoice: LocalInvoice;
  onStripeSend: (email: string) => void;
  onMarkPaid: () => void;
  onVoid: () => void;
  onCredit: () => void;
  isPending: boolean;
}) {
  const [emailInput, setEmailInput] = useState(invoice.customerEmail || '');
  const [confirm, setConfirm] = useState<'void' | 'credit' | null>(null);
  const isOverdue = invoice.status === 'open' && invoice.dueAt && invoice.dueAt < calendarDateKey();
  const closed = invoice.status === 'void' || invoice.status === 'credited' || invoice.status === 'voided';
  const hasStripe = !!invoice.stripeHostedInvoiceUrl;

  const statusClass =
    invoice.status === 'paid' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
    invoice.status === 'credited' ? 'bg-amber-500/15 text-amber-200 border-amber-500/30' :
    invoice.status === 'void' || invoice.status === 'voided' ? 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' :
    isOverdue ? 'bg-red-500/15 text-red-300 border-red-500/30' :
    invoice.status === 'open' ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' :
    'bg-lattice-elevated text-gray-400 border-lattice-border';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="rounded-md border border-lattice-border bg-lattice-surface/40 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-xs font-bold text-cyan-300">{invoice.number}</span>
            <span className="text-sm text-white">{invoice.customerName}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusClass}`}>
              {invoice.status}
            </span>
            {isOverdue && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-red-300">
                · past due
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-gray-400">
            <span>Issued {invoice.issuedAt}</span>
            <span>Due {invoice.dueAt}</span>
            {invoice.paidAt && <span className="text-emerald-400">Paid {invoice.paidAt}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono tabular-nums text-base font-semibold text-white">${invoice.total.toFixed(2)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!hasStripe && invoice.status === 'open' && (
          <>
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="customer email"
              className="rounded-md border border-lattice-border bg-lattice-void px-2 py-1 text-[11px] text-white placeholder-gray-600 focus:border-cyan-500/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onStripeSend(emailInput)}
              disabled={!emailInput.trim() || isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send via Stripe
            </button>
          </>
        )}
        {hasStripe && (
          <>
            <a
              href={invoice.stripeHostedInvoiceUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
            >
              <ExternalLink className="h-3 w-3" />
              Hosted Pay Page
            </a>
            {invoice.stripeInvoicePdfUrl && (
              <a
                href={invoice.stripeInvoicePdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-lattice-border px-2.5 py-1 text-[11px] text-gray-400 transition-colors hover:bg-lattice-elevated hover:text-gray-200"
              >
                <FileDown className="h-3 w-3" />
                PDF
              </a>
            )}
            <SaveAsDtuButton
              compact
              apiSource="stripe-invoice"
              apiUrl={invoice.stripeHostedInvoiceUrl}
              title={`${invoice.number} — ${invoice.customerName} (Stripe)`}
              content={[
                `Invoice: ${invoice.number}`,
                `Customer: ${invoice.customerName}${invoice.customerEmail ? ` <${invoice.customerEmail}>` : ''}`,
                `Total: $${invoice.total.toFixed(2)}`,
                `Status: ${invoice.status}`,
                `Issued: ${invoice.issuedAt}`,
                `Due: ${invoice.dueAt}`,
                invoice.paidAt ? `Paid: ${invoice.paidAt}` : '',
                '',
                `Stripe hosted URL: ${invoice.stripeHostedInvoiceUrl}`,
                invoice.stripeInvoicePdfUrl ? `Stripe PDF: ${invoice.stripeInvoicePdfUrl}` : '',
                invoice.stripeInvoiceId ? `Stripe invoice ID: ${invoice.stripeInvoiceId}` : '',
              ].filter(Boolean).join('\n')}
              extraTags={['accounting', 'invoice', 'stripe', invoice.status]}
              rawData={invoice}
            />
          </>
        )}
        {invoice.status === 'open' && (
          confirm === 'void' ? (
            <>
              <button type="button" onClick={onVoid} disabled={isPending} className="ml-auto min-h-11 rounded-md bg-rose-500/20 px-2.5 text-[11px] text-rose-200">Confirm void</button>
              <button type="button" onClick={() => setConfirm(null)} className="min-h-11 rounded-md px-2 text-[11px] text-gray-400">Cancel</button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onMarkPaid}
                className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md border border-lattice-border px-2.5 text-[11px] text-gray-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
              >
                <CheckCircle2 className="h-3 w-3" />
                Mark paid
              </button>
              <button type="button" onClick={() => setConfirm('void')} className="inline-flex min-h-11 items-center rounded-md border border-rose-500/30 px-2.5 text-[11px] text-rose-200">Void</button>
            </>
          )
        )}
        {invoice.status === 'paid' && (
          confirm === 'credit' ? (
            <>
              <button type="button" onClick={onCredit} disabled={isPending} className="ml-auto min-h-11 rounded-md bg-amber-400/20 px-2.5 text-[11px] text-amber-100">Confirm credit note</button>
              <button type="button" onClick={() => setConfirm(null)} className="min-h-11 rounded-md px-2 text-[11px] text-gray-400">Cancel</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirm('credit')} className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-md border border-amber-500/30 px-2.5 text-[11px] text-amber-100">
              <Wallet className="h-3 w-3" /> Credit note
            </button>
          )
        )}
        {closed && (
          <span className="ml-auto text-[11px] text-zinc-400">{invoice.status}</span>
        )}
      </div>
    </motion.div>
  );
}
