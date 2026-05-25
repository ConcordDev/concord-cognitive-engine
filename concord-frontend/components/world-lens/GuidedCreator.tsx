'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  Building2, Home, Store, Factory, GraduationCap, Stethoscope,
  Zap, Wheat, Truck, Box, ChevronLeft, ChevronRight, Check,
  AlertTriangle, CheckCircle2, XCircle, Loader2, Upload,
} from 'lucide-react';
import type {
  GuidedStep, BuildingCategory, StructuralMember, MaterialDTU,
  District, BuildingDTU, ValidationReport, PhysicsFeedback,
  MemberType,
} from '@/lib/world-lens/types';
import { computeRealtimeFeedback, validateStructure } from '@/lib/world-lens/validation-engine';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const STEP_ORDER: GuidedStep[] = ['intent', 'foundation', 'structure', 'systems', 'validation', 'publish'];

const CATEGORIES: { id: BuildingCategory; name: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'residential', name: 'Residential', icon: Home },
  { id: 'commercial', name: 'Commercial', icon: Store },
  { id: 'office', name: 'Office', icon: Building2 },
  { id: 'industrial', name: 'Industrial', icon: Factory },
  { id: 'education', name: 'Education', icon: GraduationCap },
  { id: 'healthcare', name: 'Healthcare', icon: Stethoscope },
  { id: 'infrastructure', name: 'Infrastructure', icon: Box },
  { id: 'energy', name: 'Energy', icon: Zap },
  { id: 'agriculture', name: 'Agriculture', icon: Wheat },
  { id: 'transport', name: 'Transport', icon: Truck },
  { id: 'custom', name: 'Custom', icon: Box },
];

interface GuidedCreatorProps {
  district: District;
  materials: MaterialDTU[];
  onPublish: (building: BuildingDTU) => void;
  onCancel: () => void;
}

export default function GuidedCreator({
  district,
  materials,
  onPublish,
  onCancel,
}: GuidedCreatorProps) {
  const [step, setStep] = useState<GuidedStep>('intent');
  const [category, setCategory] = useState<BuildingCategory | null>(null);
  const [members, setMembers] = useState<StructuralMember[]>([]);
  const [foundations, setFoundations] = useState<StructuralMember[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<string>(materials[0]?.id || '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);

  const stepIndex = STEP_ORDER.indexOf(step);

  // Real-time physics feedback on structure members
  const feedback = useMemo(() => {
    if (members.length === 0 && foundations.length === 0) return [];
    return computeRealtimeFeedback([...foundations, ...members], materials);
  }, [members, foundations, materials]);

  const feedbackMap = useMemo(() => {
    const map = new Map<string, PhysicsFeedback>();
    for (const f of feedback) map.set(f.memberId, f);
    return map;
  }, [feedback]);

  const addMember = useCallback((type: MemberType) => {
    const newMember: StructuralMember = {
      id: `member-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      materialId: selectedMaterial,
      position: { x: 0, y: 0, z: type === 'foundation' ? -1 : members.length * 3 },
      dimensions: {
        length: type === 'beam' ? 6 : type === 'wall' ? 4 : type === 'floor' ? 8 : 3,
        width: type === 'column' ? 0.3 : type === 'wall' ? 0.2 : 0.4,
        height: type === 'wall' ? 3 : type === 'column' ? 3 : type === 'floor' ? 0.15 : 0.5,
      },
      rotation: 0,
      crossSection: type === 'column' ? 'circular' : 'rectangular',
      crossSectionArea: 0.09,
      momentOfInertia: 0.0001,
      connections: members.length > 0 ? [members[members.length - 1].id] : [],
    };

    if (type === 'foundation') {
      setFoundations(prev => [...prev, newMember]);
    } else {
      setMembers(prev => [...prev, newMember]);
    }
  }, [selectedMaterial, members]);

  const removeMember = useCallback((id: string) => {
    setMembers(prev => prev.filter(m => m.id !== id));
    setFoundations(prev => prev.filter(m => m.id !== id));
  }, []);

  const runValidation = useCallback(() => {
    setValidating(true);
    // Simulate async validation
    setTimeout(() => {
      const building: BuildingDTU = {
        id: `bldg-${Date.now()}`,
        name: name || 'Unnamed Building',
        description: description || '',
        category: category || 'custom',
        members,
        foundations,
        systems: {},
        materialRefs: [...new Set([...members, ...foundations].map(m => m.materialId))],
        creator: '@current_user',
        citations: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const report = validateStructure(building, district, materials);
      setValidationReport(report);
      setValidating(false);
    }, 800);
  }, [name, description, category, members, foundations, district, materials]);

  const handlePublish = useCallback(() => {
    const building: BuildingDTU = {
      id: `bldg-${Date.now()}`,
      name: name || 'Unnamed Building',
      description,
      category: category || 'custom',
      members,
      foundations,
      systems: {},
      materialRefs: [...new Set([...members, ...foundations].map(m => m.materialId))],
      creator: '@current_user',
      citations: 0,
      validationReport: validationReport || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onPublish(building);
  }, [name, description, category, members, foundations, validationReport, onPublish]);

  const feedbackColor = (id: string) => {
    const fb = feedbackMap.get(id);
    if (!fb) return 'border-white/10';
    if (fb.status === 'green') return 'border-green-500/50 bg-green-500/5';
    if (fb.status === 'yellow') return 'border-yellow-500/50 bg-yellow-500/5';
    return 'border-red-500/50 bg-red-500/5';
  };

  return (
    <div className={`${panel} p-4 space-y-4 max-h-[80vh] overflow-y-auto`}>
      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEP_ORDER.map((s, i) => (
          <React.Fragment key={s}>
            <button
              onClick={() => setStep(s)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                step === s
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : i < stepIndex
                    ? 'bg-green-500/10 text-green-400'
                    : 'text-gray-600'
              }`}
            >
              {i < stepIndex && <Check className="w-3 h-3 inline mr-0.5" />}
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
            {i < STEP_ORDER.length - 1 && <ChevronRight className="w-3 h-3 text-gray-700" />}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Intent */}
      {step === 'intent' && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">What are you building?</h3>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => { setCategory(cat.id); setStep('foundation'); }}
                className={`flex items-center gap-2 p-3 rounded-lg border text-left text-xs transition-all ${
                  category === cat.id
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                    : 'border-white/10 text-gray-300 hover:border-white/20 hover:bg-white/5'
                }`}
              >
                <cat.icon className="w-5 h-5 flex-shrink-0" />
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Foundation */}
      {step === 'foundation' && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">Foundation</h3>
          <p className="text-[10px] text-gray-400 mb-3">
            Terrain: {district.terrain.grid[10]?.[10]?.soilType || 'unknown'} soil,
            bedrock at {district.terrain.grid[10]?.[10]?.bedrockDepth?.toFixed(1) || '?'}m,
            seismic zone {district.weather.seismicRisk}
          </p>

          <div className="mb-3">
            <label className="text-[10px] text-gray-400 mb-1 block">Material</label>
            <select
              value={selectedMaterial}
              onChange={e => setSelectedMaterial(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-white"
            >
              {materials.filter(m => ['concrete', 'USB-composite'].includes(m.category)).map(m => (
                <option key={m.id} value={m.id}>{m.name} — {m.properties.compressiveStrength} MPa</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => addMember('foundation')}
            className="w-full px-3 py-2 bg-cyan-500/20 text-cyan-300 rounded text-xs hover:bg-cyan-500/30 transition-colors"
          >
            + Add Foundation Element
          </button>

          {foundations.map(f => (
            <div key={f.id} className={`mt-2 p-2 rounded border ${feedbackColor(f.id)} text-[10px]`}>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Foundation — {materials.find(m => m.id === f.materialId)?.name || 'Unknown'}</span>
                <button onClick={() => removeMember(f.id)} className="text-red-400 hover:text-red-300">Remove</button>
              </div>
              {feedbackMap.get(f.id) && (
                <p className={`mt-1 ${feedbackMap.get(f.id)!.status === 'green' ? 'text-green-400' : feedbackMap.get(f.id)!.status === 'yellow' ? 'text-yellow-400' : 'text-red-400'}`}>
                  {feedbackMap.get(f.id)!.tooltip}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Step 3: Structure */}
      {step === 'structure' && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">Structure Builder</h3>
          <p className="text-[10px] text-gray-400 mb-3">
            Add structural members. Green = safe, Yellow = approaching limits, Red = exceeds capacity.
          </p>

          <div className="mb-3">
            <label className="text-[10px] text-gray-400 mb-1 block">Material</label>
            <select
              value={selectedMaterial}
              onChange={e => setSelectedMaterial(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-white"
            >
              {materials.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} — Tensile: {m.properties.tensileStrength} MPa, Fire: {m.properties.fireResistanceHours}h
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-1 mb-3">
            {(['wall', 'column', 'beam', 'floor', 'roof', 'brace'] as MemberType[]).map(type => (
              <button
                key={type}
                onClick={() => addMember(type)}
                className="px-2 py-1.5 bg-white/5 border border-white/10 rounded text-[10px] text-gray-300 hover:bg-white/10 capitalize"
              >
                + {type}
              </button>
            ))}
          </div>

          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {members.map(m => {
              const fb = feedbackMap.get(m.id);
              return (
                <div key={m.id} className={`p-2 rounded border ${feedbackColor(m.id)} text-[10px]`}>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300 capitalize font-medium">{m.type}</span>
                    <div className="flex items-center gap-2">
                      {fb && (
                        <span className={`${fb.status === 'green' ? 'text-green-400' : fb.status === 'yellow' ? 'text-yellow-400' : 'text-red-400'}`}>
                          {(fb.ratio * 100).toFixed(0)}%
                        </span>
                      )}
                      <button onClick={() => removeMember(m.id)} className="text-red-400 hover:text-red-300">x</button>
                    </div>
                  </div>
                  <p className="text-gray-400">
                    {m.dimensions.length}m x {m.dimensions.width}m x {m.dimensions.height}m
                    — {materials.find(mat => mat.id === m.materialId)?.name || 'Unknown'}
                  </p>
                  {fb && fb.status !== 'green' && (
                    <p className={`mt-0.5 ${fb.status === 'yellow' ? 'text-yellow-400' : 'text-red-400'}`}>
                      {fb.tooltip}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {members.length === 0 && (
            <p className="text-gray-600 text-xs text-center py-4">Add structural members to begin building.</p>
          )}
        </div>
      )}

      {/* Step 4: Systems */}
      {step === 'systems' && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">Utility Connections</h3>
          <p className="text-[10px] text-gray-400 mb-3">Your building needs utilities. Connect to district infrastructure.</p>
          <div className="space-y-2">
            {[
              { type: 'Water', items: district.infrastructure.waterMains, color: 'blue' },
              { type: 'Power', items: district.infrastructure.powerGrid, color: 'yellow' },
              { type: 'Drainage', items: district.infrastructure.drainage, color: 'green' },
              { type: 'Data', items: district.infrastructure.dataNetwork, color: 'purple' },
            ].map(({ type, items, color }) => (
              <div key={type} className="p-2 rounded border border-white/10">
                <div className="flex items-center justify-between">
                  <span className={`text-xs text-${color}-400`}>{type}</span>
                  {items.length > 0 ? (
                    <span className="text-[10px] text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {items.length} available
                    </span>
                  ) : (
                    <span className="text-[10px] text-red-400 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> Not available
                    </span>
                  )}
                </div>
                {items.length > 0 && (
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Nearest: {items[0].creator} ({items[0].capacity.toLocaleString()} capacity)
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 5: Validation */}
      {step === 'validation' && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">Full Validation</h3>

          {!validationReport && !validating && (
            <button
              onClick={runValidation}
              className="w-full py-3 bg-green-500/20 text-green-300 rounded-lg text-sm font-medium hover:bg-green-500/30 transition-colors"
            >
              Run Full Validation
            </button>
          )}

          {validating && (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mx-auto mb-2" />
              <p className="text-xs text-gray-400">Running physics validation...</p>
            </div>
          )}

          {validationReport && (
            <div className="space-y-3">
              <div className={`p-3 rounded-lg text-center ${validationReport.overallPass ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                {validationReport.overallPass ? (
                  <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-1" />
                ) : (
                  <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-1" />
                )}
                <p className={`text-sm font-bold ${validationReport.overallPass ? 'text-green-300' : 'text-red-300'}`}>
                  {validationReport.overallPass ? 'All Tests Passed' : `${validationReport.failurePoints.length} Failure(s) Found`}
                </p>
              </div>

              {/* Category bars */}
              {[
                { key: 'loadBearing', label: 'Load Bearing' },
                { key: 'windShear', label: 'Wind Shear' },
                { key: 'seismic', label: 'Seismic' },
                { key: 'thermal', label: 'Thermal' },
                { key: 'fire', label: 'Fire Resistance' },
              ].map(({ key, label }) => {
                const cat = validationReport.categories[key as keyof typeof validationReport.categories];
                if (!cat || !('pass' in cat)) return null;
                const catResult = cat as { pass: boolean };
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-24">{label}</span>
                    <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className={`h-full rounded-full ${catResult.pass ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: '100%' }} />
                    </div>
                    {catResult.pass ? (
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400" />
                    )}
                  </div>
                );
              })}

              <div className="p-2 rounded bg-white/5 text-center">
                <p className="text-xs text-gray-400">Habitability Score</p>
                <p className="text-2xl font-bold text-cyan-300">
                  {validationReport.categories.habitability.score}
                </p>
              </div>

              <button
                onClick={runValidation}
                className="w-full py-1.5 text-xs text-gray-400 hover:text-white border border-white/10 rounded transition-colors"
              >
                Re-run Validation
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 6: Publish */}
      {step === 'publish' && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">Publish</h3>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="My Building"
                className="w-full bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Describe your creation..."
                rows={3}
                className="w-full bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-white resize-none"
              />
            </div>

            <div className="p-2 rounded bg-white/5 text-[10px] text-gray-400">
              <p><strong className="text-white">{members.length + foundations.length}</strong> structural members</p>
              <p><strong className="text-white">{new Set([...members, ...foundations].map(m => m.materialId)).size}</strong> materials used</p>
              {validationReport && (
                <p>Validation: <strong className={validationReport.overallPass ? 'text-green-400' : 'text-red-400'}>
                  {validationReport.overallPass ? 'Passed' : 'Failed'}
                </strong></p>
              )}
            </div>

            <button
              onClick={handlePublish}
              disabled={!name.trim()}
              className="w-full py-2.5 bg-cyan-500/20 text-cyan-300 rounded-lg text-sm font-medium hover:bg-cyan-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Publish to District
            </button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2 border-t border-white/10">
        <button
          onClick={() => stepIndex > 0 ? setStep(STEP_ORDER[stepIndex - 1]) : onCancel()}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          {stepIndex > 0 ? 'Back' : 'Cancel'}
        </button>
        {stepIndex < STEP_ORDER.length - 1 && (
          <button
            onClick={() => setStep(STEP_ORDER[stepIndex + 1])}
            className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
