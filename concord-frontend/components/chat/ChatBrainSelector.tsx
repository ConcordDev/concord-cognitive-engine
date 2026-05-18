'use client';

/**
 * ChatBrainSelector — surface concord's 5-brain routing per
 * conversation. Pick which brain answers — currently a UI signal
 * only; full per-conversation routing wiring lands in Sprint B.
 */

import { Brain, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export type BrainSlot = 'auto' | 'conscious' | 'subconscious' | 'utility' | 'repair' | 'multimodal';

interface Props {
  value: BrainSlot;
  onChange: (v: BrainSlot) => void;
  compact?: boolean;
}

const BRAINS: { value: BrainSlot; label: string; hint: string }[] = [
  { value: 'auto',         label: 'Auto',         hint: 'Router picks the best brain (default)' },
  { value: 'conscious',    label: 'Conscious',    hint: 'Deep reasoning, chat, council' },
  { value: 'subconscious', label: 'Subconscious', hint: 'Synthesis, dream, autogen' },
  { value: 'utility',      label: 'Utility',      hint: 'Quick + small tasks (fast)' },
  { value: 'repair',       label: 'Repair',       hint: 'Error detection + auto-fix' },
  { value: 'multimodal',   label: 'Vision',       hint: 'LLaVA — image + doc layout' },
];

export function ChatBrainSelector({ value, onChange, compact }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const current = BRAINS.find((b) => b.value === value) || BRAINS[0];
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-xs text-white/80"
        title={`Brain: ${current.label}`}
      >
        <Brain className="w-3 h-3 text-cyan-400" />
        {!compact && <span>{current.label}</span>}
        <ChevronDown className="w-3 h-3 text-white/40" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 w-56 bg-zinc-900 border border-white/10 rounded shadow-xl z-50 py-1">
          {BRAINS.map((b) => (
            <button
              key={b.value}
              onClick={() => { onChange(b.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-white/5 ${value === b.value ? 'bg-cyan-500/10 text-cyan-200' : 'text-white/80'}`}
            >
              <div className="font-medium">{b.label}</div>
              <div className="text-white/40 text-[10px]">{b.hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
