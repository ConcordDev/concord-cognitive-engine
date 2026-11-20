'use client';

/** ⌘P opens files, ⌘⇧P runs commands. One list, filtered as you type, driven entirely by the keyboard. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface Command { id: string; label: string; hint?: string; kbd?: string; run: () => void; disabled?: boolean }

function score(q: string, s: string): number {
  if (!q) return 1;
  const a = q.toLowerCase(), b = s.toLowerCase();
  if (b.includes(a)) return 100 - b.indexOf(a);
  let i = 0;
  for (const ch of b) if (ch === a[i]) i++;
  return i === a.length ? 10 : 0;
}

export function Palette({ mode, files, commands, onOpenFile, onClose }: { mode: 'files' | 'commands'; files: string[]; commands: Command[]; onOpenFile: (p: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(mode === 'commands' ? '>' : '');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const isCmd = q.startsWith('>');
  const term = isCmd ? q.slice(1).trim() : q.trim();
  const items = useMemo(() => {
    if (isCmd) return commands.map((c) => ({ c, s: score(term, c.label) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 30).map((x) => ({ key: x.c.id, label: x.c.label, hint: x.c.hint, kbd: x.c.kbd, disabled: x.c.disabled, go: x.c.run }));
    return files.map((f) => ({ f, s: Math.max(score(term, f.split('/').pop() || f) + 5, score(term, f)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 30).map((x) => ({ key: x.f, label: x.f.split('/').pop() || x.f, hint: x.f, kbd: undefined, disabled: false, go: () => onOpenFile(x.f) }));
  }, [isCmd, term, commands, files, onOpenFile]);
  useEffect(() => { setI(0); }, [q]);

  const choose = (n: number) => { const it = items[n]; if (!it || it.disabled) return; onClose(); it.go(); };

  return (
    <div className="pf-scrim fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]" onMouseDown={onClose} role="presentation">
      <div className="pf-palette w-full max-w-lg overflow-hidden" role="dialog" aria-modal="true" aria-label={isCmd ? 'Commands' : 'Open file'} onMouseDown={(e) => e.stopPropagation()} data-testid="pf-palette">
        <input
          ref={input}
          className="pf-mono h-10 w-full border-b pf-rule bg-transparent px-3 text-[13px] outline-none placeholder:text-[color:var(--pf-faint)]"
          placeholder={isCmd ? '> command' : 'Go to file  ( > for commands )'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(i); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          role="combobox"
          aria-expanded
          aria-controls="pf-palette-list"
          aria-activedescendant={items[i] ? `pf-pal-${i}` : undefined}
          aria-label={isCmd ? 'Command' : 'File name'}
        />
        <ul id="pf-palette-list" role="listbox" className="pf-scroll max-h-80 overflow-y-auto py-1">
          {items.map((it, n) => (
            <li key={it.key} id={`pf-pal-${n}`} role="option" aria-selected={n === i} aria-disabled={it.disabled}>
              <button type="button" className={cn('flex w-full items-center gap-3 px-3 py-1.5 text-left text-[12.5px]', n === i ? 'bg-[var(--pf-ink-4)]' : '', it.disabled && 'opacity-40')} onMouseEnter={() => setI(n)} onClick={() => choose(n)}>
                <span className="min-w-0 flex-1 truncate">{it.label}{it.hint && it.hint !== it.label && <span className="pf-mono ml-2 text-[11px] pf-faint">{it.hint}</span>}</span>
                {it.kbd && <span className="pf-kbd">{it.kbd}</span>}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-3 py-3 text-[12px] pf-faint">No match.</li>}
        </ul>
      </div>
    </div>
  );
}
