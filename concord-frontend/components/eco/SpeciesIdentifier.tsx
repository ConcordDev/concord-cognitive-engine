'use client';

import { useRef, useState } from 'react';
import { Camera, Upload, Loader2, Check, X, Star } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface SpeciesSuggestion {
  commonName: string;
  scientificName: string;
  confidence: number;
  taxonomicRank: string;
  kingdom?: string;
}

interface SpeciesIdentifierProps {
  onAccept?: (s: SpeciesSuggestion, imageDataUrl: string) => void;
}

export function SpeciesIdentifier({ onAccept }: SpeciesIdentifierProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<SpeciesSuggestion | null>(null);

  function onFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Pick an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setImageDataUrl(url);
      setSuggestions([]);
      setAccepted(null);
      identify(url);
    };
    reader.readAsDataURL(file);
  }

  async function identify(dataUrl: string) {
    setLoading(true); setError(null);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'eco', action: 'species-identify',
        input: { imageDataUrl: dataUrl },
      });
      // /api/lens/run single-unwraps: a handler rejection arrives as
      // res.data.result = { ok:false, error }. Surface it rather than reading a
      // missing .suggestions and masking the real failure as "no species".
      const node = res.data?.result as { ok?: boolean; error?: string; suggestions?: SpeciesSuggestion[] } | null;
      if (node && node.ok === false) {
        setSuggestions([]);
        setError(node.error || 'Species identification failed.');
        return;
      }
      const items = (node?.suggestions || []) as SpeciesSuggestion[];
      setSuggestions(items);
      if (items.length === 0) setError('No species identified. Try a clearer or closer shot.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'identify failed');
    } finally { setLoading(false); }
  }

  function accept(s: SpeciesSuggestion) {
    setAccepted(s);
    if (imageDataUrl) onAccept?.(s, imageDataUrl);
  }

  function reset() {
    setImageDataUrl(null);
    setSuggestions([]);
    setAccepted(null);
    setError(null);
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Camera className="w-4 h-4 text-green-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Species ID</span>
        {imageDataUrl && (
          <button
            onClick={reset}
            className="ml-auto p-1 text-gray-400 hover:text-white"
            title="Reset"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </header>

      <div className="p-4">
        {!imageDataUrl ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500 text-black font-bold hover:bg-green-400"
            >
              <Upload className="w-4 h-4" /> Pick or capture photo
            </button>
            <p className="text-xs text-gray-400">
              Powered by LLaVA vision (5th Concord brain). Snap any plant, animal, fungus, or insect.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageDataUrl} alt="Species candidate" className="w-full max-h-80 object-contain rounded border border-white/10" />
            {loading && (
              <div className="flex items-center gap-2 text-xs text-cyan-300">
                <Loader2 className="w-4 h-4 animate-spin" /> Vision brain analysing…
              </div>
            )}
            {error && <div className="text-xs text-red-400">{error}</div>}
            {suggestions.length > 0 && (
              <ul className="space-y-2">
                {suggestions.slice(0, 5).map((s, i) => {
                  const isAccepted = accepted?.scientificName === s.scientificName;
                  return (
                    <li key={i} className={cn(
                      'p-3 rounded border flex items-start gap-3',
                      isAccepted ? 'bg-green-500/10 border-green-500/40' : 'bg-white/[0.02] border-white/10'
                    )}>
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-300 text-sm font-bold">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white">{s.commonName}</div>
                        <div className="text-xs text-gray-400 italic">{s.scientificName}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {s.taxonomicRank}{s.kingdom ? ` · ${s.kingdom}` : ''} · {Math.round(s.confidence * 100)}% confidence
                        </div>
                      </div>
                      <button
                        onClick={() => accept(s)}
                        disabled={isAccepted}
                        className={cn(
                          'shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs rounded',
                          isAccepted
                            ? 'bg-green-500/20 text-green-300 border border-green-500/40'
                            : 'bg-cyan-500 text-black font-bold hover:bg-cyan-400'
                        )}
                      >
                        {isAccepted ? <Check className="w-3 h-3" /> : <Star className="w-3 h-3" />}
                        {isAccepted ? 'Logged' : 'Accept'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SpeciesIdentifier;
