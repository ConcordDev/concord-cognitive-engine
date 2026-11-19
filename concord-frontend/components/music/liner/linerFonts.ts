// Liner Notes faces: Fraunces (serif headlines and the artist's note),
// Inter Tight (interface), IBM Plex Mono (durations, catalogue numbers, prices).
import { Fraunces, Inter_Tight, IBM_Plex_Mono } from 'next/font/google';

export const linerSerif = Fraunces({ subsets: ['latin'], display: 'swap', variable: '--ln-font-serif' });
export const linerUi = Inter_Tight({ subsets: ['latin'], display: 'swap', variable: '--ln-font-ui' });
export const linerMono = IBM_Plex_Mono({ weight: ['400', '500'], subsets: ['latin'], display: 'swap', variable: '--ln-font-mono' });

export const linerFontVars = `${linerSerif.variable} ${linerUi.variable} ${linerMono.variable}`;
