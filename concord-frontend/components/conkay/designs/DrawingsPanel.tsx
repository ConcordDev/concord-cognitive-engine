'use client';

/**
 * DrawingsPanel — the design's GA sheets (SVG, as the drawing pipeline wrote
 * them, shown as images so nothing in them can run) with the PDF, and the CAD
 * kernel mesh in an orbit viewer that loads only when asked (it is the
 * largest file on the page).
 */

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { Box, Download, FileText, Loader2 } from 'lucide-react';
import { designFileUrl, formatBytes, type DesignDrawing, type DesignModel3d } from '@/lib/conkay/designs-api';
import { PANEL } from './design-styles';

const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading viewer…
    </div>
  ),
});

export function DrawingsPanel({ designId, drawings, model3d }: { designId: string; drawings: DesignDrawing[]; model3d: DesignModel3d | null }) {
  const sheets = drawings.flatMap((d) => d.files.filter((f) => f.kind === 'svg').map((f) => ({ ...f, drawing: d })));
  const [sheet, setSheet] = useState(0);
  const [show3d, setShow3d] = useState(false);
  const [modelError, setModelError] = useState('');
  const onModelError = useCallback((m: string) => setModelError(m), []);
  const current = sheets[sheet];

  if (!sheets.length && !model3d) {
    return (
      <section className={PANEL} aria-label="Drawings">
        <h2 className="text-sm font-semibold">Drawings</h2>
        <p className="mt-1.5 text-xs text-slate-400">This design has no geometry to draw: it is a material or mixture record, so its results are the values and tests below.</p>
      </section>
    );
  }

  return (
    <section className={`${PANEL} flex flex-col gap-3`} aria-label="Drawings and model">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Drawings{model3d ? ' and CAD model' : ''}</h2>
        {sheets.length > 1 && (
          <div role="tablist" aria-label="Sheets" className="flex gap-1">
            {sheets.map((s, i) => (
              <button
                key={s.name}
                role="tab"
                aria-selected={i === sheet}
                onClick={() => setSheet(i)}
                className={`rounded-md border px-2 py-1 text-[11px] ${i === sheet ? 'border-sky-400/40 bg-sky-400/10 text-sky-100' : 'border-white/10 text-slate-400 hover:text-slate-200'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {current && (
        <figure className="flex flex-col gap-2">
          <div className="overflow-auto rounded-xl border border-white/10 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element -- a drawing served as-is from the snapshot */}
            <img src={designFileUrl(designId, current.name)} alt={`${current.drawing.title}, ${current.label}`} className="h-auto w-full min-w-[640px]" loading="lazy" />
          </div>
          <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span>{current.drawing.title}</span>
            {current.drawing.revision && <span className="font-mono text-slate-300">rev {current.drawing.revision}</span>}
            {current.drawing.modelHash && <span className="font-mono" title={current.drawing.modelHash}>model {current.drawing.modelHash.slice(0, 12)}…</span>}
            <span className="ml-auto flex gap-2">
              {current.drawing.files.map((f) => (
                <a key={f.name} href={designFileUrl(designId, f.name)} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-slate-300 hover:border-sky-400/40 hover:text-sky-100">
                  {f.kind === 'pdf' ? <Download className="h-3 w-3" aria-hidden /> : <FileText className="h-3 w-3" aria-hidden />}
                  {f.kind.toUpperCase()} · {formatBytes(f.bytes)}
                </a>
              ))}
            </span>
          </figcaption>
        </figure>
      )}
      {model3d && (
        <div className="flex flex-col gap-2">
          <div className="relative h-[46vh] min-h-[280px] overflow-hidden rounded-xl border border-white/10 bg-[#050d18]">
            {show3d ? (
              <StlViewer url={designFileUrl(designId, model3d.name)} onError={onModelError} />
            ) : (
              <button
                onClick={() => setShow3d(true)}
                className="absolute inset-0 m-auto flex h-fit w-fit items-center gap-2 rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-sm text-sky-100 hover:bg-sky-400/20"
              >
                <Box className="h-4 w-4" aria-hidden /> Load CAD model ({formatBytes(model3d.bytes)})
              </button>
            )}
          </div>
          {modelError && <p role="alert" className="text-xs text-rose-300">Model not loaded: {modelError}</p>}
          <p className="text-[11px] leading-relaxed text-slate-500">
            {model3d.triangles != null && <span className="text-slate-400">{model3d.triangles.toLocaleString()} triangles · </span>}
            {model3d.source}
          </p>
        </div>
      )}
    </section>
  );
}
