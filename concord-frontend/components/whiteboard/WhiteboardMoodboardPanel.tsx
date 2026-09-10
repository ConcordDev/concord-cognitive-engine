'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Image as ImageIcon, LayoutGrid, PenTool, Plus, X } from 'lucide-react';
import { COLORS, DEFAULT_MOOD_ZONES, type MoodZone } from './whiteboard-model';

const QUICK_COLORS = ['#1a1a2e', '#16213e', '#0f3460', '#533483', '#e94560', '#f5c518', '#06d6a0', '#118ab2', '#073b4c', '#ef476f', '#ffd166', '#6c5ce7'];

export function WhiteboardMoodboardPanel() {
  const [moodZones, setMoodZones] = useState<MoodZone[]>(DEFAULT_MOOD_ZONES);
  const [moodInput, setMoodInput] = useState('');
  const [moodTarget, setMoodTarget] = useState<string | null>(null);
  const [moodKind, setMoodKind] = useState<'text' | 'color' | 'audio' | 'image'>('text');

  const addMoodItem = () => {
    if (!moodTarget || !moodInput.trim()) return;
    setMoodZones((prev) => prev.map((z) =>
      z.id === moodTarget
        ? { ...z, items: [...z.items, { kind: moodKind, value: moodInput.trim() }] }
        : z
    ));
    setMoodInput('');
    setMoodTarget(null);
  };
  const removeMoodItem = (zoneId: string, idx: number) => {
    setMoodZones((prev) => prev.map((z) => z.id === zoneId ? { ...z, items: z.items.filter((_, i) => i !== idx) } : z));
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center gap-3 mb-4">
        <LayoutGrid className="w-5 h-5 text-neon-pink" />
        <span className="text-sm font-semibold">Moodboard</span>
        <span className="text-xs text-gray-400">Click a zone to add inspiration items</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 max-w-6xl mx-auto">
        {moodZones.map((zone) => (
          <div key={zone.id} className="bg-lattice-surface border border-lattice-border rounded-xl p-4 min-h-[200px] flex flex-col">
            <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              {zone.label}
              <button
                type="button"
                onClick={() => { setMoodTarget(zone.id); setMoodKind('text'); }}
                className="ml-auto w-6 h-6 rounded bg-lattice-bg text-gray-400 hover:text-white flex items-center justify-center"
                aria-label="Add"
              >
                <Plus className="w-3 h-3" />
              </button>
            </h3>
            <div className="flex-1 flex flex-wrap gap-2 content-start">
              {zone.items.map((item, idx) => (
                <div key={idx} className="group relative">
                  {item.kind === 'color' ? (
                    <div className="w-10 h-10 rounded-lg border border-white/10" style={{ backgroundColor: item.value }} />
                  ) : item.kind === 'audio' ? (
                    <div className="flex items-center gap-2 bg-neon-cyan/10 border border-neon-cyan/30 rounded-lg px-3 py-1.5">
                      <PenTool className="w-3 h-3 text-neon-cyan" />
                      <span className="text-xs text-neon-cyan">{item.value}</span>
                    </div>
                  ) : item.kind === 'image' ? (
                    <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5">
                      <ImageIcon className="w-3 h-3 text-amber-400" />
                      <span className="text-xs text-amber-400">{item.value}</span>
                    </div>
                  ) : (
                    <div className="bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-1.5">
                      <span className="text-xs text-gray-300">{item.value}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeMoodItem(zone.id, idx)}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white items-center justify-center text-[9px] hidden group-hover:flex"
                    aria-label="Close"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
              {zone.items.length === 0 && (
                <p className="text-xs text-gray-400 italic">Drop or add items here...</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 max-w-6xl mx-auto">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">Quick Mood Colors</h3>
        <div className="flex gap-3 flex-wrap">
          {QUICK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                const colorZone = moodZones.find((z) => z.label === 'Color Palette');
                if (colorZone) {
                  setMoodZones((prev) => prev.map((z) => z.id === colorZone.id
                    ? { ...z, items: [...z.items, { kind: 'color', value: c }] } : z));
                }
              }}
              className="w-10 h-10 rounded-lg border border-white/10 hover:scale-110 transition-transform"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {moodTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-lattice-surface border border-lattice-border rounded-lg p-5 w-80">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm">Add to {moodZones.find((z) => z.id === moodTarget)?.label}</h3>
                <button type="button" onClick={() => setMoodTarget(null)} aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex gap-2 mb-3">
                {(['text', 'audio', 'image', 'color'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMoodKind(k)}
                    className={`px-3 py-1 rounded-lg text-xs capitalize ${moodKind === k ? 'bg-neon-pink/20 text-neon-pink' : 'bg-lattice-bg text-gray-400'}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              {moodKind === 'color' ? (
                <div className="grid grid-cols-6 gap-2 mb-4">
                  {COLORS.concat(['#1a1a2e', '#0f3460', '#e94560', '#06d6a0']).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setMoodInput(c); }}
                      className={`w-8 h-8 rounded-lg border-2 ${moodInput === c ? 'border-white' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              ) : (
                <input
                  type="text"
                  value={moodInput}
                  onChange={(e) => setMoodInput(e.target.value)}
                  autoFocus
                  placeholder={moodKind === 'audio' ? 'Audio note...' : moodKind === 'image' ? 'Image description...' : 'Mood description...'}
                  onKeyDown={(e) => e.key === 'Enter' && addMoodItem()}
                  className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-4"
                />
              )}
              <div className="flex gap-2">
                <button type="button" onClick={addMoodItem} disabled={!moodInput.trim()} className="flex-1 py-2 bg-neon-pink text-black rounded-lg text-sm font-medium disabled:opacity-40">Add</button>
                <button type="button" onClick={() => setMoodTarget(null)} className="flex-1 py-2 bg-lattice-bg rounded-lg text-sm">Cancel</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
