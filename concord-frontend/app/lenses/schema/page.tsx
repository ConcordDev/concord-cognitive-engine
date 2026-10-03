'use client';

/**
 * Schema lens per docs/lens-northstar/18: the registry is a canvas of entity
 * cards; "+ New schema" is the one primary action. The versioned editor opens
 * from a card; the other tools (sample data, migrations, diff, evolution,
 * conformance, ER list, inference, GitHub tooling) live under More.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { SchemaRepos } from '@/components/schema/SchemaRepos';
import { SchemaWorkbench, type SchemaTab } from '@/components/schema/SchemaWorkbench';

type View = SchemaTab | 'tooling';

const TOOLS: { id: View; label: string }[] = [
  { id: 'registry', label: 'Registry list' },
  { id: 'sample', label: 'Sample data' },
  { id: 'migration', label: 'Migrations' },
  { id: 'diff', label: 'Diff versions' },
  { id: 'evolution', label: 'Evolution' },
  { id: 'conformance', label: 'Conformance' },
  { id: 'er', label: 'ER diagram' },
  { id: 'import', label: 'Infer from data' },
  { id: 'tooling', label: 'Schema tooling' },
];

const TITLES: Record<string, string> = {
  editor: 'Schema editor',
  tooling: 'Schema tooling',
  ...Object.fromEntries(TOOLS.map((t) => [t.id, t.label])),
};

function MoreMenu({ onPick }: { onPick: (v: View) => void }) {
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
          {TOOLS.map((t) => (
            <button key={t.id} role="menuitem" type="button" onClick={() => { setOpen(false); onPick(t.id); }}
              className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-50">
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SchemaLensPage() {
  useLensNav('schema');
  useLensIdentity('schema');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('canvas');
  const [newSignal, setNewSignal] = useState(0);

  const newSchema = () => setNewSignal((n) => n + 1);

  useLensCommand(
    [
      { id: 'schema-new', keys: 'n', description: 'New schema', category: 'action', action: newSchema },
      { id: 'schema-canvas', keys: '1', description: 'Schema canvas', category: 'navigation', action: () => setView('canvas') },
    ],
    { lensId: 'schema' },
  );

  const onCanvas = view === 'canvas';

  return (
    <LensShell lensId="schema" asMain={false}>
      <div data-lens-theme="schema" className="relative min-h-full px-8 pb-10 pt-6">
        <div className="absolute right-8 top-4 z-20">
          <MoreMenu onPick={setView} />
        </div>

        {onCanvas ? (
          <p className="text-[14px] text-zinc-500">Schema</p>
        ) : (
          <button type="button" onClick={() => setView('canvas')} className="inline-flex items-center gap-1.5 text-[14px] text-zinc-500 transition-colors hover:text-zinc-200">
            <ArrowLeft className="h-4 w-4" />
            Schema
          </button>
        )}
        <h1 className="mb-6 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {onCanvas ? `The shape of the data${who ? `, ${who}` : ''}` : (TITLES[view] ?? 'Schema')}
        </h1>

        {view === 'tooling' ? (
          <SchemaRepos />
        ) : (
          <SchemaWorkbench
            bare
            tab={view === 'tooling' ? undefined : view}
            onTabChange={(t) => setView(t)}
            newSignal={newSignal}
          />
        )}

        {onCanvas && (
          <button
            type="button"
            onClick={newSchema}
            title="New schema (N)"
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
          >
            <Plus className="h-4 w-4" />
            New schema
          </button>
        )}
      </div>
    </LensShell>
  );
}
