'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface PriceAlert {
  id: string;
  tokenId: string;
  symbol: string;
  direction: 'above' | 'below';
  threshold: number;
  active: boolean;
  createdAt: string;
  triggeredAt?: string | null;
}

interface PriceAlertsProps {
  tokenOptions: Array<{ id: string; symbol: string; priceUsd?: number }>;
}

export function PriceAlerts({ tokenOptions }: PriceAlertsProps) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tokenId, setTokenId] = useState<string>(tokenOptions[0]?.id || '');
  const [direction, setDirection] = useState<'above' | 'below'>('above');
  const [threshold, setThreshold] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!tokenId && tokenOptions[0]) setTokenId(tokenOptions[0].id);
  }, [tokenOptions, tokenId]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'crypto', action: 'price-alerts-list', input: {} });
      setAlerts((res.data?.result?.alerts || []) as PriceAlert[]);
    } catch (e) {
      console.error('[Alerts] list failed', e);
    } finally { setLoading(false); }
  }

  async function create() {
    if (!tokenId || !threshold) return;
    const token = tokenOptions.find(t => t.id === tokenId);
    if (!token) return;
    setSubmitting(true);
    try {
      await api.post('/api/lens/run', {
        domain: 'crypto',
        action: 'price-alerts-create',
        input: { tokenId, symbol: token.symbol, direction, threshold: Number(threshold) },
      });
      setThreshold(''); setCreating(false);
      await refresh();
    } catch (e) {
      console.error('[Alerts] create failed', e);
    } finally { setSubmitting(false); }
  }

  async function remove(id: string) {
    try {
      await api.post('/api/lens/run', { domain: 'crypto', action: 'price-alerts-delete', input: { id } });
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (e) {
      console.error('[Alerts] delete failed', e);
    }
  }

  return (
    <div className="flex flex-col bg-[#0d1117] border border-lattice-border rounded overflow-hidden">
      <header className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <Bell className="w-4 h-4 text-yellow-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Price alerts</span>
        <span className="ml-auto text-[10px] text-gray-500">{alerts.length}</span>
        <button
          onClick={() => setCreating(v => !v)}
          title="New alert"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
        >
          <Plus className="w-4 h-4" />
        </button>
      </header>
      {creating && (
        <div className="p-3 border-b border-white/10 space-y-2">
          <select
            value={tokenId}
            onChange={e => setTokenId(e.target.value)}
            className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          >
            {tokenOptions.map(t => (
              <option key={t.id} value={t.id}>{t.symbol} {t.priceUsd ? `· $${t.priceUsd.toLocaleString()}` : ''}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <select
              value={direction}
              onChange={e => setDirection(e.target.value as 'above' | 'below')}
              className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            >
              <option value="above">above</option>
              <option value="below">below</option>
            </select>
            <input
              type="number"
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              placeholder="USD price"
              className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              step={0.0001}
              min={0}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={create}
              disabled={!tokenId || !threshold || submitting}
              className="px-3 py-1 text-xs rounded bg-yellow-500 text-black font-bold hover:bg-yellow-400 disabled:opacity-40"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add alert'}
            </button>
            <button
              onClick={() => setCreating(false)}
              className="px-3 py-1 text-xs rounded border border-white/10 text-gray-400 hover:text-white"
            >Cancel</button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : alerts.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-500">
            <BellOff className="w-6 h-6 mx-auto mb-2 opacity-30" />
            No alerts set. Hit + to add one.
          </div>
        ) : (
          <ul className="text-xs">
            {alerts.map(a => (
              <li key={a.id} className={cn('px-3 py-2 border-b border-white/5 flex items-center gap-2 hover:bg-white/[0.03]', a.triggeredAt && 'bg-yellow-500/[0.05]')}>
                <span className="font-mono text-white">{a.symbol}</span>
                <span className="text-gray-500">{a.direction === 'above' ? '≥' : '≤'}</span>
                <span className="font-mono text-yellow-300 tabular-nums">${a.threshold.toLocaleString()}</span>
                <span className="ml-auto inline-flex items-center gap-2 text-[10px] text-gray-500">
                  {a.triggeredAt ? (
                    <span className="text-yellow-400 inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" /> triggered</span>
                  ) : a.active ? (
                    <span className="text-green-400">armed</span>
                  ) : (
                    <span>off</span>
                  )}
                  <button
                    onClick={() => remove(a.id)}
                    title="Delete"
                    className="text-gray-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PriceAlerts;
