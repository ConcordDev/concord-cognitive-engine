'use client';

/**
 * BarcodeScanner — resolves a UPC/EAN barcode to product nutrition via
 * the keyless Open Food Facts API (food.barcode-lookup macro). On a hit
 * the user can log the product straight into the nutrition log
 * (food.nutrition-log) — the canonical "scan to log" MyFitnessPal flow.
 * No sample data: every value comes from the live API or user input.
 */

import { useState } from 'react';
import { ScanBarcode, Loader2, CheckCircle2, AlertTriangle, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface BarcodeNutrition {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugar_g: number;
  sodium_mg: number;
}

interface BarcodeProduct {
  found: boolean;
  barcode: string;
  name?: string;
  brand?: string | null;
  servingSize?: string | null;
  nutriScore?: string | null;
  imageUrl?: string | null;
  nutrition?: BarcodeNutrition;
}

const NUTRI_TONE: Record<string, string> = {
  A: 'bg-green-500', B: 'bg-lime-500', C: 'bg-yellow-500', D: 'bg-orange-500', E: 'bg-red-500',
};

export function BarcodeScanner({ onLogged }: { onLogged?: () => void }) {
  const [barcode, setBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<BarcodeProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);

  async function lookup() {
    const code = barcode.replace(/\D/g, '');
    if (code.length < 6) { setError('Enter at least 6 digits'); return; }
    setLoading(true); setError(null); setProduct(null); setLogged(false);
    try {
      const r = await lensRun<BarcodeProduct>('food', 'barcode-lookup', { barcode: code });
      if (r.data?.ok && r.data.result) {
        setProduct(r.data.result);
        if (!r.data.result.found) setError('No product found for that barcode');
      } else {
        setError(r.data?.error || 'Lookup failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }

  async function logProduct() {
    if (!product?.found || !product.nutrition) return;
    try {
      const r = await lensRun('food', 'nutrition-log', {
        dish: product.name,
        calories: product.nutrition.calories,
        source: 'barcode',
        macros: {
          protein_g: product.nutrition.protein_g,
          carbs_g: product.nutrition.carbs_g,
          fat_g: product.nutrition.fat_g,
        },
      });
      if (r.data?.ok) { setLogged(true); onLogged?.(); }
      else setError(r.data?.error || 'Failed to log');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log');
    }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ScanBarcode className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Barcode Scanner</span>
        <span className="ml-auto text-[10px] text-gray-500">Open Food Facts</span>
      </header>

      <div className="p-3 space-y-3">
        <div className="flex gap-2">
          <input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }}
            placeholder="UPC / EAN barcode (e.g. 3017620422003)"
            inputMode="numeric"
            className="flex-1 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-sm text-white"
          />
          <button
            onClick={lookup}
            disabled={loading}
            className="px-3 py-1.5 rounded bg-cyan-500 text-black text-xs font-bold hover:bg-cyan-400 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Look up'}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
          </div>
        )}

        {product?.found && product.nutrition && (
          <div className="bg-lattice-deep border border-lattice-border rounded p-3 space-y-2">
            <div className="flex items-start gap-3">
              {product.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl} alt={product.name || 'product'} className="w-14 h-14 object-cover rounded bg-black/40" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{product.name}</div>
                <div className="text-[10px] text-gray-500">
                  {product.brand || 'Unknown brand'}
                  {product.servingSize ? ` · serving ${product.servingSize}` : ''}
                </div>
              </div>
              {product.nutriScore && (
                <span className={cn('w-6 h-6 rounded text-black text-xs font-bold flex items-center justify-center',
                  NUTRI_TONE[product.nutriScore] || 'bg-gray-500')}>
                  {product.nutriScore}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {([
                ['Calories', product.nutrition.calories, 'text-orange-400'],
                ['Protein', `${product.nutrition.protein_g}g`, 'text-blue-400'],
                ['Carbs', `${product.nutrition.carbs_g}g`, 'text-yellow-400'],
                ['Fat', `${product.nutrition.fat_g}g`, 'text-red-400'],
                ['Sugar', `${product.nutrition.sugar_g}g`, 'text-pink-400'],
                ['Sodium', `${product.nutrition.sodium_mg}mg`, 'text-purple-400'],
              ] as const).map(([label, value, tone]) => (
                <div key={label} className="bg-black/30 rounded py-1.5">
                  <div className={cn('text-sm font-bold', tone)}>{value}</div>
                  <div className="text-[9px] text-gray-500 uppercase">{label}</div>
                </div>
              ))}
            </div>
            <button
              onClick={logProduct}
              disabled={logged}
              className={cn('w-full py-1.5 rounded text-xs font-bold flex items-center justify-center gap-1.5',
                logged ? 'bg-green-500/20 text-green-300' : 'bg-cyan-500 text-black hover:bg-cyan-400')}
            >
              {logged ? <><CheckCircle2 className="w-3.5 h-3.5" /> Logged to nutrition diary</>
                : <><Plus className="w-3.5 h-3.5" /> Log to nutrition diary</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default BarcodeScanner;
