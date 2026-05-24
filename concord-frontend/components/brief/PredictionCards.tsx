'use client';

/**
 * PredictionCards — Shows pre-generated artifacts from the predictive substrate.
 * "I anticipated X things you might need today."
 */

import { Sparkles } from 'lucide-react';
import { dismissPrediction } from '@/lib/api/client';

interface Prediction {
  dtuId: string;
  lens: string;
  action: string;
  title: string;
}

interface PredictionCardsProps {
  predictions: Prediction[];
  onView?: (dtuId: string) => void;
  onDismiss?: (dtuId: string) => void;
}

export function PredictionCards({ predictions, onView, onDismiss }: PredictionCardsProps) {
  const handleDismiss = async (dtuId: string) => {
    await dismissPrediction(dtuId);
    onDismiss?.(dtuId);
  };

  if (!predictions || predictions.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-cyan-400" />
        Ready for you
      </h3>
      {predictions.map(p => (
        <div
          key={p.dtuId}
          className="flex items-center justify-between p-3 rounded-lg
            bg-cyan-500/5 border border-cyan-500/20"
        >
          <div>
            <p className="text-sm text-zinc-200">{p.title}</p>
            <p className="text-xs text-zinc-400">
              {p.lens} &middot; {p.action.replace(/-/g, ' ')}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onView?.(p.dtuId)}
              className="px-3 py-1 text-xs rounded-lg
                bg-cyan-500/10 text-cyan-400 border border-cyan-500/30
                hover:bg-cyan-500/20 transition-colors"
            >
              View
            </button>
            <button
              onClick={() => handleDismiss(p.dtuId)}
              className="px-3 py-1 text-xs rounded-lg
                bg-zinc-800 text-zinc-400 border border-zinc-700
                hover:bg-zinc-700 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
