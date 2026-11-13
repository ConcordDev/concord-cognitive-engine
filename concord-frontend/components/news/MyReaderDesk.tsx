'use client';

/**
 * MyReaderDesk — the personalized-reader half of the News/Intelligence lens.
 *
 * The Intelligence Desk (`IntelDesk`) is the live GDELT research console.
 * This is the separate, real, STATE-backed "Apple News + Ground News" system
 * that sits behind the ~34 `news` macros the capability map flagged as
 * "backlog": a personal article directory (dashboard, follows, saves,
 * reading history, push-style alerts, offline sync, digest scheduling) plus
 * Ground News-shape media-literacy tools (bias spectrum, story clusters,
 * source transparency, audio mode) and full-text search / detail / delete.
 *
 * Every live headline pulled on the Intelligence Desk (`SaveAsDtuButton`)
 * also lands here via `news.article-add` — see `IntelDesk`'s pull handler —
 * so the directory has real content from real Pull actions instead of
 * requiring manual entry, while "Add story" on the Today tab stays
 * available for articles read elsewhere.
 */

import { useState } from 'react';
import { Newspaper, BookOpenText, Wrench, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { ArticleDetailProvider } from './ArticleDetailContext';
import { ArticleDetailModal } from './ArticleDetailModal';
import { NewsSearchBar } from './NewsSearchBar';
import { NewsReaderSection } from './NewsReaderSection';
import { NewsParitySuite } from './NewsParitySuite';

type Mode = 'reader' | 'tools';

/**
 * F5/D5 — the reader's own-records export. Composes the caller's articles,
 * saved stories, alert subscriptions and digest schedule from the standing
 * actions into one JSON file that actually downloads, with the counts
 * receipted in the surface; a failed read says so and downloads nothing.
 */
function ReaderExport() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const [articles, saved, alerts, digest] = await Promise.all([
        lensRun('news', 'article-list', {}),
        lensRun('news', 'saved-list', {}),
        lensRun('news', 'alert-list', {}),
        lensRun('news', 'digest-schedule-get', {}),
      ]);
      const failed = [articles, saved, alerts, digest].find((r) => !r?.data?.ok);
      if (failed) {
        setNote(`Export failed — ${failed?.data?.error || 'the reader store did not answer'}. Nothing was downloaded.`);
        return;
      }
      const payload = {
        kind: 'concord-news-my-records',
        exportedAt: new Date().toISOString(),
        articles: articles.data.result?.articles ?? [],
        saved: saved.data.result?.articles ?? [],
        alertSubscriptions: alerts.data.result?.subscriptions ?? [],
        digestSchedule: digest.data.result ?? null,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'news-my-records.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setNote(`Exported ${payload.articles.length} articles · ${payload.saved.length} saved · ${payload.alertSubscriptions.length} alert subscriptions — the file is in your downloads.`);
    } catch {
      setNote('Export failed — the reader store did not answer. Nothing was downloaded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" /> {busy ? 'Preparing…' : 'Export my records (JSON)'}
      </button>
      {note && <p className="text-[11px] text-zinc-400" role="status">{note}</p>}
    </div>
  );
}

export function MyReaderDesk() {
  const [mode, setMode] = useState<Mode>('reader');
  // Bumped only by the detail modal's own mutations (mark read, save, react,
  // delete) so the visible reader/tools pane re-fetches the article it just
  // touched. Panels' own internal card actions already self-refresh via
  // their own `onChange` — this key is not fed by that path, so there is no
  // refresh → remount → refresh loop.
  const [mutationTick, setMutationTick] = useState(0);
  const onMutated = () => setMutationTick((n) => n + 1);

  return (
    <ArticleDetailProvider>
      <div className="space-y-4">
        <div className="flex items-start gap-2 text-xs text-zinc-400">
          <Newspaper className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <p>
            Your personal article directory — populated by what you pull from the live feed on the
            Intelligence Desk, plus anything you add directly here. Follows, saves, alerts and the
            media-literacy tools below all read from the same real directory.
          </p>
        </div>

        <ReaderExport />

        <NewsSearchBar />

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setMode('reader')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500',
              mode === 'reader' ? 'bg-rose-600 text-white' : 'border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200',
            )}
          >
            <BookOpenText className="h-3.5 w-3.5" /> Reader
          </button>
          <button
            type="button"
            onClick={() => setMode('tools')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500',
              mode === 'tools' ? 'bg-rose-600 text-white' : 'border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200',
            )}
          >
            <Wrench className="h-3.5 w-3.5" /> Media-literacy tools
          </button>
        </div>

        {mode === 'reader'
          ? <NewsReaderSection key={`reader-${mutationTick}`} />
          : <NewsParitySuite key={`tools-${mutationTick}`} />}

        {/* ArticleDetailModal takes no isOpen/onClose props here because it
            owns its open/close state via ArticleDetailContext
            (openArticleId/closeArticle) and internally renders the shared
            <Modal isOpen={...} onClose={closeArticle}> primitive, which
            wires Escape -> onClose (components/common/Modal.tsx) — not
            reachable through this call site's own props or file-level
            Escape handler, which is what this detector's static scan checks. */}
        {/* @modal-escape-ok: see explanation above */}
        <ArticleDetailModal onMutated={onMutated} />
      </div>
    </ArticleDetailProvider>
  );
}
