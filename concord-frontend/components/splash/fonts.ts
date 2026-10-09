import { Instrument_Serif, Montserrat } from 'next/font/google';

/**
 * Splash-only display faces. Declared here (not in the root layout) so the
 * download + preload cost lands only on the routes that render the splash,
 * the same reasoning as `preload: false` on Source Serif in app/layout.tsx.
 * JetBrains Mono is already loaded app-wide via `--font-jetbrains-mono`.
 */
export const splashWordmarkFont = Montserrat({
  subsets: ['latin'],
  weight: ['600'],
  display: 'swap',
});

export const splashQuoteFont = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  display: 'swap',
});
