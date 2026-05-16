'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users2, Loader2, Folder, Calendar } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Workspace { id: string; name?: string; description?: string; members?: { userId: string; role?: string }[]; dtuCount?: number; commentCount?: number; createdAt?: string; updatedAt?: string }

export function WorkspaceRoster() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const ws = useQuery({
    queryKey: ['collab-workspaces'],
    queryFn: async () => {
      const r = await apiHelpers.collab.listWorkspaces();
      const data = r.data as { workspaces?: Workspace[] } | Workspace[];
      return (Array.isArray(data) ? data : data.workspaces || []) as Workspace[];
    },
    refetchInterval: 30000,
  });

  const list = ws.data || [];
  const totalMembers = list.reduce((s, w) => s + (w.members?.length || 0), 0);
  const totalDtus = list.reduce((s, w) => s + (w.dtuCount || 0), 0);
  const totalComments = list.reduce((s, w) => s + (w.commentCount || 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Users2 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Collaboration workspaces</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/collab/workspaces · 30s poll</span>
        </div>
        {list.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-collab"
            title={`Workspaces snapshot — ${list.length} active`}
            content={`Workspaces: ${list.length}\nTotal members: ${totalMembers}\nTotal DTUs: ${totalDtus}\nTotal comments: ${totalComments}\n\n${list.slice(0, 20).map((w) => `  ${w.id.slice(0, 8)} · ${w.name || '(unnamed)'} · ${w.members?.length || 0} members · ${w.dtuCount || 0} dtus · ${w.commentCount || 0} comments`).join('\n')}`}
            extraTags={['collab', 'workspaces']}
            rawData={{ workspaces: list }}
          />
        )}
      </header>
      {ws.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Collab runtime unreachable.</div>}
      {ws.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Workspaces" value={list.length.toString()} />
        <Cell label="Members" value={totalMembers.toString()} />
        <Cell label="DTUs" value={totalDtus.toString()} />
        <Cell label="Comments" value={totalComments.toString()} />
      </div>
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {list.map((w) => (
          <div key={w.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Folder className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="text-sm text-white">{w.name || `Workspace ${w.id.slice(0, 6)}`}</span>
                </div>
                {w.description && <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-400">{w.description}</p>}
                <div className="mt-1 flex items-center gap-x-3 text-[10px] text-zinc-500">
                  <span>{w.members?.length || 0} members</span>
                  <span>{w.dtuCount || 0} dtus</span>
                  <span>{w.commentCount || 0} comments</span>
                  {w.updatedAt && <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" />{new Date(w.updatedAt).toLocaleDateString()}</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && !ws.isPending && !ws.isError && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">No collab workspaces yet.</div>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-cyan-300">{value}</div>
    </div>
  );
}
