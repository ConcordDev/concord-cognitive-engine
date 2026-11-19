'use client';

/**
 * Serve the editor from Concord's own bundle instead of a CDN. By default
 * @monaco-editor/react fetches Monaco from cdn.jsdelivr.net; where that host
 * is blocked or down, the Code lens had no editor at all. Proof hands the
 * loader the installed `monaco-editor` package (and its language workers),
 * so the editor and its workers load from the same origin as the page.
 */

import { loader } from '@monaco-editor/react';

let ready: Promise<void> | null = null;

export function ensureLocalMonaco(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    // The core editor plus every syntax highlighter, without Monaco's in-browser
    // language services (each its own heavy worker). Proof's types, lint, hover,
    // completion and signature help come from the server's TypeScript service.
    const monaco = await import('./monacoCore');
    // The only worker left is the core editor worker (diffs, word suggestions).
    // `new Worker(new URL(...))` stays written out in full: that exact shape is
    // what tells the bundler to build the file as a worker. Classic, not module:
    // the bundler's worker bootstrap uses importScripts.
    (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
      getWorker(_id: string, label: string) {
        return new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { name: label });
      },
    };
    loader.config({ monaco: monaco as unknown as typeof import('monaco-editor') });
  })();
  return ready;
}
