'use client';

/**
 * AgentModePanel — Sprint 11B
 *
 * Slide-over panel that mounts inside the chat lens. Provides the
 * Agent Mode interface backed by `chat_agent.do` (Sprint 11A):
 *
 *   • Single-input "do this" prompt at the top
 *   • Inline trace of every tool call as it executes (web_search,
 *     run_compute, browse_url, run_lens_action across any of 200+
 *     lenses, create_dtu, expert_mode)
 *   • Artifact panel — clickable links to any DTUs minted during
 *     the conversation
 *   • Provider chip — shows which brain (BYO Claude/GPT/Grok/Gemini
 *     or default Ollama) actually produced the answer
 *
 * The panel does not modify the existing chat lens state; it has its
 * own isolated session so users can experiment with Agent Mode without
 * touching their main thread.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Bot, Send, X, Sparkles, ExternalLink, Loader2,
  Search, Calculator, Globe, Layers, FileText,
  CheckCircle2, XCircle, Hammer, MessageSquare,
  Mic, MicOff, Cpu,
} from 'lucide-react';
import MarathonPanel from './MarathonPanel';

// Web Speech API types (browser-native STT). Safari + Chrome ship it.
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
  result?: unknown;
  error?: string;
  query?: string;
  url?: string;
  title?: string;
  key?: string;
  text?: string;
  dtuId?: string;
  citationsRecorded?: number;
  artifact?: { kind: string; id: string; title?: string };
}

interface Artifact {
  kind: string;
  id?: string;
  title?: string;
  source?: string;
  prompt?: string;
  image_b64?: string;
  // Sprint 14 — video artifact (Sora/Veo/Runway). Async — starts as
  // pending with a jobId, completes with a URL.
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

interface ConversationTurn {
  user: string;
  agent: AgentResponse;
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  web_search: Search,
  run_compute: Calculator,
  browse_url: Globe,
  run_lens_action: Layers,
  create_dtu: FileText,
  expert_mode: Sparkles,
};

function ToolCallCard({ call }: { call: ToolCall }) {
  const Icon = TOOL_ICONS[call.tool] || Bot;
  const summary = call.query
    || call.url
    || call.key
    || call.title
    || (call.tool === 'create_dtu' ? `DTU: ${call.title || ''}` : '');
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2 rounded-lg ring-1 ${
      call.ok ? 'bg-zinc-900/70 ring-zinc-800' : 'bg-red-950/30 ring-red-900/50'
    }`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-zinc-400" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-300">{call.tool}</span>
          {call.ok
            ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
            : <XCircle className="w-3 h-3 text-red-500 shrink-0" />}
        </div>
        {summary && (
          <div className="text-xs text-zinc-400 truncate" title={summary}>
            {summary}
          </div>
        )}
        {call.error && (
          <div className="text-[11px] text-red-400 mt-0.5">{call.error}</div>
        )}
        {call.dtuId && (
          <a
            href={`/lenses/dtu?id=${encodeURIComponent(call.dtuId)}`}
            className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 mt-0.5"
          >
            open DTU <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

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

interface AgentModePanelProps {
  open: boolean;
  onClose: () => void;
}

export default function AgentModePanel({ open, onClose }: AgentModePanelProps) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [tab, setTab] = useState<'quick' | 'marathon'>('quick');
  // Sprint 14 — per-message model slot picker. Default 'conscious'
  // (Sprint 10 BYO routes per user). Other slots = subconscious /
  // utility / repair / vision.
  const [slot, setSlot] = useState<string>('conscious');
  // Sprint 14 — voice input via Web Speech API (Safari + Chrome native).
  const [listening, setListening] = useState(false);
  const recogRef = useRef<SpeechRecognitionType | null>(null);

  const startListening = useCallback(() => {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionType; webkitSpeechRecognition?: new () => SpeechRecognitionType };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) {
      alert('Voice input not supported in this browser. Use Chrome or Safari.');
      return;
    }
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
    setPrompt('');
    setBusy(true);
    // Optimistic: push the user msg with a placeholder agent response
    setConversation(c => [...c, { user: userMsg, agent: { ok: false } }]);
    try {
      const history = conversation.flatMap(t => [
        { role: 'user', content: t.user },
        ...(t.agent.answer ? [{ role: 'assistant', content: t.agent.answer }] : []),
      ]);
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'chat_agent', name: 'do',
          input: { message: userMsg, history, slot },
        }),
      });
      const j = await r.json();
      const payload = (j.result || j) as AgentResponse;
      setConversation(c => {
        const next = c.slice();
        next[next.length - 1] = { user: userMsg, agent: payload };
        return next;
      });
    } catch (err) {
      setConversation(c => {
        const next = c.slice();
        next[next.length - 1] = { user: userMsg, agent: { ok: false, error: String(err) } };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, conversation]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-[480px] max-w-[100vw] bg-zinc-950/97 backdrop-blur-md border-l border-zinc-800 shadow-2xl flex flex-col">
      <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-2.5">
          <Bot className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Agent Mode</h2>
            <p className="text-[11px] text-zinc-500">Tool-using assistant — 200+ apps, web, compute, citations</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex border-b border-zinc-800 bg-zinc-900/40">
        <button
          onClick={() => setTab('quick')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 ${
            tab === 'quick' ? 'border-amber-500 text-amber-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> Quick
        </button>
        <button
          onClick={() => setTab('marathon')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 ${
            tab === 'marathon' ? 'border-amber-500 text-amber-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Hammer className="w-3.5 h-3.5" /> Marathon
        </button>
      </div>

      {tab === 'marathon' ? <MarathonPanel /> : (
      <>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
        {conversation.length === 0 && (
          <div className="text-center text-sm text-zinc-500 mt-12 px-4">
            <p className="mb-3">
              Tell Concord to do something. It can call web search, any of the 200+ lens domain
              actions (legal, finance, music, code, atlas, world…), run physics/math/chemistry
              compute, browse pages, mint cited DTUs.
            </p>
            <p className="text-xs text-zinc-600">
              Try: <span className="font-mono">&quot;Find the latest research on transformer
              attention, summarize cited, save as a DTU.&quot;</span>
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
              {!turn.agent.ok && !busy && (
                <div className="text-xs text-red-400 px-3">
                  {turn.agent.error || 'Agent failed.'}
                </div>
              )}
              {(turn.agent.toolCalls || []).length > 0 && (
                <div className="space-y-1.5 ml-2 border-l-2 border-zinc-800 pl-3">
                  {turn.agent.toolCalls!.map((c, ci) => (
                    <ToolCallCard key={ci} call={c} />
                  ))}
                </div>
              )}
              {turn.agent.answer && (
                <div className="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap px-1">
                  {turn.agent.answer}
                </div>
              )}
              {(turn.agent.artifacts || []).length > 0 && (
                <div className="space-y-2 px-1">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">Artifacts</span>
                  {turn.agent.artifacts!.map((a, ai) => {
                    if (a.kind === 'image' && a.image_b64) {
                      return (
                        <div key={ai} className="rounded-lg overflow-hidden ring-1 ring-zinc-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`data:image/png;base64,${a.image_b64}`}
                            alt={a.prompt || 'Generated image'}
                            className="w-full h-auto"
                          />
                          {a.prompt && (
                            <div className="px-3 py-1.5 text-[11px] text-zinc-400 bg-zinc-900">
                              {a.prompt}
                              {a.source && <span className="ml-2 text-zinc-600">via {a.source}</span>}
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (a.kind === 'video') {
                      return (
                        <div key={ai} className="rounded-lg overflow-hidden ring-1 ring-zinc-800 bg-zinc-900">
                          {a.url ? (
                            <video src={a.url} controls className="w-full h-auto" />
                          ) : (
                            <div className="px-3 py-4 text-xs text-zinc-400 flex items-center gap-2">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              video generating (job {a.jobId})… polls auto-update
                            </div>
                          )}
                          {a.prompt && (
                            <div className="px-3 py-1.5 text-[11px] text-zinc-500">
                              {a.prompt}{a.source && <span className="ml-2 text-zinc-600">via {a.source}</span>}
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (a.id) {
                      return (
                        <a
                          key={ai}
                          href={`/lenses/${a.kind === 'dtu' ? 'dtu' : 'world'}?id=${encodeURIComponent(a.id)}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 mr-1 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-400 text-xs"
                        >
                          <FileText className="w-3 h-3" />
                          {a.title || a.id}
                        </a>
                      );
                    }
                    return null;
                  })}
                </div>
              )}
              {(badge || turn.agent.turns) && turn.agent.ok && (
                <div className="flex items-center gap-2 text-[10px] text-zinc-500 px-1">
                  {badge && (
                    <span className={`px-1.5 py-0.5 rounded ${badge.color}`}>{badge.label}</span>
                  )}
                  {turn.agent.turns && turn.agent.turns > 1 && (
                    <span>{turn.agent.turns} turns</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            agent working…
          </div>
        )}
      </div>

      <footer className="border-t border-zinc-800 px-5 py-4 space-y-2">
        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
          <Cpu className="w-3 h-3" />
          <span>brain slot:</span>
          <select
            value={slot}
            onChange={e => setSlot(e.target.value)}
            className="bg-zinc-900 text-zinc-200 ring-1 ring-zinc-800 rounded px-1.5 py-0.5 text-[11px] focus:ring-amber-500 focus:outline-none"
            title="Which brain slot to use — your BYO key for that slot routes inference; otherwise Concord default Ollama"
          >
            <option value="conscious">conscious (default)</option>
            <option value="subconscious">subconscious</option>
            <option value="utility">utility</option>
            <option value="repair">repair</option>
            <option value="vision">vision (image input)</option>
          </select>
          <a href="/lenses/byo-keys" className="ml-auto text-amber-400 hover:text-amber-300">configure keys</a>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder="Tell Concord to do something… (⌘↵ to send)"
            rows={2}
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 text-zinc-100 text-sm ring-1 ring-zinc-800 focus:ring-amber-500 focus:outline-none resize-none"
          />
          <button
            onClick={listening ? stopListening : startListening}
            className={`p-2 rounded-lg shrink-0 ${
              listening ? 'bg-red-500 hover:bg-red-400 text-red-50 animate-pulse' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
            title={listening ? 'Stop listening' : 'Voice input (Web Speech API)'}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            onClick={submit}
            disabled={busy || !prompt.trim()}
            className="p-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-50 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title="Send (⌘↵)"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </footer>
      </>
      )}
    </div>
  );
}
