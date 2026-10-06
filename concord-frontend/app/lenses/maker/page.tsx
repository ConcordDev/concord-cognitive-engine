'use client';

/**
 * Maker — one Retool/Twine/creative desk.
 * Thin shell: single `active` union → panels. Macros live in panels.
 */

import { useCallback, useState, type ComponentType } from 'react';
import { AppWindow, Wand2, Sparkles, Hammer, GitBranch, LayoutGrid, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { ProjectBuilder } from '@/components/maker/ProjectBuilder';
import { QuestGraphEditor } from '@/components/maker/QuestGraphEditor';
import { MakerShowcase } from '@/components/maker/MakerShowcase';
import { AppsPanel } from '@/components/maker/AppsPanel';
import { QuestsPanel } from '@/components/maker/QuestsPanel';
import { CreativePanel } from '@/components/maker/CreativePanel';

type MakerView = 'builder' | 'designer' | 'apps' | 'quests' | 'creative' | 'showcase';

const VIEWS: { id: MakerView; label: string; keys: string; title: string; hint: string; blurb: string; icon: typeof Hammer }[] = [
  { id: 'builder', label: 'Builder', keys: 'b', title: 'The make', hint: 'No-code app builder', blurb: 'Drag components onto a canvas, model data, bind sources, wire workflows, snapshot versions, and deploy. No code.', icon: Hammer },
  { id: 'designer', label: 'Quest Designer', keys: 'd', title: 'The branching path', hint: 'Quest node-graph designer', blurb: 'Author branching quests as a node graph (steps, choices, rewards and endings) and validate the structure.', icon: GitBranch },
  { id: 'apps', label: 'Apps', keys: 'a', title: 'What you have built', hint: 'Your apps', blurb: '', icon: AppWindow },
  { id: 'quests', label: 'Quests', keys: 'q', title: 'Quests in the world', hint: 'Quests', blurb: '', icon: Wand2 },
  { id: 'creative', label: 'Creative', keys: 'c', title: 'Generate something', hint: 'Creative generation', blurb: '', icon: Sparkles },
  { id: 'showcase', label: 'Showcase', keys: 's', title: 'What makers shipped', hint: 'Showcase', blurb: '', icon: LayoutGrid },
];

const PANELS: Record<MakerView, ComponentType> = {
  builder: ProjectBuilder,
  designer: QuestGraphEditor,
  apps: AppsPanel,
  quests: QuestsPanel,
  creative: CreativePanel,
  showcase: MakerShowcase,
};

export default function MakerLensPage() {
  useLensNav('maker');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<MakerView>('builder');

  const newMake = useCallback(() => {
    setActive('builder');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLInputElement>('[data-lens-theme="maker"] input[placeholder="New app name"]');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); return; }
      if (++tries < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `tab-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'maker-new', keys: 'n', description: 'New make (name a new app)', category: 'actions' as const, action: newMake },
    ],
    { lensId: 'maker' },
  );

  const Panel = PANELS[active];
  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="maker" asMain={false}>
      <FirstRunTour lensId="maker" />
      <DepthBadge lensId="maker" size="sm" className="ml-2" />
      <div data-lens-theme="maker" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Maker</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {current.title}{active === 'builder' && who ? `, ${who}` : ''}
        </h1>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Maker sections">
          {VIEWS.map(({ id, label, keys, hint, icon: Icon }) => {
            const on = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                aria-current={on ? 'page' : undefined}
                title={`${hint} (${keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{keys}</kbd>
              </button>
            );
          })}
        </nav>

        {current.blurb && <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-zinc-500">{current.blurb}</p>}
        <Panel />

        <CrossLensRecentsPanel lensId="maker" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={newMake}
          title="New make (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New make
        </button>
      </div>
    </LensShell>
  );
}
