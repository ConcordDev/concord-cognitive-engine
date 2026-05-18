'use client';

/**
 * DocAICommandMenu — Ctrl-K / Cmd-K palette opened over the editor.
 *
 * Drives Sprint B's six AI actions (compose, inline edit, continue,
 * match style, match format, run skill) plus AI image generation
 * from a single keyboard-first surface. When invoked with a non-
 * empty selection, defaults to inline-edit mode; otherwise compose.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Sparkles, FileText, RefreshCw, Search, Type, Layers, Image as ImageIcon,
  Loader2, X, Wand2, ArrowRight,
} from 'lucide-react';
import { callDocsMacro } from '@/lib/api/docs';

type Mode = 'menu' | 'compose' | 'edit' | 'continue' | 'match_style' | 'match_format' | 'skill' | 'image';

interface Props {
  open: boolean;
  onClose: () => void;
  documentId: string | null;
  selection: string;
  cursorContext: string;
  onInsert: (html: string) => void;
  onReplaceSelection: (text: string) => void;
}

export function DocAICommandMenu({
  open, onClose, documentId, selection, cursorContext, onInsert, onReplaceSelection,
}: Props) {
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [targetDocId, setTargetDocId] = useState('');
  const [docOptions, setDocOptions] = useState<{ id: string; title: string }[]>([]);
  const [skills, setSkills] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string>('');
  const [preview, setPreview] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode(selection.trim() ? 'edit' : 'menu');
    setBusy(false);
    setPrompt('');
    setPreview('');
    setError(null);
    setSelectedSkill('');
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, selection]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [docs, sk] = await Promise.all([
          callDocsMacro<{ documents?: { id: string; title: string }[] }>('list', { limit: 200 }),
          callDocsMacro<{ skills?: { id: string; name: string; kind: string }[] }>('skill_list', { limit: 100 }),
        ]);
        setDocOptions(docs?.documents || []);
        setSkills(sk?.skills || []);
      } catch { /* silent */ }
    })();
  }, [open]);

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, handleEsc]);

  const runAction = useCallback(async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      switch (mode) {
        case 'compose': {
          const r = await callDocsMacro<{ html?: string; text?: string }>('ai_compose', {
            documentId, prompt, tone: 'neutral', length: 'medium',
          });
          if (!r?.ok) throw new Error(r?.reason || 'compose_failed');
          setPreview(r.html || r.text || '');
          break;
        }
        case 'edit': {
          const r = await callDocsMacro<{ edited?: string }>('ai_inline_edit', {
            documentId, selection, instruction: prompt,
          });
          if (!r?.ok) throw new Error(r?.reason || 'edit_failed');
          setPreview(`<p>${(r.edited || '').replace(/\n+/g, '</p><p>')}</p>`);
          break;
        }
        case 'continue': {
          const r = await callDocsMacro<{ continuation?: string }>('ai_continue', {
            documentId, context: cursorContext, matchVoice: true,
          });
          if (!r?.ok) throw new Error(r?.reason || 'continue_failed');
          setPreview(`<p>${(r.continuation || '').replace(/\n+/g, '</p><p>')}</p>`);
          break;
        }
        case 'match_style': {
          const r = await callDocsMacro<{ rewritten?: string }>('ai_match_style', {
            documentId, sourceText: selection || cursorContext, targetDocId,
          });
          if (!r?.ok) throw new Error(r?.reason || 'match_style_failed');
          setPreview(`<p>${(r.rewritten || '').replace(/\n+/g, '</p><p>')}</p>`);
          break;
        }
        case 'match_format': {
          const r = await callDocsMacro<{ html?: string; formatted?: string }>('ai_match_format', {
            documentId, sourceContent: selection || cursorContext, templateDocId: targetDocId,
          });
          if (!r?.ok) throw new Error(r?.reason || 'match_format_failed');
          setPreview(r.html || `<p>${(r.formatted || '').replace(/\n+/g, '</p><p>')}</p>`);
          break;
        }
        case 'skill': {
          if (!selectedSkill) { setError('Pick a skill.'); break; }
          const r = await callDocsMacro<{ html?: string; output?: string }>('skill_run', {
            id: selectedSkill, documentId, selection, input: prompt,
          });
          if (!r?.ok) throw new Error(r?.reason || 'skill_failed');
          setPreview(r.html || `<p>${(r.output || '').replace(/\n+/g, '</p><p>')}</p>`);
          break;
        }
        case 'image': {
          const r = await callDocsMacro<{ url?: string; note?: string }>('ai_image', {
            documentId, prompt,
          });
          if (!r?.ok) throw new Error(r?.reason || 'image_failed');
          setPreview(`<p><img src="${r.url}" alt="${prompt.replace(/"/g, '&quot;')}" /></p>`);
          break;
        }
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'AI request failed');
    } finally {
      setBusy(false);
    }
  }, [mode, prompt, selection, cursorContext, documentId, targetDocId, selectedSkill, busy]);

  const accept = useCallback(() => {
    if (!preview) return;
    if (mode === 'edit') {
      // Strip <p> wrappers for inline replacement
      const txt = preview.replace(/<\/?p>/g, '').replace(/<br\s*\/?\s*>/g, '\n').trim();
      onReplaceSelection(txt);
    } else {
      onInsert(preview);
    }
    onClose();
  }, [preview, mode, onInsert, onReplaceSelection, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-24 p-4">
      <div className="bg-zinc-900 border border-cyan-500/30 rounded-lg w-full max-w-2xl shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-white/10">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white flex-1">
            {mode === 'menu' && 'AI Actions'}
            {mode === 'compose' && 'Compose new content'}
            {mode === 'edit' && 'Rewrite selection'}
            {mode === 'continue' && 'Continue writing'}
            {mode === 'match_style' && 'Match writing style'}
            {mode === 'match_format' && 'Match format'}
            {mode === 'skill' && 'Run AI Skill'}
            {mode === 'image' && 'Generate image'}
          </span>
          {mode !== 'menu' && (
            <button onClick={() => { setMode('menu'); setPreview(''); }} className="text-xs text-white/60 hover:text-white">
              back
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        {mode === 'menu' && (
          <div className="p-2 grid grid-cols-2 gap-1">
            <MenuItem icon={<FileText className="w-4 h-4" />} label="Compose new"        hint="Draft from a prompt"     onClick={() => setMode('compose')} />
            <MenuItem icon={<Wand2 className="w-4 h-4" />}    label="Edit selection"     hint={selection ? 'Rewrite the highlighted text' : 'Highlight text first'} disabled={!selection.trim()} onClick={() => setMode('edit')} />
            <MenuItem icon={<ArrowRight className="w-4 h-4" />} label="Continue writing" hint="Pick up from the cursor" onClick={() => setMode('continue')} />
            <MenuItem icon={<Type className="w-4 h-4" />}     label="Match writing style" hint="Mirror another doc's voice" onClick={() => setMode('match_style')} />
            <MenuItem icon={<Layers className="w-4 h-4" />}   label="Match format"       hint="Re-slot into a template" onClick={() => setMode('match_format')} />
            <MenuItem icon={<Sparkles className="w-4 h-4" />} label="Run AI Skill"       hint={`${skills.length} saved`}  onClick={() => setMode('skill')} />
            <MenuItem icon={<ImageIcon className="w-4 h-4" />} label="Generate image"    hint="Cover or illustration"   onClick={() => setMode('image')} />
            <MenuItem icon={<Search className="w-4 h-4" />}   label="Ask the workspace"  hint="See Q&A panel ↗"          disabled />
          </div>
        )}

        {mode !== 'menu' && (
          <div className="p-3 space-y-2">
            {(mode === 'match_style' || mode === 'match_format') && (
              <select
                value={targetDocId}
                onChange={(e) => setTargetDocId(e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
              >
                <option value="">{mode === 'match_style' ? 'Pick target style doc…' : 'Pick template doc…'}</option>
                {docOptions.filter((d) => d.id !== documentId).map((d) => (
                  <option key={d.id} value={d.id} className="bg-black">{d.title || 'Untitled'}</option>
                ))}
              </select>
            )}

            {mode === 'skill' && (
              <select
                value={selectedSkill}
                onChange={(e) => setSelectedSkill(e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
              >
                <option value="">Pick a skill…</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id} className="bg-black">{s.name} · {s.kind}</option>
                ))}
              </select>
            )}

            {mode !== 'continue' && (
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  mode === 'compose' ? "What should this doc be about?" :
                  mode === 'edit' ? "How should I rewrite it? e.g. 'shorter', 'more formal', 'in a friendly tone'" :
                  mode === 'image' ? "Describe the image — e.g. 'minimal abstract cover, teal + plum'" :
                  mode === 'skill' ? "Optional input ({{input}} in the skill template)" :
                  "Notes for the AI…"
                }
                rows={3}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runAction(); }}
                className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40 resize-none"
              />
            )}

            {mode === 'continue' && (
              <div className="text-xs text-white/50 px-2 py-2 bg-white/5 rounded">
                Continuing from: <span className="text-white/80">…{cursorContext.slice(-120)}</span>
              </div>
            )}

            {selection && (mode === 'edit' || mode === 'match_style' || mode === 'match_format') && (
              <div className="text-xs text-white/40 px-2 py-2 bg-cyan-500/5 border border-cyan-500/20 rounded max-h-20 overflow-y-auto">
                <div className="text-cyan-300/80 mb-1">Selection:</div>
                {selection.slice(0, 240)}{selection.length > 240 ? '…' : ''}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={runAction}
                disabled={busy || (mode !== 'continue' && !prompt.trim() && mode !== 'skill') || ((mode === 'match_style' || mode === 'match_format') && !targetDocId)}
                className="flex-1 py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {busy ? 'Generating…' : 'Generate'}
              </button>
            </div>

            {error && <div className="text-xs text-red-400 px-2">{error}</div>}

            {preview && (
              <div className="mt-2 border border-white/10 rounded">
                <div className="px-2 py-1 text-xs text-white/40 border-b border-white/10 flex items-center justify-between">
                  Preview
                  <div className="flex gap-1">
                    <button onClick={runAction} className="p-1 rounded hover:bg-white/10 text-white/60" title="Regenerate"><RefreshCw className="w-3 h-3" /></button>
                  </div>
                </div>
                <div
                  className="p-3 max-h-72 overflow-y-auto prose prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: preview }}
                />
                <div className="p-2 border-t border-white/10 flex gap-2">
                  <button onClick={accept} className="flex-1 py-1.5 rounded bg-green-500/20 hover:bg-green-500/30 text-green-200 text-sm font-medium">
                    {mode === 'edit' ? 'Replace selection' : 'Insert at cursor'}
                  </button>
                  <button onClick={() => setPreview('')} className="px-3 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm">
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, hint, onClick, disabled }: {
  icon: React.ReactNode; label: string; hint: string;
  onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-start gap-2 p-2 rounded hover:bg-white/5 text-left disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <div className="text-cyan-400 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white font-medium">{label}</div>
        <div className="text-xs text-white/40 truncate">{hint}</div>
      </div>
    </button>
  );
}
