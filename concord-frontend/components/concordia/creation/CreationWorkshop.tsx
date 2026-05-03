'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '@/lib/api/client';
import { modeManager } from '@/lib/concordia/mode-manager';
import { emitEvent } from '@/lib/realtime/event-bus';

const TIER_LABELS = ['Tier 0 — Bare Hands', 'Tier 1 — Basic Tools', 'Tier 2 — Crafted Tools', 'Tier 3 — Advanced Tools', 'Tier 4 — Legendary Forge'];
const TIER_CAPS: Record<number, string> = {
  0: 'Rough, primitive objects. Stone, clay, basic wood structures only.',
  1: 'Simple shaped objects. Mortared walls, crude furniture, basic shelters.',
  2: 'Functional constructions. Iron fixtures, kiln-fired ceramics, multi-story structures.',
  3: 'Complex systems. Mechanical devices, electrical installations, precision components.',
  4: 'Any complexity. Masterwork items of any material or mechanism.',
};

// ── Types ────────────────────────────────────────────────────────────

interface ValidationResult {
  passed: boolean;
  score: number;         // 0-100 — satisfying progress bar (Minecraft-style incremental feedback)
  categories: {
    physics:    CategoryResult;
    materials:  CategoryResult;
    structural: CategoryResult;
    aesthetic:  CategoryResult;
  };
  derivedFrom: string[]; // DTU lineage ids
  suggestions: string[];
}

interface CategoryResult {
  passed: boolean;
  score: number;
  note: string;
}

interface PreviewObject {
  name: string;
  description: string;
  type: string;
  dimensions?: { width: number; height: number; depth: number };
  materials?: string[];
  thumbnail?: string;  // base64 or url
}

type WorkshopStep = 'spec' | 'preview' | 'validate' | 'place';

// ── Sub-components ───────────────────────────────────────────────────

function ValidationMeter({
  label, score, passed, note,
}: CategoryResult & { label: string }) {
  const color = passed
    ? score > 75 ? '#22c55e' : '#eab308'
    : '#ef4444';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs font-mono text-white/70">
        <span>{label}</span>
        <span style={{ color }}>{passed ? '✓' : '✗'} {score}/100</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-[10px] text-white/30">{note}</div>
    </div>
  );
}

function OverallScore({ score, passed }: { score: number; passed: boolean }) {
  const color = passed
    ? score > 80 ? '#22c55e' : '#eab308'
    : '#ef4444';
  const label = passed
    ? score > 90 ? 'Excellent' : score > 70 ? 'Good' : 'Marginal'
    : 'Fails validation';
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border"
      style={{ borderColor: color + '40', backgroundColor: color + '10' }}>
      <div className="text-3xl font-bold font-mono" style={{ color }}>{score}</div>
      <div>
        <div className="text-sm font-semibold" style={{ color }}>{label}</div>
        <div className="text-xs text-white/40">
          {passed ? 'Ready to place' : 'Fix issues before placing'}
        </div>
      </div>
      {/* Animated score ring — satisfying visual feedback (Minecraft build feedback DNA) */}
      <div className="ml-auto relative w-12 h-12">
        <svg viewBox="0 0 44 44" width="48" height="48">
          <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
          <circle
            cx="22" cy="22" r="18"
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 113} 113`}
            strokeDashoffset="28"
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

interface CreationWorkshopProps {
  playerPosition: { x: number; y: number; z: number };
  playerId: string;
  onClose: () => void;
  onPlaced?: (dtuId: string) => void;
}

export function CreationWorkshop({
  playerPosition,
  playerId,
  onClose,
  onPlaced,
}: CreationWorkshopProps) {
  const [step, setStep] = useState<WorkshopStep>('spec');
  const [spec, setSpec] = useState('');
  const [preview, setPreview] = useState<PreviewObject | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [toolTier, setToolTier] = useState(0);
  const [toolQuality, setToolQuality] = useState(10);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Fetch player's tool tier on mount
  useEffect(() => {
    api.get('/api/tools/mine').then(res => {
      const { tier, tools } = res.data ?? {};
      if (typeof tier === 'number') setToolTier(tier);
      if (Array.isArray(tools) && tools.length > 0) {
        const best = Math.max(...tools.map((t: { quality: number }) => t.quality ?? 10));
        setToolQuality(best);
      }
    }).catch(() => { /* stay at defaults */ });
  }, []);

  const MATERIALS = [
    { id: 'concrete',  label: 'Concrete',  color: '#9ca3af', note: 'High compressive strength' },
    { id: 'steel',     label: 'Steel',     color: '#6b7280', note: 'High tensile + compressive' },
    { id: 'wood',      label: 'Wood',      color: '#b45309', note: 'Lightweight, low density' },
    { id: 'glass',     label: 'Glass',     color: '#7dd3fc', note: 'Brittle, low tensile' },
    { id: 'brick',     label: 'Brick',     color: '#dc2626', note: 'Durable, moderate strength' },
    { id: 'aluminum',  label: 'Aluminum',  color: '#d1d5db', note: 'Light, corrosion resistant' },
  ];

  const handleGenerate = useCallback(async () => {
    if (!spec.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const mat = selectedMaterial ? ` Primary material: ${selectedMaterial}.` : '';
      const tierCap = TIER_CAPS[toolTier] ?? TIER_CAPS[0];
      const tierContext = `Player has Tool Tier ${toolTier} (${TIER_LABELS[toolTier]}). ${tierCap} If the spec requires a higher tier, decline it politely and suggest a simpler achievable version at this tier.`;
      const res = await api.post('/api/chat', {
        message: `${tierContext}\n\nGenerate a Concordia world object from this specification. Return JSON: { name, description, type, dimensions: {width, height, depth}, materials: string[], physics: {passed, score, note}, materialsCheck: {passed, score, note}, structural: {passed, score, note}, aesthetic: {passed, score, note}, overallScore, derivedFrom: string[], suggestions: string[] }. Spec: ${spec}${mat}`,
        lensContext: { lens: 'game', intent: 'creation-preview' },
        brainOverride: 'subconscious',
      });

      const raw: string = res.data?.response ?? res.data?.text ?? '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const parsed = JSON.parse(jsonMatch[0]);

      const newPreview: PreviewObject = {
        name: parsed.name ?? 'Creation',
        description: parsed.description ?? spec,
        type: parsed.type ?? 'object',
        dimensions: parsed.dimensions,
        materials: parsed.materials ?? [],
      };

      const newValidation: ValidationResult = {
        passed: (parsed.overallScore ?? 0) >= 60,
        score: parsed.overallScore ?? 70,
        categories: {
          physics:    { passed: parsed.physics?.passed    ?? true, score: parsed.physics?.score    ?? 70, note: parsed.physics?.note    ?? '' },
          materials:  { passed: parsed.materialsCheck?.passed ?? true, score: parsed.materialsCheck?.score ?? 70, note: parsed.materialsCheck?.note ?? '' },
          structural: { passed: parsed.structural?.passed ?? true, score: parsed.structural?.score ?? 70, note: parsed.structural?.note ?? '' },
          aesthetic:  { passed: parsed.aesthetic?.passed  ?? true, score: parsed.aesthetic?.score  ?? 70, note: parsed.aesthetic?.note  ?? '' },
        },
        derivedFrom: parsed.derivedFrom ?? [],
        suggestions: parsed.suggestions ?? [],
      };

      setPreview(newPreview);
      setValidation(newValidation);
      setStep('preview');
      emitEvent('creation:preview-generated', {
        score: newValidation.score,
        suggestions: newValidation.suggestions,
        derivedFrom: newValidation.derivedFrom,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [spec, selectedMaterial, toolTier]);

  const handlePlace = useCallback(async () => {
    if (!preview || !validation?.passed) return;
    setLoading(true);
    try {
      const res = await api.post('/api/dtus', {
        title: preview.name,
        content: preview.description,
        tags: ['concordia_creation', preview.type],
        meta: {
          type: 'concordia_creation',
          location: playerPosition,
          dimensions: preview.dimensions,
          materials: preview.materials,
          validationScore: validation.score,
          placedBy: playerId,
          toolTier,
          toolQuality,
        },
        parents: validation.derivedFrom,
      });
      const dtu = res.data?.dtu ?? res.data;
      if (dtu?.id) {
        emitEvent('creation:placed', { dtuId: dtu.id, score: validation.score });
        onPlaced?.(dtu.id);
        modeManager.pop();
        onClose();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [preview, validation, playerPosition, playerId, onPlaced, onClose, toolTier, toolQuality]);

  const handleVoice = useCallback(async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const form = new FormData();
        form.append('file', blob, 'voice.webm');
        form.append('mimeType', 'audio/webm');
        try {
          const { default: axios } = await import('axios');
          const res = await axios.post('/api/personal-locker/upload', form, {
            withCredentials: true,
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          const transcript: string = res.data?.dtu?.extractedText ?? '';
          if (transcript) setSpec(s => s + (s ? ' ' : '') + transcript);
        } catch { /* silent */ }
      };
      recorder.start();
      mediaRef.current = recorder;
      setRecording(true);
    } catch { /* silent */ }
  }, [recording]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-40">
      <div className="bg-black/90 border border-white/10 rounded-2xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10">
          <h2 className="font-bold text-white text-lg">Creation Workshop</h2>
          <div className="flex gap-2 text-xs font-mono">
            {(['spec', 'preview', 'validate', 'place'] as WorkshopStep[]).map((s, i) => (
              <span key={s} className={`px-2 py-0.5 rounded ${step === s ? 'bg-white/20 text-white' : 'text-white/30'}`}>
                {i + 1}. {s}
              </span>
            ))}
          </div>
          <button onClick={() => { modeManager.pop(); onClose(); }} className="text-white/40 hover:text-white ml-2">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Spec input */}
          {step === 'spec' && (
            <>
              {/* Tool tier badge */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs">
                <span className="text-white/40">Current tool tier:</span>
                <span className="text-white font-mono font-semibold">{TIER_LABELS[toolTier]}</span>
                <span className="ml-auto text-white/30">{TIER_CAPS[toolTier]}</span>
              </div>
              <div>
                <label className="text-sm text-white/70 mb-2 block">Describe what you want to build</label>
                <textarea
                  value={spec}
                  onChange={e => setSpec(e.target.value)}
                  rows={4}
                  placeholder="A two-story wooden cabin with stone foundation, large windows facing south, wrap-around porch…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white
                    placeholder-white/20 resize-none focus:outline-none focus:border-white/30"
                />
              </div>

              {/* Material library (Sims-style material picker) */}
              <div>
                <label className="text-sm text-white/70 mb-2 block">Primary material (optional)</label>
                <div className="grid grid-cols-3 gap-2">
                  {MATERIALS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMaterial(selectedMaterial === m.id ? null : m.id)}
                      className={`p-2 rounded-lg border text-xs text-left transition-all
                        ${selectedMaterial === m.id
                          ? 'border-white/60 bg-white/10'
                          : 'border-white/10 hover:border-white/30'
                        }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: m.color }} />
                        <span className="text-white font-medium">{m.label}</span>
                      </div>
                      <span className="text-white/30">{m.note}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleVoice}
                  className={`px-3 py-2 rounded-xl border text-sm transition-all
                    ${recording ? 'border-red-400 text-red-400 bg-red-400/10 animate-pulse' : 'border-white/10 text-white/50 hover:border-white/30'}`}
                >
                  {recording ? '⏹ Stop' : '🎤 Voice'}
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!spec.trim() || loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold py-2 rounded-xl transition-all"
                >
                  {loading ? 'Generating…' : 'Generate Preview'}
                </button>
              </div>
            </>
          )}

          {/* Preview + validation */}
          {(step === 'preview' || step === 'validate') && preview && validation && (
            <>
              <div className="bg-white/5 rounded-xl p-4">
                <div className="font-semibold text-white">{preview.name}</div>
                <div className="text-sm text-white/60 mt-1">{preview.description}</div>
                {preview.dimensions && (
                  <div className="text-xs text-white/30 mt-2 font-mono">
                    {preview.dimensions.width}m × {preview.dimensions.height}m × {preview.dimensions.depth}m
                  </div>
                )}
                {preview.materials && preview.materials.length > 0 && (
                  <div className="text-xs text-white/40 mt-1">
                    Materials: {preview.materials.join(', ')}
                  </div>
                )}
              </div>

              {/* Overall score ring — Minecraft-style satisfying feedback */}
              <OverallScore score={validation.score} passed={validation.passed} />

              {/* Category meters */}
              <div className="space-y-3">
                <ValidationMeter label="Physics" {...validation.categories.physics} />
                <ValidationMeter label="Materials" {...validation.categories.materials} />
                <ValidationMeter label="Structural" {...validation.categories.structural} />
                <ValidationMeter label="Aesthetic" {...validation.categories.aesthetic} />
              </div>

              {/* Suggestions */}
              {validation.suggestions.length > 0 && (
                <div className="space-y-1">
                  {validation.suggestions.map((s, i) => (
                    <div key={i} className="text-xs text-yellow-300/80 font-mono">
                      ⚠ {s}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => { setStep('spec'); setPreview(null); setValidation(null); }}
                  className="px-4 py-2 rounded-xl border border-white/10 text-white/60 text-sm hover:border-white/30 transition-all"
                >
                  Revise
                </button>
                <button
                  onClick={handlePlace}
                  disabled={!validation.passed || loading}
                  className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm font-semibold py-2 rounded-xl transition-all"
                >
                  {loading ? 'Placing…' : validation.passed ? 'Place in World' : 'Fix Issues First'}
                </button>
              </div>
            </>
          )}

          {error && <div className="text-xs text-red-400 font-mono">{error}</div>}
        </div>
      </div>
    </div>
  );
}
