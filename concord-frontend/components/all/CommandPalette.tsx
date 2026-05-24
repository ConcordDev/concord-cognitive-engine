'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Command, Loader2, CornerDownLeft, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { getLensById } from '@/lib/lens-registry';

interface CommandEntry {
  kind: string;
  id: string;
  domain: string;
  action: string;
  label: string;
  path: string;
}
interface CommandIndexResult { commands: CommandEntry[]; total: number; indexed: number }

/**
 * CommandPalette — a fuzzy command-palette overlay over the runtime macro
 * registry (`all.command-index`). Lets the user jump straight to a lens
 * action, not just a lens. Server-side fuzzy filter; arrow-nav + Enter.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [indexed, setIndexed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (q: string) => {
    setLoading(true);
    const r = await lensRun<CommandIndexResult>('all', 'command-index', { query: q.trim() });
    if (r.data?.ok && r.data.result) {
      setCommands(r.data.result.commands || []);
      setIndexed(r.data.result.indexed || 0);
    }
    setLoading(false);
    setActive(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    void run('');
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, run]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void run(query), 160);
    return () => clearTimeout(t);
  }, [query, open, run]);

  const choose = useCallback((cmd: CommandEntry | undefined) => {
    if (!cmd) return;
    onClose();
    const lens = getLensById(cmd.domain);
    router.push(`${lens?.path || cmd.path}?action=${encodeURIComponent(cmd.action)}`);
  }, [router, onClose]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, commands.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(commands[active]); }
  }, [commands, active, choose, onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/70 backdrop-blur-sm pt-[12vh] px-4"
      onClick={onClose}
      role="presentation" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className="w-full max-w-xl rounded-xl border border-neon-cyan/30 bg-lattice-void shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center gap-2 border-b border-lattice-border px-3 py-2.5">
          <Search className="w-4 h-4 text-neon-cyan shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to any lens action…"
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
          />
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
          <kbd className="text-[10px] text-gray-400 border border-lattice-border rounded px-1">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {commands.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">
              {loading ? 'Searching…' : indexed === 0 ? 'Command index not available yet.' : 'No matching actions.'}
            </div>
          ) : (
            commands.map((cmd, idx) => {
              const lens = getLensById(cmd.domain);
              const Icon = lens?.icon;
              return (
                <button
                  key={cmd.id}
                  type="button"
                  data-cmd-idx={idx}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => choose(cmd)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left ${idx === active ? 'bg-neon-cyan/10' : ''}`}
                >
                  {Icon ? <Icon className="w-4 h-4 text-neon-cyan shrink-0" /> : <Command className="w-4 h-4 text-neon-cyan shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-white truncate">{cmd.action}</span>
                    <span className="block text-[11px] text-gray-400 truncate">{lens?.name || cmd.domain}</span>
                  </span>
                  {idx === active && <CornerDownLeft className="w-3.5 h-3.5 text-neon-cyan shrink-0" />}
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between border-t border-lattice-border px-3 py-1.5 text-[10px] text-gray-400">
          <span>{commands.length} of {indexed} actions</span>
          <span>↑↓ navigate · ↵ open · Esc close</span>
        </div>
      </div>
    </div>
  );
}
