'use client';

/**
 * Shared FEA session for the engineering lens — model, materials, load cases,
 * mesh, runFEA. Extracted from the welded page so Model/Loads/Materials/
 * Analysis/Results panels share one store without a second view machine.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useRunArtifact, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { lensRun } from '@/lib/api/client';
import {
  DEFAULT_FEA_MODEL,
  MATERIALS,
  type EngView,
  type FEAModel,
  type LibMaterial,
  type Member,
  type Node3D,
  type SavedLoadCase,
} from './types';

interface EngineeringFeaStore {
  active: EngView;
  setActive: (v: EngView) => void;
  model: FEAModel;
  setModel: Dispatch<SetStateAction<FEAModel>>;
  feaResult: Record<string, unknown> | null;
  running: boolean;
  status: string;
  historyKey: number;
  libMaterials: LibMaterial[];
  matCategories: string[];
  matFilter: string;
  setMatFilter: Dispatch<SetStateAction<string>>;
  matLoading: boolean;
  matError: string;
  loadMaterials: () => Promise<void>;
  loadCases: SavedLoadCase[];
  lcName: string;
  setLcName: Dispatch<SetStateAction<string>>;
  saveLoadCase: () => Promise<void>;
  applyLoadCase: (lc: SavedLoadCase) => void;
  deleteLoadCase: (id: string) => Promise<void>;
  meshDivisions: number;
  setMeshDivisions: Dispatch<SetStateAction<number>>;
  meshStats: {
    divisions: number;
    meshNodes: number;
    meshElements: number;
    avgElementLength: number;
  } | null;
  generateMesh: () => Promise<void>;
  runFEA: () => void;
  addNode: () => void;
  updateNode: (idx: number, field: keyof Node3D, val: string) => void;
  removeNode: (idx: number) => void;
  addMember: () => void;
  updateMember: (idx: number, field: keyof Member, val: string) => void;
  removeMember: (idx: number) => void;
  addLoad: () => void;
  updateLoad: (idx: number, field: string, val: string) => void;
  removeLoad: (idx: number) => void;
  toggleSupport: (nodeId: string) => void;
  feaNodes: { id: string; x: number; y: number; z: number }[];
  feaMembers: { id: string; nodeI: string; nodeJ: string; utilization: number; stress: number }[];
  feaDisplacements: { nodeId: string; dx: number; dy: number; dz: number }[];
  summary: { maxDisplacement: number; maxUtilization: number; allPass: boolean } | null;
}

const Ctx = createContext<EngineeringFeaStore | null>(null);

export function useEngineeringFea(): EngineeringFeaStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEngineeringFea must be used inside EngineeringFeaProvider');
  return v;
}

export function EngineeringFeaProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<EngView>('model');
  const [model, setModel] = useState<FEAModel>(DEFAULT_FEA_MODEL);
  const [feaResult, setFeaResult] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [historyKey, setHistoryKey] = useState(0);
  const [libMaterials, setLibMaterials] = useState<LibMaterial[]>([]);
  const [matCategories, setMatCategories] = useState<string[]>([]);
  const [matFilter, setMatFilter] = useState('all');
  const [matLoading, setMatLoading] = useState(true);
  const [matError, setMatError] = useState('');
  const [loadCases, setLoadCases] = useState<SavedLoadCase[]>([]);
  const [lcName, setLcName] = useState('Load Case 1');
  const [meshDivisions, setMeshDivisions] = useState(4);
  const [meshStats, setMeshStats] = useState<{
    divisions: number;
    meshNodes: number;
    meshElements: number;
    avgElementLength: number;
  } | null>(null);

  const runAction = useRunArtifact('engineering');
  const createArtifact = useCreateArtifact('engineering');

  const loadMaterials = useCallback(async () => {
    setMatLoading(true);
    setMatError('');
    try {
      const matRes = await lensRun<{ materials: LibMaterial[]; categories: string[] }>(
        'engineering',
        'materialLibrary',
        {},
      );
      if (matRes.data.ok && matRes.data.result) {
        setLibMaterials(matRes.data.result.materials || []);
        setMatCategories(matRes.data.result.categories || []);
      } else {
        setMatError(matRes.data.error || 'Failed to load material library');
      }
    } catch (e) {
      setMatError(e instanceof Error ? e.message : 'Failed to load material library');
    } finally {
      setMatLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMaterials();
    (async () => {
      const lcRes = await lensRun<{ loadCases: SavedLoadCase[] }>('engineering', 'listLoadCases', {});
      if (lcRes.data.ok && lcRes.data.result) {
        setLoadCases(lcRes.data.result.loadCases || []);
      }
    })();
  }, [loadMaterials]);

  const saveLoadCase = useCallback(async () => {
    setStatus('Saving load case…');
    const r = await lensRun<{ loadCase: SavedLoadCase }>('engineering', 'saveLoadCase', {
      name: lcName,
      loads: model.loads,
      supports: model.supports,
    });
    if (r.data.ok) {
      const list = await lensRun<{ loadCases: SavedLoadCase[] }>('engineering', 'listLoadCases', {});
      if (list.data.ok && list.data.result) setLoadCases(list.data.result.loadCases || []);
      setStatus('Load case saved');
    } else {
      setStatus(`Error: ${r.data.error}`);
    }
  }, [lcName, model.loads, model.supports]);

  const applyLoadCase = useCallback((lc: SavedLoadCase) => {
    setModel((m) => ({ ...m, loads: lc.loads || [], supports: lc.supports || [] }));
    setStatus(`Applied load case "${lc.name}"`);
  }, []);

  const deleteLoadCase = useCallback(async (id: string) => {
    await lensRun('engineering', 'deleteLoadCase', { id });
    const list = await lensRun<{ loadCases: SavedLoadCase[] }>('engineering', 'listLoadCases', {});
    if (list.data.ok && list.data.result) setLoadCases(list.data.result.loadCases || []);
  }, []);

  const generateMesh = useCallback(async () => {
    setStatus('Generating mesh…');
    const r = await lensRun<{
      mesh: { nodes: Node3D[]; members: Member[] };
      stats: { divisions: number; meshNodes: number; meshElements: number; avgElementLength: number };
    }>('engineering', 'meshGenerate', { model, divisions: meshDivisions });
    if (r.data.ok && r.data.result) {
      setMeshStats(r.data.result.stats);
      setStatus(`Mesh ready — ${r.data.result.stats.meshElements} elements`);
    } else {
      setStatus(`Mesh error: ${r.data.error}`);
    }
  }, [model, meshDivisions]);

  const runFEA = useCallback(() => {
    setRunning(true);
    setStatus('Solving…');
    setFeaResult(null);
    const payload = { type: 'fea-model', title: 'FEA Model', data: { model } };
    createArtifact.mutate(payload, {
      onSuccess: (res) => {
        const id = res?.artifact?.id ?? 'temp';
        runAction.mutate(
          { id, action: 'runFEA', params: { model } },
          {
            onSuccess: (data: unknown) => {
              const d = data as { ok?: boolean; result?: unknown };
              if (d?.result) {
                setFeaResult(d.result as Record<string, unknown>);
                setRunning(false);
                setStatus('Analysis complete');
                setHistoryKey((k) => k + 1);
                setActive('results');
              } else {
                setRunning(false);
                setStatus('Analysis returned no result');
              }
            },
            onError: (e) => {
              setRunning(false);
              setStatus(`Error: ${e.message}`);
            },
          },
        );
      },
      onError: (e) => {
        setRunning(false);
        setStatus(`Error: ${e.message}`);
      },
    });
  }, [model, createArtifact, runAction]);

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
  const toggleSupport = (nodeId: string) => {
    setModel((m) => {
      const existing = m.supports.find((s) => s.nodeId === nodeId);
      if (existing) return { ...m, supports: m.supports.filter((s) => s.nodeId !== nodeId) };
      return {
        ...m,
        supports: [...m.supports, { nodeId, type: 'fixed' as const, fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] }],
      };
    });
  };

  const feaNodes = useMemo(() => {
    if (!feaResult) return [];
    return (
      (feaResult as { displacements?: { nodeId: string; dx: number; dy: number; dz: number }[] }).displacements
        ?.map((d) => {
          const n = model.nodes.find((n) => n.id === d.nodeId);
          return n ? { id: n.id, x: n.x, y: n.y, z: n.z || 0 } : null;
        })
        .filter(Boolean) as { id: string; x: number; y: number; z: number }[]
    ) ?? [];
  }, [feaResult, model.nodes]);

  const feaMembers = useMemo(() => {
    if (!feaResult) return [];
    return (
      (feaResult as { utilization?: { id: string; utilization: number; combinedStress: number }[] }).utilization
        ?.map((u) => {
          const m = model.members.find((m) => m.id === u.id);
          return m
            ? { id: u.id, nodeI: m.nodeI, nodeJ: m.nodeJ, utilization: u.utilization, stress: u.combinedStress }
            : null;
        })
        .filter(Boolean) as { id: string; nodeI: string; nodeJ: string; utilization: number; stress: number }[]
    ) ?? [];
  }, [feaResult, model.members]);

  const feaDisplacements = useMemo(() => {
    if (!feaResult) return [];
    return (feaResult as { displacements?: { nodeId: string; dx: number; dy: number; dz: number }[] }).displacements ?? [];
  }, [feaResult]);

  const summary = useMemo(() => {
    const s = (feaResult as { summary?: { maxDisplacement: number; maxUtilization: number; allPass: boolean } } | null)
      ?.summary;
    return s ?? null;
  }, [feaResult]);

  const value: EngineeringFeaStore = {
    active,
    setActive,
    model,
    setModel,
    feaResult,
    running,
    status,
    historyKey,
    libMaterials,
    matCategories,
    matFilter,
    setMatFilter,
    matLoading,
    matError,
    loadMaterials,
    loadCases,
    lcName,
    setLcName,
    saveLoadCase,
    applyLoadCase,
    deleteLoadCase,
    meshDivisions,
    setMeshDivisions,
    meshStats,
    generateMesh,
    runFEA,
    addNode,
    updateNode,
    removeNode,
    addMember,
    updateMember,
    removeMember,
    addLoad,
    updateLoad,
    removeLoad,
    toggleSupport,
    feaNodes,
    feaMembers,
    feaDisplacements,
    summary,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
