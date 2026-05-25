'use client';

import { useEffect, useState } from 'react';
import { Store, Loader2, Save } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Shop {
  id: string; name: string; slug: string; tagline: string; bio: string;
  currency: string; country: string;
  bannerUrl: string; avatarUrl: string;
  socials: { web: string; instagram: string; twitter: string };
  policies: { shipping: string; returns: string; custom: string };
  active: boolean;
}

export function ShopSettingsPanel({ onUpdated }: { onUpdated?: (shop: Shop) => void }) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'shop-get', input: {} });
      setShop(r.data?.result?.shop || null);
    } catch (e) { console.error('[Shop] get', e); }
    finally { setLoading(false); }
  }

  async function save() {
    if (!shop) return;
    setSaving(true);
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'shop-update', input: shop as unknown as Record<string, unknown> });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      const updated = r.data?.result?.shop as Shop;
      setShop(updated);
      onUpdated?.(updated);
    } catch (e) { console.error('[Shop] save', e); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>;
  if (!shop) return <div className="p-10 text-center text-xs text-gray-400">Shop not found.</div>;

  return (
    <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Store className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-semibold text-gray-200">Shop settings</span>
        <button onClick={save} disabled={saving} className="ml-auto px-2.5 py-1 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400 disabled:opacity-40 inline-flex items-center gap-1">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}Save
        </button>
      </header>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-12 gap-2">
          <Field className="col-span-6" label="Shop name">
            <input value={shop.name} onChange={e => setShop({ ...shop, name: e.target.value })} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field className="col-span-4" label="Slug (URL-safe)">
            <input value={shop.slug} onChange={e => setShop({ ...shop, slug: e.target.value })} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          </Field>
          <Field className="col-span-2" label="Currency">
            <input value={shop.currency} onChange={e => setShop({ ...shop, currency: e.target.value })} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          </Field>
          <Field className="col-span-12" label="Tagline">
            <input value={shop.tagline} onChange={e => setShop({ ...shop, tagline: e.target.value })} placeholder="A short line shown on your storefront" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field className="col-span-12" label="Bio">
            <textarea value={shop.bio} onChange={e => setShop({ ...shop, bio: e.target.value })} rows={4} placeholder="Tell customers about your shop." className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field className="col-span-6" label="Banner URL">
            <input value={shop.bannerUrl} onChange={e => setShop({ ...shop, bannerUrl: e.target.value })} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field className="col-span-6" label="Avatar URL">
            <input value={shop.avatarUrl} onChange={e => setShop({ ...shop, avatarUrl: e.target.value })} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field className="col-span-4" label="Web">
            <input value={shop.socials.web} onChange={e => setShop({ ...shop, socials: { ...shop.socials, web: e.target.value } })} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field className="col-span-4" label="Instagram">
            <input value={shop.socials.instagram} onChange={e => setShop({ ...shop, socials: { ...shop.socials, instagram: e.target.value } })} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field className="col-span-4" label="Twitter">
            <input value={shop.socials.twitter} onChange={e => setShop({ ...shop, socials: { ...shop.socials, twitter: e.target.value } })} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field className="col-span-12" label="Shipping policy">
            <textarea value={shop.policies.shipping} onChange={e => setShop({ ...shop, policies: { ...shop.policies, shipping: e.target.value } })} rows={2} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field className="col-span-12" label="Returns policy">
            <textarea value={shop.policies.returns} onChange={e => setShop({ ...shop, policies: { ...shop.policies, returns: e.target.value } })} rows={2} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={className}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">{label}</div>
      {children}
    </label>
  );
}

export default ShopSettingsPanel;
