// Situation Room faces: Barlow Condensed (labels, place names, the big counts),
// Barlow (reading), Azeret Mono (the clock, timestamps, every number).
import { Barlow, Barlow_Condensed, Azeret_Mono } from 'next/font/google';

export const roomDisplay = Barlow_Condensed({ weight: ['500', '600', '700'], subsets: ['latin'], display: 'swap', variable: '--sr-font-display' });
export const roomBody = Barlow({ weight: ['400', '500', '600'], subsets: ['latin'], display: 'swap', variable: '--sr-font-body' });
export const roomMono = Azeret_Mono({ weight: ['400', '500'], subsets: ['latin'], display: 'swap', variable: '--sr-font-mono' });

export const roomFontVars = `${roomDisplay.variable} ${roomBody.variable} ${roomMono.variable}`;
