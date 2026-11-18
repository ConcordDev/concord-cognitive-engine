import { Permanent_Marker, Caveat, Courier_Prime } from 'next/font/google';

/** Shop sign + chalkboard headline numbers. */
export const markerFont = Permanent_Marker({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--stall-font-marker' });
/** Hand-written labels and price tags. */
export const handFont = Caveat({ weight: ['500', '700'], subsets: ['latin'], display: 'swap', variable: '--stall-font-hand' });
/** The till roll. */
export const tillFont = Courier_Prime({ weight: ['400', '700'], subsets: ['latin'], display: 'swap', variable: '--stall-font-till' });

export const stallFontVars = `${markerFont.variable} ${handFont.variable} ${tillFont.variable}`;
