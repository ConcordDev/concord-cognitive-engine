'use client';

/**
 * ConcordAIPanel — Whiteboard Sprint A side panel.
 *
 * Wires the three Sprint A AI features into the whiteboard lens:
 *   - Brainstorm: prompt → N sticky-ready ideas → user clicks "Add to board"
 *   - Cluster (semantic): real Ollama embedding + k-means on current elements
 *   - Summarize: real utility brain call → summary + action items + decisions
 *
 * Also exposes:
 *   - Export as DTU (Sprint A #7)
 *   - Image upload (Sprint A #6 — real /api/whiteboard/upload-image)
 *
 * All calls are real macro calls; no mocks. The panel does not own
 * canvas state — it receives elements + callbacks from the parent.
 */

import { useState, useRef } from 'react';
import { Brain, Loader2, AlertCircle, Sparkles, ImagePlus, Download, ListChecks, GripVertical } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface WbElementLike {
  id: string;
  text?: string;
  label?: string;
  type?: string;
  kind?: string;
  x?: number; y?: number;
}

interface ConcordAIPanelProps {
  boardId: string | null;
  elements: WbElementLike[];
  onAddStickies: (ideas: string[]) => void;
  onApplyClusters?: (clusters: Array<{ clusterId: number; label: string; elements: string[] }>) => void;
  onAddImageElement?: (args: { url: string; dtuId?: string; bytes?: number }) => void;
}

interface ClusterRow { clusterId: number; label: string; elements: string[] }
interface SummaryShape { summary: string; action_items: string[]; decisions: string[]; themes?: string[]; source?: string }

async function callMacro<T>(name: string, input: Record<string, unknown>): Promise<{ ok: boolean; result?: T } & T & { reason?: string; error?: string }> {
  const r = await api.post('/api/lens/run', { domain: 'whiteboard', name, input });
  const json = r.data?.result ?? r.data;
  return json as { ok: boolean } & T;
}

export function ConcordAIPanel({ boardId, elements, onAddStickies, onApplyClusters, onAddImageElement }: ConcordAIPanelProps) {
  const [tab, setTab] = useState<'brainstorm' | 'cluster' | 'summarize' | 'mint' | 'image'>('brainstorm');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Brainstorm state
  const [bsPrompt, setBsPrompt] = useState('');
  const [bsCount, setBsCount] = useState(12);
  const [bsIdeas, setBsIdeas] = useState<string[]>([]);
  const [bsSource, setBsSource] = useState<string | null>(null);

  // Cluster state
  const [clusterMode, setClusterMode] = useState<'semantic' | 'spatial'>('semantic');
  const [clusters, setClusters] = useState<ClusterRow[]>([]);

  // Summary state
  const [summary, setSummary] = useState<SummaryShape | null>(null);

  // Mint state
  const [mintScope, setMintScope] = useState<'personal' | 'public'>('personal');
  const [mintLicense, setMintLicense] = useState('proprietary');
  const [mintPriceCents, setMintPriceCents] = useState(0);
  const [lastDtuId, setLastDtuId] = useState<string | null>(null);

  // Image upload state
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleBrainstorm() {
    if (!bsPrompt.trim()) return;
    setBusy('brainstorm'); setErr(null); setOk(null);
    try {
      const r = await callMacro<{ ideas?: string[]; source?: string; reason?: string }>('brainstorm', {
        prompt: bsPrompt.trim(), count: bsCount,
      });
      if (r?.ok && Array.isArray(r.ideas)) {
        setBsIdeas(r.ideas);
        setBsSource(r.source || null);
        setOk(`Got ${r.ideas.length} ideas (${r.source})`);
      } else {
        setErr(r?.reason || 'brainstorm failed');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'request failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleCluster() {
    if (elements.length === 0) return setErr('Add some stickies first.');
    setBusy('cluster'); setErr(null); setOk(null); setClusters([]);
    try {
      const r = await callMacro<{ result?: { clusters?: ClusterRow[]; clusterCount?: number; mode?: string } }>('clusterGroup', {
        artifactId: boardId || 'inline',
        // The legacy macro takes data on the artifact; we pass elements + mode in params.
        mode: clusterMode,
      });
      // The legacy macro returns the result envelope nested under .result
      const inner = (r as { result?: { clusters?: ClusterRow[] } }).result || r;
      const got = (inner as { clusters?: ClusterRow[] }).clusters || [];
      if (got.length === 0) {
        setErr(((r as { reason?: string; error?: string }).reason) || 'no clusters');
      } else {
        setClusters(got);
        if (onApplyClusters) onApplyClusters(got);
        setOk(`${got.length} ${clusterMode} clusters`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'request failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleSummarize() {
    if (elements.length === 0) return setErr('Add some stickies first.');
    setBusy('summary'); setErr(null); setOk(null); setSummary(null);
    try {
      const r = await callMacro<SummaryShape & { reason?: string }>('summarize', {
        elements: elements.map((e) => ({ id: e.id, text: e.text || e.label || '' })),
      });
      if (r?.ok) {
        setSummary({ summary: r.summary, action_items: r.action_items, decisions: r.decisions, themes: r.themes, source: r.source });
        setOk(`Summarised (${r.source})`);
      } else {
        setErr(r?.reason || 'summarize failed');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'request failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleMint() {
    if (!boardId) return setErr('Save the board to the DB first (use the AI panel\'s board, or create a Concord-DB board).');
    setBusy('mint'); setErr(null); setOk(null);
    try {
      const r = await callMacro<{ dtuId?: string; reason?: string }>('export_as_dtu', {
        boardId, scope: mintScope, license: mintLicense, priceCents: mintPriceCents,
      });
      if (r?.ok && r.dtuId) {
        setLastDtuId(r.dtuId);
        setOk(`Minted ${r.dtuId.slice(0, 32)}…`);
      } else {
        setErr(r?.reason || 'mint failed');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'request failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleImage(file: File) {
    setBusy('image'); setErr(null); setOk(null);
    try {
      const qs = boardId ? `?board_id=${encodeURIComponent(boardId)}` : '';
      const res = await fetch(`/api/whiteboard/upload-image${qs}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': file.type || 'image/png' },
        body: file,
      });
      const json = await res.json();
      if (!json?.ok) { setErr(json?.reason || 'upload failed'); return; }
      setOk(`Uploaded ${(file.size / 1024).toFixed(1)} KB`);
      if (onAddImageElement) onAddImageElement({ url: json.url, dtuId: json.dtuId, bytes: json.bytes });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col h-full bg-lattice-deep border-l border-lattice-border text-sm">
      <header className="px-3 py-2 border-b border-lattice-border flex items-center gap-2">
        <Brain className="w-4 h-4 text-neon-purple" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Concord AI</span>
      </header>
      <nav className="flex gap-1 px-2 py-1 border-b border-lattice-border text-[10px]">
        {(['brainstorm', 'cluster', 'summarize', 'mint', 'image'] as const).map((t) => (
          <button
            key={t} onClick={() => setTab(t)}
            className={cn(
              'px-2 py-1 rounded uppercase tracking-wider',
              tab === t ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-500 hover:text-white'
            )}
          >{t}</button>
        ))}
      </nav>

      {err && (
        <div className="m-2 px-2 py-1 text-[10px] text-red-300 bg-red-500/10 rounded flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {err}
          <button onClick={() => setErr(null)} className="ml-auto">×</button>
        </div>
      )}
      {ok && <div className="m-2 px-2 py-1 text-[10px] text-emerald-300 bg-emerald-500/10 rounded">{ok}</div>}

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 text-xs">
        {tab === 'brainstorm' && (
          <>
            <textarea
              value={bsPrompt} onChange={(e) => setBsPrompt(e.target.value)}
              placeholder="Topic for brainstorm — e.g. coffee shop concept, sprint retro themes"
              rows={2}
              className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white resize-none"
            />
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-400">
                count:
                <input
                  type="number" min={1} max={50} value={bsCount}
                  onChange={(e) => setBsCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                  className="ml-1 w-12 px-1 py-0.5 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                />
              </label>
              <button
                onClick={handleBrainstorm} disabled={busy !== null || !bsPrompt.trim()}
                className="text-[10px] px-3 py-1 rounded bg-neon-purple text-white font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {busy === 'brainstorm' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Generate
              </button>
            </div>
            {bsIdeas.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{bsIdeas.length} ideas · {bsSource}</div>
                <ul className="space-y-0.5 max-h-48 overflow-y-auto">
                  {bsIdeas.map((idea, i) => (
                    <li key={i} className="px-2 py-1 bg-lattice-surface rounded flex items-start gap-1 text-[11px]">
                      <GripVertical className="w-3 h-3 text-gray-500 mt-0.5 shrink-0" />
                      <span className="flex-1 text-gray-300">{idea}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => { onAddStickies(bsIdeas); setOk(`Added ${bsIdeas.length} stickies to the board`); }}
                  className="text-[10px] px-3 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 inline-flex items-center gap-1"
                >
                  <ListChecks className="w-3 h-3" /> Add all to board
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'cluster' && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-400 flex items-center gap-1">
                mode:
                <select
                  value={clusterMode} onChange={(e) => setClusterMode(e.target.value as 'semantic' | 'spatial')}
                  className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-0.5 text-white"
                >
                  <option value="semantic">semantic (Ollama embeddings)</option>
                  <option value="spatial">spatial (proximity BFS)</option>
                </select>
              </label>
              <button
                onClick={handleCluster} disabled={busy !== null || elements.length === 0}
                className="ml-auto text-[10px] px-3 py-1 rounded bg-neon-purple text-white font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {busy === 'cluster' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                Cluster {elements.length}
              </button>
            </div>
            {clusters.length > 0 && (
              <ul className="space-y-1 mt-2 max-h-48 overflow-y-auto">
                {clusters.map((c) => (
                  <li key={c.clusterId} className="px-2 py-1 bg-lattice-surface rounded text-[11px]">
                    <div className="text-emerald-300 font-medium">{c.label}</div>
                    <div className="text-[10px] text-gray-500">{c.elements.length} element{c.elements.length === 1 ? '' : 's'}</div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'summarize' && (
          <>
            <button
              onClick={handleSummarize} disabled={busy !== null || elements.length === 0}
              className="text-[10px] px-3 py-1 rounded bg-neon-purple text-white font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {busy === 'summary' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListChecks className="w-3 h-3" />}
              Summarize {elements.length} elements
            </button>
            {summary && (
              <div className="mt-2 space-y-2 text-[11px]">
                <div className="bg-lattice-surface p-2 rounded">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Summary ({summary.source})</div>
                  <div className="text-gray-300">{summary.summary}</div>
                </div>
                {summary.action_items?.length > 0 && (
                  <div className="bg-lattice-surface p-2 rounded">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-1">Action items</div>
                    <ul className="space-y-0.5">{summary.action_items.map((a, i) => <li key={i} className="text-gray-300">• {a}</li>)}</ul>
                  </div>
                )}
                {summary.decisions?.length > 0 && (
                  <div className="bg-lattice-surface p-2 rounded">
                    <div className="text-[10px] uppercase tracking-wider text-amber-300 mb-1">Decisions</div>
                    <ul className="space-y-0.5">{summary.decisions.map((a, i) => <li key={i} className="text-gray-300">• {a}</li>)}</ul>
                  </div>
                )}
                {summary.themes && summary.themes.length > 0 && (
                  <div className="bg-lattice-surface p-2 rounded">
                    <div className="text-[10px] uppercase tracking-wider text-cyan-300 mb-1">Themes</div>
                    <div className="flex flex-wrap gap-1">{summary.themes.map((t, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 bg-cyan-500/10 text-cyan-200 rounded">{t}</span>)}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'mint' && (
          <>
            {!boardId ? (
              <div className="text-[10px] text-gray-500">
                Mint requires a DB-backed board. Save the current board via Concord-DB first.
              </div>
            ) : (
              <>
                <div className="text-[10px] text-gray-400">Export this board as a kind=&apos;whiteboard_board&apos; DTU. Public scope makes it citable; the royalty cascade pays you forever when others cite or buy.</div>
                <label className="flex items-center gap-2 text-[10px] text-gray-400">
                  scope:
                  <select value={mintScope} onChange={(e) => setMintScope(e.target.value as 'personal' | 'public')} className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-0.5 text-white">
                    <option value="personal">personal</option>
                    <option value="public">public (citable)</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[10px] text-gray-400">
                  license:
                  <select value={mintLicense} onChange={(e) => setMintLicense(e.target.value)} className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-0.5 text-white">
                    <option value="proprietary">proprietary</option>
                    <option value="MIT">MIT</option>
                    <option value="CC-BY-SA">CC-BY-SA</option>
                    <option value="Apache-2.0">Apache-2.0</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[10px] text-gray-400">
                  price (cents):
                  <input type="number" min={0} max={100000} value={mintPriceCents} onChange={(e) => setMintPriceCents(Math.max(0, Math.min(100_000, Number(e.target.value) || 0)))} className="w-16 px-1 py-0.5 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                </label>
                <button
                  onClick={handleMint} disabled={busy !== null}
                  className="text-[10px] px-3 py-1 rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {busy === 'mint' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  Mint as DTU
                </button>
                {lastDtuId && <div className="text-[10px] text-emerald-300 font-mono break-all">DTU: {lastDtuId}</div>}
              </>
            )}
          </>
        )}

        {tab === 'image' && (
          <>
            <div className="text-[10px] text-gray-400">Upload an image to the board. Mints a kind=&apos;whiteboard_image&apos; DTU.</div>
            <input
              ref={fileRef}
              type="file" accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImage(f); }}
              className="text-[10px] text-gray-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-lattice-border file:bg-lattice-deep file:text-white file:cursor-pointer"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="text-[10px] px-3 py-1 rounded bg-neon-purple text-white font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {busy === 'image' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImagePlus className="w-3 h-3" />}
              Choose file
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default ConcordAIPanel;
