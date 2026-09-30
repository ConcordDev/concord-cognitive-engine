export type Quality = "low" | "medium" | "high" | "ultra";

export function qualityOpts(q: Quality) {
  if (q === "low") {
    return {
      dpr: [1, 1] as [number, number],
      shadows: false,
      map: 512,
      terrainSeg: 48,
      far: 520,
      soft: false,
      contact: false,
      envRes: 64,
      clouds: 4,
    };
  }
  if (q === "medium") {
    return {
      dpr: [1, 1.35] as [number, number],
      shadows: true,
      map: 1024,
      terrainSeg: 72,
      far: 900,
      soft: false,
      contact: true,
      envRes: 128,
      clouds: 6,
    };
  }
  if (q === "ultra") {
    return {
      dpr: [1, 2] as [number, number],
      shadows: true,
      map: 2048,
      terrainSeg: 128,
      far: 1400,
      soft: true,
      contact: true,
      envRes: 256,
      clouds: 10,
    };
  }
  return {
    dpr: [1, 1.75] as [number, number],
    shadows: true,
    map: 2048,
    terrainSeg: 96,
    far: 1200,
    soft: true,
    contact: true,
    envRes: 256,
    clouds: 8,
  };
}
