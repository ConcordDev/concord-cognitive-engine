'use client';

// Identity detail — full action/decision timeline for one emergent.
// Backed by GET /api/emergents/:id/timeline (server/routes/emergent-visibility.js,
// genesis-domain compute in server/domains/genesis.js).

import { useEffect, useState } from 'react';
import { Loader2, Activity, Eye, MessageSquare, Sparkles, CheckCircle2 } from 'lucide-react';
import { TimelineView, type TimelineEvent } from '@/components/viz';

interface TimelineEntry {
  id: string;
  kind: 'observation' | 'artifact' | 'communication' | 'decision' | 'task';
  label: string;
  detail?: string;
  status?: string;
  time: number;
}
interface DetailResponse {
  ok: boolean;
  error?: string;
  emergent?: {
    id: string;
    given_name: string | null;
    naming_origin: string | null;
    current_focus: string | null;
    last_active_at: number | null;
    role: string | null;
    active: boolean;
  };
  timeline?: TimelineEntry[];
  counts?: { observations: number; artifacts: number; communications: number; tasks: number };
}

const KIND_TONE: Record<string, TimelineEvent['tone']> = {
  observation: 'info',
  artifact: 'good',
  communication: 'warn',
  decision: 'good',
  task: 'default',
};
const KIND_ICON: Record<string, typeof Eye> = {
  observation: Eye,
  artifact: Sparkles,
  communication: MessageSquare,
  decision: CheckCircle2,
  task: Activity,
};

export function IdentityTimeline({ emergentId }: { emergentId: string }) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/emergents/${encodeURIComponent(emergentId)}/timeline?limit=200`)
      .then((r) => r.json())
      .then((d: DetailResponse) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setData({ ok: false, error: 'unreachable' }); setLoading(false); } });
    return () => { alive = false; };
  }, [emergentId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading timeline…
      </div>
    );
  }
  if (!data?.ok || !data.emergent) {
    return (
      <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
        Could not load this emergent ({data?.error || 'unknown error'}).
      </div>
    );
  }

  const em = data.emergent;
  const timeline = data.timeline || [];
  const events: TimelineEvent[] = timeline.map((t) => ({
    id: t.id,
    label: t.label,
    time: t.time,
    detail: t.detail,
    tone: KIND_TONE[t.kind] || 'default',
  }));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-cyan-500/15 pb-3">
        <div>
          <h3 className="text-base font-semibold text-white">{em.given_name || em.id}</h3>
          <p className="text-[11px] text-zinc-400">
            {em.role || 'emergent'} · {em.naming_origin ? `named via ${em.naming_origin}` : 'unnamed origin'}
            {em.active ? ' · active' : ' · dormant'}
          </p>
        </div>
        {em.current_focus && (
          <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-300">
            ↳ {em.current_focus}
          </span>
        )}
      </header>

      {data.counts && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {([
            ['Observations', data.counts.observations],
            ['Artifacts', data.counts.artifacts],
            ['Comms', data.counts.communications],
            ['Tasks', data.counts.tasks],
          ] as const).map(([label, n]) => (
            <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-950/40 py-2">
              <p className="text-lg font-bold text-white">{n}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p>
            </div>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <p className="text-xs text-zinc-400">No recorded actions or decisions yet.</p>
      ) : (
        <>
          <TimelineView events={events} height={110} />
          <ol className="space-y-1.5">
            {timeline.map((t) => {
              const Icon = KIND_ICON[t.kind] || Activity;
              return (
                <li
                  key={t.id}
                  className="flex items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2"
                >
                  <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-cyan-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-zinc-200">{t.label}</p>
                    {t.detail && <p className="mt-0.5 truncate text-[11px] text-zinc-400">{t.detail}</p>}
                    <p className="text-[10px] text-zinc-400">
                      {t.kind}
                      {t.status ? ` · ${t.status}` : ''}
                      {' · '}
                      {t.time ? new Date(t.time).toLocaleString() : 'no timestamp'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
