/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,ts,jsx,tsx,mdx}",
		"./app/**/*.{js,ts,jsx,tsx,mdx}",
	],
	theme: {
		extend: {
			// Each var below stores bare color components (no wrapping function) and
			// gets wrapped here with the matching color function plus Tailwind's
			// special <alpha-value> placeholder — the documented pattern that lets
			// opacity modifiers (bg-primary/70, ring-primary/25, etc.) actually work
			// on custom theme colors. Without this, `var(--x)` resolves to a fixed
			// opaque color and every `/NN` modifier on it silently falls back to
			// fully transparent (or, for `ring-*`, Tailwind's default blue) instead
			// of blending in any opacity at all.
			colors: {
				background: "oklch(var(--background) / <alpha-value>)",
				foreground: "oklch(var(--foreground) / <alpha-value>)",
				card: {
					DEFAULT: "oklch(var(--card) / <alpha-value>)",
					foreground: "oklch(var(--card-foreground) / <alpha-value>)",
				},
				primary: {
					DEFAULT: "rgb(var(--primary) / <alpha-value>)",
					foreground: "rgb(var(--primary-foreground) / <alpha-value>)",
				},
				secondary: {
					DEFAULT: "oklch(var(--secondary) / <alpha-value>)",
					foreground: "oklch(var(--secondary-foreground) / <alpha-value>)",
				},
				muted: {
					DEFAULT: "oklch(var(--muted) / <alpha-value>)",
					foreground: "oklch(var(--muted-foreground) / <alpha-value>)",
				},
				accent: {
					DEFAULT: "oklch(var(--accent) / <alpha-value>)",
					foreground: "oklch(var(--accent-foreground) / <alpha-value>)",
				},
				border: "oklch(var(--border) / <alpha-value>)",
				input: "oklch(var(--input) / <alpha-value>)",
				ring: "rgb(var(--ring) / <alpha-value>)",
			},
			fontFamily: {
				sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
				mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
				display: ["var(--font-display)", "var(--font-geist-sans)", "sans-serif"],
			},
			borderRadius: {
				sm: "calc(var(--radius) - 4px)",
				md: "calc(var(--radius) - 2px)",
				lg: "var(--radius)",
				xl: "calc(var(--radius) + 6px)",
				"2xl": "calc(var(--radius) + 12px)",
			},
		},
	},
};
