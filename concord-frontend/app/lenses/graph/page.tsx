'use client';

/**
 * Graph lens per docs/lens-northstar/16: the canvas is the graph. GraphField
 * (live DTU lattice, find-a-node, + Add node) is the page. The deeper
 * perspectives — the Bloom explorer with analysis tools, Maps, Mind map,
 * Genome and the graph-tooling catalog — are full views under More, each
 * owning its own hooks as before.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { GraphField } from '@/components/graph/GraphField';
import { GraphBloomCanvas } from '@/components/graph/GraphBloomCanvas';
import { GraphParityPanel } from '@/components/graph/GraphParityPanel';
import { MindMapBuilder } from '@/components/graph/MindMapBuilder';
import { GraphRepos } from '@/components/graph/GraphRepos';
import KnowledgeGenomeBrowser from '@/components/visualizations/KnowledgeGenomeBrowser';

const PERSPECTIVES = [
  { id: 'explore', label: 'Explorer & analysis', key: '2' },
  { id: 'maps', label: 'Maps', key: '3' },
  { id: 'mindmap', label: 'Mind map', key: '4' },
  { id: 'genome', label: 'Genome', key: '5' },
  { id: 'catalog', label: 'Graph tooling', key: '6' },
] as const;

type GraphView = 'field' | (typeof PERSPECTIVES)[number]['id'];

function MoreMenu({ onPick }: { onPick: (v: GraphView) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-[13px] text-zinc-500 transition-colors hover:text-zinc-200" aria-haspopup="menu" aria-expanded={open}>
        More
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-52 rounded-xl border border-white/10 bg-[#141414] p-1 shadow-2xl">
          {PERSPECTIVES.map((p) => (
            <button key={p.id} role="menuitem" type="button" onClick={() => { setOpen(false); onPick(p.id); }}
              className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-50">
              <span className="flex-1">{p.label}</span>
              <kbd className="font-mono text-[11px] text-zinc-500">{p.key}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GraphLensPage() {
  useLensNav('graph');
  useLensIdentity('graph');
  const [view, setView] = useState<GraphView>('field');

  useLensCommand(
    [
      { id: 'graph-field', keys: '1', description: 'Graph field', category: 'navigation', action: () => setView('field') },
      ...PERSPECTIVES.map((p) => ({ id: `graph-${p.id}`, keys: p.key, description: p.label, category: 'navigation' as const, action: () => setView(p.id) })),
    ],
    { lensId: 'graph' },
  );

  const current = PERSPECTIVES.find((p) => p.id === view);

  return (
    <LensShell lensId="graph" asMain={false}>
      <div data-lens-theme="graph" className="relative min-h-full">
        <div className="absolute right-8 top-4 z-20">
          <MoreMenu onPick={setView} />
        </div>
        {view === 'field' ? (
          <GraphField />
        ) : (
          <div className="flex h-[calc(100vh-3rem)] flex-col px-8 pt-4">
            <button type="button" onClick={() => setView('field')} className="inline-flex w-fit items-center gap-1.5 text-[14px] text-zinc-500 transition-colors hover:text-zinc-200">
              <ArrowLeft className="h-4 w-4" />
              Graph
            </button>
            <h1 className="mb-4 mt-2 font-vault text-[2.25rem] leading-tight text-zinc-100">{current?.label}</h1>
            <div className="relative min-h-0 flex-1 overflow-auto">
              {view === 'explore' && <div className="absolute inset-0"><GraphBloomCanvas interactive /></div>}
              {view === 'maps' && <GraphParityPanel />}
              {view === 'mindmap' && <MindMapBuilder />}
              {view === 'genome' && <KnowledgeGenomeBrowser />}
              {view === 'catalog' && <GraphRepos />}
            </div>
          </div>
        )}
      </div>
    </LensShell>
  );
}
