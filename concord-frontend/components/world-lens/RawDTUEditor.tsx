'use client';

import React, { useState, useCallback } from 'react';
import { Code2, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { MaterialDTU } from '@/lib/world-lens/types';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const DTU_TEMPLATE = `{
  "name": "Custom Component",
  "type": "beam",
  "material": {
    "id": "",
    "customProperties": null
  },
  "geometry": {
    "length": 6,
    "width": 0.3,
    "height": 0.5,
    "crossSection": "rectangular"
  },
  "physics": {
    "customTestParams": null,
    "customValidationRules": null
  },
  "metadata": {
    "tags": [],
    "description": ""
  }
}`;

interface RawDTUEditorProps {
  materials: MaterialDTU[];
  onPublish: (dtu: Record<string, unknown>) => void;
  onCancel: () => void;
}

export default function RawDTUEditor({ materials, onPublish, onCancel }: RawDTUEditorProps) {
  const [json, setJson] = useState(DTU_TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const [valid, setValid] = useState(false);

  const validate = useCallback((text: string) => {
    try {
      const parsed = JSON.parse(text);
      if (!parsed.name) throw new Error('Missing "name" field');
      if (!parsed.type) throw new Error('Missing "type" field');
      if (!parsed.geometry) throw new Error('Missing "geometry" field');
      setError(null);
      setValid(true);
      return parsed;
    } catch (e) {
      setError((e as Error).message);
      setValid(false);
      return null;
    }
  }, []);

  const handleChange = useCallback((text: string) => {
    setJson(text);
    validate(text);
  }, [validate]);

  const handlePublish = useCallback(() => {
    const parsed = validate(json);
    if (parsed) onPublish(parsed);
  }, [json, validate, onPublish]);

  return (
    <div className={`${panel} p-4 space-y-3 max-h-[80vh] overflow-y-auto`}>
      <div className="flex items-center gap-2">
        <Code2 className="w-5 h-5 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">Raw DTU Editor</h3>
      </div>

      <p className="text-[10px] text-gray-400">
        Full parametric access. Edit the JSON schema directly. Every field has inline documentation.
      </p>

      {/* Available Materials Reference */}
      <details className="text-[10px]">
        <summary className="text-gray-400 cursor-pointer hover:text-white">
          Available Material IDs ({materials.length})
        </summary>
        <div className="mt-1 max-h-24 overflow-y-auto space-y-0.5 pl-2">
          {materials.map(m => (
            <div key={m.id} className="text-gray-400">
              <code className="text-orange-300">{m.id}</code> — {m.name}
            </div>
          ))}
        </div>
      </details>

      {/* Editor */}
      <div className="relative">
        <textarea
          value={json}
          onChange={e => handleChange(e.target.value)}
          rows={20}
          spellCheck={false}
          className="w-full bg-black/60 border border-white/10 rounded-lg p-3 text-[11px] font-mono text-green-300 resize-none focus:outline-none focus:border-orange-500/50"
        />

        {/* Status indicator */}
        <div className="absolute top-2 right-2">
          {valid ? (
            <CheckCircle2 className="w-4 h-4 text-green-400" />
          ) : error ? (
            <AlertTriangle className="w-4 h-4 text-red-400" />
          ) : null}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-[10px] text-red-400">
          {error}
        </div>
      )}

      {/* Schema docs */}
      <details className="text-[10px]">
        <summary className="text-gray-400 cursor-pointer hover:text-white">
          Schema Documentation
        </summary>
        <div className="mt-1 space-y-1 pl-2 text-gray-400">
          <p><code className="text-orange-300">name</code> — Display name for the component (required)</p>
          <p><code className="text-orange-300">type</code> — beam, column, wall, floor, roof, foundation, brace (required)</p>
          <p><code className="text-orange-300">material.id</code> — Reference to material DTU ID</p>
          <p><code className="text-orange-300">material.customProperties</code> — Override material properties (for new materials)</p>
          <p><code className="text-orange-300">geometry.length/width/height</code> — Dimensions in meters</p>
          <p><code className="text-orange-300">geometry.crossSection</code> — rectangular, circular, I-beam, H-beam, tube, custom</p>
          <p><code className="text-orange-300">physics.customTestParams</code> — Custom validation parameters</p>
          <p><code className="text-orange-300">physics.customValidationRules</code> — Custom rules (for novel joint types)</p>
        </div>
      </details>

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
          disabled={!valid}
          className="flex-1 py-2 bg-orange-500/20 text-orange-300 rounded text-xs hover:bg-orange-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
        >
          <Upload className="w-3.5 h-3.5" />
          Publish DTU
        </button>
      </div>
    </div>
  );
}
