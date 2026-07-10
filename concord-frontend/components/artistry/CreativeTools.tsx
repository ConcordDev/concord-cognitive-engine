'use client';

/**
 * CreativeTools — structured input UI for artistry's 4 stateless "compute
 * sandbox" macros (colorPaletteAnalysis / compositionScore / styleClassify /
 * mediaInventory). These macros operate on caller-supplied artifact.data —
 * they have no persistence of their own and are NOT part of the Behance-
 * parity social-portfolio substrate (see the capability map).
 *
 * Pre-rebuild, these were wired to a `handleArtistryAction` that always
 * called the macro with NO params (targetId came from an empty generic
 * useLensData artifact list) — so in practice every button only ever
 * returned the honest "no data provided" fallback message. This component
 * replaces that dead wiring with real structured inputs (the same
 * `field | field | field` line-input idiom already used elsewhere in this
 * lens — ProjectStudio's images/processSteps, PortfolioProfile's links).
 */

import { useState } from 'react';
import { Palette, Ruler, Eye, Tag, Plus, AlertTriangle } from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { ErrorState } from '@/components/ui/ErrorState';

type ToolId = 'palette' | 'composition' | 'style' | 'inventory';

const TOOLS: { id: ToolId; label: string; icon: typeof Palette }[] = [
  { id: 'palette', label: 'Color Palette', icon: Palette },
  { id: 'composition', label: 'Composition Score', icon: Ruler },
  { id: 'style', label: 'Style Classify', icon: Eye },
  { id: 'inventory', label: 'Media Inventory', icon: Tag },
];

// ── shared bits ──────────────────────────────────────────────────────────

function RunButton({ status, onClick, label = 'Run analysis' }: { status: string; onClick: () => void; label?: string }) {
  const busy = status === 'dispatched' || status === 'running';
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="px-4 py-2 bg-neon-pink/20 border border-neon-pink/30 rounded-lg text-sm hover:bg-neon-pink/30 disabled:opacity-50 flex items-center gap-2"
    >
      {busy ? 'Running…' : label}
    </button>
  );
}

function HonestEmptyMessage({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-gray-400 bg-white/5 border border-white/10 rounded-lg p-3">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-yellow-500" />
      <span>{message}</span>
    </div>
  );
}

// ── Color Palette Analysis ──────────────────────────────────────────────

interface ColorAnalysisResult {
  message?: string;
  colorCount?: number;
  colors?: { hex: string; hueName: string; saturation: number; lightness: number; temperature: string }[];
  dominantHueName?: string;
  harmonyScore?: number;
  harmonyLabel?: string;
  averageSaturation?: number;
  averageLightness?: number;
  contrastRange?: number;
  contrastLevel?: string;
  temperatureBalance?: string;
}

function PaletteTool() {
  const { status, result, error, dispatch } = useMacroDispatchFeedback<ColorAnalysisResult>();
  const [lines, setLines] = useState('#e63946|2\n#f1faee|1\n#a8dadc|1\n#457b9d|1\n#1d3557|1');

  const run = () => {
    const palette = lines
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [color, weight] = line.split('|').map((s) => s.trim());
        const w = parseFloat(weight);
        return Number.isFinite(w) ? { color, weight: w } : { color };
      });
    dispatch('artistry', 'colorPaletteAnalysis', { palette });
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-gray-400">Colors — one per line: <code className="text-neon-pink">hex|weight</code> (weight optional)</span>
        <textarea
          value={lines}
          onChange={(e) => setLines(e.target.value)}
          rows={5}
          spellCheck={false}
          className="w-full mt-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-mono"
        />
      </label>
      <RunButton status={status} onClick={run} />
      {error && <ErrorState variant="inline" message={error} onRetry={run} />}
      {result?.message && <HonestEmptyMessage message={result.message} />}
      {result && !result.message && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2 bg-white/5 rounded text-center">
              <p className="text-sm font-bold text-neon-pink">{result.harmonyScore}</p>
              <p className="text-[10px] text-gray-400 capitalize">{result.harmonyLabel} harmony</p>
            </div>
            <div className="p-2 bg-white/5 rounded text-center">
              <p className="text-sm font-bold text-neon-cyan capitalize">{result.dominantHueName}</p>
              <p className="text-[10px] text-gray-400">Dominant hue</p>
            </div>
            <div className="p-2 bg-white/5 rounded text-center">
              <p className="text-sm font-bold text-yellow-400 capitalize">{result.contrastLevel}</p>
              <p className="text-[10px] text-gray-400">Contrast ({result.contrastRange})</p>
            </div>
          </div>
          <div className="text-xs text-gray-400">
            Avg saturation {result.averageSaturation}% · Avg lightness {result.averageLightness}% · {result.temperatureBalance}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(result.colors || []).map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-white/5 border border-white/10 rounded-lg">
                <span className="w-4 h-4 rounded-sm border border-white/20 shrink-0" style={{ backgroundColor: c.hex }} title={c.hex} />
                <span className="text-[10px] text-gray-300">{c.hex} · {c.hueName}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Composition Score ─────────────────────────────────────────────────

interface CompositionResult {
  message?: string;
  overallScore?: number;
  ruleOfThirdsScore?: number;
  balanceScore?: number;
  coverageScore?: number;
  coverageRatio?: number;
  quadrantDistribution?: { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
  elementCount?: number;
  suggestion?: string;
}

function CompositionTool() {
  const { status, result, error, dispatch } = useMacroDispatchFeedback<CompositionResult>();
  const [canvasW, setCanvasW] = useState('1000');
  const [canvasH, setCanvasH] = useState('1000');
  const [lines, setLines] = useState('320|300|360|280|1\n700|650|180|180|0.6');

  const run = () => {
    const elements = lines
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [x, y, width, height, weight] = line.split('|').map((s) => parseFloat(s.trim()));
        return { x, y, width, height, weight: Number.isFinite(weight) ? weight : 1 };
      });
    dispatch('artistry', 'compositionScore', {
      canvas: { width: parseFloat(canvasW) || 1000, height: parseFloat(canvasH) || 1000 },
      elements,
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-gray-400">Canvas width</span>
          <input value={canvasW} onChange={(e) => setCanvasW(e.target.value)} type="number" className="w-full mt-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Canvas height</span>
          <input value={canvasH} onChange={(e) => setCanvasH(e.target.value)} type="number" className="w-full mt-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-gray-400">Elements — one per line: <code className="text-neon-pink">x|y|width|height|weight</code></span>
        <textarea
          value={lines}
          onChange={(e) => setLines(e.target.value)}
          rows={4}
          spellCheck={false}
          className="w-full mt-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-mono"
        />
      </label>
      <RunButton status={status} onClick={run} />
      {error && <ErrorState variant="inline" message={error} onRetry={run} />}
      {result?.message && <HonestEmptyMessage message={result.message} />}
      {result && !result.message && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="text-3xl font-bold text-neon-cyan">{result.overallScore}<span className="text-sm text-gray-400">/1.0</span></div>
            <p className="text-xs text-gray-400 flex-1">{result.suggestion}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-white/5 rounded"><p className="text-sm font-bold text-white">{result.ruleOfThirdsScore}</p><p className="text-[10px] text-gray-400">Rule of thirds</p></div>
            <div className="p-2 bg-white/5 rounded"><p className="text-sm font-bold text-white">{result.balanceScore}</p><p className="text-[10px] text-gray-400">Balance</p></div>
            <div className="p-2 bg-white/5 rounded"><p className="text-sm font-bold text-white">{result.coverageScore}</p><p className="text-[10px] text-gray-400">Coverage ({Math.round((result.coverageRatio ?? 0) * 100)}%)</p></div>
          </div>
          {result.quadrantDistribution && (
            <div className="grid grid-cols-2 gap-1 max-w-[160px] text-[10px] text-gray-400 text-center">
              <div className="p-1.5 bg-white/5 rounded">{result.quadrantDistribution.topLeft}%</div>
              <div className="p-1.5 bg-white/5 rounded">{result.quadrantDistribution.topRight}%</div>
              <div className="p-1.5 bg-white/5 rounded">{result.quadrantDistribution.bottomLeft}%</div>
              <div className="p-1.5 bg-white/5 rounded">{result.quadrantDistribution.bottomRight}%</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Style Classify ───────────────────────────────────────────────────

interface StyleResult {
  message?: string;
  classification?: string;
  confidence?: number;
  matchedKeywords?: string[];
  runnerUp?: { style: string; confidence: number } | null;
}

function StyleTool() {
  const { status, result, error, dispatch } = useMacroDispatchFeedback<StyleResult>();
  const [medium, setMedium] = useState('oil on canvas');
  const [era, setEra] = useState('19th century');
  const [technique, setTechnique] = useState('loose brushstrokes, plein air');
  const [subject, setSubject] = useState('landscape');
  const [tags, setTags] = useState('impressionist, light, nature');

  const run = () => {
    dispatch('artistry', 'styleClassify', {
      attributes: { medium, era, technique, subject },
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <input value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="Medium" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
        <input value={era} onChange={(e) => setEra(e.target.value)} placeholder="Era" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
        <input value={technique} onChange={(e) => setTechnique(e.target.value)} placeholder="Technique" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
      </div>
      <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (comma separated)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
      <RunButton status={status} onClick={run} />
      {error && <ErrorState variant="inline" message={error} onRetry={run} />}
      {result?.message && <HonestEmptyMessage message={result.message} />}
      {result && !result.message && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-purple-400">{result.classification}</span>
            {!!result.confidence && <span className="text-xs text-gray-400">{Math.round(result.confidence * 100)}% confidence</span>}
          </div>
          {result.runnerUp && <p className="text-xs text-gray-400">Runner-up: {result.runnerUp.style} ({Math.round(result.runnerUp.confidence * 100)}%)</p>}
          {!!result.matchedKeywords?.length && (
            <div className="flex flex-wrap gap-1">
              {result.matchedKeywords.map((k) => <span key={k} className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded text-gray-400">{k}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Media Inventory ──────────────────────────────────────────────────

interface InventoryResult {
  message?: string;
  totalItems?: number;
  totalInventoryValue?: number;
  reorderCount?: number;
  estimatedReorderCost?: number;
  categoryBreakdown?: { category: string; itemCount: number; totalValue: number; percentOfValue: number }[];
  reorderAlerts?: { name: string; category: string; currentQuantity: number; threshold: number; urgency: string; estimatedReorderCost: number }[];
}

const URGENCY_COLOR: Record<string, string> = { critical: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400' };

function InventoryTool() {
  const { status, result, error, dispatch } = useMacroDispatchFeedback<InventoryResult>();
  const [lines, setLines] = useState('Cadmium Red|paint|3|tube|8.50|2\nCanvas 16x20|surface|5|panel|12.00|3\nFine liner pens|drawing|1|set|15.00|2');

  const run = () => {
    const supplies = lines
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, category, quantity, unit, unitCost, reorderThreshold] = line.split('|').map((s) => s.trim());
        return {
          name, category,
          quantity: parseFloat(quantity) || 0,
          unit,
          unitCost: parseFloat(unitCost) || 0,
          reorderThreshold: parseFloat(reorderThreshold) || 0,
        };
      });
    dispatch('artistry', 'mediaInventory', { supplies });
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-gray-400">Supplies — one per line: <code className="text-neon-pink">name|category|quantity|unit|unitCost|reorderThreshold</code></span>
        <textarea
          value={lines}
          onChange={(e) => setLines(e.target.value)}
          rows={4}
          spellCheck={false}
          className="w-full mt-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-mono"
        />
      </label>
      <RunButton status={status} onClick={run} />
      {error && <ErrorState variant="inline" message={error} onRetry={run} />}
      {result?.message && <HonestEmptyMessage message={result.message} />}
      {result && !result.message && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-white/5 rounded"><p className="text-lg font-bold text-yellow-400">{result.totalItems}</p><p className="text-[10px] text-gray-400">Items</p></div>
            <div className="p-2 bg-white/5 rounded"><p className="text-lg font-bold text-white">${result.totalInventoryValue}</p><p className="text-[10px] text-gray-400">Total value</p></div>
            <div className="p-2 bg-white/5 rounded"><p className="text-lg font-bold text-red-400">{result.reorderCount}</p><p className="text-[10px] text-gray-400">Reorder alerts</p></div>
          </div>
          {!!result.categoryBreakdown?.length && (
            <div className="grid grid-cols-2 gap-2">
              {result.categoryBreakdown.map((c) => (
                <div key={c.category} className="p-2 bg-white/5 rounded flex justify-between text-xs">
                  <span className="text-white capitalize">{c.category}</span>
                  <span className="text-gray-400">${c.totalValue} ({c.percentOfValue}%)</span>
                </div>
              ))}
            </div>
          )}
          {!!result.reorderAlerts?.length && (
            <div className="space-y-1.5">
              {result.reorderAlerts.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
                  <span className="text-gray-200">{a.name} <span className="text-gray-500">({a.currentQuantity}/{a.threshold})</span></span>
                  <span className={URGENCY_COLOR[a.urgency] || 'text-gray-400'}>{a.urgency} · ${a.estimatedReorderCost}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Container ─────────────────────────────────────────────────────────

export function CreativeTools() {
  const [active, setActive] = useState<ToolId>('palette');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Plus className="w-5 h-5 text-neon-pink rotate-45" /> Creative Tools</h2>
        <p className="text-xs text-gray-400 mt-1">
          Four standalone compute utilities — they analyze the data you supply here directly; they are not part of your portfolio.
        </p>
      </div>
      <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10 w-fit">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${active === t.id ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>
      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
        {active === 'palette' && <PaletteTool />}
        {active === 'composition' && <CompositionTool />}
        {active === 'style' && <StyleTool />}
        {active === 'inventory' && <InventoryTool />}
      </div>
    </div>
  );
}
