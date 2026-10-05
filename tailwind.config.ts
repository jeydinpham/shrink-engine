/** @type {import('tailwindcss').Config} */
module.exports = {
	content: [
		"./pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,ts,jsx,tsx,mdx}",
		"./app/**/*.{js,ts,jsx,tsx,mdx}",
	],
	theme: {
		extend: {
			// jeydinpham.com's tokens (styles/globals.css). Each var stores bare RGB
			// components so Tailwind's <alpha-value> placeholder can blend opacity
			// modifiers (bg-accent/10, border-ink/40, ...) on top of them.
			colors: {
				bg: "rgb(var(--bg) / <alpha-value>)",
				"bg-2": "rgb(var(--bg-2) / <alpha-value>)",
				ink: "rgb(var(--ink) / <alpha-value>)",
				"ink-2": "rgb(var(--ink-2) / <alpha-value>)",
				dim: "rgb(var(--dim) / <alpha-value>)",
				faint: "rgb(var(--faint) / <alpha-value>)",
				accent: "rgb(var(--accent) / <alpha-value>)",
				"accent-2": "rgb(var(--accent-2) / <alpha-value>)",
				// text on a solid accent fill, same in both themes
				"on-accent": "#1A0F08",
				danger: "rgb(var(--danger) / <alpha-value>)",
			},
			fontFamily: {
				sans: ["var(--font-body)", "Segoe UI", "system-ui", "sans-serif"],
				mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
				display: ["var(--font-display)", "Oswald", "Arial Narrow", "Impact", "sans-serif"],
			},
		},
	},
};
