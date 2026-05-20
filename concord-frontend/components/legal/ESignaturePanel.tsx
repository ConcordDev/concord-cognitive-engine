'use client';

import { useEffect, useState } from 'react';
import { Mail, Loader2, CheckCircle, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Recipient {
  id: string; name: string; email: string; role: string;
  status: 'pending' | 'signed'; signedAt: string | null;
}
interface Envelope {
  id: string; number: string;
  documentId: string; documentName: string;
  matterId: string;
  recipients: Recipient[];
  status: 'sent' | 'completed';
  sentAt: string; completedAt: string | null;
}

export function ESignaturePanel() {
  const [list, setList] = useState<Envelope[]>([]);
  const [filter, setFilter] = useState<'all' | 'sent' | 'completed'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, [filter]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'legal', action: 'esign-envelopes-list', input: filter === 'all' ? {} : { status: filter } });
      setList((r.data?.result?.envelopes || []) as Envelope[]);
    } catch (e) { console.error('[Esign] list failed', e); }
    finally { setLoading(false); }
  }

  async function recipientSign(envelopeId: string, recipientId: string) {
    try {
      await lensRun({ domain: 'legal', action: 'esign-envelope-sign', input: { envelopeId, recipientId, ip: window.location.host, userAgent: navigator.userAgent } });
      await refresh();
    } catch (e) { console.error('[Esign] sign failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Mail className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-gray-200">E-signature envelopes</span>
        <span className="text-[10px] text-gray-500">{list.length}</span>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="ml-auto text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="all">All</option>
          <option value="sent">Awaiting signatures</option>
          <option value="completed">Completed</option>
        </select>
      </header>

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Mail className="w-6 h-6 mx-auto mb-2 opacity-30" />No envelopes yet. Generate a document and send it for signature.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(env => (
              <li key={env.id} className="px-4 py-3 hover:bg-white/[0.02]">
                <div className="flex items-center gap-2 mb-1.5">
                  <Mail className={cn('w-3.5 h-3.5', env.status === 'completed' ? 'text-emerald-400' : 'text-amber-400')} />
                  <span className="font-mono text-[10px] text-gray-500">{env.number}</span>
                  <span className="text-sm text-white truncate flex-1">{env.documentName}</span>
                  <span className={cn(
                    'text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                    env.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300',
                  )}>{env.status}</span>
                </div>
                <div className="text-[10px] text-gray-500 mb-1.5">Sent {env.sentAt.slice(0, 10)} · {env.recipients.length} recipient(s){env.completedAt && ` · completed ${env.completedAt.slice(0, 10)}`}</div>
                <ul className="space-y-1 pl-4">
                  {env.recipients.map(r => (
                    <li key={r.id} className="flex items-center gap-2 text-xs">
                      {r.status === 'signed' ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <Clock className="w-3 h-3 text-amber-400" />}
                      <span className="text-white">{r.name}</span>
                      <span className="text-gray-500">{r.email}</span>
                      <span className="text-[10px] text-gray-500">· {r.role}</span>
                      {r.status === 'signed' ? (
                        <span className="ml-auto text-[10px] text-emerald-300">signed {r.signedAt?.slice(0, 10)}</span>
                      ) : (
                        <button onClick={() => recipientSign(env.id, r.id)} className="ml-auto px-2 py-0.5 text-[10px] rounded bg-amber-500 text-black font-bold hover:bg-amber-400">
                          Simulate sign
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ESignaturePanel;
