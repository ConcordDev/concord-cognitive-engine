'use client';

/**
 * SportsPredictionsPanel — Pick'em: predict game winners and track
 * prediction accuracy.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Target } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Game { id: string; homeTeam: string; awayTeam: string; status: string }
interface Prediction { id: string; gameId: string; predictedWinner: string; matchup: string; outcome: string }
interface PredictionRecord { correct: number; incorrect: number; pending: number; accuracy: number | null }

const OUTCOME_COLOR: Record<string, string> = {
  correct: 'text-emerald-400', incorrect: 'text-rose-400', pending: 'text-amber-400',
};

export function SportsPredictionsPanel({ onChange }: { onChange: () => void }) {
  const [games, setGames] = useState<Game[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [record, setRecord] = useState<PredictionRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [g, p, r] = await Promise.all([
      lensRun('sports', 'game-list', {}),
      lensRun('sports', 'prediction-list', {}),
      lensRun('sports', 'prediction-record', {}),
    ]);
    setGames(g.data?.result?.games || []);
    setPredictions(p.data?.result?.predictions || []);
    setRecord((r.data?.result as PredictionRecord | null) || null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const predict = async (gameId: string, winner: string) => {
    await lensRun('sports', 'prediction-make', { gameId, predictedWinner: winner });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const predByGame = new Map(predictions.map((p) => [p.gameId, p]));
  const openGames = games.filter((g) => g.status !== 'final');

  return (
    <div className="space-y-4">
      {record && (record.correct + record.incorrect + record.pending) > 0 && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
            <p className="text-lg font-bold text-emerald-400">{record.correct}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Correct</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
            <p className="text-lg font-bold text-rose-400">{record.incorrect}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Missed</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
            <p className="text-lg font-bold text-amber-400">{record.pending}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Pending</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
            <p className="text-lg font-bold text-zinc-100">{record.accuracy != null ? `${record.accuracy}%` : '—'}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Accuracy</p>
          </div>
        </div>
      )}

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Target className="w-3.5 h-3.5 text-red-400" /> Make your picks
        </h3>
        {openGames.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No upcoming games to predict. Add games in the Scores tab.</p>
        ) : (
          <ul className="space-y-2">
            {openGames.map((g) => {
              const pred = predByGame.get(g.id);
              return (
                <li key={g.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                  <p className="text-[11px] text-zinc-400 mb-1.5">{g.awayTeam} @ {g.homeTeam}</p>
                  <div className="flex gap-1.5">
                    {[g.awayTeam, g.homeTeam].map((team) => (
                      <button key={team} type="button" onClick={() => predict(g.id, team)}
                        className={cn('flex-1 text-xs px-2 py-1.5 rounded-lg border',
                          pred?.predictedWinner === team
                            ? 'border-red-700/50 bg-red-950/40 text-red-300 font-semibold'
                            : 'border-zinc-700 text-zinc-400 hover:text-zinc-200')}>
                        {team}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {predictions.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Your predictions</h3>
          <ul className="space-y-1">
            {predictions.map((p) => (
              <li key={p.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{p.matchup}</p>
                  <p className="text-[10px] text-zinc-400">Pick: {p.predictedWinner}</p>
                </div>
                <span className={cn('text-[10px] uppercase', OUTCOME_COLOR[p.outcome])}>{p.outcome}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
