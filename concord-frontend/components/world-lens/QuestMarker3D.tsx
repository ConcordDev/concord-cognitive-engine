'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

/* ── Types ──────────────────────────────────────────────────────── */

export type MarkerType = 'target' | 'delivery' | 'talk' | 'build' | 'reach';

export interface QuestObjective {
  id:       string;
  label:    string;
  position: { x: number; y: number; z: number };
  type:     MarkerType;
  done?:    boolean;
}

export interface QuestMarker3DAPI {
  addObjective:    (obj: QuestObjective) => void;
  removeObjective: (id: string) => void;
  clearAll:        () => void;
}

interface QuestMarker3DProps {
  objectives?: QuestObjective[];
  /** The canvas container element — markers are overlaid via absolute positioning */
  containerEl?: HTMLElement | null;
}

/* ── Icon + color per marker type ───────────────────────────────── */

const MARKER_META: Record<MarkerType, { icon: string; color: string }> = {
  target:   { icon: '◎', color: '#f59e0b' },
  delivery: { icon: '📦', color: '#60a5fa' },
  talk:     { icon: '💬', color: '#34d399' },
  build:    { icon: '🔨', color: '#a78bfa' },
  reach:    { icon: '⭐', color: '#f472b6' },
};

/* ── CSS2DRenderer + CSS2DObject (lazy import) ───────────────────── */

type CSS2DRendererType = {
  domElement: HTMLElement;
  setSize: (w: number, h: number) => void;
  render: (scene: unknown, camera: unknown) => void;
};
type CSS2DObjectType = { position: { set: (x: number, y: number, z: number) => void }; element: HTMLElement };

/* ── Component ──────────────────────────────────────────────────── */

const QuestMarker3D = forwardRef<QuestMarker3DAPI, QuestMarker3DProps>(function QuestMarker3D(
  { objectives = [], containerEl },
  ref,
) {
  const css2dRendererRef = useRef<CSS2DRendererType | null>(null);
  const markersRef       = useRef<Map<string, CSS2DObjectType>>(new Map());
  const sceneRef         = useRef<unknown>(null);
  const cameraRef        = useRef<unknown>(null);
  const animFrameRef     = useRef<number>(0);

  /* ── Listen for scene/camera from ConcordiaScene ──────────────── */
  useEffect(() => {
    function onSceneReady(e: Event) {
      const { scene, camera } = (e as CustomEvent).detail ?? {};
      sceneRef.current  = scene;
      cameraRef.current = camera;
    }
    window.addEventListener('concordia:scene-ready', onSceneReady);
    // This layer mounts only once quest objectives exist — i.e. AFTER the
    // scene's one-shot scene-ready already fired. Without this ping we'd miss
    // it and sceneRef would stay null (markers never render). ConcordiaScene's
    // onSceneRequest responder re-emits scene-ready with {scene,camera}.
    window.dispatchEvent(new CustomEvent('concordia:scene-request-ready'));
    return () => window.removeEventListener('concordia:scene-ready', onSceneReady);
  }, []);

  /* ── Init CSS2DRenderer ────────────────────────────────────────── */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!containerEl) return;

    let disposed = false;

    async function init() {
      const { CSS2DRenderer } = await import(
        'three/examples/jsm/renderers/CSS2DRenderer.js' as string
      );
      if (disposed) return;

      const renderer = new CSS2DRenderer() as unknown as CSS2DRendererType;
      renderer.setSize(containerEl!.clientWidth, containerEl!.clientHeight);
      const el = renderer.domElement;
      el.style.position = 'absolute';
      el.style.top      = '0';
      el.style.left     = '0';
      el.style.pointerEvents = 'none';
      containerEl!.appendChild(el);
      css2dRendererRef.current = renderer;

      // Resize observer
      const ro = new ResizeObserver(() => {
        renderer.setSize(containerEl!.clientWidth, containerEl!.clientHeight);
      });
      ro.observe(containerEl!);

      // Render loop — piggybacks on the scene animation
      function loop() {
        if (disposed) return;
        if (css2dRendererRef.current && sceneRef.current && cameraRef.current) {
          css2dRendererRef.current.render(sceneRef.current, cameraRef.current);
        }
        animFrameRef.current = requestAnimationFrame(loop);
      }
      animFrameRef.current = requestAnimationFrame(loop);

      return () => ro.disconnect();
    }

    init();
    return () => {
      disposed = true;
      cancelAnimationFrame(animFrameRef.current);
      css2dRendererRef.current?.domElement.remove();
      css2dRendererRef.current = null;
    };
  }, [containerEl]);

  /* ── Sync objectives list → CSS2DObjects in scene ─────────────── */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    async function syncMarkers() {
      const { CSS2DObject } = await import(
        'three/examples/jsm/renderers/CSS2DRenderer.js' as string
      );
      const scene = sceneRef.current as { add: (o: unknown) => void; remove: (o: unknown) => void } | null;
      if (!scene) return;

      const seen = new Set<string>();

      for (const obj of objectives) {
        seen.add(obj.id);
        if (markersRef.current.has(obj.id)) {
          // Update position if already present
          const existing = markersRef.current.get(obj.id)!;
          existing.position.set(obj.position.x, obj.position.y + 3, obj.position.z);
          // Update done state
          const label = existing.element.querySelector('[data-done]') as HTMLElement | null;
          if (label) label.dataset.done = obj.done ? 'true' : 'false';
          continue;
        }

        // Create DOM label
        const meta = MARKER_META[obj.type] ?? MARKER_META.target;
        const div  = document.createElement('div');
        div.style.cssText = [
          'display:flex', 'flex-direction:column', 'align-items:center',
          'pointer-events:none', 'user-select:none',
        ].join(';');

        const ring = document.createElement('div');
        ring.style.cssText = [
          `width:28px`, `height:28px`, `border-radius:50%`,
          `border:2px solid ${meta.color}`,
          `background:${meta.color}22`,
          `display:flex`, `align-items:center`, `justify-content:center`,
          `font-size:14px`,
          `animation:concordia-marker-pulse 1.8s ease-in-out infinite`,
          obj.done ? 'opacity:0.4' : '',
        ].join(';');
        ring.textContent = obj.done ? '✓' : meta.icon;
        ring.dataset.done = obj.done ? 'true' : 'false';

        const text = document.createElement('div');
        text.style.cssText = [
          `font-size:10px`, `color:${meta.color}`,
          `background:rgba(0,0,0,0.6)`, `padding:1px 5px`,
          `border-radius:4px`, `margin-top:2px`,
          `white-space:nowrap`, `font-weight:600`,
        ].join(';');
        text.textContent = obj.label;

        div.appendChild(ring);
        div.appendChild(text);

        // Inject keyframe once
        if (!document.getElementById('concordia-marker-style')) {
          const style = document.createElement('style');
          style.id = 'concordia-marker-style';
          style.textContent = `@keyframes concordia-marker-pulse {
            0%,100%{transform:scale(1);opacity:1}
            50%{transform:scale(1.15);opacity:0.8}
          }`;
          document.head.appendChild(style);
        }

        const css2dObj = new CSS2DObject(div) as unknown as CSS2DObjectType;
        css2dObj.position.set(obj.position.x, obj.position.y + 3, obj.position.z);
        scene.add(css2dObj);
        markersRef.current.set(obj.id, css2dObj);
      }

      // Remove stale markers
      for (const [id, css2dObj] of markersRef.current) {
        if (!seen.has(id)) {
          scene.remove(css2dObj);
          markersRef.current.delete(id);
        }
      }
    }

    syncMarkers();
  }, [objectives]);

  /* ── Imperative API ────────────────────────────────────────────── */
  useImperativeHandle(ref, () => ({
    addObjective(obj: QuestObjective) {
      // Trigger re-render by dispatching a custom event; parent manages objectives array
      window.dispatchEvent(new CustomEvent('concordia:quest-marker-add', { detail: obj }));
    },
    removeObjective(id: string) {
      window.dispatchEvent(new CustomEvent('concordia:quest-marker-remove', { detail: { id } }));
    },
    clearAll() {
      window.dispatchEvent(new CustomEvent('concordia:quest-marker-clear'));
    },
  }), []);

  return null; // renders into Three.js scene overlay, not React DOM
});

export default QuestMarker3D;
