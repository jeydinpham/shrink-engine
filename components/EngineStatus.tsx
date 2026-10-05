import React, { useEffect, useRef } from 'react';
import type { EngineChip, EngineChipState } from './VideoCompressor';

interface EngineStatusProps {
	statusText: string;
	chips: EngineChip[];
	logLines: string[];
	onDiagnose?: () => void;
}

const DOT_CLASS: Record<EngineChipState, string> = {
	unavailable: 'bg-faint',
	neutral: 'bg-dim',
	checking: 'bg-accent scale-110 animate-pulse',
	planned: 'bg-accent/80 ring-4 ring-accent/20',
	active: 'bg-accent scale-125 animate-pulse-glow',
	done: 'bg-ink scale-110 ring-4 ring-accent/30',
	fellback: 'bg-accent-2/60',
};

const LABEL_CLASS: Record<EngineChipState, string> = {
	unavailable: 'text-dim/60',
	neutral: 'text-dim',
	checking: 'text-ink',
	planned: 'text-ink',
	active: 'text-ink',
	done: 'text-ink',
	fellback: 'text-dim line-through decoration-accent-2/60 decoration-2',
};

const SUB_CLASS: Record<EngineChipState, string> = {
	unavailable: '!text-dim/50',
	neutral: '!text-dim',
	checking: '!text-accent',
	planned: '!text-accent',
	active: '!text-accent',
	done: '!text-ink',
	fellback: '!text-accent-2',
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
export function EngineStatus({ statusText, chips, logLines, onDiagnose }: EngineStatusProps) {
	const logRef = useRef<HTMLDivElement>(null);

	// Scrolls only the log box itself — scrollIntoView would also scroll the
	// page down to the log whenever it sits below the fold.
	useEffect(() => {
		const log = logRef.current;
		if (log) log.scrollTop = log.scrollHeight;
	}, [logLines]);

	return (
		<div className="flex flex-col">
			<div className="flex items-center justify-between mb-3">
				<p className="mono flex items-center gap-3">
					<span className="text-accent">03</span>
					<span className="h-px w-6 bg-faint" aria-hidden="true" />
					<span className="text-ink">Engine status</span>
				</p>
				{onDiagnose && (
					<button
						type="button"
						onClick={onDiagnose}
						className="link text-[13px]"
					>
						Diagnose hardware
					</button>
				)}
			</div>

			<p className="mt-2 text-[15px] text-ink">
				<span className="text-dim">Status: </span>
				<span key={statusText} className="inline-block animate-fade-in">
					{statusText}
				</span>
			</p>

			{/* The engine ladder: every engine that could run for this job, in
			    fallback order, animating live as attempts actually happen. Kept
			    compact (small gaps, no extra padding) — the whole layout is
			    tuned to fit one viewport without scrolling. */}
			<div className="mt-4 flex items-start">
				{chips.map((chip, i) => (
					<React.Fragment key={chip.id}>
						<div className="group relative flex flex-1 flex-col items-center gap-1 text-center cursor-default">
							<span className={`h-2.5 w-2.5 rounded-full transition-all duration-300 ease-out ${DOT_CLASS[chip.state]}`} />
							<span className={`mt-1 font-display text-lg font-extrabold uppercase leading-none tracking-[0.02em] transition-colors duration-300 ${LABEL_CLASS[chip.state]}`}>{chip.label}</span>
							<span
								className={`mono !text-[10px] !leading-none transition-colors duration-300 ${SUB_CLASS[chip.state]}`}
							>
								{SUB_TEXT[chip.state]}
							</span>

							<span
								role="tooltip"
								className="pointer-events-none absolute left-1/2 top-full z-10 mt-3 w-60 -translate-x-1/2 rounded-xl bg-ink px-3.5 py-2.5 text-[13px] leading-snug text-bg opacity-0 shadow-[0_10px_24px_rgba(0,0,0,.3)] transition-opacity duration-200 group-hover:opacity-100"
							>
								{chip.tooltip}
							</span>
						</div>

						{i < chips.length - 1 && (
							<div
								className={`mt-[5px] h-px flex-1 max-w-8 transition-colors duration-500 ${
									CONNECTOR_LIT_STATES.includes(chip.state) ? 'bg-accent/60' : 'bg-faint'
								}`}
							/>
						)}
					</React.Fragment>
				))}
			</div>

			<div ref={logRef} className="mt-5 h-44 shrink-0 overflow-y-auto rounded-md bg-bg border border-faint px-3 py-2.5 font-mono text-[11px] [font-stretch:87.5%] text-dim leading-relaxed">
				{logLines.length === 0 ? (
					<p className="text-dim/60">No activity yet.</p>
				) : (
					logLines.map((line, i) => (
						<div key={i} className="animate-log-in">
							{line}
						</div>
					))
				)}
			</div>
		</div>
	);
}
