import { Chivo_Mono, Hanken_Grotesk, IBM_Plex_Sans_Condensed, Spectral } from 'next/font/google';

/**
 * The Darkroom's faces: IBM Plex Sans Condensed for the panel headings (small,
 * tracked capitals, like the labels on an enlarger), Hanken Grotesk for every
 * control, Chivo Mono for every number a photographer reads (slider values,
 * exposure, ISO, sizes), and Spectral for a photograph's own title.
 */
const drHead = IBM_Plex_Sans_Condensed({ subsets: ['latin'], weight: ['500', '600'], variable: '--dr-font-head', display: 'swap' });
const drSans = Hanken_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--dr-font-sans', display: 'swap' });
const drMono = Chivo_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--dr-font-mono', display: 'swap' });
const drTitle = Spectral({ subsets: ['latin'], weight: ['400', '500'], style: ['normal', 'italic'], variable: '--dr-font-title', display: 'swap' });

export const darkroomFontVars = `${drHead.variable} ${drSans.variable} ${drMono.variable} ${drTitle.variable}`;
