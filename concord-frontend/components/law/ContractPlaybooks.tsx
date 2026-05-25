'use client';

/**
 * ContractPlaybooks — guided drafting from pre-approved playbooks.
 * Applying a playbook drops a curated bundle of clauses onto a new or
 * existing contract. Backlog item 6. Wires law.playbook-list /
 * -detail / -apply.
 */

import { useEffect, useState } from 'react';
import { BookCheck, Loader2, ChevronRight, FilePlus2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PlaybookMeta {
  id: string; name: string; description: string; contractType: string; clauseCount: number;
}
interface PlaybookClause { category: string; title: string; text: string }
interface PlaybookDetail extends PlaybookMeta { clauses: PlaybookClause[] }

export function ContractPlaybooks({ onApplied }: { onApplied?: (contractId: string) => void }) {
  const [playbooks, setPlaybooks] = useState<PlaybookMeta[]>([]);
  const [detail, setDetail] = useState<PlaybookDetail | null>(null);
  const [title, setTitle] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void lensRun('law', 'playbook-list', {}).then((r) => {
      if (r.data?.ok) setPlaybooks((r.data.result.playbooks as PlaybookMeta[]) || []);
    });
  }, []);

  async function openDetail(id: string) {
    const r = await lensRun('law', 'playbook-detail', { id });
    if (r.data?.ok) { setDetail(r.data.result as PlaybookDetail); setTitle(''); setCounterparty(''); }
  }

  async function apply() {
    if (!detail) return;
    setBusy(true);
    const r = await lensRun('law', 'playbook-apply', {
      playbookId: detail.id,
      title: title.trim() || detail.name,
      counterparty: counterparty.trim() || undefined,
    });
    setBusy(false);
    if (r.data?.ok) {
      const id = r.data.result.contract?.id as string;
      setDetail(null);
      onApplied?.(id);
    }
  }

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <BookCheck className="w-4 h-4 text-neon-green" />
        <h2 className="font-semibold text-white">Contract Playbooks</h2>
        <span className="text-[10px] text-gray-400">guided drafting · pre-approved language</span>
      </div>

      {!detail ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {playbooks.length === 0 && <p className="text-xs text-gray-400 italic">No playbooks available.</p>}
          {playbooks.map((p) => (
            <button key={p.id} onClick={() => openDetail(p.id)}
              className="text-left bg-black/40 border border-white/10 rounded-lg p-3 hover:border-neon-green/30 transition-colors">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-semibold text-white flex-1">{p.name}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-gray-400 capitalize">{p.contractType}</span>
                <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
              </div>
              <p className="text-[10px] text-gray-400">{p.description}</p>
              <p className="text-[9px] text-neon-green mt-1">{p.clauseCount} pre-approved clauses</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-black/40 border border-neon-green/20 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white flex-1">{detail.name}</h3>
            <button onClick={() => setDetail(null)} className="text-[10px] text-gray-400 hover:text-white">Back</button>
          </div>
          <p className="text-[11px] text-gray-400">{detail.description}</p>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {detail.clauses.map((cl, i) => (
              <div key={i} className="bg-black/50 rounded px-2 py-1.5">
                <p className="text-xs font-semibold text-white">{cl.title}
                  <span className="text-[9px] text-gray-400 ml-1">{cl.category}</span></p>
                <p className="text-[10px] text-gray-400 line-clamp-2">{cl.text}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Contract title (default: ${detail.name})`}
              className="flex-1 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
            <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="Counterparty"
              className="w-40 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
            <button onClick={apply} disabled={busy}
              className={cn('px-3 py-1.5 text-xs rounded bg-neon-green text-black font-bold disabled:opacity-50 inline-flex items-center gap-1')}>
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FilePlus2 className="w-3 h-3" />}
              Create from playbook
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
