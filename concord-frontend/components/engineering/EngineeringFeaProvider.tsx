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
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { lensRun } from '@/lib/api/client';
import {
  EMPTY_FEA_MODEL,
  feaModelGap,
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
  cycleSupport: (nodeId: string) => void;
  /** Human list of what references a node ("member M1 (start)", …). */
  referencesFor: (nodeId: string) => string[];
  /** Set when a node delete was refused for reference integrity. */
  modelNotice: string | null;
  clearModelNotice: () => void;
  /** Set when a saved FEA result exists but belongs to an earlier model state. */
  staleRunNote: string | null;
  feaNodes: { id: string; x: number; y: number; z: number }[];
  feaMembers: { id: string; nodeI: string; nodeJ: string; utilization: number; stress: number }[];
  feaDisplacements: { nodeId: string; dx: number; dy: number; dz: number }[];
  summary: { maxDisplacement: number; maxUtilization: number; allPass: boolean } | null;
  /** Server-side persistence of the working model (per user). */
  modelSaveState: ModelSaveState;
}

export type ModelSaveState = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

/** Stable signature of the model a result was computed from — a saved
 * result restores only against the model that produced it, so a result
 * can never silently describe a model that has since changed. */
export function modelSignature(m: FEAModel): string {
  return JSON.stringify({
    nodes: m.nodes.map((n) => [n.id, n.x, n.y, n.z ?? 0]),
    members: m.members.map((x) => [
      x.id, x.nodeI, x.nodeJ, x.area, x.momentI, x.elasticModulus, x.allowableStress ?? null, x.material || '',
    ]),
    loads: m.loads.map((l) => [l.nodeId, l.Fx ?? null, l.Fy ?? null, l.Fz ?? null, l.Mx ?? null, l.My ?? null, l.Mz ?? null]),
    supports: m.supports.map((s) => [s.nodeId, s.type, [...(s.fixedDOF || [])].sort().join(',')]),
  });
}

const Ctx = createContext<EngineeringFeaStore | null>(null);

export function useEngineeringFea(): EngineeringFeaStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEngineeringFea must be used inside EngineeringFeaProvider');
  return v;
}

export function EngineeringFeaProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<EngView>('model');
  const [model, setModel] = useState<FEAModel>(EMPTY_FEA_MODEL);
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
  const [modelSaveState, setModelSaveState] = useState<ModelSaveState>('loading');
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const clearModelNotice = useCallback(() => setModelNotice(null), []);
  const [staleRunNote, setStaleRunNote] = useState<string | null>(null);
  const referencesFor = useCallback(
    (nodeId: string): string[] => {
      const refs: string[] = [];
      for (const mb of model.members) {
        if (mb.nodeI === nodeId) refs.push(`member ${mb.id} (start)`);
        if (mb.nodeJ === nodeId) refs.push(`member ${mb.id} (end)`);
      }
      model.loads.forEach((l, i) => {
        if (l.nodeId === nodeId) refs.push(`load ${i + 1}`);
      });
      if (model.supports.some((s) => s.nodeId === nodeId)) refs.push('a support');
      return refs;
    },
    [model],
  );
  // The working model lives on the server per user, so a reload or a server
  // restart doesn't lose it. `modelLoaded` gates saving until the stored model
  // has been read back, so the empty initial state never overwrites it.
  const modelLoaded = useRef(false);
  const skipNextSave = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun<{ model: FEAModel | null; updatedAt: string | null }>(
          'engineering',
          'model-get',
          {},
        );
        if (cancelled) return;
        const stored = r.data?.ok ? r.data.result?.model : null;
        if (stored && Array.isArray(stored.nodes)) {
          skipNextSave.current = true;
          const loadedModel: FEAModel = {
            nodes: stored.nodes || [],
            members: stored.members || [],
            loads: stored.loads || [],
            supports: stored.supports || [],
          };
          setModel(loadedModel);
          setModelSaveState('saved');
          // Restore the latest FEA result — but only the one computed
          // from THIS model. A result saved against an earlier model
          // state is named as such, never silently re-attached.
          try {
            const ws = await lensRun<{ state: { result?: Record<string, unknown>; modelSignature?: string; savedAt?: string } | null }>(
              'engineering',
              'workspace-get',
              { key: 'fea.latest' },
            );
            const saved = ws.data?.ok ? ws.data.result?.state : null;
            if (!cancelled && saved?.result) {
              if (saved.modelSignature === modelSignature(loadedModel)) {
                setFeaResult(saved.result);
              } else {
                setStaleRunNote(
                  `A previous FEA run (${saved.savedAt ? new Date(saved.savedAt).toLocaleString() : 'earlier'}) exists for an earlier state of this model. Run FEA again to solve the current model.`,
                );
              }
            }
          } catch {
            /* the sim history still carries the run; restore is a courtesy */
          }
        } else {
          setModelSaveState(r.data?.ok ? 'idle' : 'error');
        }
      } catch {
        if (!cancelled) setModelSaveState('error');
      } finally {
        if (!cancelled) modelLoaded.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!modelLoaded.current) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    setModelSaveState('saving');
    const t = setTimeout(() => {
      lensRun('engineering', 'model-save', { model })
        .then((r) => setModelSaveState(r.data?.ok ? 'saved' : 'error'))
        .catch(() => setModelSaveState('error'));
    }, 600);
    return () => clearTimeout(t);
  }, [model]);

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
    const gap = feaModelGap(model);
    if (gap) {
      // Nothing to solve yet: say what is missing instead of solving a sample.
      setFeaResult(null);
      setStatus(`Error: nothing to solve yet. In Model, ${gap}.`);
      setActive('model');
      return;
    }
    setRunning(true);
    setStatus('Solving…');
    setFeaResult(null);
    // Solve through the domain action directly. The old path created a
    // throwaway "fea-model" artifact and ran the action against its id; with
    // no id in the create response it ran against a placeholder id, got
    // "not found", and the UI never showed a solve.
    lensRun<Record<string, unknown>>('engineering', 'runFEA', { model, name: 'FEA run' })
      .then((r) => {
        if (r.data?.ok && r.data.result) {
          const result = r.data.result as Record<string, unknown>;
          setFeaResult(result);
          setStaleRunNote(null);
          setStatus('Analysis complete');
          setHistoryKey((k) => k + 1);
          setActive('results');
          // Persist the result WITH the signature of the model that
          // produced it, so a reload restores it against its own model
          // (Simulation History keeps the run either way).
          void lensRun('engineering', 'workspace-save', {
            key: 'fea.latest',
            state: { result, modelSignature: modelSignature(model), savedAt: new Date().toISOString() },
          }).catch(() => {
            /* persistence is a courtesy; the in-session result stands */
          });
        } else {
          setStatus(`Error: ${r.data?.error || 'the solver returned no result'}`);
        }
      })
      .catch((e: unknown) => setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setRunning(false));
  }, [model]);

  // IDs stay unique across deletions: the next id is one past the
  // highest numeric suffix in use, never count + 1 (which re-minted a
  // deleted node's id and collided with a standing one).
  const nextId = (prefix: string, ids: string[]) => {
    let max = 0;
    for (const id of ids) {
      const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return `${prefix}${max + 1}`;
  };
  const addNode = () => {
    setModel((m) => ({
      ...m,
      nodes: [...m.nodes, { id: nextId('N', m.nodes.map((n) => n.id)), x: 0, y: 0, z: 0 }],
    }));
  };
  const updateNode = (idx: number, field: keyof Node3D, val: string) => {
    setModel((m) => {
      const nodes = [...m.nodes];
      const old = nodes[idx];
      nodes[idx] = { ...old, [field]: field === 'id' ? val : parseFloat(val) || 0 };
      if (field !== 'id' || !old || old.id === val) return { ...m, nodes };
      // A rename is an explicit act on this node: carry it through every
      // reference, so a rename can never strand a member/load/support on
      // the old id (the silent-divergence shape F2 forbids).
      const rename = (id: string) => (id === old.id ? val : id);
      return {
        ...m,
        nodes,
        members: m.members.map((mb) => ({ ...mb, nodeI: rename(mb.nodeI), nodeJ: rename(mb.nodeJ) })),
        loads: m.loads.map((l) => ({ ...l, nodeId: rename(l.nodeId) })),
        supports: m.supports.map((s) => ({ ...s, nodeId: rename(s.nodeId) })),
      };
    });
  };
  const removeNode = (idx: number) => {
    const node = model.nodes[idx];
    if (!node) return;
    const refs = referencesFor(node.id);
    if (refs.length > 0) {
      // Reference integrity: never silently re-target or cascade. The
      // delete is refused in words; the member removes the references
      // first if the node really has to go.
      setModelNotice(
        `Node ${node.id} is not deleted: it is referenced by ${refs.join(', ')}. Remove or re-point those first — references are never silently rewritten.`,
      );
      return;
    }
    setModelNotice(null);
    setModel((m) => ({ ...m, nodes: m.nodes.filter((_, i) => i !== idx) }));
  };
  const addMember = () => {
    const id = nextId('M', model.members.map((x) => x.id));
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
  // Support vocabulary: Free → Fixed → Pinned → Roller. The server
  // model and the solver have always honoured pinned/roller through
  // fixedDOF; only the surface hid them (a simply supported beam was
  // unbuildable). Pinned restrains translation, roller the vertical.
  const SUPPORT_CYCLE: { type: 'fixed' | 'pinned' | 'roller'; fixedDOF: string[] }[] = [
    { type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
    { type: 'pinned', fixedDOF: ['x', 'y', 'z'] },
    { type: 'roller', fixedDOF: ['y'] },
  ];
  const cycleSupport = (nodeId: string) => {
    setModel((m) => {
      const existing = m.supports.find((s) => s.nodeId === nodeId);
      const others = m.supports.filter((s) => s.nodeId !== nodeId);
      if (!existing) return { ...m, supports: [...others, { nodeId, ...SUPPORT_CYCLE[0] }] };
      const idx = SUPPORT_CYCLE.findIndex((s) => s.type === existing.type);
      if (idx < 0 || idx === SUPPORT_CYCLE.length - 1) return { ...m, supports: others };
      return { ...m, supports: [...others, { nodeId, ...SUPPORT_CYCLE[idx + 1] }] };
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
    cycleSupport,
    referencesFor,
    modelNotice,
    clearModelNotice,
    staleRunNote,
    feaNodes,
    feaMembers,
    feaDisplacements,
    summary,
    modelSaveState,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
