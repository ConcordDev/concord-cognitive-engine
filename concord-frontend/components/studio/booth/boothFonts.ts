// The Booth's faces: Bebas Neue for engraved console labels and room keys,
// Gochi Hand for the marker on scribble-strip tape, Share Tech Mono for LED
// counters and meter readouts. Each is exposed as a CSS variable used by
// booth.css (--bo-font-label / --bo-font-hand / --bo-font-led).
import { Bebas_Neue, Gochi_Hand, Share_Tech_Mono } from 'next/font/google';

export const boothLabel = Bebas_Neue({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--bo-font-label' });
export const boothHand = Gochi_Hand({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--bo-font-hand' });
export const boothLed = Share_Tech_Mono({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--bo-font-led' });

export const boothFontVars = `${boothLabel.variable} ${boothHand.variable} ${boothLed.variable}`;
