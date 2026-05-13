'use client';

import { useState, useMemo } from 'react';
import { Search, Music, Waves, Sliders, Drum, Layers, Sparkles, Grid3X3, List, ArrowUpRight, Play, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SynthPreset, EffectInstance, DrumPattern } from '@/lib/daw/types';
import type { DTUEvent } from '@/lib/daw/dtu-hooks';

interface SoundboardProps {
  dtuEvents: DTUEvent[];
  synthPresets: SynthPreset[];
  effectPresets: EffectInstance[];
  drumPatterns: DrumPattern[];
  currentKey: string;
  currentBpm: number;
  currentGenre: string | null;
  onLoadPreset: (preset: SynthPreset) => void;
  onLoadEffectChain: (effects: EffectInstance[]) => void;
  onLoadPattern: (pattern: DrumPattern) => void;
  onDragToTrack: (type: string, data: Record<string, unknown>) => void;
}

type SoundboardTab = 'all' | 'instruments' | 'effects' | 'patterns' | 'audio' | 'suggestions';
type ViewMode = 'grid' | 'list';

export function Soundboard({
  dtuEvents,
  synthPresets,
  effectPresets,
  drumPatterns,
  currentKey,
  currentBpm,
  currentGenre,
  onLoadPreset,
  onLoadEffectChain,
  onLoadPattern,
  onDragToTrack,
}: SoundboardProps) {
  const [tab, setTab] = useState<SoundboardTab>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  const instrumentDTUs = useMemo(() => dtuEvents.filter(e => e.type === 'instrument'), [dtuEvents]);
  const effectDTUs = useMemo(() => dtuEvents.filter(e => e.type === 'effect'), [dtuEvents]);
  const patternDTUs = useMemo(() => dtuEvents.filter(e => e.type === 'pattern'), [dtuEvents]);
  const audioDTUs = useMemo(() => dtuEvents.filter(e => e.type === 'audio'), [dtuEvents]);

  // Intelligent suggestions based on current project context
  const suggestions = useMemo(() => {
    const items: Array<{ type: string; title: string; reason: string; data: Record<string, unknown> }> = [];

    // Suggest presets matching current key/genre
    synthPresets.forEach(preset => {
      if (preset.tags.some(t => currentGenre?.toLowerCase().includes(t.toLowerCase()))) {
        items.push({ type: 'instrument', title: preset.name, reason: `Matches genre: ${currentGenre}`, data: { preset } });
      }
    });

    // Suggest patterns matching BPM
    drumPatterns.forEach(pattern => {
      items.push({ type: 'pattern', title: pattern.name, reason: `${currentBpm} BPM compatible`, data: { pattern } });
    });

    // Suggest from DTU history
    instrumentDTUs.slice(-3).forEach(evt => {
      items.push({
        type: 'instrument',
        title: String(evt.meta.presetName || 'Recent Preset'),
        reason: 'Recently used',
        data: evt.data,
      });
    });

    return items.slice(0, 8);
  }, [synthPresets, drumPatterns, instrumentDTUs, currentBpm, currentGenre]);

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    let items: Array<{ id: string; type: string; title: string; tags: string[]; timestamp: number; data: Record<string, unknown>; favorite: boolean }> = [];

    if (tab === 'all' || tab === 'instruments') {
      synthPresets.forEach(p => {
        items.push({ id: p.id, type: 'instrument', title: p.name, tags: p.tags, timestamp: Date.now(), data: { preset: p }, favorite: favoriteIds.has(p.id) });
      });
      instrumentDTUs.forEach(e => {
        const id = String(e.data.presetId || e.timestamp);
        items.push({ id, type: 'instrument', title: String(e.meta.presetName || 'Preset'), tags: e.tags, timestamp: e.timestamp, data: e.data, favorite: favoriteIds.has(id) });
      });
    }

    if (tab === 'all' || tab === 'effects') {
      effectDTUs.forEach(e => {
        const id = String(e.timestamp);
        items.push({ id, type: 'effect', title: String(e.data.context || 'Effect Chain'), tags: e.tags, timestamp: e.timestamp, data: e.data, favorite: favoriteIds.has(id) });
      });
    }

    if (tab === 'all' || tab === 'patterns') {
      drumPatterns.forEach(p => {
        items.push({ id: p.id, type: 'pattern', title: p.name, tags: ['pattern', 'drums'], timestamp: Date.now(), data: { pattern: p }, favorite: favoriteIds.has(p.id) });
      });
      patternDTUs.forEach(e => {
        const id = String(e.timestamp);
        items.push({ id, type: 'pattern', title: String(e.data.genre || 'Pattern'), tags: e.tags, timestamp: e.timestamp, data: e.data, favorite: favoriteIds.has(id) });
      });
    }

    if (tab === 'all' || tab === 'audio') {
      audioDTUs.forEach(e => {
        const id = String(e.data.bufferId || e.timestamp);
        items.push({ id, type: 'audio', title: String(e.data.name || 'Audio'), tags: e.tags, timestamp: e.timestamp, data: e.data, favorite: favoriteIds.has(id) });
      });
    }

    if (q) {
      items = items.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // Sort: favorites first, then by timestamp
    items.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.timestamp - a.timestamp;
    });

    return items;
  }, [tab, search, synthPresets, drumPatterns, instrumentDTUs, effectDTUs, patternDTUs, audioDTUs, favoriteIds]);

  const handleLoadItem = (type: string, data: Record<string, unknown>) => {
    switch (type) {
      case 'instrument':
        if (data.preset) onLoadPreset(data.preset as SynthPreset);
        break;
      case 'effect':
        if (data.effects) onLoadEffectChain(data.effects as EffectInstance[]);
        else if (effectPresets.length > 0) onLoadEffectChain(effectPresets);
        break;
      case 'pattern':
        if (data.pattern) onLoadPattern(data.pattern as DrumPattern);
        break;
    }
  };

  const toggleFavorite = (id: string) => {
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'instrument': return <Waves className="w-3.5 h-3.5 text-neon-purple" />;
      case 'effect': return <Sliders className="w-3.5 h-3.5 text-neon-cyan" />;
      case 'pattern': return <Drum className="w-3.5 h-3.5 text-neon-green" />;
      case 'audio': return <Music className="w-3.5 h-3.5 text-neon-pink" />;
      default: return <Layers className="w-3.5 h-3.5 text-gray-400" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-black/40 border-b border-white/10 p-3 space-y-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Layers className="w-4 h-4 text-neon-cyan" /> Soundboard
          </h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setViewMode('grid')} className={cn('p-1 rounded', viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-gray-500')} aria-label="Grid3 x3">
              <Grid3X3 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setViewMode('list')} className={cn('p-1 rounded', viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-500')} aria-label="List view">
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search sounds, presets, patterns..."
            className="w-full pl-7 pr-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none focus:border-neon-cyan/30"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {([
            { id: 'all', label: 'All', count: filteredItems.length },
            { id: 'instruments', label: 'Instruments', count: synthPresets.length + instrumentDTUs.length },
            { id: 'effects', label: 'Effects', count: effectDTUs.length },
            { id: 'patterns', label: 'Patterns', count: drumPatterns.length + patternDTUs.length },
            { id: 'audio', label: 'Audio', count: audioDTUs.length },
            { id: 'suggestions', label: 'AI Suggests', count: suggestions.length },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px]',
                tab === t.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-500 hover:text-white'
              )}
            >
              {t.label} <span className="text-gray-600">({t.count})</span>
            </button>
          ))}
        </div>

        {/* Context info */}
        <div className="flex items-center gap-2 text-[9px] text-gray-500">
          <Sparkles className="w-3 h-3 text-neon-purple" />
          <span>Context: {currentKey} {currentBpm}BPM {currentGenre && `| ${currentGenre}`}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'suggestions' ? (
          <div className="space-y-2">
            <p className="text-[10px] text-gray-400 mb-3">
              <Sparkles className="w-3 h-3 inline text-neon-purple mr-1" />
              Smart suggestions based on your project context
            </p>
            {suggestions.map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/10 hover:border-neon-purple/30 cursor-pointer group">
                {typeIcon(item.type)}
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium block truncate">{item.title}</span>
                  <span className="text-[9px] text-gray-500 flex items-center gap-1">
                    <ArrowUpRight className="w-2.5 h-2.5" /> {item.reason}
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleLoadItem(item.type, item.data); }}
                  className="opacity-0 group-hover:opacity-100 text-[10px] px-2 py-0.5 bg-neon-purple/10 text-neon-purple rounded"
                >
                  Load
                </button>
              </div>
            ))}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {filteredItems.map(item => (
              <div
                key={item.id}
                className="p-2.5 rounded-lg bg-white/5 border border-white/10 hover:border-neon-cyan/20 cursor-pointer group transition-colors"
                onClick={() => handleLoadItem(item.type, item.data)}
                draggable
                onDragStart={() => onDragToTrack(item.type, item.data)}
              >
                <div className="flex items-center gap-2 mb-1">
                  {typeIcon(item.type)}
                  <span className="text-[11px] font-medium truncate flex-1">{item.title}</span>
                  <button
                    onClick={e => { e.stopPropagation(); toggleFavorite(item.id); }}
                    className={cn('p-0.5', item.favorite ? 'text-yellow-400' : 'text-gray-600 opacity-0 group-hover:opacity-100')}
                  aria-label="Favorite">
                    <Star className="w-3 h-3" fill={item.favorite ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {item.tags.slice(0, 4).map(tag => (
                    <span key={tag} className="px-1 py-0.5 bg-white/5 rounded text-[7px] text-gray-500">{tag}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredItems.map(item => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer group"
                draggable
                onDragStart={() => onDragToTrack(item.type, item.data)}
              >
                {typeIcon(item.type)}
                <span className="text-xs flex-1 truncate">{item.title}</span>
                <div className="flex gap-0.5">
                  {item.tags.slice(0, 2).map(tag => (
                    <span key={tag} className="px-1 py-0.5 bg-white/5 rounded text-[7px] text-gray-500">{tag}</span>
                  ))}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); toggleFavorite(item.id); }}
                  className={cn('p-0.5', item.favorite ? 'text-yellow-400' : 'text-gray-600 opacity-0 group-hover:opacity-100')}
                aria-label="Favorite">
                  <Star className="w-3 h-3" fill={item.favorite ? 'currentColor' : 'none'} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleLoadItem(item.type, item.data); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-neon-cyan"
                aria-label="Play">
                  <Play className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {filteredItems.length === 0 && tab !== 'suggestions' && (
          <div className="text-center py-12">
            <Layers className="w-10 h-10 mx-auto text-gray-600 mb-2" />
            <p className="text-sm text-gray-500">No items found</p>
            <p className="text-xs text-gray-600 mt-1">
              {search ? 'Try a different search term' : 'Create sounds to populate your soundboard'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
