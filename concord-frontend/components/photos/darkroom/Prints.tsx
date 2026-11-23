'use client';

/**
 * Prints: the photos people have released. Everyone sees the wall of
 * proofs; a photographer manages their own releases (price, withdraw, how
 * many sold); a buyer keeps the full files they bought.
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, ShoppingBag } from 'lucide-react';
import { api } from '@/lib/api/client';
import { dr, type Release } from './dr';

type Tab = 'wall' | 'mine' | 'owned';

async function downloadRelease(r: Release): Promise<string | null> {
  const res = await api.get(r.downloadUrl, { responseType: 'blob', validateStatus: () => true, timeout: 300_000 });
  if (res.status !== 200) { try { return JSON.parse(await (res.data as Blob).text()).error || `download failed (${res.status})`; } catch { return `download failed (${res.status})`; } }
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a'); a.href = url; a.download = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] || ''))?.[1] || `${r.title}.jpg`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return null;
}

export function Prints({ signedIn, onToast }: { signedIn: boolean; onToast: (s: string) => void }) {
  const [tab, setTab] = useState<Tab>('wall');
  const [list, setList] = useState<Release[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Release | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState('');

  const load = useCallback(async () => {
    setList(null); setErr(null);
    if (tab === 'wall') {
      try {
        const r = await api.get('/api/photos/releases', { validateStatus: () => true });
        if (!r.data?.ok) throw new Error(r.data?.error || `HTTP ${r.status}`);
        setList(r.data.releases);
      } catch (e) { setErr(e instanceof Error ? e.message : 'The wall did not load.'); }
      return;
    }
    const r = await dr<{ releases: Release[] }>('release-list', tab === 'mine' ? { mine: true } : { owned: true });
    if (!r.ok) { setErr(r.error); return; }
    setList(r.result!.releases);
  }, [tab]);
  useEffect(() => { void load(); }, [load]);

  const refreshOne = async (id: string) => {
    const r = await dr<{ release: Release }>('release-get', { id });
    if (r.ok) { setOpen(r.result!.release); setList((l) => l && l.map((x) => (x.id === id ? r.result!.release : x))); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="dr-prints">
      <div className="flex items-center gap-1 border-b border-[var(--dr-rule)] px-3" role="tablist" aria-label="Prints">
        {(['wall', 'mine', 'owned'] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className="dr-tab" onClick={() => setTab(t)} disabled={t !== 'wall' && !signedIn}>
            {t === 'wall' ? 'The wall' : t === 'mine' ? 'Your releases' : 'Bought'}
          </button>
        ))}
      </div>
      <div className="dr-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {err && <p className="dr-error" role="alert">{err}</p>}
        {!list && !err && <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="dr-skeleton aspect-[4/3]" />)}</div>}
        {list && !list.length && <p className="mx-auto mt-16 max-w-sm text-center text-[13px] text-[var(--dr-muted)]">{tab === 'wall' ? 'Nobody has released a photo yet.' : tab === 'mine' ? 'Release a photo from the Develop room to put it on the wall.' : "Photos you buy land here, full size, yours to keep."}</p>}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3" data-testid="dr-prints-grid">
          {list?.map((r) => (
            <li key={r.id}>
              <button type="button" className="dr-thumb w-full text-left" onClick={() => { setOpen(r); setConfirm(false); setPrice(String(r.priceCC)); }} aria-label={`${r.title} by ${r.photographer.name}`}>
                <div className="flex aspect-[4/3] items-center justify-center bg-[var(--dr-well)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.proofUrl} alt={r.title} loading="lazy" className="max-h-full max-w-full object-contain" />
                </div>
                <div className="px-2 py-1.5">
                  <p className="dr-title truncate text-[15px] italic">{r.title}</p>
                  <p className="flex justify-between text-[11.5px] text-[var(--dr-muted)]"><span>{r.photographer.isMe ? 'you' : r.photographer.name}</span><span className="dr-mono">{r.priceCC > 0 ? `${r.priceCC} CC` : 'free'}{r.status === 'withdrawn' ? ' · withdrawn' : ''}</span></p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal aria-label={open.title} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(null); }}>
          <button type="button" className="absolute inset-0 cursor-default bg-black/75" aria-label="Close" tabIndex={-1} onClick={() => setOpen(null)} />
          <div className="dr-panel dr-rise relative grid w-full max-w-4xl gap-4 p-4 md:grid-cols-[1fr,280px]" data-testid="dr-print">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.proofUrl} alt={open.title} className="max-h-[70vh] w-full object-contain" />
            <div className="space-y-2 text-[12.5px]">
              <p className="dr-title text-[22px] italic leading-tight">{open.title}</p>
              <p className="text-[var(--dr-muted)]">by {open.photographer.isMe ? 'you' : open.photographer.name}</p>
              {open.description && <p className="text-[var(--dr-ink-2)]">{open.description}</p>}
              <p className="dr-mono text-[11.5px] text-[var(--dr-ink-2)]">{open.width} × {open.height} · {open.format.toUpperCase()}{open.buyers != null ? ` · ${open.buyers} sold` : ''}</p>
              {open.canDownload ? (
                <button type="button" className="dr-btn dr-btn-safe w-full justify-center" disabled={busy} onClick={async () => { setBusy(true); const e = await downloadRelease(open); setBusy(false); if (e) onToast(e); }} data-testid="dr-print-download"><Download className="h-3.5 w-3.5" /> {busy ? 'Preparing…' : `Download ${open.width} × ${open.height}`}</button>
              ) : !signedIn ? (
                <p className="text-[var(--dr-muted)]">Sign in to buy the full file ({open.priceCC} CC).</p>
              ) : !confirm ? (
                <button type="button" className="dr-btn dr-btn-safe w-full justify-center" onClick={() => setConfirm(true)} data-testid="dr-print-buy"><ShoppingBag className="h-3.5 w-3.5" /> Buy for {open.priceCC} CC</button>
              ) : (
                <div className="space-y-1">
                  <p>Pay {open.priceCC} CC for the full-size file? 95% goes to the photographer.</p>
                  <div className="flex gap-2">
                    <button type="button" className="dr-btn dr-btn-safe flex-1 justify-center" disabled={busy} data-testid="dr-print-pay" onClick={async () => {
                      setBusy(true);
                      const r = await dr<{ release: Release }>('release-buy', { id: open.id });
                      setBusy(false); setConfirm(false);
                      if (!r.ok) { onToast(r.error || 'The purchase did not go through.'); return; }
                      setOpen(r.result!.release); onToast('Bought: the full file is yours.');
                    }}>{busy ? 'Paying…' : 'Pay'}</button>
                    <button type="button" className="dr-btn" onClick={() => setConfirm(false)}>Not now</button>
                  </div>
                </div>
              )}
              {open.photographer.isMe && open.status === 'published' && (
                <div className="space-y-1 border-t border-[var(--dr-rule)] pt-2">
                  {open.priceCC > 0 && (
                    <form className="flex items-center gap-1" onSubmit={async (e) => { e.preventDefault(); const r = await dr('release-update', { id: open.id, priceCC: Number(price) }); onToast(r.ok ? 'Price changed.' : r.error || 'Not changed.'); if (r.ok) void refreshOne(open.id); }}>
                      <input className="dr-input dr-mono w-20" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="New price in CC" /> <span>CC</span>
                      <button type="submit" className="dr-btn h-7">Change price</button>
                    </form>
                  )}
                  <button type="button" className="dr-btn w-full justify-center" onClick={async () => { const r = await dr('release-withdraw', { id: open.id }); onToast(r.ok ? 'Withdrawn: buyers keep theirs.' : r.error || 'Not withdrawn.'); if (r.ok) { setOpen(null); void load(); } }} data-testid="dr-print-withdraw">Withdraw</button>
                </div>
              )}
              <button type="button" className="dr-btn w-full justify-center" onClick={() => setOpen(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
