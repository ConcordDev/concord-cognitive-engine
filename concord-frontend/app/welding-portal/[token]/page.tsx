'use client';

/**
 * Welding client portal — /welding-portal/[token]
 *
 * Closes the gap documented in `docs/lens-specs/welding-capability-map.md`
 * ("Investigated and honestly deferred" — `welding.portal-view` /
 * `portal-approve` / `portal-pay`): a welder sends a customer with NO
 * Concord account a link containing a `portalToken` (minted by
 * `estimate-send` / `invoice-from-job` in `server/domains/welding.js`) so
 * they can view/approve an estimate or view an invoice without ever
 * signing up. This page is that link's destination.
 *
 * Genuinely public — unlike `/share/animation/[token]` (which still
 * requires a Concord login because the animation domain isn't on the
 * server's public-read allowlist), this page talks to a dedicated public
 * route (`GET/POST /api/welding/portal/:token*` in server.js) that bypasses
 * auth entirely and is scoped server-side to exactly the one estimate or
 * invoice the token was minted for. No `lensRun`, no cookie, no sign-in
 * fallback needed. `middleware.ts` and `AppShell.tsx` were both updated so
 * an anonymous visitor isn't redirected to /login or shown app chrome
 * before reaching this page.
 *
 * Payment is intentionally honest-not-wired: `welding.portal-pay` only
 * records a self-reported amount with no real card/ACH charge behind it,
 * so the public /pay route returns an explicit "not yet available"
 * response instead of ever claiming a payment succeeded. This page surfaces
 * that real backend response verbatim rather than hard-coding a message
 * client-side.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  Receipt,
  Flame,
} from 'lucide-react';

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  kind: string;
}

interface Estimate {
  id: string;
  title: string;
  client: string;
  address: string;
  lineItems: LineItem[];
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  status: string;
  createdAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
}

interface Payment {
  id: string;
  amount: number;
  method: string;
  reference: string;
  recordedAt: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  client: string;
  title: string;
  lineItems: LineItem[];
  subtotal: number;
  tax: number;
  amount: number;
  amountPaid: number;
  balance: number;
  status: string;
  issuedDate: string;
  dueDate: string;
  payments: Payment[];
}

type PortalView =
  | { kind: 'estimate'; estimate: Estimate; canApprove: boolean }
  | { kind: 'invoice'; invoice: Invoice; canPay: boolean };

const money = (n: number | undefined | null) => `$${(Number(n) || 0).toFixed(2)}`;

function LineItemsTable({ items }: { items: LineItem[] }) {
  if (!items?.length) return <p className="text-sm text-zinc-500">No line items.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-zinc-500 border-b border-zinc-800">
          <th className="py-2 font-medium">Description</th>
          <th className="py-2 font-medium text-right">Qty</th>
          <th className="py-2 font-medium text-right">Unit</th>
          <th className="py-2 font-medium text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {items.map((li, i) => (
          <tr key={i} className="border-b border-zinc-900">
            <td className="py-2 text-zinc-200">{li.description}</td>
            <td className="py-2 text-right text-zinc-400">{li.quantity}</td>
            <td className="py-2 text-right text-zinc-400">{money(li.unitPrice)}</td>
            <td className="py-2 text-right text-zinc-200">{money(li.quantity * li.unitPrice)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    draft: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    sent: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    accepted: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    rejected: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
    unpaid: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    partial: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    paid: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${tone[status] || 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
      {status}
    </span>
  );
}

export default function WeldingPortalPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token as string) || '';

  const [view, setView] = useState<PortalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [payMessage, setPayMessage] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/welding/portal/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(
          data.error === 'invalid_token'
            ? 'This link is invalid or has expired.'
            : data.error || 'Unable to load this link.'
        );
        setView(null);
        return;
      }
      setView(data.result as PortalView);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const respond = async (decision: 'accept' | 'reject') => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/welding/portal/${encodeURIComponent(token)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, signature }),
      });
      const data = await res.json();
      if (data.ok) {
        setView((prev) =>
          prev && prev.kind === 'estimate'
            ? { kind: 'estimate', estimate: data.result.estimate, canApprove: false }
            : prev
        );
      } else {
        setError(data.error || 'Could not submit your response.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const tryPay = async () => {
    if (payLoading) return;
    setPayLoading(true);
    setPayMessage(null);
    try {
      const res = await fetch(`/api/welding/portal/${encodeURIComponent(token)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setPayMessage(data.message || data.error || 'Online payment is not available yet.');
    } catch {
      setPayMessage('Network error. Please try again.');
    } finally {
      setPayLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
        <div className="max-w-sm text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
          <p className="text-sm text-zinc-300">{error || 'This link could not be loaded.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center gap-2 mb-6 text-zinc-500">
          <Flame className="w-4 h-4 text-orange-400" />
          <span className="text-xs uppercase tracking-wide">Welding &amp; Fabrication — Client Portal</span>
        </header>

        {view.kind === 'estimate' ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-zinc-100">
                  <FileText className="w-4 h-4 text-orange-400" />
                  <h1 className="text-lg font-semibold">{view.estimate.title}</h1>
                </div>
                <p className="text-sm text-zinc-500 mt-1">
                  {view.estimate.client}
                  {view.estimate.address ? ` · ${view.estimate.address}` : ''}
                </p>
              </div>
              <StatusBadge status={view.estimate.status} />
            </div>

            <LineItemsTable items={view.estimate.lineItems} />

            <div className="space-y-1 text-sm border-t border-zinc-800 pt-3">
              <div className="flex justify-between text-zinc-400">
                <span>Subtotal</span>
                <span>{money(view.estimate.subtotal)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Tax ({Math.round((view.estimate.taxRate || 0) * 100)}%)</span>
                <span>{money(view.estimate.tax)}</span>
              </div>
              <div className="flex justify-between text-zinc-100 font-semibold text-base pt-1">
                <span>Total</span>
                <span>{money(view.estimate.total)}</span>
              </div>
            </div>

            {view.canApprove ? (
              <div className="border-t border-zinc-800 pt-4 space-y-3">
                <label htmlFor="signature" className="block text-sm text-zinc-300">
                  Type your name to sign (optional)
                </label>
                <input
                  id="signature"
                  type="text"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => respond('accept')}
                    disabled={submitting}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Accept estimate
                  </button>
                  <button
                    onClick={() => respond('reject')}
                    disabled={submitting}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 font-medium rounded-lg border border-zinc-700 transition-colors"
                  >
                    <XCircle className="w-4 h-4" /> Decline
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t border-zinc-800 pt-4 text-sm text-zinc-400">
                {view.estimate.status === 'accepted' &&
                  `You accepted this estimate${view.estimate.acceptedBy ? ` as ${view.estimate.acceptedBy}` : ''}${view.estimate.acceptedAt ? ` on ${new Date(view.estimate.acceptedAt).toLocaleDateString()}` : ''}.`}
                {view.estimate.status === 'rejected' && 'You declined this estimate.'}
                {!['accepted', 'rejected'].includes(view.estimate.status) &&
                  'This estimate is no longer awaiting a response.'}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-zinc-100">
                  <Receipt className="w-4 h-4 text-orange-400" />
                  <h1 className="text-lg font-semibold">{view.invoice.invoiceNumber}</h1>
                </div>
                <p className="text-sm text-zinc-500 mt-1">
                  {view.invoice.title} · {view.invoice.client}
                </p>
              </div>
              <StatusBadge status={view.invoice.status} />
            </div>

            <LineItemsTable items={view.invoice.lineItems} />

            <div className="space-y-1 text-sm border-t border-zinc-800 pt-3">
              <div className="flex justify-between text-zinc-400">
                <span>Subtotal</span>
                <span>{money(view.invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Tax</span>
                <span>{money(view.invoice.tax)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Amount due</span>
                <span>{money(view.invoice.amount)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Paid to date</span>
                <span>{money(view.invoice.amountPaid)}</span>
              </div>
              <div className="flex justify-between text-zinc-100 font-semibold text-base pt-1">
                <span>Balance</span>
                <span>{money(view.invoice.balance)}</span>
              </div>
              {view.invoice.dueDate && (
                <div className="flex justify-between text-zinc-500 pt-1">
                  <span>Due date</span>
                  <span>{new Date(view.invoice.dueDate).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            {view.invoice.payments?.length > 0 && (
              <div className="border-t border-zinc-800 pt-4">
                <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Payment history</p>
                <ul className="space-y-1 text-sm text-zinc-400">
                  {view.invoice.payments.map((p) => (
                    <li key={p.id} className="flex justify-between">
                      <span>
                        {new Date(p.recordedAt).toLocaleDateString()} · {p.method} · {p.reference}
                      </span>
                      <span className="text-zinc-200">{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {view.canPay && (
              <div className="border-t border-zinc-800 pt-4 space-y-3">
                <button
                  onClick={tryPay}
                  disabled={payLoading}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
                >
                  {payLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Pay online
                </button>
                {payMessage && (
                  <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                    {payMessage}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
