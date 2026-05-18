'use client';

/**
 * DocAgentPanel — right-tab page-bound agent surface. List + create
 * + chat + publish-as-DTU. Agents get the doc's content as context
 * per their capability set (read_doc, read_comments, read_database).
 */

import { useState, useEffect, useCallback } from 'react';
import { callDocsMacro } from '@/lib/api/docs';
import { Bot, Plus, Send, Loader2, Sparkles, X, Trash2, Upload } from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  description?: string | null;
  slot: string;
  dtu_id?: string | null;
  active: number;
  invocation_count: number;
  capabilities: string[];
}

interface Props { documentId: string; }

const CAPS = ['read_doc', 'read_comments', 'read_database', 'query_workspace'] as const;

export function DocAgentPanel({ documentId }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [active, setActive] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftCaps, setDraftCaps] = useState<string[]>(['read_doc']);
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callDocsMacro<{ agents?: Agent[] }>('agent_list', { documentId });
      setAgents(r?.agents || []);
    } catch (e) { console.error('agent_list', e); }
    finally { setLoading(false); }
  }, [documentId]);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!draftName.trim() || !draftPrompt.trim()) return;
    setBusy(true);
    try {
      await callDocsMacro('agent_create', {
        documentId, name: draftName, systemPrompt: draftPrompt, capabilities: draftCaps,
      });
      setCreating(false); setDraftName(''); setDraftPrompt(''); setDraftCaps(['read_doc']);
      load();
    } finally { setBusy(false); }
  }, [documentId, draftName, draftPrompt, draftCaps, load]);

  const run = useCallback(async () => {
    if (!active || !message.trim()) return;
    setBusy(true); setReply('');
    try {
      const r = await callDocsMacro<{ output?: string; reason?: string }>('agent_run', { id: active.id, message });
      if (r?.ok) setReply(r.output || '');
      else setReply(`Error: ${r?.reason || 'unknown'}`);
    } finally { setBusy(false); }
  }, [active, message]);

  const publish = useCallback(async (id: string) => {
    if (!confirm('Publish this agent as a marketplace-visible agent_spec DTU?')) return;
    setBusy(true);
    try {
      await callDocsMacro('agent_publish', { id });
      load();
    } finally { setBusy(false); }
  }, [load]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('Delete this page-bound agent?')) return;
    setBusy(true);
    try {
      await callDocsMacro('agent_delete', { id });
      if (active?.id === id) setActive(null);
      load();
    } finally { setBusy(false); }
  }, [load, active]);

  return (
    <div className="flex flex-col h-full">
      {!active && !creating && (
        <>
          <div className="p-2 border-b border-white/5 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-white/40 flex items-center gap-2">
              <Bot className="w-3.5 h-3.5" /> Page-bound agents
            </span>
            <button onClick={() => setCreating(true)} className="text-xs text-cyan-300 hover:text-cyan-200 flex items-center gap-1">
              <Plus className="w-3 h-3" /> New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading ? (
              <div className="flex items-center justify-center h-24 text-white/40">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : agents.length === 0 ? (
              <div className="text-xs text-white/40 text-center py-8">
                No agents yet. Create one to give this doc a custom AI.
              </div>
            ) : (
              agents.map((a) => (
                <div key={a.id} className="group p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer" onClick={() => setActive(a)}>
                  <div className="flex items-center gap-2">
                    <Bot className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-sm text-white font-medium flex-1 truncate">{a.name}</span>
                    {a.dtu_id && <span className="text-[10px] text-green-400">PUBLISHED</span>}
                    <button
                      onClick={(e) => { e.stopPropagation(); remove(a.id); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-xs text-white/40 mt-0.5">
                    {a.slot} · {a.capabilities.length} caps · {a.invocation_count} runs
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {creating && (
        <div className="p-3 space-y-2 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">New page-bound agent</span>
            <button onClick={() => setCreating(false)} className="p-1 rounded hover:bg-white/10 text-white/60">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Agent name"
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
          />
          <textarea
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            placeholder="System prompt — e.g. 'You are this doc's editor. Suggest improvements.'"
            rows={6}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-white resize-none"
          />
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-white/40">Capabilities</div>
            {CAPS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftCaps.includes(c)}
                  onChange={(e) => setDraftCaps((prev) => e.target.checked ? [...prev, c] : prev.filter((x) => x !== c))}
                  className="accent-cyan-400"
                />
                {c}
              </label>
            ))}
          </div>
          <button
            onClick={create}
            disabled={busy || !draftName.trim() || !draftPrompt.trim()}
            className="w-full py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Create agent'}
          </button>
        </div>
      )}

      {active && (
        <div className="flex flex-col h-full">
          <div className="p-2 border-b border-white/5 flex items-center gap-2">
            <button onClick={() => setActive(null)} className="text-xs text-white/60 hover:text-white">
              ← back
            </button>
            <span className="text-sm font-semibold text-white flex-1 truncate">{active.name}</span>
            {!active.dtu_id && (
              <button
                onClick={() => publish(active.id)}
                className="text-xs px-2 py-0.5 rounded bg-green-500/10 hover:bg-green-500/20 text-green-300 flex items-center gap-1"
                title="Publish as agent_spec DTU"
              >
                <Upload className="w-3 h-3" /> publish
              </button>
            )}
          </div>
          {reply && (
            <div className="p-2 border-b border-white/5 bg-cyan-500/5 text-sm text-white/90 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {reply}
            </div>
          )}
          <div className="flex-1" />
          <div className="p-2 border-t border-white/5 flex gap-1">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); }}
              placeholder={`Ask ${active.name}…`}
              rows={2}
              className="flex-1 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white resize-none"
            />
            <button
              onClick={run}
              disabled={busy || !message.trim()}
              className="px-3 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 self-end"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
