'use client';

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Boxes, Plus, Trash2, Loader2, ShieldCheck, ShieldAlert,
  ShieldX, FileText, Package,
} from 'lucide-react';

interface Asset {
  id: string;
  name: string;
  category: string;
  room: string;
  brand: string;
  model: string;
  serial: string;
  purchaseDate: string;
  purchasePrice: number;
  warrantyExpires: string;
  manualUrl: string;
  notes: string;
  warrantyStatus: 'none' | 'active' | 'expiring' | 'expired';
  daysToExpiry: number | null;
  createdAt: string;
}
interface InventoryResult {
  assets: Asset[];
  count: number;
  totalValue: number;
  warrantiesActive: number;
  warrantiesExpiring: number;
  warrantiesExpired: number;
}

const DOMAIN = 'home-improvement';
const ROOMS = ['kitchen', 'bathroom', 'bedroom', 'living_room', 'basement', 'garage', 'exterior', 'whole_house', 'other'];
const CATEGORIES = ['appliance', 'hvac', 'electronics', 'furniture', 'fixture', 'tool', 'system', 'other'];

const WARRANTY_STYLE: Record<string, { cls: string; icon: typeof ShieldCheck; label: string }> = {
  active: { cls: 'text-neon-green', icon: ShieldCheck, label: 'Active' },
  expiring: { cls: 'text-yellow-400', icon: ShieldAlert, label: 'Expiring' },
  expired: { cls: 'text-red-400', icon: ShieldX, label: 'Expired' },
  none: { cls: 'text-gray-400', icon: Package, label: 'No warranty' },
};

export function HomeInventory() {
  const [result, setResult] = useState<InventoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', category: 'appliance', room: 'kitchen', brand: '', model: '', serial: '',
    purchaseDate: '', purchasePrice: '', warrantyExpires: '', manualUrl: '', notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await lensRun<InventoryResult>(DOMAIN, 'inventory-list', {});
    if (data.ok && data.result) setResult(data.result);
    else setError(data.error || 'Failed to load inventory');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.name.trim()) return;
    setBusy(true); setError(null);
    const { data } = await lensRun(DOMAIN, 'inventory-add', {
      ...form, purchasePrice: Number(form.purchasePrice) || 0,
    });
    if (data.ok) {
      setForm({ name: '', category: 'appliance', room: 'kitchen', brand: '', model: '', serial: '', purchaseDate: '', purchasePrice: '', warrantyExpires: '', manualUrl: '', notes: '' });
      setShowForm(false);
      await load();
    } else setError(data.error || 'Failed to add asset');
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'inventory-delete', { id });
    if (data.ok) await load();
    setBusy(false);
  };

  const assets = result?.assets || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <Boxes className="w-4 h-4 text-neon-purple" /> Home Inventory
          <span className="text-xs text-gray-400">({result?.count || 0})</span>
        </h3>
        <button onClick={() => setShowForm((v) => !v)} className="text-xs flex items-center gap-1 text-neon-purple hover:text-purple-300">
          <Plus className="w-3.5 h-3.5" /> Add asset
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {result && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="lens-card text-center">
            <p className="text-lg font-bold text-neon-purple">${result.totalValue.toLocaleString()}</p>
            <p className="text-xs text-gray-400">Total value</p>
          </div>
          <div className="lens-card text-center">
            <p className="text-lg font-bold text-neon-green">{result.warrantiesActive}</p>
            <p className="text-xs text-gray-400">Warranties active</p>
          </div>
          <div className="lens-card text-center">
            <p className="text-lg font-bold text-yellow-400">{result.warrantiesExpiring}</p>
            <p className="text-xs text-gray-400">Expiring soon</p>
          </div>
          <div className="lens-card text-center">
            <p className="text-lg font-bold text-red-400">{result.warrantiesExpired}</p>
            <p className="text-xs text-gray-400">Expired</p>
          </div>
        </div>
      )}

      {showForm && (
        <div className="panel p-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Asset name" className="input-lattice" />
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="input-lattice">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={form.room} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} className="input-lattice">
              {ROOMS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
            <input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} placeholder="Brand" className="input-lattice" />
            <input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="Model" className="input-lattice" />
            <input value={form.serial} onChange={(e) => setForm((f) => ({ ...f, serial: e.target.value }))} placeholder="Serial #" className="input-lattice" />
            <label className="text-xs text-gray-400">Purchase date
              <input value={form.purchaseDate} onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))} type="date" className="input-lattice w-full" />
            </label>
            <input value={form.purchasePrice} onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))} type="number" placeholder="Purchase price $" className="input-lattice" />
            <label className="text-xs text-gray-400">Warranty expires
              <input value={form.warrantyExpires} onChange={(e) => setForm((f) => ({ ...f, warrantyExpires: e.target.value }))} type="date" className="input-lattice w-full" />
            </label>
          </div>
          <input value={form.manualUrl} onChange={(e) => setForm((f) => ({ ...f, manualUrl: e.target.value }))} placeholder="Manual URL (optional)" className="input-lattice w-full" />
          <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" className="input-lattice w-full" />
          <button onClick={add} disabled={busy || !form.name.trim()} className="btn-neon green w-full text-sm disabled:opacity-50">
            {busy ? 'Saving...' : 'Add Asset'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading inventory...</div>
      ) : assets.length === 0 ? (
        <p className="text-xs text-gray-400">No assets registered. Track appliances, warranties and manuals.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {assets.map((a) => {
            const w = WARRANTY_STYLE[a.warrantyStatus];
            const WIcon = w.icon;
            return (
              <div key={a.id} className="panel p-3 space-y-1">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{a.name}</p>
                    <p className="text-xs text-gray-400">{a.category} · {a.room.replace(/_/g, ' ')}{a.brand ? ` · ${a.brand}` : ''}{a.model ? ` ${a.model}` : ''}</p>
                  </div>
                  <button aria-label="Delete" onClick={() => remove(a.id)} disabled={busy} className="text-gray-400 hover:text-red-400 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className={`flex items-center gap-1 ${w.cls}`}><WIcon className="w-3.5 h-3.5" />{w.label}</span>
                  {a.daysToExpiry != null && a.warrantyStatus !== 'expired' && (
                    <span className="text-gray-400">{a.daysToExpiry} days left</span>
                  )}
                  {a.purchasePrice > 0 && <span className="text-neon-purple">${a.purchasePrice.toLocaleString()}</span>}
                </div>
                {(a.serial || a.manualUrl) && (
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    {a.serial && <span>SN: {a.serial}</span>}
                    {a.manualUrl && <a href={a.manualUrl} target="_blank" rel="noopener noreferrer" className="text-neon-cyan flex items-center gap-0.5"><FileText className="w-3 h-3" /> manual</a>}
                  </div>
                )}
                {a.notes && <p className="text-xs text-gray-400">{a.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
