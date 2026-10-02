'use client';

/** Marketplace north star — published listings only. Drafts stay off the grid. */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, NorthNote, northPage, usd, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Listing = { id: string; title?: string; priceUsd?: number; kind?: string; status?: string };

const PILL = [
  { id: 'marketplace', label: 'Marketplace', href: '/lenses/marketplace' },
  { id: 'auction', label: 'Auctions', href: '/lenses/auction' },
];

export function ForSale({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('marketplace');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const listingsQ = useMacro<{ listings?: Listing[] }>(
    ['marketplace-northstar', 'published'],
    'marketplace',
    'listings-list',
    { status: 'published' },
    (result) => {
      if (!Array.isArray(result.listings)) throw new Error('The catalog did not answer.');
      return result;
    },
  );
  const listings = listingsQ.data?.listings ?? null;
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const listWork = async () => {
    const priceUsd = Number(price);
    if (!title.trim() || !Number.isFinite(priceUsd) || priceUsd < 0) {
      setError('A listing needs a title and a price.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await lensRun<{ listing?: Listing }>('marketplace', 'listings-create', { title: title.trim(), priceUsd });
      const id = created.data.result?.listing?.id;
      if (!created.data.ok || !id) {
        setError(created.data.error || 'The work was not listed.');
        return;
      }
      const published = await lensRun('marketplace', 'listings-publish', { id });
      if (!published.data.ok) {
        setError(published.data.error || 'The work was saved as a draft and is not for sale yet.');
        return;
      }
      setTitle('');
      setPrice('');
      setComposing(false);
      await client.invalidateQueries({ queryKey: ['marketplace-northstar', 'published'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The work was not listed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <LensShell lensId="marketplace" asMain={false} disableAgentFab>
      <div data-lens-theme="marketplace" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Marketplace" title={who ? `What's for sale, ${who}` : "What's for sale"} />
            <FamilyPill label="Marketplace" active="marketplace" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Shop desk' }]} onPick={onOpenDesk} />
        </div>

        {listings && listings.length === 0 && <NorthNote>Nothing published.</NorthNote>}
        {(error || listingsQ.error) && (
          <NorthError message={error || (listingsQ.error instanceof Error ? listingsQ.error.message : 'The catalog did not answer.')} />
        )}

        {listings && listings.length > 0 && (
          <ul className="mt-8 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
            {listings.map((l) => (
              <li key={l.id} data-testid="listing-tile" className="rounded-xl border border-white/10 px-4 py-4">
                <p className="text-[16px] text-zinc-100">{l.title}</p>
                <p className="mt-1 text-[14px] tabular-nums text-zinc-400">
                  {Number.isFinite(Number(l.priceUsd)) ? usd(Number(l.priceUsd)) : '—'}
                </p>
              </li>
            ))}
          </ul>
        )}

        {composing && (
          <form className="mt-6 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void listWork(); }}>
            <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <input aria-label="Price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Price" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Publish</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>+ List a work</button>
      </div>
    </LensShell>
  );
}
