'use client';

import { useState } from 'react';
import { api } from '@/lib/api/client';

interface ListingCard {
  id: string;
  title?: string | null;
  price?: number;
  priceCents?: number;
  currency?: string;
  transferRate?: number;
  marketplaceRate?: number;
}

interface ShareResult {
  ok?: boolean;
  error?: string;
  listing?: ListingCard;
  studio?: { name?: string; audioUrl?: string | null };
  post?: { id?: string; content?: string; mediaType?: string; mediaUrl?: string | null };
}

function ListingLine({ listing }: { listing: ListingCard }) {
  const price = typeof listing.price === 'number'
    ? String(listing.price)
    : typeof listing.priceCents === 'number'
      ? `${listing.priceCents} cents`
      : null;
  return (
    <p className="text-xs text-zinc-300">
      Listing {listing.id}
      {listing.title ? ` · ${listing.title}` : ''}
      {price ? ` · ${price}${listing.currency ? ` ${listing.currency}` : ''}` : ''}
      {typeof listing.transferRate === 'number' ? ` · transfer ${listing.transferRate}` : ''}
      {typeof listing.marketplaceRate === 'number' ? ` · marketplace ${listing.marketplaceRate}` : ''}
    </p>
  );
}

/** Share a listing you own, or a studio asset you own, into the social store. */
export function ShareToSocial() {
  const [listingId, setListingId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [result, setResult] = useState<ShareResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function shareListing() {
    const id = listingId.trim();
    if (!id) return;
    setMessage(null);
    setResult(null);
    try {
      const res = await api.post<ShareResult>(`/api/social/listings/${encodeURIComponent(id)}/share`, {});
      if (res.data?.ok === false) {
        setMessage(res.data.error || 'Could not share that listing.');
        return;
      }
      setResult(res.data || null);
    } catch {
      setMessage('Could not share that listing.');
    }
  }

  async function shareStudio() {
    if (!projectId.trim() || !assetId.trim()) return;
    setMessage(null);
    setResult(null);
    try {
      const res = await api.post<ShareResult>('/api/social/studio/share', {
        projectId: projectId.trim(),
        assetId: assetId.trim(),
      });
      if (res.data?.ok === false) {
        setMessage(res.data.error || 'Could not share that asset.');
        return;
      }
      setResult(res.data || null);
    } catch {
      setMessage('Could not share that asset.');
    }
  }

  const audioUrl = result?.studio?.audioUrl || (result?.post?.mediaType === 'audio' ? result.post.mediaUrl : null);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-3 text-sm">
      <h2 className="mb-2 text-xs text-zinc-400">Share to Social</h2>
      <label className="mb-2 block text-xs text-zinc-400">
        Listing id
        <span className="mt-1 flex gap-1">
          <input
            aria-label="Listing id"
            value={listingId}
            onChange={(e) => setListingId(e.target.value.slice(0, 80))}
            className="flex-1 rounded bg-zinc-900 px-2 py-1 text-zinc-100"
          />
          <button type="button" onClick={() => void shareListing()} className="rounded bg-teal-400 px-2 py-1 text-xs font-medium text-black">
            Share listing
          </button>
        </span>
      </label>
      <label className="mb-1 block text-xs text-zinc-400">
        Studio project id
        <input
          aria-label="Studio project id"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value.slice(0, 80))}
          className="mt-1 block w-full rounded bg-zinc-900 px-2 py-1 text-zinc-100"
        />
      </label>
      <label className="mb-2 block text-xs text-zinc-400">
        Studio asset id
        <span className="mt-1 flex gap-1">
          <input
            aria-label="Studio asset id"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value.slice(0, 80))}
            className="flex-1 rounded bg-zinc-900 px-2 py-1 text-zinc-100"
          />
          <button type="button" onClick={() => void shareStudio()} className="rounded bg-white/10 px-2 py-1 text-xs text-zinc-100">
            Share asset
          </button>
        </span>
      </label>
      {result?.listing && <ListingLine listing={result.listing} />}
      {result?.post?.content && <p className="text-xs text-zinc-300">{result.post.content}</p>}
      {audioUrl && <audio controls src={audioUrl} className="mt-2 w-full" />}
      {result?.studio && !audioUrl && (
        <p className="text-[11px] text-zinc-500">Shared without a public audio file. Studio playback stays on the owner-only audio route.</p>
      )}
      {message && <p className="mt-2 text-[11px] text-zinc-400">{message}</p>}
    </section>
  );
}
