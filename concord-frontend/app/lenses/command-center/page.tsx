'use client';

/**
 * Command Center — the one alert.
 *
 * The frame matches the concept: one panel, empty copy, Refresh.
 * Refresh only re-reads. Filing, the queue, the line, and the
 * acknowledgement are the worker inside that panel.
 * alert-list is id, title, and status. The line and the note show
 * only after alert-detail returns them. Severity is not rendered.
 * The old cockpit stays unmounted.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface AlertRow {
  id: string;
  title: string;
  status: 'open' | 'acknowledged';
  line: string;
  ackNote: string | null;
}

type Phase = 'loading' | 'ready' | 'error';
type Mode = 'view' | 'file' | 'edit' | 'ack';

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

async function runCc<T>(name: string, input: Record<string, unknown>, fallback: string): Promise<T> {
  let last = fallback;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await lensRun<T>('command-center', name, input);
    if (response.data?.ok && response.data.result) return response.data.result;
    last = response.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

function statusOf(value: unknown): 'open' | 'acknowledged' | '' {
  return value === 'open' || value === 'acknowledged' ? value : '';
}

function statusLabel(status: AlertRow['status']): string {
  return status === 'acknowledged' ? 'Acknowledged' : 'Open';
}

async function readDesk(): Promise<{ alerts: AlertRow[]; frontId: string | null }> {
  const listed = await runCc<{ alerts?: unknown }>('alert-list', {}, 'Could not read the alert.');
  const front = await runCc<{ alert?: unknown }>('alert-front', {}, 'Could not read the alert.');
  const slim: { id: string; title: string; status: 'open' | 'acknowledged' }[] = [];
  if (Array.isArray(listed.alerts)) {
    for (const row of listed.alerts) {
      if (!row || typeof row !== 'object') continue;
      const id = (row as { id?: unknown }).id;
      const title = (row as { title?: unknown }).title;
      const status = statusOf((row as { status?: unknown }).status);
      if (typeof id !== 'string' || !id) continue;
      if (typeof title !== 'string' || !title.trim() || !status) continue;
      slim.push({ id, title: title.trim(), status });
    }
  }
  const alerts: AlertRow[] = [];
  for (const row of slim) {
    const detail = await runCc<{ alert?: unknown }>('alert-detail', { id: row.id }, 'Could not read the alert.');
    const alert = detail.alert;
    if (!alert || typeof alert !== 'object') continue;
    const body = alert as { id?: unknown; title?: unknown; line?: unknown; status?: unknown; ackNote?: unknown };
    if (body.id !== row.id || typeof body.title !== 'string' || body.title.trim() !== row.title) continue;
    const status = statusOf(body.status) || row.status;
    alerts.push({
      id: row.id,
      title: row.title,
      status,
      line: typeof body.line === 'string' ? body.line : '',
      ackNote: typeof body.ackNote === 'string' && body.ackNote ? body.ackNote : null,
    });
  }
  let frontId: string | null = null;
  if (front.alert && typeof front.alert === 'object') {
    const face = front.alert as { id?: unknown; title?: unknown; status?: unknown };
    if (typeof face.id === 'string' && typeof face.title === 'string') {
      const match = alerts.find((item) => item.id === face.id && item.title === face.title.trim() && item.status === 'open');
      if (match) frontId = match.id;
    }
  }
  return { alerts, frontId };
}

export default function CommandCenterPage() {
  useLensNav('command-center');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [frontId, setFrontId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [title, setTitle] = useState('');
  const [line, setLine] = useState('');
  const [editLine, setEditLine] = useState('');
  const [ackNote, setAckNote] = useState('');
  const [busy, setBusy] = useState(false);

  const applyDesk = useCallback((desk: { alerts: AlertRow[]; frontId: string | null }, preferId?: string) => {
    setAlerts(desk.alerts);
    setFrontId(desk.frontId);
    setSelectedId((current) => {
      const want = preferId || current;
      if (want && desk.alerts.some((item) => item.id === want)) return want;
      return desk.frontId;
    });
  }, []);

  const pull = useCallback(async (preferId?: string) => {
    const desk = await readDesk();
    applyDesk(desk, preferId);
    setMode('view');
    setPhase('ready');
  }, [applyDesk]);

  useEffect(() => {
    let cancelled = false;
    readDesk().then((desk) => {
      if (cancelled) return;
      applyDesk(desk);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the alert.');
    });
    return () => { cancelled = true; };
  }, [applyDesk]);

  const refresh = useCallback(() => {
    if (busy) return;
    setPhase('loading');
    setLoadError('');
    setActionError('');
    setTitle('');
    setLine('');
    setEditLine('');
    setAckNote('');
    pull().catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the alert.');
    });
  }, [busy, pull]);

  const fileAlert = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (mode !== 'file') {
      setMode('file');
      setActionError('');
      return;
    }
    const trimmed = title.trim();
    const said = line.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    if (!said) {
      setActionError('A line is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await runCc<{ alertId?: string }>('alert-file', { title: trimmed, line: said }, 'Could not file that alert.');
      const id = created.alertId;
      if (!id) throw new Error('Could not file that alert.');
      const desk = await readDesk();
      const row = desk.alerts.find((item) => item.id === id);
      if (!row || row.title !== trimmed || row.line !== said || row.status !== 'open') {
        throw new Error('Filed, but the alert did not read it back.');
      }
      applyDesk(desk, id);
      setTitle('');
      setLine('');
      setMode('view');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not file that alert.');
    } finally {
      setBusy(false);
    }
  }, [applyDesk, busy, line, mode, phase, title]);

  const saveLine = useCallback(async () => {
    if (busy || phase !== 'ready' || !selectedId) return;
    if (mode !== 'edit') {
      const current = alerts.find((item) => item.id === selectedId);
      setEditLine(current?.line || '');
      setMode('edit');
      setActionError('');
      return;
    }
    const next = editLine.trim();
    if (!next) {
      setActionError('A line is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await runCc('alert-edit', { id: selectedId, line: next }, 'Could not save that line.');
      const desk = await readDesk();
      const row = desk.alerts.find((item) => item.id === selectedId);
      if (!row || row.line !== next) throw new Error('Saved, but the alert did not read the line back.');
      applyDesk(desk, selectedId);
      setEditLine('');
      setMode('view');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save that line.');
    } finally {
      setBusy(false);
    }
  }, [alerts, applyDesk, busy, editLine, mode, phase, selectedId]);

  const acknowledge = useCallback(async () => {
    if (busy || phase !== 'ready' || !selectedId) return;
    const current = alerts.find((item) => item.id === selectedId);
    if (!current || current.status !== 'open') return;
    if (mode !== 'ack') {
      setMode('ack');
      setActionError('');
      return;
    }
    const note = ackNote.trim();
    if (!note) {
      setActionError('An acknowledgement note is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await runCc('alert-acknowledge', { id: selectedId, note }, 'Could not acknowledge that alert.');
      const desk = await readDesk();
      const row = desk.alerts.find((item) => item.id === selectedId);
      if (!row || row.status !== 'acknowledged' || row.ackNote !== note) {
        throw new Error('Acknowledged, but the alert did not read the note back.');
      }
      applyDesk(desk, selectedId);
      setAckNote('');
      setMode('view');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not acknowledge that alert.');
    } finally {
      setBusy(false);
    }
  }, [ackNote, alerts, applyDesk, busy, mode, phase, selectedId]);

  const openRow = useCallback(async (id: string) => {
    if (busy || phase !== 'ready') return;
    setBusy(true);
    setActionError('');
    try {
      const detail = await runCc<{ alert?: { id?: string; title?: string; line?: unknown; status?: unknown; ackNote?: unknown } }>(
        'alert-detail',
        { id },
        'Could not read the alert.',
      );
      const body = detail.alert;
      setAlerts((rows) => rows.map((item) => {
        if (item.id !== id || !body || body.id !== id || body.title !== item.title) return item;
        const status = statusOf(body.status) || item.status;
        return {
          ...item,
          status,
          line: typeof body.line === 'string' ? body.line : '',
          ackNote: typeof body.ackNote === 'string' && body.ackNote ? body.ackNote : null,
        };
      }));
      setSelectedId(id);
      setMode('view');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not read the alert.');
    } finally {
      setBusy(false);
    }
  }, [busy, phase]);

  useLensCommand(
    [{ id: 'cc-refresh', keys: 'r', description: 'Refresh', category: 'actions', action: () => refresh() }],
    { lensId: 'command-center' },
  );

  const front = alerts.find((item) => item.id === frontId) || null;
  const selected = alerts.find((item) => item.id === selectedId) || null;
  const showing = selected && front && selected.id === front.id ? selected : null;
  const other = selected && (!front || selected.id !== front.id) ? selected : null;
  const emptyFront = phase === 'ready' && mode === 'view' && !front;

  return (
    <LensShell lensId="command-center" asMain={false}>
      <div data-lens-theme="command-center" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Command Center</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The one alert{who ? `, ${who}` : ''}
        </h1>

        <section aria-label="Alert" className="min-h-[22rem] rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5">
          {phase === 'loading' && (
            <p data-testid="cc-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Reading the alert.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="cc-error" role="alert">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the alert.'}</p>
              <button type="button" onClick={refresh} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {emptyFront && (
            <p data-testid="cc-empty" className="text-[14px] text-zinc-400">No alert in front of you.</p>
          )}
          {phase === 'ready' && mode === 'view' && front && (
            <div className="mb-6">
              <h2 data-testid="cc-front" className="font-vault text-[1.5rem] leading-8 text-zinc-100">{front.title}</h2>
              {showing?.line ? <p data-testid="cc-line" className="mt-3 text-[15px] text-zinc-300">{showing.line}</p> : null}
              {showing ? <p data-testid="cc-status" className="mt-3 text-[13px] uppercase tracking-wide text-zinc-500">{statusLabel(showing.status)}</p> : null}
              {showing?.ackNote ? <p data-testid="cc-ack-note" className="mt-3 text-[15px] text-zinc-300">{showing.ackNote}</p> : null}
            </div>
          )}
          {phase === 'ready' && mode === 'view' && other && (
            <div data-testid="cc-detail" className="mb-6">
              <h2 className="font-vault text-[1.35rem] leading-7 text-zinc-100">{other.title}</h2>
              {other.line ? <p data-testid="cc-line" className="mt-3 text-[15px] text-zinc-300">{other.line}</p> : null}
              <p data-testid="cc-status" className="mt-3 text-[13px] uppercase tracking-wide text-zinc-500">{statusLabel(other.status)}</p>
              {other.ackNote ? <p data-testid="cc-ack-note" className="mt-3 text-[15px] text-zinc-300">{other.ackNote}</p> : null}
            </div>
          )}
          {phase === 'ready' && mode === 'view' && alerts.length > 0 && (
            <ul data-testid="cc-alerts" className="space-y-2 border-t border-white/10 pt-4">
              {alerts.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    data-testid={`cc-row-${item.id}`}
                    onClick={() => { void openRow(item.id); }}
                    className="text-left text-[15px] text-zinc-200 underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && mode === 'file' && (
            <div className="space-y-4">
              <label className="block text-[14px] text-zinc-400">
                Title
                <input
                  data-testid="cc-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
              <label className="block text-[14px] text-zinc-400">
                Line
                <input
                  data-testid="cc-line-input"
                  value={line}
                  onChange={(event) => setLine(event.target.value)}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                />
              </label>
            </div>
          )}
          {phase === 'ready' && mode === 'edit' && (
            <label className="block text-[14px] text-zinc-400">
              Line
              <input
                data-testid="cc-edit-line"
                value={editLine}
                onChange={(event) => setEditLine(event.target.value)}
                className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
          {phase === 'ready' && mode === 'ack' && (
            <label className="block text-[14px] text-zinc-400">
              Acknowledgement
              <input
                data-testid="cc-ack-input"
                value={ackNote}
                onChange={(event) => setAckNote(event.target.value)}
                className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
          {phase === 'ready' && mode === 'view' && (
            <div className="mt-6 flex flex-wrap gap-4">
              <button type="button" onClick={() => { void fileAlert(); }} className="text-[14px] text-zinc-100 underline">
                File an alert
              </button>
              {selected ? (
                <button type="button" onClick={() => { void saveLine(); }} className="text-[14px] text-zinc-100 underline">
                  Edit the line
                </button>
              ) : null}
              {selected?.status === 'open' ? (
                <button type="button" onClick={() => { void acknowledge(); }} className="text-[14px] text-zinc-100 underline">
                  Acknowledge
                </button>
              ) : null}
            </div>
          )}
          {phase === 'ready' && mode === 'file' && (
            <button type="button" onClick={() => { void fileAlert(); }} disabled={busy} className="mt-6 text-[14px] text-zinc-100 underline disabled:opacity-60">
              Put it in front
            </button>
          )}
          {phase === 'ready' && mode === 'edit' && (
            <button type="button" onClick={() => { void saveLine(); }} disabled={busy} className="mt-6 text-[14px] text-zinc-100 underline disabled:opacity-60">
              Save the line
            </button>
          )}
          {phase === 'ready' && mode === 'ack' && (
            <button type="button" onClick={() => { void acknowledge(); }} disabled={busy} className="mt-6 text-[14px] text-zinc-100 underline disabled:opacity-60">
              Save the acknowledgement
            </button>
          )}
        </section>

        {actionError ? <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p> : null}

        <button
          type="button"
          onClick={refresh}
          disabled={phase === 'loading' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          Refresh
        </button>
      </div>
    </LensShell>
  );
}
