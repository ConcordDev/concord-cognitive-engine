'use client';

import { useState } from 'react';
import { Plus, Sparkles, Loader2, Zap } from 'lucide-react';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import {
  understandingMacro,
  Field,
  type SubjectKind,
  type Understanding,
} from './understanding-shared';

export function ComposePanel({
  subjectKinds, onComposed,
}: { subjectKinds: SubjectKind[]; onComposed: () => void }) {
  const [subjectKind, setSubjectKind] = useState<SubjectKind>('raw');
  const [subjectId, setSubjectId] = useState('');
  const [rawText, setRawText] = useState('');
  const [composer, setComposer] = useState<'rules' | 'llm'>('rules');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Understanding | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Persist compose-session events for cross-lens discovery.
  const composeLog = useArtifacts<{ subjectKind: string; composer: string; at: string }>('understanding', { type: 'compose-session', limit: 5 });
  const createComposeLog = useCreateArtifact<{ subjectKind: string; composer: string; at: string }>('understanding');

  async function parsePreview() {
    setBusy(true); setError(null); setPreview(null); setSavedId(null);
    try {
      const r = await understandingMacro<{ ok: boolean; understanding?: Understanding; error?: string }>('parse',
        {
          subjectId: subjectId || undefined,
          subjectKind,
          composer,
          ...(subjectKind === 'raw' ? { text: rawText } : {}),
        }
      );
      if (r.ok && r.understanding) {
        setPreview(r.understanding);
      } else {
        setError(r.error ?? 'parse failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'parse failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveCompose() {
    setBusy(true); setError(null); setSavedId(null);
    try {
      const r = await understandingMacro<{ ok: boolean; id?: string; error?: string }>('compose',
        {
          subjectId: subjectId || undefined,
          subjectKind,
          composer,
          ...(subjectKind === 'raw' ? { text: rawText } : {}),
        }
      );
      if (r.ok && r.id) {
        setSavedId(r.id);
        createComposeLog.mutate({
          type: 'compose-session',
          title: `${subjectKind} via ${composer}`,
          data: { subjectKind, composer, at: new Date().toISOString() },
          meta: { tags: ['understanding', 'compose'], status: 'completed', visibility: 'private' },
        });
        onComposed();
      } else {
        setError(r.error ?? 'compose failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'compose failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="rounded-lg border border-violet-500/30 bg-black/60 p-4 mb-4">
        <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Compose new understanding
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <Field label="Subject kind">
            <select
              value={subjectKind}
              onChange={(e) => setSubjectKind(e.target.value as SubjectKind)}
              className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm"
            >
              {subjectKinds.length === 0 ? (
                <option value="raw">raw</option>
              ) : subjectKinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Composer">
            <select
              value={composer}
              onChange={(e) => setComposer(e.target.value as 'rules' | 'llm')}
              className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm"
            >
              <option value="rules">rules (deterministic)</option>
              <option value="llm">llm (subconscious brain)</option>
            </select>
          </Field>
          {subjectKind !== 'raw' && (
            <Field label="Subject ID" className="sm:col-span-2">
              <input
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                placeholder={`e.g. ${subjectKind === 'dtu' ? 'dtu_<id>' : `${subjectKind}_<id>`}`}
                className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm font-mono"
              />
            </Field>
          )}
          {subjectKind === 'raw' && (
            <Field label="Raw text" className="sm:col-span-2">
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={5}
                placeholder="Paste the text you want parsed into an understanding."
                className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm"
              />
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={parsePreview}
            disabled={busy || (subjectKind === 'raw' ? !rawText.trim() : !subjectId)}
            className="px-4 py-2 text-sm bg-violet-700/40 hover:bg-violet-700/60 border border-violet-700 disabled:opacity-50 rounded text-violet-200 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Parse preview
          </button>
          <button
            onClick={saveCompose}
            disabled={busy || (subjectKind === 'raw' ? !rawText.trim() : !subjectId)}
            className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Compose &amp; save
          </button>
        </div>

        {error && <p className="text-xs text-rose-300 mt-2">{error}</p>}
        {savedId && (
          <p className="text-xs text-emerald-300 mt-2 inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Saved as <span className="font-mono">{savedId}</span>
          </p>
        )}
      </div>

      {preview && (
        <div className="rounded-lg border border-white/10 bg-black/60 p-4">
          <h3 className="text-sm font-semibold mb-2 text-white/80 inline-flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-300" /> Preview (not saved)
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            {preview.consistency != null && <div><span className="text-white/40">consistency:</span> {Number(preview.consistency).toFixed(3)}</div>}
            {preview.confidence != null && <div><span className="text-white/40">confidence:</span> {Number(preview.confidence).toFixed(3)}</div>}
            {preview.composer && <div><span className="text-white/40">composer:</span> {preview.composer}</div>}
            {preview.subjectKind && <div><span className="text-white/40">kind:</span> {preview.subjectKind}</div>}
          </div>
          {preview.text && (
            <pre className="text-xs whitespace-pre-wrap text-white/70 border-t border-white/10 pt-2">{preview.text}</pre>
          )}
        </div>
      )}

      {composeLog.data?.artifacts && composeLog.data.artifacts.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5">Recent compose sessions</p>
          <ul className="text-xs space-y-1">
            {composeLog.data.artifacts.map((a) => (
              <li key={a.id} className="text-white/60">
                <span className="text-white/80">{a.title}</span>
                <span className="text-white/40 ml-2">
                  {new Date((a.data as { at?: string })?.at ?? a.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
