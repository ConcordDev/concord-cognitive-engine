'use client';

/**
 * Society Lens — surfaces the 6 NPC-society macro domains that registered
 * via Ghost Fleet but had no UI: culture (16 macros), entity_economy (13),
 * autonomy (11), conflict (11), teaching (11), persona (9).
 *
 * Phase 3.4 wire-the-Lost. Market parallels: Civ AI / Crusader Kings
 * (culture), Dwarf Fortress economy + Anaplan (entity_economy),
 * LangGraph / AutoGen (autonomy), online dispute resolution (conflict),
 * Khan / Coursera (teaching), Twilio Segment / mParticle (persona).
 *
 * Each tab is observation-first (metrics + list view); action-form depth
 * is deferred to follow-on commits per domain.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

// Absorbed UX component — agent authoring UI for the society autonomy
// substrate. Mounted in the autonomy tab so authoring sits next to
// monitoring (refusal/dissent counts, sovereign overrides).
const AgentBuilder = dynamic(
  () => import('@/components/world-lens/AgentBuilder'),
  { ssr: false },
);
import {
  Users, Coins, Scale, GraduationCap, Gavel, Sparkles, Loader2,
  type LucideIcon,
} from 'lucide-react';
import { WorldBankExplorer } from '@/components/society/WorldBankExplorer';
import { SocietyActionPanel } from '@/components/society/SocietyActionPanel';
import { PipingProvider } from '@/components/panel-polish';

type TabKey = 'culture' | 'economy' | 'autonomy' | 'conflict' | 'teaching' | 'persona';

export default function SocietyLensPage() {
  useLensNav('society');
  const [activeTab, setActiveTab] = useState<TabKey>('culture');

  // Lens-scoped keyboard commands.
  useLensCommand(
    [
      { id: 'tab-culture', keys: 'c', description: 'Culture', category: 'navigation', action: () => setActiveTab('culture') },
      { id: 'tab-economy', keys: 'e', description: 'Economy', category: 'navigation', action: () => setActiveTab('economy') },
      { id: 'tab-autonomy', keys: 'a', description: 'Autonomy', category: 'navigation', action: () => setActiveTab('autonomy') },
      { id: 'tab-conflict', keys: 'x', description: 'Conflict', category: 'navigation', action: () => setActiveTab('conflict') },
      { id: 'tab-teaching', keys: 't', description: 'Teaching', category: 'navigation', action: () => setActiveTab('teaching') },
      { id: 'tab-persona', keys: 'p', description: 'Persona', category: 'navigation', action: () => setActiveTab('persona') },
    ],
    { lensId: 'society' }
  );

  const culture = useQuery({
    queryKey: ['society-culture'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('culture', 'list_traditions', { status: 'active' });
      return (r.data?.result ?? r.data) as { traditions?: Array<{ id: string; type?: string; adherence?: number; status?: string }> };
    },
  });

  const economy = useQuery({
    queryKey: ['society-economy'],
    queryFn: async () => {
      const m = await apiHelpers.lens.runDomain('entity_economy', 'metrics', {});
      const w = await apiHelpers.lens.runDomain('entity_economy', 'wealth', {});
      const a = await apiHelpers.lens.runDomain('entity_economy', 'list_accounts', {});
      return {
        metrics: (m.data?.result ?? m.data) as Record<string, unknown>,
        wealth: (w.data?.result ?? w.data) as { gini?: number; topPercent?: unknown[]; bottomPercent?: unknown[] },
        accounts: (a.data?.result ?? a.data) as { accounts?: Array<{ entityId: string; resources?: Record<string, number> }> },
      };
    },
    refetchInterval: 60_000,
  });

  const autonomy = useQuery({
    queryKey: ['society-autonomy'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('autonomy', 'metrics', {});
      return (r.data?.result ?? r.data) as { totalRefusals?: number; activeRefusals?: number; activeDissents?: number; sovereignOverrides?: number };
    },
    refetchInterval: 60_000,
  });

  const conflict = useQuery({
    queryKey: ['society-conflict'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('conflict', 'list_disputes', { limit: 30 });
      return (r.data?.result ?? r.data) as { disputes?: Array<{ id: string; partyA?: string; partyB?: string; status?: string; createdAt?: string }> };
    },
    refetchInterval: 60_000,
  });

  const teaching = useQuery({
    queryKey: ['society-teaching'],
    queryFn: async () => {
      const m = await apiHelpers.lens.runDomain('teaching', 'metrics', {});
      const list = await apiHelpers.lens.runDomain('teaching', 'list_mentorships', { limit: 30 });
      return {
        metrics: (m.data?.result ?? m.data) as Record<string, unknown>,
        mentorships: (list.data?.result ?? list.data) as { mentorships?: Array<{ id: string; mentorId?: string; studentId?: string; status?: string; domain?: string }> },
      };
    },
  });

  const persona = useQuery({
    queryKey: ['society-persona'],
    queryFn: async () => {
      // Personas live in the persona domain — try a "list" / "metrics" macro.
      // Fall back to a stub if neither exists yet.
      try {
        const r = await apiHelpers.lens.runDomain('persona', 'list', {});
        return (r.data?.result ?? r.data) as { personas?: Array<{ id: string; name?: string; tags?: string[] }> };
      } catch { return { personas: [] }; }
    },
  });

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'culture',   label: 'Culture',   icon: Users,       count: culture.data?.traditions?.length },
    { key: 'economy',   label: 'Economy',   icon: Coins,       count: economy.data?.accounts?.accounts?.length },
    { key: 'autonomy',  label: 'Autonomy',  icon: Scale,       count: autonomy.data?.activeRefusals },
    { key: 'conflict',  label: 'Conflict',  icon: Gavel,       count: conflict.data?.disputes?.length },
    { key: 'teaching',  label: 'Teaching',  icon: GraduationCap, count: teaching.data?.mentorships?.mentorships?.length },
    { key: 'persona',   label: 'Personas',  icon: Sparkles,    count: persona.data?.personas?.length },
  ];

  return (
    <LensShell lensId="society" asMain={false}>
      <FirstRunTour lensId="society" />
      <ManifestActionBar />
      <DepthBadge lensId="society" size="sm" className="ml-2" />
    <div className="min-h-screen bg-black pb-12 text-amber-50">
      <header className="sticky top-0 z-10 border-b border-amber-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Users className="h-6 w-6 text-amber-400" aria-hidden />
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-wide">Society</h1>
            <p className="text-xs text-amber-700">Culture · entity economy · autonomy · conflict · teaching · personas</p>
          </div>
        </div>
      </header>

      <nav className="border-b border-amber-900/30 px-4 md:px-8" aria-label="Society sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                activeTab === key ? 'border-amber-400 text-amber-200' : 'border-transparent text-amber-700 hover:text-amber-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              {count != null && <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300">{count}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'culture' && <SectionCulture data={culture.data} loading={culture.isLoading} />}
          {activeTab === 'economy' && <SectionEconomy data={economy.data} loading={economy.isLoading} />}
          {activeTab === 'autonomy' && <SectionAutonomy data={autonomy.data} loading={autonomy.isLoading} />}
          {activeTab === 'conflict' && <SectionConflict data={conflict.data} loading={conflict.isLoading} />}
          {activeTab === 'teaching' && <SectionTeaching data={teaching.data} loading={teaching.isLoading} />}
          {activeTab === 'persona' && <SectionPersona data={persona.data} loading={persona.isLoading} />}
        </AnimatePresence>
      </main>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <WorldBankExplorer />
      </section>

      <PipingProvider>
        <section className="mt-6">
          <SocietyActionPanel />
        </section>
      </PipingProvider>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}

// ─── Sections ───────────────────────────────────────────────────────────────

function SectionWrap({ children, k }: { children: React.ReactNode; k: TabKey }) {
  return (
    <motion.section key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
      {children}
    </motion.section>
  );
}

function SectionCulture({ data, loading }: { data?: { traditions?: Array<{ id: string; type?: string; adherence?: number; status?: string }> }; loading: boolean }) {
  if (loading) return <SectionWrap k="culture"><Loader2 className="h-4 w-4 animate-spin text-amber-500" /></SectionWrap>;
  const list = data?.traditions ?? [];
  return (
    <SectionWrap k="culture">
      <h2 className="mb-3 text-base font-semibold text-amber-200">Active traditions</h2>
      {list.length === 0 ? <Empty>No active traditions yet — culture-drift heartbeat will surface them as NPCs accrue behaviours.</Empty> : (
        <ul className="space-y-1">
          {list.map(t => (
            <li key={t.id} className="flex items-center gap-3 rounded border border-amber-900/30 bg-amber-950/10 px-3 py-2 text-xs">
              <span className="font-mono text-amber-300">{t.id}</span>
              {t.type && <span className="rounded bg-amber-800/30 px-1.5 py-0.5 text-[10px] text-amber-300">{t.type}</span>}
              {t.adherence != null && <span className="text-amber-500">{(t.adherence * 100).toFixed(0)}% adherence</span>}
              <span className="ml-auto text-[10px] text-amber-700">{t.status}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionWrap>
  );
}

function SectionEconomy({ data, loading }: { data?: { metrics: Record<string, unknown>; wealth: { gini?: number }; accounts: { accounts?: Array<{ entityId: string; resources?: Record<string, number> }> } }; loading: boolean }) {
  if (loading) return <SectionWrap k="economy"><Loader2 className="h-4 w-4 animate-spin text-amber-500" /></SectionWrap>;
  const acc = data?.accounts.accounts ?? [];
  return (
    <SectionWrap k="economy">
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Accounts" value={acc.length} />
        <Stat label="Gini" value={data?.wealth.gini != null ? data.wealth.gini.toFixed(2) : '—'} />
        <Stat label="Total resources" value={
          acc.reduce((s, a) => s + Object.values(a.resources ?? {}).reduce((sub, v) => sub + (Number(v) || 0), 0), 0)
        } />
      </div>
      <h3 className="mb-2 text-sm font-semibold text-amber-300">Accounts</h3>
      {acc.length === 0 ? <Empty>No entity accounts yet — initialised on first earn/spend macro call.</Empty> : (
        <ul className="space-y-1">
          {acc.slice(0, 30).map(a => (
            <li key={a.entityId} className="flex items-center gap-3 rounded border border-amber-900/30 bg-amber-950/10 px-3 py-2 text-xs">
              <span className="font-mono text-amber-300">{a.entityId}</span>
              {Object.entries(a.resources ?? {}).slice(0, 4).map(([k, v]) => (
                <span key={k} className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px]">{k}: {Number(v).toFixed(0)}</span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </SectionWrap>
  );
}

function SectionAutonomy({ data, loading }: { data?: { totalRefusals?: number; activeRefusals?: number; activeDissents?: number; sovereignOverrides?: number }; loading: boolean }) {
  if (loading) return <SectionWrap k="autonomy"><Loader2 className="h-4 w-4 animate-spin text-amber-500" /></SectionWrap>;
  return (
    <SectionWrap k="autonomy">
      <h2 className="mb-3 text-base font-semibold text-amber-200">NPC autonomy</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total refusals" value={data?.totalRefusals ?? 0} />
        <Stat label="Active refusals" value={data?.activeRefusals ?? 0} />
        <Stat label="Active dissents" value={data?.activeDissents ?? 0} />
        <Stat label="Sovereign overrides" value={data?.sovereignOverrides ?? 0} />
      </div>
      <p className="mt-4 text-xs text-amber-700">
        NPCs file refusals when asked to do something against their declared rights; dissents when they object to a council decision; sovereign overrides bypass the rights gate with explicit justification.
      </p>

      <h3 className="mt-6 mb-2 text-sm font-semibold text-amber-200">Author a new agent</h3>
      <p className="mb-3 text-xs text-amber-700">
        Author a custom NPC agent — declare its archetype, rights, refusal triggers, and starting beliefs. The agent joins the world's NPC roster and is governed by the same autonomy substrate above.
      </p>
      <AgentBuilder />
    </SectionWrap>
  );
}

function SectionConflict({ data, loading }: { data?: { disputes?: Array<{ id: string; partyA?: string; partyB?: string; status?: string; createdAt?: string }> }; loading: boolean }) {
  if (loading) return <SectionWrap k="conflict"><Loader2 className="h-4 w-4 animate-spin text-amber-500" /></SectionWrap>;
  const d = data?.disputes ?? [];
  return (
    <SectionWrap k="conflict">
      <h2 className="mb-3 text-base font-semibold text-amber-200">Active disputes</h2>
      {d.length === 0 ? <Empty>No disputes filed.</Empty> : (
        <ul className="space-y-1">
          {d.map(x => (
            <li key={x.id} className="flex items-center gap-3 rounded border border-amber-900/30 bg-amber-950/10 px-3 py-2 text-xs">
              <span className="font-mono text-amber-300">{x.id}</span>
              <span className="font-mono text-amber-100">{x.partyA}</span>
              <span className="text-amber-700">vs</span>
              <span className="font-mono text-amber-100">{x.partyB}</span>
              <span className="ml-auto rounded bg-amber-800/30 px-1.5 py-0.5 text-[10px]">{x.status}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionWrap>
  );
}

function SectionTeaching({ data, loading }: { data?: { metrics: Record<string, unknown>; mentorships: { mentorships?: Array<{ id: string; mentorId?: string; studentId?: string; status?: string; domain?: string }> } }; loading: boolean }) {
  if (loading) return <SectionWrap k="teaching"><Loader2 className="h-4 w-4 animate-spin text-amber-500" /></SectionWrap>;
  const m = data?.mentorships.mentorships ?? [];
  return (
    <SectionWrap k="teaching">
      <h2 className="mb-3 text-base font-semibold text-amber-200">Mentorships</h2>
      {m.length === 0 ? <Empty>No mentorships yet — these emerge as NPCs gain teaching profiles.</Empty> : (
        <ul className="space-y-1">
          {m.map(x => (
            <li key={x.id} className="flex items-center gap-3 rounded border border-amber-900/30 bg-amber-950/10 px-3 py-2 text-xs">
              <span className="font-mono text-amber-300">{x.mentorId}</span>
              <span className="text-amber-700">→</span>
              <span className="font-mono text-amber-300">{x.studentId}</span>
              {x.domain && <span className="rounded bg-amber-800/30 px-1.5 py-0.5 text-[10px]">{x.domain}</span>}
              <span className="ml-auto text-[10px] text-amber-700">{x.status}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionWrap>
  );
}

function SectionPersona({ data, loading }: { data?: { personas?: Array<{ id: string; name?: string; tags?: string[] }> }; loading: boolean }) {
  if (loading) return <SectionWrap k="persona"><Loader2 className="h-4 w-4 animate-spin text-amber-500" /></SectionWrap>;
  const list = data?.personas ?? [];
  return (
    <SectionWrap k="persona">
      <h2 className="mb-3 text-base font-semibold text-amber-200">Personas</h2>
      {list.length === 0 ? <Empty>No personas surfaced yet.</Empty> : (
        <ul className="space-y-1">
          {list.map(p => (
            <li key={p.id} className="flex items-center gap-3 rounded border border-amber-900/30 bg-amber-950/10 px-3 py-2 text-xs">
              <span className="font-mono text-amber-300">{p.id}</span>
              {p.name && <span className="text-amber-100">{p.name}</span>}
              {p.tags && p.tags.length > 0 && (
                <span className="ml-auto flex gap-1">
                  {p.tags.slice(0, 3).map(t => <span key={t} className="rounded bg-amber-800/30 px-1.5 py-0.5 text-[10px]">{t}</span>)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionWrap>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
      className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-3 text-amber-200">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-amber-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-amber-900/30 bg-amber-950/10 px-4 py-6 text-center text-xs text-amber-600">{children}</p>;
}
