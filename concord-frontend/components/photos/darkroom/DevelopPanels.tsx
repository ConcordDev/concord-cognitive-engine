'use client';

/** The develop panels on the right: light and colour, curve, HSL, detail, effects, geometry, masks, retouch. */
import { useState } from 'react';
import { Circle, Eraser, FlipHorizontal2, Minus, Paintbrush, RotateCcw, RotateCw, Sparkles, Trash2 } from 'lucide-react';
import { HSL_BANDS, defaultEdit } from '@/lib/photos/develop';
import { Slider, ToneCurve } from './controls';
import { ASPECTS, BAND_COLOURS, MASK_ADJ, PRESENCE, TONE, WB, type Edit, type Hist, type SliderDef } from './editTypes';
import type { BrushSettings, Tool } from './Viewer';

type Change = (e: Edit, final: boolean, label: string) => void;
const clone = (e: Edit): Edit => JSON.parse(JSON.stringify(e));

function Section({ title, open = true, onReset, changed, children, testid }: { title: string; open?: boolean; onReset?: () => void; changed?: boolean; children: React.ReactNode; testid?: string }) {
  return (
    <details className="dr-section" open={open} data-testid={testid}>
      <summary>
        <span className="dr-head flex items-center gap-2">{title}{changed && <span className="h-1.5 w-1.5 rounded-full bg-[var(--dr-safe)]" aria-label="changed" />}</span>
        {onReset && changed && <button type="button" className="text-[11px] text-[var(--dr-muted)] hover:text-[var(--dr-ink)]" onClick={(e) => { e.preventDefault(); onReset(); }}>Reset</button>}
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}

function Group<K extends keyof Edit['basic']>({ defs, edit, onChange }: { defs: SliderDef<K>[]; edit: Edit; onChange: Change }) {
  return (
    <>
      {defs.map((d) => (
        <Slider key={d.key} def={d} value={edit.basic[d.key]}
          onChange={(v) => { const n = clone(edit); n.basic[d.key] = v; onChange(n, false, d.label); }}
          onCommit={(v, label) => { const n = clone(edit); n.basic[d.key] = v; onChange(n, true, label); }} />
      ))}
    </>
  );
}

/** Auto: set exposure, whites and blacks from the photo's own histogram. */
function autoTone(edit: Edit, hist: Hist | null): Edit | null {
  if (!hist || !hist.samples) return null;
  const pct = (q: number) => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist.l[i]; if (acc >= hist.samples * q) return i / 255; } return 1; };
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const median = Math.max(0.02, pct(0.5)), lo = pct(0.005), hi = pct(0.995);
  const n = clone(edit);
  const delta = Math.log2(lin(0.46) / lin(median));
  n.basic.exposure = Math.max(-5, Math.min(5, Math.round((edit.basic.exposure + delta * 0.8) * 100) / 100));
  n.basic.whites = Math.max(-100, Math.min(100, Math.round(edit.basic.whites + (0.97 - hi) * 140)));
  n.basic.blacks = Math.max(-100, Math.min(100, Math.round(edit.basic.blacks - (lo - 0.02) * 260)));
  return n;
}

export function BasicPanel({ edit, onChange, hist }: { edit: Edit; onChange: Change; hist: Hist | null }) {
  const d = defaultEdit();
  const changed = JSON.stringify(edit.basic) !== JSON.stringify(d.basic);
  return (
    <Section title="Light & colour" changed={changed} onReset={() => { const n = clone(edit); n.basic = d.basic; onChange(n, true, 'Reset light & colour'); }} testid="dr-panel-basic">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11.5px] text-[var(--dr-muted)]">White balance</span>
        <button type="button" className="dr-btn h-6 px-2 text-[11.5px]" onClick={() => { const n = autoTone(edit, hist); if (n) onChange(n, true, 'Auto tone'); }} disabled={!hist} title="Set exposure, whites and blacks from this photo's histogram" data-testid="dr-auto"><Sparkles className="h-3 w-3" /> Auto</button>
      </div>
      <Group defs={WB} edit={edit} onChange={onChange} />
      <p className="mb-1 mt-2 text-[11.5px] text-[var(--dr-muted)]">Tone</p>
      <Group defs={TONE} edit={edit} onChange={onChange} />
      <p className="mb-1 mt-2 text-[11.5px] text-[var(--dr-muted)]">Presence</p>
      <Group defs={PRESENCE} edit={edit} onChange={onChange} />
    </Section>
  );
}

export function CurvePanel({ edit, onChange }: { edit: Edit; onChange: Change }) {
  const [ch, setCh] = useState<'rgb' | 'r' | 'g' | 'b'>('rgb');
  const ident = (c: Edit['curve']['rgb']) => c.length === 2 && c[0][0] === 0 && c[0][1] === 0 && c[1][0] === 1 && c[1][1] === 1;
  const changed = !(['rgb', 'r', 'g', 'b'] as const).every((k) => ident(edit.curve[k]));
  const set = (pts: Edit['curve']['rgb'], final: boolean) => { const n = clone(edit); n.curve[ch] = pts; onChange(n, final, `Curve (${ch.toUpperCase()})`); };
  return (
    <Section title="Tone curve" open={false} changed={changed} onReset={() => { const n = clone(edit); n.curve = defaultEdit().curve; onChange(n, true, 'Reset curve'); }} testid="dr-panel-curve">
      <div className="mb-2 flex gap-1" role="tablist" aria-label="Curve channel">
        {(['rgb', 'r', 'g', 'b'] as const).map((c) => (
          <button key={c} type="button" role="tab" aria-selected={ch === c} className="dr-btn h-6 px-2 text-[11px]" aria-pressed={ch === c} onClick={() => setCh(c)}>{c === 'rgb' ? 'RGB' : c.toUpperCase()}</button>
        ))}
      </div>
      <ToneCurve points={edit.curve[ch]} channel={ch} onChange={(p) => set(p, false)} onCommit={(p) => set(p, true)} />
      <p className="mt-1 text-[11px] text-[var(--dr-muted)]">Click to add a point, drag to shape, double-click a point to remove it.</p>
    </Section>
  );
}

export function HslPanel({ edit, onChange }: { edit: Edit; onChange: Change }) {
  const [mode, setMode] = useState<'h' | 's' | 'l'>('s');
  const changed = HSL_BANDS.some((b) => edit.hsl[b].h || edit.hsl[b].s || edit.hsl[b].l);
  const names = { h: 'Hue', s: 'Saturation', l: 'Luminance' };
  return (
    <Section title="Colour mixer" open={false} changed={changed} onReset={() => { const n = clone(edit); n.hsl = defaultEdit().hsl; onChange(n, true, 'Reset colour mixer'); }} testid="dr-panel-hsl">
      <div className="mb-2 flex gap-1" role="tablist" aria-label="Colour mixer">
        {(['h', 's', 'l'] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} aria-pressed={mode === m} className="dr-btn h-6 px-2 text-[11px]" onClick={() => setMode(m)}>{names[m]}</button>)}
      </div>
      {HSL_BANDS.map((b) => {
        const def: SliderDef<string> = { key: `${b}-${mode}`, label: b[0].toUpperCase() + b.slice(1), min: -100, max: 100, step: 1, fmt: (v) => (v > 0 ? `+${v}` : `${v}`), gradient: `linear-gradient(90deg, ${mode === 'l' ? '#111' : mode === 'h' ? '#888' : '#777'}, ${BAND_COLOURS[b]}${mode === 'l' ? ', #fff' : ''})` };
        return (
          <Slider key={def.key} def={def} value={edit.hsl[b][mode]}
            onChange={(v) => { const n = clone(edit); n.hsl[b][mode] = v; onChange(n, false, `${names[mode]} ${b}`); }}
            onCommit={(v) => { const n = clone(edit); n.hsl[b][mode] = v; onChange(n, true, `${names[mode]} ${b} ${v > 0 ? '+' : ''}${v}`); }} />
        );
      })}
    </Section>
  );
}

export function DetailPanel({ edit, onChange }: { edit: Edit; onChange: Change }) {
  const d = defaultEdit();
  const changed = JSON.stringify(edit.detail) !== JSON.stringify(d.detail) || edit.effects.vignette !== 0;
  const s = (key: 'sharpen' | 'radius' | 'noise', label: string, min: number, max: number, step: number) => (
    <Slider def={{ key, label, min, max, step, fmt: (v) => (step < 1 ? v.toFixed(1) : String(Math.round(v))) }} value={edit.detail[key]}
      onChange={(v) => { const n = clone(edit); n.detail[key] = v; onChange(n, false, label); }}
      onCommit={(v) => { const n = clone(edit); n.detail[key] = v; onChange(n, true, `${label} ${v}`); }} />
  );
  return (
    <Section title="Detail & effects" open={false} changed={changed} onReset={() => { const n = clone(edit); n.detail = d.detail; n.effects = d.effects; onChange(n, true, 'Reset detail & effects'); }} testid="dr-panel-detail">
      {s('sharpen', 'Sharpen', 0, 150, 1)}
      {s('radius', 'Radius', 0.5, 3, 0.1)}
      {s('noise', 'Noise', 0, 100, 1)}
      <Slider def={{ key: 'vignette', label: 'Vignette', min: -100, max: 100, step: 1, fmt: (v) => (v > 0 ? `+${v}` : `${v}`) }} value={edit.effects.vignette}
        onChange={(v) => { const n = clone(edit); n.effects.vignette = v; onChange(n, false, 'Vignette'); }}
        onCommit={(v) => { const n = clone(edit); n.effects.vignette = v; onChange(n, true, `Vignette ${v}`); }} />
    </Section>
  );
}

export function GeometryPanel({ edit, onChange, tool, setTool, aspect, setAspect }: {
  edit: Edit; onChange: Change; tool: Tool; setTool: (t: Tool) => void; aspect: string; setAspect: (a: string) => void;
}) {
  const g = edit.geometry;
  const changed = g.orient !== 0 || g.flipH || g.angle !== 0 || g.crop.x !== 0 || g.crop.y !== 0 || g.crop.w !== 1 || g.crop.h !== 1;
  const rot = (dir: 1 | -1) => { const n = clone(edit); n.geometry.orient = (((g.orient + dir * 90) % 360) + 360) % 360 as Edit['geometry']['orient']; n.geometry.crop = { x: 0, y: 0, w: 1, h: 1 }; onChange(n, true, dir > 0 ? 'Rotate right' : 'Rotate left'); };
  return (
    <Section title="Crop & straighten" open={tool === 'crop'} changed={changed} onReset={() => { const n = clone(edit); n.geometry = defaultEdit().geometry; onChange(n, true, 'Reset crop'); }} testid="dr-panel-crop">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <button type="button" className="dr-btn" aria-pressed={tool === 'crop'} onClick={() => setTool(tool === 'crop' ? 'none' : 'crop')} data-testid="dr-tool-crop">{tool === 'crop' ? 'Done' : 'Crop'} <span className="dr-kbd">R</span></button>
        <button type="button" className="dr-icon" onClick={() => rot(-1)} aria-label="Rotate left"><RotateCcw className="h-4 w-4" /></button>
        <button type="button" className="dr-icon" onClick={() => rot(1)} aria-label="Rotate right"><RotateCw className="h-4 w-4" /></button>
        <button type="button" className="dr-icon" aria-pressed={g.flipH} onClick={() => { const n = clone(edit); n.geometry.flipH = !g.flipH; onChange(n, true, 'Flip'); }} aria-label="Flip horizontally"><FlipHorizontal2 className="h-4 w-4" /></button>
      </div>
      <label className="mb-2 grid grid-cols-[76px,1fr] items-center gap-2 text-[12px] text-[var(--dr-ink-2)]">Aspect
        <select className="dr-input" value={aspect} onChange={(e) => setAspect(e.target.value)} aria-label="Crop aspect">
          {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </label>
      <Slider def={{ key: 'angle', label: 'Straighten', min: -45, max: 45, step: 0.05, fmt: (v) => `${v.toFixed(2)}°` }} value={g.angle}
        onChange={(v) => { const n = clone(edit); n.geometry.angle = v; onChange(n, false, 'Straighten'); }}
        onCommit={(v) => { const n = clone(edit); n.geometry.angle = v; onChange(n, true, `Straighten ${v.toFixed(2)}°`); }} />
      <p className="mt-1 text-[11px] leading-snug text-[var(--dr-muted)]">In crop, drag a corner or edge, drag inside to move, or hold <span className="dr-kbd">Alt</span> and draw along the horizon to level it.</p>
    </Section>
  );
}

export function MasksPanel({ edit, onChange, tool, setTool, selected, setSelected, showOverlay, setShowOverlay, brush, setBrush }: {
  edit: Edit; onChange: Change; tool: Tool; setTool: (t: Tool) => void; selected: number | null; setSelected: (i: number | null) => void;
  showOverlay: boolean; setShowOverlay: (v: boolean) => void; brush: BrushSettings; setBrush: (b: BrushSettings) => void;
}) {
  const m = selected != null ? edit.masks[selected] : null;
  const add = (t: Tool) => { setSelected(null); setTool(tool === t ? 'none' : t); };
  return (
    <Section title={`Masks${edit.masks.length ? ` · ${edit.masks.length}` : ''}`} open={tool === 'radial' || tool === 'linear' || tool === 'brush'} changed={edit.masks.length > 0} testid="dr-panel-masks">
      <div className="mb-2 flex flex-wrap gap-1">
        <button type="button" className="dr-btn" aria-pressed={tool === 'radial'} onClick={() => add('radial')} data-testid="dr-tool-radial"><Circle className="h-3.5 w-3.5" /> Radial <span className="dr-kbd">⇧M</span></button>
        <button type="button" className="dr-btn" aria-pressed={tool === 'linear'} onClick={() => add('linear')} data-testid="dr-tool-linear"><Minus className="h-3.5 w-3.5" /> Linear <span className="dr-kbd">M</span></button>
        <button type="button" className="dr-btn" aria-pressed={tool === 'brush'} onClick={() => add('brush')} data-testid="dr-tool-brush"><Paintbrush className="h-3.5 w-3.5" /> Brush <span className="dr-kbd">K</span></button>
      </div>
      {tool !== 'none' && tool !== 'crop' && tool !== 'spot' && !m && <p className="mb-2 text-[11.5px] text-[var(--dr-muted)]">{tool === 'radial' ? 'Drag on the photo from the centre out (Shift for a circle).' : tool === 'linear' ? 'Drag from where the effect is full to where it fades out.' : 'Paint on the photo.'}</p>}
      {edit.masks.length > 0 && (
        <ul className="mb-2 space-y-1" data-testid="dr-mask-list">
          {edit.masks.map((mk, i) => (
            <li key={mk.id}>
              <button type="button" onClick={() => { setSelected(selected === i ? null : i); setTool(selected === i ? 'none' : mk.kind); }} aria-pressed={selected === i}
                className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[12.5px] transition-colors ${selected === i ? 'bg-[var(--dr-safe-soft)] text-white' : 'text-[var(--dr-ink-2)] hover:bg-[var(--dr-panel-2)]'}`}>
                <span>{mk.name || mk.kind} {mk.invert && <span className="text-[var(--dr-muted)]">(inverted)</span>}</span>
                <span className="dr-mono text-[10.5px] text-[var(--dr-muted)]">{Object.entries(mk.adj).filter(([, v]) => v).length} set</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {m && (
        <div className="dr-rise space-y-1 rounded border border-[var(--dr-rule)] p-2" data-testid="dr-mask-editor">
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" className="dr-btn h-6 px-2 text-[11px]" aria-pressed={m.invert} onClick={() => { const n = clone(edit); n.masks[selected!].invert = !m.invert; onChange(n, true, 'Invert mask'); }}>Invert</button>
            <button type="button" className="dr-btn h-6 px-2 text-[11px]" aria-pressed={showOverlay} onClick={() => setShowOverlay(!showOverlay)} title="Show the mask (O)">Overlay <span className="dr-kbd">O</span></button>
            <button type="button" className="dr-icon ml-auto" aria-label="Delete mask" onClick={() => { const n = clone(edit); n.masks.splice(selected!, 1); setSelected(null); onChange(n, true, 'Delete mask'); }}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          {m.kind === 'brush' && (
            <div className="space-y-1 border-b border-[var(--dr-rule)] pb-1">
              <div className="flex gap-1">
                <button type="button" className="dr-btn h-6 px-2 text-[11px]" aria-pressed={!brush.erase} onClick={() => setBrush({ ...brush, erase: false })}><Paintbrush className="h-3 w-3" /> Paint</button>
                <button type="button" className="dr-btn h-6 px-2 text-[11px]" aria-pressed={brush.erase} onClick={() => setBrush({ ...brush, erase: true })}><Eraser className="h-3 w-3" /> Erase</button>
              </div>
              <Slider def={{ key: 'bsize', label: 'Size', min: 0.005, max: 0.3, step: 0.005, fmt: (v) => `${Math.round(v * 1000) / 10}%` }} value={brush.size} onChange={(v) => setBrush({ ...brush, size: v })} onCommit={() => {}} />
              <Slider def={{ key: 'bfeather', label: 'Feather', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` }} value={brush.feather} onChange={(v) => setBrush({ ...brush, feather: v })} onCommit={() => {}} />
              <Slider def={{ key: 'bflow', label: 'Flow', min: 0.05, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` }} value={brush.flow} onChange={(v) => setBrush({ ...brush, flow: v })} onCommit={() => {}} />
            </div>
          )}
          {m.kind === 'radial' && m.radial && (
            <Slider def={{ key: 'feather', label: 'Feather', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}` }} value={m.radial.feather}
              onChange={(v) => { const n = clone(edit); n.masks[selected!].radial!.feather = v; onChange(n, false, 'Feather'); }}
              onCommit={(v) => { const n = clone(edit); n.masks[selected!].radial!.feather = v; onChange(n, true, `Feather ${Math.round(v * 100)}`); }} />
          )}
          <Slider def={{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` }} value={m.amount}
            onChange={(v) => { const n = clone(edit); n.masks[selected!].amount = v; onChange(n, false, 'Mask amount'); }}
            onCommit={(v) => { const n = clone(edit); n.masks[selected!].amount = v; onChange(n, true, `Mask amount ${Math.round(v * 100)}%`); }} />
          {MASK_ADJ.map((d) => (
            <Slider key={d.key} def={d} value={m.adj[d.key]}
              onChange={(v) => { const n = clone(edit); n.masks[selected!].adj[d.key] = v; onChange(n, false, `Mask ${d.label}`); }}
              onCommit={(v, label) => { const n = clone(edit); n.masks[selected!].adj[d.key] = v; onChange(n, true, `Mask ${label}`); }} />
          ))}
        </div>
      )}
    </Section>
  );
}

export function RetouchPanel({ edit, onChange, tool, setTool, mode, setMode, size, setSize, selected, setSelected }: {
  edit: Edit; onChange: Change; tool: Tool; setTool: (t: Tool) => void; mode: 'heal' | 'clone'; setMode: (m: 'heal' | 'clone') => void;
  size: number; setSize: (v: number) => void; selected: number | null; setSelected: (i: number | null) => void;
}) {
  return (
    <Section title={`Retouch${edit.spots.length ? ` · ${edit.spots.length}` : ''}`} open={tool === 'spot'} changed={edit.spots.length > 0} onReset={() => { const n = clone(edit); n.spots = []; setSelected(null); onChange(n, true, 'Clear spots'); }} testid="dr-panel-retouch">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <button type="button" className="dr-btn" aria-pressed={tool === 'spot'} onClick={() => setTool(tool === 'spot' ? 'none' : 'spot')} data-testid="dr-tool-spot">Spot removal <span className="dr-kbd">Q</span></button>
        <button type="button" className="dr-btn h-6 px-2 text-[11px]" aria-pressed={mode === 'heal'} onClick={() => setMode('heal')}>Heal</button>
        <button type="button" className="dr-btn h-6 px-2 text-[11px]" aria-pressed={mode === 'clone'} onClick={() => setMode('clone')}>Clone</button>
      </div>
      <Slider def={{ key: 'spotsize', label: 'Size', min: 0.004, max: 0.15, step: 0.002, fmt: (v) => `${Math.round(v * 1000) / 10}%` }} value={size} onChange={setSize} onCommit={() => {}} />
      {selected != null && edit.spots[selected] && (
        <div className="mt-1 flex items-center gap-1">
          <span className="text-[11.5px] text-[var(--dr-muted)]">Spot {selected + 1}</span>
          <button type="button" className="dr-btn h-6 px-2 text-[11px]" onClick={() => { const n = clone(edit); n.spots[selected].mode = n.spots[selected].mode === 'heal' ? 'clone' : 'heal'; onChange(n, true, 'Spot mode'); }}>{edit.spots[selected].mode === 'heal' ? 'Make clone' : 'Make heal'}</button>
          <button type="button" className="dr-icon ml-auto" aria-label="Delete spot" onClick={() => { const n = clone(edit); n.spots.splice(selected, 1); setSelected(null); onChange(n, true, 'Delete spot'); }}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <p className="mt-1 text-[11px] leading-snug text-[var(--dr-muted)]">Click a blemish: the darkroom finds clean texture nearby. Drag the dashed circle to choose your own source.</p>
    </Section>
  );
}
