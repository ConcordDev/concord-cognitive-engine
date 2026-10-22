'use client';

import { useState } from 'react';
import { api } from '@/lib/api/client';

/**
 * Sends a tip through POST /api/economy/transfer.
 * A fee is shown only when that response includes one.
 */
export function TipForm() {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    setMessage(null);
    const value = Number(amount);
    if (!to.trim() || !Number.isFinite(value)) {
      setMessage('Enter a recipient and an amount.');
      return;
    }
    try {
      const res = await api.post<{ ok?: boolean; error?: string; fee?: number }>('/api/economy/transfer', {
        to: to.trim(),
        amount: value,
        note: note.trim() || undefined,
      });
      if (res.data?.ok === false || res.data?.error) {
        setMessage(res.data.error || 'Transfer was not accepted.');
        return;
      }
      const fee = res.data?.fee;
      setMessage(typeof fee === 'number' ? `Sent. Fee ${fee}.` : 'Sent.');
      setAmount('');
      setNote('');
    } catch (err) {
      const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
      setMessage(data?.error || 'Transfer was not accepted.');
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-3 text-sm">
      <h2 className="mb-2 text-xs text-zinc-400">Tip</h2>
      <input
        aria-label="Tip recipient"
        value={to}
        onChange={(e) => setTo(e.target.value.slice(0, 80))}
        placeholder="Recipient user id"
        className="mb-1 block w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
      />
      <input
        aria-label="Tip amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value.slice(0, 16))}
        inputMode="decimal"
        placeholder="Amount"
        className="mb-1 block w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
      />
      <input
        aria-label="Tip note"
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 140))}
        placeholder="Note"
        className="mb-2 block w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
      />
      <button type="button" onClick={() => void send()} className="rounded bg-teal-400 px-3 py-1 text-xs font-medium text-black">
        Send tip
      </button>
      {message && <p className="mt-2 text-[11px] text-zinc-400">{message}</p>}
    </section>
  );
}
