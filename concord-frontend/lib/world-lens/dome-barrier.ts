/**
 * Dome Barrier — Sovereign Mass Raid Phase 4 visual.
 *
 * When the Sovereign enters the `eternal` raid phase, the backend declares
 * a `dome_collapse` Refusal Field via applyTemporaryRefusal() in
 * server/lib/refusal-field.js. The server emits `world:refusal-field` to
 * everyone in the world room (server.js:27424); the existing
 * RefusalFieldBanner shows a 2D HUD indicator. This helper adds the 3D
 * piece: a transparent amber sphere around the arena that shrinks from
 * its initial radius down to a thin sliver over the field's lifetime —
 * the visible "the arena is refused" beat.
 *
 * Wiring: ConcordiaScene calls attachDomeBarrier(scene) once per scene
 * lifetime, after the THREE.Scene exists. The returned cleanup unsubscribes
 * the socket listener and disposes any active dome geometry. Failure modes
 * are swallowed — the gameplay invariant is "VFX never crashes the scene".
 */
import { subscribe } from '@/lib/realtime/socket';

interface RefusalField {
  id: string;
  kind: string;
  expiresAt: number;
  reason?: string;
}

interface SceneLike {
  add: (mesh: unknown) => void;
  remove: (mesh: unknown) => void;
}

interface DomeOptions {
  /** Radius of the dome in metres at full size. Defaults to 60. */
  radius?: number;
  /** Minimum scale factor at full collapse (0..1). Defaults to 0.08. */
  minScale?: number;
  /** Hex color for the dome material. Defaults to amber 0xffaa33. */
  color?: number;
}

/**
 * Attach a dome-barrier listener to a THREE.Scene.
 * @returns cleanup function — call on scene teardown.
 */
export function attachDomeBarrier(scene: SceneLike, opts: DomeOptions = {}): () => void {
  const radius = opts.radius ?? 60;
  const minScale = opts.minScale ?? 0.08;
  const color = opts.color ?? 0xffaa33;

  // Single-dome state — replacing fields swap the mesh in place.
  let active: { dispose: () => void } | null = null;

  const offField = subscribe<RefusalField>('world:refusal-field', (field) => {
    if (!field || field.kind !== 'dome_collapse') return;

    // Replace any prior dome with a fresh one matching this field's lifetime.
    active?.dispose();
    active = null;

    let disposed = false;
    let frameId = 0;
    let dome: unknown = null;
    let geometry: { dispose: () => void } | null = null;
    let material: { dispose: () => void } | null = null;

    (async () => {
      try {
        const THREE = await import('three');
        if (disposed) return;

        const sphereGeom = new THREE.SphereGeometry(radius, 32, 16);
        // Render the inside surface so the player sees a shell around them.
        sphereGeom.scale(-1, 1, 1);
        const sphereMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.18,
          side: THREE.BackSide,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(sphereGeom, sphereMat);
        mesh.name = 'refusal_dome';
        mesh.userData.refusalFieldId = field.id;
        mesh.userData.refusalFieldKind = field.kind;

        scene.add(mesh);
        dome = mesh;
        geometry = sphereGeom;
        material = sphereMat;

        // Audio cue + screen flash via existing GameJuice bus.
        try {
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'cinematic', opts: { value: 'dome_collapse' } },
          }));
        } catch { /* juice is best-effort */ }

        const startMs = Date.now();
        const totalMs = Math.max(1000, field.expiresAt - startMs);

        const tick = () => {
          if (disposed) return;
          const elapsed = Date.now() - startMs;
          const progress = Math.min(1, elapsed / totalMs);
          const scale = 1.0 - (1.0 - minScale) * progress;
          (mesh as { scale: { setScalar: (s: number) => void } }).scale.setScalar(scale);
          // Pulse opacity faster as the dome shrinks for menace.
          (sphereMat as { opacity: number }).opacity = 0.18 + 0.22 * progress;
          if (progress < 1) {
            frameId = requestAnimationFrame(tick);
          } else if (active) {
            active.dispose();
          }
        };
        frameId = requestAnimationFrame(tick);
      } catch {
        /* THREE failed to load — skip the visual; banner still shows. */
      }
    })();

    active = {
      dispose: () => {
        disposed = true;
        if (frameId) cancelAnimationFrame(frameId);
        if (dome) {
          try { scene.remove(dome); } catch { /* ignore */ }
        }
        try { geometry?.dispose(); } catch { /* ignore */ }
        try { material?.dispose(); } catch { /* ignore */ }
        active = null;
      },
    };
  });

  return () => {
    try { offField(); } catch { /* ignore */ }
    active?.dispose();
    active = null;
  };
}
