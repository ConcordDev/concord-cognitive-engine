'use client';

/**
 * SandboxArena3D — a real Three.js rendered combat arena for the sandbox
 * lens. A checkered floor, a player marker, and one capsule per training
 * dummy with a floating HP bar. Clicking a dummy raycasts and fires the
 * corresponding attack. The render loop honours a `timeScale` so the parent
 * can drop the scene into slow-motion for hit-reaction inspection.
 *
 * This replaces the historical 2D button grid — the [M] "3D rendered scene"
 * backlog item. It is self-contained (no world simulation) so combat-feel is
 * tuned in isolation, exactly like the lens was designed for.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export interface ArenaDummy {
  id: string;
  hp: number;
  maxHp: number;
}

export function SandboxArena3D({
  dummies,
  timeScale,
  flashId,
  onHitDummy,
}: {
  dummies: ArenaDummy[];
  timeScale: number;
  flashId: string | null;
  onHitDummy: (id: string, heavy: boolean) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const dummiesRef = useRef(dummies);
  const timeScaleRef = useRef(timeScale);
  const onHitRef = useRef(onHitDummy);

  // Per-dummy Three objects, keyed by dummy id.
  const groupsRef = useRef<
    Map<string, { group: THREE.Group; body: THREE.Mesh; bar: THREE.Mesh; barBg: THREE.Mesh; flashUntil: number }>
  >(new Map());

  dummiesRef.current = dummies;
  timeScaleRef.current = timeScale;
  onHitRef.current = onHitDummy;

  // Boot the scene once.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    // Stable Map identity — alias once so the cleanup closure does not read
    // through the ref (which the exhaustive-deps lint flags).
    const groups = groupsRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0f172a');
    scene.fog = new THREE.Fog('#0f172a', 18, 48);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    camera.position.set(0, 9, 13);
    camera.lookAt(0, 1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // Lighting.
    scene.add(new THREE.AmbientLight('#cbd5e1', 0.55));
    const key = new THREE.DirectionalLight('#fef3c7', 1.1);
    key.position.set(6, 14, 8);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#60a5fa', 0.4);
    rim.position.set(-8, 6, -10);
    scene.add(rim);

    // Checkered floor.
    const floorGeo = new THREE.PlaneGeometry(40, 40, 20, 20);
    const floorMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(40, 20, '#475569', '#334155');
    scene.add(grid);

    // Player marker (a small pillar at the arena origin).
    const playerGeo = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
    const playerMat = new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: '#0ea5e9', emissiveIntensity: 0.3 });
    const player = new THREE.Mesh(playerGeo, playerMat);
    player.position.set(0, 0.9, 4.5);
    scene.add(player);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handleResize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    handleResize();
    const ro = new ResizeObserver(handleResize);
    ro.observe(mount);

    const pickDummy = (clientX: number, clientY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const bodies = [...groups.entries()].map(([id, g]) => {
        g.body.userData.dummyId = id;
        return g.body;
      });
      const hits = raycaster.intersectObjects(bodies, false);
      return hits.length ? (hits[0].object.userData.dummyId as string) : null;
    };

    const onClick = (e: MouseEvent) => {
      const id = pickDummy(e.clientX, e.clientY);
      if (id) onHitRef.current(id, false);
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const id = pickDummy(e.clientX, e.clientY);
      if (id) onHitRef.current(id, true);
    };
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('contextmenu', onContext);

    let raf = 0;
    let last = performance.now();
    const animate = () => {
      const nowMs = performance.now();
      const dt = ((nowMs - last) / 1000) * timeScaleRef.current;
      last = nowMs;

      // Sync dummy meshes to the current dummy list.
      const live = new Set(dummiesRef.current.map((d) => d.id));
      const map = groups;
      // Remove stale.
      for (const [id, g] of map) {
        if (!live.has(id)) {
          scene.remove(g.group);
          map.delete(id);
        }
      }
      // Add / update.
      dummiesRef.current.forEach((d, i) => {
        let g = map.get(d.id);
        if (!g) {
          const group = new THREE.Group();
          const bodyGeo = new THREE.CapsuleGeometry(0.55, 1.5, 6, 12);
          const bodyMat = new THREE.MeshStandardMaterial({ color: '#fcd34d', roughness: 0.6 });
          const body = new THREE.Mesh(bodyGeo, bodyMat);
          body.position.y = 1.3;
          group.add(body);
          // HP bar (background + fill) billboarded above the dummy.
          const barBg = new THREE.Mesh(
            new THREE.PlaneGeometry(1.2, 0.16),
            new THREE.MeshBasicMaterial({ color: '#1e293b' }),
          );
          barBg.position.y = 3.0;
          group.add(barBg);
          const bar = new THREE.Mesh(
            new THREE.PlaneGeometry(1.2, 0.16),
            new THREE.MeshBasicMaterial({ color: '#34d399' }),
          );
          bar.position.set(0, 3.0, 0.01);
          group.add(bar);
          scene.add(group);
          g = { group, body, bar, barBg, flashUntil: 0 };
          map.set(d.id, g);
        }
        // Lay the dummies out in an arc facing the player.
        const n = dummiesRef.current.length;
        const spread = Math.min(3.2, 1.4);
        const angle = n > 1 ? (i / (n - 1) - 0.5) * Math.min(Math.PI * 0.7, n * 0.5) : 0;
        const radius = 6 + (n > 5 ? 1.5 : 0);
        g.group.position.set(Math.sin(angle) * radius * spread * 0.4 * (n > 1 ? 1 : 0), 0, -Math.cos(angle) * radius + 1);
        if (n === 1) g.group.position.set(0, 0, -5);

        const pct = Math.max(0, d.maxHp > 0 ? d.hp / d.maxHp : 0);
        const dead = d.hp <= 0;
        g.bar.scale.x = pct;
        g.bar.position.x = -(1 - pct) * 0.6;
        (g.bar.material as THREE.MeshBasicMaterial).color.set(
          pct > 0.5 ? '#34d399' : pct > 0.2 ? '#fbbf24' : '#f87171',
        );
        const bodyMat = g.body.material as THREE.MeshStandardMaterial;
        if (g.flashUntil > nowMs) {
          bodyMat.emissive.set('#f87171');
          bodyMat.emissiveIntensity = 0.9;
        } else {
          bodyMat.emissive.set('#000000');
          bodyMat.emissiveIntensity = 0;
        }
        bodyMat.color.set(dead ? '#475569' : '#fcd34d');
        g.body.rotation.y += dt * (dead ? 0 : 0.2);
        // Billboard the HP bars toward the camera.
        g.bar.quaternion.copy(camera.quaternion);
        g.barBg.quaternion.copy(camera.quaternion);
        g.barBg.visible = !dead;
        g.bar.visible = !dead;
      });

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('contextmenu', onContext);
      renderer.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      playerGeo.dispose();
      playerMat.dispose();
      for (const g of groups.values()) {
        g.group.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
          }
        });
      }
      groups.clear();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  // Flash a dummy red when it is hit.
  useEffect(() => {
    if (!flashId) return;
    const g = groupsRef.current.get(flashId);
    if (g) g.flashUntil = performance.now() + 160;
  }, [flashId]);

  return <div ref={mountRef} className="absolute inset-0 h-full w-full" />;
}
