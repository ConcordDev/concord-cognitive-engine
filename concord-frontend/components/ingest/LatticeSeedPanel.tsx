'use client';

/**
 * LatticeSeedPanel — recovered Auto-DTU + ingest-scheduler loop.
 *
 * Every value comes from a real `lattice-seed.*` macro. Experimental
 * auto-DTUs stay labeled experimental until a human promotes them.
 * Quota is role-derived on the server; this panel only displays it.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  BookPlus, FlaskConical, ListTodo, Play, ShieldCheck, Loader2,
  AlertTriangle, CheckCircle2, Plus, Sparkles,
} from 'lucide-react';

type TabId = 'queue' | 'hypotheses' | 'auto-dtus' | 'jobs';

interface Source { id: number; label: string; rootUrl: string | null; notes: string | null; createdAt: string }
interface Page {
  id: number; sourceId: number; url: string; status: string;
  contentExcerpt: string | null; lastProcessedAt: string | null; errorMessage: string | null;
}
interface Hypothesis { id: number; text: string; sourceLabel: string | null; createdAt: string }
interface AutoDtu {
  key: string; title: string; summary: string; tags: string[]; layer: string;
  kind: string; trustLevel: string; mintedDtuId: string | null; createdAt: string;
}
interface ResearchJob {
  id: number; topic: string; status: string; resultSummary: string | null;
  layer: string | null; createdAt: string; updatedAt: string;
}
interface Status {
  memoryCount: number; autoDtuCount: number; queuedPages: number;
  quotaUsed: number; quotaLimit: number;
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'queue', label: 'Source queue' },
  { id: 'hypotheses', label: 'Hypotheses' },
  { id: 'auto-dtus', label: 'Auto-DTUs' },
  { id: 'jobs', label: 'Research jobs' },
];

export function LatticeSeedPanel() {
  const [tab, setTab] = useState<TabId>('queue');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [st, setSt] = useState<Status | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [dtus, setDtus] = useState<AutoDtu[]>([]);
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [trustedOnly, setTrustedOnly] = useState(false);

  const [label, setLabel] = useState('');
  const [rootUrl, setRootUrl] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [sourceId, setSourceId] = useState<number | ''>('');
  const [hypText, setHypText] = useState('');
  const [jobTopic, setJobTopic] = useState('');

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text });
    window.setTimeout(() => setMsg(null), 4000);
  }, []);

  const loadAll = useCallback(async () => {
    const [s, src, pg, hy, ad, jb] = await Promise.all([
      lensRun<Status>('lattice-seed', 'status', {}),
      lensRun<{ sources: Source[] }>('lattice-seed', 'listSources', {}),
      lensRun<{ pages: Page[] }>('lattice-seed', 'listPages', {}),
      lensRun<{ hypotheses: Hypothesis[] }>('lattice-seed', 'listHypotheses', {}),
      lensRun<{ dtus: AutoDtu[] }>('lattice-seed', 'listAutoDtus', { includeExperimental: !trustedOnly }),
      lensRun<{ jobs: ResearchJob[] }>('lattice-seed', 'listResearchJobs', {}),
    ]);
    if (s.data.ok && s.data.result) setSt(s.data.result);
    if (src.data.ok && src.data.result) setSources(src.data.result.sources || []);
    if (pg.data.ok && pg.data.result) setPages(pg.data.result.pages || []);
    if (hy.data.ok && hy.data.result) setHypotheses(hy.data.result.hypotheses || []);
    if (ad.data.ok && ad.data.result) setDtus(ad.data.result.dtus || []);
    if (jb.data.ok && jb.data.result) setJobs(jb.data.result.jobs || []);
  }, [trustedOnly]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const run = useCallback(async (action: string, input: Record<string, unknown>, okText: string) => {
    setBusy(true);
    try {
      const r = await lensRun(action.includes('.') ? action.split('.')[0] : 'lattice-seed', action.includes('.') ? action.split('.')[1] : action, input);
      if (!r.data.ok) {
        flash('err', r.data.error || 'failed');
        return;
      }
      flash('ok', okText);
      await loadAll();
    } finally {
      setBusy(false);
    }
  }, [flash, loadAll]);

  const quotaPct = st && st.quotaLimit > 0 ? Math.min(100, Math.round((st.quotaUsed / st.quotaLimit) * 100)) : 0;

  return (
    <section className="panel p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-neon-cyan" />
            Lattice seed
          </h2>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl">
            Queue a public page, extract hypotheses, mint an experimental auto-DTU,
            then promote it to trusted. Nothing here is fabricated: empty queues,
            quota, and fetch failures surface as themselves.
          </p>
        </div>
        {st && (
          <div className="text-right text-[11px] text-gray-400 space-y-1 min-w-[160px]">
            <div className="flex items-center justify-end gap-2">
              <span>Ingest today</span>
              <span className="font-mono text-white">{st.quotaUsed}/{st.quotaLimit}</span>
            </div>
            <div className="h-1.5 w-40 bg-black/40 rounded overflow-hidden ml-auto">
              <div className="h-full bg-neon-cyan/70" style={{ width: `${quotaPct}%` }} />
            </div>
            <div className="flex gap-3 justify-end">
              <span>queued {st.queuedPages}</span>
              <span>auto-DTUs {st.autoDtuCount}</span>
            </div>
          </div>
        )}
      </div>

      {msg && (
        <div className={`text-xs flex items-center gap-1.5 ${msg.kind === 'ok' ? 'text-neon-green' : 'text-red-400'}`}>
          {msg.kind === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          {msg.text}
        </div>
      )}

      <div className="flex gap-1 border-b border-lattice-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs ${tab === t.id ? 'text-white border-b-2 border-neon-cyan' : 'text-gray-500 hover:text-gray-300'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h3 className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
              <BookPlus className="w-3.5 h-3.5" /> Source
            </h3>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (required)"
              className="w-full px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-xs text-white placeholder-gray-500"
            />
            <input
              value={rootUrl}
              onChange={(e) => setRootUrl(e.target.value)}
              placeholder="Root URL (optional)"
              className="w-full px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-xs text-white placeholder-gray-500 font-mono"
            />
            <button
              type="button"
              disabled={busy || !label.trim()}
              onClick={() => void run('createSource', { label: label.trim(), rootUrl: rootUrl.trim() || null }, 'Source saved')}
              className="px-3 py-1.5 text-xs bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-neon-cyan disabled:opacity-40 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add source
            </button>
            <ul className="text-xs space-y-1 max-h-32 overflow-auto">
              {sources.length === 0 && <li className="text-gray-500">No sources yet.</li>}
              {sources.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSourceId(s.id)}
                    className={`text-left w-full px-2 py-1 rounded ${sourceId === s.id ? 'bg-neon-cyan/10 text-white' : 'text-gray-300 hover:bg-white/5'}`}
                  >
                    <span className="font-medium">{s.label}</span>
                    {s.rootUrl && <span className="text-gray-500 font-mono ml-2">{s.rootUrl}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
              <ListTodo className="w-3.5 h-3.5" /> Pages
            </h3>
            <input
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              placeholder="https://… page to queue"
              className="w-full px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-xs text-white placeholder-gray-500 font-mono"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !sourceId || !pageUrl.trim()}
                onClick={() => void run('queuePage', { sourceId, url: pageUrl.trim() }, 'Page queued')}
                className="px-3 py-1.5 text-xs border border-lattice-border rounded-lg text-gray-200 disabled:opacity-40"
              >
                Queue page
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('executeNext', {}, 'Next page processed')}
                className="px-3 py-1.5 text-xs bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-neon-cyan disabled:opacity-40 flex items-center gap-1"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Execute next
              </button>
            </div>
            <ul className="text-xs space-y-1 max-h-48 overflow-auto font-mono">
              {pages.length === 0 && <li className="text-gray-500 font-sans">No pages queued.</li>}
              {pages.map((p) => (
                <li key={p.id} className="flex items-start gap-2">
                  <span className={
                    p.status === 'processed' ? 'text-neon-green' :
                    p.status === 'error' ? 'text-red-400' : 'text-amber-400'
                  }>{p.status}</span>
                  <span className="text-gray-300 break-all">{p.url}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === 'hypotheses' && (
        <div className="space-y-3">
          <textarea
            value={hypText}
            onChange={(e) => setHypText(e.target.value)}
            placeholder="Paste an excerpt to propose testable directions…"
            rows={4}
            className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-xs text-white placeholder-gray-500"
          />
          <button
            type="button"
            disabled={busy || !hypText.trim()}
            onClick={() => void run('proposeHypotheses', { text: hypText.trim(), sourceLabel: 'manual' }, 'Hypotheses stored')}
            className="px-3 py-1.5 text-xs bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-neon-cyan disabled:opacity-40 flex items-center gap-1"
          >
            <FlaskConical className="w-3 h-3" /> Propose hypotheses
          </button>
          <ul className="space-y-3">
            {hypotheses.length === 0 && <li className="text-xs text-gray-500">No hypotheses yet — ingest a page or paste an excerpt.</li>}
            {hypotheses.map((h) => (
              <li key={h.id} className="border border-lattice-border rounded-lg p-3 space-y-2">
                <div className="text-[11px] text-gray-500 flex justify-between">
                  <span>#{h.id} {h.sourceLabel || 'manual'}</span>
                  <span>{new Date(h.createdAt).toLocaleString()}</span>
                </div>
                <pre className="text-xs text-gray-200 whitespace-pre-wrap font-sans">{h.text}</pre>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run('mintFromHypothesis', { hypothesisId: h.id }, 'Experimental auto-DTU minted')}
                  className="text-[11px] text-neon-cyan hover:underline disabled:opacity-40"
                >
                  Mint experimental auto-DTU
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'auto-dtus' && (
        <div className="space-y-3">
          <label className="text-xs text-gray-400 flex items-center gap-2">
            <input type="checkbox" checked={trustedOnly} onChange={(e) => setTrustedOnly(e.target.checked)} />
            Trusted only
          </label>
          <ul className="space-y-3">
            {dtus.length === 0 && (
              <li className="text-xs text-gray-500">
                {trustedOnly ? 'No trusted auto-DTUs yet.' : 'No auto-DTUs yet.'}
              </li>
            )}
            {dtus.map((d) => (
              <li key={d.key} className="border border-lattice-border rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white font-medium">{d.title}</span>
                  <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    d.trustLevel === 'trusted' ? 'bg-neon-green/15 text-neon-green' : 'bg-amber-500/15 text-amber-400'
                  }`}>{d.trustLevel}</span>
                </div>
                <div className="text-[11px] text-gray-500 font-mono">{d.key} · {d.layer} · {d.kind}</div>
                <p className="text-xs text-gray-300">{d.summary}</p>
                {d.mintedDtuId
                  ? <div className="text-[11px] text-gray-500">Substrate DTU {d.mintedDtuId}</div>
                  : <div className="text-[11px] text-gray-600">No substrate id yet — catalog row only.</div>}
                {d.trustLevel !== 'trusted' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run('setTrust', { key: d.key, trustLevel: 'trusted' }, 'Promoted to trusted')}
                    className="text-[11px] text-neon-cyan hover:underline disabled:opacity-40 flex items-center gap-1"
                  >
                    <ShieldCheck className="w-3 h-3" /> Promote to trusted
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="space-y-3">
          <input
            value={jobTopic}
            onChange={(e) => setJobTopic(e.target.value)}
            placeholder="Research topic"
            className="w-full px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-xs text-white placeholder-gray-500"
          />
          <button
            type="button"
            disabled={busy || !jobTopic.trim()}
            onClick={() => void run('createResearchJob', { topic: jobTopic.trim() }, 'Research job stored')}
            className="px-3 py-1.5 text-xs bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-neon-cyan disabled:opacity-40"
          >
            Run research job
          </button>
          <ul className="space-y-3">
            {jobs.length === 0 && <li className="text-xs text-gray-500">No persisted research jobs yet.</li>}
            {jobs.map((j) => (
              <li key={j.id} className="border border-lattice-border rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-white">{j.topic}</span>
                  <span className={j.status === 'done' ? 'text-neon-green' : 'text-amber-400'}>{j.status}</span>
                </div>
                {j.resultSummary && <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans">{j.resultSummary}</pre>}
                {j.status === 'done' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run('mintFromResearchJob', { jobId: j.id }, 'Experimental auto-DTU minted')}
                    className="text-[11px] text-neon-cyan hover:underline disabled:opacity-40"
                  >
                    Mint experimental auto-DTU
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
