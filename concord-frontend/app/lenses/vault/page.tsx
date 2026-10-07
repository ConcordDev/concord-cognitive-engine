'use client';

/**
 * TheVault — one cabinet.
 *
 * Left: vault.browse (admitted only) plus the signed-in user's
 * vault.my_submissions. Empty copy is "Nothing unlocked."
 * Right: "Nothing selected." until a row from that read is chosen.
 * Open the vault calls vault.submit, then shows the title only after
 * my_submissions contains that id and the same title. Status is the
 * word the row came back with. This screen does not admit.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface Work {
  id: string;
  title: string;
  status: string;
}

type Phase = 'loading' | 'ready' | 'error';

interface WorkRow {
  id?: string;
  title?: string;
  status?: string;
}

const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  admitted: 'Admitted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}

function worksFrom(rows: unknown): Work[] {
  if (!Array.isArray(rows)) return [];
  const out: Work[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as WorkRow).id;
    const title = (row as WorkRow).title;
    const status = (row as WorkRow).status;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    if (typeof status !== 'string' || !status) continue;
    out.push({ id, title: title.trim(), status });
  }
  return out;
}

function mergeWorks(admitted: Work[], own: Work[]): Work[] {
  const ownIds = new Set(own.map((row) => row.id));
  return [...own, ...admitted.filter((row) => !ownIds.has(row.id))];
}

async function readCabinet(): Promise<Work[]> {
  const [browse, mine] = await Promise.all([
    lensRun<{ records?: unknown }>('vault', 'browse', {}),
    lensRun<{ submissions?: unknown }>('vault', 'my_submissions', {}),
  ]);
  if (!browse.data?.ok) throw new Error(browse.data?.error || 'Could not read the vault.');
  if (!mine.data?.ok) throw new Error(mine.data?.error || 'Could not read the vault.');
  return mergeWorks(
    worksFrom(browse.data.result?.records),
    worksFrom(mine.data.result?.submissions),
  );
}

export default function VaultPage() {
  useLensNav('vault');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [works, setWorks] = useState<Work[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readCabinet(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setWorks(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the vault.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setWorks(rows);
      setSelectedId((current) => (current && rows.some((row) => row.id === current) ? current : null));
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the vault.');
    });
  }, [pull]);

  const openVault = useCallback(async () => {
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
      const created = await lensRun<{ id?: string }>('vault', 'submit', { title: trimmed });
      const id = created.data?.result?.id;
      if (!created.data?.ok || !id) {
        throw new Error(created.data?.error || 'Could not open that work.');
      }
      const rows = await readCabinet();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed) {
        throw new Error('Opened, but the vault did not read it back.');
      }
      setWorks(rows);
      setSelectedId((current) => (current && rows.some((item) => item.id === current) ? current : null));
      setTitle('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that work.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, phase, title]);

  useLensCommand(
    [{ id: 'vault-open', keys: 'o', description: 'Open the vault', category: 'actions', action: () => { void openVault(); } }],
    { lensId: 'vault' },
  );

  const selected = works.find((row) => row.id === selectedId) || null;

  return (
    <LensShell lensId="vault" asMain={false}>
      <div data-lens-theme="vault" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">TheVault</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The vault{who ? `, ${who}` : ''}
        </h1>

        <div className="grid min-h-[22rem] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 sm:grid-cols-[minmax(0,16rem)_1fr]">
          <section aria-label="Cabinet" className="border-white/10 px-5 py-6 sm:border-r">
            {phase === 'loading' && (
              <p data-testid="vault-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
                Opening the vault.
              </p>
            )}
            {phase === 'error' && (
              <div data-testid="vault-error" role="alert">
                <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the vault.'}</p>
                <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                  Retry
                </button>
              </div>
            )}
            {phase === 'ready' && works.length === 0 && (
              <p data-testid="vault-empty" className="text-[14px] text-zinc-500">Nothing unlocked.</p>
            )}
            {phase === 'ready' && works.length > 0 && (
              <ul data-testid="vault-works" className="space-y-2">
                {works.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={item.id === selectedId}
                      onClick={() => {
                        setSelectedId(item.id);
                        setComposing(false);
                        setActionError('');
                      }}
                      className="w-full rounded-lg px-2 py-2 text-left hover:bg-white/5"
                    >
                      <span className="block font-vault text-[1.05rem] text-zinc-100">{item.title}</span>
                      <span className="mt-1 block text-[12px] text-zinc-500">{statusLabel(item.status)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Record" className="px-6 py-6">
            {phase === 'ready' && selected && (
              <div data-testid="vault-selected">
                <h2 className="font-vault text-[1.75rem] text-zinc-100">{selected.title}</h2>
                <p className="mt-3 text-[14px] text-zinc-400">{statusLabel(selected.status)}</p>
              </div>
            )}
            {phase === 'ready' && !selected && !composing && (
              <p data-testid="vault-unselected" className="text-[14px] text-zinc-500">Nothing selected.</p>
            )}
            {phase === 'ready' && composing && (
              <label className="block text-[14px] text-zinc-400">
                Title
                <input
                  data-testid="vault-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void openVault(); }
                  }}
                  className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-[16px] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
            )}
            {actionError ? (
              <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
            ) : null}
          </section>
        </div>

        <button
          type="button"
          onClick={() => { void openVault(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          Open the vault
        </button>
      </div>
    </LensShell>
  );
}
