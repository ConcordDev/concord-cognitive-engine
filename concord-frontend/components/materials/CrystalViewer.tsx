'use client';

/**
 * CrystalViewer — WebGL render of a Materials Project crystal structure.
 * Fetches lattice + atom sites via the materials.mp-structure macro and
 * draws atoms as spheres inside the unit-cell wireframe.
 */

import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Loader2, Boxes } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Site {
  species: string;
  abc: [number, number, number];
  xyz: [number, number, number];
}
interface Lattice {
  a?: number; b?: number; c?: number;
  alpha?: number; beta?: number; gamma?: number;
  matrix?: number[][] | null;
}
interface StructureResult {
  materialId: string;
  formula: string;
  crystalSystem?: string;
  spaceGroup?: string;
  volume?: number;
  lattice: Lattice;
  sites: Site[];
  atomCount: number;
}

const ELEMENT_COLORS: Record<string, string> = {
  H: '#ffffff', O: '#ff2222', Si: '#f0c8a0', Fe: '#e06633', C: '#404040',
  Na: '#ab5cf2', Cl: '#1ff01f', Li: '#cc80ff', N: '#3050f8', Ti: '#bfc2c7',
  Al: '#bfa6a6', Cu: '#c88033', Ca: '#3dff00', Mg: '#8aff00', K: '#8f40d4',
};
function colorFor(species: string): string {
  const el = species.split('/')[0];
  return ELEMENT_COLORS[el] || '#7dd3fc';
}

function CellWireframe({ matrix }: { matrix: number[][] }) {
  const edges = useMemo(() => {
    const o = [0, 0, 0];
    const [va, vb, vc] = matrix;
    const corner = (i: number, j: number, k: number): [number, number, number] => [
      i * va[0] + j * vb[0] + k * vc[0],
      i * va[1] + j * vb[1] + k * vc[1],
      i * va[2] + j * vb[2] + k * vc[2],
    ];
    const pts: Array<[[number, number, number], [number, number, number]]> = [];
    const corners: Array<[number, number, number]> = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) corners.push([i, j, k]);
    for (let a = 0; a < corners.length; a++) {
      for (let b = a + 1; b < corners.length; b++) {
        const diff = corners[a].reduce((s, v, idx) => s + Math.abs(v - corners[b][idx]), 0);
        if (diff === 1) {
          pts.push([corner(...corners[a]), corner(...corners[b])]);
        }
      }
    }
    void o;
    return pts;
  }, [matrix]);
  return (
    <group>
      {edges.map((e, i) => {
        const geom = new Float32Array([...e[0], ...e[1]]);
        return (
          <line key={i}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[geom, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color="#52525b" />
          </line>
        );
      })}
    </group>
  );
}

export function CrystalViewer() {
  const [materialId, setMaterialId] = useState('');
  const [structure, setStructure] = useState<StructureResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const id = materialId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    const r = await lensRun<StructureResult>('materials', 'mp-structure', { materialId: id });
    setLoading(false);
    if (r.data.ok && r.data.result) {
      setStructure(r.data.result);
    } else {
      setStructure(null);
      setError(r.data.error || 'failed to load structure');
    }
  }

  const matrix = structure?.lattice.matrix;
  const center = useMemo<[number, number, number]>(() => {
    if (!matrix) return [0, 0, 0];
    return [
      (matrix[0][0] + matrix[1][0] + matrix[2][0]) / 2,
      (matrix[0][1] + matrix[1][1] + matrix[2][1]) / 2,
      (matrix[0][2] + matrix[1][2] + matrix[2][2]) / 2,
    ];
  }, [matrix]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Boxes className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">3D Crystal Structure</h3>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); void load(); }}
        className="flex items-center gap-2"
      >
        <input
          value={materialId}
          onChange={(e) => setMaterialId(e.target.value)}
          placeholder="Materials Project ID — mp-149, mp-2534…"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-sm text-white"
        />
        <button
          type="submit"
          disabled={!materialId.trim() || loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Boxes className="h-3.5 w-3.5" />}
          Render
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {structure && matrix && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
            <span className="font-mono text-cyan-300">{structure.formula}</span>
            <span>{structure.crystalSystem}</span>
            <span>{structure.spaceGroup}</span>
            <span>{structure.atomCount} atoms</span>
            {structure.volume != null && <span>{structure.volume.toFixed(1)} Å³</span>}
          </div>
          <div className="h-72 overflow-hidden rounded-lg border border-zinc-800 bg-black">
            <Canvas camera={{ position: [center[0] + 12, center[1] + 8, center[2] + 12], fov: 45 }}>
              <ambientLight intensity={0.7} />
              <directionalLight position={[10, 10, 10]} intensity={0.8} />
              <CellWireframe matrix={matrix} />
              {structure.sites.map((site, i) => (
                <mesh key={i} position={site.xyz}>
                  <sphereGeometry args={[0.45, 24, 24]} />
                  <meshStandardMaterial color={colorFor(site.species)} roughness={0.4} metalness={0.2} />
                </mesh>
              ))}
              <OrbitControls target={center} />
            </Canvas>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set(structure.sites.map((s) => s.species.split('/')[0]))].map((el) => (
              <span key={el} className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorFor(el) }} />
                {el}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
