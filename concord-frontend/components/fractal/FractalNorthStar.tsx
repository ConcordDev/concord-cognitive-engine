'use client';

/**
 * Visuals north star — one image and two knobs. The renderer stays unmounted
 * until Render, so the empty frame is not a fake fractal.
 */

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { StudioFamilyPill } from '@/components/studio/StudioFamilyChrome';
import { FractalRenderer } from '@/components/fractal/FractalRenderer';
import { FractalRepos } from '@/components/fractal/FractalRepos';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export function FractalNorthStar() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [zoom, setZoom] = useState(1);
  const [iterations, setIterations] = useState(200);
  const [rendered, setRendered] = useState(false);
  const [tooling, setTooling] = useState(false);

  const scale = (3 / 600) / zoom;

  return (
    <LensShell lensId="fractal" asMain={false} disableAgentFab>
      <div data-lens-theme="fractal" className="flex min-h-[calc(100vh-4rem)] flex-col px-8 pb-28 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Visuals" title={who ? `One image, ${who}` : 'One image'} />
            <StudioFamilyPill active="fractal" />
          </div>
          <QuietMore
            items={[{ id: 'tooling', label: tooling ? 'Hide tooling' : 'Fractal tooling' }]}
            onPick={() => setTooling((v) => !v)}
          />
        </div>

        <div className="mt-8 flex flex-col gap-8 lg:flex-row">
          <div className="h-[420px] w-full max-w-[560px] overflow-hidden rounded-2xl border border-white/10 bg-black">
            {rendered ? (
              <FractalRenderer
                variant="image"
                initial={{ scale, maxIter: iterations }}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-[14px] text-zinc-500">
                Two knobs. The render is the page.
              </div>
            )}
          </div>
          <div className="w-full max-w-xs space-y-5">
            <label className="block text-[14px] text-zinc-100">
              Zoom
              <input
                aria-label="Zoom"
                type="range"
                min={0.5}
                max={8}
                step={0.1}
                value={zoom}
                onChange={(e) => { setZoom(Number(e.target.value)); setRendered(false); }}
                className="mt-2 w-full accent-teal-400"
              />
            </label>
            <label className="block text-[14px] text-zinc-100">
              Iterations
              <input
                aria-label="Iterations"
                type="range"
                min={32}
                max={800}
                step={16}
                value={iterations}
                onChange={(e) => { setIterations(Number(e.target.value)); setRendered(false); }}
                className="mt-2 w-full accent-teal-400"
              />
            </label>
          </div>
        </div>

        {tooling && (
          <div className="mt-8">
            <button type="button" onClick={() => setTooling(false)} className="mb-3 inline-flex items-center gap-1.5 text-[14px] text-zinc-500">
              <ArrowLeft className="h-4 w-4" />
              Back to the image
            </button>
            <FractalRepos />
          </div>
        )}

        <button type="button" className={northCtaClass} onClick={() => setRendered(true)}>
          Render
        </button>
      </div>
    </LensShell>
  );
}
