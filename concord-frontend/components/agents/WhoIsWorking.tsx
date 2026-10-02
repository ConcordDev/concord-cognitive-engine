'use client';

/** Agents north star — the one agent that is actually running, or none. */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type AgentData = { name?: string; status?: string; description?: string; goals?: string[] };
type AgentItem = { id: string; title?: string; data?: AgentData };

const PILL = [
  { id: 'agents', label: 'Agents', href: '/lenses/agents' },
  { id: 'personas', label: 'Personas', href: '/lenses/personas' },
];

const quiet = { retry: false, refetchOnWindowFocus: false } as const;

export function WhoIsWorking({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('agents');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const agentsQ = useQuery({
    queryKey: ['agents-northstar', 'agents'],
    ...quiet,
    queryFn: async () => {
      const res = await api.get<{ ok?: boolean; error?: string; artifacts?: AgentItem[] }>('/api/lens/agents?type=agent');
      if (res.data?.ok === false) throw new Error(res.data.error || 'The fleet did not answer.');
      if (!Array.isArray(res.data?.artifacts)) throw new Error('The fleet did not answer.');
      return res.data.artifacts;
    },
  });

  const running = agentsQ.data?.find((agent) => agent.data?.status === 'running') ?? null;
  const job = running?.data?.description || running?.data?.goals?.find(Boolean) || null;
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      setError('An agent needs a name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/api/lens/agents', {
        type: 'agent',
        title: name.trim(),
        data: { name: name.trim(), status: 'dormant', enabled: false, description: '', goals: [] },
      });
      if (res.data?.ok === false) {
        setError(res.data.error || 'The agent was not saved.');
        return;
      }
      setName('');
      setComposing(false);
      await client.invalidateQueries({ queryKey: ['agents-northstar', 'agents'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The agent was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const loadError = agentsQ.error instanceof Error ? agentsQ.error.message : '';

  return (
    <LensShell lensId="agents" asMain={false} disableAgentFab>
      <div data-lens-theme="agents" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Agents" title={who ? `Who is working, ${who}` : 'Who is working'} />
            <FamilyPill label="Agents" active="agents" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Fleet' }]} onPick={onOpenDesk} />
        </div>

        {(loadError || error) && <NorthError message={error || loadError} />}

        {agentsQ.data && !running && <p className="mt-8 text-[15px] text-zinc-400">None running</p>}
        {running && (
          <div className="mt-8 max-w-xl rounded-xl border border-white/10 px-4 py-4">
            <p className="text-[16px] text-zinc-100">{running.data?.name || running.title}</p>
            {job && <p className="mt-1 text-[14px] text-zinc-400">{job}</p>}
          </div>
        )}

        {composing && (
          <form className="mt-4 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input aria-label="Agent name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Save agent</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>+ New agent</button>
      </div>
    </LensShell>
  );
}
