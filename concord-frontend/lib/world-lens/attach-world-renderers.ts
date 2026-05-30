// concord-frontend/lib/world-lens/attach-world-renderers.ts
//
// Render-Everything WS2 — mount the world-state renderers into ConcordiaScene's
// reserved `infrastructure` layer (and the VFX bridge into `particles`). This is
// the single wiring point that takes the four already-built, already-tested
// renderer libs from "on disk but never mounted" to "live in the 3D world":
//
//   • ResourceNodeRenderer  — trees / ore / crystals / springs that visibly deplete
//   • CropFieldRenderer     — claim crops as 3D plants stepping through growth stages
//   • ClaimBoundaryRenderer — land-claim rings + settlement tint (owned/contested)
//   • WorldVFXBridge        — the orphan `concordia:particle-effect` consumer
//
// Each renderer is a pure factory `(parentGroup, opts) => { update, dispose }`.
// This helper instantiates all four, returns one `update(delta,elapsed)` that
// fans out + one `dispose()` that tears everything down. ConcordiaScene wires the
// returned `update` onto `layers.infrastructure.userData.update` (the per-frame
// fan-out already walks every layer) and calls `dispose` in teardown.
//
// Auth: the world data endpoints honour the JWT cookie on same-origin requests;
// for the mobile AuthedWebView wrapper we also pass the injected-JWT accessor so
// the Authorization header is set when a cookie isn't available. No token → the
// renderers fetch with the cookie only and render nothing on a 401 (honest-empty).

import * as THREE from 'three';
import { getInjectedJwt } from '@/lib/auth-bridge';
import { createResourceNodeRenderer } from './resource-node-renderer';
import { createCropFieldRenderer } from './crop-field-renderer';
import { createClaimBoundaryRenderer } from './claim-boundary-renderer';
import { createConstructionProgressRenderer } from './construction-progress-renderer';
import { createWorldVFXBridge } from './world-vfx-bridge';

export interface WorldRenderersHandle {
  /** Call every frame. Fans out to every mounted renderer. */
  update(delta: number, elapsed: number): void;
  /** Tear down every renderer + remove window listeners. Idempotent. */
  dispose(): void;
}

export interface AttachWorldRenderersOpts {
  worldId: string;
  /** Override the API base (default same-origin ''). */
  apiBase?: string;
  /** Override poll cadence for the data renderers (ms). */
  pollMs?: number;
  /** Cap on simultaneous VFX bursts. */
  maxBursts?: number;
}

/**
 * Mount the world-state renderers under `infrastructureGroup` and the VFX bridge
 * under `particlesGroup`. Returns a single update/dispose handle.
 *
 * Pure-defensive: every renderer is wrapped so one throwing factory can't stop
 * the others from mounting; `update`/`dispose` swallow per-renderer throws so a
 * single bad frame never kills the render loop.
 */
export function attachWorldRenderers(
  infrastructureGroup: THREE.Group,
  particlesGroup: THREE.Group,
  opts: AttachWorldRenderersOpts,
): WorldRenderersHandle {
  const authToken = () => getInjectedJwt();
  const dataOpts = {
    worldId: opts.worldId,
    apiBase: opts.apiBase,
    pollMs: opts.pollMs,
    authToken,
  };

  const updaters: Array<{ update(delta: number, elapsed: number): void; dispose(): void }> = [];

  function mount<T extends { update(d: number, e: number): void; dispose(): void }>(
    factory: () => T,
  ): void {
    try {
      updaters.push(factory());
    } catch {
      // A renderer that fails to construct simply isn't mounted — the rest still are.
    }
  }

  mount(() => createResourceNodeRenderer(infrastructureGroup, dataOpts));
  mount(() => createCropFieldRenderer(infrastructureGroup, dataOpts));
  mount(() => createClaimBoundaryRenderer(infrastructureGroup, dataOpts));
  mount(() => createConstructionProgressRenderer(infrastructureGroup, dataOpts));
  mount(() => createWorldVFXBridge(particlesGroup, { maxBursts: opts.maxBursts }));

  let disposed = false;

  return {
    update(delta: number, elapsed: number): void {
      if (disposed) return;
      for (const u of updaters) {
        try {
          u.update(delta, elapsed);
        } catch {
          // One renderer's bad frame must not stop the others / the loop.
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const u of updaters) {
        try {
          u.dispose();
        } catch {
          // idempotent teardown
        }
      }
      updaters.length = 0;
    },
  };
}
