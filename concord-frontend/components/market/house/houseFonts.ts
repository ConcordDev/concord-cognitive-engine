// The Auction House faces: Cormorant Garamond (lot titles, the house name,
// catalogue numbers in small capitals) and Jost (the room's labels, prices,
// every control).
import { Cormorant_Garamond, Jost } from 'next/font/google';

export const houseDisplay = Cormorant_Garamond({ weight: ['500', '600', '700'], style: ['normal', 'italic'], subsets: ['latin'], display: 'swap', variable: '--ah-font-display' });
export const houseBody = Jost({ weight: ['400', '500', '600'], subsets: ['latin'], display: 'swap', variable: '--ah-font-body' });

export const houseFontVars = `${houseDisplay.variable} ${houseBody.variable}`;
