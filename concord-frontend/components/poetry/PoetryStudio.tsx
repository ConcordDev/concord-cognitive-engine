'use client';

/**
 * PoetryStudio — three backlog surfaces in one workbench:
 *  • Audio readings (record / play back via MediaRecorder)
 *  • Form templates with live constraint checking
 *  • Chapbook export (print-ready manuscript)
 * Plus an inline rhyme-suggestion lookup. All data is real user
 * input or live-fetched; nothing is hardcoded.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic, Square, Play, Trash2, Loader2, BookCopy, CheckCircle2, XCircle,
  Wand2, Download, ListChecks,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MyPoem { id: string; title: string; form: string; status: string }
interface Recording {
  id: string; poemId: string; poemTitle: string; durationSec: number;
  mimeType: string; createdAt: string;
}
interface FormRules {
  lineCount: number | null;
  syllablesPerLine: number[] | null;
  rhyme: string | null;
  meterTarget?: number;
  template: string;
  hint: string;
}
interface LineReport { index: number; syllables: number; target: number | null; ok: boolean }
interface FormCheck {
  form: string; valid: boolean; lineCount: number; expectedLineCount: number | null;
  lineReports: LineReport[]; violations: string[];
}
interface RhymeWord { word: string; score: number; syllables: number | null }

const FORMS = ['haiku', 'sonnet', 'limerick', 'villanelle', 'tercet', 'couplet', 'quatrain', 'free-verse'];
type StudioTab = 'audio' | 'forms' | 'chapbook';

/* ── Audio readings ───────────────────────────────────────────────── */

function AudioReadings({ poems }: { poems: MyPoem[] }) {
  const [poemId, setPoemId] = useState('');
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const loadRecordings = useCallback(async () => {
    const r = await lensRun('poetry', 'recording-list', {});
    if (r.data?.ok) setRecordings((r.data.result?.recordings as Recording[]) || []);
  }, []);
  useEffect(() => { void loadRecordings(); }, [loadRecordings]);

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(blob);
    });

  const startRecording = useCallback(async () => {
    if (!poemId) { setError('Select a poem to record a reading of.'); return; }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        const durationSec = Math.round((Date.now() - startTimeRef.current) / 1000);
        try {
          const dataUrl = await blobToDataUrl(blob);
          const r = await lensRun('poetry', 'recording-save', {
            poemId, audioDataUrl: dataUrl, durationSec, mimeType: blob.type,
          });
          if (r.data?.ok) await loadRecordings();
          else setError((r.data?.error as string) || 'save failed');
        } catch {
          setError('Could not save the recording.');
        }
      };
      startTimeRef.current = Date.now();
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } catch {
      setError('Microphone access denied or unavailable.');
    }
  }, [poemId, loadRecordings]);

  const stopRecording = useCallback(() => {
    mediaRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const playRecording = useCallback(async (id: string) => {
    const r = await lensRun('poetry', 'recording-get', { id });
    if (r.data?.ok) {
      const rec = r.data.result?.recording as { audioDataUrl: string };
      setPlayingUrl(rec.audioDataUrl);
    }
  }, []);
  const deleteRecording = useCallback(async (id: string) => {
    await lensRun('poetry', 'recording-delete', { id });
    await loadRecordings();
  }, [loadRecordings]);

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <select value={poemId} onChange={e => setPoemId(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
          <option value="">Select a poem to read…</option>
          {poems.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        {!recording ? (
          <button onClick={startRecording} disabled={!poemId}
            className="px-3 py-1.5 text-xs rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
            <Mic className="w-3 h-3" /> Record
          </button>
        ) : (
          <button onClick={stopRecording}
            className="px-3 py-1.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-white font-semibold inline-flex items-center gap-1">
            <Square className="w-3 h-3" /> Stop ({elapsed}s)
          </button>
        )}
      </div>

      {playingUrl && (
        <audio src={playingUrl} controls autoPlay className="w-full h-8">
          <track kind="captions" />
        </audio>
      )}

      <div className="space-y-1.5">
        {recordings.length === 0 && (
          <p className="text-xs text-zinc-400 italic">No recordings yet.</p>
        )}
        {recordings.map(rec => (
          <div key={rec.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
            <div>
              <p className="text-xs font-semibold text-zinc-200 italic">{rec.poemTitle}</p>
              <p className="text-[10px] text-zinc-400">
                {rec.durationSec}s · {new Date(rec.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => playRecording(rec.id)} aria-label="Play"
                className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200">
                <Play className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => deleteRecording(rec.id)} aria-label="Delete"
                className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Form templates + live constraint checking + rhyme lookup ─────── */

function FormTemplates() {
  const [form, setForm] = useState('haiku');
  const [rules, setRules] = useState<FormRules | null>(null);
  const [body, setBody] = useState('');
  const [check, setCheck] = useState<FormCheck | null>(null);
  const [rhymeWord, setRhymeWord] = useState('');
  const [rhymes, setRhymes] = useState<RhymeWord[]>([]);
  const [rhymeLoading, setRhymeLoading] = useState(false);

  const loadRules = useCallback(async (f: string) => {
    const r = await lensRun('poetry', 'form-rules', { form: f });
    if (r.data?.ok) setRules(r.data.result?.rules as FormRules);
  }, []);
  useEffect(() => { void loadRules(form); }, [form, loadRules]);

  // Live constraint check, debounced against typing.
  useEffect(() => {
    if (!body.trim()) { setCheck(null); return; }
    const handle = setTimeout(async () => {
      const r = await lensRun('poetry', 'form-check', { form, body });
      if (r.data?.ok) setCheck(r.data.result as FormCheck);
    }, 400);
    return () => clearTimeout(handle);
  }, [body, form]);

  const insertTemplate = useCallback(() => {
    if (rules?.template) setBody(rules.template);
  }, [rules]);

  const lookupRhymes = useCallback(async () => {
    const word = rhymeWord.trim();
    if (!word) return;
    setRhymeLoading(true);
    const r = await lensRun('poetry', 'word-suggest', { word, kind: 'rhyme' });
    if (r.data?.ok) setRhymes((r.data.result?.words as RhymeWord[]) || []);
    else setRhymes([]);
    setRhymeLoading(false);
  }, [rhymeWord]);

  const bodyLines = body.split('\n');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={form} onChange={e => setForm(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
          {FORMS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        {rules?.template && (
          <button onClick={insertTemplate}
            className="px-2.5 py-1.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1">
            <Wand2 className="w-3 h-3" /> Insert template
          </button>
        )}
      </div>
      {rules && <p className="text-[11px] text-zinc-400 italic">{rules.hint}</p>}

      <div className="grid sm:grid-cols-[1fr_180px] gap-3">
        <div>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
            placeholder={`Compose a ${form} — constraints check as you type…`}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 font-serif leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500" />
          {check && (
            <div className={cn('mt-1.5 rounded-lg border p-2.5 text-[11px]',
              check.valid ? 'border-emerald-700/50 bg-emerald-900/20'
                : 'border-amber-700/50 bg-amber-900/20')}>
              <p className="inline-flex items-center gap-1 font-semibold">
                {check.valid
                  ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-300">Meets {check.form} constraints</span></>
                  : <><XCircle className="w-3.5 h-3.5 text-amber-400" /><span className="text-amber-300">{check.violations.length} issue{check.violations.length === 1 ? '' : 's'}</span></>}
              </p>
              {!check.valid && (
                <ul className="mt-1 space-y-0.5 text-zinc-400">
                  {check.violations.map((v, i) => <li key={i}>· {v}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Per-line syllable readout */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
          <p className="text-[11px] font-semibold text-zinc-400 inline-flex items-center gap-1 mb-1.5">
            <ListChecks className="w-3.5 h-3.5" /> Lines
          </p>
          {!check && <p className="text-[10px] text-zinc-400 italic">No data yet.</p>}
          {check && check.lineReports.map(lr => (
            <div key={lr.index} className="flex items-center justify-between text-[11px] py-0.5">
              <span className="text-zinc-400">Line {lr.index + 1}</span>
              <span className={cn('font-mono',
                lr.target == null ? 'text-zinc-400'
                  : lr.ok ? 'text-emerald-400' : 'text-rose-400')}>
                {lr.syllables}{lr.target != null ? ` / ${lr.target}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Inline rhyme suggestion */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-300">Rhyme lookup</p>
        <div className="flex gap-1.5">
          <input value={rhymeWord} onChange={e => setRhymeWord(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') lookupRhymes(); }}
            placeholder="A word to rhyme…"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <button onClick={lookupRhymes} disabled={!rhymeWord.trim() || rhymeLoading}
            className="px-3 py-1.5 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40">
            {rhymeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Find'}
          </button>
        </div>
        {rhymes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {rhymes.slice(0, 24).map(w => (
              <button key={w.word}
                onClick={() => setBody(b => (b ? `${b} ${w.word}` : w.word))}
                title="Click to append to draft"
                className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-violet-600/30 text-[11px] text-zinc-300">
                {w.word}
              </button>
            ))}
          </div>
        )}
        {bodyLines.length > 1 && (
          <p className="text-[10px] text-zinc-400">{bodyLines.filter(l => l.trim()).length} lines drafted</p>
        )}
      </div>
    </div>
  );
}

/* ── Chapbook export ──────────────────────────────────────────────── */

function ChapbookExport({ poems }: { poems: MyPoem[] }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ poemCount: number; totalLines: number } | null>(null);

  const toggle = (id: string) => setSelected(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const build = useCallback(async (download: boolean) => {
    setBuilding(true); setError(null);
    const params: Record<string, unknown> = {
      title: title.trim(), author: author.trim(),
    };
    if (selected.size > 0) params.poemIds = [...selected];
    const r = await lensRun('poetry', 'chapbook-export', params);
    if (r.data?.ok) {
      const res = r.data.result as {
        chapbook: { poemCount: number; totalLines: number };
        html: string; filename: string;
      };
      setResult(res.chapbook);
      if (download) {
        const blob = new Blob([res.html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = res.filename;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      } else {
        const win = window.open('', '_blank');
        if (win) { win.document.write(res.html); win.document.close(); win.print(); }
      }
    } else {
      setError((r.data?.error as string) || 'export failed');
    }
    setBuilding(false);
  }, [title, author, selected]);

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex flex-wrap gap-1.5">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Chapbook title"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author name"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
        <p className="text-[11px] text-zinc-400 mb-1.5">
          Pick poems to include — leave all unchecked to export every finished poem.
        </p>
        {poems.length === 0 && <p className="text-xs text-zinc-400 italic">No poems yet.</p>}
        <div className="space-y-1">
          {poems.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)}
                className="accent-violet-500" />
              <span className="italic">{p.title}</span>
              <span className="text-zinc-600">· {p.form} · {p.status}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => build(false)} disabled={building || poems.length === 0}
          className="px-3 py-1.5 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          <BookCopy className="w-3 h-3" /> {building ? 'Building…' : 'Print / Save PDF'}
        </button>
        <button onClick={() => build(true)} disabled={building || poems.length === 0}
          className="px-3 py-1.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 inline-flex items-center gap-1">
          <Download className="w-3 h-3" /> Download manuscript
        </button>
      </div>

      {result && (
        <p className="text-[11px] text-emerald-400">
          Chapbook assembled — {result.poemCount} poem{result.poemCount === 1 ? '' : 's'}, {result.totalLines} lines.
        </p>
      )}
    </div>
  );
}

/* ── Container ────────────────────────────────────────────────────── */

export function PoetryStudio() {
  const [tab, setTab] = useState<StudioTab>('forms');
  const [poems, setPoems] = useState<MyPoem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const r = await lensRun('poetry', 'poem-list', {});
      if (r.data?.ok) setPoems((r.data.result?.poems as MyPoem[]) || []);
      setLoading(false);
    })();
  }, []);

  const TABS: { id: StudioTab; label: string; icon: typeof Mic }[] = [
    { id: 'forms', label: 'Form Studio', icon: ListChecks },
    { id: 'audio', label: 'Audio Readings', icon: Mic },
    { id: 'chapbook', label: 'Chapbook Export', icon: BookCopy },
  ];

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-violet-300" />
        <h3 className="text-sm font-bold text-zinc-100">Poetry Studio</h3>
      </div>

      <div className="flex flex-wrap gap-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs',
              tab === t.id ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                : 'bg-zinc-900/60 text-zinc-400 border border-zinc-800 hover:text-zinc-200')}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4 text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : (
        <>
          {tab === 'forms' && <FormTemplates />}
          {tab === 'audio' && <AudioReadings poems={poems} />}
          {tab === 'chapbook' && <ChapbookExport poems={poems} />}
        </>
      )}
    </section>
  );
}
