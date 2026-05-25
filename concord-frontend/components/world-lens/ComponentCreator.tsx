'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Cog, Upload, Ruler, Box } from 'lucide-react';
import type { MaterialDTU, ComponentCategory, MemberType } from '@/lib/world-lens/types';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const COMPONENT_TYPES: { id: ComponentCategory; memberType: MemberType; label: string }[] = [
  { id: 'beam', memberType: 'beam', label: 'Beam' },
  { id: 'column', memberType: 'column', label: 'Column' },
  { id: 'foundation', memberType: 'foundation', label: 'Foundation' },
  { id: 'wall-system', memberType: 'wall', label: 'Wall System' },
  { id: 'roof-truss', memberType: 'roof', label: 'Roof Truss' },
  { id: 'bracket', memberType: 'brace', label: 'Bracket' },
  { id: 'joint', memberType: 'brace', label: 'Joint' },
];

const CROSS_SECTIONS = ['rectangular', 'circular', 'I-beam', 'H-beam', 'tube', 'custom'] as const;

interface ComponentCreatorProps {
  materials: MaterialDTU[];
  onPublish: (component: {
    name: string;
    category: ComponentCategory;
    materialId: string;
    dimensions: { length: number; width: number; height: number };
    crossSection: string;
  }) => void;
  onCancel: () => void;
}

export default function ComponentCreator({ materials, onPublish, onCancel }: ComponentCreatorProps) {
  const [name, setName] = useState('');
  const [componentType, setComponentType] = useState<ComponentCategory>('beam');
  const [materialId, setMaterialId] = useState(materials[0]?.id || '');
  const [length, setLength] = useState(6);
  const [width, setWidth] = useState(0.3);
  const [height, setHeight] = useState(0.5);
  const [crossSection, setCrossSection] = useState<string>('rectangular');

  const selectedMat = useMemo(
    () => materials.find(m => m.id === materialId),
    [materials, materialId]
  );

  // Performance envelope: load capacity at current span
  const perfEnvelope = useMemo(() => {
    if (!selectedMat) return null;
    const area = width * height;
    const isBeam = componentType === 'beam' || componentType === 'roof-truss';
    const allowableStress = isBeam
      ? selectedMat.properties.tensileStrength
      : selectedMat.properties.compressiveStrength;

    const maxLoad = allowableStress * area * 1e6 / 1.5; // N, with safety factor
    const maxLoadKn = maxLoad / 1000;

    // Generate span vs capacity curve
    const curve: { span: number; capacity: number }[] = [];
    for (let s = 1; s <= 20; s += 0.5) {
      // Simplified: capacity decreases with span² for beams
      const factor = isBeam ? Math.max(0, 1 - ((s / (length * 3)) ** 2)) : 1;
      curve.push({ span: s, capacity: maxLoadKn * factor });
    }

    return { maxLoad: maxLoadKn, curve };
  }, [selectedMat, width, height, length, componentType]);

  const handlePublish = useCallback(() => {
    if (!name.trim()) return;
    onPublish({
      name,
      category: componentType,
      materialId,
      dimensions: { length, width, height },
      crossSection,
    });
  }, [name, componentType, materialId, length, width, height, crossSection, onPublish]);

  return (
    <div className={`${panel} p-4 space-y-4 max-h-[80vh] overflow-y-auto`}>
      <div className="flex items-center gap-2">
        <Cog className="w-5 h-5 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Component Creator</h3>
      </div>

      {/* Name */}
      <div>
        <label className="text-[10px] text-gray-400 mb-1 block">Component Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="My Custom Beam"
          className="w-full bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-white"
        />
      </div>

      {/* Type */}
      <div>
        <label className="text-[10px] text-gray-400 mb-1 block">Component Type</label>
        <div className="grid grid-cols-2 gap-1">
          {COMPONENT_TYPES.map(ct => (
            <button
              key={ct.id}
              onClick={() => setComponentType(ct.id)}
              className={`px-2 py-1.5 rounded text-[10px] border transition-colors ${
                componentType === ct.id
                  ? 'border-purple-500/50 bg-purple-500/10 text-purple-300'
                  : 'border-white/10 text-gray-400 hover:bg-white/5'
              }`}
            >
              {ct.label}
            </button>
          ))}
        </div>
      </div>

      {/* Material */}
      <div>
        <label className="text-[10px] text-gray-400 mb-1 block">Material</label>
        <select
          value={materialId}
          onChange={e => setMaterialId(e.target.value)}
          className="w-full bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-white"
        >
          {materials.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {selectedMat && (
          <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] text-gray-400">
            <span>Tensile: {selectedMat.properties.tensileStrength} MPa</span>
            <span>Compressive: {selectedMat.properties.compressiveStrength} MPa</span>
            <span>Density: {selectedMat.properties.density} kg/m³</span>
            <span>Fire: {selectedMat.properties.fireResistanceHours}h</span>
          </div>
        )}
      </div>

      {/* Dimensions */}
      <div>
        <label className="text-[10px] text-gray-400 mb-1 block flex items-center gap-1">
          <Ruler className="w-3 h-3" /> Dimensions
        </label>
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between text-[10px] text-gray-400 mb-0.5">
              <span>Length: {length.toFixed(1)}m</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={20}
              step={0.1}
              value={length}
              onChange={e => setLength(parseFloat(e.target.value))}
              className="w-full h-1.5 accent-purple-500"
            />
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] text-gray-400 mb-0.5">
              <span>Width: {width.toFixed(2)}m</span>
            </div>
            <input
              type="range"
              min={0.05}
              max={2}
              step={0.01}
              value={width}
              onChange={e => setWidth(parseFloat(e.target.value))}
              className="w-full h-1.5 accent-purple-500"
            />
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] text-gray-400 mb-0.5">
              <span>Height: {height.toFixed(2)}m</span>
            </div>
            <input
              type="range"
              min={0.05}
              max={3}
              step={0.01}
              value={height}
              onChange={e => setHeight(parseFloat(e.target.value))}
              className="w-full h-1.5 accent-purple-500"
            />
          </div>
        </div>
      </div>

      {/* Cross Section */}
      <div>
        <label className="text-[10px] text-gray-400 mb-1 block">Cross Section</label>
        <select
          value={crossSection}
          onChange={e => setCrossSection(e.target.value)}
          className="w-full bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-white"
        >
          {CROSS_SECTIONS.map(cs => (
            <option key={cs} value={cs}>{cs.charAt(0).toUpperCase() + cs.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Performance Envelope */}
      {perfEnvelope && (
        <div className="p-3 rounded bg-white/5">
          <h4 className="text-[10px] text-gray-400 mb-2 flex items-center gap-1">
            <Box className="w-3 h-3" /> Performance Envelope
          </h4>
          <p className="text-xs text-white mb-2">
            Max Load: <strong className="text-purple-300">{perfEnvelope.maxLoad.toFixed(1)} kN</strong>
          </p>
          {/* Simple text-based curve visualization */}
          <div className="space-y-0.5">
            {perfEnvelope.curve.filter((_, i) => i % 4 === 0).map(point => {
              const pct = Math.min(100, (point.capacity / perfEnvelope.maxLoad) * 100);
              const barColor = pct > 70 ? 'bg-green-500' : pct > 40 ? 'bg-yellow-500' : 'bg-red-500';
              return (
                <div key={point.span} className="flex items-center gap-2 text-[9px]">
                  <span className="w-8 text-right text-gray-400 tabular-nums">{point.span}m</span>
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-12 text-gray-400 tabular-nums">{point.capacity.toFixed(0)} kN</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-white/10">
        <button
          onClick={onCancel}
          className="flex-1 py-2 text-xs text-gray-400 border border-white/10 rounded hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handlePublish}
          disabled={!name.trim()}
          className="flex-1 py-2 bg-purple-500/20 text-purple-300 rounded text-xs hover:bg-purple-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
        >
          <Upload className="w-3.5 h-3.5" />
          Publish
        </button>
      </div>
    </div>
  );
}
