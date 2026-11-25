// The Production Office faces: Oswald (slate lettering, room names),
// Manrope (every control), Cutive Mono (typewritten script, timecodes,
// call sheets).
import { Oswald, Manrope, Cutive_Mono } from 'next/font/google';

export const foSlate = Oswald({ weight: ['500', '600', '700'], subsets: ['latin'], display: 'swap', variable: '--fo-font-slate' });
export const foSans = Manrope({ weight: ['400', '500', '600', '700'], subsets: ['latin'], display: 'swap', variable: '--fo-font-sans' });
export const foType = Cutive_Mono({ weight: ['400'], subsets: ['latin'], display: 'swap', variable: '--fo-font-type' });

export const officeFontVars = `${foSlate.variable} ${foSans.variable} ${foType.variable}`;
