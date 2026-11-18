'use client';

/**
 * The shop sign: the merchant's own shop name (retail.storefront-get, set
 * once through retail.storefront-configure), the till state
 * (retail.till-status) with open / close, and the sound toggle.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Pencil, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { retail, money, timeAgo, type Storefront, type TillStatus } from './retailApi';
import { TillSheet } from './TillSheet';
import { soundEnabled, setSoundEnabled } from './stallSound';

export function ShopSign({ refreshKey }: { refreshKey: number }) {
  const [shop, setShop] = useState<Storefront | null>(null);
  const [till, setTill] = useState<TillStatus | null>(null);
  const [sheet, setSheet] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [sound, setSound] = useState(false);

  useEffect(() => { setSound(soundEnabled()); }, []);

  const loadTill = useCallback(async () => {
    const r = await retail<TillStatus>('till-status');
    if (r.ok && r.result) setTill(r.result);
  }, []);

  useEffect(() => {
    retail<{ storefront: Storefront }>('storefront-get').then((r) => { if (r.ok && r.result) setShop(r.result.storefront); });
  }, []);
  useEffect(() => { loadTill(); }, [loadTill, refreshKey]);

  const saveName = async () => {
    setSavingName(true); setNameErr(null);
    const r = await retail<{ storefront: Storefront }>('storefront-configure', { name: name.trim(), tagline: shop?.tagline || '' });
    setSavingName(false);
    if (r.ok && r.result) { setShop(r.result.storefront); setNaming(false); }
    else setNameErr(r.error || 'Could not save the name.');
  };

  const toggleSound = () => { const next = !sound; setSound(next); setSoundEnabled(next); };

  return (
    <div className="stall-wood relative flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 shadow-[inset_0_-3px_0_rgba(0,0,0,0.25)]">
      <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
        {naming ? (
          <form onSubmit={(e) => { e.preventDefault(); saveName(); }} className="flex items-center gap-2">
            <input autoFocus aria-label="Shop name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Your shop's name"
              className="h-9 min-w-0 flex-1 rounded-md bg-black/25 px-3 font-[family-name:var(--stall-font-marker)] text-[18px] text-[color:var(--stall-paper)] placeholder:text-white/40 focus:outline-none" />
            <button type="submit" disabled={!name.trim() || savingName} className="h-9 rounded-md bg-black/30 px-3 text-[13px] text-[color:var(--stall-paper)] disabled:opacity-40">{savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hang it'}</button>
            <button type="button" onClick={() => setNaming(false)} className="h-9 rounded-md px-2 text-[13px] text-white/70">Cancel</button>
            {nameErr && <span role="alert" className="text-[12px] text-[color:var(--stall-paper)]">{nameErr}</span>}
          </form>
        ) : (
          <button type="button" onClick={() => { setName(shop?.name || ''); setNaming(true); }} className="group flex min-w-0 items-baseline gap-2 text-left" title="Rename the shop">
            <span className={cn('truncate font-[family-name:var(--stall-font-marker)] text-[24px] leading-none text-[color:var(--stall-paper)] drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]', !shop?.name && 'opacity-70')}>
              {shop === null ? '…' : shop.name || 'Name your stall'}
            </span>
            {shop?.tagline && <span className="hidden truncate font-[family-name:var(--stall-font-hand)] text-[18px] text-white/75 sm:inline">{shop.tagline}</span>}
            <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-white/50 opacity-0 group-hover:opacity-100" />
          </button>
        )}
      </div>

      <div className="flex-1 sm:hidden" />
      <button type="button" onClick={toggleSound} aria-pressed={sound} title={sound ? 'Sounds on (till + bell)' : 'Sounds off'}
        className="rounded-md bg-black/20 p-2 text-[color:var(--stall-paper)] hover:bg-black/30">
        {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4 opacity-70" />}
      </button>

      <button type="button" onClick={() => till && setSheet(true)} disabled={!till}
        aria-label={till === null ? 'Till status loading' : till.open ? `Till open, ${money(till.figures?.expectedCash)} in drawer — close the till` : 'Till closed — open the shop'}
        className={cn('flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium shadow-sm',
          till?.open ? 'bg-[color:var(--stall-board)] text-[color:var(--stall-chalk)]' : 'bg-[color:var(--stall-paper)] text-[color:var(--stall-ink)]')}>
        <span className={cn('h-2 w-2 rounded-full', till?.open ? 'bg-[color:var(--stall-leaf)]' : 'bg-[color:var(--stall-tomato)]')} />
        {till === null ? 'Till…' : till.open
          ? <>Open<span className="hidden sm:inline"> · {timeAgo(till.session?.openedAt)}</span> · <span className="font-[family-name:var(--stall-font-till)]">{money(till.figures?.expectedCash)}</span> in drawer</>
          : <>Closed<span className="hidden sm:inline"> — open the shop</span><span className="sm:hidden"> · open shop</span></>}
      </button>

      {sheet && till && <TillSheet status={till} onClose={() => setSheet(false)} onChanged={() => loadTill()} />}
    </div>
  );
}

export default ShopSign;
