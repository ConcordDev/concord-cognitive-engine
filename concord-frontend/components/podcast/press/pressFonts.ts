// The Transcript Page faces: DM Serif Display (headlines, set like a magazine
// feature), Source Serif 4 (the transcript you read along with), Archivo
// (every control and label), DM Mono (timecodes and numbers).
import { DM_Serif_Display, Source_Serif_4, Archivo, DM_Mono } from 'next/font/google';

export const tpDisplay = DM_Serif_Display({ weight: ['400'], style: ['normal', 'italic'], subsets: ['latin'], display: 'swap', variable: '--tp-font-display' });
export const tpRead = Source_Serif_4({ weight: ['400', '600'], style: ['normal', 'italic'], subsets: ['latin'], display: 'swap', variable: '--tp-font-read' });
export const tpSans = Archivo({ weight: ['400', '500', '600', '700'], subsets: ['latin'], display: 'swap', variable: '--tp-font-sans' });
export const tpMono = DM_Mono({ weight: ['400', '500'], subsets: ['latin'], display: 'swap', variable: '--tp-font-mono' });

export const pressFontVars = `${tpDisplay.variable} ${tpRead.variable} ${tpSans.variable} ${tpMono.variable}`;
