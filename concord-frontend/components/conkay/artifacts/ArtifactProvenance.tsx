'use client';

// components/conkay/artifacts/ArtifactProvenance.tsx
//
// Phase S4 — provenance-in-space + "Own it". Reads ONLY fields the backend
// already produced (invariant #6: provenance is truthful; absent fields are
// omitted, not invented):
//   • a Grounded badge — these artifacts are real computed/published macro
//     outputs, so "Grounded" is the honest verify state (never "Reasoned").
//   • the source macro (domain·macro).
//   • the real DTU id + lineage (parent DTUs cited), WHEN published. A
//     locally-iterated, un-republished edit has no dtuId → it honestly reads
//     "not yet published", and the "List it" affordance is hidden (you can't
//     own an unsaved edit).
//
// S4-b "List it" is MONEY-ADJACENT and deliberately conservative: it REUSES the
// existing `marketplace.listings-create` macro (no new payment/royalty code — a
// pinning test guards that) to create a DRAFT listing. Nothing goes on sale
// until the user publishes it in the Marketplace; no funds move here. Timer-free
// (the await is the wait) so the honest-hologram gate stays green.

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { ConkayArtifact } from '@/lib/conkay/artifact-kinds';

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function ArtifactProvenance({ artifact }: { artifact: ConkayArtifact }) {
  const dtuId = artifact.dtuId ?? null;
  const lineage = artifact.lineage ?? [];
  const title = artifact.components[0]?.label || `${artifact.sourceDomain} artifact`;

  const [listing, setListing] = useState<'idle' | 'form' | 'listing' | 'done'>('idle');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listingNumber, setListingNumber] = useState<string | null>(null);

  const list = async () => {
    const priceUsd = Number(price);
    if (!Number.isFinite(priceUsd) || priceUsd < 0) {
      setError('Enter a valid price (0 or more).');
      return;
    }
    setError(null);
    setListing('listing');
    try {
      // REUSE the existing generic listing macro — no fee/royalty math here.
      const env = await lensRun('marketplace', 'listings-create', {
        title,
        priceUsd,
        kind: 'digital_download',
        description: `Concord DTU ${dtuId} — ${artifact.sourceDomain}.${artifact.sourceMacro}`,
        tags: dtuId ? [dtuId, artifact.sourceDomain] : [artifact.sourceDomain],
      });
      const result = env?.data?.result as { listing?: { number?: string } } | null;
      if (!env?.data?.ok || !result?.listing) {
        setListing('form');
        setError(env?.data?.error ?? 'Could not create the listing.');
        return;
      }
      setListingNumber(result.listing.number ?? null);
      setListing('done');
    } catch (e) {
      setListing('form');
      setError(e instanceof Error ? e.message : 'request failed');
    }
  };

  return (
    <div data-testid="ck-provenance" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px]">
      <span data-testid="ck-provenance-grounded" className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-300">
        ✓ Grounded
      </span>
      <span className="font-mono text-cyan-200/70">
        {artifact.sourceDomain}.{artifact.sourceMacro}
      </span>

      {dtuId ? (
        <>
          <span data-testid="ck-provenance-dtu" className="font-mono text-white/50">
            DTU {shortId(dtuId)}
          </span>
          {lineage.length > 0 && (
            <span data-testid="ck-provenance-lineage" className="text-white/40">
              · cites {lineage.length} {lineage.length === 1 ? 'source' : 'sources'}
            </span>
          )}
          {/* S4-b — Own it / List it (draft only; reuses marketplace.listings-create). */}
          {listing === 'idle' && (
            <button
              type="button"
              data-testid="ck-provenance-list"
              onClick={() => setListing('form')}
              className="ml-auto rounded border border-cyan-400/30 px-1.5 py-0.5 font-medium text-cyan-200 hover:border-cyan-300/60"
            >
              List it
            </button>
          )}
          {listing === 'form' && (
            <span className="ml-auto flex items-center gap-1">
              <span className="text-white/40">$</span>
              <input
                data-testid="ck-provenance-price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                placeholder="price"
                className="w-16 rounded border border-white/10 bg-black/50 px-1 py-0.5 text-[10px] text-cyan-100 focus:border-cyan-400/40 focus:outline-none"
              />
              <button
                type="button"
                data-testid="ck-provenance-list-confirm"
                onClick={list}
                className="rounded border border-emerald-400/40 px-1.5 py-0.5 font-medium text-emerald-200 hover:border-emerald-300/70"
              >
                List draft
              </button>
              <button
                type="button"
                data-testid="ck-provenance-list-cancel"
                onClick={() => { setListing('idle'); setError(null); }}
                className="text-white/40 hover:text-white/70"
              >
                Cancel
              </button>
            </span>
          )}
          {listing === 'listing' && <span className="ml-auto text-cyan-300/70">Listing…</span>}
          {listing === 'done' && (
            <span data-testid="ck-provenance-listed" className="ml-auto text-emerald-300">
              Listed as draft{listingNumber ? ` ${listingNumber}` : ''} · publish it in Marketplace
            </span>
          )}
        </>
      ) : (
        <span data-testid="ck-provenance-unpublished" className="text-amber-300/70">
          not yet published — publish to own it
        </span>
      )}

      {error && (
        <span data-testid="ck-provenance-error" className="w-full text-rose-300/80">
          {error}
        </span>
      )}
    </div>
  );
}

export default ArtifactProvenance;
