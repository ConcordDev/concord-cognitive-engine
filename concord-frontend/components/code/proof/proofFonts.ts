// Proof faces: Geist (interface) and Geist Mono (code, the ledger, every number).
import { Geist, Geist_Mono } from 'next/font/google';

export const proofUi = Geist({ subsets: ['latin'], display: 'swap', variable: '--pf-font-ui' });
export const proofMono = Geist_Mono({ subsets: ['latin'], display: 'swap', variable: '--pf-font-mono' });

export const proofFontVars = `${proofUi.variable} ${proofMono.variable}`;
