'use client';

/**
 * Creative Writing — one page.
 *
 * project-list is the cabinet. + New page calls project-create, then
 * shows the title only after project-list contains that id and the same
 * title. Titles are stored in creative_writing_pages, so a server
 * restart still lists them. A blank title is not sent. The numbered
 * comment is the empty state. It is not a text field. Studio, word
 * tools, and Gutenberg are other macros. They are not on this screen.
 *
 * Export JSON / Export CSV (F6): each saved page downloads a real file
 * built from project-get's own result (the project record plus any
 * chapters/scenes/characters/threads it owns) — not a fabricated
 * placeholder. A failed project-get surfaces its real error instead of
 * producing a silent, empty download.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';

interface PageRow {
  id: string;
  title: string;
}

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
}

interface ProjectGetResult {
  project?: Record<string, unknown>;
  chapters?: Array<Record<string, unknown>>;
  scenes?: Array<Record<string, unknown>>;
  characters?: Array<Record<string, unknown>>;
  threads?: Array<Record<string, unknown>>;
  wordCount?: number;
}

async function fetchFullPage(id: string): Promise<ProjectGetResult> {
  const res = await lensRun<ProjectGetResult>('creative-writing', 'project-get', { id });
  if (!res.data?.ok || !res.data.result?.project) {
    throw new Error(res.data?.error || 'Could not read that page for export.');
  }
  return res.data.result;
}

type Phase = 'loading' | 'ready' | 'error';

interface RawPage {
  id?: string;
  title?: string;
}

function pagesFrom(rows: unknown): PageRow[] {
  if (!Array.isArray(rows)) return [];
  const out: PageRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as RawPage).id;
    const title = (row as RawPage).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    out.push({ id, title: title.trim() });
  }
  return out;
}

async function readPages(): Promise<PageRow[]> {
  const list = await lensRun<{ projects?: unknown }>('creative-writing', 'project-list', {});
  if (!list.data?.ok) throw new Error(list.data?.error || 'Could not read the page.');
  return pagesFrom(list.data.result?.projects);
}

function LineNumbers() {
  return (
    <ol className="w-10 shrink-0 select-none border-r border-white/10 py-4 text-right font-mono text-[13px] text-zinc-600">
      {[1, 2, 3, 4].map((n) => (
        <li key={n} className="h-7 px-2 leading-7">{n}</li>
      ))}
    </ol>
  );
}

export default function CreativeWritingPage() {
  useLensNav('creative-writing');
  const [phase, setPhase] = useState<Phase>('loading');
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportError, setExportError] = useState('');

  const pull = useCallback(async () => readPages(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setPages(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the page.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setPages(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the page.');
    });
  }, [pull]);

  const openPage = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await lensRun<{ project?: { id?: string; title?: string } }>(
        'creative-writing',
        'project-create',
        { title: trimmed },
      );
      const id = created.data?.result?.project?.id;
      if (!created.data?.ok || !id) {
        throw new Error(created.data?.error || 'Could not open that page.');
      }
      const rows = await readPages();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed) {
        throw new Error('Opened, but the page did not read it back.');
      }
      setPages(rows);
      setTitle('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that page.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, phase, title]);

  useLensCommand(
    [{ id: 'creative-writing-new', keys: 'n', description: '+ New page', category: 'actions', action: () => { void openPage(); } }],
    { lensId: 'creative-writing' },
  );

  const exportPageJson = useCallback(async (id: string, itemTitle: string) => {
    if (exportingId) return;
    setExportingId(id);
    setExportError('');
    try {
      const full = await fetchFullPage(id);
      downloadFile(`${slug(itemTitle)}.json`, JSON.stringify(full, null, 2), 'application/json');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export that page as JSON.');
    } finally {
      setExportingId(null);
    }
  }, [exportingId]);

  const exportPageCsv = useCallback(async (id: string, itemTitle: string) => {
    if (exportingId) return;
    setExportingId(id);
    setExportError('');
    try {
      const full = await fetchFullPage(id);
      const scenes = Array.isArray(full.scenes) ? full.scenes : [];
      let csv: string;
      if (scenes.length > 0) {
        const header = csvRow(['id', 'title', 'chapterId', 'order', 'wordCount', 'status']);
        const rows = scenes.map((sc) => csvRow([sc.id, sc.title, sc.chapterId, sc.order, sc.wordCount, sc.status]));
        csv = [header, ...rows].join('\n');
      } else {
        const p = full.project || {};
        const header = csvRow(['id', 'title', 'genre', 'targetWords', 'wordCount', 'createdAt', 'updatedAt']);
        const row = csvRow([p.id, p.title, p.genre, p.targetWords, full.wordCount ?? 0, p.createdAt, p.updatedAt]);
        csv = [header, row].join('\n');
      }
      downloadFile(`${slug(itemTitle)}.csv`, csv, 'text/csv');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export that page as CSV.');
    } finally {
      setExportingId(null);
    }
  }, [exportingId]);

  return (
    <LensShell lensId="creative-writing" asMain={false}>
      <div data-lens-theme="creative-writing" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Creative Writing</h1>

        <section
          aria-label="Page"
          className="min-h-[22rem] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950"
        >
          <div className="flex min-h-[22rem]">
            <LineNumbers />
            <div className="min-w-0 flex-1 py-4 pl-4 pr-6">
              {phase === 'loading' && (
                <p data-testid="creative-writing-loading" role="status" aria-busy="true" className="font-mono text-[14px] leading-7 text-zinc-500">
                  Opening the page.
                </p>
              )}
              {phase === 'error' && (
                <div data-testid="creative-writing-error" role="alert">
                  <p className="font-mono text-[14px] leading-7 text-zinc-300">{loadError || 'Could not load the page.'}</p>
                  <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                    Retry
                  </button>
                </div>
              )}
              {phase === 'ready' && pages.length === 0 && !composing && (
                <div data-testid="creative-writing-empty">
                  <p className="h-7 font-mono text-[14px] leading-7 text-zinc-500">{'// the page is empty.'}</p>
                  <p className="h-7" />
                  <p className="h-7">
                    <span className="inline-block h-5 w-0.5 translate-y-1 bg-teal-400" aria-hidden="true" />
                  </p>
                </div>
              )}
              {phase === 'ready' && pages.length > 0 && (
                <ul data-testid="creative-writing-pages" className="space-y-2">
                  {pages.map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-4">
                      <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{item.title}</h2>
                      <span className="flex shrink-0 gap-3 font-mono text-[12px] text-zinc-500">
                        <button
                          type="button"
                          data-testid={`export-json-${item.id}`}
                          disabled={exportingId === item.id}
                          onClick={() => { void exportPageJson(item.id, item.title); }}
                          className="underline decoration-dotted hover:text-zinc-200 disabled:opacity-50"
                        >
                          Export JSON
                        </button>
                        <button
                          type="button"
                          data-testid={`export-csv-${item.id}`}
                          disabled={exportingId === item.id}
                          onClick={() => { void exportPageCsv(item.id, item.title); }}
                          className="underline decoration-dotted hover:text-zinc-200 disabled:opacity-50"
                        >
                          Export CSV
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {phase === 'ready' && composing && (
                <label className="block font-mono text-[14px] text-zinc-400">
                  Title
                  <input
                    data-testid="creative-writing-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); void openPage(); }
                    }}
                    className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                    autoFocus
                  />
                </label>
              )}
              {actionError ? (
                <p role="alert" className="mt-4 font-mono text-[14px] text-zinc-300">{actionError}</p>
              ) : null}
              {exportError ? (
                <p role="alert" data-testid="creative-writing-export-error" className="mt-4 font-mono text-[14px] text-zinc-300">{exportError}</p>
              ) : null}
            </div>
          </div>
        </section>

        <button
          type="button"
          onClick={() => { void openPage(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          + New page
        </button>
      </div>
    </LensShell>
  );
}
