'use client';

// Phase DB14 — Asymmetric horror role HUDs.
// Polls /api/horror/active; surfaces a ghost overlay or investigator
// overlay depending on the session's role for this player. Mutually
// exclusive — a session has one ghost and N investigators, server
// enforces.

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useClientConfig } from '@/hooks/useClientConfig';
import { Ghost, Flashlight, Camera, X, Trophy, Skull } from 'lucide-react';

interface Session {
  id: string;
  ghost_user_id: string;
  world_id: string;
  started_at: number;
  ended_at: number | null;
  end_reason: string | null;
  evidence_collected: number;
  investigators_json: string;
  downed_json: string;
  role: 'ghost' | 'investigator';
}

export function HorrorRoleHUDs() {
  const POLL_MS = useClientConfig().poll.horrorRoleMs; // E0 — server-tunable
  const [worldId, setWorldId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [endedAck, setEndedAck] = useState<Session | null>(null);
  const [evidenceForm, setEvidenceForm] = useState(false);
  const [evidenceKind, setEvidenceKind] = useState('footprint');
  const [downing, setDowning] = useState<string | null>(null);

  useEffect(() => {
    const id = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    setWorldId(id);
  }, []);

  const refresh = useCallback(async () => {
    if (!worldId) return;
    try {
      const j = await fetch(`/api/horror/active?worldId=${encodeURIComponent(worldId)}`, { credentials: 'include' }).then(r => r.json());
      const next = j?.session || null;
      if (session && !next) setEndedAck(session); // capture for end-modal
      setSession(next);
    } catch { /* swallow */ }
  }, [worldId, session]);

  useRealtimeRefresh(['horror:state'], refresh, { backstopMs: POLL_MS, enabled: !!worldId });

  // Shader hooks for both roles.
  useEffect(() => {
    if (!session) return;
    if (session.role === 'ghost') {
      window.dispatchEvent(new CustomEvent('concordia:visibility-shader', { detail: { mode: 'ghost' } }));
    } else {
      window.dispatchEvent(new CustomEvent('concordia:visibility-shader', { detail: { mode: 'flashlight' } }));
    }
    return () => {
      window.dispatchEvent(new CustomEvent('concordia:visibility-shader', { detail: { mode: 'off' } }));
    };
  }, [session]);

  const submitEvidence = useCallback(async () => {
    if (!session) return;
    await fetch(`/api/horror/session/${session.id}/sighting`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: evidenceKind }),
    });
    setEvidenceForm(false);
    refresh();
  }, [session, evidenceKind, refresh]);

  if (endedAck && !session) {
    const won = endedAck.end_reason === 'investigators_won';
    return (
      <div className="concordia-hud-fade fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="rounded-xl border border-red-500/40 bg-zinc-950/95 p-6 text-center shadow-2xl">
          <div className="mb-2 flex justify-center">
            {won ? <Trophy size={36} className="text-amber-400" /> : <Skull size={36} className="text-red-400" />}
          </div>
          <h2 className="mb-1 text-lg font-bold text-red-200">
            {won ? 'Investigators win' : 'Ghost wins'}
          </h2>
          <p className="text-xs text-zinc-400">
            {endedAck.role === 'ghost'
              ? won ? 'They gathered the proof.' : 'You hunted them down.'
              : won ? `You collected ${endedAck.evidence_collected} pieces of evidence.` : 'The haunt overcame your team.'}
          </p>
          <button onClick={() => setEndedAck(null)} className="mt-3 rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700">
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (!session) return null;

  if (session.role === 'ghost') {
    let downed: string[] = [];
    try { downed = JSON.parse(session.downed_json || '[]'); } catch { /* skip */ }
    let investigators: string[] = [];
    try { investigators = JSON.parse(session.investigators_json || '[]'); } catch { /* skip */ }
    const targets = investigators.filter((u) => !downed.includes(u));
    return (
      <>
        {/* Full-overlay ghost shader hint (DOM proxy; real shader uses event) */}
        <div className="pointer-events-none fixed inset-0 z-10 bg-gradient-to-b from-zinc-900/20 via-transparent to-zinc-900/30" />
        <div className="concordia-hud-slide-left pointer-events-auto fixed left-4 top-24 z-25 w-56 rounded-lg border border-red-500/40 bg-zinc-950/95 p-2 shadow-xl backdrop-blur">
          <header className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-red-300/70">
            <Ghost size={11} /> ghost · hunt
          </header>
          <div className="space-y-1">
            <div className="text-[10px] text-red-300/70">targets remaining: {targets.length} / {investigators.length}</div>
            {targets.map((u) => (
              <div key={u} className="flex items-center justify-between rounded bg-red-950/30 px-1.5 py-1">
                <span className="font-mono text-[10px] text-red-100">{u.slice(0, 16)}…</span>
                <button
                  disabled={downing === u}
                  onClick={async () => {
                    setDowning(u);
                    try {
                      await fetch(`/api/horror/session/${session.id}/down`, {
                        method: 'POST', credentials: 'include',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ targetUserId: u }),
                      });
                      refresh();
                    } finally {
                      setDowning(null);
                    }
                  }}
                  className="rounded bg-red-500/40 px-1.5 py-0.5 text-[9px] text-red-50 hover:bg-red-500/60 disabled:opacity-40"
                >{downing === u ? '…' : 'down'}</button>
              </div>
            ))}
            <div className="mt-1 text-[9px] text-red-300/60">downed: {downed.length}</div>
          </div>
        </div>
      </>
    );
  }

  // Investigator HUD.
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-10 bg-radial-gradient" style={{
        backgroundImage: 'radial-gradient(circle at center, transparent 0%, transparent 25%, rgba(0,0,0,0.6) 60%, rgba(0,0,0,0.9) 100%)',
      }} />
      <div className="concordia-hud-slide-right pointer-events-auto fixed bottom-36 right-4 z-25 w-56 rounded-lg border border-amber-500/40 bg-zinc-950/95 p-2 shadow-xl backdrop-blur">
        <header className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-300/70">
          <Flashlight size={11} /> investigator
        </header>
        <div className="grid grid-cols-3 gap-1 text-center">
          <div className="rounded bg-amber-950/30 p-1.5">
            <div className="text-[9px] text-amber-300/60">evidence</div>
            <div className="font-mono text-base text-amber-100">{session.evidence_collected}/3</div>
          </div>
          <button
            onClick={() => setEvidenceForm(true)}
            className="col-span-2 rounded bg-amber-500/30 p-1.5 text-xs text-amber-100 hover:bg-amber-500/50"
          >
            <Camera size={12} className="inline" /> record
          </button>
        </div>
        {evidenceForm && (
          <div className="mt-2 rounded border border-amber-500/30 bg-amber-950/40 p-1.5">
            <select
              value={evidenceKind}
              onChange={(e) => setEvidenceKind(e.target.value)}
              className="w-full rounded bg-zinc-900 px-1 py-0.5 text-[10px] text-amber-100"
            >
              <option value="footprint">footprint</option>
              <option value="emf_spike">emf spike</option>
              <option value="cold_spot">cold spot</option>
              <option value="apparition">apparition</option>
            </select>
            <div className="mt-1 flex gap-1">
              <button onClick={submitEvidence} className="flex-1 rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-100 hover:bg-amber-500/50">
                Submit
              </button>
              <button onClick={() => setEvidenceForm(false)} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700">
                <X size={9} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
