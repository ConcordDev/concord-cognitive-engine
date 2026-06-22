'use client';

// Phase DC13 — Bloodline tree viewer.
// Modal listening for `concordia:open-bloodline-tree` events with
// { npcId }. Recursively walks /api/bloodline/npc/:npcId via parents to
// render a 3-generation SVG tree.

import { useCallback, useEffect, useState } from 'react';
import { Network, X, Loader2 } from 'lucide-react';

interface Ancestry {
  npc_id: string;
  display_name?: string;
  mother_id?: string | null;
  father_id?: string | null;
  generation?: number;
}

interface TreeNode { id: string; name: string; mother?: TreeNode; father?: TreeNode; }

export function BloodlineTreeViewer() {
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [pending, setPending] = useState(false);

  const fetchAncestry = useCallback(async (npcId: string, depth: number): Promise<TreeNode | null> => {
    if (depth <= 0) return { id: npcId, name: npcId.slice(0, 12) };
    try {
      const j = await fetch(`/api/bloodline/npc/${npcId}`, { credentials: 'include' }).then(r => r.json());
      if (!j?.ok || !j.ancestry) return { id: npcId, name: npcId.slice(0, 12) };
      const a: Ancestry = j.ancestry;
      const [mother, father] = await Promise.all([
        a.mother_id ? fetchAncestry(a.mother_id, depth - 1) : null,
        a.father_id ? fetchAncestry(a.father_id, depth - 1) : null,
      ]);
      return {
        id: a.npc_id,
        name: a.display_name || a.npc_id.slice(0, 12),
        mother: mother || undefined,
        father: father || undefined,
      };
    } catch {
      return { id: npcId, name: npcId.slice(0, 12) };
    }
  }, []);

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { npcId?: string };
      if (!detail?.npcId) return;
      setOpen(true);
      setPending(true);
      const tree = await fetchAncestry(detail.npcId, 3);
      setRoot(tree);
      setPending(false);
    };
    window.addEventListener('concordia:open-bloodline-tree', handler);
    return () => window.removeEventListener('concordia:open-bloodline-tree', handler);
  }, [fetchAncestry]);

  if (!open) return null;

  return (
    <div className="concordia-hud-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur" onClick={() => setOpen(false)}>
      <div className="w-full max-w-2xl rounded-xl border border-amber-500/40 bg-zinc-950/95 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="mb-3 flex items-center justify-between border-b border-amber-500/20 pb-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-200">
            <Network size={14} /> Bloodline tree
          </h2>
          <button aria-label="Open" onClick={() => setOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
            <X size={14} />
          </button>
        </header>
        {pending ? (
          <div className="py-10 text-center"><Loader2 className="mx-auto animate-spin text-amber-400" size={24} /></div>
        ) : root ? (
          <TreeRender node={root} />
        ) : (
          <p className="text-center text-xs text-zinc-500">No ancestry data.</p>
        )}
      </div>
    </div>
  );
}

function TreeRender({ node }: { node: TreeNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-stretch gap-4">
        {node.father && <TreeRender node={node.father} />}
        {node.mother && <TreeRender node={node.mother} />}
      </div>
      {(node.father || node.mother) && (
        <div className="text-amber-300/50">↓</div>
      )}
      <div className="rounded border border-amber-500/30 bg-amber-950/30 px-2 py-1 text-center">
        <div className="text-xs font-mono text-amber-100">{node.name}</div>
        <div className="text-[9px] text-amber-300/60">{node.id.slice(0, 14)}</div>
      </div>
    </div>
  );
}
