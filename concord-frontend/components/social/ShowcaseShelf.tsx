'use client';

/**
 * ShowcaseShelf — up to 6 of a profile owner's own public creations
 * (job oc-social-5, Social identity / JOB 8).
 *
 * The shelf itself is the SERVER-sanitized list on the profile response:
 * pins whose targets have since become private, followers-only, blocked,
 * or deleted are filtered out server-side before they reach any viewer.
 * Owner controls (pin/unpin/up/down) hit real routes:
 *   GET    /api/social/identity/showcase/options  — own public media posts
 *                                                    + own active listings
 *   POST   /api/social/identity/showcase/pin      — { kind, id }
 *   DELETE /api/social/identity/showcase/:kind/:id
 *   POST   /api/social/identity/showcase/reorder  — { order: [{kind,id}] }
 * Nothing fake: an empty shelf stays empty until the owner pins real
 * things, and the "full" state is the honest server cap of 6.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { PostMediaCard } from './PostMediaCard';

export const SHOWCASE_MAX = 6;

export interface ShowcasePostItem {
  kind: 'post';
  id: string;
  content: string;
  title?: string | null;
  mediaType?: string | null;
  mediaUrl?: string | null;
  media?: Array<{ kind?: string; url?: string } | null> | null;
  createdAt?: string | null;
}

export interface ShowcaseListingItem {
  kind: 'listing';
  id: string;
  title: string;
  price?: number | null;
}

export type ShowcaseItem = ShowcasePostItem | ShowcaseListingItem;

export interface ShowcaseOption {
  kind: 'post' | 'listing';
  id: string;
  label: string;
  detail?: string | null;
  alreadyPinned: boolean;
}

interface ShowcaseShelfProps {
  userId: string;
  showcase?: ShowcaseItem[] | null;
  isOwner: boolean;
  onOpenPost?: (postId: string) => void;
  className?: string;
}

function itemLabel(item: ShowcaseItem): string {
  if (item.kind === 'listing') return item.title || 'Marketplace item';
  return item.title || item.content?.slice(0, 60) || 'Post';
}

function PostPinCard({
  item,
  onOpenPost,
}: {
  item: ShowcasePostItem;
  onOpenPost?: (postId: string) => void;
}) {
  const media = Array.isArray(item.media) ? item.media : [];
  const first = media.length > 0 ? media[0] : null;
  const kind = (first?.kind || item.mediaType || '').toLowerCase();
  const url = first?.url || item.mediaUrl || null;
  const openable = !!onOpenPost;

  return (
    <div className="relative rounded-xl border border-lattice-border bg-lattice-deep p-3">
      {openable && (
        <button
          type="button"
          className="absolute inset-0 rounded-xl"
          aria-label={`Open post — ${itemLabel(item)}`}
          onClick={() => (onOpenPost as (postId: string) => void)(item.id)}
        />
      )}
      <div className="relative flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-zinc-100">{itemLabel(item)}</p>
        </div>
      </div>
      <div className="relative mt-2">
        {url && (kind === 'image' || kind === 'photo') ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt={itemLabel(item)}
            className="max-h-40 w-full rounded-md border border-zinc-800 object-cover"
            loading="lazy"
          />
        ) : null}
        {url && kind === 'video' ? (
          <video
            src={url}
            controls
            preload="metadata"
            className="max-h-40 w-full rounded-md border border-zinc-800"
          />
        ) : null}
        {url && (kind === 'audio' || item.mediaType === 'audio') ? (
          <PostMediaCard className="relative" mediaType="audio" mediaUrl={url} />
        ) : null}
      </div>
    </div>
  );
}

function ListingPinCard({ item }: { item: ShowcaseListingItem }) {
  return (
    <div className="rounded-xl border border-lattice-border bg-lattice-deep p-3">
      <p className="truncate text-sm text-zinc-100">{item.title || 'Marketplace item'}</p>
      <div className="mt-2">
        <PostMediaCard
          listing={{ id: item.id, title: item.title || 'Marketplace item', price: item.price ?? undefined }}
        />
      </div>
    </div>
  );
}

export function ShowcaseShelf({ userId, showcase, isOwner, onOpenPost, className }: ShowcaseShelfProps) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const items = showcase || [];
  const full = items.length >= SHOWCASE_MAX;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    void queryClient.invalidateQueries({ queryKey: ['social-profiles'] });
  };

  const optionsQuery = useQuery({
    queryKey: ['social-showcase-options', userId],
    queryFn: async () => {
      const res = await api.get<{ ok?: boolean; options?: ShowcaseOption[]; error?: string }>(
        '/api/social/identity/showcase/options',
      );
      if (res.data?.ok === false) throw new Error(res.data.error || 'Could not load your creations.');
      return (res.data?.options || []) as ShowcaseOption[];
    },
    enabled: isOwner && pickerOpen,
    staleTime: 30_000,
  });

  const pin = useMutation({
    mutationFn: async (option: ShowcaseOption) => {
      const res = await api.post<{ ok?: boolean; error?: string }>(
        '/api/social/identity/showcase/pin',
        { kind: option.kind, id: option.id },
      );
      if (res.data && res.data.ok === false) {
        throw new Error(res.data.error || 'Could not pin that.');
      }
      return res.data;
    },
    onSuccess: () => refresh(),
  });

  const unpin = useMutation({
    mutationFn: async (item: ShowcaseItem) => {
      const res = await api.delete<{ ok?: boolean; error?: string }>(
        `/api/social/identity/showcase/${item.kind}/${encodeURIComponent(item.id)}`,
      );
      if (res.data && res.data.ok === false) {
        throw new Error(res.data.error || 'Could not unpin that.');
      }
      return res.data;
    },
    onSuccess: () => refresh(),
  });

  const reorder = useMutation({
    mutationFn: async (order: Array<{ kind: string; id: string }>) => {
      const res = await api.post<{ ok?: boolean; error?: string }>(
        '/api/social/identity/showcase/reorder',
        { order },
      );
      if (res.data && res.data.ok === false) {
        throw new Error(res.data.error || 'Could not move that.');
      }
      return res.data;
    },
    onSuccess: () => refresh(),
  });

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const order = items.map((item) => ({ kind: item.kind, id: item.id }));
    const [moved] = order.splice(index, 1);
    order.splice(target, 0, moved);
    reorder.mutate(order);
  };

  // A stranger's empty shelf renders nothing at all — no fake cards.
  if (items.length === 0 && !isOwner) return null;

  return (
    <section className={cn('rounded-2xl border border-white/10 bg-[#111] p-3', className)} aria-label="Showcase">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium text-zinc-200">Showcase</h2>
          {isOwner ? (
            <span className="text-[11px] text-zinc-500">
              {items.length}/{SHOWCASE_MAX} pinned
            </span>
          ) : null}
        </div>
        {isOwner ? (
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            disabled={full && !pickerOpen}
            aria-expanded={pickerOpen}
            aria-label="Add to Showcase"
            title={full ? `Showcase is full (${SHOWCASE_MAX} items)` : undefined}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs text-zinc-200 transition-colors disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {full ? `Full (${SHOWCASE_MAX})` : 'Add'}
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-zinc-400">
          Pin up to {SHOWCASE_MAX} of your public posts and listings here.
        </p>
      ) : (
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item, index) => (
            <li key={`${item.kind}:${item.id}`} className="relative">
              {item.kind === 'post' ? (
                <PostPinCard item={item} onOpenPost={onOpenPost} />
              ) : (
                <ListingPinCard item={item} />
              )}
              {isOwner ? (
                <div className="mt-1 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || reorder.isPending}
                    aria-label={`Move ${itemLabel(item)} up in Showcase`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-white/10 text-zinc-300 hover:border-white/25 disabled:opacity-40"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1 || reorder.isPending}
                    aria-label={`Move ${itemLabel(item)} down in Showcase`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-white/10 text-zinc-300 hover:border-white/25 disabled:opacity-40"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => unpin.mutate(item)}
                    disabled={unpin.isPending}
                    aria-label={`Remove ${itemLabel(item)} from Showcase`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-white/10 text-zinc-300 hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-40"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {isOwner && pickerOpen ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-2">
          <p className="mb-1 text-xs text-zinc-400">
            Your public creations ({items.length}/{SHOWCASE_MAX} pinned)
          </p>
          {optionsQuery.isLoading ? (
            <p className="text-xs text-zinc-400">Loading your creations…</p>
          ) : optionsQuery.isError ? (
            <p className="text-xs text-rose-300" role="alert">
              {optionsQuery.error instanceof Error ? optionsQuery.error.message : 'Could not load your creations.'}
            </p>
          ) : (optionsQuery.data || []).length === 0 ? (
            <p className="text-xs text-zinc-400">
              Nothing to pin yet — publish a marketplace listing or post something with media.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {(optionsQuery.data || []).map((option) => (
                <li key={`${option.kind}:${option.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-white/5">
                  <span className="min-w-0 truncate text-xs text-zinc-200">
                    {option.label}
                    {option.detail ? <span className="text-zinc-500"> · {option.detail}</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => pin.mutate(option)}
                    disabled={option.alreadyPinned || (full && !option.alreadyPinned) || pin.isPending}
                    aria-label={`Pin ${option.label} to Showcase`}
                    className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-teal-400/40 px-3 text-xs text-teal-200 hover:bg-teal-400/10 disabled:opacity-40"
                  >
                    {option.alreadyPinned ? 'Pinned' : 'Pin'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pin.isError ? (
            <p className="mt-1 text-xs text-rose-300" role="alert">
              {pin.error instanceof Error ? pin.error.message : 'Could not pin that.'}
            </p>
          ) : null}
          {unpin.isError ? (
            <p className="mt-1 text-xs text-rose-300" role="alert">
              {unpin.error instanceof Error ? unpin.error.message : 'Could not unpin that.'}
            </p>
          ) : null}
          {reorder.isError ? (
            <p className="mt-1 text-xs text-rose-300" role="alert">
              {reorder.error instanceof Error ? reorder.error.message : 'Could not move that.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default ShowcaseShelf;