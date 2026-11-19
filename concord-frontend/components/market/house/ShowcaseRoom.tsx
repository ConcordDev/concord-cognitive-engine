'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, Ticket } from 'lucide-react';
import { house, hourLabel, recheckDraw, type Showcase } from './houseApi';
import { LotPlate } from './LotPlate';

const REASON: Record<string, string> = {
  won_recently: 'drawn in the last 24 hours',
  no_active_lot: 'no lot on sale at the draw',
};

/** This hour's drawing, the coming hour's entry, and the draw anyone can redo. */
export function ShowcaseRoom({ showcase, signedIn, onOpen, onChanged }: { showcase: Showcase | null; signedIn: boolean; onOpen: (id: string) => void; onChanged: () => void }) {
  const [entering, setEntering] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [check, setCheck] = useState<'idle' | 'checking' | 'match' | 'mismatch'>('idle');
  const [now, setNow] = useState(() => Date.now());

  // the clock to the next drawing is the real wall clock, a minute at a time
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  if (!showcase) return <div className="ah-panel ah-skeleton h-64" role="status" aria-label="Loading the drawing" />;
  const cur = showcase.current;
  const st = showcase.standing;
  const mins = Math.max(0, Math.ceil((Date.parse(showcase.next.opensAt) - now) / 60_000));

  const enter = async () => {
    setEntering(true); setMsg(null);
    const r = await house<{ hour: string; entrants: number }>('house-showcase-enter');
    setEntering(false);
    if (r.ok) onChanged();
    else setMsg({ ok: false, text: r.message });
  };

  const recheck = async () => {
    if (!cur) return;
    setCheck('checking');
    const redo = await recheckDraw(cur.hour, cur.prevSeed, cur.eligible.map((e) => e.id), showcase.rules.winnersPerHour);
    const same = redo.seed === cur.seed && redo.winners.join() === cur.winners.map((w) => w.id).join();
    setCheck(same ? 'match' : 'mismatch');
  };

  return (
    <div className="space-y-8">
      <section className="ah-window p-5 sm:p-7" data-testid="ah-window">
        <p className="ah-label">The front window · {cur ? `drawn ${hourLabel(cur.hour)}` : 'this hour'}</p>
        <h2 className="ah-display mt-1 text-[30px] italic sm:text-[38px]">Drawn by lot, every hour.</h2>
        <p className="mt-2 max-w-[60ch] text-[14px] opacity-80">
          Any maker with a lot on sale can enter. Each hour {showcase.rules.winnersPerHour} are drawn from a seed published below, so anyone can redo the drawing.
          Sales, ratings and popularity play no part. A maker who is drawn sits out the next {showcase.rules.cooldownHours} hours.
        </p>

        {cur && cur.winners.length > 0 ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {cur.winners.map((w) => (
              <div key={w.id} data-testid="ah-winner">
                <p className="ah-display mb-2 text-[19px] italic">{w.name || 'A maker'}</p>
                {w.lots.length ? (
                  <div className="grid grid-cols-2 gap-2">{w.lots.slice(0, 2).map((l) => <LotPlate key={l.id} lot={l} onOpen={onOpen} size="sm" drawn />)}</div>
                ) : <p className="text-[13px] opacity-70">Their lots have since closed.</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-[15px] opacity-80" data-testid="ah-window-empty">{cur && cur.eligible.length === 0 && cur.excluded.length === 0 ? 'Nobody entered this hour’s drawing, so the window is dark. Enter for the next hour below.' : 'No eligible maker was drawn this hour.'}</p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="ah-panel p-5" aria-label="Enter the next drawing">
          <p className="ah-label">Next drawing</p>
          <p className="ah-display mt-1 text-[26px]"><span className="ah-num">{hourLabel(showcase.next.hour)}</span> <span className="text-[16px] ah-muted">· in {mins} min</span></p>
          <p className="mt-1 text-[13.5px] ah-muted" data-testid="ah-entrants"><span className="ah-num font-semibold ah-ink-2">{showcase.next.entrants}</span> {showcase.next.entrants === 1 ? 'maker has' : 'makers have'} entered. Who entered is shown after the draw.</p>
          <div className="mt-4">
            {!signedIn ? (
              <a className="ah-btn ah-btn-house" href={`/login?next=${encodeURIComponent('/lenses/market')}`}>Sign in to enter</a>
            ) : st?.entered ? (
              <p className="ah-okay" data-testid="ah-entered">You are entered. Entries are final, so the drawing can’t be steered.</p>
            ) : (
              <>
                <button type="button" className="ah-btn ah-btn-house" onClick={enter} disabled={entering || !st?.canEnter} data-testid="ah-enter"><Ticket className="h-4 w-4" />{entering ? 'Entering…' : 'Enter the next drawing'}</button>
                {st && !st.canEnter && (
                  <p className="mt-2 text-[13px] ah-muted">
                    {st.reason === 'no_active_lot' ? 'Consign a lot first; only makers with a lot on sale can be drawn.' : st.reason === 'won_recently' ? `You were drawn at ${st.lastWin ? hourLabel(st.lastWin) : 'an hour'} and can be drawn again from ${st.eligibleAgainAt ? new Date(st.eligibleAgainAt).toUTCString().slice(17, 22) : 'later'} UTC.` : ''}
                  </p>
                )}
              </>
            )}
            {msg && <p className={msg.ok ? 'ah-okay mt-3' : 'ah-error mt-3'} role="status">{msg.text}</p>}
          </div>
        </section>

        <section className="ah-panel p-5" aria-label="How this hour was drawn" data-testid="ah-proof">
          <p className="ah-label">How this hour was drawn</p>
          {cur ? (
            <>
              <dl className="mt-3 space-y-2 text-[13px]">
                <div><dt className="ah-muted">Hour</dt><dd className="ah-seed">{cur.hour}</dd></div>
                <div><dt className="ah-muted">Previous seed</dt><dd className="ah-seed">{cur.prevSeed}</dd></div>
                <div><dt className="ah-muted">Seed</dt><dd className="ah-seed ah-brass" data-testid="ah-seed">{cur.seed}</dd></div>
                <div><dt className="ah-muted">Eligible ({cur.eligible.length})</dt><dd className="text-[12.5px] ah-ink-2">{cur.eligible.length ? cur.eligible.map((e) => e.name || e.id).join(', ') : 'none'}</dd></div>
                {cur.excluded.length > 0 && <div><dt className="ah-muted">Sat out ({cur.excluded.length})</dt><dd className="text-[12.5px] ah-ink-2">{cur.excluded.map((e) => `${e.name || e.id} — ${REASON[e.reason] || e.reason}`).join('; ')}</dd></div>}
              </dl>
              <p className="mt-3 text-[12px] ah-muted">{showcase.rules.formula}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className="ah-btn" onClick={recheck} disabled={check === 'checking'} data-testid="ah-recheck"><ShieldCheck className="h-4 w-4" />Redo the drawing here</button>
                {check === 'match' && <span className="text-[13px] ah-good" data-testid="ah-recheck-ok">Your browser drew the same seed and the same {cur.winners.length} winners.</span>}
                {check === 'mismatch' && <span className="text-[13px] ah-bad" data-testid="ah-recheck-bad">Your browser got a different result. This drawing does not check out.</span>}
              </div>
            </>
          ) : <p className="mt-2 text-[13px] ah-muted">This hour has not been drawn yet.</p>}
        </section>
      </div>

      {showcase.recent.length > 0 && (
        <section>
          <p className="ah-label mb-2">Earlier drawings</p>
          <ul className="ah-panel divide-y divide-[var(--ah-rule)] text-[13px]">
            {showcase.recent.map((r) => (
              <li key={r.hour} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                <span className="ah-num">{r.hour.slice(0, 10)} {hourLabel(r.hour)}</span>
                <span className="ah-muted">{r.winners} drawn of {r.eligible} eligible</span>
                <span className="ah-seed ah-faint">{r.seed.slice(0, 16)}…</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
