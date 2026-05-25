'use client';

import { useEffect, useState } from 'react';
import { Mail, Loader2, Plus, Send, Inbox } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Patient { id: string; firstName: string; lastName: string; mrn: string }
interface Message {
  id: string; number: string; patientId: string;
  direction: 'from_patient' | 'to_patient';
  subject: string; body: string;
  sentAt: string; readAt: string | null;
  sender: string;
}

export function InboxPanel() {
  const [list, setList] = useState<Message[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ patientId: '', subject: '', body: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([
        lensRun({ domain: 'healthcare', action: 'messages-list', input: {} }),
        lensRun({ domain: 'healthcare', action: 'patients-list', input: {} }),
      ]);
      setList((m.data?.result?.messages || []) as Message[]);
      setPatients((p.data?.result?.patients || []) as Patient[]);
    } catch (e) { console.error('[Inbox] failed', e); }
    finally { setLoading(false); }
  }

  async function markRead(id: string) {
    try {
      await lensRun({ domain: 'healthcare', action: 'messages-mark-read', input: { id } });
      await refresh();
    } catch (e) { console.error('[Inbox] read', e); }
  }

  async function send() {
    if (!draft.patientId || !draft.body.trim()) return;
    try {
      await lensRun({ domain: 'healthcare', action: 'messages-send', input: { ...draft, direction: 'to_patient' } });
      setDraft({ patientId: '', subject: '', body: '' });
      setComposing(false);
      await refresh();
    } catch (e) { console.error('[Inbox] send', e); }
  }

  function nameFor(patientId: string): string {
    const p = patients.find(p => p.id === patientId);
    return p ? `${p.lastName}, ${p.firstName} (${p.mrn})` : patientId;
  }

  const unread = list.filter(m => m.direction === 'from_patient' && !m.readAt);
  const others = list.filter(m => !(m.direction === 'from_patient' && !m.readAt));

  return (
    <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Inbox className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">Inbox</span>
        <span className="text-[10px] text-rose-300">{unread.length} unread</span>
        <button onClick={() => setComposing(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Compose
        </button>
      </header>

      {composing && (
        <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
          <select value={draft.patientId} onChange={e => setDraft({ ...draft, patientId: e.target.value })} className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Patient *</option>
            {patients.map(p => <option key={p.id} value={p.id}>{p.lastName}, {p.firstName}</option>)}
          </select>
          <input value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} placeholder="Subject" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <textarea value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="Message body" rows={3} className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={send} className="col-span-12 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1">
            <Send className="w-3 h-3" />Send to patient
          </button>
        </div>
      )}

      <div className="max-h-[32rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Inbox className="w-6 h-6 mx-auto mb-2 opacity-30" />Inbox empty.</div>
        ) : (
          <>
            {unread.length > 0 && (
              <>
                <div className="px-4 py-1 bg-rose-500/[0.06] text-[10px] uppercase tracking-wider text-rose-300 font-semibold">Unread from patients</div>
                <MessageList list={unread} nameFor={nameFor} onMarkRead={markRead} />
              </>
            )}
            {others.length > 0 && (
              <>
                <div className="px-4 py-1 bg-white/[0.02] text-[10px] uppercase tracking-wider text-gray-400 font-semibold">All messages</div>
                <MessageList list={others} nameFor={nameFor} onMarkRead={markRead} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MessageList({ list, nameFor, onMarkRead }: { list: Message[]; nameFor: (id: string) => string; onMarkRead: (id: string) => void }) {
  return (
    <ul className="divide-y divide-white/5">
      {list.map(m => (
        <li key={m.id} className={cn('px-4 py-2.5 hover:bg-white/[0.02] flex items-start gap-3', !m.readAt && m.direction === 'from_patient' && 'bg-rose-500/[0.04]')}>
          <Mail className={cn('w-3.5 h-3.5 mt-0.5', m.direction === 'from_patient' ? (m.readAt ? 'text-gray-400' : 'text-rose-400') : 'text-cyan-400')} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono">{m.direction === 'from_patient' ? 'IN' : 'OUT'}</span>
              <span className="text-xs text-white truncate">{nameFor(m.patientId)}</span>
              {m.subject && <span className="text-[11px] text-gray-400">· {m.subject}</span>}
            </div>
            <div className="text-[11px] text-gray-300 truncate mt-0.5">{m.body}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{m.sentAt.slice(0, 16).replace('T', ' ')}</div>
          </div>
          {!m.readAt && m.direction === 'from_patient' && (
            <button onClick={() => onMarkRead(m.id)} className="text-[10px] text-cyan-300 hover:text-cyan-200">Mark read</button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default InboxPanel;
