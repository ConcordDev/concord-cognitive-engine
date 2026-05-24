'use client';

/**
 * SpectatorBar — shareable bracket link + live status pill. The share
 * slug resolves via tournaments.get { shareSlug }.
 */

import { useState } from 'react';
import { Share2, Check, Radio } from 'lucide-react';
import type { Tournament, TStatus } from './types';

const STATUS_PILL: Record<TStatus, string> = {
  upcoming: 'bg-slate-700 text-slate-300',
  checkin: 'bg-amber-900/50 text-amber-300',
  in_progress: 'bg-emerald-900/50 text-emerald-300',
  completed: 'bg-indigo-900/50 text-indigo-300',
  cancelled: 'bg-rose-900/50 text-rose-300',
};

export function SpectatorBar({ t }: { t: Tournament }) {
  const [copied, setCopied] = useState(false);

  const shareLink = typeof window !== 'undefined'
    ? `${window.location.origin}/lenses/tournaments?spectate=${t.shareSlug}`
    : `?spectate=${t.shareSlug}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const liveCount = t.matches.filter((m) => m.status === 'pending' && m.aId && m.bId).length;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
      <span className={`rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${STATUS_PILL[t.status]}`}>
        {t.status.replace('_', ' ')}
      </span>
      {t.status === 'in_progress' && (
        <span className="flex items-center gap-1 text-[11px] text-emerald-300">
          <Radio className="h-3 w-3 animate-pulse" /> {liveCount} live bout{liveCount === 1 ? '' : 's'}
        </span>
      )}
      <code className="hidden flex-1 truncate rounded bg-slate-950 px-2 py-1 text-[10px] text-slate-400 sm:block">
        {shareLink}
      </code>
      <button
        onClick={copy}
        className="ml-auto flex items-center gap-1 rounded bg-slate-700 px-2.5 py-1 text-[11px] hover:bg-slate-600"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Share2 className="h-3 w-3" />}
        {copied ? 'Copied' : 'Share bracket'}
      </button>
    </div>
  );
}
