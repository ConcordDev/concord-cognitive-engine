/**
 * DataAttribution — the linked credit line a third-party market data provider requires wherever its
 * data is displayed. Wording matches the server constants in server/lib/market-feed-sources.js
 * (COINGECKO_ATTRIBUTION / ERAPI_ATTRIBUTION).
 */
import { cn } from '@/lib/utils';

const PROVIDERS = {
  coingecko: { text: 'Data provided by CoinGecko', href: 'https://www.coingecko.com' },
  erapi: { text: 'Rates By Exchange Rate API', href: 'https://www.exchangerate-api.com' },
} as const;

export function DataAttribution({ provider, className }: { provider: keyof typeof PROVIDERS; className?: string }) {
  const p = PROVIDERS[provider];
  return (
    <a
      href={p.href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('text-[10px] text-gray-500 underline-offset-2 hover:text-gray-300 hover:underline', className)}
    >
      {p.text}
    </a>
  );
}

export default DataAttribution;
