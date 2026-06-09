'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Plus, Send, Loader2, Star, Mail, Phone } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Agent {
  id: string; name: string; brokerage: string; phone: string; email: string;
  rating: number; reviewCount: number;
}
interface Message {
  id: string; agentId: string; text: string; from: 'user' | 'agent'; timestamp: string;
  listingId: string | null;
}

export function AgentMessenger() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [addingAgent, setAddingAgent] = useState(false);
  const [agentForm, setAgentForm] = useState({ name: '', brokerage: '', email: '', phone: '', rating: '5' });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (activeAgent) loadMessages(activeAgent.id); }, [activeAgent]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'realestate', action: 'agents-list', input: {} });
      const list = (res.data?.result?.agents || []) as Agent[];
      setAgents(list);
      if (list.length > 0 && !activeAgent) setActiveAgent(list[0]);
    } catch (e) { console.error('[Agents] list failed', e); }
    finally { setLoading(false); }
  }

  async function loadMessages(agentId: string) {
    try {
      const res = await lensRun({ domain: 'realestate', action: 'messages-list', input: { agentId } });
      setMessages((res.data?.result?.messages || []) as Message[]);
    } catch (e) { console.error('[Messages] load failed', e); }
  }

  async function addAgent() {
    if (!agentForm.name.trim()) return;
    try {
      await lensRun({
        domain: 'realestate', action: 'agents-add',
        input: { name: agentForm.name.trim(), brokerage: agentForm.brokerage, email: agentForm.email, phone: agentForm.phone, rating: Number(agentForm.rating) || 5 },
      });
      setAgentForm({ name: '', brokerage: '', email: '', phone: '', rating: '5' });
      setAddingAgent(false);
      await refresh();
    } catch (e) { console.error('[Agents] add failed', e); }
  }

  async function send() {
    if (!activeAgent || !draft.trim()) return;
    try {
      await lensRun({ domain: 'realestate', action: 'agent-message', input: { agentId: activeAgent.id, text: draft.trim() } });
      setDraft('');
      await loadMessages(activeAgent.id);
    } catch (e) { console.error('[Messages] send failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Agents & messages</span>
        <button aria-label="Add" onClick={() => setAddingAgent(v => !v)} className="ml-auto p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      {addingAgent && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={agentForm.name} onChange={e => setAgentForm({ ...agentForm, name: e.target.value })} placeholder="Name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={agentForm.brokerage} onChange={e => setAgentForm({ ...agentForm, brokerage: e.target.value })} placeholder="Brokerage" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={agentForm.email} onChange={e => setAgentForm({ ...agentForm, email: e.target.value })} placeholder="Email" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={agentForm.phone} onChange={e => setAgentForm({ ...agentForm, phone: e.target.value })} placeholder="Phone" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={addAgent} className="col-span-5 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add agent</button>
        </div>
      )}

      <div className="flex" style={{ height: 360 }}>
        <aside className="w-48 border-r border-white/10 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
          ) : agents.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-gray-400">No agents yet</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {agents.map(a => (
                <li key={a.id}>
                  <button
                    onClick={() => setActiveAgent(a)}
                    className={cn('w-full text-left px-3 py-2 hover:bg-white/[0.03]', activeAgent?.id === a.id && 'bg-cyan-500/5')}
                  >
                    <div className="text-sm text-white truncate">{a.name}</div>
                    <div className="text-[10px] text-gray-400 truncate">{a.brokerage}</div>
                    <div className="text-[10px] text-amber-300 inline-flex items-center gap-0.5"><Star className="w-2.5 h-2.5 fill-amber-300" />{a.rating}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className="flex-1 flex flex-col">
          {activeAgent ? (
            <>
              <div className="px-4 py-2 border-b border-white/10 text-xs text-gray-300 flex items-center gap-3">
                <span className="text-white font-medium">{activeAgent.name}</span>
                {activeAgent.email && <span className="inline-flex items-center gap-1 text-gray-400"><Mail className="w-3 h-3" />{activeAgent.email}</span>}
                {activeAgent.phone && <span className="inline-flex items-center gap-1 text-gray-400"><Phone className="w-3 h-3" />{activeAgent.phone}</span>}
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.length === 0 ? (
                  <div className="text-center text-xs text-gray-400 pt-12">No messages yet — say hello.</div>
                ) : messages.map(m => (
                  <div key={m.id} className={cn('max-w-[80%] rounded-lg px-3 py-2 text-xs', m.from === 'user' ? 'ml-auto bg-cyan-500/15 text-cyan-100 border border-cyan-500/20' : 'bg-white/5 text-gray-100 border border-white/10')}>
                    <div>{m.text}</div>
                    <div className="mt-0.5 text-[9px] text-gray-400">{new Date(m.timestamp).toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-white/10 p-2 flex items-center gap-2">
                <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Type a message…" className="flex-1 px-3 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                <button aria-label="Send" type="submit" disabled={!draft.trim()} className="p-2 rounded bg-cyan-500 text-black hover:bg-cyan-400 disabled:opacity-40"><Send className="w-3.5 h-3.5" /></button>
              </form>
            </>
          ) : (
            <div className="flex items-center justify-center flex-1 text-xs text-gray-400">Select an agent to message</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentMessenger;
