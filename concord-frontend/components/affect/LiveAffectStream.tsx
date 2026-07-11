'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Heart, Loader2, Activity, TrendingUp } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

// Real ATS state shape (server/affect/engine.js#createState, defaults.js#DIMS):
// v=valence, a=arousal, s=stability, c=coherence, g=agency, t=trust, f=fatigue
// (all 0..1) plus ts (last-tick epoch ms). GET /api/affect/state responds
// { ok, state }. There is no intensity/polarity/mood field on state — those
// belong to *events* (server/affect/store.js#logEvent), a separate shape.
interface AffectStateVector { v?: number; a?: number; s?: number; c?: number; g?: number; t?: number; f?: number; ts?: number; [k: string]: unknown }
interface AffectStateResponse { ok?: boolean; state?: AffectStateVector }
interface AffectEvent { id?: string; type?: string; intensity?: number; polarity?: number; ts?: string; createdAt?: string }
interface AffectPolicy { name?: string; rules?: Record<string, unknown>; [k: string]: unknown }

const SESSION_KEY = 'concord:active-session-id';

export function LiveAffectStream() {
  const [sessionId, setSessionId] = useState<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const s = window.localStorage.getItem(SESSION_KEY) || `affect-${Date.now()}`;
    if (!window.localStorage.getItem(SESSION_KEY)) window.localStorage.setItem(SESSION_KEY, s);
    setSessionId(s);
  }, []);

  const state = useQuery({
    queryKey: ['affect-state', sessionId],
    enabled: !!sessionId,
    queryFn: async () => (await apiHelpers.affect.state(sessionId)).data as AffectStateResponse,
    refetchInterval: 4000,
  });
  const events = useQuery({
    queryKey: ['affect-events', sessionId],
    enabled: !!sessionId,
    queryFn: async () => (await apiHelpers.affect.events(sessionId)).data as { events?: AffectEvent[] } | AffectEvent[],
    refetchInterval: 4000,
  });
  const policy = useQuery({
    queryKey: ['affect-policy', sessionId],
    enabled: !!sessionId,
    queryFn: async () => (await apiHelpers.affect.policy(sessionId)).data as AffectPolicy,
  });

  const eventList = (Array.isArray(events.data) ? events.data : events.data?.events || []) as AffectEvent[];
  const st: AffectStateVector = state.data?.state || {};
  const valence = typeof st.v === 'number' ? st.v : 0.5;
  const arousal = typeof st.a === 'number' ? st.a : 0.25;
  const fatigue = typeof st.f === 'number' ? st.f : 0.2;
  // Valence is 0..1 non-negative (server/affect/defaults.js); 0.5 is neutral baseline.
  const valColor = valence > 0.6 ? 'text-emerald-300' : valence < 0.4 ? 'text-rose-300' : 'text-zinc-300';
  const valLabel = valence > 0.6 ? 'positive' : valence < 0.4 ? 'negative' : 'neutral';

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Live affect stream</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">affect translation spine · 4s poll</span>
        </div>
        {state.data && (
          <SaveAsDtuButton
            compact
            apiSource="concord-affect"
            title={`Affect snapshot — ${new Date().toLocaleString()} (session ${sessionId.slice(-6)})`}
            content={`Session: ${sessionId}\nValence: ${valence.toFixed(2)} (${valLabel}) · Arousal: ${arousal.toFixed(2)} · Fatigue: ${fatigue.toFixed(2)}\nStability: ${st.s ?? '—'} · Coherence: ${st.c ?? '—'} · Agency: ${st.g ?? '—'} · Trust: ${st.t ?? '—'}\n\nRecent events (${eventList.length}):\n${eventList.slice(0, 15).map((e) => `  ${e.ts || e.createdAt || '?'} · ${e.type || '?'} i=${e.intensity ?? '-'} p=${e.polarity ?? '-'}`).join('\n')}`}
            extraTags={['affect', 'ats', 'session']}
            rawData={{ state: st, events: eventList, policy: policy.data }}
          />
        )}
      </header>

      {(state.isError || events.isError) && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Affect Translation Spine unreachable.</div>}
      {state.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Reading affect state…</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-md border border-cyan-500/20 bg-zinc-950/60 p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Valence</div>
          <div className={`mt-1 font-mono text-3xl ${valColor}`}>{valence.toFixed(2)}</div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-cyan-400" style={{ width: `${valence * 100}%` }} /></div>
          <div className="mt-1 text-[11px] text-zinc-400">{valLabel}</div>
        </div>
        <div className="rounded-md border border-cyan-500/20 bg-zinc-950/60 p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Arousal</div>
          <div className="mt-1 font-mono text-3xl text-cyan-300">{arousal.toFixed(2)}</div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-cyan-400" style={{ width: `${arousal * 100}%` }} /></div>
        </div>
        <div className="rounded-md border border-cyan-500/20 bg-zinc-950/60 p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Fatigue</div>
          <div className={`mt-1 font-mono text-3xl ${fatigue > 0.6 ? 'text-amber-300' : 'text-cyan-300'}`}>{fatigue.toFixed(2)}</div>
          {typeof st.ts === 'number' && <div className="mt-2 text-[10px] text-zinc-400">last tick {new Date(st.ts).toLocaleTimeString()}</div>}
        </div>
      </div>

      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200">
          <Activity className="h-3.5 w-3.5 text-cyan-400" /> Event timeline ({eventList.length})
        </div>
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {eventList.slice(0, 25).map((e, i) => {
            const ts = e.ts || e.createdAt;
            const inten = e.intensity ?? 0;
            const pol = e.polarity ?? 0;
            const polClass = pol > 0.2 ? 'text-emerald-300' : pol < -0.2 ? 'text-rose-300' : 'text-zinc-400';
            return (
              <div key={e.id || i} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px]">
                <div className="flex items-center gap-2">
                  <TrendingUp className={`h-3 w-3 ${polClass}`} />
                  <span className="font-mono text-zinc-300">{e.type || '?'}</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[10px]">
                  <span className="text-zinc-400">i={inten.toFixed(2)}</span>
                  <span className={polClass}>p={pol > 0 ? '+' : ''}{pol.toFixed(2)}</span>
                  <span className="text-zinc-600">{ts ? new Date(ts).toLocaleTimeString() : ''}</span>
                </div>
              </div>
            );
          })}
          {eventList.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No affect events yet — engage chat/world to emit.</div>}
        </div>
      </div>
    </div>
  );
}
