/**
 * Reactive Ambient — Wave G4. Drives torch flicker, banner sway, water
 * ripple amplitude, brazier ember rate from /api/worlds/:worldId/ambient.
 *
 * Polls every 5s (server caches per cell for 2s). On each poll the
 * returned wind vector + signals drive shader uniforms / per-frame
 * rAF modulations registered against the world props layer.
 *
 * No backend changes here — uses the route + signals already in place.
 */

import * as THREE from 'three';

interface AmbientResponse {
  ok: boolean;
  worldId: string;
  signals?: {
    pressure?: number;
    humidity?: number;
    airQuality?: number;
    light?: number;
    temperature?: number;
    noise?: number;
    hasData?: boolean;
  };
  wind?: { directionRad: number; magnitude: number };
}

export interface ReactiveSnapshot {
  windDirRad: number;
  windMagnitude: number;
  pressure: number;
  humidity: number;
  airQuality: number;
  light: number;
  ts: number;
}

const POLL_INTERVAL_MS = 5000;
const SMOOTH_TAU_S = 2.0; // exponential smoothing time-constant

export class AmbientPoller {
  private worldId: string | null = null;
  private playerXZ: { x: number; z: number } = { x: 0, z: 0 };
  private snapshot: ReactiveSnapshot;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor() {
    this.snapshot = {
      windDirRad: 0,
      windMagnitude: 0.2,
      pressure: 0,
      humidity: 0,
      airQuality: 1.0,
      light: 0,
      ts: Date.now(),
    };
  }

  setWorld(worldId: string | null) {
    if (this.worldId === worldId) return;
    this.worldId = worldId;
    if (this.timer) { try { clearInterval(this.timer); } catch { /* ok */ } }
    this.timer = null;
    if (!worldId) return;
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, POLL_INTERVAL_MS);
  }

  setPlayerPosition(xz: { x: number; z: number }) { this.playerXZ = xz; }

  getSnapshot(): ReactiveSnapshot { return this.snapshot; }

  /**
   * Smooth wind shader uniform — vec2(windX, windZ) scaled by magnitude.
   * Caller passes a Vector2 ref that's updated in place; the caller's
   * shader reads `uWind`.
   */
  applyWindTo(out: THREE.Vector2) {
    out.set(
      Math.sin(this.snapshot.windDirRad) * this.snapshot.windMagnitude,
      Math.cos(this.snapshot.windDirRad) * this.snapshot.windMagnitude,
    );
  }

  /**
   * Torch flicker intensity for the current snapshot. Pure function of
   * t (seconds) + pressure delta. Returns 0.6..1.1.
   */
  torchFlicker(tSeconds: number, salt: number = 0): number {
    const pressureMod = 1.0 + Math.min(0.3, Math.abs(this.snapshot.pressure) * 0.4);
    // Perlin-ish via sum-of-sines.
    const a = Math.sin(tSeconds * 8 + salt) * 0.15;
    const b = Math.sin(tSeconds * 17.3 + salt * 1.3) * 0.08;
    const c = Math.sin(tSeconds * 31.7 + salt * 0.7) * 0.05;
    return Math.max(0.5, Math.min(1.2, (1.0 + a + b + c) * pressureMod));
  }

  /**
   * Brazier ember emission rate. Low airQuality → more smoke.
   */
  emberRate(): number {
    const q = this.snapshot.airQuality;
    // q=1 (clean) → 0.5 emits/sec; q=0.4 (poor) → 2 emits/sec
    return Math.max(0.3, 2.5 - q * 2);
  }

  /**
   * Water ripple amplitude given noise level.
   */
  waterRippleAmplitude(): number {
    return Math.max(0.04, Math.min(0.4, 0.05 + this.snapshot.humidity * 0.003));
  }

  dispose() {
    this.disposed = true;
    if (this.timer) { try { clearInterval(this.timer); } catch { /* ok */ } }
    this.timer = null;
  }

  private async poll() {
    if (this.disposed || !this.worldId) return;
    try {
      const url = `/api/worlds/${encodeURIComponent(this.worldId)}/ambient?x=${this.playerXZ.x}&z=${this.playerXZ.z}`;
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = (await r.json()) as AmbientResponse;
      if (!j?.ok) return;
      // Exponential smoothing between snapshots.
      const now = Date.now();
      const dt = Math.max(0.01, (now - this.snapshot.ts) / 1000);
      const k = 1 - Math.exp(-dt / SMOOTH_TAU_S);
      const sig = j.signals || {};
      const wind = j.wind || { directionRad: 0, magnitude: 0.2 };
      this.snapshot = {
        windDirRad: this.snapshot.windDirRad + (wind.directionRad - this.snapshot.windDirRad) * k,
        windMagnitude: this.snapshot.windMagnitude + (wind.magnitude - this.snapshot.windMagnitude) * k,
        pressure: this.snapshot.pressure + ((sig.pressure ?? 0) - this.snapshot.pressure) * k,
        humidity: this.snapshot.humidity + ((sig.humidity ?? 0) - this.snapshot.humidity) * k,
        airQuality: this.snapshot.airQuality + ((sig.airQuality ?? 1) - this.snapshot.airQuality) * k,
        light: this.snapshot.light + ((sig.light ?? 0) - this.snapshot.light) * k,
        ts: now,
      };
    } catch { /* best-effort poll */ }
  }
}
