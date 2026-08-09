'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ReflectionFeed } from '@/components/reflection/ReflectionFeed';
import { ReflectionSection } from '@/components/reflection/ReflectionSection';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, AlertTriangle, CheckCircle2,
  Brain, Eye, Shield, BarChart3,
  BookOpen, Users,
} from 'lucide-react';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { ErrorState } from '@/components/common/EmptyState';
import { DTUExportButton } from '@/components/lens/DTUExportButton';

// Mirror icon alias
const Mirror = Eye;

interface Reflection {
  id: string;
  timestamp: string;
  quality: number;
  checks: Record<string, number>;
  insights: { type: string; message: string; severity: number }[];
  corrections: string[];
}

type Mode = 'journal' | 'selfcritique';

export default function ReflectionLensPage() {
  useLensNav('reflection');
  const [mode, setMode] = useState<Mode>('journal');

  const { data: status, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['reflection-status'],
    queryFn: () => apiHelpers.reflection.status().then((r) => r.data),
    refetchInterval: 15000,
  });

  const { data: recent, isError: isError2, error: error2, refetch: refetch2 } = useQuery({
    queryKey: ['reflection-recent'],
    queryFn: () => apiHelpers.reflection.recent(20).then((r) => r.data),
  });

  const { data: selfModel, isError: isError3, error: error3, refetch: refetch3 } = useQuery({
    queryKey: ['reflection-self-model'],
    queryFn: () => apiHelpers.reflection.selfModel().then((r) => r.data),
  });

  const reflections: Reflection[] = useMemo(() => recent?.reflections || [], [recent]);
  const model = selfModel?.selfModel || status?.selfModel || {};
  const stats = status?.stats || {};

  // Quality-band filter for the recent reflections list — a 50-deep
  // log is unreadable.  Letting the user narrow to the failing-quality
  // band ('low': <0.4) makes the lens useful for diagnosing drift.
  const [qualityBand, setQualityBand] = useState<'all' | 'low' | 'mid' | 'high'>('all');
  const visibleReflections = useMemo(() => {
    if (qualityBand === 'all') return reflections;
    return reflections.filter((r) => {
      if (qualityBand === 'low')  return r.quality < 0.4;
      if (qualityBand === 'mid')  return r.quality >= 0.4 && r.quality < 0.7;
      return r.quality >= 0.7;
    });
  }, [reflections, qualityBand]);

  useLensCommand(
    [
      { id: 'mode-journal', keys: 'j', description: 'Journal',          category: 'view', action: () => setMode('journal') },
      { id: 'mode-critique',keys: 's', description: 'Self-Critique Log',category: 'view', action: () => setMode('selfcritique') },
      { id: 'refresh',     keys: 'r', description: 'Refresh',     category: 'actions',
        action: () => { refetch(); refetch2(); refetch3(); } },
      { id: 'band-all',    keys: '0', description: 'All quality', category: 'view', action: () => setQualityBand('all') },
      { id: 'band-low',    keys: '1', description: 'Low (<40%)',  category: 'view', action: () => setQualityBand('low') },
      { id: 'band-mid',    keys: '2', description: 'Mid (40-70%)',category: 'view', action: () => setQualityBand('mid') },
      { id: 'band-high',   keys: '3', description: 'High (70%+)', category: 'view', action: () => setQualityBand('high') },
    ],
    { lensId: 'reflection' }
  );

  const avgQuality = reflections.length > 0
    ? reflections.reduce((s, r) => s + r.quality, 0) / reflections.length
    : 0;

  const checkNames: Record<string, string> = {
    factConsistency: 'Fact Consistency',
    relevance: 'Relevance',
    grounding: 'Evidence Grounding',
    completeness: 'Completeness',
    selfConsistency: 'Self-Consistency',
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message} onRetry={() => { refetch(); refetch2(); refetch3(); }} />
      </div>
    );
  }

  return (
    <LensShell lensId="reflection" asMain={false}>
      <FirstRunTour lensId="reflection" />
      <div data-lens-theme="reflection" className="p-6 space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🪞</span>
            <div>
              <h1 className="text-xl font-bold">Reflection</h1>
              <p className="text-sm text-gray-400">
                Two distinct systems share this name — a personal journal, and the engine&apos;s own self-critique log.
              </p>
            </div>
            <DepthBadge lensId="reflection" size="sm" className="ml-2" />
          </div>

          {/* Mode switch — the honest disclosure that Journal (substrate B,
              a Day One-parity personal journaling companion, backend:
              server/domains/reflection.js) and Self-Critique Log (substrate
              A, the cognitive engine's own post-response quality-evaluation
              loop, backend: server.js "REFLECTION ENGINE MACROS" /
              ensureReflectionEngine / STATE.reflection) are TWO UNRELATED
              REAL SYSTEMS that happen to both be registered under the
              domain name "reflection" — the same naming-collision pattern
              documented for the `lattice` lens. They are never conflated
              here: each mode only renders its own data. */}
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 p-1" role="tablist" aria-label="Reflection mode">
            <button
              type="button" role="tab" aria-selected={mode === 'journal'}
              onClick={() => setMode('journal')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'journal' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" /> Journal <kbd className="text-[8px] opacity-60 ml-0.5">j</kbd>
            </button>
            <button
              type="button" role="tab" aria-selected={mode === 'selfcritique'}
              onClick={() => setMode('selfcritique')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'selfcritique' ? 'bg-neon-blue/80 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Brain className="w-3.5 h-3.5" /> Self-Critique Log <kbd className="text-[8px] opacity-60 ml-0.5">s</kbd>
            </button>
          </div>
        </header>

        {mode === 'journal' && (
          <div className="space-y-6">
            <ReflectionSection />
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
                <Users className="w-4 h-4 text-violet-400" /> Community
              </h2>
              <ReflectionFeed />
            </section>
          </div>
        )}

        {mode === 'selfcritique' && (
          <div className="space-y-6">
            <div className="rounded-lg border border-neon-blue/20 bg-neon-blue/5 px-3 py-2 text-xs text-gray-300 flex items-start gap-2">
              <Shield className="w-3.5 h-3.5 text-neon-blue mt-0.5 shrink-0" />
              <p>
                This is the cognitive engine&apos;s own self-critique loop — not your personal journal. Every
                {' '}{stats.reflectOnEveryNth ?? 5}th AI response is automatically evaluated for fact consistency,
                relevance, grounding, completeness, and self-consistency, and the results below feed the engine&apos;s
                self-model. It is a separate, real backend system from the Journal above; they only share the
                &quot;reflection&quot; name.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <DTUExportButton domain="reflection" data={{ reflections, selfModel: model, stats }} compact />
            </div>

            {/* Stats Row — correctly labeled: these are engine self-critique
                metrics, never "streak" (a journaling concept) or "mood" (the
                journal's own mood field, in Journal mode above). */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="lens-card">
                <BarChart3 className="w-5 h-5 text-neon-purple mb-2" />
                <p className="text-2xl font-bold">{status?.reflections ?? reflections.length}</p>
                <p className="text-sm text-gray-400">Reflections Logged</p>
              </div>
              <div className="lens-card">
                <TrendingUp className="w-5 h-5 text-orange-400 mb-2" />
                <p className="text-2xl font-bold">{stats.reflectionsRun || 0}</p>
                <p className="text-sm text-gray-400">Responses Evaluated</p>
              </div>
              <div className="lens-card">
                <CheckCircle2 className="w-5 h-5 text-neon-green mb-2" />
                <p className="text-2xl font-bold">{(avgQuality * 100).toFixed(0)}%</p>
                <p className="text-sm text-gray-400">Avg Quality</p>
              </div>
              <div className="lens-card">
                <Shield className="w-5 h-5 text-neon-yellow mb-2" />
                <p className="text-2xl font-bold">{((model.confidenceCalibration || 0) * 100).toFixed(0)}%</p>
                <p className="text-sm text-gray-400">Confidence Calibration</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Self-Model */}
              <div className="panel p-4 space-y-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <Brain className="w-4 h-4 text-neon-purple" /> Self-Model
                </h2>

                {model.strengths?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase mb-1">Strengths</p>
                    <div className="space-y-1">
                      {model.strengths.map((s: string, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-neon-green">
                          <CheckCircle2 className="w-3 h-3" /> {checkNames[s] || s}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {model.weaknesses?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase mb-1">Weaknesses</p>
                    <div className="space-y-1">
                      {model.weaknesses.map((w: string, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-yellow-400">
                          <AlertTriangle className="w-3 h-3" /> {checkNames[w] || w}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {model.biases?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase mb-1">Detected Biases</p>
                    {model.biases.map((b: string, i: number) => (
                      <p key={i} className="text-sm text-red-400">{b}</p>
                    ))}
                  </div>
                )}

                {!model.strengths?.length && !model.weaknesses?.length && (
                  <p className="text-sm text-gray-400">Self-model builds over time as reflections accumulate</p>
                )}

                <div className="border-t border-lattice-border pt-3 space-y-2">
                  <p className="text-xs text-gray-400 uppercase">Stats</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Responses evaluated</span>
                    <span className="text-gray-300">{stats.reflectionsRun || 0}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Self-corrections</span>
                    <span className="text-gray-300">{stats.selfCorrections || 0}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Quality improvements</span>
                    <span className="text-neon-green">{stats.qualityImprovements || 0}</span>
                  </div>
                </div>
              </div>

              {/* Quality Breakdown */}
              <div className="panel p-4">
                <h2 className="font-semibold mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-neon-cyan" /> Quality Dimensions
                </h2>
                {reflections.length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(checkNames).map(([key, label]) => {
                      const avg = reflections.reduce((s, r) => s + (r.checks[key] || 0), 0) / reflections.length;
                      return (
                        <div key={key}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-300">{label}</span>
                            <span className={`${avg > 0.7 ? 'text-neon-green' : avg > 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {(avg * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${avg > 0.7 ? 'bg-neon-green' : avg > 0.4 ? 'bg-yellow-400' : 'bg-red-400'}`}
                              style={{ width: `${avg * 100}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-center py-8 text-gray-400 text-sm">No reflections yet — interact with the system to generate data</p>
                )}
              </div>

              {/* Recent Reflections */}
              <div className="panel p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Mirror className="w-4 h-4 text-neon-green" /> Recent Reflections
                    {qualityBand !== 'all' && (
                      <span className="text-xs text-gray-400 font-normal">
                        ({visibleReflections.length} of {reflections.length})
                      </span>
                    )}
                  </h2>
                  <div className="flex items-center gap-1 text-[10px]">
                    {(['all', 'low', 'mid', 'high'] as const).map((b, i) => (
                      <button
                        key={b}
                        onClick={() => setQualityBand(b)}
                        className={`px-2 py-0.5 rounded border transition-colors ${
                          qualityBand === b
                            ? b === 'low' ? 'border-red-400/40 bg-red-400/15 text-red-400'
                            : b === 'mid' ? 'border-yellow-400/40 bg-yellow-400/15 text-yellow-400'
                            : b === 'high' ? 'border-neon-green/40 bg-neon-green/15 text-neon-green'
                            : 'border-neon-cyan/40 bg-neon-cyan/15 text-neon-cyan'
                            : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10'
                        }`}
                        title={b === 'low' ? 'Quality < 40%' : b === 'mid' ? '40-70%' : b === 'high' ? '> 70%' : 'All quality bands'}
                      >
                        {b}<kbd className="text-[8px] opacity-60 ml-0.5">{i}</kbd>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {visibleReflections.map((r, index) => (
                    <motion.div key={r.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="lens-card">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">{new Date(r.timestamp).toLocaleString()}</span>
                        <span className={`text-sm font-bold ${r.quality > 0.7 ? 'text-neon-green' : r.quality > 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {(r.quality * 100).toFixed(0)}%
                        </span>
                      </div>
                      {r.insights.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {r.insights.map((ins, i) => (
                            <p key={i} className="text-xs text-yellow-400">{ins.message}</p>
                          ))}
                        </div>
                      )}
                      {r.corrections.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {r.corrections.map((c, i) => (
                            <p key={i} className="text-xs text-red-400">{c}</p>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}
                  {reflections.length === 0 && (
                    <p className="text-center py-4 text-gray-400 text-sm">No reflections recorded yet</p>
                  )}
                  {reflections.length > 0 && visibleReflections.length === 0 && (
                    <p className="text-center py-4 text-gray-400 text-sm">
                      No reflections in the <span className={qualityBand === 'low' ? 'text-red-400' : qualityBand === 'mid' ? 'text-yellow-400' : 'text-neon-green'}>{qualityBand}</span> band.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ConnectiveTissueBar */}
        <ConnectiveTissueBar lensId="reflection" />


        <a href="#reflection-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to reflection content</a>
      </div>
    </LensShell>
  );
}
