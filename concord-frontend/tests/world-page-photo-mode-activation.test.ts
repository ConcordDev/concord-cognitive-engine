// World Lens plan Phase 2 ("Activate Existing Rendering") — Photo Mode.
//
// page.tsx mounted <PhotoMode open={false} onClose={() => undefined} /> —
// a hardcoded, permanently-closed, un-closable stub, with a comment noting
// the P-key binding was deferred to "a follow-up" that never landed. The
// component itself (components/world/PhotoMode.tsx) claimed in its own doc
// comment to listen for a 'concordia:photo-mode-toggle' window event, but no
// such listener existed anywhere in the file, and nothing in the app
// (confirmed by grep) ever dispatched that event either — there was no path
// to ever open Photo Mode.
//
// Fix: real open/onClose state + a P-key keydown effect in page.tsx, gated
// outside combat/dialogue (matching this page's other single-key bindings,
// e.g. the E-key portal/dialogue effect), plus a real canvasRef resolved
// from the same `__concordiaRenderer` window global ConcordiaScene.tsx
// already exposes for WebXR — so PhotoMode's screenshot/save-to-gallery
// paths get a real canvas instead of always reporting "No canvas available".
//
// Also deletes components/concordia/PhotoMode.tsx, a confirmed
// zero-production-importer duplicate (only its own now-deleted test
// imported it) whose doc comment claimed a "CinematicCaptureBootstrap"
// dispatcher for the same 'concordia:photo-mode-toggle' event that, on
// inspection, never actually dispatched it either.
//
// page.tsx is too large to mount in jsdom — this file follows the
// established source-pinning pattern used throughout this plan's work
// (tests/concordia-scene-resource-leak-fix.test.tsx,
// tests/components/sky-water-scene-connect.test.tsx).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(
  path.resolve(__dirname, '..', 'app/lenses/world/page.tsx'),
  'utf8'
);

describe('Phase 2 fix — Photo Mode has a real open/close/canvas wire', () => {
  it('the old hardcoded open={false} / no-op onClose mount is gone', () => {
    expect(pageSrc).not.toMatch(/<PhotoMode open=\{false\} onClose=\{\(\) => undefined\} \/>/);
  });

  it('declares real photoModeOpen/photoModeCanvas state', () => {
    expect(pageSrc).toMatch(/const \[photoModeOpen, setPhotoModeOpen\] = useState\(false\);/);
    expect(pageSrc).toMatch(/const \[photoModeCanvas, setPhotoModeCanvas\] = useState<HTMLCanvasElement \| null>\(null\);/);
  });

  it('mounts PhotoMode with the real state and a real canvasRef', () => {
    expect(pageSrc).toMatch(/<PhotoMode open=\{photoModeOpen\} onClose=\{\(\) => setPhotoModeOpen\(false\)\} canvasRef=\{photoModeCanvas\} \/>/);
  });

  it('binds P (case-insensitive) to toggle photo mode, ignoring text-input focus', () => {
    expect(pageSrc).toMatch(/if \(e\.key !== 'p' && e\.key !== 'P'\) return;/);
    expect(pageSrc).toMatch(/target\.tagName === 'INPUT' \|\| target\.tagName === 'TEXTAREA' \|\| target\.isContentEditable/);
  });

  it('the P-key handler is gated outside combat/dialogue', () => {
    const keyHandlerBlock = pageSrc.match(
      /function handlePhotoModeKey\(e: KeyboardEvent\) \{[\s\S]*?\n {4}\}/
    );
    expect(keyHandlerBlock).toBeTruthy();
    expect(keyHandlerBlock![0]).toMatch(/if \(dialogueNPC \|\| combatState\.target\) return;/);
  });

  it('resolves the canvas from the same __concordiaRenderer global ConcordiaScene.tsx exposes for WebXR', () => {
    expect(pageSrc).toMatch(/window as unknown as \{ __concordiaRenderer\?: \{ domElement\?: HTMLCanvasElement \} \}/);
    expect(pageSrc).toMatch(/setPhotoModeCanvas\(renderer\?\.domElement \?\? null\);/);
  });
});

describe('Phase 2 fix — the zero-importer duplicate PhotoMode is deleted', () => {
  it('components/concordia/PhotoMode.tsx no longer exists', () => {
    const dupPath = path.resolve(__dirname, '..', 'components/concordia/PhotoMode.tsx');
    expect(existsSync(dupPath)).toBe(false);
  });

  it('its dead test file is deleted too', () => {
    const dupTestPath = path.resolve(__dirname, 'components/PhotoMode.test.tsx');
    expect(existsSync(dupTestPath)).toBe(false);
  });

  it('nothing in production code still imports the duplicate', () => {
    expect(pageSrc).not.toMatch(/from '@\/components\/concordia\/PhotoMode'/);
  });
});
