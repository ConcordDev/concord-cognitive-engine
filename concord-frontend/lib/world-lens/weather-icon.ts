import type { WeatherIcon } from '@/components/world-lens/HUDOverlay';

/**
 * Maps the server's `weather:update` socket payload type (the full
 * WeatherType union in lib/world-lens/world-deformation.ts — clear /
 * overcast / rain / heavy_rain / storm / snow / blizzard / fog /
 * sandstorm) onto HUDOverlay's narrower display-icon set. Mirrors the
 * inline mapping already used for SkyWeatherRenderer's `weather` prop at
 * the ConcordiaScene mount in app/lenses/world/page.tsx, adapted for
 * HUDOverlay's 5-icon set (no separate fog/overcast/storm icons there).
 */
export function weatherTypeToIcon(serverType: string | undefined): WeatherIcon {
  switch (serverType) {
    case 'clear': return 'clear';
    case 'overcast':
    case 'fog':
    case 'sandstorm': return 'cloudy';
    case 'rain':
    case 'heavy_rain':
    case 'storm': return 'rain';
    case 'snow':
    case 'blizzard': return 'snow';
    default: return 'clear';
  }
}
