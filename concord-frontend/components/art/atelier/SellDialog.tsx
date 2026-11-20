'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type License = 'nonexclusive' | 'personal' | 'exclusive' | 'cc-by';
const LICENSES: { id: License; label: string; text: string }[] = [
  { id: 'nonexclusive', label: 'Standard', text: 'Buyers may use it in their own work; others can buy it too.' },
  { id: 'personal', label: 'Personal use', text: 'For the buyer’s own use only.' },
  { id: 'exclusive', label: 'Exclusive', text: 'Sold once. The lot closes when it sells.' },
  { id: 'cc-by', label: 'CC BY', text: 'Anyone may reuse it with credit; buying supports you.' },
];
interface Lot { id: string; title: string; price: number; free: boolean; status: string; sold: number; revenue?: number }
interface Terms { combinedRate: number; balance: number | null }

function csrf(): Record<string, string> {
  const m = typeof document !== 'undefined' ? document.cookie.match(/csrf_token=([^;]+)/) : null;
  return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {};
}
const REFUSED: Record<string, string> = {
  duplicate_content: 'This exact picture is already on sale. Identical pictures are refused so nobody can relist someone else’s work; change the piece and try again.',
  cover_not_image: 'The picture could not be read as an image.',
  invalid_price: 'Prices are 0 (free) or from 0.01 CC.',
  exclusive_needs_price: 'An exclusive lot sells once, so it needs a price.',
  not_owner: 'The filed picture is not yours.',
  auth_required: 'Sign in to sell.',
};
const lotNo = (id: string) => id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();
const cc = (n: number) => `${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} CC`;

/**
 * Put the piece on sale in the Auction House. The canvas is rendered to PNG,
 * filed as your image DTU through the platform artifact route (so it is its
 * own cover), and consigned as a lot through market.house-consign.
 */
export function SellDialog({ canvas, artwork, onClose }: { canvas: HTMLCanvasElement | null; artwork: { id: string; title: string }; onClose: () => void }) {
  const [title, setTitle] = useState(artwork.title);
  const [priceText, setPriceText] = useState('15');
  const [license, setLicense] = useState<License>('nonexclusive');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'form' | 'rendering' | 'filing' | 'consigning' | 'done'>('form');
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<Lot | null>(null);
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);

  useEffect(() => {
    void lensRun<{ lots: Lot[] }>('market', 'house-lots-for-piece', { sourceArtworkId: artwork.id }).then((r) => setLots(r.data?.ok ? r.data.result?.lots || [] : []));
    void lensRun<Terms>('market', 'house-terms', {}).then((r) => { if (r.data?.ok) setTerms(r.data.result); });
  }, [artwork.id, made]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && step !== 'filing' && step !== 'consigning') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step]);

  const price = Number(priceText);
  const priceOk = priceText.trim() !== '' && Number.isFinite(price) && (price === 0 || price >= 0.01) && price <= 1_000_000;
  const fee = terms && priceOk && price > 0 ? Math.round(price * terms.combinedRate * 100) / 100 : 0;

  const sell = async () => {
    if (!canvas) { setErr('The canvas is not ready yet.'); return; }
    setErr(null);
    setStep('rendering');
    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
    if (!blob) { setStep('form'); setErr('The canvas could not be rendered.'); return; }
    setStep('filing');
    let dtuId: string | undefined;
    try {
      const res = await fetch('/api/artifact/upload', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent(`${title || 'piece'}.png`), 'X-Title': encodeURIComponent(title.trim() || artwork.title), 'X-Domain': 'art', ...csrf() },
        body: blob,
      });
      const body = (await res.json().catch(() => ({}))) as { dtuId?: string; error?: string };
      if (!res.ok || !body.dtuId) throw new Error(body.error || 'The piece could not be filed.');
      dtuId = body.dtuId;
    } catch (e) { setStep('form'); setErr((e as Error).message); return; }
    setStep('consigning');
    const r = await lensRun<{ lot: Lot }>('market', 'house-consign', { dtuId, title: title.trim(), price, license, description: note.trim(), sourceArtworkId: artwork.id });
    if (!r.data?.ok || !r.data.result?.lot) { setStep('form'); setErr(r.data?.message || REFUSED[String(r.data?.error)] || String(r.data?.error || 'The lot could not be consigned.')); return; }
    setMade(r.data.result.lot);
    setStep('done');
  };

  const busy = step === 'rendering' || step === 'filing' || step === 'consigning';
  return (
    <div className="at-scrim fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal aria-label="Put on sale" data-testid="at-sell-dialog">
      <div className="at-card at-rise at-scroll max-h-[90vh] w-full max-w-[560px] overflow-y-auto p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="at-label">Through the Auction House</p>
            <h2 className="at-display text-[26px] leading-tight">Put “{artwork.title}” on sale</h2>
          </div>
          <button type="button" className="at-btn at-btn-quiet" onClick={onClose} disabled={busy} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        {lots && lots.length > 0 && (
          <div className="mb-4">
            <p className="at-label mb-1">Already on sale from this piece</p>
            <ul className="space-y-1" data-testid="at-piece-lots">
              {lots.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-2 text-[13px]">
                  <a className="underline" href={`/lenses/market?lot=${encodeURIComponent(l.id)}`}>Lot {lotNo(l.id)} · {l.title}</a>
                  <span className="at-num text-[color:var(--at-muted)]">{l.free ? 'Free' : cc(l.price)} · {l.sold} sold · {l.status === 'active' ? 'on sale' : l.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === 'done' && made ? (
          <div className="space-y-3">
            <p className="at-okay" data-testid="at-sold-ok">Consigned as Lot {lotNo(made.id)} at {made.free ? 'no charge' : cc(made.price)}. Buyers can find it in the Auction House now.</p>
            <div className="flex gap-2">
              <a className="at-btn at-btn-paint" href={`/lenses/market?lot=${encodeURIComponent(made.id)}`}>See the lot</a>
              <button type="button" className="at-btn" onClick={onClose}>Back to the easel</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block"><span className="at-label">Title</span><input className="at-input mt-1" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="block"><span className="at-label">Price in CC (0 for free)</span><input className="at-input at-num mt-1" inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value.replace(/[^0-9.]/g, ''))} data-testid="at-sell-price" /></label>
            <fieldset>
              <legend className="at-label mb-1">Licence</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {LICENSES.map((l) => (
                  <label key={l.id} className="cursor-pointer rounded-md border border-[color:var(--at-rule)] p-2 text-[12.5px] has-[:checked]:border-[color:var(--at-accent)]">
                    <input type="radio" name="sell-licence" className="mr-1.5 accent-[color:var(--at-accent)]" checked={license === l.id} onChange={() => setLicense(l.id)} />
                    <span className="font-medium">{l.label}</span>
                    <span className="mt-0.5 block text-[11.5px] text-[color:var(--at-muted)]">{l.text}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block"><span className="at-label">A note for buyers (optional)</span><textarea className="at-input mt-1 h-auto py-2" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <p className="text-[12.5px] text-[color:var(--at-muted)]">
              {!priceOk ? 'Prices are 0 (free) or from 0.01 CC.' : price === 0 ? 'Free: anyone can take it.' : <>Each sale pays you <span className="at-num font-semibold text-[color:var(--at-ink)]">{cc(Math.round((price - fee) * 100) / 100)}</span> after the {terms ? (terms.combinedRate * 100).toFixed(2) : '5.46'}% house fee.</>}
              {' '}The picture is filed as an image DTU of yours and is its own cover. The canvas stays yours to keep painting.
            </p>
            {err && <p className="at-error" role="alert" data-testid="at-sell-error">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="at-btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="at-btn at-btn-paint" onClick={sell} disabled={busy || !priceOk || !title.trim() || (license === 'exclusive' && price === 0)} data-testid="at-sell-go">
                {step === 'rendering' ? 'Rendering…' : step === 'filing' ? 'Filing the picture…' : step === 'consigning' ? 'Consigning…' : 'Consign the piece'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
