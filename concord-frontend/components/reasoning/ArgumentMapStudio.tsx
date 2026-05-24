'use client';

/**
 * ArgumentMapStudio — Kialo / Rationale-shape visual argument-mapping
 * surface for the reasoning lens. Unlike ArgumentWorkbench (stateless
 * one-shot analysis), this component drives the *persistent* argument-map
 * substrate in server/domains/reasoning.js. Every panel here is wired to
 * a real backend macro:
 *
 *   map-list / map-create / map-get / map-update / map-delete
 *   node-add / node-update / node-delete   (pro/con branching)
 *   evidence-attach / evidence-detach      (strength-weighted evidence)
 *   collaborator-add / collaborator-remove (collaborative debate)
 *   map-score                              (conclusion-confidence scoring)
 *   map-export                             (markdown / outline / json)
 *   scheme-list / scheme-instantiate       (reasoning-scheme library)
 *
 * The visual tree is rendered with the shared TreeDiagram from
 * components/viz, tinting pro nodes green, con nodes rose, neutral indigo.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GitBranch, Plus, Trash2, RefreshCw, Loader2, ThumbsUp, ThumbsDown,
  Scale, Link2, Users, Download, BookOpen, X, Check, AlertTriangle,
  FlaskConical, Gauge, ChevronRight,
} from 'lucide-react';
import { TreeDiagram, type TreeNode } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types mirroring the backend substrate                              */
/* ------------------------------------------------------------------ */

type Stance = 'pro' | 'con' | 'neutral';

interface EvidenceRow {
  id: string;
  title: string;
  source: string;
  url: string;
  type: string;
  credibility: number;
  relevance: number;
  weight: number;
  addedBy: string;
}

interface MapNode {
  id: string;
  text: string;
  type: string;
  stance: Stance;
  strength: number;
  author: string;
  evidence: EvidenceRow[];
  children: MapNode[];
}

interface MapSummary {
  id: string;
  title: string;
  rootClaim: string;
  scheme: string;
  status: string;
  ownerId: string;
  collaborators: string[];
  nodeCount: number;
  updatedAt: string;
}

interface FullMap extends MapSummary {
  nodes: MapNode[];
}

interface Scheme {
  id: string;
  name: string;
  category: string;
  description: string;
  slots: string[];
  criticalQuestions: string[];
}

interface ScoreNodeStat { id: string; text: string; stance: Stance; score: number; evidenceCount: number }
interface ScoreResult {
  confidence: number;
  verdict: string;
  perNode: ScoreNodeStat[];
  stats: { proCount: number; conCount: number; evidenceTotal: number; nodeCount: number };
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STANCE_TONE: Record<Stance, TreeNode['tone']> = {
  pro: 'good',
  con: 'bad',
  neutral: 'info',
};

const STANCE_MARK: Record<Stance, string> = { pro: '[+]', con: '[-]', neutral: '[=]' };

function toTree(node: MapNode): TreeNode {
  const evCount = (node.evidence || []).length;
  return {
    id: node.id,
    label: `${STANCE_MARK[node.stance]} ${node.text}`,
    detail: `${node.type} · strength ${node.strength}/5${evCount ? ` · ${evCount} evidence` : ''}`,
    tone: STANCE_TONE[node.stance],
    children: (node.children || []).map(toTree),
  };
}

function findNode(nodes: MapNode[], id: string): MapNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNode(n.children || [], id);
    if (f) return f;
  }
  return null;
}

function pickError(r: { error: string | null }): string {
  return r.error || 'request failed';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ArgumentMapStudio() {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [activeMap, setActiveMap] = useState<FullMap | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // New-map form
  const [showNewMap, setShowNewMap] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newClaim, setNewClaim] = useState('');

  // Add-node form
  const [addStance, setAddStance] = useState<Stance>('pro');
  const [addText, setAddText] = useState('');
  const [addStrength, setAddStrength] = useState(3);

  // Evidence form
  const [evTitle, setEvTitle] = useState('');
  const [evSource, setEvSource] = useState('');
  const [evUrl, setEvUrl] = useState('');
  const [evType, setEvType] = useState('empirical_study');
  const [evCred, setEvCred] = useState(3);
  const [evRel, setEvRel] = useState(3);
  const [evWeight, setEvWeight] = useState(3);

  // Collaborator form
  const [collabId, setCollabId] = useState('');

  // Scheme instantiate form
  const [showSchemes, setShowSchemes] = useState(false);
  const [activeScheme, setActiveScheme] = useState<Scheme | null>(null);
  const [schemeValues, setSchemeValues] = useState<Record<string, string>>({});

  // Export
  const [exportFormat, setExportFormat] = useState<'markdown' | 'outline' | 'json'>('markdown');
  const [exportContent, setExportContent] = useState<string | null>(null);

  const ok = (text: string) => setFeedback({ kind: 'ok', text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  /* ------------------------------ data loads ------------------------------ */

  const loadMaps = useCallback(async () => {
    const r = await lensRun<{ maps: MapSummary[] }>('reasoning', 'map-list', {});
    if (r.data.ok && r.data.result) setMaps(r.data.result.maps || []);
    else err(pickError(r.data));
  }, []);

  const loadSchemes = useCallback(async () => {
    const r = await lensRun<{ schemes: Scheme[] }>('reasoning', 'scheme-list', {});
    if (r.data.ok && r.data.result) setSchemes(r.data.result.schemes || []);
  }, []);

  const loadMap = useCallback(async (mapId: string) => {
    setBusy('load-map');
    const r = await lensRun<{ map: FullMap }>('reasoning', 'map-get', { mapId });
    setBusy(null);
    if (r.data.ok && r.data.result?.map) {
      setActiveMap(r.data.result.map);
      setSelectedNodeId(r.data.result.map.nodes[0]?.id || null);
      setScore(null);
      setExportContent(null);
    } else {
      err(pickError(r.data));
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadMaps(), loadSchemes()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------ map actions ------------------------------ */

  async function createMap() {
    if (!newTitle.trim() || !newClaim.trim()) { err('Title and root claim required.'); return; }
    setBusy('create-map');
    const r = await lensRun<{ map: FullMap }>('reasoning', 'map-create', {
      title: newTitle.trim(), rootClaim: newClaim.trim(), scheme: 'free',
    });
    setBusy(null);
    if (r.data.ok && r.data.result?.map) {
      setShowNewMap(false);
      setNewTitle(''); setNewClaim('');
      await loadMaps();
      setActiveMap(r.data.result.map);
      setSelectedNodeId(r.data.result.map.nodes[0]?.id || null);
      ok('Argument map created.');
    } else {
      err(pickError(r.data));
    }
  }

  async function deleteMap(mapId: string) {
    setBusy(`del-map-${mapId}`);
    const r = await lensRun('reasoning', 'map-delete', { mapId });
    setBusy(null);
    if (r.data.ok) {
      if (activeMap?.id === mapId) { setActiveMap(null); setScore(null); }
      await loadMaps();
      ok('Map deleted.');
    } else {
      err(pickError(r.data));
    }
  }

  async function setMapStatus(status: string) {
    if (!activeMap) return;
    setBusy('map-status');
    const r = await lensRun('reasoning', 'map-update', { mapId: activeMap.id, status });
    setBusy(null);
    if (r.data.ok) { await loadMaps(); await loadMap(activeMap.id); ok(`Status → ${status}.`); }
    else err(pickError(r.data));
  }

  /* ------------------------------ node actions ------------------------------ */

  async function addNode() {
    if (!activeMap || !selectedNodeId) { err('Select a node to branch from.'); return; }
    if (!addText.trim()) { err('Argument text required.'); return; }
    setBusy('add-node');
    const r = await lensRun('reasoning', 'node-add', {
      mapId: activeMap.id,
      parentId: selectedNodeId,
      text: addText.trim(),
      stance: addStance,
      strength: addStrength,
    });
    setBusy(null);
    if (r.data.ok) {
      setAddText('');
      await loadMap(activeMap.id);
      ok(`${addStance === 'pro' ? 'Supporting' : addStance === 'con' ? 'Opposing' : 'Neutral'} argument added.`);
    } else {
      err(pickError(r.data));
    }
  }

  async function updateNodeStrength(delta: number) {
    if (!activeMap || !selectedNodeId) return;
    const node = findNode(activeMap.nodes, selectedNodeId);
    if (!node) return;
    const next = Math.max(1, Math.min(5, node.strength + delta));
    if (next === node.strength) return;
    setBusy('node-strength');
    const r = await lensRun('reasoning', 'node-update', {
      mapId: activeMap.id, nodeId: selectedNodeId, strength: next,
    });
    setBusy(null);
    if (r.data.ok) { await loadMap(activeMap.id); setSelectedNodeId(selectedNodeId); }
    else err(pickError(r.data));
  }

  async function cycleNodeStance() {
    if (!activeMap || !selectedNodeId) return;
    const node = findNode(activeMap.nodes, selectedNodeId);
    if (!node) return;
    const order: Stance[] = ['pro', 'con', 'neutral'];
    const next = order[(order.indexOf(node.stance) + 1) % order.length];
    setBusy('node-stance');
    const r = await lensRun('reasoning', 'node-update', {
      mapId: activeMap.id, nodeId: selectedNodeId, stance: next,
    });
    setBusy(null);
    if (r.data.ok) { await loadMap(activeMap.id); setSelectedNodeId(selectedNodeId); }
    else err(pickError(r.data));
  }

  async function deleteNode() {
    if (!activeMap || !selectedNodeId) return;
    setBusy('del-node');
    const r = await lensRun('reasoning', 'node-delete', { mapId: activeMap.id, nodeId: selectedNodeId });
    setBusy(null);
    if (r.data.ok) {
      setSelectedNodeId(activeMap.nodes[0]?.id || null);
      await loadMap(activeMap.id);
      ok('Node removed.');
    } else {
      err(pickError(r.data));
    }
  }

  /* ------------------------------ evidence actions ------------------------------ */

  async function attachEvidence() {
    if (!activeMap || !selectedNodeId) { err('Select a node first.'); return; }
    if (!evTitle.trim()) { err('Evidence title required.'); return; }
    setBusy('attach-ev');
    const r = await lensRun('reasoning', 'evidence-attach', {
      mapId: activeMap.id,
      nodeId: selectedNodeId,
      title: evTitle.trim(),
      source: evSource.trim(),
      url: evUrl.trim(),
      evidenceType: evType,
      credibility: evCred,
      relevance: evRel,
      weight: evWeight,
    });
    setBusy(null);
    if (r.data.ok) {
      setEvTitle(''); setEvSource(''); setEvUrl('');
      await loadMap(activeMap.id);
      setSelectedNodeId(selectedNodeId);
      ok('Evidence linked.');
    } else {
      err(pickError(r.data));
    }
  }

  async function detachEvidence(evId: string) {
    if (!activeMap || !selectedNodeId) return;
    setBusy(`detach-${evId}`);
    const r = await lensRun('reasoning', 'evidence-detach', {
      mapId: activeMap.id, nodeId: selectedNodeId, evidenceId: evId,
    });
    setBusy(null);
    if (r.data.ok) { await loadMap(activeMap.id); setSelectedNodeId(selectedNodeId); ok('Evidence detached.'); }
    else err(pickError(r.data));
  }

  /* ------------------------------ collaborator actions ------------------------------ */

  async function addCollaborator() {
    if (!activeMap || !collabId.trim()) { err('Collaborator id required.'); return; }
    setBusy('add-collab');
    const r = await lensRun('reasoning', 'collaborator-add', {
      mapId: activeMap.id, collaboratorId: collabId.trim(),
    });
    setBusy(null);
    if (r.data.ok) { setCollabId(''); await loadMap(activeMap.id); ok('Collaborator added.'); }
    else err(pickError(r.data));
  }

  async function removeCollaborator(id: string) {
    if (!activeMap) return;
    setBusy(`rm-collab-${id}`);
    const r = await lensRun('reasoning', 'collaborator-remove', {
      mapId: activeMap.id, collaboratorId: id,
    });
    setBusy(null);
    if (r.data.ok) { await loadMap(activeMap.id); ok('Collaborator removed.'); }
    else err(pickError(r.data));
  }

  /* ------------------------------ score / export ------------------------------ */

  async function runScore() {
    if (!activeMap) return;
    setBusy('score');
    const r = await lensRun<ScoreResult>('reasoning', 'map-score', { mapId: activeMap.id });
    setBusy(null);
    if (r.data.ok && r.data.result) { setScore(r.data.result); ok(`Confidence: ${r.data.result.confidence}%`); }
    else err(pickError(r.data));
  }

  async function runExport() {
    if (!activeMap) return;
    setBusy('export');
    const r = await lensRun<{ content: string }>('reasoning', 'map-export', {
      mapId: activeMap.id, format: exportFormat,
    });
    setBusy(null);
    if (r.data.ok && r.data.result) {
      setExportContent(r.data.result.content);
      ok(`Exported as ${exportFormat}.`);
    } else {
      err(pickError(r.data));
    }
  }

  function downloadExport() {
    if (!exportContent || !activeMap) return;
    const ext = exportFormat === 'json' ? 'json' : exportFormat === 'markdown' ? 'md' : 'txt';
    const blob = new Blob([exportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `argument-map-${activeMap.title.replace(/\s+/g, '-').toLowerCase()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ------------------------------ scheme actions ------------------------------ */

  async function instantiateScheme() {
    if (!activeScheme) return;
    const rootSlot = activeScheme.slots[0];
    if (!schemeValues[rootSlot]?.trim()) { err(`${rootSlot} value required.`); return; }
    setBusy('scheme');
    const r = await lensRun<{ map: FullMap }>('reasoning', 'scheme-instantiate', {
      schemeId: activeScheme.id,
      title: `${activeScheme.name}`,
      values: schemeValues,
    });
    setBusy(null);
    if (r.data.ok && r.data.result?.map) {
      setShowSchemes(false);
      setActiveScheme(null);
      setSchemeValues({});
      await loadMaps();
      setActiveMap(r.data.result.map);
      setSelectedNodeId(r.data.result.map.nodes[0]?.id || null);
      ok('Argument map built from scheme.');
    } else {
      err(pickError(r.data));
    }
  }

  /* ------------------------------ derived ------------------------------ */

  const treeRoot = useMemo<TreeNode | null>(
    () => (activeMap && activeMap.nodes[0] ? toTree(activeMap.nodes[0]) : null),
    [activeMap],
  );
  const selectedNode = useMemo(
    () => (activeMap && selectedNodeId ? findNode(activeMap.nodes, selectedNodeId) : null),
    [activeMap, selectedNodeId],
  );
  const isRoot = !!(activeMap && selectedNodeId && activeMap.nodes[0]?.id === selectedNodeId);

  /* ------------------------------ render ------------------------------ */

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/50 py-12">
        <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center justify-between border-b border-cyan-500/10 pb-2">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Argument map studio</h3>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            kialo-style · persistent
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowSchemes((v) => !v)}
            className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            <BookOpen className="w-3 h-3" /> Schemes
          </button>
          <button
            type="button"
            onClick={() => setShowNewMap((v) => !v)}
            className="flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-300 hover:bg-cyan-500/20"
          >
            <Plus className="w-3 h-3" /> New map
          </button>
          <button
            type="button"
            onClick={loadMaps}
            className="rounded border border-zinc-800 bg-zinc-900/60 p-1 text-zinc-400 hover:bg-zinc-800"
            aria-label="Refresh maps"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </header>

      {/* New-map inline form */}
      {showNewMap && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-900/40 p-2.5 space-y-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Map title — e.g. Should remote work be the default?"
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[12px] text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
          />
          <textarea
            value={newClaim}
            onChange={(e) => setNewClaim(e.target.value)}
            rows={2}
            placeholder="Root claim — the central thesis to argue for or against"
            className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[12px] text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy === 'create-map'}
              onClick={createMap}
              className="flex items-center gap-1 rounded bg-cyan-500/20 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {busy === 'create-map' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create map
            </button>
            <button
              type="button"
              onClick={() => setShowNewMap(false)}
              className="rounded border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Scheme library */}
      {showSchemes && (
        <div className="rounded-lg border border-purple-500/20 bg-zinc-900/40 p-2.5 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5">
            <FlaskConical className="w-3 h-3" /> Reasoning-scheme library
          </p>
          {!activeScheme ? (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {schemes.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => { setActiveScheme(sc); setSchemeValues({}); }}
                  className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-left hover:border-purple-500/40 hover:bg-zinc-800/60"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-zinc-100">{sc.name}</span>
                    <span className="rounded bg-purple-500/15 px-1 py-0.5 text-[9px] uppercase text-purple-300">{sc.category}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-400 line-clamp-2">{sc.description}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-purple-200">{activeScheme.name}</span>
                <button
                  type="button"
                  onClick={() => { setActiveScheme(null); setSchemeValues({}); }}
                  className="text-zinc-400 hover:text-zinc-200"
                  aria-label="Back to scheme list"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-zinc-400">{activeScheme.description}</p>
              {activeScheme.slots.map((slot) => (
                <div key={slot}>
                  <label className="mb-0.5 block text-[10px] uppercase tracking-wider text-zinc-400">{slot}</label>
                  <input
                    type="text"
                    value={schemeValues[slot] || ''}
                    onChange={(e) => setSchemeValues((v) => ({ ...v, [slot]: e.target.value }))}
                    className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[12px] text-white focus:outline-none focus:ring-2 focus:ring-purple-400/40"
                  />
                </div>
              ))}
              {activeScheme.criticalQuestions.length > 0 && (
                <ul className="space-y-0.5 rounded border border-amber-500/20 bg-amber-500/5 p-2">
                  {activeScheme.criticalQuestions.map((q, i) => (
                    <li key={i} className="flex items-start gap-1 text-[10px] text-amber-200">
                      <ChevronRight className="mt-0.5 w-2.5 h-2.5 shrink-0" /> {q}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                disabled={busy === 'scheme'}
                onClick={instantiateScheme}
                className="flex items-center gap-1 rounded bg-purple-500/20 px-2.5 py-1 text-[11px] font-semibold text-purple-200 hover:bg-purple-500/30 disabled:opacity-50"
              >
                {busy === 'scheme' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3" />}
                Build map from scheme
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[230px_1fr]">
        {/* Map list */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Your maps ({maps.length})</p>
          {maps.length === 0 && (
            <p className="rounded border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-400">
              No argument maps yet. Create one or build from a scheme.
            </p>
          )}
          {maps.map((m) => (
            <div
              key={m.id}
              className={cn(
                'rounded-lg border p-2 transition-colors',
                activeMap?.id === m.id
                  ? 'border-cyan-500/40 bg-cyan-500/10'
                  : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700',
              )}
            >
              <button type="button" onClick={() => loadMap(m.id)} className="w-full text-left">
                <p className="truncate text-[12px] font-medium text-zinc-100">{m.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="rounded bg-purple-500/15 px-1 py-0.5 text-[9px] uppercase text-purple-300">{m.scheme}</span>
                  <span className={cn(
                    'rounded px-1 py-0.5 text-[9px] uppercase',
                    m.status === 'concluded' ? 'bg-emerald-500/15 text-emerald-300'
                      : m.status === 'archived' ? 'bg-zinc-700/40 text-zinc-400'
                      : 'bg-cyan-500/15 text-cyan-300',
                  )}>{m.status}</span>
                  <span className="text-[9px] text-zinc-400">{m.nodeCount} nodes</span>
                  {m.collaborators.length > 0 && (
                    <span className="flex items-center gap-0.5 text-[9px] text-zinc-400">
                      <Users className="w-2.5 h-2.5" />{m.collaborators.length}
                    </span>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={() => deleteMap(m.id)}
                disabled={busy === `del-map-${m.id}`}
                className="mt-1 flex items-center gap-1 text-[10px] text-rose-400/70 hover:text-rose-300 disabled:opacity-50"
              >
                {busy === `del-map-${m.id}` ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Trash2 className="w-2.5 h-2.5" />}
                Delete
              </button>
            </div>
          ))}
        </div>

        {/* Active map */}
        <div className="space-y-2.5">
          {!activeMap ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-12">
              <GitBranch className="mb-2 w-8 h-8 text-zinc-700" />
              <p className="text-[12px] text-zinc-400">Select a map to open the visual argument tree.</p>
            </div>
          ) : (
            <>
              {/* Map header */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold text-white">{activeMap.title}</p>
                  <p className="text-[10px] text-zinc-400">Root claim: {activeMap.rootClaim}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={activeMap.status}
                    onChange={(e) => setMapStatus(e.target.value)}
                    className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-300 focus:outline-none"
                  >
                    <option value="active">active</option>
                    <option value="draft">draft</option>
                    <option value="concluded">concluded</option>
                    <option value="archived">archived</option>
                  </select>
                  <button
                    type="button"
                    onClick={runScore}
                    disabled={busy === 'score'}
                    className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {busy === 'score' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gauge className="w-3 h-3" />}
                    Score
                  </button>
                </div>
              </div>

              {/* Confidence score */}
              {score && (
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
                      Conclusion confidence
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      {score.stats.proCount} pro · {score.stats.conCount} con · {score.stats.evidenceTotal} evidence
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          score.confidence >= 55 ? 'bg-emerald-400' : score.confidence >= 45 ? 'bg-amber-400' : 'bg-rose-400',
                        )}
                        style={{ width: `${score.confidence}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-[13px] font-bold text-white">{score.confidence}%</span>
                  </div>
                  <p className="mt-1 text-[11px] capitalize text-zinc-300">Verdict: {score.verdict.replace(/-/g, ' ')}</p>
                </div>
              )}

              {/* Visual tree */}
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                  Visual argument tree — tap a node to branch / link evidence
                </p>
                <TreeDiagram root={treeRoot} onSelect={(n) => setSelectedNodeId(n.id)} />
              </div>

              {/* Selected node panel */}
              {selectedNode ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-medium text-zinc-100">{selectedNode.text}</p>
                      <p className="text-[10px] text-zinc-400">
                        {selectedNode.type} · stance {selectedNode.stance} · strength {selectedNode.strength}/5 · by {selectedNode.author}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateNodeStrength(-1)}
                        disabled={busy === 'node-strength'}
                        className="rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                        aria-label="Decrease strength"
                      >−</button>
                      <button
                        type="button"
                        onClick={() => updateNodeStrength(1)}
                        disabled={busy === 'node-strength'}
                        className="rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                        aria-label="Increase strength"
                      >+</button>
                      <button
                        type="button"
                        onClick={cycleNodeStance}
                        disabled={busy === 'node-stance'}
                        className="flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        <Scale className="w-3 h-3" /> Stance
                      </button>
                      {!isRoot && (
                        <button
                          type="button"
                          onClick={deleteNode}
                          disabled={busy === 'del-node'}
                          className="rounded border border-rose-500/30 px-1.5 py-0.5 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                          aria-label="Delete node"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Add child node — pro/con branching */}
                  <div className="rounded border border-zinc-800 bg-zinc-950/50 p-2 space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Branch from this node</p>
                    <textarea
                      value={addText}
                      onChange={(e) => setAddText(e.target.value)}
                      rows={2}
                      placeholder="State the supporting or opposing argument…"
                      className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[12px] text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="flex items-center gap-1">
                        {(['pro', 'con', 'neutral'] as Stance[]).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setAddStance(s)}
                            className={cn(
                              'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] capitalize',
                              addStance === s
                                ? s === 'pro' ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                  : s === 'con' ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                                  : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                                : 'border-zinc-800 text-zinc-400 hover:bg-zinc-800',
                            )}
                          >
                            {s === 'pro' && <ThumbsUp className="w-2.5 h-2.5" />}
                            {s === 'con' && <ThumbsDown className="w-2.5 h-2.5" />}
                            {s}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                        Strength
                        <select
                          value={addStrength}
                          onChange={(e) => setAddStrength(Number(e.target.value))}
                          className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300"
                        >
                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={busy === 'add-node'}
                        onClick={addNode}
                        className="flex items-center gap-1 rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
                      >
                        {busy === 'add-node' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Plus className="w-2.5 h-2.5" />}
                        Add argument
                      </button>
                    </div>
                  </div>

                  {/* Evidence linking */}
                  <div className="rounded border border-zinc-800 bg-zinc-950/50 p-2 space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1">
                      <Link2 className="w-3 h-3" /> Evidence ({(selectedNode.evidence || []).length})
                    </p>
                    {(selectedNode.evidence || []).map((ev) => (
                      <div key={ev.id} className="flex items-start justify-between gap-2 rounded border border-zinc-800 bg-zinc-900/60 p-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] text-zinc-200">{ev.title}</p>
                          <p className="text-[9px] text-zinc-400">
                            {ev.source || 'no source'} · {ev.type.replace(/_/g, ' ')} · cred {ev.credibility}/5 · rel {ev.relevance}/5 · weight {ev.weight}/5
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => detachEvidence(ev.id)}
                          disabled={busy === `detach-${ev.id}`}
                          className="shrink-0 text-rose-400/70 hover:text-rose-300 disabled:opacity-50"
                          aria-label="Detach evidence"
                        >
                          {busy === `detach-${ev.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                        </button>
                      </div>
                    ))}
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="text" value={evTitle} onChange={(e) => setEvTitle(e.target.value)}
                        placeholder="Evidence title"
                        className="col-span-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                      />
                      <input
                        type="text" value={evSource} onChange={(e) => setEvSource(e.target.value)}
                        placeholder="Source"
                        className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                      />
                      <input
                        type="url" value={evUrl} onChange={(e) => setEvUrl(e.target.value)}
                        placeholder="URL (optional)"
                        className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                      />
                      <select
                        value={evType} onChange={(e) => setEvType(e.target.value)}
                        className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-300"
                      >
                        <option value="empirical_study">Empirical study</option>
                        <option value="statistical">Statistical</option>
                        <option value="expert_testimony">Expert testimony</option>
                        <option value="anecdotal">Anecdotal</option>
                        <option value="logical_proof">Logical proof</option>
                      </select>
                      <div className="flex items-center gap-1.5">
                        {([['Cred', evCred, setEvCred], ['Rel', evRel, setEvRel], ['Wt', evWeight, setEvWeight]] as const).map(
                          ([label, val, setter]) => (
                            <label key={label} className="flex items-center gap-0.5 text-[9px] text-zinc-400">
                              {label}
                              <select
                                value={val}
                                onChange={(e) => setter(Number(e.target.value))}
                                className="rounded border border-zinc-800 bg-zinc-900 px-0.5 py-0.5 text-[9px] text-zinc-300"
                              >
                                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                              </select>
                            </label>
                          ),
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy === 'attach-ev'}
                      onClick={attachEvidence}
                      className="flex items-center gap-1 rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
                    >
                      {busy === 'attach-ev' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Link2 className="w-2.5 h-2.5" />}
                      Link evidence
                    </button>
                  </div>
                </div>
              ) : (
                <p className="rounded border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-400">
                  Select a node in the tree above to branch arguments or attach evidence.
                </p>
              )}

              {/* Collaborators */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1">
                  <Users className="w-3 h-3" /> Collaborative debate ({activeMap.collaborators.length})
                </p>
                {activeMap.collaborators.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {activeMap.collaborators.map((cId) => (
                      <span key={cId} className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                        {cId}
                        <button
                          type="button"
                          onClick={() => removeCollaborator(cId)}
                          disabled={busy === `rm-collab-${cId}`}
                          className="text-rose-400/70 hover:text-rose-300 disabled:opacity-50"
                          aria-label="Remove collaborator"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={collabId}
                    onChange={(e) => setCollabId(e.target.value)}
                    placeholder="Collaborator user id"
                    className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                  />
                  <button
                    type="button"
                    disabled={busy === 'add-collab'}
                    onClick={addCollaborator}
                    className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {busy === 'add-collab' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Plus className="w-2.5 h-2.5" />}
                    Invite
                  </button>
                </div>
              </div>

              {/* Export */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1">
                  <Download className="w-3 h-3" /> Export argument map
                </p>
                <div className="flex items-center gap-1.5">
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as 'markdown' | 'outline' | 'json')}
                    className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-300"
                  >
                    <option value="markdown">Markdown</option>
                    <option value="outline">Outline</option>
                    <option value="json">JSON</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy === 'export'}
                    onClick={runExport}
                    className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {busy === 'export' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Download className="w-2.5 h-2.5" />}
                    Generate
                  </button>
                  {exportContent && (
                    <button
                      type="button"
                      onClick={downloadExport}
                      className="rounded border border-cyan-500/30 px-2 py-1 text-[10px] text-cyan-300 hover:bg-cyan-500/10"
                    >
                      Download file
                    </button>
                  )}
                </div>
                {exportContent && (
                  <pre className="max-h-48 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-[10px] text-zinc-300 whitespace-pre-wrap">
                    {exportContent}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={cn(
            'flex items-start gap-2 rounded border px-2.5 py-1.5 text-[11px]',
            feedback.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300',
          )}
        >
          {feedback.kind === 'ok' ? <Check className="mt-0.5 w-3 h-3" /> : <AlertTriangle className="mt-0.5 w-3 h-3" />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
}
