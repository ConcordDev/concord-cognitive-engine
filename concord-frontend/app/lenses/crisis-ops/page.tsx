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
import { ShieldAlert, MapPinned } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
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
    const r = await lensRun<{ crises?: Crisis[]; suggestions?: SkillSuggestion[] }>(
      'crisis', 'active_for_player', { worldId: wid },
    );
    if (isForbidden(r.data)) { setForbidden(true); setLoading(false); return; }
    // active_for_player returns crises/suggestions at top level (not nested in result)
    const payload = (r.data?.result ?? r.data) as { crises?: Crisis[]; suggestions?: SkillSuggestion[] };
    const list = payload?.crises ?? [];
    setCrises(list);
    setSuggestions(payload?.suggestions ?? []);
    setSelected((prev) => prev && list.find((c) => c.id === prev.id) ? prev : (list[0] || null));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const resolve = useCallback(async (crisisId: string) => {
    await lensRun('crisis', 'resolve', { crisisId });
    refresh();
  }, [refresh]);

  if (forbidden) return (
    <LensShell lensId="crisis-ops" asMain={false}>
      <AdminRequiredState roles={['admin', 'operator']} />
    </LensShell>
  );

  return (
    <LensShell lensId="crisis-ops" asMain={false}>
      <FirstRunTour lensId="crisis-ops" />
      <ManifestActionBar />
      <DepthBadge lensId="crisis-ops" size="sm" className="ml-2" />
      <div className="min-h-screen bg-[#0b0f17] text-gray-100 p-6">
        <header className="mb-5 flex items-center gap-3">
          <ShieldAlert className="h-8 w-8 text-rose-300" />
          <div>
            <h1 className="text-3xl font-semibold text-rose-300">Crisis Ops</h1>
            <p className="text-gray-400">
              Operational crisis-response console — map, triage, playbooks, command and resources.
            </p>
          </div>
          {reports.items.length > 0 && (
            <span className="ml-auto rounded-full border border-amber-500/40 bg-amber-900/20 px-3 py-1 text-xs text-amber-200">
              {reports.items.length} incident report{reports.items.length === 1 ? '' : 's'} on file
            </span>
          )}
        </header>

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
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); resolve(c.id); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); resolve(c.id); } }}
                            className="rounded border border-rose-500/40 bg-rose-600/30 px-2 py-0.5 text-[10px] text-rose-100 hover:bg-rose-600/50"
                          >
                            Resolve
                          </span>
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
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <AlertsPanel worldId={worldId} />
            </section>
          </div>

          {/* CENTER: map + triage */}
          <div className="space-y-5 lg:col-span-2">
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <CrisisMap />
            </section>
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
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

        {/* Resource inventory + incident log when no crisis is selected */}
        {!selected && (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <ResourcePanel />
            </section>
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <IncidentReportPanel />
            </section>
          </div>
        )}

        <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <FemaDisasters />
        </section>
      </div>

      <RecentMineCard domain="crisis-ops" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="crisis-ops" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="crisis-ops" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
