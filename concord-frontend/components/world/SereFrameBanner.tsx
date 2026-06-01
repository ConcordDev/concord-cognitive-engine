'use client';

/**
 * SereFrameBanner — the one-time "this is satire / pure fiction" frame shown when
 * a player first enters a fiction world (Sere). Data-driven: reads the world's
 * `fiction` provenance from GET /api/worlds/:worldId/frame (stored in
 * rule_modulators at seed time), so any world tagged fiction gets the frame
 * automatically. Dismissal persists per-world in localStorage.
 *
 * The frame is load-bearing for the satire: it asserts the world dramatizes
 * PATTERNS, names no real people/orgs, and makes claims only about itself.
 */

import { useEffect, useState } from 'react';

const COPY: Record<string, { title: string; body: string }> = {
  satire: {
    title: 'A work of satire',
    body:
      'This world dramatizes patterns of power, money, and managed conflict. Every person, house, institution, company, nation, war, and event here is invented and exaggerated for parody. Resemblance to the real world is at the level of theme — never a claim about any real individual or organization. There is no villain and no mastermind here, only incentives that compound. That is the joke.',
  },
};

export default function SereFrameBanner({ worldId }: { worldId?: string }) {
  const [frame, setFrame] = useState<{ name?: string; fiction?: string } | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/frame`, { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !j?.fiction) return;
        const seen = typeof window !== 'undefined' && localStorage.getItem(`concord:frame-seen:${worldId}`) === '1';
        setFrame({ name: j.name, fiction: j.fiction });
        setDismissed(seen);
      } catch { /* no frame — non-fiction world */ }
    })();
    return () => { cancelled = true; };
  }, [worldId]);

  if (!frame?.fiction || dismissed) return null;
  const copy = COPY[frame.fiction] || COPY.satire;

  const dismiss = () => {
    setDismissed(true);
    try { if (worldId) localStorage.setItem(`concord:frame-seen:${worldId}`, '1'); } catch { /* ignore */ }
  };

  return (
    <div
      data-testid="sere-frame-banner"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-label="Fiction framing notice"
    >
      <div className="max-w-lg mx-4 rounded-lg border border-amber-500/40 bg-zinc-950/95 p-6 shadow-2xl">
        <div className="mb-2 text-xs uppercase tracking-widest text-amber-400/80">
          {frame.name || worldId} — fiction notice
        </div>
        <h2 className="mb-3 text-lg font-semibold text-amber-200">{copy.title}</h2>
        <p className="mb-5 text-sm leading-relaxed text-zinc-300">{copy.body}</p>
        <button
          onClick={dismiss}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/20 transition-colors"
        >
          Enter the mirror
        </button>
      </div>
    </div>
  );
}
