import { Children, cloneElement, isValidElement, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";

const cache = new Map<string, THREE.CanvasTexture>();

export function toonRamp(shadow: string, mid: string, hi: string) {
  const key = `${shadow}${mid}${hi}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 1;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, 4, 0);
  grd.addColorStop(0, shadow);
  grd.addColorStop(0.45, mid);
  grd.addColorStop(1, hi);
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

const HUB_RAMP = () => toonRamp("#2a1e14", "#8a6e48", "#f2e2b8");

function cloneKids(children: React.ReactNode, keyPrefix: string) {
  return Children.map(children, (child, i) => {
    if (!isValidElement(child)) return child;
    return cloneElement(child, { key: `${keyPrefix}${i}` });
  });
}

export function ToonMesh({
  color,
  outline = true,
  children,
  castShadow = true,
  receiveShadow = true,
  scale,
  position,
  rotation,
  userData,
}: {
  color: string;
  outline?: boolean;
  children: React.ReactNode;
  castShadow?: boolean;
  receiveShadow?: boolean;
  scale?: number | [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  userData?: Record<string, unknown>;
}) {
  const ramp = useMemo(() => HUB_RAMP(), []);
  return (
    <group position={position} rotation={rotation} scale={scale} userData={userData}>
      <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
        {cloneKids(children, "m")}
        <meshToonMaterial color={color} gradientMap={ramp} />
      </mesh>
      {outline ? (
        <mesh scale={1.045} frustumCulled={false}>
          {cloneKids(children, "o")}
          <meshBasicMaterial color="#1a140c" side={THREE.BackSide} />
        </mesh>
      ) : null}
    </group>
  );
}

export function useSharedGeo() {
  return useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const sphere = new THREE.SphereGeometry(0.5, 16, 12);
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    const cone = new THREE.ConeGeometry(0.5, 1, 8);
    const cap = new THREE.CapsuleGeometry(0.28, 0.85, 4, 8);
    return { box, sphere, cyl, cone, cap };
  }, []);
}

export function disposeGeo(g: {
  box: THREE.BufferGeometry;
  sphere: THREE.BufferGeometry;
  cyl: THREE.BufferGeometry;
  cone: THREE.BufferGeometry;
  cap: THREE.BufferGeometry;
}) {
  g.box.dispose();
  g.sphere.dispose();
  g.cyl.dispose();
  g.cone.dispose();
  g.cap.dispose();
}

export function useDisposeGeo(geo: ReturnType<typeof useSharedGeo>) {
  useLayoutEffect(() => () => disposeGeo(geo), [geo]);
}
