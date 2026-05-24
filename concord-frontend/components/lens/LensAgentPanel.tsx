'use client';

/**
 * LensAgentPanel — Sprint 15
 *
 * Reusable Agent Mode panel any lens can mount to reach chat-lens
 * baseline depth. Same substrate as `/lenses/chat`'s AgentModePanel
 * but parameterised by lensId + custom lens-specific system prompt
 * preamble, so the agent knows what surface it's operating in and
 * which lens-specific tools / DTU corpus to favor.
 *
 * Mount in any lens:
 *
 *   <LensAgentPanel
 *     lensId="studio"
 *     lensPrompt="You're inside Concord's Studio lens — the DAW.
 *       Prefer audio_engine + music tools. The user is composing."
 *     open={agentOpen}
 *     onClose={() => setAgentOpen(false)}
 *   />
 *
 * Plus a launcher button somewhere in the lens header / FAB position:
 *
 *   <button onClick={() => setAgentOpen(true)}>Agent Mode</button>
 *
 * Capabilities baked in (chat-lens parity):
 *   - chat_agent.do tool-use loop (200+ lens actions + web + compute +
 *     browse_url + browser_act + create_dtu + expert_mode + generate_image
 *     + generate_video + mcp_call)
 *   - BYO model picker per message (Sprint 10 router)
 *   - Voice input via Web Speech API
 *   - Streaming via /api/chat-agent/stream when available
 *   - Inline tool-call cards + artifact rendering (DTU links, image
 *     base64, video URLs)
 *   - Provider chip (Claude/GPT/Grok/Gemini/Ollama)
 *   - Per-lens system prompt injection
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Bot, Send, X, Loader2, ExternalLink, Mic, MicOff, Cpu,
  Search, Calculator, Globe, Layers, FileText, Sparkles,
  CheckCircle2, XCircle, Hammer, MessageSquare, Paperclip,
} from 'lucide-react';

// Sprint 16 — the missing 30% to reach true chat-lens parity:
//   - Marathon tab (hours-long sessions)
//   - File uploads (drag-drop, attach to agent message)
//   - Streaming (token + tool-call cards appear progressively)
// All three lazy-loaded.
const MarathonPanel = dynamic(() => import('../chat/MarathonPanel'), { ssr: false });

type SpeechRecognitionType = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { results: { transcript: string }[][] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

interface ToolCall {
  tool: string;
  ok: boolean;
  query?: string;
  url?: string;
  title?: string;
  key?: string;
  dtuId?: string;
  citationsRecorded?: number;
  artifact?: Artifact;
  error?: string;
}

interface Artifact {
  kind: string;
  id?: string;
  title?: string;
  source?: string;
  prompt?: string;
  image_b64?: string;
  jobId?: string;
  url?: string;
  status?: string;
}

interface AgentResponse {
  ok: boolean;
  answer?: string;
  toolCalls?: ToolCall[];
  artifacts?: Artifact[];
  turns?: number;
  provider?: string;
  model?: string;
  error?: string;
}

interface Turn {
  user: string;
  agent: AgentResponse;
}

interface LensAgentPanelProps {
  lensId: string;
  lensPrompt?: string;
  open: boolean;
  onClose: () => void;
  /** Float position. Defaults to right-side slide-over. */
  position?: 'right' | 'bottom';
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  web_search: Search,
  run_compute: Calculator,
  browse_url: Globe,
  browser_act: Globe,
  run_lens_action: Layers,
  create_dtu: FileText,
  expert_mode: Sparkles,
  generate_image: FileText,
  generate_video: FileText,
  mcp_call: Layers,
  mcp_list: Layers,
};

function providerBadge(provider: string | undefined, model: string | undefined): { label: string; color: string } | null {
  if (!provider || provider === 'concord_default') {
    return { label: 'Concord (free Ollama)', color: 'bg-zinc-700 text-zinc-200' };
  }
  const labels: Record<string, string> = { anthropic: 'Claude', openai: 'GPT', xai: 'Grok', google: 'Gemini' };
  const colors: Record<string, string> = {
    anthropic: 'bg-orange-600/85 text-orange-50',
    openai: 'bg-emerald-600/85 text-emerald-50',
    xai: 'bg-zinc-700 text-zinc-100',
    google: 'bg-blue-600/85 text-blue-50',
  };
  const short = model?.replace(/^(claude|gpt|grok|gemini)-?/i, '') || '';
  return { label: `${labels[provider] || provider}${short ? ` · ${short}` : ''}`, color: colors[provider] || 'bg-zinc-700' };
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const Icon = TOOL_ICONS[call.tool] || Bot;
  const summary = call.query || call.url || call.key || call.title || '';
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2 rounded-lg ring-1 ${
      call.ok ? 'bg-zinc-900/70 ring-zinc-800' : 'bg-red-950/30 ring-red-900/50'
    }`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-zinc-400" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-300">{call.tool}</span>
          {call.ok ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <XCircle className="w-3 h-3 text-red-500" />}
        </div>
        {summary && <div className="text-xs text-zinc-400 truncate" title={summary}>{summary}</div>}
        {call.error && <div className="text-[11px] text-red-400 mt-0.5">{call.error}</div>}
        {call.dtuId && (
          <a href={`/lenses/dtu?id=${encodeURIComponent(call.dtuId)}`} className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 mt-0.5">
            open DTU <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function LensAgentPanel({ lensId, lensPrompt, open, onClose, position = 'right' }: LensAgentPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversation, setConversation] = useState<Turn[]>([]);
  const [slot, setSlot] = useState('conscious');
  const [listening, setListening] = useState(false);
  const recogRef = useRef<SpeechRecognitionType | null>(null);
  // Sprint 16 — tab between Quick (single-question agent) and Marathon
  // (persistent hours-long session).
  const [tab, setTab] = useState<'quick' | 'marathon'>('quick');
  // Sprint 16 — file uploads attached to the next message. Each file is
  // uploaded via /api/artifact/upload immediately on selection so the
  // agent receives a stable URL to read.
  const [attachments, setAttachments] = useState<Array<{ name: string; url: string }>>([]);
  // Sprint 16 — streaming via /api/chat-agent/stream. Off by default to
  // preserve the existing blocking behavior for compatibility; opt-in
  // toggle in the footer.
  const [streaming, setStreaming] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPickFile = useCallback(async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('lens', lensId);
    try {
      const r = await fetch('/api/artifact/upload', {
        method: 'POST', credentials: 'include', body: fd,
      });
      if (r.ok) {
        const j = await r.json();
        const url = j?.url || j?.path || j?.artifact?.url || '';
        if (url) {
          setAttachments(a => [...a, { name: file.name, url }]);
        }
      }
    } catch { /* upload failed silently */ }
  }, [lensId]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    for (const f of Array.from(e.dataTransfer.files || [])) onPickFile(f);
  }, [onPickFile]);

  const startListening = useCallback(() => {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionType; webkitSpeechRecognition?: new () => SpeechRecognitionType };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) { alert('Voice input not supported in this browser.'); return; }
    const recog = new Ctor();
    recog.continuous = false;
    recog.interimResults = true;
    recog.lang = 'en-US';
    recog.onresult = (ev) => {
      const text = Array.from(ev.results).map((r) => r[0]?.transcript || '').join(' ');
      setPrompt(text);
    };
    recog.onerror = () => setListening(false);
    recog.onend = () => setListening(false);
    recog.start();
    recogRef.current = recog;
    setListening(true);
  }, []);

  const stopListening = useCallback(() => {
    try { recogRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  }, []);

  useEffect(() => () => { try { recogRef.current?.stop(); } catch { /* noop */ } }, []);

  const submit = useCallback(async () => {
    if (!prompt.trim() || busy) return;
    const userMsg = prompt.trim();
    const attachedNote = attachments.length > 0
      ? `\n\nAttached files (use browse_url or vision tools to read):\n${attachments.map(a => `- ${a.name}: ${a.url}`).join('\n')}`
      : '';
    setPrompt('');
    setAttachments([]);
    setBusy(true);
    setConversation(c => [...c, { user: userMsg + (attachedNote ? ` (+${attachments.length} files)` : ''), agent: { ok: false } }]);
    try {
      const history = conversation.flatMap(t => [
        { role: 'user', content: t.user },
        ...(t.agent.answer ? [{ role: 'assistant', content: t.agent.answer }] : []),
      ]);
      const preamble = lensPrompt
        ? `(You are operating inside Concord's ${lensId} lens. ${lensPrompt})\n\n`
        : `(You are operating inside Concord's ${lensId} lens.)\n\n`;
      const fullMessage = preamble + userMsg + attachedNote;

      if (streaming) {
        // Sprint 16 — stream from /api/chat-agent/stream and render
        // tokens + tool-call cards + artifacts progressively.
        const res = await fetch('/api/chat-agent/stream', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: fullMessage, history, slot }),
        });
        const reader = res.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let buf = '';
          const liveAnswer: { text: string; toolCalls: ToolCall[]; artifacts: Artifact[]; provider?: string; model?: string } = {
            text: '', toolCalls: [], artifacts: [],
          };
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            let event = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) event = line.slice(7).trim();
              else if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (event === 'token') liveAnswer.text += data.chunk || '';
                  else if (event === 'tool_call') liveAnswer.toolCalls.push(data);
                  else if (event === 'artifact') liveAnswer.artifacts.push(data);
                  else if (event === 'done') {
                    liveAnswer.provider = data.provider;
                    liveAnswer.model = data.model;
                  }
                } catch { /* malformed SSE chunk */ }
                setConversation(c => {
                  const next = c.slice();
                  next[next.length - 1] = {
                    user: userMsg, agent: {
                      ok: true, answer: liveAnswer.text,
                      toolCalls: liveAnswer.toolCalls.slice(),
                      artifacts: liveAnswer.artifacts.slice(),
                      provider: liveAnswer.provider, model: liveAnswer.model,
                    },
                  };
                  return next;
                });
              }
            }
          }
        }
      } else {
        const r = await fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: 'chat_agent', name: 'do',
            input: { message: fullMessage, history, slot },
          }),
        });
        const j = await r.json();
        const payload = (j.result || j) as AgentResponse;
        setConversation(c => {
          const next = c.slice();
          next[next.length - 1] = { user: userMsg, agent: payload };
          return next;
        });
      }
    } catch (err) {
      setConversation(c => {
        const next = c.slice();
        next[next.length - 1] = { user: userMsg, agent: { ok: false, error: String(err) } };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, conversation, slot, lensId, lensPrompt, attachments, streaming]);

  if (!open) return null;

  const panelClass = position === 'bottom'
    ? 'fixed inset-x-0 bottom-0 z-40 h-[60vh] bg-zinc-950/97 backdrop-blur-md border-t border-zinc-800 shadow-2xl flex flex-col'
    : 'fixed inset-y-0 right-0 z-40 w-[480px] max-w-[100vw] bg-zinc-950/97 backdrop-blur-md border-l border-zinc-800 shadow-2xl flex flex-col';

  return (
    <div className={panelClass}>
      <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-2.5">
          <Bot className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Agent · {lensId}</h2>
            <p className="text-[11px] text-zinc-400">Lens-aware assistant — 200+ apps, web, compute, citations</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex border-b border-zinc-800 bg-zinc-900/40">
        <button
          onClick={() => setTab('quick')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 ${
            tab === 'quick' ? 'border-amber-500 text-amber-300' : 'border-transparent text-zinc-400 hover:text-zinc-300'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> Quick
        </button>
        <button
          onClick={() => setTab('marathon')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 ${
            tab === 'marathon' ? 'border-amber-500 text-amber-300' : 'border-transparent text-zinc-400 hover:text-zinc-300'
          }`}
        >
          <Hammer className="w-3.5 h-3.5" /> Marathon
        </button>
      </div>

      {tab === 'marathon' ? <MarathonPanel /> : (
      <>
      <div
        className="flex-1 overflow-y-auto px-5 py-4 space-y-6"
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {conversation.length === 0 && (
          <div className="text-center text-sm text-zinc-400 mt-12 px-4">
            <p>
              Agent Mode for the <span className="font-mono text-amber-400">{lensId}</span> lens.
              It can call any of the 200+ lens domain actions, web search, compute, browse pages,
              generate images/videos, mint cited DTUs.
            </p>
          </div>
        )}
        {conversation.map((turn, i) => {
          const badge = providerBadge(turn.agent.provider, turn.agent.model);
          return (
            <div key={i} className="space-y-3">
              <div className="text-sm text-zinc-100 bg-amber-500/10 ring-1 ring-amber-700/30 px-3 py-2 rounded-lg">
                {turn.user}
              </div>
              {(turn.agent.toolCalls || []).length > 0 && (
                <div className="space-y-1.5 ml-2 border-l-2 border-zinc-800 pl-3">
                  {turn.agent.toolCalls!.map((c, ci) => <ToolCallCard key={ci} call={c} />)}
                </div>
              )}
              {turn.agent.answer && (
                <div className="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap px-1">{turn.agent.answer}</div>
              )}
              {(turn.agent.artifacts || []).length > 0 && (
                <div className="space-y-2 px-1">
                  {turn.agent.artifacts!.map((a, ai) => {
                    if (a.kind === 'image' && a.image_b64) {
                      return (
                        <div key={ai} className="rounded-lg overflow-hidden ring-1 ring-zinc-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`data:image/png;base64,${a.image_b64}`} alt={a.prompt || 'Generated'} className="w-full h-auto" />
                        </div>
                      );
                    }
                    if (a.kind === 'video' && a.url) {
                      return (
                        <video key={ai} src={a.url} controls className="w-full h-auto rounded-lg ring-1 ring-zinc-800" />
                      );
                    }
                    if (a.id) {
                      return (
                        <a key={ai} href={`/lenses/dtu?id=${encodeURIComponent(a.id)}`} className="inline-flex items-center gap-1 px-2 py-0.5 mr-1 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-400 text-xs">
                          <FileText className="w-3 h-3" /> {a.title || a.id}
                        </a>
                      );
                    }
                    return null;
                  })}
                </div>
              )}
              {badge && turn.agent.ok && (
                <div className="flex items-center gap-2 text-[10px] text-zinc-400 px-1">
                  <span className={`px-1.5 py-0.5 rounded ${badge.color}`}>{badge.label}</span>
                  {turn.agent.turns && turn.agent.turns > 1 && <span>{turn.agent.turns} turns</span>}
                </div>
              )}
              {!turn.agent.ok && !busy && (
                <div className="text-xs text-red-400 px-3">{turn.agent.error || 'Agent failed.'}</div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-zinc-400 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> agent working…
          </div>
        )}
      </div>

      <footer className="border-t border-zinc-800 px-5 py-4 space-y-2">
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <Cpu className="w-3 h-3" />
          <span>brain slot:</span>
          <select
            value={slot}
            onChange={e => setSlot(e.target.value)}
            className="bg-zinc-900 text-zinc-200 ring-1 ring-zinc-800 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
          >
            <option value="conscious">conscious</option>
            <option value="subconscious">subconscious</option>
            <option value="utility">utility</option>
            <option value="repair">repair</option>
            <option value="vision">vision</option>
          </select>
          <label className="flex items-center gap-1 cursor-pointer" title="Stream tool calls + tokens progressively via SSE">
            <input
              type="checkbox"
              checked={streaming}
              onChange={(e) => setStreaming(e.target.checked)}
              className="w-3 h-3"
            />
            <span>stream</span>
          </label>
          <Link href="/lenses/byo-keys" className="ml-auto text-amber-400 hover:text-amber-300">configure</Link>
        </div>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px]">
                <Paperclip className="w-3 h-3" /> {a.name}
                <button
                  onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-zinc-400 hover:text-zinc-100 ml-1"
                aria-label="Close"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder={`Tell the ${lensId} agent to do something… (⌘↵ or drag a file)`}
            rows={2}
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 text-zinc-100 text-sm ring-1 ring-zinc-800 focus:ring-amber-500 focus:outline-none resize-none"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-lg shrink-0 bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            title="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => {
              for (const f of Array.from(e.target.files || [])) onPickFile(f);
              if (e.target) e.target.value = '';
            }}
            className="hidden"
          />
          <button
            onClick={listening ? stopListening : startListening}
            className={`p-2 rounded-lg shrink-0 ${listening ? 'bg-red-500 hover:bg-red-400 text-red-50 animate-pulse' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}
            title={listening ? 'Stop' : 'Voice input'}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            onClick={submit}
            disabled={busy || !prompt.trim()}
            className="p-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-50 disabled:opacity-40 shrink-0"
          aria-label="Send">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </footer>
      </>
      )}
    </div>
  );
}
