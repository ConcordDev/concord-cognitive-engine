'use client';

/**
 * Sim north star — one scenario. Zero tiles and the run desk stay under More.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { StudioFamilyPill } from '@/components/studio/StudioFamilyChrome';
import { SimConsole } from '@/components/sim/SimConsole';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export function SimNorthStar() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const scenarios = useLensData<Record<string, unknown>>('sim', 'scenario', { noSeed: true });
  const runs = useQuery({
    queryKey: ['simulations'],
    queryFn: () => apiHelpers.simulations.list().then((r) => r.data as { simulations?: unknown[] }),
  });
  const [desk, setDesk] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [assumptions, setAssumptions] = useState('');
  const [error, setError] = useState('');

  const current = scenarios.items[0];
  const assumptionText = typeof current?.data?.assumptions === 'string' ? current.data.assumptions : '';
  const runList = runs.data?.simulations;
  const runCount = Array.isArray(runList) ? runList.length : null;

  const save = async () => {
    const name = title.trim();
    if (!name) {
      setOpen(true);
      setError('Name the scenario.');
      return;
    }
    setError('');
    try {
      await scenarios.create({
        title: name,
        data: { name, assumptions: assumptions.trim(), status: 'draft' },
        meta: { status: 'active', tags: ['scenario'] },
      });
      setOpen(false);
      setTitle('');
      setAssumptions('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the scenario.');
    }
  };

  if (desk) {
    return (
      <LensShell lensId="sim" asMain={false} disableAgentFab>
        <div className="px-6 pt-4">
          <button type="button" onClick={() => setDesk(false)} className="inline-flex items-center gap-1.5 text-[14px] text-zinc-500 hover:text-zinc-200">
            <ArrowLeft className="h-4 w-4" />
            Simulation
          </button>
        </div>
        <SimConsole />
      </LensShell>
    );
  }

  return (
    <LensShell lensId="sim" asMain={false} disableAgentFab>
      <div data-lens-theme="sim" className="flex min-h-[calc(100vh-4rem)] flex-col px-8 pb-28 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Simulation" title={who ? `Run the scenario, ${who}` : 'Run the scenario'} />
            <StudioFamilyPill active="sim" />
          </div>
          <QuietMore items={[{ id: 'console', label: 'Run console' }]} onPick={() => setDesk(true)} />
        </div>

        <section className="mt-8 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
          <p className="text-[15px] font-medium text-zinc-100">{current?.title || 'No scenario yet'}</p>
          <p className="mt-2 text-[13px] text-zinc-500">
            {runCount === null
              ? 'Runs list didn’t load.'
              : `${runCount} runs on the books. Name the assumptions, then run once.`}
          </p>
          {assumptionText && <p className="mt-3 text-[14px] text-zinc-300">{assumptionText}</p>}
          {open && (
            <div className="mt-4 space-y-2">
              <label className="block text-[13px] text-zinc-400">
                Scenario name
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
                />
              </label>
              <label className="block text-[13px] text-zinc-400">
                Assumptions
                <textarea
                  value={assumptions}
                  onChange={(e) => setAssumptions(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
                />
              </label>
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-[13px] text-rose-300">{error}</p>}
        </section>

        <button type="button" className={northCtaClass} onClick={() => { if (!open) { setOpen(true); return; } void save(); }}>
          + New scenario
        </button>
      </div>
    </LensShell>
  );
}
