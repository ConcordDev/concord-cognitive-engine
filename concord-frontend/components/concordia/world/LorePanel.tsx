'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, BookOpen, RefreshCw, Loader2 } from 'lucide-react';

interface LoreEntry {
  id: string;
  text: string;
  generatedAt: string;
}

interface LorePanelProps {
  worldId?: string;
  onClose?: () => void;
}

export function LorePanel({ worldId = 'concordia-hub', onClose }: LorePanelProps) {
  const [lore, setLore] = useState<LoreEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLore = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/world/narrative/lore?worldId=${encodeURIComponent(worldId)}`);
      const data = res.ok ? await res.json() : null;
      if (data?.lore) setLore(data.lore);
      else setError('Could not load lore at this time.');
    } catch {
      setError('Oracle is unreachable.');
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  useEffect(() => { fetchLore(); }, [fetchLore]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/world/narrative/lore/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldId }),
      });
      await fetchLore();
    } catch {
      setError('Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  const paragraphs = lore?.text
    ? lore.text.split('\n\n').filter(p => p.trim().length > 0)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-2xl border border-indigo-500/30 bg-gray-950/95 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-indigo-500/20">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-semibold text-white">World Chronicle</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              title="Refresh lore"
              className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-300 hover:bg-indigo-900/30 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
              <p className="text-sm">The Oracle is consulting ancient records…</p>
            </div>
          ) : error ? (
            <div className="text-center py-16 text-red-400 text-sm">{error}</div>
          ) : paragraphs.length > 0 ? (
            <div className="space-y-4">
              {paragraphs.map((para, i) => (
                <p key={i} className="text-gray-300 leading-relaxed text-sm">{para}</p>
              ))}
              {lore?.generatedAt && (
                <p className="text-xs text-gray-600 pt-2 border-t border-gray-800">
                  Chronicle updated {new Date(lore.generatedAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-16 text-gray-500 text-sm">
              No chronicle entries yet. The Oracle watches in silence.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
