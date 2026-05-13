'use client';

/**
 * ForgeCard — Inline artifact preview card rendered in the chat rail.
 *
 * When the forge pipeline detects a create-worthy request, the response
 * includes a forge envelope. This card renders:
 *   - Title and format badge
 *   - Content preview (document text, code snippet, waveform placeholder, etc.)
 *   - Source lens attribution ("Legal + Real Estate")
 *   - CRETI confidence score
 *   - Substrate citation count
 *   - Save / Delete / Save & List actions
 *   - Iteration prompt
 */

import { useState, useCallback } from 'react';
import {
  FileText,
  Music,
  Image as ImageIcon,
  Code2,
  BarChart3,
  BookOpen,
  Video,
  Trash2,
  Save,
  ShoppingCart,
  Pencil,
  ChevronDown,
  ChevronUp,
  Layers,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────

interface ForgePresentation {
  title: string;
  format: string;
  primaryType: number;
  preview: string;
  sourceLenses: string[];
  cretiScore: number;
  substrateCitationCount: number;
  formatAmbiguous: boolean;
  alternatives?: string[];
}

interface ForgeActions {
  save: { available: boolean; description: string };
  delete: { available: boolean; description: string };
  saveAndList: { available: boolean; description: string };
  iterate: { available: boolean; description: string };
}

interface ForgeDTU {
  id: string;
  title: string;
  artifact?: { content?: string };
  tags?: string[];
}

interface ForgeCardProps {
  dtu: ForgeDTU;
  presentation: ForgePresentation;
  actions: ForgeActions;
  isMultiArtifact?: boolean;
  offerForge?: boolean;
  onSave?: (dtu: ForgeDTU) => void;
  onDelete?: (dtuId: string) => void;
  onList?: (dtu: ForgeDTU) => void;
  onIterate?: (dtu: ForgeDTU, instruction: string) => void;
}

// ── Format Icon Map ──────────────────────────────────────────────

const FORMAT_ICONS: Record<string, typeof FileText> = {
  Document: FileText,
  Audio: Music,
  Image: ImageIcon,
  Code: Code2,
  Dataset: BarChart3,
  Research: BookOpen,
  Video: Video,
};

const FORMAT_COLORS: Record<string, string> = {
  Document: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Audio: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Image: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  Code: 'bg-green-500/10 text-green-400 border-green-500/20',
  Dataset: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  Research: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  Video: 'bg-red-500/10 text-red-400 border-red-500/20',
};

// ── Component ────────────────────────────────────────────────────

export default function ForgeCard({
  dtu,
  presentation,
  actions,
  isMultiArtifact,
  offerForge,
  onSave,
  onDelete,
  onList,
  onIterate,
}: ForgeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [iterating, setIterating] = useState(false);
  const [iterationInput, setIterationInput] = useState('');
  const [actionTaken, setActionTaken] = useState<string | null>(null);

  const Icon = FORMAT_ICONS[presentation.format] || FileText;
  const colorClass = FORMAT_COLORS[presentation.format] || FORMAT_COLORS.Document;

  const handleSave = useCallback(() => {
    onSave?.(dtu);
    setActionTaken('saved');
  }, [dtu, onSave]);

  const handleDelete = useCallback(() => {
    onDelete?.(dtu.id);
    setActionTaken('deleted');
  }, [dtu, onDelete]);

  const handleList = useCallback(() => {
    onList?.(dtu);
    setActionTaken('listed');
  }, [dtu, onList]);

  const handleIterate = useCallback(() => {
    if (iterationInput.trim()) {
      onIterate?.(dtu, iterationInput.trim());
      setIterationInput('');
      setIterating(false);
    }
  }, [dtu, iterationInput, onIterate]);

  if (actionTaken === 'deleted') {
    return null;
  }

  return (
    <div className={cn(
      'rounded-lg border bg-zinc-900/60 backdrop-blur-sm overflow-hidden',
      'transition-all duration-200',
      actionTaken === 'saved' && 'border-green-500/30',
      actionTaken === 'listed' && 'border-amber-500/30',
      !actionTaken && 'border-zinc-700/50',
    )}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50">
        <div className={cn('p-2 rounded-md border', colorClass)}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-zinc-100 truncate">
            {presentation.title}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={cn('text-xs px-1.5 py-0.5 rounded border', colorClass)}>
              {presentation.format}
            </span>
            {isMultiArtifact && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Layers className="w-3 h-3 inline mr-0.5" />
                Multi-artifact
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-500"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Preview */}
      <div className={cn(
        'px-4 py-3 text-xs font-mono text-zinc-400 bg-zinc-950/30',
        !expanded && 'max-h-24 overflow-hidden',
      )}>
        <pre className="whitespace-pre-wrap break-words leading-relaxed">
          {presentation.preview}
        </pre>
      </div>

      {/* Attribution */}
      <div className="px-4 py-2 flex items-center gap-4 text-xs text-zinc-500 border-t border-zinc-800/30">
        {presentation.sourceLenses.length > 0 && (
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            {presentation.sourceLenses.join(' + ')}
          </span>
        )}
        <span>CRETI: {presentation.cretiScore}/20</span>
        {presentation.substrateCitationCount > 0 && (
          <span>{presentation.substrateCitationCount} substrate citation{presentation.substrateCitationCount !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Format ambiguity warning */}
      {presentation.formatAmbiguous && presentation.alternatives && (
        <div className="px-4 py-2 text-xs text-amber-400 bg-amber-500/5 border-t border-amber-500/10">
          Format might also be: {presentation.alternatives.join(', ')}
        </div>
      )}

      {/* Actions */}
      {!actionTaken && (
        <div className="px-4 py-3 flex items-center gap-2 border-t border-zinc-800/50">
          {offerForge && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 transition-colors border border-purple-600/20"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Forge
            </button>
          )}
          {actions.save?.available && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors border border-green-600/20"
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
          )}
          {actions.saveAndList?.available && (
            <button
              onClick={handleList}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 transition-colors border border-amber-600/20"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              Save & List
            </button>
          )}
          {actions.iterate?.available && (
            <button
              onClick={() => setIterating(!iterating)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-700/30 text-zinc-300 hover:bg-zinc-700/50 transition-colors border border-zinc-700/30"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
          )}
          {actions.delete?.available && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-zinc-500 hover:text-red-400 hover:bg-red-600/10 transition-colors ml-auto"
            aria-label="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Saved/Listed confirmation */}
      {actionTaken === 'saved' && (
        <div className="px-4 py-2 text-xs text-green-400 bg-green-500/5 border-t border-green-500/10">
          Saved to your substrate. This DTU is now citable, forkable, and listable.
        </div>
      )}
      {actionTaken === 'listed' && (
        <div className="px-4 py-2 text-xs text-amber-400 bg-amber-500/5 border-t border-amber-500/10">
          Saved and listed on marketplace. You keep 96% of every sale.
        </div>
      )}

      {/* Iteration input */}
      {iterating && (
        <div className="px-4 py-3 border-t border-zinc-800/50">
          <div className="flex gap-2">
            <input
              type="text"
              value={iterationInput}
              onChange={(e) => setIterationInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleIterate()}
              placeholder="What should change?"
              className="flex-1 px-3 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              autoFocus
            />
            <button
              onClick={handleIterate}
              disabled={!iterationInput.trim()}
              className="px-3 py-1.5 text-xs rounded-md bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-600/20 disabled:opacity-30"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
