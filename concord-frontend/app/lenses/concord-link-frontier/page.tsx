'use client';

/**
 * Concord Link Frontier — the frontier link.
 *
 * The frame matches the concept: one grid, empty copy, Open the link.
 * Open stores a name. The bearing and the mark are later steps on
 * that grid. link-list is id and name. The bearing and the mark show
 * only after link-detail returns them. The cross-world feed and the
 * royalty ledger stay unmounted.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface LinkRow {
  id: string;
  name: string;
  bearing: string;
  mark: string | null;
}

type Phase = 'loading' | 'ready' | 'error';
type Mode = 'view' | 'open' | 'bearing' | 'mark';

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

async function runLink<T>(name: string, input: Record<string, unknown>, fallback: string): Promise<T> {
  let last = fallback;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await lensRun<T>('concord-link-frontier', name, input);
    if (response.data?.ok && response.data.result) return response.data.result;
    last = response.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

async function readBoard(): Promise<LinkRow[]> {
  const listed = await runLink<{ links?: unknown }>('link-list', {}, 'Could not read the link.');
  const slim: { id: string; name: string }[] = [];
  if (Array.isArray(listed.links)) {
    for (const row of listed.links) {
      if (!row || typeof row !== 'object') continue;
      const id = (row as { id?: unknown }).id;
      const name = (row as { name?: unknown }).name;
      if (typeof id !== 'string' || !id) continue;
      if (typeof name !== 'string' || !name.trim()) continue;
      slim.push({ id, name: name.trim() });
    }
  }
  const links: LinkRow[] = [];
  for (const row of slim) {
    const detail = await runLink<{ link?: unknown }>('link-detail', { id: row.id }, 'Could not read the link.');
    const link = detail.link;
    if (!link || typeof link !== 'object') continue;
    const body = link as { id?: unknown; name?: unknown; bearing?: unknown; mark?: unknown };
    if (body.id !== row.id || typeof body.name !== 'string' || body.name.trim() !== row.name) continue;
    const mark = typeof body.mark === 'string' && body.mark.trim() ? body.mark : null;
    links.push({
      id: row.id,
      name: row.name,
      bearing: typeof body.bearing === 'string' ? body.bearing : '',
      mark,
    });
  }
  return links;
}

const GRID = {
  backgroundImage: 'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)',
  backgroundSize: '28px 28px',
} as const;

export default function ConcordLinkFrontierPage() {
  useLensNav('concord-link-frontier');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [name, setName] = useState('');
  const [bearing, setBearing] = useState('');
  const [mark, setMark] = useState('');
  const [busy, setBusy] = useState(false);

  const applyBoard = useCallback((rows: LinkRow[], preferId?: string) => {
    setLinks(rows);
    setSelectedId((current) => {
      const want = preferId || current;
      if (want && rows.some((item) => item.id === want)) return want;
      return rows[0]?.id || null;
    });
  }, []);

  const pull = useCallback(async (preferId?: string) => {
    const rows = await readBoard();
    applyBoard(rows, preferId);
    setMode('view');
    setPhase('ready');
  }, [applyBoard]);

  useEffect(() => {
    let cancelled = false;
    readBoard().then((rows) => {
      if (cancelled) return;
      applyBoard(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the link.');
    });
    return () => { cancelled = true; };
  }, [applyBoard]);

  const retry = useCallback(() => {
    if (busy) return;
    setPhase('loading');
    setLoadError('');
    setActionError('');
    setName('');
    setBearing('');
    setMark('');
    pull().catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the link.');
    });
  }, [busy, pull]);

  const openLink = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (mode !== 'open') {
      setMode('open');
      setActionError('');
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setActionError('A name is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await runLink<{ linkId?: string }>('link-open', { name: trimmed }, 'Could not open that link.');
      const id = created.linkId;
      if (!id) throw new Error('Could not open that link.');
      const rows = await readBoard();
      const row = rows.find((item) => item.id === id);
      if (!row || row.name !== trimmed || row.bearing || row.mark) {
        throw new Error('Opened, but the board did not read it back.');
      }
      applyBoard(rows, id);
      setName('');
      setMode('view');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that link.');
    } finally {
      setBusy(false);
    }
  }, [applyBoard, busy, mode, name, phase]);

  const saveBearing = useCallback(async () => {
    if (busy || phase !== 'ready' || !selectedId) return;
    if (mode !== 'bearing') {
      const current = links.find((item) => item.id === selectedId);
      setBearing(current?.bearing || '');
      setMode('bearing');
      setActionError('');
      return;
    }
    const next = bearing.trim();
    if (!next) {
      setActionError('A bearing is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await runLink('link-bearing', { id: selectedId, bearing: next }, 'Could not save that bearing.');
      const rows = await readBoard();
      const row = rows.find((item) => item.id === selectedId);
      if (!row || row.bearing !== next) throw new Error('Saved, but the board did not read the bearing back.');
      applyBoard(rows, selectedId);
      setBearing('');
      setMode('view');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save that bearing.');
    } finally {
      setBusy(false);
    }
  }, [applyBoard, bearing, busy, links, mode, phase, selectedId]);

  const saveMark = useCallback(async () => {
    if (busy || phase !== 'ready' || !selectedId) return;
    const current = links.find((item) => item.id === selectedId);
    if (!current?.bearing) return;
    if (mode !== 'mark') {
      setMark(current.mark || '');
      setMode('mark');
      setActionError('');
      return;
    }
    const note = mark.trim();
    if (!note) {
      setActionError('A mark is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await runLink('link-mark', { id: selectedId, mark: note }, 'Could not save that mark.');
      const rows = await readBoard();
      const row = rows.find((item) => item.id === selectedId);
      if (!row || row.mark !== note) throw new Error('Saved, but the board did not read the mark back.');
      applyBoard(rows, selectedId);
      setMark('');
      setMode('view');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save that mark.');
    } finally {
      setBusy(false);
    }
  }, [applyBoard, busy, links, mark, mode, phase, selectedId]);

  const openRow = useCallback(async (id: string) => {
    if (busy || phase !== 'ready') return;
    setBusy(true);
    setActionError('');
    try {
      const detail = await runLink<{ link?: { id?: string; name?: string; bearing?: unknown; mark?: unknown } }>(
        'link-detail',
        { id },
        'Could not read the link.',
      );
      const body = detail.link;
      setLinks((rows) => rows.map((item) => {
        if (item.id !== id || !body || body.id !== id || body.name !== item.name) return item;
        return {
          ...item,
          bearing: typeof body.bearing === 'string' ? body.bearing : '',
          mark: typeof body.mark === 'string' && body.mark.trim() ? body.mark : null,
        };
      }));
      setSelectedId(id);
      setMode('view');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not read the link.');
    } finally {
      setBusy(false);
    }
  }, [busy, phase]);

  useLensCommand(
    [{ id: 'clf-open', keys: 'o', description: 'Open the link', category: 'actions', action: () => { void openLink(); } }],
    { lensId: 'concord-link-frontier' },
  );

  const selected = links.find((item) => item.id === selectedId) || null;
  const empty = phase === 'ready' && mode === 'view' && links.length === 0;

  return (
    <LensShell lensId="concord-link-frontier" asMain={false}>
      <div data-lens-theme="concord-link-frontier" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Concord Link Frontier</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The frontier link{who ? `, ${who}` : ''}
        </h1>

        <section aria-label="Link" className="min-h-[22rem] rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5" style={GRID}>
          {phase === 'loading' && (
            <p data-testid="clf-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Reading the link.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="clf-error" role="alert">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the link.'}</p>
              <button type="button" onClick={retry} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <p data-testid="clf-empty" className="flex min-h-[16rem] items-center justify-center text-center text-[15px] text-zinc-400">
              No link open.
            </p>
          )}
          {phase === 'ready' && mode === 'view' && selected && (
            <div className="mb-6">
              <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{selected.name}</h2>
              {selected.bearing ? <p data-testid="clf-bearing" className="mt-3 text-[15px] text-zinc-300">{selected.bearing}</p> : null}
              {selected.mark ? <p data-testid="clf-mark" className="mt-3 text-[15px] text-zinc-300">{selected.mark}</p> : null}
            </div>
          )}
          {phase === 'ready' && mode === 'view' && links.length > 0 && (
            <ul data-testid="clf-board" className="space-y-2 border-t border-white/10 pt-4">
              {links.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => { void openRow(item.id); }}
                    className="text-left text-[15px] text-zinc-200 underline-offset-4 hover:underline"
                  >
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && mode === 'open' && (
            <label className="block text-[14px] text-zinc-400">
              Name
              <input
                data-testid="clf-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
          {phase === 'ready' && mode === 'bearing' && (
            <label className="block text-[14px] text-zinc-400">
              Bearing
              <input
                data-testid="clf-bearing-input"
                value={bearing}
                onChange={(event) => setBearing(event.target.value)}
                className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
          {phase === 'ready' && mode === 'mark' && (
            <label className="block text-[14px] text-zinc-400">
              Mark
              <input
                data-testid="clf-mark-input"
                value={mark}
                onChange={(event) => setMark(event.target.value)}
                className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
          {phase === 'ready' && mode === 'view' && selected && (
            <div className="mt-6 flex flex-wrap gap-4">
              <button type="button" onClick={() => { void saveBearing(); }} className="text-[14px] text-zinc-100 underline">
                {selected.bearing ? 'Edit the bearing' : 'Set the bearing'}
              </button>
              {selected.bearing ? (
                <button type="button" onClick={() => { void saveMark(); }} className="text-[14px] text-zinc-100 underline">
                  {selected.mark ? 'Edit the mark' : 'Mark the link'}
                </button>
              ) : null}
            </div>
          )}
          {phase === 'ready' && mode === 'bearing' && (
            <button type="button" onClick={() => { void saveBearing(); }} disabled={busy} className="mt-6 text-[14px] text-zinc-100 underline disabled:opacity-60">
              Save the bearing
            </button>
          )}
          {phase === 'ready' && mode === 'mark' && (
            <button type="button" onClick={() => { void saveMark(); }} disabled={busy} className="mt-6 text-[14px] text-zinc-100 underline disabled:opacity-60">
              Save the mark
            </button>
          )}
        </section>

        {actionError ? <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p> : null}

        <button
          type="button"
          onClick={() => { void openLink(); }}
          disabled={phase === 'loading' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {mode === 'open' ? 'Open this' : 'Open the link'}
        </button>
      </div>
    </LensShell>
  );
}
