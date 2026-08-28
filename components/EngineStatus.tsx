import React, { useEffect, useRef } from 'react';
import type { EngineChip, EngineChipState } from './VideoCompressor';

interface EngineStatusProps {
	statusText: string;
	chips: EngineChip[];
	logLines: string[];
}

const DOT_CLASS: Record<EngineChipState, string> = {
	unavailable: 'bg-muted-foreground/25',
	neutral: 'bg-muted-foreground/60',
	checking: 'bg-primary scale-110 animate-pulse',
	planned: 'bg-primary/70 ring-2 ring-primary/25',
	active: 'bg-primary scale-125 animate-pulse-glow',
	done: 'bg-secondary-foreground scale-110',
	fellback: 'bg-yellow-500/70',
};

const LABEL_CLASS: Record<EngineChipState, string> = {
	unavailable: 'text-muted-foreground/50',
	neutral: 'text-muted-foreground',
	checking: 'text-foreground font-medium',
	planned: 'text-foreground font-medium',
	active: 'text-foreground font-semibold',
	done: 'text-foreground font-semibold',
	fellback: 'text-muted-foreground line-through decoration-yellow-500/60',
};

const SUB_CLASS: Record<EngineChipState, string> = {
	unavailable: 'text-muted-foreground/40',
	neutral: 'text-muted-foreground/60',
	checking: 'text-primary',
	planned: 'text-primary/80',
	active: 'text-primary',
	done: 'text-secondary-foreground',
	fellback: 'text-yellow-500/80',
};

const SUB_TEXT: Record<EngineChipState, string> = {
	unavailable: 'Not available',
	neutral: 'Fallback',
	checking: 'Checking…',
	planned: 'Will try first',
	active: 'Encoding…',
	done: 'Used ✓',
	fellback: 'Fell back',
};

const CONNECTOR_LIT_STATES: EngineChipState[] = ['active', 'done', 'fellback'];

/**
 * Content-only panel (no border/background of its own — it's meant to sit
 * inside a padded flex cell) showing what the compression engine is doing.
 * The log box is a fixed height and scrolls internally — it must NOT grow
 * with content, or a long-running job keeps expanding the whole panel.
 */
export function EngineStatus({ statusText, chips, logLines }: EngineStatusProps) {
	const logEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		logEndRef.current?.scrollIntoView({ block: 'nearest' });
	}, [logLines]);

	return (
		<div className="flex flex-col">
			<p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">03 — engine status</p>

			<p className="text-sm text-foreground">
				<span className="text-muted-foreground">Status: </span>
				<span key={statusText} className="inline-block animate-fade-in">
					{statusText}
				</span>
			</p>

			{/* The engine ladder: every engine that could run for this job, in
			    fallback order, animating live as attempts actually happen. */}
			<div className="mt-3 flex items-start">
				{chips.map((chip, i) => (
					<React.Fragment key={chip.id}>
						<div className="group relative flex flex-1 flex-col items-center gap-1.5 text-center cursor-default">
							<span className={`h-3 w-3 rounded-full transition-all duration-300 ease-out ${DOT_CLASS[chip.state]}`} />
							<span className={`text-xs transition-colors duration-300 ${LABEL_CLASS[chip.state]}`}>{chip.label}</span>
							<span className={`text-[10px] uppercase tracking-wide transition-colors duration-300 ${SUB_CLASS[chip.state]}`}>
								{SUB_TEXT[chip.state]}
							</span>

							<span
								role="tooltip"
								className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-56 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-[11px] normal-case tracking-normal text-muted-foreground opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100"
							>
								{chip.tooltip}
							</span>
						</div>

						{i < chips.length - 1 && (
							<div
								className={`mt-[7px] h-px flex-1 max-w-8 transition-colors duration-500 ${
									CONNECTOR_LIT_STATES.includes(chip.state) ? 'bg-primary/50' : 'bg-border'
								}`}
							/>
						)}
					</React.Fragment>
				))}
			</div>

			<div className="mt-3 h-56 shrink-0 overflow-y-auto rounded-lg bg-background border border-border p-2 font-mono text-[11px] text-muted-foreground leading-relaxed">
				{logLines.length === 0 ? (
					<p className="text-muted-foreground/60">No activity yet.</p>
				) : (
					logLines.map((line, i) => (
						<div key={i} className="animate-log-in">
							{line}
						</div>
					))
				)}
				<div ref={logEndRef} />
			</div>
		</div>
	);
}
