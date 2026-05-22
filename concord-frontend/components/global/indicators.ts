// Shared World Bank indicator + country catalogs for the global data explorer.
// These are UI selection lists only — all values are fetched live.

export interface IndicatorOption {
  code: string;
  label: string;
  /** higher value is "better" for ramp orientation hints */
  higherIsBetter?: boolean;
}

export const INDICATORS: IndicatorOption[] = [
  { code: 'NY.GDP.MKTP.CD', label: 'GDP (current US$)', higherIsBetter: true },
  { code: 'NY.GDP.PCAP.CD', label: 'GDP per capita (US$)', higherIsBetter: true },
  { code: 'SP.POP.TOTL', label: 'Population, total', higherIsBetter: true },
  { code: 'SP.DYN.LE00.IN', label: 'Life expectancy at birth (years)', higherIsBetter: true },
  { code: 'SE.ADT.LITR.ZS', label: 'Literacy rate, adult (%)', higherIsBetter: true },
  { code: 'IT.NET.USER.ZS', label: 'Internet users (% of population)', higherIsBetter: true },
  { code: 'SL.UEM.TOTL.ZS', label: 'Unemployment (% of labor force)', higherIsBetter: false },
  { code: 'FP.CPI.TOTL.ZG', label: 'Inflation, consumer prices (%)', higherIsBetter: false },
  { code: 'SP.URB.TOTL.IN.ZS', label: 'Urban population (% of total)', higherIsBetter: true },
  { code: 'EN.ATM.CO2E.PC', label: 'CO2 emissions (metric tons per capita)', higherIsBetter: false },
  { code: 'SP.DYN.IMRT.IN', label: 'Mortality rate, infant (per 1,000)', higherIsBetter: false },
  { code: 'SH.XPD.CHEX.GD.ZS', label: 'Health expenditure (% of GDP)', higherIsBetter: true },
];

export interface CountryOption {
  code: string; // ISO3
  name: string;
}

export const COUNTRIES: CountryOption[] = [
  { code: 'USA', name: 'United States' }, { code: 'CHN', name: 'China' },
  { code: 'IND', name: 'India' }, { code: 'BRA', name: 'Brazil' },
  { code: 'RUS', name: 'Russian Federation' }, { code: 'JPN', name: 'Japan' },
  { code: 'DEU', name: 'Germany' }, { code: 'GBR', name: 'United Kingdom' },
  { code: 'FRA', name: 'France' }, { code: 'CAN', name: 'Canada' },
  { code: 'AUS', name: 'Australia' }, { code: 'ITA', name: 'Italy' },
  { code: 'ESP', name: 'Spain' }, { code: 'MEX', name: 'Mexico' },
  { code: 'KOR', name: 'Korea, Rep.' }, { code: 'IDN', name: 'Indonesia' },
  { code: 'NGA', name: 'Nigeria' }, { code: 'ZAF', name: 'South Africa' },
  { code: 'EGY', name: 'Egypt' }, { code: 'TUR', name: 'Turkey' },
  { code: 'ARG', name: 'Argentina' }, { code: 'SAU', name: 'Saudi Arabia' },
  { code: 'POL', name: 'Poland' }, { code: 'SWE', name: 'Sweden' },
  { code: 'NOR', name: 'Norway' }, { code: 'CHE', name: 'Switzerland' },
  { code: 'NLD', name: 'Netherlands' }, { code: 'KEN', name: 'Kenya' },
  { code: 'ETH', name: 'Ethiopia' }, { code: 'PAK', name: 'Pakistan' },
  { code: 'BGD', name: 'Bangladesh' }, { code: 'VNM', name: 'Vietnam' },
  { code: 'THA', name: 'Thailand' }, { code: 'PHL', name: 'Philippines' },
  { code: 'COL', name: 'Colombia' }, { code: 'CHL', name: 'Chile' },
  { code: 'PER', name: 'Peru' }, { code: 'NZL', name: 'New Zealand' },
  { code: 'SGP', name: 'Singapore' }, { code: 'ARE', name: 'United Arab Emirates' },
];

export function formatIndicatorValue(v: number | null | undefined, code: string): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (code.includes('GDP.MKTP') || code === 'NY.GDP.MKTP.CD') {
    if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    return `$${Math.round(v).toLocaleString()}`;
  }
  if (code === 'NY.GDP.PCAP.CD') return `$${Math.round(v).toLocaleString()}`;
  if (code === 'SP.POP.TOTL') {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    return v.toLocaleString();
  }
  if (code.endsWith('.ZS') || code.endsWith('.ZG')) return `${v.toFixed(2)}%`;
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
  return v.toFixed(2);
}

export function indicatorLabel(code: string): string {
  return INDICATORS.find((i) => i.code === code)?.label || code;
}
