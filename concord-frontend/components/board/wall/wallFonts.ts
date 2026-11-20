import { Nunito_Sans, Overpass_Mono, Reenie_Beanie } from 'next/font/google';

/**
 * The Cork Wall's faces: Reenie Beanie for what's written in marker on
 * masking tape (column names, the board's name), Nunito Sans for every card
 * and control, Overpass Mono for dates and counts.
 */
const cwMarker = Reenie_Beanie({ subsets: ['latin'], weight: ['400'], variable: '--cw-font-marker', display: 'swap' });
const cwSans = Nunito_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--cw-font-sans', display: 'swap' });
const cwMono = Overpass_Mono({ subsets: ['latin'], weight: ['400', '600'], variable: '--cw-font-mono', display: 'swap' });

export const wallFontVars = `${cwMarker.variable} ${cwSans.variable} ${cwMono.variable}`;
