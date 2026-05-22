'use client';

/**
 * PactWriter — write a sparks-only inheritance pact with multi-beneficiary
 * split, recurring premium schedule, auto-renew and an opt-in acceptance
 * handshake. Every value is real user input; no seed data.
 */

import { useMemo, useState } from 'react';
import { Plus, Trash2, ScrollText } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface BeneRow {
  userId: string;
  sharePct: number;
}

type Freq = 'upfront' | 'weekly' | 'monthly';

interface PactWriterProps {
  onWritten: () => void;
}

export function PactWriter({ onWritten }: PactWriterProps) {
  const [beneficiaries, setBeneficiaries] = useState<BeneRow[]>([{ userId: '', sharePct: 100 }]);
  const [payoutSparks, setPayoutSparks] = useState(500);
  const [premiumSparks, setPremiumSparks] = useState(50);
  const [durationDays, setDurationDays] = useState(30);
  const [premiumFrequency, setPremiumFrequency] = useState<Freq>('upfront');
  const [autoRenew, setAutoRenew] = useState(false);
  const [requireHandshake, setRequireHandshake] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shareTotal = useMemo(
    () => beneficiaries.reduce((a, b) => a + (Number(b.sharePct) || 0), 0),
    [beneficiaries],
  );
  const namedCount = beneficiaries.filter((b) => b.userId.trim()).length;
  const canSubmit = namedCount > 0 && payoutSparks > 0 && premiumSparks > 0 && !busy;

  const updateBene = (i: number, patch: Partial<BeneRow>) => {
    setBeneficiaries((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };
  const addBene = () => setBeneficiaries((prev) => [...prev, { userId: '', sharePct: 0 }]);
  const removeBene = (i: number) =>
    setBeneficiaries((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const splitEvenly = () => {
    const named = beneficiaries.filter((b) => b.userId.trim());
    if (!named.length) return;
    const even = Math.floor(100 / named.length);
    let pi = 0;
    setBeneficiaries((prev) =>
      prev.map((b) => {
        if (!b.userId.trim()) return { ...b, sharePct: 0 };
        pi += 1;
        return { ...b, sharePct: pi === named.length ? 100 - even * (named.length - 1) : even };
      }),
    );
  };

  const write = async () => {
    setBusy(true);
    setStatus('Writing pact…');
    const payload = {
      beneficiaries: beneficiaries
        .filter((b) => b.userId.trim())
        .map((b) => ({ userId: b.userId.trim(), sharePct: Number(b.sharePct) || 0 })),
      payoutSparks,
      premiumSparks,
      durationDays,
      premiumFrequency,
      autoRenew,
      requireHandshake,
    };
    const r = await lensRun('insurance', 'pact-write', payload);
    if (r.data?.ok) {
      setStatus(`Pact written — ${payoutSparks} ⚡ across ${namedCount} beneficiary(ies).`);
      setBeneficiaries([{ userId: '', sharePct: 100 }]);
      setPayoutSparks(500);
      setPremiumSparks(50);
      setDurationDays(30);
      setPremiumFrequency('upfront');
      setAutoRenew(false);
      setRequireHandshake(true);
      onWritten();
    } else {
      setStatus(`Failed: ${r.data?.error || 'unknown error'}`);
    }
    setBusy(false);
    window.setTimeout(() => setStatus(null), 6000);
  };

  return (
    <section className="rounded-xl border border-cyan-800/50 bg-zinc-900/80 p-4 space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-cyan-300">
        <ScrollText className="h-4 w-4" /> Write Inheritance Pact
      </h2>

      {status && (
        <div className="rounded-lg border border-cyan-700/50 bg-cyan-950/50 px-3 py-2 text-xs text-cyan-200">
          {status}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-zinc-300">Beneficiaries (split %)</label>
          <button
            type="button"
            onClick={splitEvenly}
            className="text-[11px] text-cyan-400 hover:text-cyan-300"
          >
            Split evenly
          </button>
        </div>
        {beneficiaries.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Beneficiary user id"
              value={b.userId}
              onChange={(e) => updateBene(i, { userId: e.target.value })}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={b.sharePct}
              onChange={(e) =>
                updateBene(i, { sharePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
              }
              className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
              aria-label={`Beneficiary ${i + 1} share percent`}
            />
            <span className="text-xs text-zinc-500">%</span>
            <button
              type="button"
              onClick={() => removeBene(i)}
              disabled={beneficiaries.length === 1}
              className="text-rose-400 hover:text-rose-300 disabled:opacity-30"
              aria-label="Remove beneficiary"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={addBene}
            className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300"
          >
            <Plus className="h-3 w-3" /> Add beneficiary
          </button>
          <span
            className={`text-[11px] ${shareTotal === 100 ? 'text-emerald-400' : 'text-amber-400'}`}
          >
            shares total {shareTotal}% {shareTotal !== 100 && '(rebalanced on write)'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-zinc-400">Payout ⚡</label>
          <input
            type="number"
            min={1}
            value={payoutSparks}
            onChange={(e) => setPayoutSparks(Math.max(1, Number(e.target.value) || 1))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400">Premium ⚡</label>
          <input
            type="number"
            min={1}
            value={premiumSparks}
            onChange={(e) => setPremiumSparks(Math.max(1, Number(e.target.value) || 1))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400">Days</label>
          <input
            type="number"
            min={1}
            value={durationDays}
            onChange={(e) => setDurationDays(Math.max(1, Number(e.target.value) || 1))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-400">Premium schedule</label>
          <select
            value={premiumFrequency}
            onChange={(e) => setPremiumFrequency(e.target.value as Freq)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
          >
            <option value="upfront">Up-front (single)</option>
            <option value="weekly">Recurring weekly</option>
            <option value="monthly">Recurring monthly</option>
          </select>
        </div>
        <div className="flex flex-col justify-end gap-1.5 pb-0.5">
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
              className="accent-cyan-600"
            />
            Auto-renew before expiry
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={requireHandshake}
              onChange={(e) => setRequireHandshake(e.target.checked)}
              className="accent-cyan-600"
            />
            Require beneficiary acceptance
          </label>
        </div>
      </div>

      <button
        type="button"
        onClick={write}
        disabled={!canSubmit}
        className="w-full rounded-lg bg-cyan-700 py-2 text-sm text-white hover:bg-cyan-600 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
      >
        Write Pact
      </button>
    </section>
  );
}
