'use client';

import React, { useState, useRef, useCallback } from 'react';
import {
  X,
  Sparkles,
  Hammer,
  Shield,
  Wand2,
  Zap,
  CheckCircle,
  AlertCircle,
  Loader2,
  Send,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ResourceRequirement {
  resource_id: string;
  quantity: number;
}
interface SkillRequirement {
  skill_type: string;
  level: number;
}
interface EstimatedStats {
  damage?: number;
  defense?: number;
  durability?: number;
  enchantment_power?: number;
  speed?: number;
}

interface DesignSpec {
  name: string;
  output_type: 'item' | 'spell' | 'ability';
  output_subtype: string;
  enchantments: string[];
  properties: Record<string, string | number>;
  description: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  resource_requirements: ResourceRequirement[];
  skill_requirements: SkillRequirement[];
  estimated_stats: EstimatedStats;
  quality?: { pass: boolean; score: number; errors: string[]; suggestions: string[] };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface DesignHUDProps {
  worldId: string;
  worldType?: string;
  onClose: () => void;
  onSaved?: (recipeId: string, recipeName: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const OUTPUT_TYPES = [
  { value: 'item', label: 'Item', icon: Hammer },
  { value: 'spell', label: 'Spell', icon: Wand2 },
  { value: 'ability', label: 'Ability', icon: Zap },
];

const ITEM_SUBTYPES = [
  'sword',
  'bow',
  'staff',
  'shield',
  'armor',
  'potion',
  'gadget',
  'explosive',
  'building_plan',
];
const SPELL_SUBTYPES = [
  'fireball',
  'icebolt',
  'lightning',
  'heal',
  'shield',
  'summon',
  'illusion',
  'teleport',
];
const ABILITY_SUBTYPES = [
  'flight',
  'speed_boost',
  'stealth',
  'strength',
  'regeneration',
  'shield',
  'hack',
  'telepathy',
];

const ENCHANTMENT_OPTIONS = [
  'fire',
  'ice',
  'lightning',
  'poison',
  'holy',
  'shadow',
  'arcane',
  'speed',
  'strength',
  'durability',
  'luck',
  'life_steal',
];

const QUALITY_COLORS: Record<string, string> = {
  common: 'text-gray-300',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  legendary: 'text-yellow-400',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function DesignHUD({ worldId, worldType = 'standard', onClose, onSaved }: DesignHUDProps) {
  const [spec, setSpec] = useState<DesignSpec>({
    name: '',
    output_type: 'item',
    output_subtype: 'sword',
    enchantments: [],
    properties: {},
    description: '',
  });
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [crafting, setCrafting] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `Design your creation for the ${worldType} world. Tell me what you want to make — a weapon, spell, ability — and I'll help spec it out and check it against this world's physics.`,
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);
  const [craftResult, setCraftResult] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const subtypes =
    spec.output_type === 'item'
      ? ITEM_SUBTYPES
      : spec.output_type === 'spell'
        ? SPELL_SUBTYPES
        : ABILITY_SUBTYPES;

  // ── AI chat ──────────────────────────────────────────────────────────────

  const sendChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    const newMessages: ChatMessage[] = [...chat, { role: 'user', content: msg }];
    setChat(newMessages);
    setChatLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[DESIGN HUD — ${worldType} world] User wants to design: ${msg}\n\nCurrent spec: ${JSON.stringify(spec)}\n\nSuggest a concrete spec update as JSON in this format:\n{"name":"...", "output_type":"item|spell|ability", "output_subtype":"...", "enchantments":[], "description":"...", "properties":{}}\n\nAlso explain why this fits (or doesn't fit) the ${worldType} world physics in 1-2 sentences.`,
          mode: 'chat',
        }),
      });
      const data = await res.json();
      const reply = data.reply || 'Tell me more about what you have in mind.';

      // Try to extract a spec suggestion from the reply
      const jsonMatch = reply.match(/\{[\s\S]*?"output_type"[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const suggested = JSON.parse(jsonMatch[0]) as Partial<DesignSpec>;
          setSpec((prev) => ({
            ...prev,
            name: suggested.name || prev.name,
            output_type: suggested.output_type || prev.output_type,
            output_subtype: suggested.output_subtype || prev.output_subtype,
            enchantments: suggested.enchantments || prev.enchantments,
            description: suggested.description || prev.description,
            properties: { ...prev.properties, ...(suggested.properties || {}) },
          }));
        } catch {
          /* no spec in reply */
        }
      }

      setChat([...newMessages, { role: 'assistant', content: reply }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch {
      setChat([
        ...newMessages,
        { role: 'assistant', content: 'Could not reach the design assistant. Try again.' },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [chat, chatInput, chatLoading, spec, worldType]);

  // ── Validation ───────────────────────────────────────────────────────────

  const validate = async () => {
    if (!spec.name || !spec.output_subtype) return;
    setValidating(true);
    setValidation(null);
    try {
      // Run both recipe validation and quality gate in parallel
      const [validateRes, qualityRes] = await Promise.all([
        fetch('/api/crafting/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spec, worldId }),
        }),
        // Quality gate only applies to spells and abilities
        (spec.output_type === 'spell' || spec.output_type === 'ability') && spec.description
          ? fetch('/api/crafting/skills/validate-quality', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                description: spec.description,
                skill_type: spec.output_subtype || spec.output_type,
                properties: spec.properties,
              }),
            })
          : Promise.resolve(null),
      ]);

      const data = await validateRes.json();
      let quality: ValidationResult['quality'] | undefined;

      if (qualityRes) {
        const qData = await qualityRes.json();
        quality = {
          pass: qData.pass,
          score: qData.score,
          errors: qData.errors ?? [],
          suggestions: qData.suggestions ?? [],
        };
        // If quality gate fails, mark overall as invalid
        if (!quality.pass) {
          data.valid = false;
          data.errors = [...(data.errors || []), ...quality.errors];
        }
      }

      setValidation({ ...data, quality });
    } catch {
      setValidation({
        valid: false,
        errors: ['Could not reach validation server.'],
        warnings: [],
        resource_requirements: [],
        skill_requirements: [],
        estimated_stats: {},
      });
    } finally {
      setValidating(false);
    }
  };

  // ── Save recipe DTU ──────────────────────────────────────────────────────

  const saveRecipe = async () => {
    if (!validation?.valid) return;
    setSaving(true);
    try {
      const res = await fetch('/api/crafting/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec, worldId, name: spec.name }),
      });
      const data = await res.json();
      if (data.ok && data.recipe?.id) {
        setSavedRecipeId(data.recipe.id);
        onSaved?.(data.recipe.id, spec.name);
      }
    } catch {
      /* non-fatal */
    } finally {
      setSaving(false);
    }
  };

  // ── Execute craft ────────────────────────────────────────────────────────

  const craft = async () => {
    if (!savedRecipeId) return;
    setCrafting(true);
    setCraftResult(null);
    try {
      const res = await fetch('/api/crafting/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipeId: savedRecipeId, worldId }),
      });
      const data = await res.json();
      if (data.ok) {
        setCraftResult(`✦ ${spec.name} created!`);
      } else {
        setCraftResult(
          `✗ ${data.error || 'Craft failed'}: ${data.missing_resources?.map((r: ResourceRequirement) => `${r.quantity}× ${r.resource_id}`).join(', ') || ''}`
        );
      }
    } catch {
      setCraftResult('Craft failed — server error.');
    } finally {
      setCrafting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const toggleEnchantment = (e: string) => {
    setSpec((prev) => ({
      ...prev,
      enchantments: prev.enchantments.includes(e)
        ? prev.enchantments.filter((x) => x !== e)
        : [...prev.enchantments, e],
    }));
    setValidation(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-5xl bg-black/95 border border-white/10 rounded-2xl flex flex-col"
        style={{ height: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">Design Studio</span>
          <span className="text-xs text-white/30 ml-1">— {worldType} world</span>
          <button
            onClick={onClose}
            className="ml-auto text-white/30 hover:text-white transition-colors"
          aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: 3 columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: AI Chat */}
          <div className="w-64 flex flex-col border-r border-white/10 flex-shrink-0">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-white/30 border-b border-white/5">
              Design Assistant
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
              {chat.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-2 ${m.role === 'user' ? 'bg-violet-900/30 text-white ml-4' : 'bg-white/5 text-white/80'}`}
                >
                  {m.content}
                </div>
              ))}
              {chatLoading && (
                <div className="bg-white/5 rounded-lg p-2 text-white/40 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="p-2 border-t border-white/10 flex gap-1">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                placeholder="Describe your creation..."
                className="flex-1 bg-white/5 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/20 outline-none"
              />
              <button
                onClick={sendChat}
                disabled={chatLoading}
                className="p-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 transition-colors"
              aria-label="Send">
                <Send className="w-3 h-3 text-white" />
              </button>
            </div>
          </div>

          {/* Middle: Spec editor */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="px-0 py-0 text-[10px] uppercase tracking-wider text-white/30 mb-1">
              Spec
            </div>

            {/* Name */}
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wide">Name</label>
              <input
                value={spec.name}
                onChange={(e) => {
                  setSpec((p) => ({ ...p, name: e.target.value }));
                  setValidation(null);
                }}
                placeholder="e.g. Emberblade, Fireball of Wrath, Shadow Step"
                className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-violet-500/50"
              />
            </div>

            {/* Output type */}
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wide">Type</label>
              <div className="mt-1 flex gap-2">
                {OUTPUT_TYPES.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => {
                      setSpec((p) => ({
                        ...p,
                        output_type: value as DesignSpec['output_type'],
                        output_subtype: '',
                      }));
                      setValidation(null);
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all border ${spec.output_type === value ? 'border-violet-500/60 bg-violet-900/30 text-violet-300' : 'border-white/10 bg-white/5 text-white/40 hover:text-white/60'}`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Subtype */}
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wide">Subtype</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {subtypes.map((st) => (
                  <button
                    key={st}
                    onClick={() => {
                      setSpec((p) => ({ ...p, output_subtype: st }));
                      setValidation(null);
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs transition-all ${spec.output_subtype === st ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'}`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Enchantments (items & spells) */}
            {spec.output_type !== 'ability' && (
              <div>
                <label className="text-[10px] text-white/40 uppercase tracking-wide">
                  Enchantments
                </label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {ENCHANTMENT_OPTIONS.map((e) => (
                    <button
                      key={e}
                      onClick={() => toggleEnchantment(e)}
                      className={`px-2 py-0.5 rounded text-[10px] transition-all ${spec.enchantments.includes(e) ? 'bg-amber-600/70 text-amber-100 border border-amber-500/50' : 'bg-white/5 text-white/30 hover:text-white/50'}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wide">
                Description / Lore
              </label>
              <textarea
                value={spec.description}
                onChange={(e) => setSpec((p) => ({ ...p, description: e.target.value }))}
                placeholder="What does it look like? What's its story?"
                rows={3}
                className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 outline-none focus:border-violet-500/50 resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={validate}
                disabled={validating || !spec.name}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 text-white disabled:opacity-30 transition-all"
              >
                {validating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Shield className="w-3.5 h-3.5" />
                )}
                Validate
              </button>
              <button
                onClick={saveRecipe}
                disabled={!validation?.valid || saving}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-30 transition-all"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {savedRecipeId ? 'Update Recipe' : 'Save Recipe'}
              </button>
              <button
                onClick={craft}
                disabled={!savedRecipeId || crafting}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-30 transition-all"
              >
                {crafting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Hammer className="w-3.5 h-3.5" />
                )}
                Craft Now
              </button>
            </div>

            {craftResult && (
              <div
                className={`rounded-lg p-2 text-xs ${craftResult.startsWith('✦') ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}
              >
                {craftResult}
              </div>
            )}
          </div>

          {/* Right: Requirements + estimated stats */}
          <div className="w-56 flex-shrink-0 border-l border-white/10 overflow-y-auto p-3 space-y-4">
            <div className="text-[10px] uppercase tracking-wider text-white/30">Requirements</div>

            {!validation && !validating && (
              <p className="text-[10px] text-white/20 leading-relaxed">
                Fill out your design and click Validate to see resource and skill requirements.
              </p>
            )}

            {validating && (
              <div className="flex items-center gap-2 text-xs text-white/40">
                <Loader2 className="w-3 h-3 animate-spin" /> Checking world physics...
              </div>
            )}

            {validation && (
              <>
                {/* Status */}
                <div
                  className={`flex items-center gap-1.5 text-xs font-medium ${validation.valid ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {validation.valid ? (
                    <CheckCircle className="w-3.5 h-3.5" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5" />
                  )}
                  {validation.valid ? 'Design valid' : 'Design invalid'}
                </div>

                {/* Errors */}
                {validation.errors.map((e, i) => (
                  <p key={i} className="text-[10px] text-red-400 leading-relaxed">
                    ✗ {e}
                  </p>
                ))}
                {validation.warnings.map((w, i) => (
                  <p key={i} className="text-[10px] text-amber-400 leading-relaxed">
                    ⚠ {w}
                  </p>
                ))}

                {/* Resources */}
                {validation.resource_requirements.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
                      Materials
                    </div>
                    {validation.resource_requirements.map((r, i) => (
                      <div key={i} className="flex justify-between text-[10px] text-white/60 mb-1">
                        <span>{r.resource_id}</span>
                        <span className="text-white/40">×{r.quantity}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Skills */}
                {validation.skill_requirements.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
                      Skills Needed
                    </div>
                    {validation.skill_requirements.map((s, i) => (
                      <div key={i} className="flex justify-between text-[10px] text-white/60 mb-1">
                        <span className="capitalize">{s.skill_type}</span>
                        <span className="text-violet-400">Lv.{s.level}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quality gate results (spells/abilities only) */}
                {validation.quality && (
                  <div
                    className={`rounded-lg border p-2 mb-2 ${validation.quality.pass ? 'border-emerald-500/30 bg-emerald-900/10' : 'border-red-500/30 bg-red-900/10'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wider text-white/30">
                        Quality Gate
                      </span>
                      <span
                        className={`text-[11px] font-bold ${validation.quality.pass ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {validation.quality.score}% {validation.quality.pass ? '✓ Pass' : '✗ Fail'}
                      </span>
                    </div>
                    {/* Score bar */}
                    <div className="w-full h-1 bg-white/10 rounded-full mb-2">
                      <div
                        className={`h-1 rounded-full transition-all ${validation.quality.score >= 80 ? 'bg-emerald-400' : validation.quality.score >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                        style={{ width: `${validation.quality.score}%` }}
                      />
                    </div>
                    {validation.quality.suggestions.length > 0 && (
                      <ul className="space-y-0.5">
                        {validation.quality.suggestions.map((s, i) => (
                          <li key={i} className="text-[10px] text-amber-300/80 leading-tight">
                            💡 {s}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Estimated stats */}
                {validation.estimated_stats &&
                  Object.keys(validation.estimated_stats).length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
                        Est. Stats
                      </div>
                      {Object.entries(validation.estimated_stats)
                        .filter(([, v]) => v != null)
                        .map(([k, v]) => (
                          <div
                            key={k}
                            className="flex justify-between text-[10px] text-white/60 mb-1"
                          >
                            <span className="capitalize">{k.replace('_', ' ')}</span>
                            <span
                              className={
                                typeof v === 'number' && v > 0
                                  ? QUALITY_COLORS.uncommon
                                  : 'text-white/40'
                              }
                            >
                              {v}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
              </>
            )}

            {savedRecipeId && (
              <div className="mt-2 rounded-lg bg-violet-900/20 border border-violet-500/20 p-2">
                <p className="text-[10px] text-violet-300">
                  Recipe saved. Gather the required materials then click Craft Now.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
