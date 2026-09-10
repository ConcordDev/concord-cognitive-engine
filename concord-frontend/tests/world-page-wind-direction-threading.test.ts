// Fix 3 follow-on (verification audit, 2026-07-05) — real wind direction
// threading in the world lens.
//
// `components/world/WorldOsSurface.tsx` mounted SkyWeatherRenderer, FactionBanners, and
// InstancedGrass with `windDirection={0}` hardcoded at every site instead of
// reading live wind data from the server's `world:weather` event
// (server/lib/weather.js), even though the page already had a `weatherData`
// state slice fed by an unrelated ticker (`weather:update`). Fixed by adding
// a dedicated `windDirection` state fed by a new `world:weather` socket
// handler (matching the page's existing `worldSocket.on(...)`/`.off(...)`
// pattern), threaded into all three mount sites.
//
// The page is too large (5000+ lines) to render in a unit test — this file
// follows the same source-pin convention already used for this page
// elsewhere (see tests/power-clusters-layer.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx'), 'utf8');

describe('world lens page — real windDirection threading', () => {
  it('declares a windDirection state slice, distinct from the unrelated weather:update-fed weatherData', () => {
    expect(src).toMatch(/const \[windDirection, setWindDirection\] = useState\(0\)/);
  });

  it('registers + cleans up a world:weather socket handler that updates windDirection', () => {
    expect(src).toMatch(/handleWorldWeather/);
    expect(src).toMatch(/worldSocket\.on\('world:weather', handleWorldWeather\)/);
    expect(src).toMatch(/worldSocket\.off\('world:weather', handleWorldWeather\)/);
    expect(src).toMatch(/setWindDirection\(data\.windDirection\)/);
  });

  it('no longer hardcodes windDirection={0} at any JSX mount site', () => {
    expect(src).not.toMatch(/windDirection=\{0\}/);
  });

  it('threads the live windDirection state into SkyWeatherRenderer, FactionBanners, and InstancedGrass', () => {
    const skySlice = src.slice(src.indexOf('<SkyWeatherRenderer'), src.indexOf('<SkyWeatherRenderer') + 700);
    expect(skySlice).toMatch(/windDirection=\{windDirection\}/);

    const bannersSlice = src.slice(src.indexOf('<FactionBanners'), src.indexOf('<FactionBanners') + 300);
    expect(bannersSlice).toMatch(/windDirection=\{windDirection\}/);

    const grassSlice = src.slice(src.indexOf('<InstancedGrass'), src.indexOf('<InstancedGrass') + 300);
    expect(grassSlice).toMatch(/windDirection=\{windDirection\}/);
  });
});
