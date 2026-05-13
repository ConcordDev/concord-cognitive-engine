'use client';
import { useRef, useState } from 'react';
import { Eye, Loader2, X } from 'lucide-react';
import { useVisionAnalysis } from '@/lib/hooks/use-vision-analysis';

interface Props {
  domain: string;
  prompt?: string;
  onResult: (result: { analysis: string; suggestedTags?: string[] }) => void;
  className?: string;
}

export function VisionAnalyzeButton({ domain, prompt, onResult, className }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { analyzeImage, isAnalyzing, result, error, reset } = useVisionAnalysis();
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    const res = await analyzeImage(file, domain, prompt);
    if (res) onResult(res);
  };

  return (
    <div className={className}>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={isAnalyzing}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/30 transition min-h-[36px]"
      >
        {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
        {isAnalyzing ? 'Analyzing...' : 'Analyze with Vision'}
      </button>
      {preview && result && (
        <div className="mt-2 p-2 rounded bg-purple-500/10 border border-purple-500/20 text-xs">
          <div className="flex justify-between items-start">
            <span className="text-purple-300 font-medium">Vision Analysis</span>
            <button onClick={() => { reset(); setPreview(null); }} className="text-zinc-500 hover:text-zinc-300" aria-label="Close"><X className="w-3 h-3" /></button>
          </div>
          <p className="text-zinc-300 mt-1 whitespace-pre-wrap">{result.analysis}</p>
          {result.suggestedTags && result.suggestedTags.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {result.suggestedTags.map(tag => (
                <span key={tag} className="px-1.5 py-0.5 bg-purple-500/20 rounded text-purple-400">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
