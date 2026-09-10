'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, GripVertical, Plus, Trash2 } from 'lucide-react';
import { clamp, DEFAULT_ARRANGEMENT, SECTION_PRESETS, type ArrangementSection } from './whiteboard-model';

export function WhiteboardArrangementPanel() {
  const [arrangement, setArrangement] = useState<ArrangementSection[]>(DEFAULT_ARRANGEMENT);
  const [pace, setPace] = useState(120);
  const [theme, setTheme] = useState('Minimal');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const totalBars = arrangement.reduce((s, sec) => s + sec.bars, 0);
  const addSection = (preset: typeof SECTION_PRESETS[0]) => {
    setArrangement((prev) => [...prev, { ...preset, id: `arr_${Date.now()}`, label: preset.label }]);
  };
  const removeSection = (id: string) => setArrangement((prev) => prev.filter((s) => s.id !== id));
  const updateSectionBars = (id: string, bars: number) => {
    setArrangement((prev) => prev.map((s) => s.id === id ? { ...s, bars: clamp(bars, 1, 32) } : s));
  };
  const handleArrDragStart = (idx: number) => setDragIdx(idx);
  const handleArrDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const updated = [...arrangement];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(idx, 0, moved);
    setArrangement(updated);
    setDragIdx(idx);
  };
  const handleArrDragEnd = () => setDragIdx(null);

  return (
    <div className="flex-1 overflow-auto p-6 relative">
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <Clock className="w-5 h-5 text-neon-cyan" />
        <span className="text-sm font-semibold">Arrangement Sketch</span>
        <label className="text-xs text-gray-400">Pace</label>
        <input
          type="number"
          value={pace}
          onChange={(e) => setPace(clamp(+e.target.value, 20, 300))}
          className="w-16 px-2 py-1 bg-lattice-bg border border-lattice-border rounded text-sm text-center tabular-nums"
        />
        <label className="text-xs text-gray-400">Theme</label>
        <input
          type="text"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          className="w-24 px-2 py-1 bg-lattice-bg border border-lattice-border rounded text-sm text-center"
        />
        <span className="text-xs text-gray-400">Total: <strong className="text-white tabular-nums">{totalBars}</strong> bars</span>
        <span className="text-xs text-gray-400 ml-auto">Drag to rearrange sections</span>
      </div>

      <div className="absolute top-6 right-6 flex items-center gap-3 bg-lattice-surface border border-lattice-border rounded-lg px-4 py-2 z-10">
        <span className="text-xs text-gray-400">Speed</span>
        <span className="text-lg font-bold text-neon-cyan tabular-nums">{pace}</span>
        <div className="w-px h-6 bg-lattice-border" />
        <span className="text-xs text-gray-400">Theme</span>
        <span className="text-lg font-bold text-neon-pink">{theme}</span>
      </div>

      <div className="mt-4">
        <div className="flex items-end gap-3 mb-6 flex-wrap pb-4">
          {arrangement.map((sec, idx) => (
            <motion.div
              key={sec.id}
              layout
              draggable
              onDragStart={() => handleArrDragStart(idx)}
              onDragOver={(e) => handleArrDragOver(e, idx)}
              onDragEnd={handleArrDragEnd}
              className={`flex-shrink-0 rounded-xl border-2 cursor-grab active:cursor-grabbing transition-shadow ${dragIdx === idx ? 'shadow-lg shadow-white/10' : ''}`}
              style={{ borderColor: sec.color, width: Math.max(sec.bars * 20, 80), minHeight: 120, backgroundColor: sec.color + '15' }}
            >
              <div className="p-3 flex flex-col h-full">
                <div className="flex items-center gap-1 mb-2">
                  <GripVertical className="w-3 h-3 text-gray-400" />
                  <span className="text-xs font-bold" style={{ color: sec.color }}>{sec.label}</span>
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <span className="text-2xl font-bold text-white/80 tabular-nums">{sec.bars}</span>
                  <span className="text-xs text-gray-400 ml-1 mt-1">bars</span>
                </div>
                <div className="flex items-center gap-1 mt-2">
                  <button type="button" onClick={() => updateSectionBars(sec.id, sec.bars - 1)} className="w-6 h-6 rounded bg-lattice-bg text-gray-400 hover:text-white flex items-center justify-center text-xs">-</button>
                  <button type="button" onClick={() => updateSectionBars(sec.id, sec.bars + 1)} className="w-6 h-6 rounded bg-lattice-bg text-gray-400 hover:text-white flex items-center justify-center text-xs">+</button>
                  <div className="flex-1" />
                  <button type="button" onClick={() => removeSection(sec.id)} className="w-6 h-6 rounded bg-lattice-bg text-red-400 hover:text-red-300 flex items-center justify-center" aria-label="Delete"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            </motion.div>
          ))}

          <div className="flex-shrink-0 w-20">
            <div className="border-2 border-dashed border-lattice-border rounded-xl flex items-center justify-center min-h-[120px] hover:border-white/20 transition-colors group relative">
              <Plus className="w-6 h-6 text-gray-600 group-hover:text-gray-400" />
              <div className="absolute top-full mt-2 left-0 bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-20 w-40">
                {SECTION_PRESETS.map((s) => (
                  <button key={s.type} type="button" onClick={() => addSection(s)} className="w-full text-left px-3 py-2 text-xs hover:bg-lattice-elevated flex items-center gap-2">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0 flex-wrap">
          {arrangement.map((sec) => (
            <div key={`ruler_${sec.id}`} className="flex-shrink-0 flex" style={{ width: Math.max(sec.bars * 20, 80) + 12 }}>
              {Array.from({ length: sec.bars }, (_, i) => (
                <div key={i} className="flex-1 h-4 border-l border-lattice-border flex items-end">
                  <span className="text-[9px] text-gray-400 pl-0.5 tabular-nums">{i + 1}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
