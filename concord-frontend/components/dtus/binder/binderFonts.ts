// The Binder faces: Bricolage Grotesque (card titles, set like collectible
// card names), Outfit (every control), Fragment Mono (serials and counts).
// A card's owner can also set its title in a serif or mono; those reuse the
// lens's own mono and the platform serif.
import { Bricolage_Grotesque, Outfit, Fragment_Mono } from 'next/font/google';

export const bdTitle = Bricolage_Grotesque({ weight: ['500', '700', '800'], subsets: ['latin'], display: 'swap', variable: '--bd-font-title' });
export const bdSans = Outfit({ weight: ['400', '500', '600'], subsets: ['latin'], display: 'swap', variable: '--bd-font-sans' });
export const bdMono = Fragment_Mono({ weight: ['400'], subsets: ['latin'], display: 'swap', variable: '--bd-font-mono' });

export const binderFontVars = `${bdTitle.variable} ${bdSans.variable} ${bdMono.variable}`;
