'use client';

/**
 * IntegrationsPanel — Slack-style workflow/bot integrations: a slash-command
 * registry and an app-message log. Wires message.command-{list,register,
 * remove,run} and message.app-messages-list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Terminal, Plus, Trash2, Play, Loader2, Bot } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SlashCommand {
  id?: string;
  name: string;
  description: string;
  appName?: string;
  responseTemplate?: string;
  builtin: boolean;
}
interface AppMessage {
  id: string;
  command: string;
  appName: string;
  body: string;
  ephemeral: boolean;
  ranBy: string;
  ts: string;
}

export function IntegrationsPanel({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [appMessages, setAppMessages] = useState<AppMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runText, setRunText] = useState('');
  const [running, setRunning] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftApp, setDraftApp] = useState('');
  const [draftTemplate, setDraftTemplate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cr, ar] = await Promise.all([
        lensRun('message', 'command-list', {}),
        lensRun('message', 'app-messages-list', { channelId }),
      ]);
      if (cr.data?.ok) setCommands((cr.data.result?.commands as SlashCommand[]) ?? []);
      if (ar.data?.ok) setAppMessages((ar.data.result?.appMessages as AppMessage[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { void load(); }, [load]);

  async function registerCommand() {
    if (!draftName.trim() || !draftDesc.trim()) { setError('name + description required'); return; }
    setError(null);
    const r = await lensRun('message', 'command-register', {
      name: draftName.trim(),
      description: draftDesc.trim(),
      appName: draftApp.trim() || undefined,
      responseTemplate: draftTemplate.trim() || undefined,
    });
    if (!r.data?.ok) { setError(r.data?.error ?? 'register failed'); return; }
    setDraftName(''); setDraftDesc(''); setDraftApp(''); setDraftTemplate(''); setShowNew(false);
    await load();
  }

  async function removeCommand(id: string) {
    await lensRun('message', 'command-remove', { id });
    await load();
  }

  async function runCommand() {
    const text = runText.trim();
    if (!text) return;
    setRunning(true);
    setError(null);
    try {
      const r = await lensRun('message', 'command-run', { channelId, text });
      if (!r.data?.ok) { setError(r.data?.error ?? 'command failed'); return; }
      setRunText('');
      await load();
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-gray-200">Integrations · #{channelName}</h2>
      </div>

      {error && <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1">{error}</div>}

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <div className="text-xs font-semibold text-gray-300 flex items-center gap-1"><Terminal className="w-3 h-3" /> Run a slash command</div>
        <div className="flex items-center gap-2">
          <input
            value={runText}
            onChange={(e) => setRunText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runCommand(); }}
            placeholder="/poll Lunch this Friday?"
            className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-white font-mono"
          />
          <button onClick={runCommand} disabled={running || !runText.trim()} className="px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white inline-flex items-center gap-1 disabled:opacity-50">
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center mb-1">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Commands</div>
          <button onClick={() => setShowNew((v) => !v)} className="ml-auto text-[11px] text-cyan-300 inline-flex items-center gap-0.5">
            <Plus className="w-3 h-3" /> Custom command
          </button>
        </div>
        {showNew && (
          <div className="rounded border border-cyan-500/20 bg-cyan-500/[0.04] p-2 space-y-1.5 mb-2">
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="/command-name" className="w-full px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white font-mono" />
            <input value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} placeholder="Description" className="w-full px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white" />
            <input value={draftApp} onChange={(e) => setDraftApp(e.target.value)} placeholder="App name (optional)" className="w-full px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white" />
            <input value={draftTemplate} onChange={(e) => setDraftTemplate(e.target.value)} placeholder="Response template — use {args}" className="w-full px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-white" />
            <button onClick={registerCommand} className="px-2 py-1 text-[10px] rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold">Register</button>
          </div>
        )}
        {loading ? (
          <p className="text-xs text-gray-500 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>
        ) : (
          <div className="space-y-1">
            {commands.map((c) => (
              <div key={c.id ?? c.name} className="group flex items-center gap-2 rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
                <span className="text-[11px] font-mono text-cyan-300">{c.name}</span>
                <span className="text-[11px] text-gray-400 flex-1 truncate">{c.description}</span>
                {c.builtin ? (
                  <span className="text-[9px] text-gray-600 uppercase">builtin</span>
                ) : (
                  <button onClick={() => c.id && removeCommand(c.id)} className="opacity-0 group-hover:opacity-100 text-rose-300" title="Remove">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">App messages</div>
        {appMessages.length === 0 ? (
          <p className="text-xs text-gray-600">No app messages yet. Run a command to post one.</p>
        ) : (
          <div className="space-y-1">
            {appMessages.slice().reverse().map((m) => (
              <div key={m.id} className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <Bot className="w-3 h-3 text-cyan-400" />
                  <span className="text-cyan-300 font-semibold">{m.appName}</span>
                  <span className="font-mono">{m.command}</span>
                  {m.ephemeral && <span className="text-amber-400">ephemeral</span>}
                  <span className="ml-auto">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="text-xs text-gray-200 mt-0.5 whitespace-pre-wrap">{m.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default IntegrationsPanel;
