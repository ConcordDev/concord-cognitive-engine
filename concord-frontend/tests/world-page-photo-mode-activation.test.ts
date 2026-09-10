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
//
// The P-key guard logic (which key, which focus state, which combat/
// dialogue state) and the canvas-resolution logic were later extracted into
// pure, independently testable functions —
// lib/world-lens/photo-mode-key.ts's `shouldTogglePhotoMode` /
// `resolvePhotoModeCanvas` — with real behavioral coverage (constructed
// KeyboardEvents, real assertions on the real return value) in
// tests/lib/photo-mode-key.test.ts. The blocks below that reference that
// extraction are now honest source-shape pins on page.tsx's WIRING to those
// functions (imported, and called from the keydown handler) rather than a
// claim to re-verify the guard decisions themselves — that verification
// lives in the dedicated unit test, the same split this plan already used
// for hud-corner-registry.ts (tests/lib/hud-corner-registry.test.ts) vs.
// tests/world-page-hud-corner-registry-wiring.test.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(
  path.resolve(__dirname, '..', 'components/world/WorldOsSurface.tsx'),
  'utf8'
);

describe('Phase 2 fix — Photo Mode page.tsx source shape (state + mount + P-key guard invocation; the guard\'s own decisions are behavior-tested in tests/lib/photo-mode-key.test.ts)', () => {
  it('page.tsx source no longer contains the old hardcoded, permanently-false PhotoMode stub with a no-op onClose', () => {
    expect(pageSrc).not.toMatch(/<PhotoMode open=\{false\} onClose=\{\(\) => undefined\} \/>/);
  });

  it('declares real photoModeOpen/photoModeCanvas state (page.tsx source shape)', () => {
    expect(pageSrc).toMatch(/const \[photoModeOpen, setPhotoModeOpen\] = useState\(false\);/);
    expect(pageSrc).toMatch(/const \[photoModeCanvas, setPhotoModeCanvas\] = useState<HTMLCanvasElement \| null>\(null\);/);
  });

  it('mounts PhotoMode with the real state and a real canvasRef (page.tsx source shape)', () => {
    expect(pageSrc).toMatch(/<PhotoMode open=\{photoModeOpen\} onClose=\{\(\) => setPhotoModeOpen\(false\)\} canvasRef=\{photoModeCanvas\} \/>/);
  });

  // The actual key/focus-target guard decision used to be inlined here and
  // was only source-string-pinned. It's now delegated to the pure, real-
  // behavior-tested `shouldTogglePhotoMode` (tests/lib/photo-mode-key.test.ts
  // covers lowercase/uppercase P, wrong key, INPUT/TEXTAREA/contentEditable
  // focus, and the happy path with constructed KeyboardEvents). This block
  // only pins that page.tsx imports the function and that handlePhotoModeKey
  // invokes it — not that the guard decides correctly, which is the other
  // file's job.
  it('handlePhotoModeKey\'s keydown listener source invokes the imported shouldTogglePhotoMode guard (case-insensitive P recognition and input-focus checks are real-tested in tests/lib/photo-mode-key.test.ts, not re-asserted here)', () => {
    expect(pageSrc).toMatch(/import \{ shouldTogglePhotoMode, resolvePhotoModeCanvas \} from '@\/lib\/world-lens\/photo-mode-key';/);
    expect(pageSrc).toMatch(/if \(!shouldTogglePhotoMode\(e, \{ dialogueNPC, combatTarget: combatState\.target \}\)\) return;/);
    // Regression guard: the old inline key-check must not have been
    // re-duplicated alongside the delegated call.
    expect(pageSrc).not.toMatch(/if \(e\.key !== 'p' && e\.key !== 'P'\) return;/);
  });

  it('handlePhotoModeKey\'s guard invocation passes dialogueNPC and combatState.target through to shouldTogglePhotoMode — the dialogue/combat gate itself is real-tested in tests/lib/photo-mode-key.test.ts', () => {
    const keyHandlerBlock = pageSrc.match(
      /function handlePhotoModeKey\(e: KeyboardEvent\) \{[\s\S]*?\n {4}\}/
    );
    expect(keyHandlerBlock).toBeTruthy();
    expect(keyHandlerBlock![0]).toMatch(/shouldTogglePhotoMode\(e, \{ dialogueNPC, combatTarget: combatState\.target \}\)/);
    // Regression guard: the dialogue/combat short-circuit must not have been
    // re-inlined alongside the delegated call.
    expect(keyHandlerBlock![0]).not.toMatch(/if \(dialogueNPC \|\| combatState\.target\) return;/);
  });

  it('handlePhotoModeKey\'s canvas resolution invokes the imported resolvePhotoModeCanvas(window) instead of inlining the __concordiaRenderer lookup (real resolution behavior tested in tests/lib/photo-mode-key.test.ts)', () => {
    expect(pageSrc).toMatch(/setPhotoModeCanvas\(resolvePhotoModeCanvas\(window\)\);/);
    // Regression guard: the inline global-reading lookup must not have been
    // re-duplicated alongside the delegated call.
    expect(pageSrc).not.toMatch(/window as unknown as \{ __concordiaRenderer\?: \{ domElement\?: HTMLCanvasElement \} \}/);
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
