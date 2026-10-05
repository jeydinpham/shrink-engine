import localFont from 'next/font/local';
import { Hanken_Grotesk, Martian_Mono } from 'next/font/google';

// jeydinpham.com's type system: Big Shoulders for display (uppercase, heavy),
// Hanken Grotesk for body copy, Martian Mono (narrowed via its wdth axis) for
// labels.
//
// Big Shoulders is self-hosted: this Next version only knows the older
// "Big Shoulders Display" family, which is the 72pt optical size and noticeably
// narrower than what the site serves. This file is the exact latin subset
// jeydinpham.com ships (variable weight, default optical size).
const display = localFont({
	src: './BigShoulders-latin.woff2',
	variable: '--font-display',
	weight: '100 900',
	adjustFontFallback: false,
});

const body = Hanken_Grotesk({
	subsets: ['latin'],
	variable: '--font-body',
	weight: ['400', '500', '600'],
});

const mono = Martian_Mono({
	subsets: ['latin'],
	variable: '--font-mono',
	axes: ['wdth'],
});

export const fontVariables = `${display.variable} ${body.variable} ${mono.variable}`;
