import React from 'react';

interface TooltipProps {
	content: string;
	children: React.ReactNode;
}

/** CSS-only hover tooltip (no JS positioning) — trigger gets a dotted underline as a hover affordance. */
export function Tooltip({ content, children }: TooltipProps) {
	return (
		<span className="group relative inline-flex">
			<span className="cursor-help underline decoration-dotted decoration-dim underline-offset-2">
				{children}
			</span>
			<span
				role="tooltip"
				className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-64 -translate-x-1/2 rounded-xl bg-ink px-3.5 py-2.5 text-[13px] leading-snug normal-case tracking-normal text-bg opacity-0 shadow-[0_10px_24px_rgba(0,0,0,.3)] transition-opacity duration-200 group-hover:opacity-100"
			>
				{content}
			</span>
		</span>
	);
}
