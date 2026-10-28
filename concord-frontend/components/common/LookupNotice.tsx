/**
 * LookupNotice — the credit line (with license link) the Wikimedia / StackExchange content
 * requires, plus an honest "cached copy" note when the server answered from an expired cache
 * entry because the upstream was unavailable or rate-limited.
 */
import { cn } from '@/lib/utils';
import { lookupMeta } from '@/lib/public-lookup';

const PROVIDERS = {
  wikipedia: { text: 'Wikipedia · CC BY-SA 4.0', href: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  wikidata: { text: 'Wikidata · CC BY-SA 4.0', href: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  commons: { text: 'Wikimedia Commons · CC BY-SA 4.0', href: 'https://commons.wikimedia.org/wiki/Commons:Licensing' },
  stackexchange: { text: 'Stack Exchange · CC BY-SA 4.0', href: 'https://stackoverflow.com/legal/terms-of-service/public#licensing' },
} as const;

export function LookupNotice({ provider, data, className }: { provider: keyof typeof PROVIDERS; data?: unknown; className?: string }) {
  const p = PROVIDERS[provider];
  const meta = lookupMeta(data);
  return (
    <p className={cn('text-[10px] text-gray-500', className)}>
      <a href={p.href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-gray-300 hover:underline">
        {p.text}
      </a>
      {meta?.stale && (
        <span className="ml-2 text-amber-400/80">
          cached copy{meta.fetchedAt ? ` from ${new Date(meta.fetchedAt).toLocaleString()}` : ''} — live source unavailable
        </span>
      )}
    </p>
  );
}

export default LookupNotice;
