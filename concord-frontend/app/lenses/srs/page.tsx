'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SrsRepos } from '@/components/srs/SrsRepos';
import { SrsWorkbench } from '@/components/srs/SrsWorkbench';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useCallback, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Plus, Award, RotateCcw, Clock, ChevronDown, ChevronRight,
} from 'lucide-react';
import { DTUPickerModal } from '@/components/dtu/DTUPickerModal';
import type { DTU } from '@/lib/api/generated-types';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// --- Types (mirrors server.js's ephemeral DTU-review SRS.cards shape) ---
interface DueSrsCard {
  dtu: DTU;
  card: {
    interval: number;
    easeFactor: number;
    repetitions: number;
    nextReview: string;
    history: { quality: number; reviewedAt: string }[];
  };
}

const QUALITY_BUTTONS = [
  { label: 'Again', sublabel: 'forgot it', quality: 0, color: 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30' },
  { label: 'Hard', sublabel: 'shaky', quality: 2, color: 'bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/30' },
  { label: 'Good', sublabel: 'recalled', quality: 4, color: 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30' },
  { label: 'Easy', sublabel: 'instant', quality: 5, color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/30' },
];

export default function SRSLensPage() {
  useLensNav('srs');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('srs');
  const queryClient = useQueryClient();

  // ─── "Review your knowledge" — spaced review of REAL DTUs you already
  // own, distinct from the purpose-built flashcard decks below. This is
  // the server's `SRS.cards` substrate (server.js `reviewSRSCard`/
  // `getDueCards`, tied into the affect system) — a genuinely different
  // feature from the Anki-parity deck engine: it schedules review of
  // things you've already written/saved anywhere in Concord, not cards
  // you author from scratch. ─────────────────────────────────────────
  const [revealed, setRevealed] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showWorkbench, setShowWorkbench] = useState(false);
  const [showSrsRepos, setShowSrsRepos] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3500);
  }, []);

  const dueQuery = useQuery({
    queryKey: ['srs-due'],
    queryFn: () => apiHelpers.srs.due().then((r) => r.data as { ok: boolean; cards: DueSrsCard[]; total: number }),
    refetchInterval: 30000,
  });

  const dueCards: DueSrsCard[] = useMemo(() => dueQuery.data?.cards || [], [dueQuery.data]);
  const current = dueCards[reviewIndex] || null;
  const remaining = Math.max(0, dueCards.length - reviewIndex);

  const addMutation = useMutation({
    // dtuId must be a REAL id from STATE.dtus — the ephemeral review
    // substrate rejects (honest `{ok:false}`, not a fabricated success)
    // anything else, and we surface that rejection instead of
    // pretending the add worked.
    mutationFn: (dtuId: string) => apiHelpers.srs.add(dtuId).then((r) => r.data as { ok: boolean; error?: string }),
    onSuccess: (data) => {
      if (data.ok) {
        flash('Added to spaced review.');
        queryClient.invalidateQueries({ queryKey: ['srs-due'] });
      } else {
        flash(data.error || 'Could not add that DTU to spaced review.');
      }
    },
    onError: (err) => flash(err instanceof Error ? err.message : 'Could not add that DTU to spaced review.'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ dtuId, quality }: { dtuId: string; quality: number }) =>
      apiHelpers.srs.review(dtuId, { quality }).then((r) => r.data as { ok: boolean; error?: string }),
    onSuccess: (data) => {
      if (data.ok) queryClient.invalidateQueries({ queryKey: ['srs-due'] });
      else flash(data.error || 'Review did not save.');
    },
    onError: (err) => flash(err instanceof Error ? err.message : 'Review did not save.'),
  });

  const handleReview = useCallback((quality: number) => {
    if (!current) return;
    setSessionReviewed((p) => p + 1);
    if (quality >= 3) setSessionCorrect((p) => p + 1);
    reviewMutation.mutate({ dtuId: current.dtu.id, quality });
    setRevealed(false);
    setReviewIndex((p) => p + 1);
  }, [current, reviewMutation]);

  const handlePickDtu = useCallback((dtu: DTU) => {
    addMutation.mutate(dtu.id);
  }, [addMutation]);

  // Lens-scoped keyboard commands. Anki idiom: 1-4 rate, space flips.
  const reviewCanFlip = !!current && !revealed;
  const reviewCanRate = !!current && revealed;
  useLensCommand(
    [
      { id: 'srs-flip', keys: 'space', description: 'Flip card / show answer', category: 'actions',
        action: () => { if (reviewCanFlip) setRevealed(true); }, global: true },
      { id: 'srs-again', keys: '1', description: 'Again (review again soon)', category: 'actions',
        action: () => { if (reviewCanRate) handleReview(0); }, global: true },
      { id: 'srs-hard', keys: '2', description: 'Hard', category: 'actions',
        action: () => { if (reviewCanRate) handleReview(2); }, global: true },
      { id: 'srs-good', keys: '3', description: 'Good', category: 'actions',
        action: () => { if (reviewCanRate) handleReview(4); }, global: true },
      { id: 'srs-easy', keys: '4', description: 'Easy', category: 'actions',
        action: () => { if (reviewCanRate) handleReview(5); }, global: true },
    ],
    { lensId: 'srs' }
  );

  return (
    <LensShell lensId="srs" asMain={false}>
      <FirstRunTour lensId="srs" />      <DepthBadge lensId="srs" size="sm" className="ml-2" />
      <div data-lens-theme="srs" className="min-h-full bg-lattice-bg">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-lattice-surface border-b border-lattice-border">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Brain className="w-7 h-7 text-neon-cyan" />
              <div>
                <h1 className="text-xl font-bold text-white">Spaced Repetition Studio</h1>
                <p className="text-xs text-gray-400">Anki-parity flashcard decks, plus spaced review of anything you&apos;ve already saved in Concord.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              <DTUExportButton domain="srs" data={realtimeData || {}} compact />
              {realtimeAlerts.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                  {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          {/* ===== KNOWLEDGE REVIEW ===== */}
          <section className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-neon-cyan" /> Review your knowledge
              </h2>
              <button
                onClick={() => setPickerOpen(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded-lg hover:bg-neon-cyan/20 transition-colors text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Add a DTU to review
              </button>
            </div>

            {notice && (
              <div className="rounded-lg border border-amber-700/40 bg-amber-600/10 px-3 py-1.5 text-xs text-amber-300">
                {notice}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="lens-card text-center">
                <Clock className="w-5 h-5 text-neon-yellow mx-auto mb-1" />
                <p className="text-2xl font-bold">{remaining}</p>
                <p className="text-xs text-gray-400">Due Now</p>
              </div>
              <div className="lens-card text-center">
                <p className="text-2xl font-bold">{sessionReviewed}</p>
                <p className="text-xs text-gray-400">Reviewed this session</p>
              </div>
              <div className="lens-card text-center">
                <p className="text-2xl font-bold">
                  {sessionReviewed > 0 ? Math.round((sessionCorrect / sessionReviewed) * 100) : 0}%
                </p>
                <p className="text-xs text-gray-400">Session accuracy</p>
              </div>
              <div className="lens-card text-center">
                <p className="text-2xl font-bold">{dueQuery.data?.total ?? 0}</p>
                <p className="text-xs text-gray-400">In review queue</p>
              </div>
            </div>

            <div className="max-w-2xl mx-auto w-full">
              {dueQuery.isLoading ? (
                <div className="panel p-12 text-center text-gray-400">Loading review queue...</div>
              ) : !current ? (
                <div className="panel p-10 text-center">
                  <Award className="w-16 h-16 mx-auto mb-3 text-neon-green opacity-50" />
                  <p className="text-lg font-bold text-white mb-1">All caught up!</p>
                  <p className="text-sm text-gray-400 mb-4">
                    {sessionReviewed > 0
                      ? `Reviewed ${sessionReviewed} item${sessionReviewed === 1 ? '' : 's'} this session.`
                      : 'Add a DTU — a note, chat takeaway, research finding, anything you’ve saved — to schedule it for spaced review.'}
                  </p>
                  <button onClick={() => setPickerOpen(true)} className="btn-neon text-sm">
                    <Plus className="w-4 h-4 inline mr-1" /> Add a DTU to review
                  </button>
                </div>
              ) : (
                <motion.div className="space-y-3" layout>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 font-mono">{reviewIndex + 1}/{dueCards.length}</span>
                    <div className="flex-1 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-neon-cyan to-neon-green"
                        animate={{ width: `${((reviewIndex + 1) / dueCards.length) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                    <span className="text-xs text-gray-400">{remaining} left</span>
                  </div>

                  <div className="panel overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-2 bg-lattice-bg/50 border-b border-lattice-border">
                      <span className="text-xs text-gray-400">{current.dtu.domain || 'knowledge'}</span>
                      <span className="text-xs text-gray-400">{current.card.repetitions} reps &middot; ease {current.card.easeFactor.toFixed(2)}</span>
                    </div>
                    <div className="p-8 min-h-[140px] flex items-center justify-center">
                      <p className="text-lg text-center text-white font-medium">{current.dtu.title}</p>
                    </div>
                    <AnimatePresence>
                      {revealed ? (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <div className="border-t border-dashed border-lattice-border mx-6" />
                          <div className="p-6 min-h-[100px]">
                            <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                              {current.dtu.summary || current.dtu.content?.slice(0, 600) || 'No summary available.'}
                            </p>
                          </div>
                          <div className="grid grid-cols-4 gap-2 px-5 pb-5">
                            {QUALITY_BUTTONS.map((btn) => (
                              <button
                                key={btn.quality}
                                onClick={() => handleReview(btn.quality)}
                                disabled={reviewMutation.isPending}
                                className={`p-3 rounded-lg border text-sm font-medium transition-all ${btn.color}`}
                              >
                                <div>{btn.label}</div>
                                <div className="text-[10px] opacity-60 mt-0.5">{btn.sublabel}</div>
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      ) : (
                        <div className="px-5 pb-5">
                          <button
                            onClick={() => setRevealed(true)}
                            className="w-full py-3 bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded-lg font-medium hover:bg-neon-cyan/20 transition-colors"
                          >
                            Show Answer
                          </button>
                        </div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="text-center text-xs text-gray-400">Space: flip &middot; 1-4: rate</div>
                </motion.div>
              )}
            </div>
          </section>

          {/* ===== ANKI-PARITY DECK ENGINE ===== */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <button
              type="button"
              onClick={() => setShowWorkbench(v => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
            >
              <span>Deck engine (Anki-parity)</span>
              {showWorkbench ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showWorkbench && (
              <div className="mt-3">
                <SrsWorkbench />
              </div>
            )}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <button
              type="button"
              onClick={() => setShowSrsRepos(v => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
            >
              <span>Spaced-repetition repos (GitHub)</span>
              {showSrsRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showSrsRepos && (
              <div className="mt-3">
                <SrsRepos />
              </div>
            )}
          </section>

          {realtimeData && (
            <RealtimeDataPanel
              domain="srs"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          )}
        </div>
      </div>

      {pickerOpen && (
        <DTUPickerModal
          lens="srs"
          title="Add a DTU to spaced review"
          onClose={() => setPickerOpen(false)}
          onSelect={handlePickDtu}
        />
      )}      <CrossLensRecentsPanel lensId="srs" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
