'use client';

/**
 * Photography — one roll.
 *
 * shoot-list is the card. Import a roll calls shoot-create, then shows
 * the name and the filenames only after shoot-list contains that id, the
 * same name, and the same filenames. A blank name is not sent. Names and
 * filenames are stored in photography_rolls and photography_roll_frames,
 * so a server restart still lists them. Date, location, and client stay
 * off this screen. The catalog is other macros. It is not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface Frame {
  id: string;
  filename: string;
}

interface Roll {
  id: string;
  name: string;
  frames: Frame[];
}

type Phase = 'loading' | 'ready' | 'error';

function framesFrom(rows: unknown): Frame[] {
  if (!Array.isArray(rows)) return [];
  const out: Frame[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const filename = (row as { filename?: string }).filename;
    if (typeof id !== 'string' || !id) continue;
    if (typeof filename !== 'string' || !filename.trim()) continue;
    out.push({ id, filename: filename.trim() });
  }
  return out;
}

function rollsFrom(rows: unknown): Roll[] {
  if (!Array.isArray(rows)) return [];
  const out: Roll[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const name = (row as { name?: string }).name;
    if (typeof id !== 'string' || !id) continue;
    if (typeof name !== 'string' || !name.trim()) continue;
    out.push({
      id,
      name: name.trim(),
      frames: framesFrom((row as { frames?: unknown }).frames),
    });
  }
  return out;
}

function sameFrames(frames: Frame[], filenames: string[]): boolean {
  if (frames.length !== filenames.length) return false;
  return frames.every((frame, index) => frame.filename === filenames[index]);
}

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

// shoot-list is a small read. A 503 here is the admission gate refusing
// PROTECTED calls while boot lag is over 900ms, not a failed roll query.
// Retry on that gate only. Any other error surfaces immediately.
async function readRolls(): Promise<Roll[]> {
  let last = 'Could not read the roll.';
  for (let attempt = 0; attempt < 8; attempt++) {
    const list = await lensRun<{ shoots?: unknown }>('photography', 'shoot-list', {});
    if (list.data?.ok) return rollsFrom(list.data.result?.shoots);
    last = list.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

export default function PhotographyPage() {
  useLensNav('photography');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readRolls(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setRolls(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the roll.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setRolls(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the roll.');
    });
  }, [pull]);

  const importRoll = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      return;
    }
    const trimmed = name.trim();
    const frameName = filename.trim();
    if (!trimmed) {
      setActionError('A name is required.');
      return;
    }
    if (!frameName) {
      setActionError('A filename is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await lensRun<{ shoot?: { id?: string; name?: string } }>(
        'photography',
        'shoot-create',
        { name: trimmed, frames: [frameName] },
      );
      const id = created.data?.result?.shoot?.id;
      if (!created.data?.ok || !id) {
        throw new Error(created.data?.error || 'Could not import that roll.');
      }
      const rows = await readRolls();
      const row = rows.find((item) => item.id === id);
      if (!row || row.name !== trimmed || !sameFrames(row.frames, [frameName])) {
        throw new Error('Imported, but the roll did not read it back.');
      }
      setRolls(rows);
      setName('');
      setFilename('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not import that roll.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, filename, name, phase]);

  useLensCommand(
    [{ id: 'photography-import', keys: 'n', description: 'Import a roll', category: 'actions', action: () => { void importRoll(); } }],
    { lensId: 'photography' },
  );

  const empty = phase === 'ready' && rolls.length === 0 && !composing;

  return (
    <LensShell lensId="photography" asMain={false}>
      <div data-lens-theme="photography" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Photography</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The roll{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Roll"
          className="min-h-[22rem] rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5"
        >
          {phase === 'loading' && (
            <p data-testid="ph-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the roll.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="ph-error" role="alert">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the roll.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <div data-testid="ph-empty" className="flex min-h-[20rem] items-center justify-center">
              <p className="text-[14px] text-zinc-500">No roll loaded.</p>
            </div>
          )}
          {phase === 'ready' && rolls.length > 0 && (
            <ul data-testid="ph-rolls" className="space-y-6">
              {rolls.map((roll) => (
                <li key={roll.id}>
                  <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{roll.name}</h2>
                  {roll.frames.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {roll.frames.map((frame) => (
                        <li key={frame.id} data-testid="ph-frame" className="font-mono text-[14px] text-zinc-400">
                          {frame.filename}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <div className="mt-4 space-y-4">
              <label className="block text-[14px] text-zinc-400">
                Name
                <input
                  data-testid="ph-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
              <label className="block text-[14px] text-zinc-400">
                Filename
                <input
                  data-testid="ph-filename"
                  value={filename}
                  onChange={(event) => setFilename(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void importRoll(); }
                  }}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-mono text-[14px] text-zinc-100 outline-none"
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
          onClick={() => { void importRoll(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          Import a roll
        </button>
      </div>
    </LensShell>
  );
}
