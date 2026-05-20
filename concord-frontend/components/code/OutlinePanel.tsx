'use client';

/**
 * OutlinePanel — VS Code Outline view. Lists the symbols of the active
 * file (functions, classes, methods, types); clicking jumps to the line.
 */

import { useCallback, useEffect, useState } from 'react';
import { Box, Braces, Hash, Loader2, Variable, FileCode } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Symbol { name: string; kind: string; line: number }

const KIND_ICON: Record<string, typeof Box> = {
  class: Box, interface: Braces, type: Hash, function: FileCode, method: FileCode, variable: Variable,
};
const KIND_COLOR: Record<string, string> = {
  class: 'text-amber-300', interface: 'text-violet-300', type: 'text-sky-300',
  function: 'text-blue-300', method: 'text-blue-300', variable: 'text-emerald-300',
};

export function OutlinePanel({
  projectId, path, onOpen,
}: { projectId: string | null; path: string | null; onOpen: (path: string, line: number) => void }) {
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId || !path) { setSymbols([]); return; }
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'code', action: 'symbols-outline', input: { projectId, path } });
      setSymbols((r.data?.result?.symbols || []) as Symbol[]);
    } catch (e) { console.error('[Outline] failed', e); }
    finally { setLoading(false); }
  }, [projectId, path]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="border-t border-white/10 flex flex-col" style={{ maxHeight: '40%' }}>
      <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-gray-500 font-semibold bg-white/[0.02]">
        Outline {symbols.length > 0 && `· ${symbols.length}`}
      </div>
      <div className="overflow-y-auto">
        {loading ? (
          <div className="p-2 text-[11px] text-gray-500"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Parsing…</div>
        ) : !path ? (
          <div className="p-2 text-[11px] text-gray-600 italic">Open a file to see its outline.</div>
        ) : symbols.length === 0 ? (
          <div className="p-2 text-[11px] text-gray-600 italic">No symbols found.</div>
        ) : (
          <ul>
            {symbols.map((s, i) => {
              const Icon = KIND_ICON[s.kind] || FileCode;
              return (
                <li key={i} onClick={() => onOpen(path, s.line)}
                  className="px-2 py-0.5 flex items-center gap-1.5 cursor-pointer hover:bg-white/[0.04]">
                  <Icon className={`w-3 h-3 shrink-0 ${KIND_COLOR[s.kind] || 'text-gray-400'}`} />
                  <span className="text-[11px] text-white truncate flex-1 font-mono">{s.name}</span>
                  <span className="text-[9px] text-gray-600">{s.line}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default OutlinePanel;
