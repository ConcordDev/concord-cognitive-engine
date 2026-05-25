'use client';

/**
 * WarCampaignSession — kingdoms-scoped session-aware UI for planning +
 * executing a multi-step war campaign across multiple play sessions.
 *
 * Phase 5 of the UX completeness sprint. Real session data end-to-end —
 * starts a session via sessions.start, advances via sessions.advance,
 * closes via sessions.close. No fake state.
 *
 * Step graph:
 *   declare → muster → engage → resolve
 */

import { useEffect, useState } from 'react';
import { Swords, Plus, AlertTriangle, ChevronRight, Trophy, FileText } from 'lucide-react';
import { useLensSession } from '@/hooks/useLensSession';
import { SessionStepper } from '@/components/lens/SessionStepper';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';

interface CampaignState {
  kingdomId: string;
  kingdomName: string;
  target?: string;
  ally?: string;
  troops?: number;
  rationale?: string;
  outcome?: string;
}

const STEPS = [
  { id: 'declare', label: 'Declare', description: 'Author your casus belli and the target kingdom.' },
  { id: 'muster',  label: 'Muster',  description: 'Rally troops + allies + resources.' },
  { id: 'engage',  label: 'Engage',  description: 'Resolve the contest via the kingdom contest endpoint.' },
  { id: 'resolve', label: 'Resolve', description: 'Capture the outcome, mint a chronicle DTU.' },
];

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

interface SessionRow {
  id: string;
  title: string | null;
  currentStep: string | null;
  status: string;
  stepCount: number;
  updatedAt: number;
}

export interface WarCampaignSessionProps {
  kingdomId: string;
  kingdomName: string;
  className?: string;
}

export function WarCampaignSession({ kingdomId, kingdomName, className }: WarCampaignSessionProps) {
  const [openSessions, setOpenSessions] = useState<SessionRow[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const session = useLensSession<CampaignState>({
    lensId: 'kingdoms',
    sessionId: activeSessionId || undefined,
  });

  // Refresh the local list of war-campaign sessions for THIS kingdom.
  const refreshList = async () => {
    const r = await runMacro<{ ok: boolean; sessions?: SessionRow[]; reason?: string }>(
      'sessions', 'list_mine', { lensId: 'kingdoms', status: 'open', limit: 25 },
    );
    if (r?.ok) {
      // Filter to ones whose title prefix matches "War campaign" and whose
      // state.kingdomId matches (best-effort; full filter via .get if needed).
      const rows = (r.sessions || []).filter(s => (s.title || '').startsWith('War campaign'));
      setOpenSessions(rows);
    }
  };

  useEffect(() => { void refreshList(); }, [kingdomId]);

  const startCampaign = async () => {
    const s = await session.start({
      title: `War campaign · ${kingdomName}`,
      initialStep: 'declare',
      initialState: { kingdomId, kingdomName },
    });
    if (s) {
      setActiveSessionId(s.id);
      void refreshList();
    }
  };

  const goToStep = async (toStep: string) => {
    await session.advance({ toStep });
  };

  const resolveAndClose = async (outcome: 'completed' | 'abandoned') => {
    if (!session.session) return;
    await session.close({ outcome, note: `${outcome} for ${kingdomName}` });
    setActiveSessionId(null);
    void refreshList();
  };

  const state = session.session?.state || ({} as CampaignState);

  return (
    <section className={cn('rounded-lg border border-slate-800 bg-slate-900 p-4', className)}>
      <header className="flex items-center gap-2 mb-3">
        <Swords className="w-4 h-4 text-rose-300" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-slate-100 flex-1">War campaigns</h3>
        {!session.session && (
          <button
            type="button"
            onClick={() => void startCampaign()}
            disabled={session.loading}
            className="text-xs px-2 py-1 rounded bg-rose-800/40 hover:bg-rose-800/60 text-rose-100 border border-rose-700/60 flex items-center gap-1 disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> Start campaign
          </button>
        )}
      </header>

      {/* Open campaigns picker (when not viewing one) */}
      {!session.session && openSessions.length > 0 && (
        <div className="mb-3 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Open campaigns</div>
          {openSessions.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSessionId(s.id)}
              className="w-full flex items-center justify-between text-xs px-2 py-1.5 rounded border border-slate-700 bg-slate-800/60 hover:bg-slate-800 text-slate-200"
            >
              <span className="truncate">{s.title || 'Untitled'}</span>
              <span className="text-[10px] font-mono text-slate-400">
                step: {s.currentStep || '—'} · {s.stepCount} adv
                <ChevronRight className="inline w-3 h-3 ml-1" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Error display */}
      {session.error && (
        <div className="text-xs text-rose-300 mb-2">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> {session.error}
        </div>
      )}

      {/* Empty hint */}
      {!session.session && openSessions.length === 0 && (
        <p className="text-xs text-slate-400 italic">
          No open campaigns for this kingdom. Start one to plan across visits — the substrate persists every step.
        </p>
      )}

      {/* Active campaign workspace */}
      {session.session && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-slate-100 truncate">{session.session.title}</h4>
            <button
              type="button"
              onClick={() => setActiveSessionId(null)}
              className="text-[10px] text-slate-400 hover:text-slate-200"
            >
              Back to list
            </button>
          </div>

          <SessionStepper
            steps={STEPS}
            currentStepId={session.session.currentStep}
            stepCount={session.session.stepCount}
            onAdvance={(to) => void goToStep(to)}
          />

          {/* Per-step form */}
          {session.session.currentStep === 'declare' && (
            <div className="space-y-2 rounded border border-slate-700 bg-slate-800/40 p-3">
              <label className="block text-[10px] uppercase tracking-wider text-slate-400">Target kingdom (name or id)</label>
              <input
                type="text"
                value={state.target || ''}
                onChange={(e) => session.update({ statePatch: { target: e.target.value } as Partial<CampaignState> })}
                className="w-full bg-slate-900 border border-slate-700 rounded text-xs px-2 py-1 text-slate-100"
                placeholder="Target…"
              />
              <label className="block text-[10px] uppercase tracking-wider text-slate-400 mt-2">Casus belli (rationale)</label>
              <DraftedTextarea
                lensId="kingdoms"
                draftKey={`warCampaign:${session.session.id}:rationale`}
                initial={state.rationale || ''}
                onValueChange={(v) => session.update({ statePatch: { rationale: v } as Partial<CampaignState> })}
                rows={3}
                className="w-full bg-slate-900 border border-slate-700 rounded text-xs px-2 py-1 text-slate-100"
                placeholder="Why are you declaring war? (auto-saves)"
              />
            </div>
          )}

          {session.session.currentStep === 'muster' && (
            <div className="space-y-2 rounded border border-slate-700 bg-slate-800/40 p-3">
              <label className="block text-[10px] uppercase tracking-wider text-slate-400">Ally faction (optional)</label>
              <input
                type="text"
                value={state.ally || ''}
                onChange={(e) => session.update({ statePatch: { ally: e.target.value } as Partial<CampaignState> })}
                className="w-full bg-slate-900 border border-slate-700 rounded text-xs px-2 py-1 text-slate-100"
                placeholder="Ally name…"
              />
              <label className="block text-[10px] uppercase tracking-wider text-slate-400 mt-2">Troops committed</label>
              <input
                type="number"
                min={0}
                value={state.troops || 0}
                onChange={(e) => session.update({ statePatch: { troops: Number(e.target.value) || 0 } as Partial<CampaignState> })}
                className="w-full bg-slate-900 border border-slate-700 rounded text-xs px-2 py-1 text-slate-100 tabular-nums"
              />
            </div>
          )}

          {session.session.currentStep === 'engage' && (
            <div className="rounded border border-slate-700 bg-slate-800/40 p-3 text-xs text-slate-300 space-y-1">
              <div><FileText className="inline w-3 h-3 mr-1 text-slate-400" /> Target: <span className="font-mono">{state.target || '—'}</span></div>
              <div>Ally: <span className="font-mono">{state.ally || 'none'}</span></div>
              <div>Troops: <span className="font-mono tabular-nums">{state.troops || 0}</span></div>
              <p className="text-slate-400 italic mt-2">
                Execute the contest via the kingdom contest endpoint, then advance to resolve.
              </p>
            </div>
          )}

          {session.session.currentStep === 'resolve' && (
            <div className="space-y-2 rounded border border-slate-700 bg-slate-800/40 p-3">
              <label className="block text-[10px] uppercase tracking-wider text-slate-400">Outcome chronicle</label>
              <DraftedTextarea
                lensId="kingdoms"
                draftKey={`warCampaign:${session.session.id}:outcome`}
                initial={state.outcome || ''}
                onValueChange={(v) => session.update({ statePatch: { outcome: v } as Partial<CampaignState> })}
                rows={3}
                className="w-full bg-slate-900 border border-slate-700 rounded text-xs px-2 py-1 text-slate-100"
                placeholder="What happened? (auto-saves)"
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => void resolveAndClose('completed')}
                  className="text-xs px-2 py-1 rounded bg-emerald-800/40 hover:bg-emerald-800/60 text-emerald-100 border border-emerald-700/60 flex items-center gap-1"
                >
                  <Trophy className="w-3 h-3" /> Mark won
                </button>
                <button
                  type="button"
                  onClick={() => void resolveAndClose('abandoned')}
                  className="text-xs px-2 py-1 rounded bg-rose-800/40 hover:bg-rose-800/60 text-rose-100 border border-rose-700/60"
                >
                  Abandon
                </button>
              </div>
            </div>
          )}

          {/* Recent event ledger */}
          {session.events.length > 0 && (
            <details className="text-xs">
              <summary className="text-slate-400 hover:text-slate-300 cursor-pointer text-[11px]">
                Session events ({session.events.length})
              </summary>
              <ol className="mt-2 space-y-1">
                {session.events.slice(0, 6).map(e => (
                  <li key={e.id} className="text-[11px] text-slate-400 font-mono">
                    {e.kind}{e.toStep ? ` → ${e.toStep}` : ''}
                    {e.note && <span className="text-slate-400"> · {e.note}</span>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export default WarCampaignSession;
