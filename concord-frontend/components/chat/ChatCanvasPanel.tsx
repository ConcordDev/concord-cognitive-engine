'use client';

/**
 * ChatCanvasPanel — Claude-Artifacts-parity inline live-rendered
 * side panel. Lists artifacts in the current session; selecting one
 * shows the live-rendered preview alongside an editable body with
 * version history.
 *
 * Backed by chat.artifact_* macros from Sprint B.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { callChatMacro } from '@/lib/api/chat-extras';
import {
  Sparkles, X, Loader2, Save, RotateCcw, Code, FileText, Image as ImageIcon,
  Eye, Pencil, Clock,
} from 'lucide-react';

interface Artifact {
  id: string; session_id: string; message_idx: number;
  owner_id: string; kind: string; title?: string | null; language?: string | null;
  body: string; current_version: number;
  created_at: number; updated_at: number;
}

interface ArtifactVersion { id: number; version: number; body: string; author: string; author_kind: string; note?: string | null; created_at: number; }

interface Props { open: boolean; onClose: () => void; sessionId: string | null; }

const KIND_ICON: Record<string, React.ReactNode> = {
  code: <Code className="w-3.5 h-3.5" />,
  html: <Code className="w-3.5 h-3.5" />,
  svg: <ImageIcon className="w-3.5 h-3.5" />,
  markdown: <FileText className="w-3.5 h-3.5" />,
  mermaid: <FileText className="w-3.5 h-3.5" />,
  react: <Code className="w-3.5 h-3.5" />,
  json: <Code className="w-3.5 h-3.5" />,
  csv: <FileText className="w-3.5 h-3.5" />,
  sql: <Code className="w-3.5 h-3.5" />,
  prompt: <FileText className="w-3.5 h-3.5" />,
};

export function ChatCanvasPanel({ open, onClose, sessionId }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');

  const load = useCallback(async () => {
    if (!sessionId) { setArtifacts([]); return; }
    const r = await callChatMacro<{ artifacts?: Artifact[] }>('artifact_list', { sessionId });
    setArtifacts(r?.artifacts || []);
    if (r?.artifacts?.length && !activeId) setActiveId(r.artifacts[0].id);
  }, [sessionId, activeId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Load full artifact + versions when active changes
  useEffect(() => {
    if (!activeId) { setVersions([]); return; }
    (async () => {
      const r = await callChatMacro<{ artifact?: Artifact; versions?: ArtifactVersion[] }>('artifact_get', { id: activeId });
      if (r?.artifact) {
        setArtifacts((prev) => prev.map((a) => a.id === activeId ? r.artifact! : a));
        setDraft(r.artifact.body);
      }
      setVersions(r?.versions || []);
    })();
  }, [activeId]);

  const active = useMemo(() => artifacts.find((a) => a.id === activeId) || null, [artifacts, activeId]);

  const save = useCallback(async () => {
    if (!active) return;
    setBusy(true);
    try {
      await callChatMacro('artifact_update', { id: active.id, body: draft, note: 'Edited in Canvas' });
      setEditing(false);
      load();
    } finally { setBusy(false); }
  }, [active, draft, load]);

  const revert = useCallback(async (toVersion: number) => {
    if (!active) return;
    if (!confirm(`Revert to v${toVersion}?`)) return;
    setBusy(true);
    try {
      await callChatMacro('artifact_revert', { id: active.id, toVersion });
      load();
    } finally { setBusy(false); }
  }, [active, load]);

  // Render preview by kind
  const preview = useMemo(() => {
    if (!active) return null;
    if (active.kind === 'svg' || active.kind === 'html') {
      return (
        <iframe
          srcDoc={active.kind === 'svg' ? `<html><body style="margin:0;background:white">${active.body}</body></html>` : active.body}
          sandbox="allow-scripts"
          className="w-full h-full bg-white rounded border border-white/10"
        />
      );
    }
    if (active.kind === 'markdown') {
      // Cheap MD render — bold/italic/headings/code only
      const html = active.body
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
      return <div className="p-4 prose prose-sm prose-invert max-w-none overflow-y-auto h-full" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    return (
      <pre className="p-3 text-xs font-mono text-white/90 overflow-auto h-full bg-black/40 whitespace-pre-wrap">{active.body}</pre>
    );
  }, [active]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-cyan-500/30 rounded-lg w-full max-w-5xl flex flex-col" style={{ height: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" /> Canvas
            <span className="text-xs text-white/40 font-normal">{artifacts.length} artifact{artifacts.length === 1 ? '' : 's'}</span>
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-hidden flex">
          {/* Artifacts sidebar */}
          <aside className="w-56 border-r border-white/10 overflow-y-auto p-2 space-y-0.5">
            {artifacts.length === 0 ? (
              <div className="text-xs text-white/40 text-center p-4">No artifacts yet. Ask the assistant to create one.</div>
            ) : (
              artifacts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => { setActiveId(a.id); setEditing(false); setMode('preview'); }}
                  className={`w-full text-left p-2 rounded text-sm flex items-start gap-2 ${activeId === a.id ? 'bg-cyan-500/10 text-cyan-200' : 'text-white/80 hover:bg-white/5'}`}
                >
                  <span className="text-cyan-400 mt-0.5">{KIND_ICON[a.kind] || <Code className="w-3.5 h-3.5" />}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.title || a.kind}</div>
                    <div className="text-xs text-white/40">v{a.current_version} · {a.kind}</div>
                  </div>
                </button>
              ))
            )}
          </aside>

          {/* Main pane */}
          <div className="flex-1 flex flex-col min-w-0">
            {active ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/30">
                  <span className="text-sm font-semibold text-white flex-1 truncate">{active.title || active.kind}</span>
                  <span className="text-xs text-white/40 uppercase">{active.kind}{active.language ? `·${active.language}` : ''}</span>
                  <div className="flex items-center gap-0.5 bg-white/5 rounded p-0.5">
                    <button onClick={() => setMode('preview')} className={`p-1 rounded ${mode === 'preview' ? 'bg-white/15 text-white' : 'text-white/50'}`} title="Preview"><Eye className="w-3.5 h-3.5" /></button>
                    <button onClick={() => { setMode('edit'); setEditing(true); setDraft(active.body); }} className={`p-1 rounded ${mode === 'edit' ? 'bg-white/15 text-white' : 'text-white/50'}`} title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden">
                  {mode === 'preview' ? (
                    <div className="h-full">{preview}</div>
                  ) : (
                    <div className="flex flex-col h-full">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="flex-1 p-3 text-xs font-mono bg-black/40 text-white border-none focus:outline-none resize-none"
                      />
                      <div className="flex justify-end gap-2 p-2 border-t border-white/10">
                        <button onClick={() => { setEditing(false); setMode('preview'); setDraft(active.body); }} className="px-3 py-1 rounded hover:bg-white/10 text-white/70 text-xs">Cancel</button>
                        <button onClick={save} disabled={busy || draft === active.body} className="px-3 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-xs disabled:opacity-40 flex items-center gap-1">
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          Save v{active.current_version + 1}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-white/40 text-sm">Pick an artifact.</div>
            )}
          </div>

          {/* Version sidebar */}
          {active && versions.length > 1 && (
            <aside className="w-52 border-l border-white/10 overflow-y-auto p-2 space-y-1">
              <div className="text-xs uppercase tracking-wide text-white/40 px-1 flex items-center gap-1"><Clock className="w-3 h-3" /> History</div>
              {versions.map((v) => (
                <div key={v.id} className="border border-white/10 rounded p-2 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-medium">v{v.version}</span>
                    <span className="text-white/40 text-[10px]">{v.author_kind}</span>
                  </div>
                  <div className="text-white/60 truncate">{v.note || `by ${v.author.slice(0, 8)}`}</div>
                  {v.version < active.current_version && (
                    <button onClick={() => revert(v.version)} className="mt-1 w-full py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/10 text-white/70 flex items-center justify-center gap-1">
                      <RotateCcw className="w-2.5 h-2.5" /> Revert
                    </button>
                  )}
                </div>
              ))}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
