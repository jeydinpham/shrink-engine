import React from 'react';

interface TooltipProps {
	content: string;
	children: React.ReactNode;
}

/** CSS-only hover tooltip (no JS positioning) — trigger gets a dotted underline as a hover affordance. */
export function Tooltip({ content, children }: TooltipProps) {
	return (
		<span className="group relative inline-flex">
			<span className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2">
				{children}
			</span>
			<span
				role="tooltip"
				className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-64 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs normal-case tracking-normal text-muted-foreground opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100"
			>
				{content}
			</span>
		</span>
	);
}
