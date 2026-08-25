import { useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { pruneImpacts } from "@/game/feel";
import type { Sim } from "@/game/sim";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function ImpactFx({ simRef }: { simRef: MutableRefObject<Sim> }) {
  const hot = useRef<THREE.InstancedMesh>(null);
  const dust = useRef<THREE.InstancedMesh>(null);

  useFrame(() => {
    const sim = simRef.current;
    pruneImpacts(sim.impacts, sim.now);
    const h = hot.current;
    const d = dust.current;
    if (!h || !d) return;
    let hi = 0;
    let di = 0;
    for (const im of sim.impacts) {
      const t = Math.min(1, (sim.now - im.born) / im.life);
      const lift = (1 - t) * 0.55 * im.mag;
      _p.set(im.x + im.dx * t * 1.6, im.y + lift, im.z + im.dz * t * 1.6);
      _s.setScalar(im.mag * (1 - t) * (im.hot ? 0.16 : 0.22));
      _q.identity();
      _m.compose(_p, _q, _s);
      if (im.hot && hi < h.count) {
        h.setMatrixAt(hi, _m);
        hi += 1;
      } else if (!im.hot && di < d.count) {
        d.setMatrixAt(di, _m);
        di += 1;
      }
    }
    h.count = Math.max(hi, 1);
    d.count = Math.max(di, 1);
    h.instanceMatrix.needsUpdate = true;
    d.instanceMatrix.needsUpdate = true;
    h.visible = hi > 0;
    d.visible = di > 0;
  });

  return (
    <group>
      <instancedMesh ref={hot} args={[undefined, undefined, 48]} frustumCulled={false}>
        <octahedronGeometry args={[0.5, 0]} />
        <meshBasicMaterial color="#ffe8b0" transparent opacity={0.9} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={dust} args={[undefined, undefined, 32]} frustumCulled={false}>
        <sphereGeometry args={[0.5, 6, 5]} />
        <meshBasicMaterial color="#c8b090" transparent opacity={0.45} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
