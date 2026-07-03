'use client';

// concord-frontend/components/conkay/artifacts/ForgeAdapter.tsx
//
// Unit F9 (K5) — the `forge-app` adapter. `forge.sandbox` compiles a Forge
// project version into a REAL generated HTML document and returns it as `html`
// (see server/domains/forge.js#sandbox — "the sandbox HTML is a real artifact").
// We render that genuine document in a sandboxed iframe, the SAME pattern the
// real ForgeStudio already ships (`sandbox="allow-same-origin"`, `srcDoc={html}`).
//
// Honesty note: `srcDoc` here carries the macro's REAL generated document — this
// is NOT the forbidden "srcDoc with fabricated content" case. `detectArtifact`
// only produces a forge-app artifact when a real `html` string is present, so
// there is never a hand-authored placeholder in this frame.

import type { ConkayForgeArtifact } from '@/lib/conkay/artifact-kinds';

export function ForgeAdapter({ artifact }: { artifact: ConkayForgeArtifact }) {
  return (
    <div data-testid="ck-adapter-forge-app" className="w-full">
      <iframe
        title="ConKay Forge app preview"
        data-testid="ck-adapter-forge-iframe"
        sandbox="allow-same-origin"
        srcDoc={artifact.html}
        className="h-[340px] w-full rounded-lg border border-cyan-400/20 bg-white"
      />
      {artifact.fileCount != null && (
        <div data-testid="ck-adapter-forge-meta" className="mt-1 px-1 text-[10px] text-cyan-300/50">
          Generated app · {artifact.fileCount} file(s){artifact.projectId ? ` · ${artifact.projectId}` : ''}
        </div>
      )}
    </div>
  );
}

export default ForgeAdapter;
