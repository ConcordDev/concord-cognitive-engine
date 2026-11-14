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

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
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

/** Room titles cap at 200 — the same limit the input validator and
 *  the room store enforce, so a title the form accepts always reads
 *  back exactly as typed. */
const TITLE_MAX = 200;

/** Server wording never reaches the user raw: map the known cases to
 *  a plain sentence (the audit found the validator's raw "Input too
 *  long: input.title: 301 chars (max 200)" rendered as the error). */
function friendlyRoomError(message: string, fallback: string): string {
  if (/input too long/i.test(message)) {
    return `That title is too long — keep it to ${TITLE_MAX} characters or fewer.`;
  }
  if (/room title required/i.test(message)) return 'A title is required.';
  if (/room note required/i.test(message)) return 'A note is required.';
  if (/service_overloaded|event_loop_lag|status code 503/i.test(message)) {
    return 'Concord is warming up — give it a moment and try again.';
  }
  // Anything else the server said passes through — the floor build's
  // states pin that surfacing; only the audited raw wordings are mapped.
  return message || fallback;
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

interface RoomComposerProps {
  busy: boolean;
  submitRef: React.MutableRefObject<(() => void) | null>;
  onCreate: (title: string, note: string) => Promise<void>;
}

/**
 * The create form owns its field state. Typing must never ride the
 * page's render cycle — the page re-renders on room loads, receipts
 * and shell state, and a form whose fields live at page root can lose
 * the caret mid-word when the surrounding tree churns (the audit's
 * focus-jump finding). Field errors sit under their field, tied by
 * aria-describedby, and the title carries the same 200-character cap
 * the validator and the room store enforce.
 */
const RoomComposer = memo(function RoomComposer({ busy, submitRef, onCreate }: RoomComposerProps) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [titleError, setTitleError] = useState('');
  const [noteError, setNoteError] = useState('');
  const [formError, setFormError] = useState('');

  const submit = useCallback(async () => {
    const trimmed = title.trim();
    const nextNote = note.trim();
    setTitleError(trimmed ? '' : 'A title is required.');
    setNoteError(nextNote ? '' : 'A note is required.');
    if (!trimmed || !nextNote) return;
    setFormError('');
    try {
      await onCreate(trimmed, nextNote);
    } catch (err) {
      setFormError(friendlyRoomError(err instanceof Error ? err.message : '', 'Could not open that room.'));
    }
  }, [note, onCreate, title]);

  useEffect(() => {
    submitRef.current = () => { void submit(); };
    return () => { submitRef.current = null; };
  }, [submit, submitRef]);

  return (
    <form
      data-testid="cb-composer"
      className="col-span-full space-y-4 px-6 py-5"
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
      <div>
        <label className="block text-[14px] text-zinc-400" htmlFor="cb-title-input">
          Title
          <input
            id="cb-title-input"
            data-testid="cb-title"
            value={title}
            maxLength={TITLE_MAX}
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? 'cb-title-error cb-title-count' : 'cb-title-count'}
            onChange={(event) => { setTitle(event.target.value); if (titleError) setTitleError(''); }}
            className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
            autoFocus
          />
        </label>
        <div className="mt-1 flex items-baseline justify-between gap-4">
          {titleError ? (
            <p id="cb-title-error" role="alert" className="text-[13px] text-red-300">{titleError}</p>
          ) : (
            <span />
          )}
          <p id="cb-title-count" className="text-[12px] text-zinc-500">{title.length}/{TITLE_MAX}</p>
        </div>
      </div>
      <div>
        <label className="block text-[14px] text-zinc-400" htmlFor="cb-note-field">
          Note
          <input
            id="cb-note-field"
            data-testid="cb-note-input"
            value={note}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? 'cb-note-error' : undefined}
            onChange={(event) => { setNote(event.target.value); if (noteError) setNoteError(''); }}
            className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
          />
        </label>
        {noteError && (
          <p id="cb-note-error" role="alert" className="mt-1 text-[13px] text-red-300">{noteError}</p>
        )}
      </div>
      {formError && (
        <p role="alert" className="text-[14px] text-zinc-300">{formError}</p>
      )}
      <button type="submit" disabled={busy} className="sr-only">Open room</button>
    </form>
  );
});

export default function CollabLensPage() {
  useLensNav('collab');
  const [phase, setPhase] = useState<Phase>('loading');
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const composerSubmitRef = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTitleError, setEditTitleError] = useState('');
  const [editNote, setEditNote] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [receipt, setReceipt] = useState('');

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

  const createRoom = useCallback(async (trimmed: string, selected: string) => {
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
      setSelectedId(id);
      // The status line names the room just saved — a create used to
      // leave whatever an earlier edit/close had printed standing.
      setReceipt(`Saved “${trimmed}”.`);
      setComposing(false);
    } finally {
      setBusy(false);
    }
  }, []);

  const openRoom = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      setReceipt('');
      return;
    }
    composerSubmitRef.current?.();
  }, [busy, composing, phase]);

  useLensCommand(
    [{ id: 'collab-open', keys: 'n', description: 'Open a room', category: 'actions', action: () => { void openRoom(); } }],
    { lensId: 'collab' },
  );

  // The selected room is the one the user picked (default: the first);
  // the note pane follows the selection. (At the pass the pane showed
  // the first room carrying a note — there was no selection to follow.)
  const selected = rooms.find((room) => room.id === selectedId) || rooms[0] || null;

  const startEdit = useCallback(() => {
    if (!selected || busy) return;
    setEditTitle(selected.title);
    setEditNote(selected.note);
    setActionError('');
    setConfirmClose(false);
    setEditing(true);
  }, [busy, selected]);

  const saveEdit = useCallback(async () => {
    if (!selected || busy) return;
    const trimmed = editTitle.trim();
    const nextNote = editNote.trim();
    setEditTitleError(trimmed ? '' : 'A title is required.');
    if (!trimmed) { return; }
    if (!nextNote) { setActionError('A note is required.'); return; }
    setBusy(true);
    setActionError('');
    try {
      await runCollab<{ room?: unknown }>(
        'room-update',
        { id: selected.id, title: trimmed, note: nextNote },
        'Could not save that room.',
      );
      // The page's read-back discipline, kept: the edit shows only
      // after the list + detail read the new values back.
      const rows = await readRooms();
      const row = rows.find((item) => item.id === selected.id);
      if (!row || row.title !== trimmed || row.note !== nextNote) {
        throw new Error('Saved, but the room did not read it back.');
      }
      setRooms(rows);
      setEditing(false);
      setReceipt(`Saved “${trimmed}”.`);
    } catch (err) {
      setActionError(friendlyRoomError(err instanceof Error ? err.message : '', 'Could not save that room.'));
    } finally {
      setBusy(false);
    }
  }, [busy, editNote, editTitle, selected]);

  const closeRoom = useCallback(async () => {
    if (!selected || busy) return;
    // Two-step, fleet form: first click arms, only the armed click closes.
    if (!confirmClose) { setConfirmClose(true); return; }
    setBusy(true);
    setActionError('');
    try {
      await runCollab<{ closed?: string }>('room-close', { id: selected.id }, 'Could not close that room.');
      const rows = await readRooms();
      if (rows.some((item) => item.id === selected.id)) {
        throw new Error('Closed, but the room still reads back.');
      }
      setRooms(rows);
      setSelectedId(null);
      setConfirmClose(false);
      setReceipt(`Closed “${selected.title}”.`);
    } catch (err) {
      setActionError(friendlyRoomError(err instanceof Error ? err.message : '', 'Could not close that room.'));
    } finally {
      setBusy(false);
    }
  }, [busy, confirmClose, selected]);
  const empty = phase === 'ready' && rooms.length === 0 && !composing;

  return (
    <LensShell lensId="collab" asMain={false}>
      <div data-lens-theme="collab" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Collab</h1>

        <p data-testid="cb-room-about" className="mb-5 max-w-xl text-[14px] text-zinc-400">
          A room is a title and a note, saved to your account and listed here when you return.
        </p>

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
          {phase === 'ready' && rooms.length > 0 && !composing && !editing && (
            <>
              <ul data-testid="cb-rooms" className="space-y-4 border-white/10 px-6 py-5 md:border-r">
                {rooms.map((room) => (
                  <li key={room.id}>
                    <button
                      type="button"
                      onClick={() => { setSelectedId(room.id); setConfirmClose(false); }}
                      aria-pressed={selected?.id === room.id}
                      className={`text-left font-vault text-[1.35rem] leading-7 ${selected?.id === room.id ? 'text-zinc-100 underline' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                      {room.title}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="px-6 py-5">
                {selected?.note ? (
                  <p data-testid="cb-note" className="text-[15px] text-zinc-300">{selected.note}</p>
                ) : (
                  <p className="text-[14px] text-zinc-400">Nothing selected.</p>
                )}
                {selected && (
                  <div className="mt-5 flex gap-4 text-[14px]">
                    <button type="button" onClick={startEdit} disabled={busy} className="text-zinc-100 underline disabled:opacity-60">
                      Edit room
                    </button>
                    <button
                      type="button"
                      onClick={() => { void closeRoom(); }}
                      disabled={busy}
                      className={confirmClose ? 'font-medium text-red-300 underline' : 'text-zinc-400 underline hover:text-zinc-200'}
                    >
                      {confirmClose ? `Delete “${selected.title}”? This permanently deletes the room.` : 'Delete room'}
                    </button>
                    {confirmClose && (
                      <button type="button" onClick={() => setConfirmClose(false)} className="text-zinc-400 underline hover:text-zinc-200">
                        Keep it
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          {phase === 'ready' && editing && selected && (
            <div className="col-span-full space-y-4 px-6 py-5">
              <div>
                <label className="block text-[14px] text-zinc-400" htmlFor="cb-edit-title-field">
                  Title
                  <input
                    id="cb-edit-title-field"
                    data-testid="cb-edit-title"
                    value={editTitle}
                    maxLength={TITLE_MAX}
                    aria-invalid={editTitleError ? true : undefined}
                    aria-describedby={editTitleError ? 'cb-edit-title-error' : undefined}
                    onChange={(event) => { setEditTitle(event.target.value); if (editTitleError) setEditTitleError(''); }}
                    className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                    autoFocus
                  />
                </label>
                {editTitleError && (
                  <p id="cb-edit-title-error" role="alert" className="mt-1 text-[13px] text-red-300">{editTitleError}</p>
                )}
              </div>
              <label className="block text-[14px] text-zinc-400">
                Note
                <input
                  data-testid="cb-edit-note"
                  value={editNote}
                  onChange={(event) => setEditNote(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void saveEdit(); }
                  }}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                />
              </label>
              <div className="flex gap-4 text-[14px]">
                <button type="button" onClick={() => { void saveEdit(); }} disabled={busy} className="text-zinc-100 underline disabled:opacity-60">
                  Save changes
                </button>
                <button type="button" onClick={() => setEditing(false)} disabled={busy} className="text-zinc-400 underline hover:text-zinc-200">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {phase === 'ready' && composing && (
            <RoomComposer busy={busy} submitRef={composerSubmitRef} onCreate={createRoom} />
          )}
        </section>

        {actionError ? (
          <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
        ) : null}

        {receipt && !actionError ? (
          <p role="status" className="mt-4 text-[14px] text-zinc-400">{receipt}</p>
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
