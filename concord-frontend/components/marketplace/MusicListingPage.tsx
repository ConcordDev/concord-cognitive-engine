'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';

const LICENSE_LABEL: Record<string, string> = {
  personal: 'Personal use',
  nonexclusive: 'Non-exclusive lease',
  exclusive: 'Exclusive',
  'cc-by': 'CC-BY',
  standard: 'Standard',
};

interface PreviewMeta {
  artist?: string;
  genre?: string;
  bpm?: number | null;
  key?: string | null;
  coverArtifactId?: string | null;
}

interface Listing {
  id: string;
  title: string;
  sellerId: string;
  price: number;
  status: string;
  licenseType: string;
  description?: string | null;
  preview?: PreviewMeta | null;
}

function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { error?: string } } }).response?.data;
    if (data?.error) return data.error;
  }
  return e instanceof Error ? e.message : 'Request failed';
}

export function MusicListingPage({ id }: { id: string }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(`/api/economy/marketplace/listings/${encodeURIComponent(id)}`).then((r) => {
      const body = r.data as { ok?: boolean; listing?: Listing; error?: string };
      if (!live) return;
      if (!body.ok || !body.listing) setError(body.error || 'Listing not found');
      else setListing(body.listing);
    }).catch((e) => { if (live) setError(errText(e)); });
    api.get('/api/auth/me').then((r) => {
      const body = r.data as { user?: { id?: string } };
      if (live) setMe(body.user?.id || null);
    }).catch(() => { if (live) setMe(null); });
    return () => { live = false; };
  }, [id]);

  const buy = async () => {
    if (!listing) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await api.post('/api/economy/marketplace/purchase', { listing_id: listing.id });
      const body = r.data as { ok?: boolean; error?: string; free?: boolean };
      if (!body.ok) throw new Error(body.error || 'Purchase failed');
      setNotice(body.free || listing.price === 0
        ? 'You have this track. The master download is below.'
        : 'Purchased with your Concord balance. The master download is below.');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const unlist = async () => {
    if (!listing) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(`/api/economy/marketplace/listings/${encodeURIComponent(listing.id)}/delist`);
      const body = r.data as { ok?: boolean; error?: string; status?: string };
      if (!body.ok) throw new Error(body.error || 'Unlist failed');
      setListing({ ...listing, status: body.status || 'delisted' });
      setNotice('Unlisted. The preview is no longer public.');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && !listing) return <main className="mx-auto max-w-xl p-6 text-sm text-red-300">{error}</main>;
  if (!listing) return <main className="mx-auto max-w-xl p-6 text-sm text-zinc-400">Loading listing…</main>;
  const preview = listing.preview && !Array.isArray(listing.preview) ? listing.preview : null;
  const mine = !!me && me === listing.sellerId;
  const active = listing.status === 'active';
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6 text-zinc-100" data-testid="music-listing">
      <h1 className="text-xl font-semibold">{listing.title}</h1>
      <p className="text-sm text-zinc-400">
        {preview?.artist || 'Artist not set'}
        {preview?.genre ? ` · ${preview.genre}` : ''}
        {preview?.bpm ? ` · ${preview.bpm} BPM` : ''}
        {preview?.key ? ` · ${preview.key}` : ''}
      </p>
      <p className="text-sm">{LICENSE_LABEL[listing.licenseType] || listing.licenseType}</p>
      <p className="text-sm">{listing.price === 0 ? 'Free' : `${listing.price} Concord coins`} · {listing.status}</p>
      {preview?.coverArtifactId && active && (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="h-48 w-48 rounded object-cover" src={`/api/economy/marketplace/listings/${encodeURIComponent(listing.id)}/cover`} />
      )}
      {active && (
        <audio controls src={`/api/economy/marketplace/listings/${encodeURIComponent(listing.id)}/preview`} className="w-full" />
      )}
      {!active && <p className="text-sm text-zinc-400">This listing is {listing.status}. The preview is not public.</p>}
      <div className="flex gap-2">
        {active && !mine && (
          <button onClick={() => void buy()} disabled={busy} className="rounded bg-violet-600 px-3 py-1.5 text-sm disabled:opacity-50" data-testid="music-listing-buy">
            {listing.price === 0 ? 'Get for free' : `Buy for ${listing.price}`}
          </button>
        )}
        {mine && active && (
          <button onClick={() => void unlist()} disabled={busy} className="rounded bg-white/10 px-3 py-1.5 text-sm" data-testid="music-listing-unlist">Unlist</button>
        )}
        <a className="rounded bg-white/10 px-3 py-1.5 text-sm" href={`/api/economy/marketplace/listings/${encodeURIComponent(listing.id)}/master`}>Download master</a>
      </div>
      {listing.price > 0 && <p className="text-[11px] text-zinc-500">The master stays locked until you buy it with your Concord balance, or you are the seller. A download before that returns 403.</p>}
      {notice && <p className="text-sm text-emerald-300">{notice}</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}
    </main>
  );
}
