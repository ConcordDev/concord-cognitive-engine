'use client';

/**
 * /lenses/crisis-ops — operational crisis-response console.
 *
 * Surfaces the full crisis-ops backend: live incident map (USGS + NWS),
 * severity triage, per-crisis response playbooks, command rosters,
 * status timelines, an escalation alert feed, FEMA declarations, and a
 * deployable resource inventory.
 */

import { useEffect, useState, useCallback } from 'react';
import { ShieldAlert, MapPinned, RefreshCw } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun, isForbidden } from '@/lib/api/client';
import { AdminRequiredState } from '@/components/common/EmptyState';
import { FemaDisasters } from '@/components/crisis-ops/FemaDisasters';
import { CrisisMap } from '@/components/crisis-ops/CrisisMap';
import { TriagePanel } from '@/components/crisis-ops/TriagePanel';
import { PlaybookPanel } from '@/components/crisis-ops/PlaybookPanel';
import { TeamPanel } from '@/components/crisis-ops/TeamPanel';
import { TimelinePanel } from '@/components/crisis-ops/TimelinePanel';
import { AlertsPanel } from '@/components/crisis-ops/AlertsPanel';
import { ResourcePanel } from '@/components/crisis-ops/ResourcePanel';
import { IncidentReportPanel } from '@/components/crisis-ops/IncidentReportPanel';
import { PlaybooksPanel } from '@/components/crisis-ops/PlaybooksPanel';
import { useLensData } from '@/lib/hooks/use-lens-data';

interface Crisis {
  id: string;
  type: string;
  description: string;
  origin_world_id: string;
  started_at: number;
}
interface SkillSuggestion {
  skill_id: string;
  level: number;
}

const ACTIVE_WORLD_KEY = 'concordia:activeWorldId';

export default function CrisisOpsPage() {
  const [worldId, setWorldId] = useState('concordia-hub');
  const [crises, setCrises] = useState<Crisis[]>([]);
  const [suggestions, setSuggestions] = useState<SkillSuggestion[]>([]);
  const [crisisTypes, setCrisisTypes] = useState<string[]>([]);
  const [declareType, setDeclareType] = useState('');
  // FIX-crisis-ops-007: Resolve is a two-step confirm (sticky — it stays
  // armed until Confirm or Cancel; it cannot be a real <button> because
  // the crisis row itself is a button, so the step lives on the span).
  const [confirmResolveId, setConfirmResolveId] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState<Crisis | null>(null);

  // Persisted incident reports (durable after-action record — real artifact CRUD).
  const reports = useLensData('crisis-ops', 'incident_report', { noSeed: true, limit: 50 });

  useLensCommand([
    { id: 'refresh', keys: 'r', description: 'Refresh', category: 'navigation', action: () => refresh() },
  ], { lensId: 'crisis-ops' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const wid = (typeof window !== 'undefined' && localStorage.getItem(ACTIVE_WORLD_KEY)) || 'concordia-hub';
    setWorldId(wid);
    const r = await lensRun<{ crises?: Crisis[]; suggestions?: SkillSuggestion[]; crisisTypes?: string[] }>(
      'crisis', 'active_for_player', { worldId: wid },
    );
    if (isForbidden(r.data)) { setForbidden(true); setLoading(false); return; }
    // active_for_player returns crises/suggestions at top level (not nested in result)
    const payload = (r.data?.result ?? r.data) as { crises?: Crisis[]; suggestions?: SkillSuggestion[]; crisisTypes?: string[] };
    const list = payload?.crises ?? [];
    setCrises(list);
    setSuggestions(payload?.suggestions ?? []);
    if (payload?.crisisTypes?.length) {
      setCrisisTypes(payload.crisisTypes);
      setDeclareType((prev) => prev || payload.crisisTypes![0]);
    }
    setSelected((prev) => prev && list.find((c) => c.id === prev.id) ? prev : (list[0] || null));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const resolve = useCallback(async (crisisId: string) => {
    await lensRun('crisis', 'resolve', { crisisId });
    refresh();
  }, [refresh]);

  const declare = useCallback(async () => {
    if (!declareType || declaring) return;
    setDeclaring(true);
    const r = await lensRun('crisis', 'declare', { type: declareType, worldId });
    if (r.data?.ok) await refresh();
    setDeclaring(false);
  }, [declareType, declaring, worldId, refresh]);

  if (forbidden) return (
    <LensShell lensId="crisis-ops" asMain={false}>
      <AdminRequiredState roles={['admin', 'operator']} />
    </LensShell>
  );

  return (
    <LensShell lensId="crisis-ops" asMain={false}>

      <DepthBadge lensId="crisis-ops" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="crisis-ops"
        theme="crisis-ops"
        crumb="Crisis Ops"
        subtitle="Operational crisis-response console: map, triage, playbooks, command and resources."
        actions={
          reports.items.length > 0 ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-900/20 px-3 py-1 text-xs text-amber-200">
              {reports.items.length} incident report{reports.items.length === 1 ? '' : 's'} on file
            </span>
          ) : undefined
        }
        cta={{ label: 'Refresh crises', icon: RefreshCw, onClick: () => void refresh(), title: 'Re-poll active crises (R)', disabled: loading }}
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {/* LEFT: active crises + alerts */}
          <div className="space-y-5 lg:col-span-1">
            <section className="rounded-xl border border-rose-700/25 bg-rose-900/5 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <MapPinned className="h-4 w-4 text-rose-300" /> Active world crises
              </h2>
              {loading && <p className="text-xs text-gray-400">Loading…</p>}
              {!loading && crises.length === 0 && (
                <p className="rounded border border-white/10 bg-white/5 p-4 text-center text-xs text-gray-400">
                  No active crises. The world is at rest.
                </p>
              )}
              {!loading && crises.length > 0 && (
                <ul className="space-y-2">
                  {crises.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(c)}
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          selected?.id === c.id
                            ? 'border-rose-400/60 bg-rose-900/30'
                            : 'border-rose-700/30 bg-rose-900/10 hover:bg-rose-900/20'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-rose-200">{c.type}</span>
                          {confirmResolveId === c.id ? (
                            <span className="inline-flex items-center gap-1">
                              <span
                                role="button"
                                tabIndex={0}
                                aria-label={`Confirm resolve ${c.type}`}
                                onClick={(e) => { e.stopPropagation(); setConfirmResolveId(null); resolve(c.id); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setConfirmResolveId(null); resolve(c.id); } }}
                                className="rounded border border-rose-400/60 bg-rose-600/50 px-2 py-0.5 text-[10px] font-semibold text-rose-50 hover:bg-rose-600/70"
                              >
                                Resolve {c.type}? Confirm
                              </span>
                              <span
                                role="button"
                                tabIndex={0}
                                aria-label="Cancel resolve"
                                onClick={(e) => { e.stopPropagation(); setConfirmResolveId(null); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setConfirmResolveId(null); } }}
                                className="rounded border border-zinc-500/40 bg-zinc-700/40 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-700/60"
                              >
                                Cancel
                              </span>
                            </span>
                          ) : (
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={`Resolve ${c.type}`}
                              onClick={(e) => { e.stopPropagation(); setConfirmResolveId(c.id); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setConfirmResolveId(c.id); } }}
                              className="rounded border border-rose-500/40 bg-rose-600/30 px-2 py-0.5 text-[10px] text-rose-100 hover:bg-rose-600/50"
                            >
                              Resolve
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[12px] text-gray-300">{c.description}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {suggestions.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-400">
                    Your deployable skills
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <span
                        key={s.skill_id}
                        className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-300"
                      >
                        {s.skill_id} · L{s.level}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {crisisTypes.length > 0 && (
                <div className="mt-4 border-t border-rose-700/20 pt-3">
                  <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-400">
                    Declare a crisis
                  </h3>
                  <div className="flex gap-2">
                    <select
                      value={declareType}
                      onChange={(e) => setDeclareType(e.target.value)}
                      aria-label="Crisis type"
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white"
                    >
                      {crisisTypes.map((t) => (
                        <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={declaring || !declareType}
                      onClick={() => void declare()}
                      className="shrink-0 rounded bg-rose-600/40 px-2 py-1 text-xs text-rose-100 hover:bg-rose-600/60 disabled:opacity-40"
                    >
                      {declaring ? 'Declaring…' : 'Declare'}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">
                    Declaring opens the command deck — playbook, roster, and timeline — on the new crisis.
                  </p>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <AlertsPanel worldId={worldId} />
            </section>
          </div>

          {/* CENTER: map + triage */}
          <div className="space-y-5 lg:col-span-2">
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <CrisisMap />
            </section>
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <TriagePanel
                worldId={worldId}
                onSelect={(c) => setSelected({
                  id: c.id, type: c.type, description: c.description,
                  origin_world_id: worldId, started_at: c.started_at,
                })}
              />
            </section>
          </div>
        </div>

        {/* SELECTED-CRISIS COMMAND DECK */}
        {selected && (
          <section className="mt-5 rounded-xl border border-rose-500/30 bg-rose-900/10 p-4">
            <div className="mb-4 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-rose-300" />
              <h2 className="text-base font-semibold text-rose-200">
                Command deck — {selected.type}
              </h2>
              <span className="text-[11px] text-zinc-400">{selected.description}</span>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <PlaybookPanel crisisId={selected.id} crisisType={selected.type} />
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <TeamPanel crisisId={selected.id} />
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <TimelinePanel crisisId={selected.id} />
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <ResourcePanel crisisId={selected.id} />
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 lg:col-span-2">
                <IncidentReportPanel crisisId={selected.id} />
              </div>
            </div>
          </section>
        )}

        {/* Inventory, reports, playbooks + command when no crisis is selected */}
        {!selected && (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <ResourcePanel />
            </section>
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <IncidentReportPanel />
            </section>
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <PlaybooksPanel />
            </section>
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <TeamPanel />
            </section>
          </div>
        )}

        <section className="mt-5 rounded-2xl border border-white/10 bg-[#111] p-4">
          <FemaDisasters />
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
