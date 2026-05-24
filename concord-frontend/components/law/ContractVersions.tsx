'use client';

/**
 * ContractVersions — visual version history with a line-level redline
 * diff between any saved version and the current contract text.
 * Backlog item 1. Wires law.contract-version-save / -list / -diff.
 */

import { useCallback, useEffect, useState } from 'react';
import { History, Save, GitCompare, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface VersionMeta {
  version: number; label: string; clauseCount: number;
  savedBy: string; savedAt: string; charCount: number;
}
interface DiffOp { op: 'same' | 'add' | 'remove'; text: string }
interface DiffResult {
  from: string; to: string; ops: DiffOp[];
  added: number; removed: number; unchanged: number;
}

export function ContractVersions({ contractId }: { contractId: string }) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [fromV, setFromV] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun('law', 'contract-version-list', { id: contractId });
    if (r.data?.ok) setVersions((r.data.result.versions as VersionMeta[]) || []);
  }, [contractId]);

  useEffect(() => { void load(); setDiff(null); setFromV(null); }, [load]);

  async function snapshot() {
    setBusy(true);
    const r = await lensRun('law', 'contract-version-save', { id: contractId, label: label.trim() || undefined });
    setBusy(false);
    if (r.data?.ok) { setLabel(''); await load(); }
  }

  async function showDiff(version: number) {
    setBusy(true); setFromV(version);
    const r = await lensRun('law', 'contract-diff', { id: contractId, fromVersion: version });
    setBusy(false);
    if (r.data?.ok) setDiff(r.data.result as DiffResult);
  }

  return (
    <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-amber-300" />
        <h3 className="text-sm font-semibold text-white">Version History &amp; Redline</h3>
      </div>
      <div className="flex gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Snapshot label (optional)"
          className="flex-1 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
        <button onClick={snapshot} disabled={busy}
          className="px-3 py-1.5 text-xs rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save version
        </button>
      </div>

      {versions.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic">No versions saved yet — save a snapshot to enable redline diff.</p>
      ) : (
        <ul className="space-y-1">
          {versions.map((v) => (
            <li key={v.version} className="flex items-center gap-2 bg-black/40 rounded px-2 py-1.5">
              <span className="text-[10px] font-bold text-amber-300">v{v.version}</span>
              <span className="text-xs text-white flex-1 truncate">{v.label}</span>
              <span className="text-[9px] text-gray-400">{v.clauseCount} clauses</span>
              <span className="text-[9px] text-gray-400">{new Date(v.savedAt).toLocaleDateString()}</span>
              <button onClick={() => showDiff(v.version)}
                className={cn('text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1',
                  fromV === v.version ? 'bg-neon-cyan/30 text-neon-cyan' : 'bg-white/10 text-gray-400 hover:bg-white/20')}>
                <GitCompare className="w-2.5 h-2.5" />Diff vs current
              </button>
            </li>
          ))}
        </ul>
      )}

      {diff && (
        <div className="border border-white/10 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 bg-black/50 px-2 py-1 text-[10px]">
            <span className="text-gray-400">{diff.from} → {diff.to}</span>
            <span className="text-neon-green">+{diff.added}</span>
            <span className="text-rose-400">−{diff.removed}</span>
            <span className="text-gray-600">{diff.unchanged} unchanged</span>
          </div>
          <pre className="max-h-64 overflow-auto text-[10px] font-mono leading-relaxed p-2 bg-black/30">
            {diff.ops.map((o, i) => (
              <div key={i} className={cn(
                o.op === 'add' && 'bg-neon-green/10 text-neon-green',
                o.op === 'remove' && 'bg-rose-500/10 text-rose-300 line-through',
                o.op === 'same' && 'text-gray-400',
              )}>
                <span className="select-none opacity-50 mr-1">
                  {o.op === 'add' ? '+' : o.op === 'remove' ? '−' : ' '}
                </span>
                {o.text || ' '}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}
