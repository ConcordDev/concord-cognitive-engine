'use client';

import { useEffect, useState } from 'react';
import { Gift, Plus, Loader2, Copy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface GiftCard {
  id: string; code: string; initialValue: number; balance: number;
  recipientEmail: string; recipientName: string; status: string;
  issuedAt: string; expiresAt: string | null;
}

export function GiftCardsPanel() {
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ initialValue: '50', recipientEmail: '', recipientName: '', message: '' });
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeemResult, setRedeemResult] = useState<string | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'retail', action: 'gift-cards-list', input: {} });
      setCards((res.data?.result?.giftCards || []) as GiftCard[]);
    } catch (e) { console.error('[GiftCards] list failed', e); }
    finally { setLoading(false); }
  }

  async function issue() {
    if (!form.initialValue) return;
    try {
      await lensRun({
        domain: 'retail', action: 'gift-cards-create',
        input: { initialValue: Number(form.initialValue), recipientEmail: form.recipientEmail, recipientName: form.recipientName, message: form.message },
      });
      setForm({ initialValue: '50', recipientEmail: '', recipientName: '', message: '' });
      await refresh();
    } catch (e) { console.error('[GiftCards] create failed', e); }
  }

  async function redeem() {
    if (!redeemCode || !redeemAmount) return;
    try {
      const res = await lensRun({
        domain: 'retail', action: 'gift-cards-redeem',
        input: { code: redeemCode, amount: Number(redeemAmount) },
      });
      if (res.data?.ok === false) {
        setRedeemResult(`Error: ${res.data?.error}`);
      } else {
        setRedeemResult(`Redeemed $${res.data?.result?.redeemed} · remaining $${res.data?.result?.remainingBalance}`);
        setRedeemCode(''); setRedeemAmount('');
        await refresh();
      }
    } catch (e) { setRedeemResult('Redemption failed'); console.error('[GiftCards] redeem', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Gift className="w-4 h-4 text-pink-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Gift cards</span>
        <span className="ml-auto text-[10px] text-gray-400">{cards.length} issued</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input type="number" value={form.initialValue} onChange={e => setForm({ ...form, initialValue: e.target.value })} placeholder="$ Amount" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.recipientName} onChange={e => setForm({ ...form, recipientName: e.target.value })} placeholder="Recipient" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.recipientEmail} onChange={e => setForm({ ...form, recipientEmail: e.target.value })} placeholder="Email" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={issue} className="px-3 py-1.5 text-xs rounded bg-pink-500 text-white font-bold hover:bg-pink-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Issue</button>
      </div>

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : cards.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Gift className="w-6 h-6 mx-auto mb-2 opacity-30" />No gift cards issued.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {cards.map(c => (
              <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                <div className="font-mono text-sm text-white">{c.code}</div>
                <button onClick={() => navigator.clipboard?.writeText(c.code)} aria-label="Copy gift card code" className="text-gray-400 hover:text-cyan-300"><Copy className="w-3 h-3" /></button>
                <div className="flex-1 text-[11px] text-gray-400">{c.recipientName || c.recipientEmail || '—'}</div>
                <div className="text-right">
                  <div className="font-mono text-sm tabular-nums text-pink-300">${c.balance.toFixed(2)}</div>
                  <div className="text-[10px] text-gray-400">of ${c.initialValue.toFixed(2)}</div>
                </div>
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', c.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-300')}>{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="px-3 py-2 border-t border-white/10 bg-white/[0.02] grid grid-cols-4 gap-2 text-xs">
        <input value={redeemCode} onChange={e => setRedeemCode(e.target.value.toUpperCase())} placeholder="Code to redeem" className="col-span-2 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input type="number" value={redeemAmount} onChange={e => setRedeemAmount(e.target.value)} placeholder="Amount" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={redeem} className="px-2 py-1 text-xs rounded bg-pink-500/20 text-pink-300 hover:bg-pink-500/30">Redeem</button>
        {redeemResult && <div className="col-span-4 text-[11px] text-emerald-300">{redeemResult}</div>}
      </footer>
    </div>
  );
}

export default GiftCardsPanel;
