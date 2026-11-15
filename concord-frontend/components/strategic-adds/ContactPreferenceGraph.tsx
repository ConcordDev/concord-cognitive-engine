'use client';

/**
 * ContactPreferenceGraph — Track 7 of the strategic-adds lens
 * (FIX-strategic-adds-002; founder ruling DUTCH-DECISIONS-46 #6: the
 * Track 7 graph goes in the queue).
 *
 * The panel used to be an honest "not yet built" note. This is the
 * graph: the caller's contact network, read from the existing social
 * substrate (GET /api/social/profile + /followers/:id + /following/:id
 * — the same routes and fetch shape as components/creator/FollowersPanel).
 * No new store, no new endpoints.
 *
 * What it renders: the caller at the centre; everyone they follow and
 * everyone who follows them placed around it. The relationship class
 * IS the preference signal the platform keeps per contact: MUTUAL
 * (both ways), FOLLOWING (you → them), FOLLOWER (them → you). The SVG
 * is the visual; the list beneath it carries the same nodes with names
 * and class chips, so the graph is fully usable without the picture
 * (screen readers, 390px phones).
 *
 * Read-only by design: it is a network VIEW. Following and unfollowing
 * stay in the Social lens, one click away from the empty state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';

interface PersonRow {
  userId: string;
  displayName?: string;
  username?: string;
}

type RelClass = 'mutual' | 'following' | 'follower';

interface GraphNode extends PersonRow {
  rel: RelClass;
}

const REL_LABEL: Record<RelClass, string> = {
  mutual: 'Mutual',
  following: 'Following',
  follower: 'Follows you',
};

const MAX_GRAPH_NODES = 40;

function nameOf(p: PersonRow): string {
  return p.displayName || p.username || p.userId;
}

function normalise(rows: unknown): PersonRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) =>
      typeof r === 'string'
        ? { userId: r }
        : { userId: (r as PersonRow)?.userId ?? '', displayName: (r as PersonRow)?.displayName, username: (r as PersonRow)?.username },
    )
    .filter((p) => p.userId);
}

export function ContactPreferenceGraph() {
  const [nodes, setNodes] = useState<GraphNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const profile = await fetch('/api/social/profile', { credentials: 'include' }).then((r) => r.json());
      const me: string | undefined = profile?.userId || profile?.id;
      if (!me || me === 'anon') {
        setNodes([]);
        return;
      }
      const [fRes, gRes] = await Promise.all([
        fetch(`/api/social/followers/${encodeURIComponent(me)}`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`/api/social/following/${encodeURIComponent(me)}`, { credentials: 'include' }).then((r) => r.json()),
      ]);
      const followers = normalise(fRes?.followers);
      const following = normalise(gRes?.following);
      const followerIds = new Set(followers.map((p) => p.userId));
      const byId = new Map<string, GraphNode>();
      for (const p of following) {
        byId.set(p.userId, { ...p, rel: followerIds.has(p.userId) ? 'mutual' : 'following' });
      }
      for (const p of followers) {
        if (!byId.has(p.userId)) byId.set(p.userId, { ...p, rel: 'follower' });
      }
      const sorted = [...byId.values()].sort((a, b) => {
        const rank = { mutual: 0, following: 1, follower: 2 } as const;
        return rank[a.rel] - rank[b.rel] || nameOf(a).localeCompare(nameOf(b));
      });
      setNodes(sorted);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your network.');
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const graphNodes = useMemo(() => (nodes ?? []).slice(0, MAX_GRAPH_NODES), [nodes]);

  if (error) {
    return (
      <section className="rounded-xl border border-rose-700/30 bg-rose-600/10 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-rose-200">Your contact network couldn&apos;t load</h2>
        <p className="mt-2 text-sm text-rose-100/90">{error}</p>
        <button
          type="button"
          onClick={() => { setError(null); setNodes(null); setReloadKey((k) => k + 1); }}
          className="mt-3 inline-flex min-h-[40px] items-center rounded-lg border border-rose-300/40 px-4 text-sm text-rose-100 hover:bg-rose-500/10"
        >
          Retry
        </button>
      </section>
    );
  }

  if (nodes === null) {
    return (
      <div role="status" aria-busy="true" aria-live="polite" className="h-40 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-400">
        Loading your contact network…
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <section aria-label="Contact network empty state" className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Users className="h-4 w-4" aria-hidden="true" /> Your network graph is empty — here&apos;s how it fills in
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          This graph draws itself from your Social connections: people you follow appear around you,
          people who follow you appear too, and contacts connected both ways are marked mutual.
          Follow a few people in Social and they&apos;ll show up here automatically — there&apos;s
          nothing separate to build or maintain.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link className="inline-flex min-h-[40px] items-center underline text-cyan-300" href="/lenses/social">Find people in Social</Link>
          <Link className="inline-flex min-h-[40px] items-center underline text-zinc-300" href="/lenses/privacy">Open Privacy preferences</Link>
        </div>
      </section>
    );
  }

  const cx = 200;
  const cy = 200;
  const radius = 150;

  return (
    <section aria-label="Contact and preference network" className="space-y-4">
      <p className="text-sm text-zinc-300">
        Your contact network from Social: {nodes.length} {nodes.length === 1 ? 'contact' : 'contacts'}.
        Solid lines are mutual connections; dashed lines run one way.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#111] p-2">
        <svg viewBox="0 0 400 400" className="mx-auto w-full max-w-[400px]" role="img" aria-label={`Network graph with you at the centre and ${graphNodes.length} contacts around you`}>
          {graphNodes.map((n, i) => {
            const angle = (i / Math.max(1, graphNodes.length)) * Math.PI * 2 - Math.PI / 2;
            const x = cx + radius * Math.cos(angle);
            const y = cy + radius * Math.sin(angle);
            return (
              <line
                key={`e-${n.userId}`}
                x1={cx} y1={cy} x2={x} y2={y}
                stroke={n.rel === 'mutual' ? '#22d3ee' : '#71717a'}
                strokeWidth={n.rel === 'mutual' ? 2 : 1}
                strokeDasharray={n.rel === 'mutual' ? undefined : '4 3'}
              />
            );
          })}
          <circle cx={cx} cy={cy} r={26} fill="#164e63" stroke="#22d3ee" strokeWidth={2} />
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fill="#ecfeff">You</text>
          {graphNodes.map((n, i) => {
            const angle = (i / Math.max(1, graphNodes.length)) * Math.PI * 2 - Math.PI / 2;
            const x = cx + radius * Math.cos(angle);
            const y = cy + radius * Math.sin(angle);
            return (
              <g key={`n-${n.userId}`}>
                <circle cx={x} cy={y} r={16} fill="#27272a" stroke={n.rel === 'mutual' ? '#22d3ee' : '#52525b'} strokeWidth={1.5} />
                <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill="#e4e4e7">
                  {nameOf(n).slice(0, 1).toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
        {nodes.length > graphNodes.length && (
          <p className="px-2 pb-2 text-center text-sm text-zinc-400">
            Showing the first {graphNodes.length} contacts in the graph — all {nodes.length} are in the list below.
          </p>
        )}
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Contacts">
        {nodes.map((n) => (
          <li key={n.userId} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm text-zinc-100">
              {nameOf(n).slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-zinc-100">{nameOf(n)}</span>
              {n.username && <span className="block truncate text-sm text-zinc-500">@{n.username}</span>}
            </span>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[13px] ${n.rel === 'mutual' ? 'border-cyan-400/40 text-cyan-200' : 'border-white/15 text-zinc-300'}`}>
              {REL_LABEL[n.rel]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
