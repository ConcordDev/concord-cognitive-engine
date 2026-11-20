'use client';

/**
 * "Answer as" — the one control for how Concord replies. It replaces four
 * overlapping systems (the rail modes, the AI-mode menu, the persona picker
 * and the separately-activated custom assistants). Every entry sets the two
 * things the send path actually uses: the request `mode` and the persona's
 * system prompt. Your own assistants (chat.assistants-list) come first.
 */

import { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Sparkles } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { AI_MODES, PERSONAS, type AIMode, type Persona } from '@/components/chat/ChatModeConfig';

export interface Assistant { id: string; name: string; description?: string; instructions: string; model?: string }
export interface AnswerAs { key: string; label: string; detail: string; mode: AIMode; persona: Persona; group: 'yours' | 'ways' | 'voices' }

const DEFAULT_PERSONA = PERSONAS[0];
const modeById = (id?: string) => AI_MODES.find((m) => m.id === id && m.id !== 'conkay') || AI_MODES[0];
/** A built-in voice's natural way of answering. */
const VOICE_MODE: Record<string, string> = { 'research-analyst': 'research', 'creative-writer': 'creative', 'code-expert': 'code' };

export function answerAsOptions(assistants: Assistant[]): AnswerAs[] {
  const yours = assistants.map((a) => ({
    key: `gpt-${a.id}`, label: a.name, detail: a.description || 'Your assistant', group: 'yours' as const,
    mode: modeById(a.model),
    persona: { id: `gpt-${a.id}`, name: a.name, icon: Bot, description: a.description || 'Custom assistant', systemPrompt: a.instructions },
  }));
  const ways = AI_MODES.filter((m) => m.id !== 'conkay').map((m) => ({
    key: `mode-${m.id}`, label: m.name, detail: m.description, group: 'ways' as const, mode: m, persona: DEFAULT_PERSONA,
  }));
  const voices = PERSONAS.filter((p) => p.id !== 'default').map((p) => ({
    key: `voice-${p.id}`, label: p.name, detail: p.description, group: 'voices' as const, mode: modeById(VOICE_MODE[p.id]), persona: p,
  }));
  return [...yours, ...ways, ...voices];
}

/** Which option the current (mode, persona) pair is. */
export function currentKey(mode: AIMode, persona: Persona): string {
  if (persona.id.startsWith('gpt-')) return persona.id;
  if (persona.id !== 'default') return `voice-${persona.id}`;
  return `mode-${mode.id}`;
}

export function AnswerAsPicker({ mode, persona, onPick, onConKay, open, onOpenChange }: {
  mode: AIMode;
  persona: Persona;
  onPick: (choice: { mode: AIMode; persona: Persona; label: string }) => void;
  onConKay: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void lensRun<{ assistants: Assistant[] }>('chat', 'assistants-list', {}).then((r) => { if (r.data?.ok) setAssistants(r.data.result?.assistants || []); }).catch(() => {});
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, onOpenChange]);

  const options = answerAsOptions(assistants);
  const key = currentKey(mode, persona);
  const label = persona.id !== 'default' ? persona.name : mode.name;
  const groups: { id: AnswerAs['group']; title: string }[] = [
    { id: 'yours', title: 'Your assistants' },
    { id: 'ways', title: 'Ways of answering' },
    { id: 'voices', title: 'Voices' },
  ];

  return (
    <div className="relative" ref={ref} data-chat-menu>
      <button type="button" className="nb-answer-as mx-1 mb-1" onClick={() => onOpenChange(!open)} aria-haspopup="menu" aria-expanded={open} data-testid="nb-answer-as" title="How Concord should answer" aria-label={`Answer as ${label}`}>
        <span className="hidden text-[color:var(--nb-muted,#71717a)] sm:inline">Answer as</span>
        <span className="font-medium">{label}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div role="menu" aria-label="Answer as" className="nb-menu nb-rise absolute bottom-full right-0 z-50 mb-2 max-h-[60vh] w-72 overflow-y-auto p-1.5">
          {groups.map((g) => {
            const list = options.filter((o) => o.group === g.id);
            if (!list.length) return null;
            return (
              <div key={g.id} className="py-1">
                <p className="nb-label px-2 pb-1">{g.title}</p>
                {list.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={o.key === key}
                    className="nb-menu-item flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--nb-wash,#f0f1ea)]"
                    onClick={() => { onPick({ mode: o.mode, persona: o.persona, label: o.label }); onOpenChange(false); }}
                  >
                    <span className="mt-0.5 w-3.5">{o.key === key && <Check className="h-3.5 w-3.5" />}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{o.label}</span>
                      <span className="block text-[11.5px] text-[color:var(--nb-muted,#71717a)]">{o.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
          <div className="border-t border-[color:var(--nb-rule,#dadcd3)] pt-1">
            <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--nb-wash,#f0f1ea)]" onClick={() => { onOpenChange(false); onConKay(); }}>
              <Sparkles className="h-3.5 w-3.5" /> Open ConKay <span className="ml-auto text-[11px] text-[color:var(--nb-muted,#71717a)]">its own lens</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
