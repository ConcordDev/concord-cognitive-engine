// lib/conkay/unity-bridge.ts
//
// Honest LIVE stub: browser → Unity WebGL iframe postMessage path.
// ConKay (or any client) posts typed `concordia:cmd` envelopes into the
// iframe that world/page.tsx mounts when NEXT_PUBLIC_CONCORDIA_RENDERER=unity-webgl.
// Reverse path listens for `concordia:event` from the iframe (or same-origin
// child). F0 markers: spawn_primitive / set_color / clear_temp.
// Mesh: apply_mesh / spawn_from_spec → MeshFilter (partMesh arrays) — not full CAD.
// GLB: load_glb { url, position?, scale?, name? } → Unity glTFast URL fetch → glb_loaded.
// Transform: set_transform { id|name, position?, scale?, rotation? } → transform_set.
//
// No-op safe: if the iframe is missing / not yet loaded / cross-origin without
// contentWindow, send returns false and does nothing.

export const UNITY_IFRAME_ID = 'concordia-unity-webgl';

export const CONCORDIA_CMD = 'concordia:cmd' as const;
export const CONCORDIA_EVENT = 'concordia:event' as const;

/** Commands the browser may post into the Unity WebGL iframe. */
export type ConcordiaCmdName =
  | 'ping'
  | 'hello'
  | 'focus'
  | 'notify'
  | 'camera'
  | 'intent'
  | 'spawn_primitive'
  | 'set_color'
  | 'clear_temp'
  | 'apply_mesh'
  | 'spawn_from_spec'
  | 'load_glb'
  | 'set_transform';

/** Events the iframe / Unity build may post back to the parent. */
export type ConcordiaEventName =
  | 'pong'
  | 'ready'
  | 'ack'
  | 'status'
  | 'error'
  | 'spawned'
  | 'mesh_applied'
  | 'glb_loaded'
  | 'transform_set';

export type SpawnPrimitiveKind = 'cube' | 'sphere';

export interface Vec3Payload {
  x?: number;
  y?: number;
  z?: number;
}

export interface RgbaPayload {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/** Payload for `spawn_primitive` — F0 world marker, not CAD. */
export interface SpawnPrimitivePayload {
  kind: SpawnPrimitiveKind;
  position?: Vec3Payload;
  /** Uniform number or per-axis vec. */
  scale?: number | Vec3Payload;
  /** CSS hex (#rrggbb) or 0–1 rgba channels. */
  color?: string | RgbaPayload;
}

/** Payload for `set_color` — recolors last / all under ConKayTemp. */
export interface SetColorPayload {
  color: string | RgbaPayload;
  /** When true, recolor every child under ConKayTemp; else last spawned. */
  all?: boolean;
}

/**
 * Payload for `apply_mesh` — flat positions [x,y,z,…] + triangle indices.
 * Mirrors engineering.partMesh result shape. Not GLB / free-text CAD.
 */
export interface ApplyMeshPayload {
  positions: number[];
  indices: number[];
  /** CSS hex (#rrggbb) or 0–1 rgba channels. */
  color?: string | RgbaPayload;
  /** Optional stable id for the spawned mesh GameObject name. */
  id?: string;
  position?: Vec3Payload;
  /** Optional scale (uniform or per-axis). */
  scale?: number | Vec3Payload;
}

/**
 * Payload for `spawn_from_spec` — same as apply_mesh, or `{ spec: ApplyMeshPayload }`.
 * Alias for industrial pipeline wiring; Unity treats both as MeshFilter path.
 */
export interface SpawnFromSpecPayload extends ApplyMeshPayload {
  spec?: ApplyMeshPayload;
}

/**
 * Payload for `load_glb` — same-origin or http(s) GLB/glTF URL.
 * Unity fetches via glTFast (UnityWebRequest) and parents under ConKayTemp.
 * Not evo-asset.generate→world auto-wire; caller supplies URL.
 */
export interface LoadGlbPayload {
  url: string;
  position?: Vec3Payload;
  /** Uniform number or per-axis vec. */
  scale?: number | Vec3Payload;
  /** Optional GameObject name hint. */
  name?: string;
}


/**
 * Payload for `set_transform` — move/scale/rotate an existing ConKayTemp child by id/name.
 */
export interface SetTransformPayload {
  id?: string;
  name?: string;
  position?: Vec3Payload;
  scale?: number | Vec3Payload;
  rotation?: Vec3Payload;
}

export interface ConcordiaCmdMessage {
  type: typeof CONCORDIA_CMD;
  cmd: ConcordiaCmdName;
  payload?: Record<string, unknown>;
  /** Correlation id for optional ack matching. */
  id?: string;
  ts: number;
}

export interface ConcordiaEventMessage {
  type: typeof CONCORDIA_EVENT;
  event: ConcordiaEventName;
  payload?: Record<string, unknown>;
  id?: string;
  ts?: number;
}

export function isConcordiaEventMessage(data: unknown): data is ConcordiaEventMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.type === CONCORDIA_EVENT && typeof d.event === 'string';
}

/** Find the live Unity WebGL iframe, or null if not mounted. */
export function getUnityIframe(): HTMLIFrameElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(UNITY_IFRAME_ID);
  return el instanceof HTMLIFrameElement ? el : null;
}

export function unityIframePresent(): boolean {
  return getUnityIframe() != null;
}

/**
 * Post a typed command into the Unity WebGL iframe.
 * Returns true if postMessage was attempted; false if iframe missing.
 * Does NOT claim Unity handled it until a matching concordia:event arrives.
 */
export function postUnityCmd(
  cmd: ConcordiaCmdName,
  payload?: Record<string, unknown>,
  id?: string,
): boolean {
  const iframe = getUnityIframe();
  const win = iframe?.contentWindow;
  if (!win) return false;
  const msg: ConcordiaCmdMessage = {
    type: CONCORDIA_CMD,
    cmd,
    payload: payload ?? {},
    id,
    ts: Date.now(),
  };
  try {
    // Same-origin static build under /concordia-webgl — '*' is fine for stub;
    // tighten to location.origin when a cross-origin host is used.
    win.postMessage(msg, typeof window !== 'undefined' ? window.location.origin : '*');
    return true;
  } catch {
    return false;
  }
}

/** Drop a F0 cube/sphere marker under Unity's ConKayTemp root. */
export function spawnPrimitive(
  payload: SpawnPrimitivePayload,
  id?: string,
): boolean {
  return postUnityCmd('spawn_primitive', payload as unknown as Record<string, unknown>, id);
}

/** Recolor last (or all) ConKayTemp primitives. */
export function setPrimitiveColor(
  payload: SetColorPayload,
  id?: string,
): boolean {
  return postUnityCmd('set_color', payload as unknown as Record<string, unknown>, id);
}

/** Destroy the ConKayTemp root and all spawned markers. */
export function clearTempPrimitives(id?: string): boolean {
  return postUnityCmd('clear_temp', {}, id);
}

/**
 * Push a triangle mesh into Unity WebGL MeshFilter under ConKayTemp.
 * Returns true if postMessage was attempted — wait for `mesh_applied` event.
 */
export function applyMesh(payload: ApplyMeshPayload, id?: string): boolean {
  return postUnityCmd('apply_mesh', payload as unknown as Record<string, unknown>, id);
}

/**
 * Alias path: spawn_from_spec → same MeshFilter apply as apply_mesh.
 * Accepts flat ApplyMeshPayload or `{ spec: { positions, indices, … } }`.
 */
export function spawnFromSpec(payload: SpawnFromSpecPayload, id?: string): boolean {
  const flat: ApplyMeshPayload =
    payload.spec && Array.isArray(payload.spec.positions)
      ? {
          positions: payload.spec.positions,
          indices: payload.spec.indices ?? [],
          color: payload.spec.color ?? payload.color,
          id: payload.spec.id ?? payload.id,
          position: payload.spec.position ?? payload.position,
          scale: payload.spec.scale ?? payload.scale,
        }
      : payload;
  return postUnityCmd('spawn_from_spec', flat as unknown as Record<string, unknown>, id);
}

/**
 * Ask Unity WebGL to fetch+instantiate a GLB/glTF URL under ConKayTemp.
 * Returns true if postMessage was attempted — wait for `glb_loaded` (or `error`).
 */
export function loadGlb(payload: LoadGlbPayload, id?: string): boolean {
  if (!payload?.url || typeof payload.url !== 'string') return false;
  return postUnityCmd('load_glb', payload as unknown as Record<string, unknown>, id);
}

/**
 * Subscribe to `concordia:event` messages from the Unity iframe (or any
 * same-origin child). Returns an unsubscribe function. No-op safe on SSR.
 */

/**
 * Set transform on an existing named mesh/GLB under ConKayTemp.
 * Returns true if postMessage attempted — wait for `transform_set` (or `error`).
 */
export function setTransform(payload: SetTransformPayload, id?: string): boolean {
  if (!payload?.id && !payload?.name) return false;
  return postUnityCmd('set_transform', payload as unknown as Record<string, unknown>, id);
}

export function onUnityEvent(
  handler: (msg: ConcordiaEventMessage, raw: MessageEvent) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const onMessage = (ev: MessageEvent) => {
    // Only accept same-origin (or null source from about:blank during load).
    if (ev.origin && ev.origin !== window.location.origin) return;
    if (!isConcordiaEventMessage(ev.data)) return;
    handler(ev.data, ev);
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
