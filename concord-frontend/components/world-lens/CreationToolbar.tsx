'use client';

import React from 'react';
import {
  Cog, Code2, Sparkles, Eye, EyeOff,
  RotateCw, ZoomIn, ZoomOut, Cloud, Shield,
} from 'lucide-react';
import type { CreationMode } from '@/lib/world-lens/types';

interface CreationToolbarProps {
  activeMode: CreationMode | null;
  onModeChange: (mode: CreationMode | null) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  rotation: 0 | 1 | 2 | 3;
  onRotate: () => void;
  visibleLayers: Set<string>;
  onToggleLayer: (layer: string) => void;
  showValidationOverlay: boolean;
  onToggleValidation: () => void;
  showWeatherOverlay: boolean;
  onToggleWeather: () => void;
}

const LAYER_DEFS = [
  { key: 'water', label: 'Water Mains', color: '#3B82F6' },
  { key: 'power', label: 'Power Grid', color: '#EAB308' },
  { key: 'drainage', label: 'Drainage', color: '#22C55E' },
  { key: 'road', label: 'Roads', color: '#9CA3AF' },
  { key: 'data', label: 'Data Network', color: '#A855F7' },
];

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

export default function CreationToolbar({
  activeMode,
  onModeChange,
  zoom,
  onZoomChange,
  rotation,
  onRotate,
  visibleLayers,
  onToggleLayer,
  showValidationOverlay,
  onToggleValidation,
  showWeatherOverlay,
  onToggleWeather,
}: CreationToolbarProps) {
  return (
    <div className={`w-56 flex-shrink-0 ${panel} p-3 space-y-4 overflow-y-auto`}>
      {/* Creation Modes */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Creation Mode
        </h3>
        <div className="space-y-1">
          <button
            onClick={() => onModeChange(activeMode === 'guided' ? null : 'guided')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              activeMode === 'guided'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                : 'text-gray-300 hover:bg-white/5 border border-transparent'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Guided Creator
          </button>
          <button
            onClick={() => onModeChange(activeMode === 'component' ? null : 'component')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              activeMode === 'component'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50'
                : 'text-gray-300 hover:bg-white/5 border border-transparent'
            }`}
          >
            <Cog className="w-4 h-4" />
            Component Creator
          </button>
          <button
            onClick={() => onModeChange(activeMode === 'raw' ? null : 'raw')}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              activeMode === 'raw'
                ? 'bg-orange-500/20 text-orange-300 border border-orange-500/50'
                : 'text-gray-300 hover:bg-white/5 border border-transparent'
            }`}
          >
            <Code2 className="w-4 h-4" />
            Raw DTU Editor
          </button>
        </div>
      </div>

      {/* View Controls */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          View
        </h3>
        <div className="flex items-center gap-1 mb-2">
          <button
            onClick={() => onZoomChange(Math.max(0.3, zoom - 0.15))}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <div className="flex-1 text-center text-xs text-gray-400 tabular-nums">
            {Math.round(zoom * 100)}%
          </div>
          <button
            onClick={() => onZoomChange(Math.min(3, zoom + 0.15))}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={onRotate}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title={`Rotate (${rotation * 90}°)`}
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Overlays */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Overlays
        </h3>
        <div className="space-y-1">
          <button
            onClick={onToggleValidation}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
              showValidationOverlay ? 'bg-green-500/20 text-green-300' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Validation Status
          </button>
          <button
            onClick={onToggleWeather}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
              showWeatherOverlay ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            Weather
          </button>
        </div>
      </div>

      {/* Infrastructure Layers */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Infrastructure Layers
        </h3>
        <div className="space-y-1">
          {LAYER_DEFS.map(layer => (
            <button
              key={layer.key}
              onClick={() => onToggleLayer(layer.key)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                visibleLayers.has(layer.key) ? 'text-white' : 'text-gray-400'
              } hover:bg-white/5`}
            >
              {visibleLayers.has(layer.key) ? (
                <Eye className="w-3.5 h-3.5" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" />
              )}
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: visibleLayers.has(layer.key) ? layer.color : '#444' }}
              />
              {layer.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
