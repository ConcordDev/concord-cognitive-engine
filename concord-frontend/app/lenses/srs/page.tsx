'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { SrsRepos } from '@/components/srs/SrsRepos';
import { SrsWorkbench } from '@/components/srs/SrsWorkbench';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { DTUPickerModal } from '@/components/dtu/DTUPickerModal';
import type { DTU } from '@/lib/api/generated-types';
import { cn } from '@/lib/utils';

/**
 * Study (SRS) per docs/lens-northstar/12: one card at a time from DTUs the
 * user saved. Space reveals, 1-4 rate (srs.review), "+ Add to review" picks a
 * DTU (srs.add). The Anki-style deck engine and the GitHub repos are views
 * under More.
 */

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

/** The answer side: the DTU's human summary (where DTUs keep it), else older flat fields. */
function answerText(dtu: DTU): string {
  const d = dtu as DTU & { human?: { summary?: string }; cretiHuman?: string };
  return (d.human?.summary || d.summary || d.content || d.cretiHuman || '').slice(0, 600);
}

function answerBullets(dtu: DTU): string[] {
  const b = (dtu as DTU & { human?: { bullets?: unknown } }).human?.bullets;
  return Array.isArray(b) ? b.filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
}

export default function SRSLensPage() {
  useLensNav('srs');
  const { user } = useAuth();
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
  const [view, setView] = useState<SrsView>('review');
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
  const reviewCanFlip = view === 'review' && !!current && !revealed;
  const reviewCanRate = view === 'review' && !!current && revealed;
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

  const who = titleCaseDisplayName(user?.username);

  return (
    <LensShell lensId="srs" asMain={false}>
      <div data-lens-theme="srs" className="relative min-h-full px-8 pb-28 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] text-zinc-500">Study</p>
            <h1 className="font-vault text-[2.75rem] leading-tight text-zinc-100">
              {who ? `What do you still know, ${who}` : 'What do you still know'}
            </h1>
          </div>
          <div className="flex items-center gap-5 pt-1 text-[13px]">
            {view === 'review' && !dueQuery.isLoading && (
              <span className="tabular-nums text-zinc-500">{remaining} due</span>
            )}
            <MoreMenu view={view} onPick={setView} />
          </div>
        </div>

        {notice && <p className="mt-3 text-[13px] text-amber-300" role="status">{notice}</p>}

        {view === 'decks' && (
          <section className="mt-8">
            <h2 className="mb-4 font-vault text-[1.75rem] text-zinc-100">Decks</h2>
            <SrsWorkbench />
          </section>
        )}
        {view === 'repos' && (
          <section className="mt-8">
            <h2 className="mb-4 font-vault text-[1.75rem] text-zinc-100">Spaced-repetition repos</h2>
            <SrsRepos />
          </section>
        )}

        {view === 'review' && (
          <div className="mt-8 max-w-[560px]">
            {dueQuery.isLoading ? (
              <div className="h-[240px] animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.015]" />
            ) : dueQuery.isError ? (
              <div className="rounded-3xl border border-white/[0.08] p-8 text-[14px] text-zinc-400">
                Couldn’t load your review queue.{' '}
                <button type="button" className="text-teal-300 hover:underline" onClick={() => dueQuery.refetch()}>Retry</button>
              </div>
            ) : !current ? (
              <div className="rounded-3xl border border-white/[0.08] bg-white/[0.02] p-10">
                <p className="font-vault text-[1.75rem] leading-snug text-zinc-100">
                  {sessionReviewed > 0 ? 'All caught up.' : 'Nothing is due.'}
                </p>
                <p className="mt-2 text-[14px] text-zinc-500">
                  {sessionReviewed > 0
                    ? `You reviewed ${sessionReviewed} item${sessionReviewed === 1 ? '' : 's'}, ${Math.round((sessionCorrect / sessionReviewed) * 100)}% recalled.`
                    : 'Add a note, chat takeaway or finding you saved, and it comes back here when it’s due.'}
                </p>
              </div>
            ) : (
              <motion.article
                key={current.dtu.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-10"
              >
                <h2 className="font-vault text-[1.9rem] leading-snug text-zinc-100">{current.dtu.title}</h2>
                <p className="mt-3 text-[13px] text-zinc-500">
                  From {current.dtu.domain ? `your ${current.dtu.domain} notes` : 'a note you saved'}
                  {!revealed && ' · Space to reveal'}
                </p>

                {revealed ? (
                  <>
                    <div className="mt-6 border-t border-white/[0.06] pt-6 text-[15px] leading-relaxed text-zinc-300">
                      <p className="whitespace-pre-wrap">{answerText(current.dtu) || 'This note has no summary yet.'}</p>
                      {answerBullets(current.dtu).length > 0 && (
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] text-zinc-400">
                          {answerBullets(current.dtu).map((b) => <li key={b}>{b}</li>)}
                        </ul>
                      )}
                    </div>
                    <div className="mt-8 grid grid-cols-4 gap-2">
                      {QUALITY_BUTTONS.map((btn, i) => (
                        <button
                          key={btn.quality}
                          type="button"
                          onClick={() => handleReview(btn.quality)}
                          disabled={reviewMutation.isPending}
                          title={btn.sublabel}
                          className={cn(
                            'rounded-xl border py-2.5 text-center transition-colors disabled:opacity-50',
                            btn.label === 'Good'
                              ? 'border-teal-400/50 text-teal-300 hover:bg-teal-400/10'
                              : 'border-white/[0.1] text-zinc-100 hover:border-white/25 hover:bg-white/[0.04]',
                          )}
                        >
                          <span className="block text-[14px] font-medium">{btn.label}</span>
                          <span className="block text-[12px] text-zinc-400">{i + 1}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRevealed(true)}
                    className="mt-8 w-full rounded-xl border border-white/[0.1] py-3 text-[14px] text-zinc-200 transition-colors hover:border-white/25 hover:bg-white/[0.04]"
                  >
                    Reveal
                  </button>
                )}
              </motion.article>
            )}
          </div>
        )}

        {view === 'review' && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
          >
            <Plus className="h-4 w-4" />
            Add to review
          </button>
        )}
      </div>

      {pickerOpen && (
        <DTUPickerModal
          lens="srs"
          title="Add to review"
          onClose={() => setPickerOpen(false)}
          onSelect={handlePickDtu}
        />
      )}
    </LensShell>
  );
}

type SrsView = 'review' | 'decks' | 'repos';

function MoreMenu({ view, onPick }: { view: SrsView; onPick: (v: SrsView) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const items: { id: SrsView; label: string }[] = [
    { id: 'review', label: 'Review' },
    { id: 'decks', label: 'Decks' },
    { id: 'repos', label: 'Spaced-repetition repos' },
  ];
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-zinc-500 transition-colors hover:text-zinc-200" aria-haspopup="menu" aria-expanded={open}>
        More
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-white/10 bg-[#141414] p-1 shadow-2xl">
          {items.map((it) => (
            <button
              key={it.id}
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); onPick(it.id); }}
              className={cn(
                'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-white/[0.06] hover:text-zinc-50',
                view === it.id ? 'text-zinc-50' : 'text-zinc-300',
              )}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
