'use client';

import { useRef, useState } from 'react';
import { Camera, Upload, Loader2, X, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface FoodIdentification {
  dish: string;
  ingredientsVisible: string[];
  estimatedCalories: number;
  confidence: number;
  macros?: { protein_g: number; carbs_g: number; fat_g: number };
}

interface PlateScanProps {
  onLog?: (id: FoodIdentification, imageDataUrl: string) => void;
}

export function PlateScan({ onLog }: PlateScanProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [result, setResult] = useState<FoodIdentification | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);

  function onFile(file: File) {
    if (!file.type.startsWith('image/')) { setError('Pick an image.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setImageDataUrl(url); setResult(null); setLogged(false); setError(null);
      identify(url);
    };
    reader.readAsDataURL(file);
  }

  async function identify(dataUrl: string) {
    setLoading(true); setError(null);
    try {
      const res = await lensRun({
        domain: 'food', action: 'vision-identify', input: { imageDataUrl: dataUrl },
      });
      setResult(res.data?.result as FoodIdentification || null);
    } catch (e) { setError(e instanceof Error ? e.message : 'identify failed'); }
    finally { setLoading(false); }
  }

  async function log() {
    if (!result || !imageDataUrl) return;
    try {
      await lensRun({
        domain: 'food', action: 'nutrition-log',
        input: {
          source: 'photo',
          dish: result.dish,
          calories: result.estimatedCalories,
          macros: result.macros,
          imageDataUrl,
        },
      });
      setLogged(true);
      onLog?.(result, imageDataUrl);
    } catch (e) { console.error('[Plate] log failed', e); }
  }

  function reset() {
    setImageDataUrl(null); setResult(null); setLogged(false); setError(null);
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Camera className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Plate scan</span>
        <span className="ml-auto text-[10px] text-gray-400">LLaVA vision</span>
        {imageDataUrl && <button aria-label="Reset" onClick={reset} className="p-1 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>}
      </header>
      <div className="p-4">
        {!imageDataUrl ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">
              <Upload className="w-4 h-4" /> Snap or pick a plate photo
            </button>
            <p className="text-xs text-gray-400">~13-25% calorie estimate error per PlateLens benchmark</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageDataUrl} alt="Plate" className="w-full max-h-72 object-contain rounded border border-white/10" />
            {loading && <div className="flex items-center gap-2 text-xs text-cyan-300"><Loader2 className="w-4 h-4 animate-spin" /> Vision brain analysing…</div>}
            {error && <div className="text-xs text-red-400">{error}</div>}
            {result && (
              <div className="space-y-2">
                <div className="bg-white/[0.02] rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-bold text-white">{result.dish}</h3>
                    <span className="text-[10px] text-gray-400">{Math.round(result.confidence * 100)}% confidence</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-yellow-300 font-mono text-xl">{Math.round(result.estimatedCalories)} kcal</span>
                    {result.macros && (
                      <span className="ml-3 text-xs text-gray-400">
                        P {Math.round(result.macros.protein_g)}g · C {Math.round(result.macros.carbs_g)}g · F {Math.round(result.macros.fat_g)}g
                      </span>
                    )}
                  </div>
                  {result.ingredientsVisible.length > 0 && (
                    <p className="text-xs text-gray-400 mt-1">Visible: {result.ingredientsVisible.join(', ')}</p>
                  )}
                </div>
                <button
                  onClick={log}
                  disabled={logged}
                  className={cn('w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-bold',
                    logged ? 'bg-green-500/20 text-green-300 border border-green-500/40' : 'bg-cyan-500 text-black hover:bg-cyan-400'
                  )}
                >
                  {logged ? <Check className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                  {logged ? 'Logged' : 'Log meal'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PlateScan;
