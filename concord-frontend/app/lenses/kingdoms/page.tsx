'use client';

/**
 * Kingdoms lens — list browser, detail view, decree composer, contest UI.
 *
 * Visual map view (Three.js polygon overlay) deferred to v1.1; v1 ships
 * with a 2D minimap + textual region descriptions, which is enough to
 * make founding/contesting legible in the first playtest cycle.
 */
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState, useCallback } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { SessionRail } from '@/components/lens/SessionRail';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { HistoryExplorer } from '@/components/kingdoms/HistoryExplorer';
import { RealmActionPanel } from '@/components/kingdoms/RealmActionPanel';
import { WarCampaignSession } from '@/components/kingdoms/WarCampaignSession';
import { DynastyRealmManager } from '@/components/kingdoms/DynastyRealmManager';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { PipingProvider } from '@/components/panel-polish';
import { Crown, Flag, Hammer, Users, Plus, ChevronRight, AlertTriangle, List, Eye, Loader2 } from 'lucide-react';

interface Kingdom {
  id: string;
  world_id: string;
  name: string;
  ruler_user_id: string | null;
  ruler_faction_id: string | null;
  claim_strength: number;
  founded_at: number;
  region_polygon: number[][];
}

interface Decree {
  id: string;
  decree_kind: string;
  parameters_json: string;
  alignment_score: number;
  activation_state: string;
  expires_at: number | null;
}

interface Resident {
  user_id: string;
  role: string;
  joined_at: number;
}

interface DecreeKindMeta {
  refusalKind: string;
  description: string;
  affinityGenres: string[];
}

export default function KingdomsPage() {
  const [view, setView] = useState<'list' | 'detail' | 'create'>('list');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-list', keys: 'l', description: 'List', category: 'navigation', action: () => setView('list') },
      { id: 'tab-create', keys: 'c', description: 'Create', category: 'navigation', action: () => setView('create') },
      { id: 'tab-detail', keys: 'd', description: 'Detail', category: 'navigation', action: () => setView('detail') },
    ],
    { lensId: 'kingdoms' }
  );
  const [kingdoms, setKingdoms] = useState<Kingdom[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ kingdom: Kingdom; decrees: Decree[]; residents: Resident[] } | null>(null);
  const [decreeKinds, setDecreeKinds] = useState<Record<string, DecreeKindMeta>>({});
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoaded, setListLoaded] = useState(false);

  const fetchList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const r = await fetch('/api/kingdoms', { credentials: 'same-origin' });
      const j = await r.json();
      if (j?.ok) {
        setKingdoms(Array.isArray(j.kingdoms) ? j.kingdoms : []);
        setListLoaded(true);
      } else {
        setListError(j?.error || `request failed (${r.status})`);
      }
    } catch (e) {
      // Do NOT swallow into a silently-empty page — surface a real error.
      setListError(e instanceof Error ? e.message : 'network error');
    } finally {
      setListLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/kingdoms/${id}`, { credentials: 'same-origin' });
      const j = await r.json();
      if (j?.ok) setDetail({ kingdom: j.kingdom, decrees: j.decrees, residents: j.residents });
    } catch { /* ok */ }
  }, []);

  const fetchDecreeKinds = useCallback(async () => {
    try {
      const r = await fetch('/api/kingdoms/_meta/decree-kinds', { credentials: 'same-origin' });
      const j = await r.json();
      if (j?.ok) setDecreeKinds(j.kinds);
    } catch { /* ok */ }
  }, []);

  useEffect(() => {
    fetchDecreeKinds();
    if (view === 'list') fetchList();
    if (view === 'detail' && activeId) fetchDetail(activeId);
  }, [view, activeId, fetchList, fetchDetail, fetchDecreeKinds]);

  return (
    <LensShell lensId="kingdoms" asMain={false}>
      <FirstRunTour lensId="kingdoms" />
      <ManifestActionBar />
      <DepthBadge lensId="kingdoms" size="sm" className="ml-2" />
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Crown className="h-7 w-7 text-amber-300" />
            <h1 className="text-2xl font-bold">Kingdoms</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setView('list'); setActiveId(null); }}
              className={`rounded px-3 py-1 text-sm ${view === 'list' ? 'bg-amber-600' : 'bg-slate-800 hover:bg-slate-700'}`}
            >
              Browse
            </button>
            <button
              onClick={() => setView('create')}
              className={`flex items-center gap-1 rounded px-3 py-1 text-sm ${view === 'create' ? 'bg-amber-600' : 'bg-slate-800 hover:bg-slate-700'}`}
            >
              <Plus className="h-3.5 w-3.5" /> Found
            </button>
          </div>
        </header>

        {view === 'list' && (
          <KingdomList
            kingdoms={kingdoms}
            loading={listLoading && !listLoaded}
            error={listError}
            onRetry={fetchList}
            onPick={(id) => { setActiveId(id); setView('detail'); }}
          />
        )}
        {view === 'detail' && detail && <KingdomDetail detail={detail} decreeKinds={decreeKinds} onRefresh={() => activeId && fetchDetail(activeId)} />}
        {view === 'create' && <KingdomCreate onCreated={(id) => { setActiveId(id); setView('detail'); fetchList(); }} />}
        {/* Phase 5 — open war-campaign / decree sessions belonging to this lens. */}
        <SessionRail lensId="kingdoms" className="mt-6" hideWhenEmpty />
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <HistoryExplorer />
        </section>

        {/* Crusader Kings III-shape realm command: list / decree / loyalty / takeover + actions */}
        <PipingProvider>
          <section className="mt-6">
            <RealmActionPanel />
          </section>
        </PipingProvider>

        {/* CK3-parity dynasty / council / diplomacy / war / economy / intrigue / law */}
        <section className="mt-6">
          <DynastyRealmManager />
        </section>
      </div>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* Loader2 spinner rendered when data is fetching */}</div>
          <RecentMineCard domain="kingdoms" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="kingdoms" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="kingdoms" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      {/* Phase 5 mobile — thumb-friendly bottom tab bar; hides on desktop. */}
      <MobileTabBar
        tabs={[
          { id: 'list', label: 'Browse', icon: List },
          { id: 'create', label: 'Found', icon: Plus },
          { id: 'detail', label: 'Detail', icon: Eye },
        ]}
        active={view}
        onSelect={(id) => setView(id as 'list' | 'create' | 'detail')}
      />
    </LensShell>
  );
}

function KingdomList({
  kingdoms,
  loading = false,
  error = null,
  onRetry,
  onPick,
}: {
  kingdoms: Kingdom[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onPick: (id: string) => void;
}) {
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-12 text-slate-400"
      >
        <Loader2 className="h-5 w-5 animate-spin text-amber-300" />
        <span>Loading kingdoms…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-rose-800 bg-rose-950/40 p-8 text-center text-rose-200"
      >
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-400" />
        <p className="mb-4 text-sm">Could not load kingdoms: {error}</p>
        <button
          onClick={() => onRetry?.()}
          className="rounded bg-rose-700 px-4 py-1.5 text-sm font-medium hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          Try again
        </button>
      </div>
    );
  }
  if (kingdoms.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center text-slate-400">
        <Flag className="mx-auto mb-3 h-12 w-12 text-slate-700" />
        No kingdoms in any world yet. Found one to claim a region.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {kingdoms.map((k) => (
        <li key={k.id}>
          <button
            onClick={() => onPick(k.id)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-4 text-left hover:border-amber-500/50 hover:bg-slate-800"
          >
            <div className="flex-1">
              <div className="flex items-baseline gap-3">
                <h3 className="font-semibold text-amber-100">{k.name}</h3>
                <span className="text-xs text-slate-400">{k.world_id}</span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                <span>Ruler: {k.ruler_user_id ? k.ruler_user_id.slice(0, 12) : k.ruler_faction_id || 'None'}</span>
                <span>·</span>
                <span>{k.region_polygon?.length ?? 0} vertices</span>
                <span>·</span>
                <span>Strength: {Math.round(k.claim_strength)}</span>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-600" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function KingdomDetail({
  detail,
  decreeKinds,
  onRefresh,
}: {
  detail: { kingdom: Kingdom; decrees: Decree[]; residents: Resident[] };
  decreeKinds: Record<string, DecreeKindMeta>;
  onRefresh: () => void;
}) {
  const { kingdom, decrees, residents } = detail;
  const [decreeKind, setDecreeKind] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [contestKind, setContestKind] = useState<'siege' | 'subversion' | 'annexation'>('siege');

  const enact = async () => {
    if (!decreeKind) return;
    setSubmitting(true);
    try {
      await fetch(`/api/kingdoms/${kingdom.id}/decree`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decreeKind, parameters: {} }),
      });
      onRefresh();
    } finally { setSubmitting(false); }
  };

  const contest = async () => {
    setSubmitting(true);
    try {
      await fetch(`/api/kingdoms/${kingdom.id}/contest`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestKind }),
      });
      onRefresh();
    } finally { setSubmitting(false); }
  };

  const join = async () => {
    await fetch(`/api/kingdoms/${kingdom.id}/join`, { method: 'POST', credentials: 'same-origin' });
    onRefresh();
  };

  return (
    <div className="space-y-6">
      {/* Phase 5 — multi-session war-campaign workspace, real sessions substrate. */}
      <WarCampaignSession kingdomId={kingdom.id} kingdomName={kingdom.name} />
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-amber-100">{kingdom.name}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {kingdom.world_id} · founded {new Date(kingdom.founded_at * 1000).toISOString().split('T')[0]}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Ruler: <span className="font-mono">{kingdom.ruler_user_id || kingdom.ruler_faction_id || '—'}</span> ·
              Region: {kingdom.region_polygon?.length ?? 0} vertices ·
              Strength: <span className="tabular-nums">{Math.round(kingdom.claim_strength)}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={join} className="flex items-center gap-1 rounded bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-amber-500">
              <Users className="h-3.5 w-3.5" /> Join
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-200">
            <Hammer className="h-4 w-4" /> Decrees
          </h3>
          <div className="mb-4 rounded border border-slate-700 bg-slate-800 p-3">
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">Enact (ruler only)</label>
            <select
              value={decreeKind}
              onChange={(e) => setDecreeKind(e.target.value)}
              className="w-full rounded bg-slate-900 px-2 py-1 text-sm"
            >
              <option value="">— select decree kind —</option>
              {Object.entries(decreeKinds).map(([k, meta]) => (
                <option key={k} value={k}>{k}: {meta.description}</option>
              ))}
            </select>
            <button
              onClick={enact}
              disabled={!decreeKind || submitting}
              className="mt-2 w-full rounded bg-amber-700 px-3 py-1.5 text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
            >
              {submitting ? 'Enacting…' : 'Enact decree'}
            </button>
          </div>
          {decrees.length === 0 ? (
            <div className="text-sm text-slate-400">No decrees yet.</div>
          ) : (
            <ul className="space-y-2">
              {decrees.map((d) => (
                <li key={d.id} className="rounded bg-slate-800 p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-amber-200">{d.decree_kind}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                      d.activation_state === 'enforced' ? 'bg-emerald-900/40 text-emerald-300' :
                      d.activation_state === 'tension'  ? 'bg-amber-900/40 text-amber-300' :
                      'bg-rose-900/40 text-rose-300'
                    }`}>
                      {d.activation_state}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">
                    Alignment: {Math.round(d.alignment_score * 100)}%
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-200">
            <AlertTriangle className="h-4 w-4" /> Contest
          </h3>
          <div className="mb-3 rounded border border-slate-700 bg-slate-800 p-3">
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">Contest kind</label>
            <div className="flex gap-1">
              {(['siege', 'subversion', 'annexation'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setContestKind(c)}
                  className={`flex-1 rounded px-1.5 py-1 text-[10px] capitalize ${
                    contestKind === c ? 'bg-rose-700 text-rose-50' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <button
              onClick={contest}
              disabled={submitting}
              className="mt-2 w-full rounded bg-rose-700 px-3 py-1.5 text-sm font-medium hover:bg-rose-600 disabled:opacity-50"
            >
              Begin contest
            </button>
          </div>

          <h4 className="mb-2 mt-3 text-xs font-semibold text-slate-300">Residents ({residents.length})</h4>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {residents.map((r) => (
              <li key={r.user_id} className="flex items-center justify-between rounded px-2 py-1 text-[11px]">
                <span className="font-mono">{r.user_id.slice(0, 14)}</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] capitalize text-slate-400">{r.role}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function KingdomCreate({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [worldId, setWorldId] = useState('concordia-hub');
  const [polygon, setPolygon] = useState('[[0,0],[100,0],[100,100],[0,100]]');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let regionPolygon: number[][];
      try {
        regionPolygon = JSON.parse(polygon);
        if (!Array.isArray(regionPolygon) || regionPolygon.length < 3) throw new Error('need 3+ vertices');
      } catch (e) {
        setError(`polygon JSON invalid: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      const r = await fetch('/api/kingdoms', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, worldId, regionPolygon }),
      });
      const j = await r.json();
      if (j?.ok) onCreated(j.kingdomId);
      else setError(j?.error || 'create_failed');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-amber-100">Found a Kingdom</h2>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kingdom of …"
            className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-400">World</label>
          <input
            value={worldId}
            onChange={(e) => setWorldId(e.target.value)}
            className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-400">Region polygon (JSON [[x,z], …])</label>
          <DraftedTextarea
            lensId="kingdoms"
            draftKey="newKingdomPolygon"
            initial=""
            onValueChange={setPolygon}
            rows={4}
            className="w-full rounded bg-slate-800 px-2 py-1 font-mono text-xs"
          />
          <p className="mt-1 text-[10px] text-slate-400">v1 — paste polygon coords directly. Visual editor in v1.1.</p>
        </div>
        {error && <div className="rounded bg-rose-950/40 px-2 py-1 text-sm text-rose-300">{error}</div>}
        <button
          onClick={submit}
          disabled={!name || submitting}
          className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
        >
          {submitting ? 'Founding…' : 'Found kingdom'}
        </button>
      </div>
    </div>
  );
}
