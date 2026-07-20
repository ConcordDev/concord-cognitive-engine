import { describe, it, expect } from 'vitest';
import { weatherTypeToIcon } from '@/lib/world-lens/weather-icon';

describe('weatherTypeToIcon', () => {
  it('maps direct matches straight through', () => {
    expect(weatherTypeToIcon('clear')).toBe('clear');
    expect(weatherTypeToIcon('rain')).toBe('rain');
    expect(weatherTypeToIcon('snow')).toBe('snow');
  });

  it('folds the extended server weather types onto the closest HUD icon', () => {
    expect(weatherTypeToIcon('overcast')).toBe('cloudy');
    expect(weatherTypeToIcon('fog')).toBe('cloudy');
    expect(weatherTypeToIcon('sandstorm')).toBe('cloudy');
    expect(weatherTypeToIcon('heavy_rain')).toBe('rain');
    expect(weatherTypeToIcon('storm')).toBe('rain');
    expect(weatherTypeToIcon('blizzard')).toBe('snow');
  });

  it('defaults to clear for unknown or absent server types, never throws', () => {
    expect(weatherTypeToIcon(undefined)).toBe('clear');
    expect(weatherTypeToIcon('some-future-server-type')).toBe('clear');
  });
});
