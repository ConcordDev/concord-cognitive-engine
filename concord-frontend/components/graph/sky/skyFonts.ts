import { IM_Fell_English, Sora, Space_Mono } from 'next/font/google';

/** The Star Chart's faces: IM Fell English for constellation and star names (an engraved star atlas), Sora for controls, Space Mono for catalogue numbers, magnitudes and coordinates. */
const skAtlas = IM_Fell_English({ subsets: ['latin'], weight: ['400'], style: ['normal', 'italic'], variable: '--sk-font-atlas', display: 'swap' });
const skSans = Sora({ subsets: ['latin'], weight: ['300', '400', '600'], variable: '--sk-font-sans', display: 'swap' });
const skMono = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--sk-font-mono', display: 'swap' });

export const skyFontVars = `${skAtlas.variable} ${skSans.variable} ${skMono.variable}`;
