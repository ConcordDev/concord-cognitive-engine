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
  Document: 'bg-[var(--nb-blue-soft,rgba(59,130,246,0.1))] text-[color:var(--nb-blue,#60a5fa)] border-[color:var(--nb-blue,rgba(59,130,246,0.2))]',
  Audio: 'bg-[var(--nb-red-soft,rgba(168,85,247,0.1))] text-[color:var(--nb-red,#c084fc)] border-[color:var(--nb-red,rgba(168,85,247,0.2))]',
  Image: 'bg-[var(--nb-red-soft,rgba(236,72,153,0.1))] text-[color:var(--nb-red,#f472b6)] border-[color:var(--nb-red,rgba(236,72,153,0.2))]',
  Code: 'bg-[var(--nb-green-soft,rgba(34,197,94,0.1))] text-[color:var(--nb-green,#4ade80)] border-[color:var(--nb-green,rgba(34,197,94,0.2))]',
  Dataset: 'bg-[var(--nb-hl,rgba(249,115,22,0.1))] text-[color:var(--nb-ochre,#fb923c)] border-[color:var(--nb-ochre,rgba(249,115,22,0.2))]',
  Research: 'bg-[var(--nb-blue-soft,rgba(6,182,212,0.1))] text-[color:var(--nb-blue,#22d3ee)] border-[color:var(--nb-blue,rgba(6,182,212,0.2))]',
  Video: 'bg-[var(--nb-red-soft,rgba(239,68,68,0.1))] text-[color:var(--nb-red,#f87171)] border-[color:var(--nb-red,rgba(239,68,68,0.2))]',
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
      'rounded-lg border bg-[var(--nb-sheet,rgba(24,24,27,0.6))] backdrop-blur-sm overflow-hidden',
      'transition-all duration-200',
      actionTaken === 'saved' && 'border-[color:var(--nb-green,rgba(34,197,94,0.3))]',
      actionTaken === 'listed' && 'border-[color:var(--nb-ochre,rgba(245,158,11,0.3))]',
      !actionTaken && 'border-[color:var(--nb-rule,rgba(63,63,70,0.5))]',
    )}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[color:var(--nb-rule,rgba(39,39,42,0.5))]">
        <div className={cn('p-2 rounded-md border', colorClass)}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-[color:var(--nb-ink,#f4f4f5)] truncate">
            {presentation.title}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={cn('text-xs px-1.5 py-0.5 rounded border', colorClass)}>
              {presentation.format}
            </span>
            {isMultiArtifact && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--nb-hl,rgba(245,158,11,0.1))] text-[color:var(--nb-ochre,#fbbf24)] border border-[color:var(--nb-ochre,rgba(245,158,11,0.2))]">
                <Layers className="w-3 h-3 inline mr-0.5" />
                Multi-artifact
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded hover:bg-[var(--nb-wash,#27272a)] text-[color:var(--nb-muted,#a1a1aa)]"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Preview */}
      <div className={cn(
        'px-4 py-3 text-xs font-mono text-[color:var(--nb-muted,#a1a1aa)] bg-[var(--nb-paper,rgba(9,9,11,0.3))]',
        !expanded && 'max-h-24 overflow-hidden',
      )}>
        <pre className="whitespace-pre-wrap break-words leading-relaxed">
          {presentation.preview}
        </pre>
      </div>

      {/* Attribution */}
      <div className="px-4 py-2 flex items-center gap-4 text-xs text-[color:var(--nb-muted,#a1a1aa)] border-t border-[color:var(--nb-rule,rgba(39,39,42,0.3))]">
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
        <div className="px-4 py-2 text-xs text-[color:var(--nb-ochre,#fbbf24)] bg-[var(--nb-hl,rgba(245,158,11,0.05))] border-t border-[color:var(--nb-ochre,rgba(245,158,11,0.1))]">
          Format might also be: {presentation.alternatives.join(', ')}
        </div>
      )}

      {/* Actions */}
      {!actionTaken && (
        <div className="px-4 py-3 flex items-center gap-2 border-t border-[color:var(--nb-rule,rgba(39,39,42,0.5))]">
          {offerForge && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--nb-red-soft,rgba(147,51,234,0.2))] text-[color:var(--nb-red,#c084fc)] hover:bg-[var(--nb-red-soft,rgba(147,51,234,0.3))] transition-colors border border-[color:var(--nb-red,rgba(147,51,234,0.2))]"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Forge
            </button>
          )}
          {actions.save?.available && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--nb-green-soft,rgba(22,163,74,0.2))] text-[color:var(--nb-green,#4ade80)] hover:bg-[var(--nb-green-soft,rgba(22,163,74,0.3))] transition-colors border border-[color:var(--nb-green,rgba(22,163,74,0.2))]"
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
          )}
          {actions.saveAndList?.available && (
            <button
              onClick={handleList}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--nb-hl,rgba(217,119,6,0.2))] text-[color:var(--nb-ochre,#fbbf24)] hover:bg-[var(--nb-hl,rgba(217,119,6,0.3))] transition-colors border border-[color:var(--nb-ochre,rgba(217,119,6,0.2))]"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              Save & List
            </button>
          )}
          {actions.iterate?.available && (
            <button
              onClick={() => setIterating(!iterating)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--nb-wash-2,rgba(63,63,70,0.3))] text-[color:var(--nb-ink-2,#d4d4d8)] hover:bg-[var(--nb-wash-2,rgba(63,63,70,0.5))] transition-colors border border-[color:var(--nb-rule,rgba(63,63,70,0.3))]"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
          )}
          {actions.delete?.available && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[color:var(--nb-muted,#a1a1aa)] hover:text-[color:var(--nb-red,#f87171)] hover:bg-[var(--nb-red-soft,rgba(220,38,38,0.1))] transition-colors ml-auto"
            aria-label="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Saved/Listed confirmation */}
      {actionTaken === 'saved' && (
        <div className="px-4 py-2 text-xs text-[color:var(--nb-green,#4ade80)] bg-[var(--nb-green-soft,rgba(34,197,94,0.05))] border-t border-[color:var(--nb-green,rgba(34,197,94,0.1))]">
          Saved to your substrate. This DTU is now citable, forkable, and listable.
        </div>
      )}
      {actionTaken === 'listed' && (
        <div className="px-4 py-2 text-xs text-[color:var(--nb-ochre,#fbbf24)] bg-[var(--nb-hl,rgba(245,158,11,0.05))] border-t border-[color:var(--nb-ochre,rgba(245,158,11,0.1))]">
          Saved and listed on marketplace. You keep 96% of every sale.
        </div>
      )}

      {/* Iteration input */}
      {iterating && (
        <div className="px-4 py-3 border-t border-[color:var(--nb-rule,rgba(39,39,42,0.5))]">
          <div className="flex gap-2">
            <input
              type="text"
              value={iterationInput}
              onChange={(e) => setIterationInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleIterate()}
              placeholder="What should change?"
              className="flex-1 px-3 py-1.5 text-xs rounded-md bg-[var(--nb-wash,#27272a)] border border-[color:var(--nb-rule,#3f3f46)] text-[color:var(--nb-ink,#e4e4e7)] placeholder:text-[color:var(--nb-muted,#a1a1aa)] focus:outline-none focus:border-[color:var(--nb-rule-2,#71717a)]"
              autoFocus
            />
            <button
              onClick={handleIterate}
              disabled={!iterationInput.trim()}
              className="px-3 py-1.5 text-xs rounded-md bg-[var(--nb-blue-soft,rgba(37,99,235,0.2))] text-[color:var(--nb-blue,#60a5fa)] hover:bg-[var(--nb-blue-soft,rgba(37,99,235,0.3))] border border-[color:var(--nb-blue,rgba(37,99,235,0.2))] disabled:opacity-30"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
