import React, { useEffect, useRef } from 'react';

interface EngineStatusProps {
	statusText: string;
	engineText: React.ReactNode;
	logLines: string[];
}

/**
 * Content-only panel (no border/background of its own — it's meant to sit
 * inside a padded flex cell) showing what the compression engine is doing.
 * The log box is a fixed height and scrolls internally — it must NOT grow
 * with content, or a long-running job keeps expanding the whole panel.
 */
export function EngineStatus({ statusText, engineText, logLines }: EngineStatusProps) {
	const logEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		logEndRef.current?.scrollIntoView({ block: 'nearest' });
	}, [logLines]);

	return (
		<div className="flex flex-col">
			<p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">03 — engine status</p>
			<div className="space-y-2">
				<p className="text-sm text-foreground">
					<span className="text-muted-foreground">Status: </span>
					{statusText}
				</p>
				<p className="text-sm text-foreground">
					<span className="text-muted-foreground">Engine: </span>
					{engineText}
				</p>
			</div>
			<div className="mt-3 h-56 shrink-0 overflow-y-auto rounded-lg bg-background border border-border p-2 font-mono text-[11px] text-muted-foreground leading-relaxed">
				{logLines.length === 0 ? (
					<p className="text-muted-foreground/60">No activity yet.</p>
				) : (
					logLines.map((line, i) => <div key={i}>{line}</div>)
				)}
				<div ref={logEndRef} />
			</div>
		</div>
	);
}
