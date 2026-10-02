'use client';

/**
 * Entity north star — who is actually in the graph.
 * Rows come from entity.graph-get. The registry desks stay under More.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { GraphFamilyPill, SHAPE_LINKS } from '@/components/graph/GraphFamilyChrome';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

type EntityNode = { id: string; name?: string; entityType?: string };

export function EntityNorthStar({ onOpenDesk }: { onOpenDesk: () => void }) {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const graph = useQuery({
    queryKey: ['entity-north', 'graph'],
    queryFn: async () => {
      const r = await lensRun<{ nodes?: EntityNode[] }>('entity', 'graph-get', {});
      if (!r.data?.ok) throw new Error(r.data?.error || 'Entity graph failed');
      return r.data.result?.nodes ?? [];
    },
  });

  const spawn = async () => {
    const title = name.trim();
    if (!title) {
      setError('Name the entity.');
      return;
    }
    setSaving(true);
    setError('');
    const r = await lensRun('entity', 'node-create', {
      name: title,
      entityType: kind.trim() || 'generic',
    });
    setSaving(false);
    if (!r.data?.ok) {
      setError(r.data?.error || 'Entity was not spawned.');
      return;
    }
    setComposing(false);
    setName('');
    setKind('');
    await qc.invalidateQueries({ queryKey: ['entity-north'] });
  };

  const nodes = graph.data ?? [];

  return (
    <LensShell lensId="entity" asMain={false} disableAgentFab>
      <div data-lens-theme="entity" className="relative min-h-[calc(100vh-3rem)] px-8 pb-28 pt-8">
        <div className="absolute right-8 top-8">
          <QuietMore items={[{ id: 'desk', label: 'Entity desks' }]} onPick={() => onOpenDesk()} />
        </div>
        <NorthGreeting kicker="Entities" title={`Who is in the graph${who ? `, ${who}` : ''}`} />
        <GraphFamilyPill active="entity" links={SHAPE_LINKS} />

        {graph.isError && <p role="alert" className="mt-8 text-[14px] text-rose-300">Entity list didn’t load.</p>}
        {graph.isSuccess && nodes.length === 0 && (
          <p className="mt-10 text-[15px] text-zinc-500">No entities yet.</p>
        )}
        <ul className="mt-8 max-w-3xl space-y-2">
          {nodes.slice(0, 12).map((node) => (
            <li key={node.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="text-[15px] text-zinc-100">{node.name || node.id}</span>
              <span className="text-[13px] text-zinc-500">{node.entityType || 'generic'}</span>
            </li>
          ))}
        </ul>

        {composing && (
          <form className="mt-6 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); void spawn(); }}>
            <input
              aria-label="Entity name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
            />
            <input
              aria-label="Entity kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              placeholder="Kind"
              className="w-32 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
            />
          </form>
        )}
        {error && <p role="alert" className="mt-3 text-[14px] text-rose-300">{error}</p>}
        <button type="button" className={northCtaClass} disabled={saving} onClick={() => { if (composing) void spawn(); else setComposing(true); }}>
          {composing ? (saving ? 'Spawning…' : 'Save entity') : '+ Spawn entity'}
        </button>
      </div>
    </LensShell>
  );
}
