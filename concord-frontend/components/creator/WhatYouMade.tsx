'use client';

/**
 * Creator north star — the piece and its royalty, once the studio answers.
 * Drift is a sentence only when the influence engine returns this creator's row.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { api, lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';

type Listing = { id: string; title?: string; sourceDtuId?: string; price?: number };
type Dash = {
  ok?: boolean;
  error?: string;
  userId?: string;
  recentListings?: Listing[];
  recentDTUs?: { id: string; title?: string }[];
};
type Drift = { ok?: boolean; drift?: { userId: string; change: number }[] };
type Flow = { ok?: boolean; totalCC?: number; error?: string };

const PILL = [
  { id: 'creator', label: 'Creator', href: '/lenses/creator' },
  { id: 'gallery', label: 'Gallery', href: '/lenses/gallery' },
];

const quiet = { retry: false, refetchOnWindowFocus: false } as const;

function driftSentence(change: number): string {
  if (change === 0) return 'Drift this week: no significant drift.';
  const n = Math.abs(change);
  const word = n === 1 ? 'citation' : 'citations';
  return change > 0
    ? `Drift this week: ${n} more ${word}.`
    : `Drift this week: ${n} fewer ${word}.`;
}

export function WhatYouMade({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('creator');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();

  const dashQ = useQuery({
    queryKey: ['creator-northstar', 'dashboard'],
    ...quiet,
    queryFn: async () => {
      const res = await api.get<Dash>('/api/creator/dashboard');
      const data = res.data;
      if (!data || data.ok === false) throw new Error(data?.error || 'The studio did not answer.');
      return data;
    },
  });

  const piece = dashQ.data?.recentListings?.[0] ?? null;
  const pieceId = piece?.sourceDtuId || piece?.id;

  const driftQ = useQuery({
    queryKey: ['creator-northstar', 'drift'],
    ...quiet,
    queryFn: async () => {
      const res = await api.get<Drift>('/api/creator/influence-drift');
      return res.data?.drift ?? [];
    },
  });

  const royaltyQ = useQuery({
    queryKey: ['creator-northstar', 'royalty', pieceId],
    ...quiet,
    enabled: Boolean(pieceId),
    queryFn: async () => {
      const res = await api.get<Flow>(`/api/creator/royalty-flow?dtuId=${encodeURIComponent(pieceId || '')}`);
      const total = res.data?.totalCC;
      if (res.data?.ok === false || typeof total !== 'number' || !Number.isFinite(total)) return null;
      return total;
    },
  });

  const mine = driftQ.data?.find((row) => row.userId && row.userId === dashQ.data?.userId);
  const driftLine = mine && Number.isFinite(mine.change) ? driftSentence(mine.change) : null;

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const publish = async () => {
    const priceNum = Number(price);
    if (!title.trim() || !Number.isFinite(priceNum) || priceNum < 0) {
      setError('A listing needs a title and a price.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const minted = await lensRun<{ id?: string; dtu?: { id?: string }; dtuId?: string }>('dtu', 'create', withContentLicense({
        title: title.trim(),
        tags: ['creator'],
        source: 'creator:publish',
        meta: { visibility: 'personal', consent: { allowCitations: true } },
      }, 'knowledge', ['private', 'public_view', 'marketplace_sale']));
      const mintedResult = minted.data.result;
      const dtuId = mintedResult?.id || mintedResult?.dtu?.id || mintedResult?.dtuId;
      if (!minted.data.ok || !dtuId) {
        setError(minted.data.error || 'The piece was not saved.');
        return;
      }
      const listed = await lensRun('marketplace', 'list', {
        dtuId,
        price: priceNum,
        title: title.trim(),
        currency: 'USD',
      });
      if (!listed.data.ok) {
        setError(listed.data.error || 'The piece was saved and is not listed yet.');
        return;
      }
      setTitle('');
      setPrice('');
      setComposing(false);
      await client.invalidateQueries({ queryKey: ['creator-northstar', 'dashboard'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The piece was not listed.');
    } finally {
      setBusy(false);
    }
  };

  const dashError = dashQ.error instanceof Error ? dashQ.error.message : '';

  return (
    <LensShell lensId="creator" asMain={false} disableAgentFab>
      <div data-lens-theme="creator" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Creator" title={who ? `What you made, ${who}` : 'What you made'} />
            <FamilyPill label="Creator" active="creator" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Studio' }]} onPick={onOpenDesk} />
        </div>

        {(dashError || error) && <NorthError message={dashError || error} />}

        <div className="mt-6 max-w-xl rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
          <p className="text-[15px] text-zinc-100">{piece?.title || (dashQ.isLoading ? '…' : 'No listing yet')}</p>
          {piece && royaltyQ.data != null && (
            <p className="mt-2 text-[14px] text-zinc-400">Royalty {royaltyQ.data} CC</p>
          )}
          {driftLine && <p className="mt-1 text-[14px] text-zinc-500">{driftLine}</p>}
        </div>

        {composing && (
          <form className="mt-4 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void publish(); }}>
            <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <input aria-label="Price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Price" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Publish</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>+ Publish</button>
      </div>
    </LensShell>
  );
}
