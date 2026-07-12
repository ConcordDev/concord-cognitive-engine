'use client';

// OutlineView — real nested parent/child note structure (RemNote/Roam-shape
// outliner), built on the understanding.move/reorder/outline macros. Every
// interaction here is a real backend mutation, not a client-only reorder:
// indent/outdent call `understanding.move`, up/down call
// `understanding.reorder`, and the tree itself is `understanding.outline`'s
// real response — no client-invented nesting.

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  ChevronRight, ChevronDown, FileText, Loader2, ArrowRight, ArrowLeft,
  ArrowUp, ArrowDown, Clock, RefreshCw,
} from 'lucide-react';

export interface OutlineNode {
  id: string;
  title: string;
  tags: string[];
  updatedAt: string;
  srsEnabled: boolean;
  childCount: number;
  children: OutlineNode[];
}

export function OutlineView({ onOpenNote }: { onOpenNote: (id: string) => void }) {
  const [forest, setForest] = useState<OutlineNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await lensRun<{ forest: OutlineNode[]; rootCount: number }>('understanding', 'outline', {});
      if (r.data?.ok && r.data.result) {
        setForest(r.data.result.forest);
        // Expand root nodes by default so the tree isn't collapsed-flat on first load.
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const n of r.data!.result!.forest) next.add(n.id);
          return next;
        });
      } else {
        setError(r.data?.error || 'load failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Flatten the forest into (node, parentId, siblings) triples so indent/
  // outdent/reorder can find a node's real parent and sibling list without
  // re-walking the tree on every click.
  function findContext(
    nodes: OutlineNode[], id: string, parent: OutlineNode | null,
  ): { node: OutlineNode; parent: OutlineNode | null; siblings: OutlineNode[]; index: number } | null {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx >= 0) return { node: nodes[idx], parent, siblings: nodes, index: idx };
    for (const n of nodes) {
      const found = findContext(n.children, id, n);
      if (found) return found;
    }
    return null;
  }

  async function indent(id: string) {
    const ctx = findContext(forest, id, null);
    if (!ctx || ctx.index === 0) return; // no previous sibling to become a child of
    const newParent = ctx.siblings[ctx.index - 1];
    setBusyId(id);
    try {
      await lensRun('understanding', 'move', { id, parentId: newParent.id });
      await refresh();
      setExpanded((prev) => new Set(prev).add(newParent.id));
    } finally {
      setBusyId(null);
    }
  }

  async function outdent(id: string) {
    const ctx = findContext(forest, id, null);
    if (!ctx || !ctx.parent) return; // already root-level
    setBusyId(id);
    try {
      // Reparent to the grandparent (or root if the parent was itself root-level).
      const grandCtx = findContext(forest, ctx.parent.id, null);
      const grandparentId = grandCtx?.parent?.id ?? '';
      await lensRun('understanding', 'move', { id, parentId: grandparentId });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function moveSibling(id: string, dir: -1 | 1) {
    const ctx = findContext(forest, id, null);
    if (!ctx) return;
    const targetIndex = ctx.index + dir;
    if (targetIndex < 0 || targetIndex >= ctx.siblings.length) return;
    setBusyId(id);
    try {
      await lensRun('understanding', 'reorder', { id, index: targetIndex });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-white/40">
          Nested note structure. <kbd className="text-[9px] border border-white/20 rounded px-1">→</kbd> indent under previous sibling ·
          <kbd className="text-[9px] border border-white/20 rounded px-1 ml-1">←</kbd> outdent ·
          <kbd className="text-[9px] border border-white/20 rounded px-1 ml-1">↑↓</kbd> reorder
        </p>
        <button
          onClick={refresh}
          className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {error && <p className="text-sm text-rose-400 mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-white/60 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : forest.length === 0 ? (
        <p className="text-white/50 text-sm">No notes yet. Create one in the Notes tab to start an outline.</p>
      ) : (
        <ul className="space-y-0.5">
          {forest.map((n) => (
            <OutlineRow
              key={n.id}
              node={n}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              onOpen={onOpenNote}
              onIndent={indent}
              onOutdent={outdent}
              onMove={moveSibling}
              busyId={busyId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function OutlineRow({
  node, depth, expanded, onToggle, onOpen, onIndent, onOutdent, onMove, busyId,
}: {
  node: OutlineNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  busyId: string | null;
}) {
  const isOpen = expanded.has(node.id);
  const busy = busyId === node.id;
  return (
    <li>
      <div
        className="group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white/5"
        style={{ paddingLeft: `${depth * 18 + 4}px` }}
      >
        {node.childCount > 0 ? (
          <button onClick={() => onToggle(node.id)} className="text-white/40 hover:text-white flex-shrink-0" aria-label={isOpen ? 'Collapse' : 'Expand'}>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <button
          onClick={() => onOpen(node.id)}
          className="flex-1 min-w-0 text-left text-sm text-white/90 hover:text-violet-300 truncate inline-flex items-center gap-1.5"
        >
          <FileText className="w-3 h-3 text-white/30 flex-shrink-0" />
          {node.title}
          {node.srsEnabled && (
            <span title="In review queue" className="inline-flex flex-shrink-0">
              <Clock className="w-3 h-3 text-amber-300" />
            </span>
          )}
        </button>
        <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5 flex-shrink-0">
          {busy ? <Loader2 className="w-3 h-3 animate-spin text-white/40" /> : (
            <>
              <button onClick={() => onMove(node.id, -1)} className="p-0.5 text-white/30 hover:text-white" aria-label="Move up"><ArrowUp className="w-3 h-3" /></button>
              <button onClick={() => onMove(node.id, 1)} className="p-0.5 text-white/30 hover:text-white" aria-label="Move down"><ArrowDown className="w-3 h-3" /></button>
              <button onClick={() => onOutdent(node.id)} className="p-0.5 text-white/30 hover:text-white" aria-label="Outdent"><ArrowLeft className="w-3 h-3" /></button>
              <button onClick={() => onIndent(node.id)} className="p-0.5 text-white/30 hover:text-white" aria-label="Indent"><ArrowRight className="w-3 h-3" /></button>
            </>
          )}
        </div>
      </div>
      {isOpen && node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <OutlineRow
              key={c.id}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
              onIndent={onIndent}
              onOutdent={onOutdent}
              onMove={onMove}
              busyId={busyId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
