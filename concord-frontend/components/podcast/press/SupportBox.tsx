'use client';

/**
 * Pay a creator: a tip in CC (a ledger transfer; the box says what the
 * creator gets after the transfer fee) or the show's supporter pass (a
 * marketplace sale that unlocks every supporters-only episode). Only shows
 * made on Concord can be paid; an outside feed has no creator here.
 */

import { useEffect, useState } from 'react';
import { Heart, KeyRound } from 'lucide-react';
import { cc, pc, pcw, type PassStatus, type Show } from './pc';

const TIPS = [1, 3, 5, 10];

export function SupportBox({ show, episodeId, compact = false, onSupported }: { show: Show; episodeId?: string; compact?: boolean; onSupported?: () => void }) {
  const [pass, setPass] = useState<PassStatus | null>(null);
  const [amount, setAmount] = useState(3);
  const [busy, setBusy] = useState<'tip' | 'pass' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void pc<PassStatus>('supporter-status', { showId: show.id }).then((r) => { if (live && r.ok) setPass(r.result); });
    return () => { live = false; };
  }, [show.id]);

  if (!show.isCreatorShow) return null;
  if (pass?.isCreator) return null;
  const fee = pass?.tipFeeRate ?? 0.0146;

  const tip = async () => {
    setBusy('tip'); setMsg(null);
    const r = await pcw<{ amount: number; creatorGets: number; balance: number }>('show-tip', { showId: show.id, episodeId, amount });
    setBusy(null);
    setMsg(r.ok && r.result
      ? { ok: true, text: `Sent ${cc(r.result.amount)}. ${show.author || 'The creator'} gets ${cc(r.result.creatorGets)}; your balance is ${cc(r.result.balance)}.` }
      : { ok: false, text: r.error || 'The tip did not go through.' });
  };
  const buy = async () => {
    setBusy('pass'); setMsg(null);
    const r = await pcw<PassStatus & { price: number }>('supporter-pass-buy', { showId: show.id });
    setBusy(null);
    if (r.ok && r.result) { setPass(r.result); setMsg({ ok: true, text: `You support ${show.title}. Every supporters-only episode is open to you.` }); onSupported?.(); }
    else setMsg({ ok: false, text: r.error || 'The purchase did not go through.' });
  };

  return (
    <aside className={compact ? 'space-y-3' : 'tp-card space-y-3 p-4'} aria-label={`Support ${show.title}`} data-testid="tp-support">
      {!compact && <p className="tp-kicker">Support the show</p>}
      <div>
        <p className="tp-label mb-1.5 flex items-center gap-1"><Heart className="h-3 w-3" /> Tip</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {TIPS.map((t) => <button key={t} type="button" className="tp-chip tp-mono" aria-pressed={amount === t} onClick={() => setAmount(t)}>{t} CC</button>)}
          <button type="button" className="tp-btn ml-auto" onClick={tip} disabled={busy !== null} data-testid="tp-tip">{busy === 'tip' ? 'Sending…' : `Tip ${amount} CC`}</button>
        </div>
        <p className="mt-1 text-[11.5px] text-[color:var(--tp-muted)]">They get {cc(Math.round(amount * (1 - fee) * 100) / 100)} after the {(fee * 100).toFixed(2)}% transfer fee.</p>
      </div>
      {pass?.hasPass && (
        <div className="tp-hair pt-3">
          <p className="tp-label mb-1 flex items-center gap-1"><KeyRound className="h-3 w-3" /> Supporter pass</p>
          {pass.supporter ? (
            <p className="tp-ok">You support this show.</p>
          ) : (
            <>
              <p className="text-[13.5px]">{pass.perks || 'Every supporters-only episode, now and later.'}</p>
              <p className="mt-0.5 text-[12px] text-[color:var(--tp-muted)]">{pass.supportersOnlyEpisodes} supporters-only episode{pass.supportersOnlyEpisodes === 1 ? '' : 's'} so far · one payment, no renewal.</p>
              <button type="button" className="tp-btn tp-btn-signal mt-2 w-full" onClick={buy} disabled={busy !== null} data-testid="tp-buy-pass">{busy === 'pass' ? 'Paying…' : `Become a supporter · ${cc(pass.priceCC || 0)}`}</button>
            </>
          )}
        </div>
      )}
      {msg && <p className={msg.ok ? 'tp-ok' : 'tp-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </aside>
  );
}
