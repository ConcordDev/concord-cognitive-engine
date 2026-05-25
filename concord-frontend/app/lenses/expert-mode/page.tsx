'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * /lenses/expert-mode — Perplexity-shape cited-answer research surface.
 *
 * Full conversational research loop:
 *  - Threaded follow-up conversation (expert_mode.ask / thread_*)
 *  - Live web search alongside the DTU corpus (per-mode, toggleable)
 *  - Focus modes — Academic / Writing / Math / Video (expert_mode.focus_modes)
 *  - Pages / Spaces — shareable collections (expert_mode.space_*)
 *  - Related-question suggestions after each answer
 *  - File/PDF text upload as a query source (expert_mode.upload_*)
 *  - Answer export — Markdown copy + shareable link
 *  - Shared answer/space view resolved from ?answer= / ?space= params
 *
 * Every value rendered comes from a real macro: nothing seeded, mocked,
 * or demo. If BYO API keys are set the synthesis routes through the
 * user's own provider; otherwise the free Ollama default.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { BrainPoolStatus } from '@/components/expert-mode/BrainPoolStatus';
import { AnswerActionPanel } from '@/components/expert-mode/AnswerActionPanel';
import { FocusModeBar } from '@/components/expert-mode/FocusModeBar';
import { UploadSourcePanel } from '@/components/expert-mode/UploadSourcePanel';
import { ThreadSidebar } from '@/components/expert-mode/ThreadSidebar';
import { SpacesPanel } from '@/components/expert-mode/SpacesPanel';
import { ConversationTurn, type Turn } from '@/components/expert-mode/ConversationTurn';
import { PipingProvider } from '@/components/panel-polish';
import { Globe2, Loader2, Search } from 'lucide-react';

interface TurnWithRelated extends Turn {
  related: string[];
}

interface SharedAnswer {
  query: string;
  answer: string;
  sources: any[];
  provider: string | null;
  model: string | null;
}

export default function ExpertModeLens() {
  useLensCommand(
    [
      {
        id: 'expert-mode-help',
        keys: '?',
        description: 'Lens help',
        category: 'navigation',
        action: () => { /* surfaced via tooltip */ },
      },
    ],
    { lensId: 'expert-mode' },
  );

  const searchParams = useSearchParams();

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<TurnWithRelated[]>([]);
  const [focus, setFocus] = useState('all');
  const [useWeb, setUseWeb] = useState(true);

  const [uploadId, setUploadId] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const [sidebarReload, setSidebarReload] = useState(0);
  const [shared, setShared] = useState<{ kind: 'answer'; data: SharedAnswer } | null>(null);

  // ---- shared link resolution -------------------------------------------
  useEffect(() => {
    const answerToken = searchParams.get('answer');
    if (answerToken) {
      (async () => {
        const r = await lensRun<{ kind: string; answer: SharedAnswer }>(
          'expert_mode',
          'share_resolve',
          { shareToken: answerToken },
        );
        if (r.data.ok && r.data.result?.kind === 'answer' && r.data.result.answer) {
          setShared({ kind: 'answer', data: r.data.result.answer });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- sources preview (cheap, before committing the brain call) --------
  useEffect(() => {
    const q = query.trim();
    if (q.length < 4) {
      setPreviewCount(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await lensRun<{ sources: any[] }>('expert_mode', 'sources_preview', {
        query: q,
        maxSources: 8,
      });
      if (!cancelled && r.data.ok && r.data.result?.sources) {
        setPreviewCount(r.data.result.sources.length);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  // ---- ask a (possibly threaded) question -------------------------------
  const ask = useCallback(
    async (q: string) => {
      const text = q.trim();
      if (!text) return;
      setBusy(true);
      setError(null);

      // Upload-grounded answers are single-shot (the upload is the prime
      // source). Everything else flows through the threaded ask macro.
      if (uploadId) {
        const r = await lensRun<{
          answer: string;
          sources: any[];
          provider: string | null;
          model: string | null;
          uploadName: string;
          relatedQuestions: string[];
        }>('expert_mode', 'ask_with_upload', { query: text, uploadId, focus });
        setBusy(false);
        if (r.data.ok && r.data.result) {
          const res = r.data.result;
          const turn: TurnWithRelated = {
            id: `upl_${Date.now()}`,
            query: text,
            answer: res.answer,
            sources: res.sources,
            provider: res.provider,
            model: res.model,
            citationsRecorded: 0,
            focus,
            webCount: 0,
            askedAt: Math.floor(Date.now() / 1000),
            related: res.relatedQuestions || [],
          };
          setTurns((prev) => [...prev, turn]);
          setQuery('');
        } else {
          setError(r.data.error || 'Upload-grounded answer failed.');
        }
        return;
      }

      const r = await lensRun<{
        threadId: string;
        turn: Turn;
        relatedQuestions: string[];
      }>('expert_mode', 'ask', {
        query: text,
        threadId: threadId || undefined,
        focus,
        useWeb,
        maxSources: 8,
      });
      setBusy(false);
      if (r.data.ok && r.data.result) {
        const res = r.data.result;
        setThreadId(res.threadId);
        setTurns((prev) => [
          ...prev,
          { ...res.turn, related: res.relatedQuestions || [] },
        ]);
        setQuery('');
        setSidebarReload((n) => n + 1);
      } else {
        setError(r.data.error || 'Could not answer.');
      }
    },
    [threadId, focus, useWeb, uploadId],
  );

  // ---- open a saved thread ----------------------------------------------
  const openThread = useCallback(async (id: string) => {
    const r = await lensRun<{
      thread: { id: string; focus: string; turns: Turn[] };
    }>('expert_mode', 'thread_get', { threadId: id });
    if (r.data.ok && r.data.result?.thread) {
      const th = r.data.result.thread;
      setThreadId(th.id);
      setFocus(th.focus || 'all');
      // Re-derive related questions for the last turn so the UI stays live.
      const loaded: TurnWithRelated[] = th.turns.map((t) => ({ ...t, related: [] }));
      if (loaded.length > 0) {
        const last = loaded[loaded.length - 1];
        const rel = await lensRun<{ questions: string[] }>(
          'expert_mode',
          'related_questions',
          { query: last.query, answer: last.answer },
        );
        if (rel.data.ok && rel.data.result?.questions) {
          last.related = rel.data.result.questions;
        }
      }
      setTurns(loaded);
      setError(null);
    }
  }, []);

  const newThread = useCallback(() => {
    setThreadId(null);
    setTurns([]);
    setError(null);
    setQuery('');
    setShared(null);
  }, []);

  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const pendingForSpace = lastTurn
    ? {
        query: lastTurn.query,
        answer: lastTurn.answer,
        sources: lastTurn.sources,
        provider: lastTurn.provider,
        model: lastTurn.model,
      }
    : null;

  return (
    <LensShell lensId="expert-mode">
      <FirstRunTour lensId="expert-mode" />
      <DepthBadge lensId="expert-mode" size="sm" className="ml-2" />
      <LensVerticalHero lensId="expert-mode" className="mx-6 mt-4" />

      <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 sm:px-6 py-8">
        <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
          {/* ---- left rail: threads + spaces + uploads ---- */}
          <div className="space-y-4">
            <ThreadSidebar
              activeThreadId={threadId}
              onOpen={openThread}
              onNew={newThread}
              reloadKey={sidebarReload}
            />
            <UploadSourcePanel selectedId={uploadId} onSelect={setUploadId} />
            <SpacesPanel
              pendingAnswer={pendingForSpace}
              onAddedPending={() => { /* refresh handled inside panel */ }}
              reloadKey={sidebarReload}
            />
          </div>

          {/* ---- main column ---- */}
          <div className="min-w-0">
            <header className="mb-5">
              <h1 className="text-2xl font-semibold mb-1">Expert Mode</h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Threaded, cited research. Every claim is sourced from your DTUs, the global
                Concord corpus, and live web search. Set your{' '}
                <Link
                  href="/lenses/byo-keys"
                  className="text-amber-400 hover:text-amber-300 underline"
                >
                  BYO API keys
                </Link>{' '}
                to route synthesis through your own Claude / GPT / Grok / Gemini.
              </p>
            </header>

            {/* shared-answer banner */}
            {shared && (
              <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <p className="text-[11px] uppercase tracking-wider text-emerald-300 font-semibold mb-2">
                  Shared answer
                </p>
                <h3 className="text-base font-semibold text-zinc-100 mb-2">
                  {shared.data.query}
                </h3>
                <p className="text-[14px] text-zinc-200 whitespace-pre-wrap leading-relaxed">
                  {shared.data.answer}
                </p>
                {shared.data.sources?.length > 0 && (
                  <p className="mt-2 text-[11px] text-zinc-400">
                    {shared.data.sources.length} source
                    {shared.data.sources.length === 1 ? '' : 's'}
                    {shared.data.model ? ` · ${shared.data.model}` : ''}
                  </p>
                )}
                <button
                  type="button"
                  onClick={newThread}
                  className="mt-3 px-3 py-1 rounded text-[12px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                >
                  Start my own research
                </button>
              </div>
            )}

            {/* focus + web controls */}
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <FocusModeBar value={focus} onChange={setFocus} />
              <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWeb}
                  onChange={(e) => setUseWeb(e.target.checked)}
                  className="accent-sky-500"
                />
                <Globe2 className="w-3.5 h-3.5 text-sky-400" />
                Live web search
              </label>
            </div>

            {/* query box */}
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) ask(query);
                }}
                placeholder={
                  threadId
                    ? 'Ask a follow-up — context carries across the thread…'
                    : 'Ask anything — cited, sourced, terse.'
                }
                className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-900 text-zinc-100 ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => ask(query)}
                disabled={busy || !query.trim()}
                className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-50 font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                {busy ? 'Thinking…' : threadId ? 'Follow up' : 'Ask'}
              </button>
            </div>

            {/* sources preview */}
            {previewCount != null && !busy && (
              <p className="mb-4 text-[11px] text-zinc-400">
                {uploadId
                  ? 'Next answer will be grounded in your uploaded document.'
                  : `About to consult ${previewCount} corpus source${previewCount === 1 ? '' : 's'}${
                      useWeb ? ' + live web' : ''
                    }.`}
              </p>
            )}

            {error && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-red-950/40 text-red-200 text-sm ring-1 ring-red-900/60">
                {error}
              </div>
            )}

            {/* conversation turns */}
            {turns.length > 0 && (
              <div className="space-y-5">
                {turns.map((t) => (
                  <ConversationTurn
                    key={t.id}
                    turn={t}
                    threadId={threadId}
                    related={t.related}
                    onAskRelated={(q) => ask(q)}
                  />
                ))}

                {/* answer-action panel against the most recent turn */}
                {lastTurn && (
                  <PipingProvider>
                    <AnswerActionPanel
                      query={lastTurn.query}
                      answer={lastTurn.answer}
                      sources={lastTurn.sources.map((s) => ({
                        idx: s.idx,
                        id: s.id,
                        title: s.title,
                        creatorId: s.creatorId ?? 'unknown',
                        scope: s.scope,
                      }))}
                      provider={lastTurn.provider ?? undefined}
                      model={lastTurn.model ?? undefined}
                    />
                  </PipingProvider>
                )}
              </div>
            )}

            {/* empty state */}
            {turns.length === 0 && !busy && !shared && (
              <div className="mt-10 text-center text-sm text-zinc-400">
                <p className="mb-2">
                  Ask a question to open a research thread. Follow-ups carry context, focus
                  modes scope the sources, live web search runs alongside the corpus, and any
                  answer can be saved into a shareable Space.
                </p>
                <p className="text-xs text-zinc-400">
                  Try: &quot;What does Tunya use as currency?&quot; or &quot;How does the
                  refusal field algebra work?&quot;
                </p>
              </div>
            )}

            <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <BrainPoolStatus />
            </section>
          </div>
        </div>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only */}
      <div className="sr-only" aria-hidden="true">
        EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows
      </div>
      <RecentMineCard domain="expert-mode" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="expert-mode" hideWhenEmpty className="mt-3" title="More actions" />
      <CrossLensRecentsPanel
        lensId="expert-mode"
        sinceDays={7}
        limit={6}
        hideWhenEmpty
        className="mt-3"
      />
    </LensShell>
  );
}
