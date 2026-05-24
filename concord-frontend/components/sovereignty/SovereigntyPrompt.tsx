'use client';

/**
 * SovereigntyPrompt — Inline sovereignty consent prompt for the chat rail.
 * Appears when local substrate is insufficient and global has relevant knowledge.
 * User chooses: use temporarily, sync permanently, or skip.
 */

import { useState } from 'react';
import { Shield } from 'lucide-react';

interface GlobalPreview {
  id: string;
  title: string;
  domain: string;
  score: number;
}

interface SovereigntyMessage {
  message: string;
  localCount: number;
  globalCount: number;
  globalDomains: string[];
  globalDTUIds: string[];
  globalPreview?: GlobalPreview[];
}

interface SovereigntyPromptProps {
  message: SovereigntyMessage;
  onResolve: (choice: 'sync_temp' | 'sync_permanent' | 'skip', remember: boolean) => void;
  isResolving?: boolean;
}

export function SovereigntyPrompt({ message, onResolve, isResolving }: SovereigntyPromptProps) {
  const [remember, setRemember] = useState(false);

  return (
    <div className="mx-4 my-3 p-4 rounded-lg border border-amber-500/30 bg-amber-900/10">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-medium text-amber-300">Sovereignty Check</span>
      </div>

      <p className="text-sm text-zinc-300 mb-3">{message.message}</p>

      {/* Preview of what global has */}
      {message.globalPreview && message.globalPreview.length > 0 && (
        <div className="mb-3 space-y-1">
          <p className="text-xs text-zinc-400">Available from global commons:</p>
          {message.globalPreview.map((g, i) => (
            <div key={i} className="text-xs text-zinc-400 flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                {g.domain}
              </span>
              {g.title}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          onClick={() => onResolve('sync_temp', remember)}
          disabled={isResolving}
          className="text-left px-3 py-2 rounded-lg text-sm
            bg-zinc-800 border border-zinc-700 text-zinc-200
            hover:border-amber-500/30 transition-colors
            disabled:opacity-50"
        >
          Use temporarily &mdash; borrow for this response, then forget
        </button>
        <button
          onClick={() => onResolve('sync_permanent', remember)}
          disabled={isResolving}
          className="text-left px-3 py-2 rounded-lg text-sm
            bg-zinc-800 border border-zinc-700 text-zinc-200
            hover:border-neon-cyan/30 transition-colors
            disabled:opacity-50"
        >
          Sync permanently &mdash; add to my substrate
        </button>
        <button
          onClick={() => onResolve('skip', remember)}
          disabled={isResolving}
          className="text-left px-3 py-2 rounded-lg text-sm
            bg-zinc-800 border border-zinc-700 text-zinc-400
            hover:border-zinc-600 transition-colors
            disabled:opacity-50"
        >
          Skip &mdash; answer with my knowledge only
        </button>
      </div>

      <label className="flex items-center gap-2 mt-3 text-xs text-zinc-400 cursor-pointer">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="rounded border-zinc-600"
        />
        Remember my choice for future conversations
      </label>
    </div>
  );
}
