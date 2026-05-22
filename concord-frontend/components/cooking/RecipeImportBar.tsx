'use client';

/**
 * RecipeImportBar — Paprika 3 + Samsung Food parity.
 * Two real import paths into the recipe box:
 *   1. Recipe import from URL — parses schema.org/Recipe JSON-LD
 *      from any cooking site (cooking.import-from-url).
 *   2. Photo-based recipe capture — OCRs a cookbook page through
 *      the vision brain (cooking.import-from-photo).
 * No mock data — every recipe created comes from a live page or photo.
 */

import { useCallback, useRef, useState } from 'react';
import { Link2, Camera, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ImportedRecipe { id: string; title: string }
interface UrlResult { recipe: ImportedRecipe; importedSteps: number; importedIngredients: number }
interface PhotoResult { recipe: ImportedRecipe; model?: string }

interface RecipeImportBarProps {
  onImported?: () => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('could not read image'));
    reader.readAsDataURL(file);
  });
}

export function RecipeImportBar({ onImported }: RecipeImportBarProps) {
  const [url, setUrl] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importUrl = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setUrlBusy(true);
    setMsg(null);
    try {
      const r = await lensRun<UrlResult>('cooking', 'import-from-url', { url: trimmed });
      if (r.data.ok && r.data.result) {
        const res = r.data.result;
        setMsg({ kind: 'ok', text: `Imported "${res.recipe.title}" — ${res.importedIngredients} ingredients, ${res.importedSteps} steps.` });
        setUrl('');
        onImported?.();
      } else {
        setMsg({ kind: 'err', text: r.data.error || 'import failed' });
      }
    } catch {
      setMsg({ kind: 'err', text: 'network error while importing' });
    } finally {
      setUrlBusy(false);
    }
  }, [url, onImported]);

  const importPhoto = useCallback(async (file: File) => {
    setPhotoBusy(true);
    setMsg(null);
    try {
      const imageB64 = await fileToBase64(file);
      const r = await lensRun<PhotoResult>('cooking', 'import-from-photo', { imageB64 });
      if (r.data.ok && r.data.result) {
        setMsg({ kind: 'ok', text: `Captured "${r.data.result.recipe.title}" from photo via vision OCR.` });
        onImported?.();
      } else {
        setMsg({ kind: 'err', text: r.data.error || 'could not read a recipe from that photo' });
      }
    } catch {
      setMsg({ kind: 'err', text: 'could not process the photo' });
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [onImported]);

  return (
    <div className="rounded-lg border border-orange-500/15 bg-[#0d1117] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-semibold text-gray-200">Import a recipe</span>
        <span className="text-[10px] text-gray-500">from any cooking site or a cookbook photo</span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') importUrl(); }}
            placeholder="Paste a recipe URL…"
            className="flex-1 rounded border border-lattice-border bg-lattice-deep px-2.5 py-1.5 text-sm text-white"
          />
          <button
            onClick={importUrl}
            disabled={urlBusy || !url.trim()}
            className="inline-flex items-center gap-1.5 rounded bg-orange-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-orange-400 disabled:opacity-40"
          >
            {urlBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
            Import URL
          </button>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={photoBusy}
          className="inline-flex items-center gap-1.5 rounded border border-orange-500/30 px-3 py-1.5 text-xs font-semibold text-orange-300 hover:bg-orange-500/10 disabled:opacity-40"
        >
          {photoBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
          Capture from photo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importPhoto(f); }}
        />
      </div>

      {msg && (
        <div
          className={cn(
            'flex items-start gap-2 rounded border px-2.5 py-1.5 text-xs',
            msg.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300',
          )}
        >
          {msg.kind === 'ok' ? <CheckCircle2 className="mt-0.5 w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}
    </div>
  );
}

export default RecipeImportBar;
