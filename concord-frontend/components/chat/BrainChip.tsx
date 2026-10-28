'use client';

// BrainChip — the persistent brain disclosure on the Chat composer
// (Product Chat review 2026-10-28, F1/A5: FAIL — no model, brain, or
// queue indicator anywhere before sending; the user learned which brain
// answered only from a fallback apology under the reply).
//
// Reads GET /api/brain/status — the existing viewer-scoped route
// (server/lib/brain-status-public.js). What a signed-in member may see
// is what the chip shows: the chat brain SLOT and its live status. Model
// names and URLs are redacted for members by that route's deliberate
// security posture, so the chip names the slot, never a model it cannot
// verify. Queue depth is not tracked server-side, so the chip never
// invents a queue position — it shows online / partial / fallback state
// and says "status unavailable" when the read fails.

import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BrainStatusView {
  mode?: string;
  onlineCount?: number;
  brains?: Record<string, { enabled?: boolean; role?: string }>;
  routing?: { chatPrimary?: string; circuitBreakerOllama?: string };
}

export function brainChipLabel(status: BrainStatusView | null): { slot: string; state: string; tone: 'ok' | 'warn' | 'down' | 'unknown' } {
  if (!status) return { slot: 'Brain', state: 'status unavailable', tone: 'unknown' };
  const slot = status.routing?.chatPrimary === 'ollama_conscious' ? 'Conscious brain' : 'Backup model';
  const total = status.brains ? Object.keys(status.brains).length : 0;
  const online = typeof status.onlineCount === 'number' ? status.onlineCount : 0;
  if (status.mode === 'fallback' || status.routing?.chatPrimary === 'none') {
    return { slot, state: 'GPU brain offline — backup model answers', tone: 'down' };
  }
  if (status.mode === 'partial') {
    return { slot, state: total > 0 ? `${online} of ${total} brains online` : 'Some brains offline', tone: 'warn' };
  }
  return { slot, state: total > 0 ? `All ${total} brains online` : 'Brains online', tone: 'ok' };
}

export default function BrainChip({ generating = false }: { generating?: boolean }) {
  const [status, setStatus] = useState<BrainStatusView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch('/api/brain/status', { credentials: 'include' });
        if (!res.ok) throw new Error(`brain status ${res.status}`);
        const data = (await res.json()) as BrainStatusView;
        if (live) { setStatus(data); setFailed(false); }
      } catch {
        if (live) setFailed(true);
      }
    };
    void load();
    const t = setInterval(load, 30000);
    return () => { live = false; clearInterval(t); };
    // `generating` in deps: a send start re-runs the effect, so a fallback
    // that begins with this reply shows on the chip during generation,
    // not as a footnote after it.
  }, [generating]);

  const { slot, state, tone } = brainChipLabel(failed ? null : status);
  const dot = tone === 'ok' ? 'bg-emerald-400' : tone === 'warn' ? 'bg-amber-400' : tone === 'down' ? 'bg-red-400' : 'bg-zinc-500';
  return (
    <div
      className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-400"
      data-testid="brain-chip"
      data-tone={tone}
      role="status"
      aria-label={`Brain: ${slot}. ${generating ? 'Answering now. ' : ''}${state}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot, generating && 'animate-pulse')} />
      <Brain className="h-3 w-3" aria-hidden />
      <span className="text-zinc-300">{slot}</span>
      <span aria-hidden>·</span>
      <span>{generating ? `Answering — ${state}` : state}</span>
    </div>
  );
}
