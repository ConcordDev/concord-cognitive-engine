'use client';

import { useCallback, useEffect, useState } from 'react';
import { Network, Loader2, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Channel {
  id: string; channel: string; storeName: string; listedSkus: string[];
  status: string; lastSyncedAt: string | null; lastSyncCount?: number;
}
interface AdminProduct { sku: string; name: string }

/**
 * ChannelsPanel — multi-channel listing. Connects external marketplaces
 * (Amazon, eBay, Etsy, Walmart, TikTok Shop), lists specific SKUs onto
 * each, and syncs current stock levels across all connected channels.
 */
export function ChannelsPanel() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ channel: '', storeName: '' });
  const [skuPick, setSkuPick] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, pRes] = await Promise.all([
        lensRun('retail', 'channels-list', {}),
        lensRun('retail', 'product-list', {}),
      ]);
      setChannels((cRes.data?.result?.channels || []) as Channel[]);
      setAvailable((cRes.data?.result?.available || []) as string[]);
      setProducts((pRes.data?.result?.products || []) as AdminProduct[]);
    } catch (e) { console.error('[Channels] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    if (!form.channel) return;
    setBusy(true); setNotice(null);
    try {
      const r = await lensRun('retail', 'channels-connect', { channel: form.channel, storeName: form.storeName });
      if (r.data?.ok === false) setNotice(r.data.error || 'Connect failed');
      else { setForm({ channel: '', storeName: '' }); await refresh(); }
    } catch (e) { console.error('[Channels] connect failed', e); }
    finally { setBusy(false); }
  }

  async function listProduct(channelId: string) {
    const sku = skuPick[channelId];
    if (!sku) return;
    setBusy(true);
    try {
      const r = await lensRun('retail', 'channels-list-products', { id: channelId, skus: [sku] });
      if (r.data?.ok === false) setNotice(r.data.error || 'List failed');
      else { setSkuPick({ ...skuPick, [channelId]: '' }); await refresh(); }
    } catch (e) { console.error('[Channels] list-products failed', e); }
    finally { setBusy(false); }
  }

  async function syncInventory(id?: string) {
    setBusy(true); setNotice(null);
    try {
      const r = await lensRun('retail', 'channels-sync-inventory', id ? { id } : {});
      if (r.data?.ok === false) setNotice(r.data.error || 'Sync failed');
      else {
        const synced = (r.data?.result?.channels || []) as Array<{ syncedSkus: number }>;
        setNotice(`Synced ${synced.reduce((s, c) => s + c.syncedSkus, 0)} listings`);
        await refresh();
      }
    } catch (e) { console.error('[Channels] sync failed', e); }
    finally { setBusy(false); }
  }

  async function disconnect(id: string) {
    setBusy(true);
    try {
      await lensRun('retail', 'channels-disconnect', { id });
      await refresh();
    } catch (e) { console.error('[Channels] disconnect failed', e); }
    finally { setBusy(false); }
  }

  const connectedSet = new Set(channels.map(c => c.channel));

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Network className="w-4 h-4 text-orange-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Sales channels</span>
        {channels.length > 0 && (
          <button onClick={() => syncInventory()} disabled={busy} className="ml-auto px-2 py-0.5 text-[10px] rounded bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 inline-flex items-center gap-1 disabled:opacity-40">
            <RefreshCw className="w-3 h-3" /> Sync all
          </button>
        )}
      </header>

      {/* Connect */}
      <div className="p-3 border-b border-white/10 grid grid-cols-3 gap-2">
        <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Pick a marketplace…</option>
          {available.filter(a => !connectedSet.has(a)).map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
        <input value={form.storeName} onChange={e => setForm({ ...form, storeName: e.target.value })} placeholder="Store name on channel" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={connect} disabled={busy || !form.channel} className="px-3 py-1.5 text-xs rounded bg-orange-500 text-white font-bold hover:bg-orange-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          <Plug className="w-3 h-3" /> Connect
        </button>
      </div>
      {notice && <div className="px-3 py-2 text-[11px] text-amber-300 border-b border-white/10">{notice}</div>}

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : channels.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Network className="w-6 h-6 mx-auto mb-2 opacity-30" />No channels connected.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {channels.map(c => (
              <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium capitalize">{c.channel.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-gray-400 flex-1 truncate">{c.storeName || '—'}</span>
                  <span className="text-[10px] text-gray-400">{c.listedSkus.length} listed</span>
                  <span className={cn('px-1.5 py-0.5 text-[9px] uppercase rounded', 'bg-emerald-500/15 text-emerald-300')}>{c.status}</span>
                  <button onClick={() => disconnect(c.id)} disabled={busy} aria-label="Disconnect channel" className="p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
                {c.lastSyncedAt && <p className="text-[10px] text-gray-400 mt-0.5">Last sync {new Date(c.lastSyncedAt).toLocaleString()}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {c.listedSkus.map(sku => (
                    <span key={sku} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-cyan-500/15 text-cyan-300">{sku}</span>
                  ))}
                  <select value={skuPick[c.id] || ''} onChange={e => setSkuPick({ ...skuPick, [c.id]: e.target.value })} className="px-1 py-0.5 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white">
                    <option value="">+ list SKU…</option>
                    {products.filter(p => !c.listedSkus.includes(p.sku)).map(p => <option key={p.sku} value={p.sku}>{p.sku} — {p.name}</option>)}
                  </select>
                  <button onClick={() => listProduct(c.id)} disabled={busy || !skuPick[c.id]} className="px-1.5 py-0.5 text-[10px] rounded bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 disabled:opacity-30">Add</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ChannelsPanel;
