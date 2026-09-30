import type { Theme } from "./content";

export type SunState = {
  position: [number, number, number];
  color: string;
  intensity: number;
  exposure: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  day: number;
  night: boolean;
  dusk: boolean;
  hemi: number;
  ambient: number;
  env: number;
  elev: number;
};

export function sunFromHour(hour: number, theme: Theme): SunState {
  const elevAng = ((hour - 6) / 12) * Math.PI;
  const elev = Math.sin(elevAng);
  const day = Math.max(0, elev);
  const az = ((hour - 6) / 24) * Math.PI * 2;
  const dist = 90;
  const y = Math.max(6, elev * 72);
  const position: [number, number, number] = [Math.cos(az) * dist, y, Math.sin(az) * dist];
  const dusk = day < 0.24 && day > 0;
  const night = elev < 0;
  let color = theme.sun;
  if (dusk) color = hour < 12 ? "#ffb070" : "#ff7040";
  if (night) color = "#9ab4d8";
  const intensity = night ? 0.2 : 0.85 + day * 1.55;
  const exposure = night ? 0.7 : dusk ? 0.88 : 1.0;
  const turbidity = night ? 2 : dusk ? 11 : theme.style === "ruins" ? 7.5 : 4.2;
  const rayleigh = night ? 0.12 : dusk ? 2.4 : 0.7;
  const mieCoefficient = dusk ? 0.012 : theme.style === "ruins" ? 0.007 : 0.0045;
  const hemi = night ? 0.18 : 0.32 + day * 0.22;
  const ambient = night ? 0.06 : 0.1 + day * 0.06;
  const env = night ? 0.26 : 0.52 + day * 0.22;
  return {
    position,
    color,
    intensity,
    exposure,
    turbidity,
    rayleigh,
    mieCoefficient,
    mieDirectionalG: dusk ? 0.92 : 0.8,
    day,
    night,
    dusk,
    hemi,
    ambient,
    env,
    elev,
  };
}

export function fogDensity(weather: string, style: Theme["style"], night: boolean) {
  let d = style === "neon" || style === "noir" ? 0.011 : 0.0052;
  if (weather === "ash" || weather === "dust") d += 0.0016;
  if (weather === "rain") d += 0.0022;
  if (weather === "grove") d += 0.001;
  if (night) d += 0.0024;
  return d;
}

export function usesPhysicalSky(style: Theme["style"]) {
  return style !== "neon" && style !== "noir";
}
