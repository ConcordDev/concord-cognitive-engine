'use client';

/**
 * TreeDiagram — recursive hierarchy renderer for the many lenses that
 * need a tree surface: 5-whys / fishbone (root-cause analysis), proof
 * trees (inference/reasoning), org charts, skill trees, decision trees,
 * argument maps, schema trees.
 */

import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

export interface TreeNode {
  id: string;
  label: string;
  detail?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'info';
  children?: TreeNode[];
}

const TONE: Record<string, string> = {
  default: 'border-zinc-700 bg-zinc-900/60 text-zinc-200',
  good: 'border-emerald-700 bg-emerald-950/40 text-emerald-200',
  warn: 'border-amber-700 bg-amber-950/40 text-amber-200',
  bad: 'border-rose-700 bg-rose-950/40 text-rose-200',
  info: 'border-indigo-700 bg-indigo-950/40 text-indigo-200',
};

function Node({
  node, depth, onSelect,
}: {
  node: TreeNode;
  depth: number;
  onSelect?: (n: TreeNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const kids = node.children || [];
  return (
    <div className="relative">
      <div
        className="flex items-start gap-1.5 py-0.5"
        style={{ paddingLeft: depth * 18 }}
      >
        {kids.length > 0 ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-1 text-zinc-500 hover:text-zinc-200 shrink-0"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <button
          onClick={() => onSelect?.(node)}
          className={`text-left rounded-md border px-2 py-1 text-xs ${TONE[node.tone || 'default']} hover:brightness-125`}
        >
          <span className="font-medium">{node.label}</span>
          {node.detail && <span className="block text-[10px] opacity-70">{node.detail}</span>}
        </button>
      </div>
      {open && kids.map((c) => <Node key={c.id} node={c} depth={depth + 1} onSelect={onSelect} />)}
    </div>
  );
}

export function TreeDiagram({
  root,
  onSelect,
}: {
  root: TreeNode | TreeNode[] | null;
  onSelect?: (n: TreeNode) => void;
}) {
  const roots = !root ? [] : Array.isArray(root) ? root : [root];
  if (roots.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/40 py-8 text-xs text-zinc-600">
        No tree to display yet.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 overflow-x-auto">
      {roots.map((r) => <Node key={r.id} node={r} depth={0} onSelect={onSelect} />)}
    </div>
  );
}
