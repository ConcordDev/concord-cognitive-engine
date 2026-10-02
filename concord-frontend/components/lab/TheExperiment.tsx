'use client';

/** Lab north star — one protocol, and a run only after the engine has one. */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Protocol = { id: string; name?: string; stepCount?: number };
type Run = { id: string; name?: string; recordCount?: number };

const PILL = [
  { id: 'lab', label: 'Lab', href: '/lenses/lab' },
  { id: 'physics', label: 'Physics', href: '/lenses/physics' },
  { id: 'chem', label: 'Chem', href: '/lenses/chem' },
];

export function TheExperiment({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('lab');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const protocolsQ = useMacro<{ protocols?: Protocol[] }>(
    ['lab-northstar', 'protocols'],
    'lab',
    'protocol-list',
    {},
    (result) => {
      if (!Array.isArray(result.protocols)) throw new Error('Protocols did not answer.');
      return result;
    },
  );
  const runsQ = useMacro<{ runs?: Run[] }>(
    ['lab-northstar', 'runs'],
    'lab',
    'run-list',
    {},
    (result) => {
      if (!Array.isArray(result.runs)) throw new Error('Runs did not answer.');
      return result;
    },
  );

  const protocol = protocolsQ.data?.protocols?.[0] ?? null;
  const run = runsQ.data?.runs?.[0] ?? null;
  const ready = protocolsQ.data && runsQ.data;
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      setError('An experiment needs a name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await lensRun('lab', 'protocol-create', {
        name: name.trim(),
        steps: [{ text: name.trim(), durationMinutes: 0 }],
      });
      if (!res.data.ok) {
        setError(res.data.error || 'The experiment was not saved.');
        return;
      }
      setName('');
      setComposing(false);
      await client.invalidateQueries({ queryKey: ['lab-northstar', 'protocols'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The experiment was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const loadError = [protocolsQ.error, runsQ.error]
    .filter(Boolean)
    .map((e) => (e instanceof Error ? e.message : 'The lab did not answer.'))
    .join(' ');

  return (
    <LensShell lensId="lab" asMain={false} disableAgentFab>
      <div data-lens-theme="lab" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Lab" title={who ? `The experiment, ${who}` : 'The experiment'} />
            <FamilyPill label="Lab" active="lab" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Bench' }]} onPick={onOpenDesk} />
        </div>

        {(loadError || error) && <NorthError message={error || loadError} />}

        <div className="mt-6 max-w-xl space-y-2">
          {protocol && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="text-[15px] text-zinc-100">{protocol.name}</p>
              {typeof protocol.stepCount === 'number' && (
                <p className="mt-1 text-[13px] text-zinc-500">{protocol.stepCount} steps</p>
              )}
            </div>
          )}
          {ready && !run && <p className="text-[14px] text-zinc-500">No run</p>}
          {run && (
            <div className="rounded-xl border border-white/10 px-4 py-3" data-testid="lab-run">
              <p className="text-[15px] text-zinc-100">{run.name || 'Run'}</p>
              {typeof run.recordCount === 'number' && (
                <p className="mt-1 text-[13px] text-zinc-500">{run.recordCount} records</p>
              )}
            </div>
          )}
        </div>

        {composing && (
          <form className="mt-4 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input aria-label="Experiment name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Save experiment</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>+ New experiment</button>
      </div>
    </LensShell>
  );
}
