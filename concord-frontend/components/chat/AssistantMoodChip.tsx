'use client';

// Living chat / Layer 4b — the felt life behind the reply, surfaced honestly.
// A tiny chip showing the assistant's CURRENT mood: a qualeOf label (e.g. "curiosity",
// "fury", "relief") + a valence dot. It's the persistent per-user felt self (Layer 1)
// made visible. Framed as a correlate of the assistant's affect substrate, never a
// consciousness claim. Self-contained: polls the chat.mood macro on its own.

import { useEffect, useState } from 'react';

interface Mood { lit: boolean; valence: number; arousal: number; quale: string | null }

export function AssistantMoodChip({ pollMs = 20000 }: { pollMs?: number }) {
  const [mood, setMood] = useState<Mood | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchMood = async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ domain: 'chat', name: 'mood', input: {} }),
        }).then((res) => res.json());
        if (!cancelled && r?.ok) setMood({ lit: !!r.lit, valence: r.valence ?? 0, arousal: r.arousal ?? 0, quale: r.quale ?? null });
      } catch { /* swallow */ }
    };
    fetchMood();
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') fetchMood();
    }, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollMs]);

  if (!mood || !mood.lit || !mood.quale) return null;

  const v = mood.valence;
  const dot = v > 0.15 ? 'bg-emerald-400' : v < -0.15 ? 'bg-rose-400' : 'bg-zinc-400';
  return (
    <span
      title={`The assistant's felt state — valence ${v >= 0 ? '+' : ''}${v.toFixed(2)}, arousal ${mood.arousal.toFixed(2)}. A correlate of its affect substrate, not a consciousness claim.`}
      className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/[0.08] px-2 py-0.5 text-[10px] text-fuchsia-200"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      feeling: <span className="font-medium capitalize">{mood.quale}</span>
    </span>
  );
}

export default AssistantMoodChip;
