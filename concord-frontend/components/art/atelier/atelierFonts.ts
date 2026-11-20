// The Atelier faces: Young Serif (the piece's title, room names — a painterly
// old-style), Work Sans (every control and label).
import { Young_Serif, Work_Sans } from 'next/font/google';

export const atelierDisplay = Young_Serif({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--at-font-display' });
export const atelierBody = Work_Sans({ weight: ['400', '500', '600'], subsets: ['latin'], display: 'swap', variable: '--at-font-body' });

export const atelierFontVars = `${atelierDisplay.variable} ${atelierBody.variable}`;
