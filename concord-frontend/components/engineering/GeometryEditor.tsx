'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { lensRun } from '@/lib/api/client';
import { Box, Plus, Trash2, Loader2, Save, RefreshCw } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type PrimitiveKind = 'box' | 'cylinder' | 'tube' | 'sphere' | 'i-beam';

interface GeomParams {
  width?: number;
  height?: number;
  length?: number;
  radius?: number;
  innerRadius?: number;
  flangeWidth?: number;
  flangeThickness?: number;
  webThickness?: number;
}

interface PartGeometry {
  volume: number;
  mass: number;
  surfaceArea: number;
  boundingBox: { x: number; y: number; z: number };
  section: { area: number; Ix: number; Iy: number } | null;
}

interface SavedPart {
  id: string;
  name: string;
  kind: string;
  params: GeomParams;
  material: string | null;
  geometry: PartGeometry;
  updatedAt: string;
}

interface MeshData {
  positions: number[];
  indices: number[];
  triangleCount: number;
  boundingBox: { x: number; y: number; z: number };
}

interface MaterialEntry {
  id: string;
  label: string;
  density: number;
}

// Parameter fields shown per primitive kind.
const KIND_FIELDS: Record<PrimitiveKind, (keyof GeomParams)[]> = {
  box: ['width', 'height', 'length'],
  cylinder: ['radius', 'length'],
  tube: ['radius', 'innerRadius', 'length'],
  sphere: ['radius'],
  'i-beam': ['flangeWidth', 'height', 'flangeThickness', 'webThickness', 'length'],
};

const FIELD_LABEL: Record<keyof GeomParams, string> = {
  width: 'Width (m)',
  height: 'Height / Depth (m)',
  length: 'Length (m)',
  radius: 'Outer Radius (m)',
  innerRadius: 'Inner Radius (m)',
  flangeWidth: 'Flange Width (m)',
  flangeThickness: 'Flange Thk (m)',
  webThickness: 'Web Thk (m)',
};

const DEFAULT_PARAMS: Record<PrimitiveKind, GeomParams> = {
  box: { width: 0.2, height: 0.1, length: 0.5 },
  cylinder: { radius: 0.05, length: 0.4 },
  tube: { radius: 0.05, innerRadius: 0.04, length: 0.4 },
  sphere: { radius: 0.08 },
  'i-beam': {
    flangeWidth: 0.1,
    height: 0.2,
    flangeThickness: 0.012,
    webThickness: 0.008,
    length: 1.0,
  },
};

// ── 3-D mesh preview ──────────────────────────────────────────────────────────

function PartMesh({ mesh }: { mesh: MeshData }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(mesh.positions), 3),
    );
    g.setIndex(mesh.indices);
    g.computeVertexNormals();
    return g;
  }, [mesh]);

  const span = Math.max(
    mesh.boundingBox.x,
    mesh.boundingBox.y,
    mesh.boundingBox.z,
    0.01,
  );

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[5, 8, 5]} intensity={0.9} />
      <directionalLight position={[-5, -3, -5]} intensity={0.35} />
      <axesHelper args={[span]} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#06b6d4" metalness={0.55} roughness={0.4} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color="#0e7490" />
      </lineSegments>
    </>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

export function GeometryEditor({
  materials,
}: {
  materials: MaterialEntry[];
}) {
  const [kind, setKind] = useState<PrimitiveKind>('box');
  const [params, setParams] = useState<GeomParams>(DEFAULT_PARAMS.box);
  const [material, setMaterial] = useState<string>('steel-a36');
  const [partName, setPartName] = useState('New Part');
  const [geom, setGeom] = useState<PartGeometry | null>(null);
  const [mesh, setMesh] = useState<MeshData | null>(null);
  const [computing, setComputing] = useState(false);
  const [parts, setParts] = useState<SavedPart[]>([]);
  const [status, setStatus] = useState('');

  const loadParts = useCallback(async () => {
    const r = await lensRun<{ parts: SavedPart[] }>('engineering', 'listParts', {});
    if (r.data.ok && r.data.result) setParts(r.data.result.parts || []);
  }, []);

  useEffect(() => {
    loadParts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompute geometry props + mesh whenever the parameters change.
  const recompute = useCallback(async () => {
    setComputing(true);
    const [solidRes, meshRes] = await Promise.all([
      lensRun<{ volume: number; mass: number; surfaceArea: number;
        boundingBox: PartGeometry['boundingBox']; section: PartGeometry['section'] }>(
        'engineering',
        'parametricSolid',
        { kind, material, params },
      ),
      lensRun<MeshData>('engineering', 'partMesh', { kind, params }),
    ]);
    if (solidRes.data.ok && solidRes.data.result) {
      const s = solidRes.data.result;
      setGeom({
        volume: s.volume,
        mass: s.mass,
        surfaceArea: s.surfaceArea,
        boundingBox: s.boundingBox,
        section: s.section,
      });
    }
    if (meshRes.data.ok && meshRes.data.result) setMesh(meshRes.data.result);
    setComputing(false);
  }, [kind, material, params]);

  useEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, material, params]);

  const changeKind = (k: PrimitiveKind) => {
    setKind(k);
    setParams(DEFAULT_PARAMS[k]);
  };

  const setField = (f: keyof GeomParams, v: string) => {
    setParams((p) => ({ ...p, [f]: parseFloat(v) || 0 }));
  };

  const savePart = useCallback(async () => {
    setStatus('Saving…');
    const r = await lensRun<{ part: SavedPart }>('engineering', 'savePart', {
      name: partName,
      kind,
      material,
      params,
    });
    if (r.data.ok) {
      setStatus('Part saved');
      loadParts();
    } else {
      setStatus(`Error: ${r.data.error}`);
    }
  }, [partName, kind, material, params, loadParts]);

  const deletePart = useCallback(
    async (id: string) => {
      await lensRun('engineering', 'deletePart', { id });
      loadParts();
    },
    [loadParts],
  );

  const loadPart = (p: SavedPart) => {
    setKind(p.kind as PrimitiveKind);
    setParams(p.params);
    setMaterial(p.material || 'steel-a36');
    setPartName(p.name);
    setStatus(`Loaded "${p.name}"`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* ── Parameter editor ── */}
      <div className="panel p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Box className="w-4 h-4 text-neon-cyan" /> Parametric Geometry
        </h3>
        <div>
          <label className="text-xs text-gray-400">Part Name</label>
          <input
            value={partName}
            onChange={(e) => setPartName(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Primitive</label>
          <div className="grid grid-cols-3 gap-1 mt-1">
            {(Object.keys(KIND_FIELDS) as PrimitiveKind[]).map((k) => (
              <button
                key={k}
                onClick={() => changeKind(k)}
                className={`px-2 py-1 rounded text-xs capitalize ${
                  kind === k
                    ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40'
                    : 'bg-white/5 text-gray-400 border border-white/10'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          {KIND_FIELDS[kind].map((f) => (
            <div key={f}>
              <label className="text-xs text-gray-400">{FIELD_LABEL[f]}</label>
              <input
                type="number"
                step="0.001"
                value={params[f] ?? ''}
                onChange={(e) => setField(f, e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-sm font-mono mt-1"
              />
            </div>
          ))}
        </div>
        <div>
          <label className="text-xs text-gray-400">Material</label>
          <select
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-sm mt-1"
          >
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={savePart}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-neon-cyan text-black rounded-lg text-sm font-semibold hover:bg-neon-cyan/90"
          >
            <Save className="w-4 h-4" /> Save Part
          </button>
          <button
            onClick={recompute}
            className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm hover:bg-white/10"
            aria-label="Recompute"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {status && <p className="text-xs text-gray-400">{status}</p>}
      </div>

      {/* ── 3-D preview ── */}
      <div className="panel p-2 lg:col-span-1">
        <div
          className="relative rounded-lg overflow-hidden bg-black/40 border border-white/10"
          style={{ height: '320px' }}
        >
          {mesh ? (
            <Canvas
              camera={{ fov: 50, near: 0.001, far: 100, position: [0.6, 0.5, 0.8] }}
              gl={{ antialias: true, alpha: true }}
            >
              <PartMesh mesh={mesh} />
            </Canvas>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              {computing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'No geometry'
              )}
            </div>
          )}
        </div>
        {/* Geometry properties */}
        {geom && (
          <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
            <div className="bg-black/20 rounded p-2">
              <p className="text-gray-400">Volume</p>
              <p className="font-mono text-neon-cyan">
                {(geom.volume * 1e6).toFixed(1)} cm³
              </p>
            </div>
            <div className="bg-black/20 rounded p-2">
              <p className="text-gray-400">Mass</p>
              <p className="font-mono text-yellow-400">{geom.mass.toFixed(3)} kg</p>
            </div>
            <div className="bg-black/20 rounded p-2">
              <p className="text-gray-400">Surface Area</p>
              <p className="font-mono text-purple-400">
                {(geom.surfaceArea * 1e4).toFixed(1)} cm²
              </p>
            </div>
            <div className="bg-black/20 rounded p-2">
              <p className="text-gray-400">Bounding Box</p>
              <p className="font-mono text-gray-300">
                {geom.boundingBox.x.toFixed(2)}×{geom.boundingBox.y.toFixed(2)}×
                {geom.boundingBox.z.toFixed(2)}
              </p>
            </div>
            {geom.section && (
              <div className="bg-black/20 rounded p-2 col-span-2">
                <p className="text-gray-400">Section · A / Ix / Iy</p>
                <p className="font-mono text-green-400">
                  {(geom.section.area * 1e4).toFixed(2)} cm² /{' '}
                  {(geom.section.Ix * 1e8).toFixed(2)} /{' '}
                  {(geom.section.Iy * 1e8).toFixed(2)} cm⁴
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Saved parts ── */}
      <div className="panel p-4 space-y-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Plus className="w-4 h-4 text-purple-400" /> Saved Parts ({parts.length})
        </h3>
        {parts.length === 0 && (
          <p className="text-xs text-gray-400 py-4 text-center">
            No saved parts. Define geometry and click Save Part.
          </p>
        )}
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {parts.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between bg-black/20 rounded px-2 py-1.5"
            >
              <button
                onClick={() => loadPart(p)}
                className="text-left flex-1 min-w-0"
              >
                <p className="text-sm truncate">{p.name}</p>
                <p className="text-xs text-gray-400">
                  {p.kind} · {p.geometry?.mass?.toFixed(2) ?? '?'} kg
                </p>
              </button>
              <button
                onClick={() => deletePart(p.id)}
                className="text-gray-600 hover:text-red-400 ml-2"
                aria-label="Delete part"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
