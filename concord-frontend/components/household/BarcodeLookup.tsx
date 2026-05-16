'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ScanLine, Loader2, AlertTriangle } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Product {
  barcode: string;
  name?: string; brand?: string; quantity?: string; categories?: string;
  ingredients?: string; allergens?: string[]; additives?: string[];
  nutriScore?: string; ecoScore?: string; novaGroup?: number;
  nutrition?: Record<string, number | undefined>;
  imageUrl?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('household', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const NUTRI_COLOR: Record<string, string> = {
  a: 'bg-emerald-600 text-emerald-50',
  b: 'bg-lime-500 text-lime-950',
  c: 'bg-yellow-500 text-yellow-950',
  d: 'bg-orange-500 text-orange-950',
  e: 'bg-rose-600 text-rose-50',
};

export function BarcodeLookup() {
  const [barcode, setBarcode] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: async () => callMacro<Product>('off-product-lookup', { barcode }),
    onSuccess: (env) => { if (env.ok && env.result) { setProduct(env.result); setError(null); } else { setProduct(null); setError(env.error || 'not found'); } },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Barcode Lookup</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">open food facts</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (barcode.length >= 8) lookup.mutate(); }} className="flex items-center gap-2">
        <input type="text" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ''))} maxLength={14} placeholder="8-14 digit UPC/EAN" className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-sm text-white" />
        <button type="submit" disabled={barcode.length < 8 || lookup.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {lookup.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
          Lookup
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {product && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-zinc-950/60 to-zinc-950/80 p-4">
          <div className="flex items-start gap-3">
            {product.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.imageUrl} alt={product.name} className="h-24 w-24 shrink-0 rounded object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-zinc-500">{product.brand}</p>
              <h3 className="text-lg font-semibold text-white">{product.name || product.barcode}</h3>
              {product.quantity && <p className="text-[11px] text-zinc-400">{product.quantity}</p>}
              <div className="mt-2 flex items-center gap-1.5">
                {product.nutriScore && (
                  <div className="flex gap-0.5">
                    {['a', 'b', 'c', 'd', 'e'].map((g) => (
                      <span key={g} className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${g === product.nutriScore ? NUTRI_COLOR[g] : 'bg-zinc-800 text-zinc-600'}`}>{g}</span>
                    ))}
                  </div>
                )}
                {product.novaGroup != null && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-bold text-amber-300">NOVA {product.novaGroup}</span>
                )}
                {product.ecoScore && (
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${NUTRI_COLOR[product.ecoScore]}`}>eco {product.ecoScore}</span>
                )}
              </div>
            </div>
            <SaveAsDtuButton
              compact
              apiSource="open-food-facts"
              apiUrl={`https://world.openfoodfacts.org/product/${product.barcode}`}
              title={`${product.brand || ''} ${product.name || product.barcode}`}
              content={JSON.stringify(product, null, 2)}
              extraTags={['household', 'food', 'nutriscore-' + (product.nutriScore || 'n')]}
              rawData={product}
            />
          </div>
          {product.allergens && product.allergens.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded border border-red-500/20 bg-red-500/5 p-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              <span className="text-red-300">Allergens: {product.allergens.map((a) => a.replace(/^en:/, '')).join(', ')}</span>
            </div>
          )}
          {product.ingredients && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300">Ingredients</summary>
              <p className="mt-1 text-[11px] text-zinc-400">{product.ingredients}</p>
            </details>
          )}
          {product.nutrition && (
            <div className="mt-3 grid grid-cols-3 gap-1 text-[10px] sm:grid-cols-6">
              {Object.entries(product.nutrition).filter(([, v]) => v != null).map(([k, v]) => (
                <div key={k} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-center">
                  <div className="text-zinc-500">{k.replace('100g', '/100g').replace('Kcal', ' kcal')}</div>
                  <div className="font-mono text-cyan-300">{v?.toFixed?.(1) ?? v}</div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
