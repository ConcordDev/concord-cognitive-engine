'use client';

/**
 * AnnouncementCard — a single feed entry.
 *
 * Real micro-interactions (not decoration):
 *  - long bodies (>320 chars) collapse behind a "Read more" toggle so the
 *    feed stays scannable without ever truncating what's actually shown;
 *  - a "Copy link" action builds a real `?id=` deep link into THIS lens
 *    (the page resolves it against the fetched list, or falls back to the
 *    real `announcements.get` macro) and confirms via the clipboard API —
 *    no fabricated "copied" state if the write actually failed;
 *  - `highlighted` drives a temporary ring when the card is the target of
 *    a deep link or was just published, so the user can find it in the feed.
 */

import { useState } from 'react';
import { Check, Link2, ChevronDown, ChevronUp } from 'lucide-react';
import { KIND_META } from './kind-meta';
import { timeAgo, timeUntil, type Announcement } from './types';

const COLLAPSE_THRESHOLD = 320;

export interface AnnouncementCardProps {
  announcement: Announcement;
  highlighted?: boolean;
  copied?: boolean;
  onCopyLink: (id: string) => void;
}

export function AnnouncementCard({ announcement: a, highlighted, copied, onCopyLink }: AnnouncementCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = KIND_META[a.kind];
  const Icon = meta.icon;
  const isLong = a.body_md.length > COLLAPSE_THRESHOLD;
  const body = isLong && !expanded ? `${a.body_md.slice(0, COLLAPSE_THRESHOLD).trimEnd()}…` : a.body_md;

  return (
    <li
      id={`announcement-${a.id}`}
      data-testid="announcement-card"
      className={`rounded-xl border bg-zinc-950/60 p-3 transition-shadow duration-500 ${
        highlighted ? 'border-violet-400/70 shadow-[0_0_0_1px_rgba(167,139,250,0.5)]' : 'border-violet-500/20'
      }`}
    >
      <header className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className={`flex items-center gap-2 text-sm font-medium ${meta.color}`}>
          <Icon size={14} aria-hidden="true" />
          {a.title}
        </h2>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span className={`rounded-full border px-1.5 py-0.5 ${meta.ring} ${meta.color}`}>{meta.label}</span>
          <span>{timeAgo(a.published_at)}</span>
          <button
            type="button"
            onClick={() => onCopyLink(a.id)}
            aria-label={`Copy link to "${a.title}"`}
            title="Copy link"
            className="rounded p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300"
          >
            {copied ? <Check size={12} className="text-emerald-400" aria-hidden="true" /> : <Link2 size={12} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div className="whitespace-pre-wrap text-[12px] text-slate-200">{body}</div>

      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200"
          aria-expanded={expanded}
        >
          {expanded ? <>Show less <ChevronUp size={12} aria-hidden="true" /></> : <>Read more <ChevronDown size={12} aria-hidden="true" /></>}
        </button>
      )}

      {a.expires_at && (
        <p className="mt-2 text-[10px] text-slate-600">Expires {timeUntil(a.expires_at)}</p>
      )}
    </li>
  );
}
