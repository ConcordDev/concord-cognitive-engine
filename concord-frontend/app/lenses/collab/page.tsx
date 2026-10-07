'use client';

/**
 * Collab — one room.
 *
 * room-list is the left pane. Open a room calls room-open, then shows
 * the title only after room-list contains that id and the same title,
 * and shows the note only after room-detail returns that same note.
 * A blank title is not sent. A blank note is not sent. Title and note
 * live in collab_rooms, so a server restart still lists them.
 * Participants are not rendered. The hub is a different surface.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface RoomRow {
  id: string;
  title: string;
  note: string;
}

type Phase = 'loading' | 'ready' | 'error';

function rowsFrom(rows: unknown): { id: string; title: string }[] {
  if (!Array.isArray(rows)) return [];
  const out: { id: string; title: string }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const title = (row as { title?: string }).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    out.push({ id, title: title.trim() });
  }
  return out;
}

function noteFrom(room: unknown): string {
  if (!room || typeof room !== 'object') return '';
  const note = (room as { note?: unknown }).note;
  return typeof note === 'string' ? note : '';
}

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

async function runCollab<T>(name: string, input: Record<string, unknown>, fallback: string): Promise<T> {
  let last = fallback;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await lensRun<T>('collab', name, input);
    if (response.data?.ok && response.data.result) return response.data.result;
    last = response.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

async function readRooms(): Promise<RoomRow[]> {
  const listed = await runCollab<{ rooms?: unknown }>('room-list', {}, 'Could not read the room.');
  const slim = rowsFrom(listed.rooms);
  const out: RoomRow[] = [];
  for (const row of slim) {
    const detail = await runCollab<{ room?: unknown }>('room-detail', { id: row.id }, 'Could not read the room.');
    out.push({ id: row.id, title: row.title, note: noteFrom(detail.room) });
  }
  return out;
}

export default function CollabLensPage() {
  useLensNav('collab');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readRooms(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setRooms(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the room.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setRooms(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the room.');
    });
  }, [pull]);

  const openRoom = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      return;
    }
    const trimmed = title.trim();
    const selected = note.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    if (!selected) {
      setActionError('A note is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await runCollab<{ roomId?: string }>(
        'room-open',
        { title: trimmed, note: selected },
        'Could not open that room.',
      );
      const id = created.roomId;
      if (!id) throw new Error('Could not open that room.');
      const rows = await readRooms();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed || row.note !== selected) {
        throw new Error('Opened, but the room did not read it back.');
      }
      setRooms(rows);
      setTitle('');
      setNote('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that room.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, note, phase, title]);

  useLensCommand(
    [{ id: 'collab-open', keys: 'n', description: 'Open a room', category: 'actions', action: () => { void openRoom(); } }],
    { lensId: 'collab' },
  );

  const selected = rooms.find((room) => room.note) || null;
  const empty = phase === 'ready' && rooms.length === 0 && !composing;

  return (
    <LensShell lensId="collab" asMain={false}>
      <div data-lens-theme="collab" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Collab</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The room{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Room"
          className="grid min-h-[22rem] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 md:grid-cols-[16rem_1fr]"
        >
          {phase === 'loading' && (
            <p data-testid="cb-loading" role="status" aria-busy="true" className="col-span-full px-6 py-5 text-[14px] text-zinc-500">
              Opening the room.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="cb-error" role="alert" className="col-span-full px-6 py-5">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the room.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <>
              <p data-testid="cb-empty-room" className="border-white/10 px-6 py-5 text-[14px] text-zinc-400 md:border-r">No room open.</p>
              <p data-testid="cb-empty-note" className="px-6 py-5 text-[14px] text-zinc-400">Nothing selected.</p>
            </>
          )}
          {phase === 'ready' && rooms.length > 0 && !composing && (
            <>
              <ul data-testid="cb-rooms" className="space-y-4 border-white/10 px-6 py-5 md:border-r">
                {rooms.map((room) => (
                  <li key={room.id}>
                    <h2 className="font-vault text-[1.35rem] leading-7 text-zinc-100">{room.title}</h2>
                  </li>
                ))}
              </ul>
              <div className="px-6 py-5">
                {selected?.note ? (
                  <p data-testid="cb-note" className="text-[15px] text-zinc-300">{selected.note}</p>
                ) : (
                  <p className="text-[14px] text-zinc-400">Nothing selected.</p>
                )}
              </div>
            </>
          )}
          {phase === 'ready' && composing && (
            <div className="col-span-full space-y-4 px-6 py-5">
              <label className="block text-[14px] text-zinc-400">
                Title
                <input
                  data-testid="cb-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
              <label className="block text-[14px] text-zinc-400">
                Note
                <input
                  data-testid="cb-note-input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void openRoom(); }
                  }}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                />
              </label>
            </div>
          )}
        </section>

        {actionError ? (
          <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
        ) : null}

        <button
          type="button"
          onClick={() => { void openRoom(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          Open a room
        </button>
      </div>
    </LensShell>
  );
}
