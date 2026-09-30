import { Children, cloneElement, isValidElement } from "react";
import * as THREE from "three";

function cloneKids(children: React.ReactNode, keyPrefix: string) {
  return Children.map(children, (child, i) => {
    if (!isValidElement(child)) return child;
    return cloneElement(child, { key: `${keyPrefix}${i}` });
  });
}

export type Surface = "default" | "skin" | "cloth" | "stone" | "metal" | "foliage";

export function LitMesh({
  color,
  roughness,
  metalness,
  emissive,
  emissiveIntensity = 0,
  map,
  normalMap,
  roughnessMap,
  surface = "default",
  children,
  castShadow = true,
  receiveShadow = true,
  scale,
  position,
  rotation,
}: {
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  surface?: Surface;
  children: React.ReactNode;
  castShadow?: boolean;
  receiveShadow?: boolean;
  scale?: number | [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const rich = surface === "skin" || surface === "cloth" || surface === "metal";
  const r = roughness ?? (surface === "metal" ? 0.32 : surface === "skin" ? 0.5 : surface === "cloth" ? 0.8 : surface === "stone" ? 0.9 : 0.74);
  const m = metalness ?? (surface === "metal" ? 0.82 : 0.05);
  return (
    <mesh
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      position={position}
      rotation={rotation}
      scale={scale}
    >
      {cloneKids(children, "l")}
      {rich ? (
        <meshPhysicalMaterial
          color={color}
          map={map}
          normalMap={normalMap}
          roughnessMap={roughnessMap}
          roughness={r}
          metalness={m}
          emissive={emissive ?? "#000000"}
          emissiveIntensity={emissiveIntensity}
          envMapIntensity={surface === "metal" ? 1.1 : 0.65}
          sheen={surface === "skin" ? 0.55 : surface === "cloth" ? 0.32 : 0}
          sheenColor={surface === "skin" ? "#c98860" : "#ffffff"}
          sheenRoughness={surface === "skin" ? 0.52 : 0.78}
          clearcoat={surface === "metal" ? 0.22 : surface === "skin" ? 0.06 : 0}
          clearcoatRoughness={surface === "metal" ? 0.28 : 0.7}
        />
      ) : (
        <meshStandardMaterial
          color={color}
          map={map}
          normalMap={normalMap}
          roughnessMap={roughnessMap}
          roughness={r}
          metalness={m}
          emissive={emissive ?? "#000000"}
          emissiveIntensity={emissiveIntensity}
          envMapIntensity={0.55}
        />
      )}
    </mesh>
  );
}

export function sunShadow(map: number, spread = 90) {
  return {
    "shadow-mapSize-width": map,
    "shadow-mapSize-height": map,
    "shadow-camera-far": 220,
    "shadow-camera-left": -spread,
    "shadow-camera-right": spread,
    "shadow-camera-top": spread,
    "shadow-camera-bottom": -spread,
    "shadow-bias": -0.00025,
  };
}
