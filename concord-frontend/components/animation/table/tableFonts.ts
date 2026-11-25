import { Josefin_Sans, Figtree, Shadows_Into_Light, Red_Hat_Mono } from 'next/font/google';

/** The Light Table's faces: Josefin Sans for titles (an old animation-studio lettering), Figtree for controls, Shadows Into Light for pencil notes on the X-sheet, Red Hat Mono for frame numbers. */
const ltTitle = Josefin_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--lt-font-title', display: 'swap' });
const ltSans = Figtree({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--lt-font-sans', display: 'swap' });
const ltPencil = Shadows_Into_Light({ subsets: ['latin'], weight: ['400'], variable: '--lt-font-pencil', display: 'swap' });
const ltMono = Red_Hat_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--lt-font-mono', display: 'swap' });

export const tableFontVars = `${ltTitle.variable} ${ltSans.variable} ${ltPencil.variable} ${ltMono.variable}`;
