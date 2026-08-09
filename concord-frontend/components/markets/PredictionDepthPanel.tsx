'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import DepthChart, { type DepthLevel } from '@/components/markets/DepthChart';

/**
 * Self-contained (no props) prediction-market depth panel — picks an open
 * market via `markets.market-list`, renders its real resting-order depth via
 * `markets.order-book` + DepthChart. Cross-mountable anywhere (registered as
 * `markets.depth-chart` in lib/panel-registry.ts) and reused directly inside
 * MarketsWorkbench's Depth tab.
 */
export default function PredictionDepthPanel() {
  const [markets, setMarkets] = useState<Array<{ id: string; question: string }>>([]);
  const [marketId, setMarketId] = useState<string>('');
  const [book, setBook] = useState<{ currentYesProbability: number; yesBids: DepthLevel[]; noBids: DepthLevel[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.post('/api/lens/run', {
          domain: 'markets', action: 'market-list', input: { status: 'open', sort: 'volume', limit: 25 },
        });
        const rows = ((r.data as { result?: { markets?: Array<{ id: string; question: string }> } }).result?.markets) || [];
        setMarkets(rows);
        if (rows.length > 0) setMarketId(rows[0].id);
      } catch (e) { console.error(e); }
    })();
  }, []);

  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await api.post('/api/lens/run', { domain: 'markets', action: 'order-book', input: { marketId } });
        if (!cancelled) setBook((r.data as { result?: typeof book }).result || null);
      } catch (e) { console.error(e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [marketId]);

  if (markets.length === 0) {
    return <p className="text-[11px] text-gray-400 p-3">No open prediction markets yet.</p>;
  }

  return (
    <div className="space-y-2 p-3">
      <select
        value={marketId}
        onChange={(e) => setMarketId(e.target.value)}
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
      >
        {markets.map((m) => <option key={m.id} value={m.id}>{m.question}</option>)}
      </select>
      <DepthChart
        yesBids={book?.yesBids || []}
        noBids={book?.noBids || []}
        midProbability={book?.currentYesProbability ?? 0.5}
        loading={loading}
      />
    </div>
  );
}
