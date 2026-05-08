'use client';

import { useState, useCallback, useEffect } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { useQuery } from '@tanstack/react-query';
import { useRunArtifact, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { api } from '@/lib/api/client';
import { FEAResultViewer } from '@/components/engineering/FEAResultViewer';
import {
  Wrench,
  Plus,
  Trash2,
  Zap,
  Loader2,
  CheckCircle,
  XCircle,
  FlaskConical,
  Atom,
  BarChart3,
  Layers,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Node3D {
  id: string;
  x: number;
  y: number;
  z: number;
}
interface Member {
  id: string;
  nodeI: string;
  nodeJ: string;
  area: number;
  momentI: number;
  elasticModulus: number;
  allowableStress?: number;
  material?: string;
}
interface Load {
  nodeId: string;
  Fx?: number;
  Fy?: number;
  Fz?: number;
  Mx?: number;
  My?: number;
  Mz?: number;
}
interface Support {
  nodeId: string;
  type: 'fixed' | 'pinned' | 'roller';
  fixedDOF?: string[];
}
interface FEAModel {
  nodes: Node3D[];
  members: Member[];
  loads: Load[];
  supports: Support[];
}

const MATERIALS: Record<string, { E: number; allowable: number; density: number; label: string }> =
  {
    'A36 Steel': { E: 29e6, allowable: 21600, density: 0.284, label: 'A36 Steel (36 ksi)' },
    'A992 Steel': { E: 29e6, allowable: 30000, density: 0.284, label: 'A992 Steel (50 ksi)' },
    '6061-T6 Aluminum': { E: 10e6, allowable: 19000, density: 0.098, label: '6061-T6 Aluminum' },
    'Grade 60 Rebar': { E: 29e6, allowable: 40000, density: 0.284, label: 'Grade 60 Rebar' },
    '3000 psi Concrete': {
      E: 3122019,
      allowable: 1350,
      density: 0.087,
      label: '3000 psi Concrete',
    },
    'Douglas Fir': { E: 1.9e6, allowable: 1500, density: 0.019, label: 'Douglas Fir (lumber)' },
  };

const TABS = ['Model', 'Loads', 'Materials', 'Analysis', 'Results'] as const;
type Tab = (typeof TABS)[number];

// ── Default FEA template (simple portal frame) ───────────────────────────────
const DEFAULT_FEA_MODEL: FEAModel = {
  nodes: [
    { id: 'N1', x: 0, y: 0, z: 0 },
    { id: 'N2', x: 0, y: 12, z: 0 },
    { id: 'N3', x: 20, y: 12, z: 0 },
    { id: 'N4', x: 20, y: 0, z: 0 },
  ],
  members: [
    {
      id: 'M1',
      nodeI: 'N1',
      nodeJ: 'N2',
      area: 8.25,
      momentI: 82.8,
      elasticModulus: 29e6,
      allowableStress: 21600,
      material: 'A36 Steel',
    },
    {
      id: 'M2',
      nodeI: 'N2',
      nodeJ: 'N3',
      area: 11.8,
      momentI: 171,
      elasticModulus: 29e6,
      allowableStress: 21600,
      material: 'A36 Steel',
    },
    {
      id: 'M3',
      nodeI: 'N4',
      nodeJ: 'N3',
      area: 8.25,
      momentI: 82.8,
      elasticModulus: 29e6,
      allowableStress: 21600,
      material: 'A36 Steel',
    },
  ],
  loads: [
    { nodeId: 'N2', Fy: -10000 },
    { nodeId: 'N3', Fy: -10000 },
  ],
  supports: [
    { nodeId: 'N1', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
    { nodeId: 'N4', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
  ],
};

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function EngineeringPage() {
  const [tab, setTab] = useState<Tab>('Model');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-results', keys: 'r', description: 'Results', category: 'navigation', action: () => setTab('Results') },
      { id: 'tab-analysis', keys: 'a', description: 'Analysis', category: 'navigation', action: () => setTab('Analysis') },
    ],
    { lensId: 'engineering' }
  );
  const [model, setModel] = useState<FEAModel>(DEFAULT_FEA_MODEL);
  const [feaResult, setFeaResult] = useState<Record<string, unknown> | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>('');

  const runAction = useRunArtifact('engineering');
  const createArtifact = useCreateArtifact('engineering');

  // Poll async FEA job
  const { data: jobData } = useQuery({
    queryKey: ['sim-job', jobId],
    queryFn: () => api.get(`/api/simulation/${jobId}`).then((r) => r.data),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const st = (q.state.data as { job?: { status?: string } } | undefined)?.job?.status;
      return st === 'completed' || st === 'failed' ? false : 2000;
    },
  });

  useEffect(() => {
    if (!jobData?.job) return;
    const j = jobData.job as { status: string; result?: unknown; error?: string };
    if (j.status === 'completed' && j.result) {
      setFeaResult(j.result as Record<string, unknown>);
      setJobId(null);
      setRunning(false);
      setStatus('Analysis complete');
      setTab('Results');
    } else if (j.status === 'failed') {
      setJobId(null);
      setRunning(false);
      setStatus(`Analysis failed: ${j.error}`);
    } else {
      setStatus(`Running… (${j.status})`);
    }
  }, [jobData]);

  const runFEA = useCallback(() => {
    setRunning(true);
    setStatus('Submitting…');
    setFeaResult(null);

    // Save model as artifact first
    const payload = { type: 'fea-model', title: 'FEA Model', data: { model } };
    createArtifact.mutate(payload, {
      onSuccess: (res) => {
        const id = res?.artifact?.id ?? 'temp';
        runAction.mutate(
          { id, action: 'runFEA', params: { model } },
          {
            onSuccess: (data: unknown) => {
              const d = data as { ok?: boolean; async?: boolean; jobId?: string; result?: unknown };
              if (d?.async && d?.jobId) {
                setJobId(d.jobId);
                setStatus('Running async…');
              } else if (d?.result) {
                setFeaResult(d.result as Record<string, unknown>);
                setRunning(false);
                setStatus('Analysis complete');
                setTab('Results');
              }
            },
            onError: (e) => {
              setRunning(false);
              setStatus(`Error: ${e.message}`);
            },
          }
        );
      },
      onError: (e) => {
        setRunning(false);
        setStatus(`Error: ${e.message}`);
      },
    });
  }, [model, createArtifact, runAction]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const addNode = () => {
    const id = `N${model.nodes.length + 1}`;
    setModel((m) => ({ ...m, nodes: [...m.nodes, { id, x: 0, y: 0, z: 0 }] }));
  };

  const updateNode = (idx: number, field: keyof Node3D, val: string) => {
    setModel((m) => {
      const nodes = [...m.nodes];
      nodes[idx] = { ...nodes[idx], [field]: field === 'id' ? val : parseFloat(val) || 0 };
      return { ...m, nodes };
    });
  };

  const removeNode = (idx: number) => {
    setModel((m) => ({ ...m, nodes: m.nodes.filter((_, i) => i !== idx) }));
  };

  const addMember = () => {
    const id = `M${model.members.length + 1}`;
    setModel((m) => ({
      ...m,
      members: [
        ...m.members,
        {
          id,
          nodeI: m.nodes[0]?.id || 'N1',
          nodeJ: m.nodes[1]?.id || 'N2',
          area: 8.25,
          momentI: 82.8,
          elasticModulus: 29e6,
          allowableStress: 21600,
          material: 'A36 Steel',
        },
      ],
    }));
  };

  const updateMember = (idx: number, field: keyof Member, val: string) => {
    setModel((m) => {
      const members = [...m.members];
      const numFields: (keyof Member)[] = ['area', 'momentI', 'elasticModulus', 'allowableStress'];
      members[idx] = {
        ...members[idx],
        [field]: numFields.includes(field) ? parseFloat(val) || 0 : val,
      };
      if (field === 'material' && MATERIALS[val]) {
        members[idx].elasticModulus = MATERIALS[val].E;
        members[idx].allowableStress = MATERIALS[val].allowable;
      }
      return { ...m, members };
    });
  };

  const removeMember = (idx: number) => {
    setModel((m) => ({ ...m, members: m.members.filter((_, i) => i !== idx) }));
  };

  const addLoad = () => {
    setModel((m) => ({ ...m, loads: [...m.loads, { nodeId: m.nodes[0]?.id || 'N1', Fy: -1000 }] }));
  };

  const updateLoad = (idx: number, field: string, val: string) => {
    setModel((m) => {
      const loads = [...m.loads];
      loads[idx] = { ...loads[idx], [field]: field === 'nodeId' ? val : parseFloat(val) || 0 };
      return { ...m, loads };
    });
  };

  const removeLoad = (idx: number) => {
    setModel((m) => ({ ...m, loads: m.loads.filter((_, i) => i !== idx) }));
  };

  // ── FEA result extraction ────────────────────────────────────────────────────
  const feaNodes = feaResult
    ? ((
        feaResult as { displacements?: { nodeId: string; dx: number; dy: number; dz: number }[] }
      ).displacements
        ?.map((d) => {
          const n = model.nodes.find((n) => n.id === d.nodeId);
          return n ? { id: n.id, x: n.x, y: n.y, z: n.z || 0 } : null;
        })
        .filter(Boolean) as { id: string; x: number; y: number; z: number }[])
    : [];

  const feaMembers = feaResult
    ? ((
        feaResult as { utilization?: { id: string; utilization: number; combinedStress: number }[] }
      ).utilization
        ?.map((u) => {
          const m = model.members.find((m) => m.id === u.id);
          return m
            ? {
                id: u.id,
                nodeI: m.nodeI,
                nodeJ: m.nodeJ,
                utilization: u.utilization,
                stress: u.combinedStress,
              }
            : null;
        })
        .filter(Boolean) as {
        id: string;
        nodeI: string;
        nodeJ: string;
        utilization: number;
        stress: number;
      }[])
    : [];

  const feaDisplacements = feaResult
    ? ((feaResult as { displacements?: { nodeId: string; dx: number; dy: number; dz: number }[] })
        .displacements ?? [])
    : [];

  const summary = feaResult as {
    summary?: { maxDisplacement: number; maxUtilization: number; allPass: boolean };
  } | null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <LensShell lensId="engineering" asMain={false}>
    <div className="min-h-screen bg-lattice-void text-white p-4 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wrench className="w-7 h-7 text-neon-cyan" />
          <div>
            <h1 className="text-xl font-bold">Engineering Workspace</h1>
            <p className="text-xs text-gray-400">
              FEA · Structural · Thermal · Electrical · Hydraulic
            </p>
          </div>
        </div>
        <button
          onClick={runFEA}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 bg-neon-cyan text-black rounded-lg font-semibold text-sm hover:bg-neon-cyan/90 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Run FEA
        </button>
      </div>

      {/* Status bar */}
      {status && (
        <div
          className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 ${
            status.includes('Error') || status.includes('failed')
              ? 'bg-red-500/10 border border-red-500/30 text-red-400'
              : status.includes('complete')
                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                : 'bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan'
          }`}
        >
          {status.includes('complete') ? (
            <CheckCircle className="w-4 h-4" />
          ) : status.includes('Error') || status.includes('failed') ? (
            <XCircle className="w-4 h-4" />
          ) : (
            <Loader2 className="w-4 h-4 animate-spin" />
          )}
          {status}
        </div>
      )}

      {/* Summary cards (after FEA) */}
      {summary?.summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="panel p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Max Displacement</p>
            <p className="text-lg font-mono font-bold text-neon-cyan">
              {summary.summary.maxDisplacement.toFixed(4)}&quot;
            </p>
          </div>
          <div className="panel p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Max Utilization</p>
            <p
              className={`text-lg font-mono font-bold ${summary.summary.maxUtilization > 1 ? 'text-red-400' : 'text-green-400'}`}
            >
              {(summary.summary.maxUtilization * 100).toFixed(1)}%
            </p>
          </div>
          <div className="panel p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">All Members</p>
            <p
              className={`text-lg font-bold ${summary.summary.allPass ? 'text-green-400' : 'text-red-400'}`}
            >
              {summary.summary.allPass ? 'PASS ✓' : 'FAIL ✗'}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors rounded-t-lg ${
              tab === t
                ? 'bg-neon-cyan/20 text-neon-cyan border-b-2 border-neon-cyan'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Model Tab ──────────────────────────────────────────────────────────── */}
      {tab === 'Model' && (
        <div className="space-y-4">
          {/* Nodes */}
          <div className="panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Atom className="w-4 h-4 text-neon-cyan" /> Nodes
              </h3>
              <button
                onClick={addNode}
                className="text-xs px-2 py-1 bg-neon-cyan/20 text-neon-cyan rounded hover:bg-neon-cyan/30"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Node
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-white/10">
                    <th className="text-left py-1 px-2">ID</th>
                    <th className="text-right py-1 px-2">X (ft)</th>
                    <th className="text-right py-1 px-2">Y (ft)</th>
                    <th className="text-right py-1 px-2">Z (ft)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {model.nodes.map((n, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1 px-2">
                        <input
                          className="w-16 bg-black/30 border border-white/10 rounded px-1 font-mono"
                          value={n.id}
                          onChange={(e) => updateNode(i, 'id', e.target.value)}
                        />
                      </td>
                      {(['x', 'y', 'z'] as const).map((f) => (
                        <td key={f} className="py-1 px-2 text-right">
                          <input
                            className="w-20 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                            value={n[f]}
                            onChange={(e) => updateNode(i, f, e.target.value)}
                          />
                        </td>
                      ))}
                      <td className="py-1 px-1">
                        <button
                          onClick={() => removeNode(i)}
                          className="text-gray-600 hover:text-red-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Members */}
          <div className="panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" /> Members
              </h3>
              <button
                onClick={addMember}
                className="text-xs px-2 py-1 bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/30"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Member
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-white/10">
                    <th className="text-left py-1 px-2">ID</th>
                    <th className="text-left py-1 px-2">Node I</th>
                    <th className="text-left py-1 px-2">Node J</th>
                    <th className="text-right py-1 px-2">A (in²)</th>
                    <th className="text-right py-1 px-2">I (in⁴)</th>
                    <th className="text-left py-1 px-2">Material</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {model.members.map((m, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1 px-2 font-mono">{m.id}</td>
                      <td className="py-1 px-2">
                        <select
                          className="bg-black/30 border border-white/10 rounded px-1"
                          value={m.nodeI}
                          onChange={(e) => updateMember(i, 'nodeI', e.target.value)}
                        >
                          {model.nodes.map((n) => (
                            <option key={n.id}>{n.id}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 px-2">
                        <select
                          className="bg-black/30 border border-white/10 rounded px-1"
                          value={m.nodeJ}
                          onChange={(e) => updateMember(i, 'nodeJ', e.target.value)}
                        >
                          {model.nodes.map((n) => (
                            <option key={n.id}>{n.id}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 px-2 text-right">
                        <input
                          className="w-16 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                          value={m.area}
                          onChange={(e) => updateMember(i, 'area', e.target.value)}
                        />
                      </td>
                      <td className="py-1 px-2 text-right">
                        <input
                          className="w-16 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                          value={m.momentI}
                          onChange={(e) => updateMember(i, 'momentI', e.target.value)}
                        />
                      </td>
                      <td className="py-1 px-2">
                        <select
                          className="bg-black/30 border border-white/10 rounded px-1 text-xs"
                          value={m.material || 'A36 Steel'}
                          onChange={(e) => updateMember(i, 'material', e.target.value)}
                        >
                          {Object.keys(MATERIALS).map((k) => (
                            <option key={k}>{k}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 px-1">
                        <button
                          onClick={() => removeMember(i)}
                          className="text-gray-600 hover:text-red-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Supports */}
          <div className="panel p-4 space-y-2">
            <h3 className="font-semibold text-sm">Supports</h3>
            <div className="flex flex-wrap gap-2">
              {model.nodes.map((n) => {
                const sup = model.supports.find((s) => s.nodeId === n.id);
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      setModel((m) => {
                        const existing = m.supports.find((s) => s.nodeId === n.id);
                        if (existing) {
                          return { ...m, supports: m.supports.filter((s) => s.nodeId !== n.id) };
                        }
                        return {
                          ...m,
                          supports: [
                            ...m.supports,
                            {
                              nodeId: n.id,
                              type: 'fixed',
                              fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'],
                            },
                          ],
                        };
                      });
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      sup
                        ? 'bg-neon-cyan/20 border-neon-cyan/50 text-neon-cyan'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30'
                    }`}
                  >
                    {n.id} {sup ? '⊥ Fixed' : '○ Free'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Loads Tab ──────────────────────────────────────────────────────────── */}
      {tab === 'Loads' && (
        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Point Loads</h3>
            <button
              onClick={addLoad}
              className="text-xs px-2 py-1 bg-orange-500/20 text-orange-400 rounded hover:bg-orange-500/30"
            >
              <Plus className="w-3 h-3 inline mr-1" />
              Load
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-1 px-2">Node</th>
                  <th className="text-right py-1 px-2">Fx (lb)</th>
                  <th className="text-right py-1 px-2">Fy (lb)</th>
                  <th className="text-right py-1 px-2">Fz (lb)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {model.loads.map((l, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td className="py-1 px-2">
                      <select
                        className="bg-black/30 border border-white/10 rounded px-1"
                        value={l.nodeId}
                        onChange={(e) => updateLoad(i, 'nodeId', e.target.value)}
                      >
                        {model.nodes.map((n) => (
                          <option key={n.id}>{n.id}</option>
                        ))}
                      </select>
                    </td>
                    {(['Fx', 'Fy', 'Fz'] as const).map((f) => (
                      <td key={f} className="py-1 px-2 text-right">
                        <input
                          className="w-20 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                          value={l[f] ?? ''}
                          placeholder="0"
                          onChange={(e) => updateLoad(i, f, e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="py-1 px-1">
                      <button
                        onClick={() => removeLoad(i)}
                        className="text-gray-600 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {model.loads.length === 0 && (
            <p className="text-center text-gray-500 text-xs py-4">
              No loads defined. Add point loads above.
            </p>
          )}
        </div>
      )}

      {/* ── Materials Tab ──────────────────────────────────────────────────────── */}
      {tab === 'Materials' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(MATERIALS).map(([name, mat]) => (
            <div key={name} className="panel p-4 space-y-2">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-purple-400" />
                <h3 className="font-medium text-sm">{mat.label}</h3>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-black/20 rounded p-2 text-center">
                  <p className="text-gray-500">E</p>
                  <p className="font-mono text-neon-cyan">{(mat.E / 1e6).toFixed(1)} Msi</p>
                </div>
                <div className="bg-black/20 rounded p-2 text-center">
                  <p className="text-gray-500">F_allow</p>
                  <p className="font-mono text-green-400">
                    {(mat.allowable / 1000).toFixed(1)} ksi
                  </p>
                </div>
                <div className="bg-black/20 rounded p-2 text-center">
                  <p className="text-gray-500">ρ</p>
                  <p className="font-mono text-yellow-400">{mat.density} lb/in³</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                <p>
                  Strength/Weight:{' '}
                  <span className="text-white font-mono">
                    {(mat.allowable / mat.density / 1000).toFixed(0)} ksi·in³/lb
                  </span>
                </p>
                <p>
                  Stiffness/Weight:{' '}
                  <span className="text-white font-mono">
                    {(mat.E / mat.density / 1e9).toFixed(2)} Gsi·in³/lb
                  </span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Analysis Tab ───────────────────────────────────────────────────────── */}
      {tab === 'Analysis' && (
        <div className="space-y-4">
          <div className="panel p-4 space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-cyan" /> Model Summary
            </h3>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {[
                { label: 'Nodes', value: model.nodes.length, color: 'text-neon-cyan' },
                { label: 'Members', value: model.members.length, color: 'text-purple-400' },
                { label: 'Loads', value: model.loads.length, color: 'text-orange-400' },
                { label: 'Supports', value: model.supports.length, color: 'text-green-400' },
              ].map((s) => (
                <div key={s.label} className="bg-black/20 rounded-lg p-2">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-4 space-y-3">
            <h3 className="font-semibold text-sm">Run Analysis</h3>
            <p className="text-xs text-gray-400">
              Models with ≤100 members run synchronously (&lt;20ms). Larger models use async jobs
              with status polling.
            </p>
            <button
              onClick={runFEA}
              disabled={running || model.members.length === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-neon-cyan text-black rounded-lg font-bold hover:bg-neon-cyan/90 disabled:opacity-50"
            >
              {running ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
              {running ? status : `Run FEA (${model.members.length} members)`}
            </button>
          </div>
        </div>
      )}

      {/* ── Results Tab ────────────────────────────────────────────────────────── */}
      {tab === 'Results' && (
        <div className="space-y-4">
          {!feaResult ? (
            <div className="panel p-8 text-center space-y-3">
              <Zap className="w-10 h-10 text-gray-600 mx-auto" />
              <p className="text-gray-400">No results yet. Run FEA from the Analysis tab.</p>
              <button
                onClick={() => setTab('Analysis')}
                className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30"
              >
                Go to Analysis
              </button>
            </div>
          ) : (
            <FEAResultViewer
              nodes={feaNodes ?? []}
              members={feaMembers ?? []}
              displacements={feaDisplacements}
              amplification={10}
              showDeformed={true}
              showStress={true}
              height="500px"
            />
          )}
        </div>
      )}
    </div>
    </LensShell>
  );
}
