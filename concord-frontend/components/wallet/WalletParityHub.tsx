'use client';

/**
 * WalletParityHub — Venmo / PayPal parity surface for the wallet lens.
 *
 * Surfaces the eight buildable backlog features end-to-end against the
 * `wallet` domain macros: money requests, invoices, recurring transfers,
 * the social transaction feed, split-the-bill, linked funding sources,
 * QR pay/receive, and a spending-insights dashboard.
 *
 * Every value here is real user input or computed from real platform
 * state (the `/api/economy/history` feed). No seed / mock data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Receipt,
  CalendarClock,
  Users2,
  Split,
  CreditCard,
  QrCode,
  PieChart,
  Plus,
  Trash2,
  Star,
  Heart,
  Check,
  X as XIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { lensRun, api } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface LineItem { description: string; amount: number }
interface MoneyRequest {
  id: string;
  kind: 'request' | 'invoice';
  requesterId: string;
  payerId: string;
  amount: number;
  note: string;
  emoji: string;
  lineItems: LineItem[];
  dueDate: string | null;
  payLink: string;
  status: 'pending' | 'paid' | 'declined' | 'canceled';
  createdAt: string;
  paidAt: string | null;
}
interface Schedule {
  id: string;
  recipientId: string;
  amount: number;
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  note: string;
  nextRunAt: string;
  status: 'active' | 'paused' | 'canceled';
}
interface FeedComment { userId: string; text: string; at: string }
interface FeedEntry {
  id: string;
  actorId: string;
  counterparty: string;
  direction: 'sent' | 'received';
  note: string;
  emoji: string;
  amount: number | null;
  visibility: 'public' | 'friends' | 'private';
  likes: string[];
  comments: FeedComment[];
  createdAt: string;
}
interface SplitShare { userId: string; amount: number; paid: boolean; paidAt: string | null }
interface SplitRecord {
  id: string;
  creatorId: string;
  title: string;
  total: number;
  shares: SplitShare[];
  note: string;
  status: 'open' | 'settled';
  createdAt: string;
}
interface FundingCard {
  id: string;
  type: 'card' | 'bank' | 'paypal';
  label: string;
  last4: string | null;
  brand: string | null;
  isDefault: boolean;
}
interface CategoryRow { category: string; total: number; count: number; percent: number }
interface MonthRow { month: string; spent: number }
interface InsightsResult {
  hasData: boolean;
  totalSpent?: number;
  totalReceived?: number;
  net?: number;
  transactionCount?: number;
  byCategory?: CategoryRow[];
  monthSeries?: MonthRow[];
  averageMonthly?: number;
  trend?: string;
  topCategory?: CategoryRow | null;
}
interface QrResult { payload: unknown; token: string; deepLink: string; webLink: string }
interface RawTx { amount?: number; description?: string; merchant?: string; type?: string; created_at?: string; timestamp?: string; date?: string }

type TabId = 'requests' | 'schedules' | 'feed' | 'splits' | 'cards' | 'qr' | 'insights';

const TABS: { id: TabId; label: string; icon: typeof Receipt }[] = [
  { id: 'requests', label: 'Requests', icon: Receipt },
  { id: 'schedules', label: 'Recurring', icon: CalendarClock },
  { id: 'feed', label: 'Feed', icon: Users2 },
  { id: 'splits', label: 'Split', icon: Split },
  { id: 'cards', label: 'Funding', icon: CreditCard },
  { id: 'qr', label: 'QR Pay', icon: QrCode },
  { id: 'insights', label: 'Insights', icon: PieChart },
];

// ── Shared bits ──────────────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 text-sm bg-lattice-deep border border-lattice-border rounded text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50';
const btnCls =
  'flex items-center gap-1.5 px-3 py-2 text-sm rounded bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40 hover:bg-neon-cyan/25 disabled:opacity-40 disabled:cursor-not-allowed';

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-gray-500 py-6 text-center">{message}</p>;
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'paid' || status === 'settled' || status === 'active'
      ? 'bg-green-500/15 text-green-400'
      : status === 'pending' || status === 'open'
        ? 'bg-amber-500/15 text-amber-400'
        : 'bg-gray-500/15 text-gray-400';
  return <span className={cn('text-[10px] px-1.5 py-0.5 rounded capitalize', color)}>{status}</span>;
}

// ── Main component ───────────────────────────────────────────────────────────

export function WalletParityHub() {
  const [tab, setTab] = useState<TabId>('requests');

  return (
    <div className="rounded-xl border border-lattice-border bg-lattice-surface/40 overflow-hidden">
      <div className="flex flex-wrap gap-1 border-b border-lattice-border px-3 pt-3 bg-lattice-surface/60">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                active
                  ? 'text-neon-cyan border-neon-cyan'
                  : 'text-gray-400 border-transparent hover:text-white',
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="p-4">
        {tab === 'requests' && <RequestsTab />}
        {tab === 'schedules' && <SchedulesTab />}
        {tab === 'feed' && <FeedTab />}
        {tab === 'splits' && <SplitsTab />}
        {tab === 'cards' && <CardsTab />}
        {tab === 'qr' && <QrTab />}
        {tab === 'insights' && <InsightsTab />}
      </div>
    </div>
  );
}

// ── Requests / invoices ──────────────────────────────────────────────────────

function RequestsTab() {
  const [requests, setRequests] = useState<MoneyRequest[]>([]);
  const [outstanding, setOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [payerId, setPayerId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [emoji, setEmoji] = useState('');
  const [isInvoice, setIsInvoice] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', amount: 0 }]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ requests: MoneyRequest[]; outstandingTotal: number }>(
      'wallet',
      'requestList',
      {},
    );
    if (r.data?.ok && r.data.result) {
      setRequests(r.data.result.requests || []);
      setOutstanding(r.data.result.outstandingTotal || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    setErr('');
    const amt = Number(amount);
    if (!payerId.trim()) { setErr('Enter who should pay'); return; }
    if (!(amt > 0) && !isInvoice) { setErr('Enter a positive amount'); return; }
    setBusy(true);
    const cleanItems = lineItems
      .map((li) => ({ description: li.description.trim(), amount: Number(li.amount) || 0 }))
      .filter((li) => li.description);
    const total = isInvoice && cleanItems.length
      ? cleanItems.reduce((s, li) => s + li.amount, 0)
      : amt;
    const r = await lensRun<{ request: MoneyRequest }>('wallet', 'requestCreate', {
      payerId: payerId.trim(),
      amount: total,
      note: note.trim(),
      emoji: emoji.trim(),
      invoice: isInvoice,
      lineItems: isInvoice ? cleanItems : [],
    });
    setBusy(false);
    if (r.data?.ok) {
      setPayerId(''); setAmount(''); setNote(''); setEmoji('');
      setLineItems([{ description: '', amount: 0 }]);
      void refresh();
    } else {
      setErr(r.data?.error || 'Could not create request');
    }
  }, [payerId, amount, note, emoji, isInvoice, lineItems, refresh]);

  const update = useCallback(async (id: string, status: MoneyRequest['status']) => {
    const r = await lensRun('wallet', 'requestUpdate', { id, status });
    if (r.data?.ok) void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-lattice-border bg-lattice-deep p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white">
            {isInvoice ? 'New invoice' : 'Request money'}
          </h4>
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={isInvoice}
              onChange={(e) => setIsInvoice(e.target.checked)}
            />
            Itemized invoice
          </label>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            className={inputCls}
            placeholder="Payer user ID"
            value={payerId}
            onChange={(e) => setPayerId(e.target.value)}
          />
          {!isInvoice && (
            <input
              className={inputCls}
              inputMode="decimal"
              placeholder="Amount (CC)"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            />
          )}
        </div>
        {isInvoice && (
          <div className="space-y-1.5">
            {lineItems.map((li, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="Line item"
                  value={li.description}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[i] = { ...next[i], description: e.target.value };
                    setLineItems(next);
                  }}
                />
                <input
                  className={cn(inputCls, 'w-28')}
                  inputMode="decimal"
                  placeholder="Amount"
                  value={li.amount || ''}
                  onChange={(e) => {
                    const next = [...lineItems];
                    next[i] = { ...next[i], amount: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 };
                    setLineItems(next);
                  }}
                />
                <button
                  onClick={() => setLineItems(lineItems.filter((_, j) => j !== i))}
                  className="px-2 text-gray-500 hover:text-red-400"
                  aria-label="Remove line item"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setLineItems([...lineItems, { description: '', amount: 0 }])}
              className="text-xs text-neon-cyan flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add line item
            </button>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            className={inputCls}
            placeholder="Note (e.g. lunch)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <input
            className={cn(inputCls, 'sm:w-24')}
            placeholder="Emoji"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value.slice(0, 8))}
          />
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button onClick={create} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
          {isInvoice ? 'Send invoice' : 'Send request'}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Outstanding: <span className="text-amber-400 font-mono">{outstanding.toLocaleString()} CC</span>
        </p>
        <button onClick={refresh} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {loading ? (
        <Loader2 className="w-5 h-5 mx-auto text-neon-cyan animate-spin" />
      ) : requests.length === 0 ? (
        <EmptyState message="No money requests yet" />
      ) : (
        <div className="space-y-2">
          {requests.map((req) => (
            <div key={req.id} className="rounded-lg border border-lattice-border bg-lattice-deep p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg">{req.emoji || (req.kind === 'invoice' ? '🧾' : '💸')}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">
                      {req.note || (req.kind === 'invoice' ? 'Invoice' : 'Money request')}
                    </p>
                    <p className="text-[11px] text-gray-500 font-mono truncate">
                      {req.requesterId} → {req.payerId}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-mono text-white">{req.amount.toLocaleString()} CC</p>
                  <StatusPill status={req.status} />
                </div>
              </div>
              {req.lineItems.length > 0 && (
                <ul className="mt-2 text-[11px] text-gray-400 space-y-0.5">
                  {req.lineItems.map((li, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{li.description}</span>
                      <span className="font-mono">{li.amount.toLocaleString()} CC</span>
                    </li>
                  ))}
                </ul>
              )}
              {req.status === 'pending' && (
                <div className="mt-2 flex items-center gap-2">
                  <code className="text-[10px] text-gray-500 truncate flex-1">{req.payLink}</code>
                  <button onClick={() => update(req.id, 'paid')} className="text-[11px] text-green-400 hover:underline flex items-center gap-0.5">
                    <Check className="w-3 h-3" /> Mark paid
                  </button>
                  <button onClick={() => update(req.id, 'declined')} className="text-[11px] text-red-400 hover:underline">Decline</button>
                  <button onClick={() => update(req.id, 'canceled')} className="text-[11px] text-gray-400 hover:underline">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recurring transfers ──────────────────────────────────────────────────────

function SchedulesTab() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [committed, setCommitted] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Schedule['frequency']>('monthly');
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ schedules: Schedule[]; monthlyCommitted: number }>(
      'wallet',
      'scheduleList',
      {},
    );
    if (r.data?.ok && r.data.result) {
      setSchedules(r.data.result.schedules || []);
      setCommitted(r.data.result.monthlyCommitted || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    setErr('');
    if (!recipientId.trim()) { setErr('Enter a recipient'); return; }
    if (!(Number(amount) > 0)) { setErr('Enter a positive amount'); return; }
    setBusy(true);
    const r = await lensRun('wallet', 'scheduleCreate', {
      recipientId: recipientId.trim(),
      amount: Number(amount),
      frequency,
      note: note.trim(),
    });
    setBusy(false);
    if (r.data?.ok) {
      setRecipientId(''); setAmount(''); setNote('');
      void refresh();
    } else {
      setErr(r.data?.error || 'Could not create schedule');
    }
  }, [recipientId, amount, frequency, note, refresh]);

  const setStatus = useCallback(async (id: string, status: Schedule['status']) => {
    const r = await lensRun('wallet', 'scheduleUpdate', { id, status });
    if (r.data?.ok) void refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    const r = await lensRun('wallet', 'scheduleDelete', { id });
    if (r.data?.ok) void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-lattice-border bg-lattice-deep p-3 space-y-2">
        <h4 className="text-sm font-semibold text-white">New recurring transfer</h4>
        <div className="grid sm:grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Recipient user ID" value={recipientId} onChange={(e) => setRecipientId(e.target.value)} />
          <input className={inputCls} inputMode="decimal" placeholder="Amount (CC)" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          <select
            className={inputCls}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Schedule['frequency'])}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
          </select>
          <input className={inputCls} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button onClick={create} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
          Schedule transfer
        </button>
      </div>

      <p className="text-xs text-gray-400">
        Committed per month: <span className="text-neon-cyan font-mono">{committed.toLocaleString()} CC</span>
      </p>

      {loading ? (
        <Loader2 className="w-5 h-5 mx-auto text-neon-cyan animate-spin" />
      ) : schedules.length === 0 ? (
        <EmptyState message="No recurring transfers yet" />
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => (
            <div key={s.id} className="rounded-lg border border-lattice-border bg-lattice-deep p-3 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm text-white truncate">
                  {s.amount.toLocaleString()} CC → <span className="font-mono">{s.recipientId}</span>
                </p>
                <p className="text-[11px] text-gray-500">
                  {s.frequency} · next {new Date(s.nextRunAt).toLocaleDateString()}
                  {s.note ? ` · ${s.note}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <StatusPill status={s.status} />
                {s.status !== 'canceled' && (
                  <button
                    onClick={() => setStatus(s.id, s.status === 'active' ? 'paused' : 'active')}
                    className="text-[11px] text-neon-cyan hover:underline"
                  >
                    {s.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                )}
                <button onClick={() => remove(s.id)} className="text-gray-500 hover:text-red-400" aria-label="Delete schedule">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Social feed ──────────────────────────────────────────────────────────────

function FeedTab() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [note, setNote] = useState('');
  const [emoji, setEmoji] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'sent' | 'received'>('sent');
  const [visibility, setVisibility] = useState<'public' | 'friends' | 'private'>('friends');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ entries: FeedEntry[] }>('wallet', 'feedList', { scope });
    if (r.data?.ok && r.data.result) setEntries(r.data.result.entries || []);
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const post = useCallback(async () => {
    setErr('');
    if (!counterparty.trim()) { setErr('Enter the other person'); return; }
    if (!note.trim()) { setErr('Add a note'); return; }
    setBusy(true);
    const r = await lensRun('wallet', 'feedPost', {
      counterparty: counterparty.trim(),
      note: note.trim(),
      emoji: emoji.trim(),
      direction,
      visibility,
      amount: amount ? Number(amount) : undefined,
    });
    setBusy(false);
    if (r.data?.ok) {
      setCounterparty(''); setNote(''); setEmoji(''); setAmount('');
      void refresh();
    } else {
      setErr(r.data?.error || 'Could not post');
    }
  }, [counterparty, note, emoji, direction, visibility, amount, refresh]);

  const like = useCallback(async (id: string, comment?: string) => {
    const r = await lensRun('wallet', 'feedLike', { id, comment });
    if (r.data?.ok) {
      setCommentDrafts((d) => ({ ...d, [id]: '' }));
      void refresh();
    }
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-lattice-border bg-lattice-deep p-3 space-y-2">
        <h4 className="text-sm font-semibold text-white">Share a payment</h4>
        <div className="grid sm:grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Other person user ID" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          <input className={inputCls} inputMode="decimal" placeholder="Amount (optional)" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <div className="flex gap-2">
          <input className={cn(inputCls, 'flex-1')} placeholder="What was it for?" value={note} onChange={(e) => setNote(e.target.value)} />
          <input className={cn(inputCls, 'w-20')} placeholder="🎉" value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 8))} />
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          <select className={inputCls} value={direction} onChange={(e) => setDirection(e.target.value as 'sent' | 'received')}>
            <option value="sent">I paid them</option>
            <option value="received">They paid me</option>
          </select>
          <select className={inputCls} value={visibility} onChange={(e) => setVisibility(e.target.value as 'public' | 'friends' | 'private')}>
            <option value="public">Public</option>
            <option value="friends">Friends</option>
            <option value="private">Private</option>
          </select>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button onClick={post} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users2 className="w-4 h-4" />}
          Post to feed
        </button>
      </div>

      <div className="flex gap-1">
        {(['all', 'mine'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={cn(
              'px-2.5 py-1 text-xs rounded capitalize',
              scope === s ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400 hover:text-white',
            )}
          >
            {s === 'all' ? 'Everyone' : 'My activity'}
          </button>
        ))}
      </div>

      {loading ? (
        <Loader2 className="w-5 h-5 mx-auto text-neon-cyan animate-spin" />
      ) : entries.length === 0 ? (
        <EmptyState message="No transaction activity yet" />
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="rounded-lg border border-lattice-border bg-lattice-deep p-3">
              <div className="flex items-start gap-2">
                <span className="text-xl">{e.emoji || '💳'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white">
                    <span className="font-mono">{e.actorId}</span>{' '}
                    {e.direction === 'sent' ? 'paid' : 'got paid by'}{' '}
                    <span className="font-mono">{e.counterparty}</span>
                  </p>
                  <p className="text-xs text-gray-400">{e.note}</p>
                  <p className="text-[10px] text-gray-600 mt-0.5">
                    {new Date(e.createdAt).toLocaleString()} · {e.visibility}
                    {e.amount != null ? ` · ${e.amount.toLocaleString()} CC` : ''}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={() => like(e.id)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-neon-pink"
                >
                  <Heart className="w-3.5 h-3.5" /> {e.likes.length}
                </button>
                <span className="text-xs text-gray-500">{e.comments.length} comment{e.comments.length !== 1 ? 's' : ''}</span>
              </div>
              {e.comments.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {e.comments.map((c, i) => (
                    <li key={i} className="text-[11px] text-gray-400">
                      <span className="font-mono text-gray-300">{c.userId}</span>: {c.text}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1.5 flex gap-1.5">
                <input
                  className={cn(inputCls, 'text-xs py-1')}
                  placeholder="Add a comment…"
                  value={commentDrafts[e.id] || ''}
                  onChange={(ev) => setCommentDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
                />
                <button
                  onClick={() => {
                    const txt = (commentDrafts[e.id] || '').trim();
                    if (txt) void like(e.id, txt);
                  }}
                  className="px-2 text-xs text-neon-cyan hover:underline"
                >
                  Send
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Split the bill ───────────────────────────────────────────────────────────

function SplitsTab() {
  const [splits, setSplits] = useState<SplitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [title, setTitle] = useState('');
  const [total, setTotal] = useState('');
  const [participants, setParticipants] = useState('');
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ splits: SplitRecord[] }>('wallet', 'splitList', {});
    if (r.data?.ok && r.data.result) setSplits(r.data.result.splits || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    setErr('');
    const t = Number(total);
    if (!(t > 0)) { setErr('Enter a positive total'); return; }
    const parts = participants.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) { setErr('Add at least one participant'); return; }
    setBusy(true);
    const r = await lensRun('wallet', 'splitCreate', {
      title: title.trim() || 'Split',
      total: t,
      participants: parts,
      note: note.trim(),
    });
    setBusy(false);
    if (r.data?.ok) {
      setTitle(''); setTotal(''); setParticipants(''); setNote('');
      void refresh();
    } else {
      setErr(r.data?.error || 'Could not create split');
    }
  }, [title, total, participants, note, refresh]);

  const settle = useCallback(async (id: string, memberId: string) => {
    const r = await lensRun('wallet', 'splitSettle', { id, memberId });
    if (r.data?.ok) void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-lattice-border bg-lattice-deep p-3 space-y-2">
        <h4 className="text-sm font-semibold text-white">Split a bill</h4>
        <div className="grid sm:grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Title (e.g. Dinner)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className={inputCls} inputMode="decimal" placeholder="Total amount (CC)" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <input className={inputCls} placeholder="Participant user IDs, comma-separated" value={participants} onChange={(e) => setParticipants(e.target.value)} />
        <input className={inputCls} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <p className="text-[11px] text-gray-500">Split evenly across you + each participant.</p>
        <button onClick={create} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Split className="w-4 h-4" />}
          Create split
        </button>
      </div>

      {loading ? (
        <Loader2 className="w-5 h-5 mx-auto text-neon-cyan animate-spin" />
      ) : splits.length === 0 ? (
        <EmptyState message="No splits yet" />
      ) : (
        <div className="space-y-2">
          {splits.map((sp) => {
            const owed = sp.shares.filter((s) => !s.paid).reduce((a, s) => a + s.amount, 0);
            return (
              <div key={sp.id} className="rounded-lg border border-lattice-border bg-lattice-deep p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{sp.title}</p>
                    <p className="text-[11px] text-gray-500">
                      {sp.total.toLocaleString()} CC · owed {owed.toLocaleString()} CC
                    </p>
                  </div>
                  <StatusPill status={sp.status} />
                </div>
                <ul className="mt-2 space-y-1">
                  {sp.shares.map((s) => (
                    <li key={s.userId} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-gray-300">{s.userId}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-white">{s.amount.toLocaleString()} CC</span>
                        {s.paid ? (
                          <span className="text-green-400 flex items-center gap-0.5"><Check className="w-3 h-3" /> paid</span>
                        ) : (
                          <button onClick={() => settle(sp.id, s.userId)} className="text-neon-cyan hover:underline">
                            Settle
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Funding sources ──────────────────────────────────────────────────────────

function CardsTab() {
  const [cards, setCards] = useState<FundingCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [type, setType] = useState<'card' | 'bank' | 'paypal'>('card');
  const [label, setLabel] = useState('');
  const [last4, setLast4] = useState('');
  const [brand, setBrand] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ cards: FundingCard[] }>('wallet', 'cardList', {});
    if (r.data?.ok && r.data.result) setCards(r.data.result.cards || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(async () => {
    setErr('');
    if (!label.trim()) { setErr('Enter a label'); return; }
    if (type !== 'paypal' && last4.replace(/\D/g, '').length !== 4) {
      setErr('Enter the last 4 digits');
      return;
    }
    setBusy(true);
    const r = await lensRun('wallet', 'cardAdd', {
      type,
      label: label.trim(),
      last4: type === 'paypal' ? undefined : last4,
      brand: brand.trim() || undefined,
    });
    setBusy(false);
    if (r.data?.ok) {
      setLabel(''); setLast4(''); setBrand('');
      void refresh();
    } else {
      setErr(r.data?.error || 'Could not add funding source');
    }
  }, [type, label, last4, brand, refresh]);

  const setDefault = useCallback(async (id: string) => {
    const r = await lensRun('wallet', 'cardSetDefault', { id });
    if (r.data?.ok) void refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    const r = await lensRun('wallet', 'cardRemove', { id });
    if (r.data?.ok) void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-lattice-border bg-lattice-deep p-3 space-y-2">
        <h4 className="text-sm font-semibold text-white">Add a funding source</h4>
        <p className="text-[11px] text-gray-500">
          Only the last 4 digits are stored — never a full card number.
        </p>
        <div className="grid sm:grid-cols-3 gap-2">
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as 'card' | 'bank' | 'paypal')}>
            <option value="card">Card</option>
            <option value="bank">Bank account</option>
            <option value="paypal">PayPal</option>
          </select>
          <input className={inputCls} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          {type !== 'paypal' && (
            <input
              className={inputCls}
              inputMode="numeric"
              maxLength={4}
              placeholder="Last 4 digits"
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          )}
        </div>
        {type === 'card' && (
          <input className={inputCls} placeholder="Brand (e.g. Visa)" value={brand} onChange={(e) => setBrand(e.target.value)} />
        )}
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button onClick={add} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add funding source
        </button>
      </div>

      {loading ? (
        <Loader2 className="w-5 h-5 mx-auto text-neon-cyan animate-spin" />
      ) : cards.length === 0 ? (
        <EmptyState message="No funding sources linked yet" />
      ) : (
        <div className="space-y-2">
          {cards.map((c) => (
            <div key={c.id} className="rounded-lg border border-lattice-border bg-lattice-deep p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded bg-lattice-elevated flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-neon-cyan" />
                </div>
                <div>
                  <p className="text-sm text-white">
                    {c.label}
                    {c.brand ? <span className="text-gray-500"> · {c.brand}</span> : ''}
                  </p>
                  <p className="text-[11px] text-gray-500 capitalize">
                    {c.type}{c.last4 ? ` ···· ${c.last4}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {c.isDefault ? (
                  <span className="text-[11px] text-amber-400 flex items-center gap-0.5">
                    <Star className="w-3 h-3 fill-amber-400" /> Default
                  </span>
                ) : (
                  <button onClick={() => setDefault(c.id)} className="text-[11px] text-neon-cyan hover:underline">
                    Make default
                  </button>
                )}
                <button onClick={() => remove(c.id)} className="text-gray-500 hover:text-red-400" aria-label="Remove funding source">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── QR pay / receive ─────────────────────────────────────────────────────────

function QrTab() {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [qr, setQr] = useState<QrResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [scanToken, setScanToken] = useState('');
  const [scanResult, setScanResult] = useState<{ recipientId: string; amount: number | null; note: string | null } | null>(null);
  const [scanErr, setScanErr] = useState('');

  const generate = useCallback(async () => {
    setErr('');
    setBusy(true);
    const r = await lensRun<QrResult>('wallet', 'qrGenerate', {
      amount: amount ? Number(amount) : undefined,
      note: note.trim(),
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) setQr(r.data.result);
    else setErr(r.data?.error || 'Could not generate QR code');
  }, [amount, note]);

  const resolve = useCallback(async () => {
    setScanErr('');
    setScanResult(null);
    if (!scanToken.trim()) { setScanErr('Paste a QR token'); return; }
    const r = await lensRun<{ recipientId: string; amount: number | null; note: string | null }>(
      'wallet',
      'qrResolve',
      { token: scanToken.trim() },
    );
    if (r.data?.ok && r.data.result) setScanResult(r.data.result);
    else setScanErr(r.data?.error || 'Invalid QR code');
  }, [scanToken]);

  // Render the QR token as a scannable matrix using a public keyless QR API.
  const qrImgUrl = qr
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(qr.token)}`
    : null;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-lg border border-lattice-border bg-lattice-deep p-3 space-y-2">
        <h4 className="text-sm font-semibold text-white">Receive — show your QR</h4>
        <input className={inputCls} inputMode="decimal" placeholder="Request amount (optional)" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        <input className={inputCls} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button onClick={generate} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
          Generate QR code
        </button>
        {qr && qrImgUrl && (
          <div className="space-y-2 pt-1">
            <div className="bg-white rounded p-2 w-fit mx-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrImgUrl} alt="Wallet pay QR code" width={180} height={180} />
            </div>
            <code className="block text-[10px] text-gray-500 break-all">{qr.token}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(qr.token)}
              className="text-[11px] text-neon-cyan hover:underline"
            >
              Copy token
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-lattice-border bg-lattice-deep p-3 space-y-2">
        <h4 className="text-sm font-semibold text-white">Pay — scan a QR token</h4>
        <textarea
          className={cn(inputCls, 'h-24 resize-none font-mono text-xs')}
          placeholder="Paste a Concord wallet QR token here"
          value={scanToken}
          onChange={(e) => setScanToken(e.target.value)}
        />
        {scanErr && <p className="text-xs text-red-400">{scanErr}</p>}
        <button onClick={resolve} className={btnCls}>
          <QrCode className="w-4 h-4" /> Resolve token
        </button>
        {scanResult && (
          <div className="rounded border border-lattice-border bg-lattice-surface p-2.5 text-sm space-y-1">
            <p className="text-gray-400">Pay to: <span className="text-white font-mono">{scanResult.recipientId}</span></p>
            <p className="text-gray-400">
              Amount:{' '}
              <span className="text-neon-cyan font-mono">
                {scanResult.amount != null ? `${scanResult.amount.toLocaleString()} CC` : 'open (you choose)'}
              </span>
            </p>
            {scanResult.note && <p className="text-gray-400">Note: <span className="text-white">{scanResult.note}</span></p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Spending insights ────────────────────────────────────────────────────────

function InsightsTab() {
  const [insights, setInsights] = useState<InsightsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      // Real transactions from the economy history feed.
      const hist = await api.get('/api/economy/history', { params: { limit: 250 } });
      const body = hist.data as { transactions?: RawTx[]; items?: RawTx[]; history?: RawTx[] };
      const txns: RawTx[] = body.transactions || body.items || body.history || [];
      const r = await lensRun<InsightsResult>('wallet', 'spendingInsights', { transactions: txns });
      if (r.data?.ok && r.data.result) setInsights(r.data.result);
      else setErr(r.data?.error || 'Could not compute insights');
    } catch {
      setErr('Could not load transaction history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryData = useMemo(
    () => (insights?.byCategory || []).map((c) => ({ category: c.category, total: c.total })),
    [insights],
  );
  const monthData = useMemo(
    () => (insights?.monthSeries || []).map((m) => ({ month: m.month, spent: m.spent })),
    [insights],
  );

  if (loading) {
    return <Loader2 className="w-6 h-6 mx-auto my-8 text-neon-cyan animate-spin" />;
  }
  if (err) {
    return <p className="text-sm text-red-400 py-6 text-center">{err}</p>;
  }
  if (!insights || !insights.hasData) {
    return <EmptyState message="No spending data yet — your insights appear once you have transactions" />;
  }

  const trendColor =
    insights.trend === 'increasing' ? 'text-red-400'
      : insights.trend === 'decreasing' ? 'text-neon-green'
        : 'text-gray-300';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">Spending insights</h4>
        <button onClick={load} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="Total spent" value={`${(insights.totalSpent ?? 0).toLocaleString()} CC`} color="text-red-400" />
        <Metric label="Total received" value={`${(insights.totalReceived ?? 0).toLocaleString()} CC`} color="text-neon-green" />
        <Metric label="Net" value={`${(insights.net ?? 0).toLocaleString()} CC`} color={(insights.net ?? 0) >= 0 ? 'text-neon-green' : 'text-red-400'} />
        <Metric label="Avg / month" value={`${(insights.averageMonthly ?? 0).toLocaleString()} CC`} color="text-neon-cyan" />
      </div>

      <p className="text-xs text-gray-400">
        Trend: <span className={cn('font-semibold capitalize', trendColor)}>{insights.trend}</span>
        {insights.topCategory ? (
          <span className="ml-3">
            Top category: <span className="text-white">{insights.topCategory.category}</span>{' '}
            ({insights.topCategory.percent}%)
          </span>
        ) : null}
      </p>

      {monthData.length > 0 && (
        <div className="rounded-lg border border-lattice-border bg-lattice-deep p-3">
          <p className="text-xs text-gray-400 mb-2">Spending by month</p>
          <ChartKit
            kind="area"
            data={monthData}
            xKey="month"
            series={[{ key: 'spent', label: 'Spent (CC)', color: '#06b6d4' }]}
            height={200}
          />
        </div>
      )}

      {categoryData.length > 0 && (
        <div className="rounded-lg border border-lattice-border bg-lattice-deep p-3">
          <p className="text-xs text-gray-400 mb-2">Spending by category</p>
          <ChartKit
            kind="bar"
            data={categoryData}
            xKey="category"
            series={[{ key: 'total', label: 'Spent (CC)', color: '#a855f7' }]}
            height={200}
          />
          <ul className="mt-2 space-y-1">
            {(insights.byCategory || []).map((c) => (
              <li key={c.category} className="flex items-center justify-between text-xs">
                <span className="text-gray-300">{c.category}</span>
                <span className="text-gray-400">
                  <span className="font-mono text-white">{c.total.toLocaleString()} CC</span>
                  {' · '}{c.count} txn{c.count !== 1 ? 's' : ''} · {c.percent}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-lattice-border bg-lattice-deep p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={cn('text-sm font-mono font-bold mt-0.5', color)}>{value}</p>
    </div>
  );
}
