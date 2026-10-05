import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Switch } from './Switch';
import { EngineStatus } from './EngineStatus';
import { Modal } from './Modal';
import { formatBytes, formatDuration } from '@/lib/format';
import { looksLikeVideoFile, VIDEO_ACCEPT } from '@/lib/fileTypes';
import { playCompletionSound } from '@/lib/sound';
import { CompressOptions, EngineUsed, Resolution } from '@/lib/compress';
import { compressVideo, CompressionPhase } from '@/lib/compressVideo';
import { canUseMultiThreaded } from '@/lib/ffmpeg';
import { canUseWebCodecs, probeWebCodecsDecode } from '@/lib/webCodecsCompress';
import type { DecodeProbeResult } from '@/lib/webCodecsCompress';
import { DiagnosticsPanel } from './DiagnosticsPanel';

type SizePreset = '10' | '20' | '50' | '100' | 'custom';

type Phase = 'idle' | 'working' | 'done' | 'error';

const PRESETS: { value: SizePreset; label: string }[] = [
	{ value: '10', label: '10MB' },
	{ value: '20', label: '20MB' },
	{ value: '50', label: '50MB' },
	{ value: '100', label: '100MB' },
];

const STAGE_LABEL: Record<CompressionPhase, string> = {
	probing: 'Reading video…',
	encoding: 'Encoding…',
	pass1: 'Encoding (pass 1 of 2)…',
	pass2: 'Encoding (pass 2 of 2)…',
};

export type EngineChipState = 'unavailable' | 'neutral' | 'checking' | 'planned' | 'active' | 'done' | 'fellback';

export interface EngineChip {
	id: EngineUsed;
	label: string;
	tooltip: string;
	state: EngineChipState;
}

const ENGINE_INFO: Record<EngineUsed, { label: string; tooltip: string }> = {
	webcodecs: {
		label: 'Hardware',
		tooltip: "Uses your device's dedicated video encoder via the WebCodecs API — the fastest option, when it's available and can handle this file.",
	},
	multi: {
		label: 'Multi-core',
		tooltip: 'Software encoding (ffmpeg.wasm) spread across multiple CPU cores.',
	},
	single: {
		label: 'Single-core',
		tooltip: 'Software encoding (ffmpeg.wasm) on a single CPU core — the universal fallback. Works everywhere, but slowest.',
	},
};

const ENGINE_ORDER: EngineUsed[] = ['webcodecs', 'multi', 'single'];

function UploadIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M12 16.5V9.75m0 0l-3.75 3.75M12 9.75l3.75 3.75M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
			/>
		</svg>
	);
}

function CheckCircleIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
		</svg>
	);
}

export function VideoCompressor() {
	const [file, setFile] = useState<File | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [howItWorksOpen, setHowItWorksOpen] = useState(false);

	const [showUrlInput, setShowUrlInput] = useState(false);
	const [urlValue, setUrlValue] = useState('');
	const [urlLoading, setUrlLoading] = useState(false);

	const [sizePreset, setSizePreset] = useState<SizePreset>('20');
	const [customSizeMB, setCustomSizeMB] = useState('');

	const [resolution, setResolution] = useState<Resolution>('original');
	const [muteAudio, setMuteAudio] = useState(false);
	const [extraQuality, setExtraQuality] = useState(false);
	const [trimEnabled, setTrimEnabled] = useState(false);
	const [trimStart, setTrimStart] = useState('');
	const [trimEnd, setTrimEnd] = useState('');
	const [playSound, setPlaySound] = useState(false);
	const [autoDownload, setAutoDownload] = useState(false);

	const [phase, setPhase] = useState<Phase>('idle');
	const [stage, setStage] = useState('Not loaded');
	const [progress, setProgress] = useState(0);
	const [logLines, setLogLines] = useState<string[]>([]);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [sizeWarning, setSizeWarning] = useState(false);

	const [resultBlob, setResultBlob] = useState<Blob | null>(null);
	const [resultUrl, setResultUrl] = useState<string | null>(null);
	const [resultDuration, setResultDuration] = useState<number | null>(null);

	const [multiThreadCapable, setMultiThreadCapable] = useState(false);
	const [webCodecsCapable, setWebCodecsCapable] = useState(false);
	const [engineMode, setEngineMode] = useState<EngineUsed | 'unknown'>('unknown');
	// Every engine actually attempted this run, in order — lets the engine
	// ladder show the fallback chain animating in real time (e.g. WebCodecs →
	// multi-threaded → single-threaded) instead of only ever revealing the
	// final choice after the fact.
	const [engineHistory, setEngineHistory] = useState<EngineUsed[]>([]);
	// Whether THIS file's video can actually be decoded via WebCodecs — a
	// browser supporting the API at all doesn't mean it can decode any given
	// file (codec/profile/resource issues only show up on real data).
	const [fileDecodeSupport, setFileDecodeSupport] = useState<'checking' | 'supported' | 'unsupported' | null>(null);
	// The pre-flight probe's own explanation for why it rejected this file —
	// kept around so it can survive into the compression run's log (which
	// clears on every Compress press) instead of being logged once, pre-run,
	// and then silently wiped before the user ever sees it.
	const [webCodecsSkipReason, setWebCodecsSkipReason] = useState<string | null>(null);
	// The probe's full structured result (timing, timeout vs. real rejection)
	// kept around purely so the diagnostics panel can show more than the log
	// line does — not used for any gating decision.
	const [decodeProbeResult, setDecodeProbeResult] = useState<DecodeProbeResult | null>(null);
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

	const fileInputRef = useRef<HTMLInputElement>(null);
	const autoDownloadedUrlRef = useRef<string | null>(null);

	useEffect(() => {
		setMultiThreadCapable(canUseMultiThreaded());
		setWebCodecsCapable(canUseWebCodecs());
	}, []);

	const appendLog = useCallback((message: string) => {
		setLogLines((prev) => (prev.length > 200 ? [...prev.slice(-200), message] : [...prev, message]));
	}, []);

	const handleEngineReady = useCallback((engine: EngineUsed) => {
		setEngineMode(engine);
		setEngineHistory((prev) => (prev[prev.length - 1] === engine ? prev : [...prev, engine]));
	}, []);

	// Pre-flight check as soon as a file is picked, well before Compress is
	// pressed — actually tries to decode the first frame instead of just
	// trusting a static "is this codec supported" query.
	useEffect(() => {
		if (!file || !webCodecsCapable) {
			setFileDecodeSupport(null);
			setWebCodecsSkipReason(null);
			setDecodeProbeResult(null);
			return;
		}
		let cancelled = false;
		setFileDecodeSupport('checking');
		setWebCodecsSkipReason(null);
		setDecodeProbeResult(null);
		probeWebCodecsDecode(file, (message) => {
			appendLog(message);
			setWebCodecsSkipReason(message);
		}).then((result) => {
			if (!cancelled) {
				setFileDecodeSupport(result.ok ? 'supported' : 'unsupported');
				setDecodeProbeResult(result);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [file, webCodecsCapable, appendLog]);

	useEffect(() => {
		if (!resultBlob) {
			setResultUrl(null);
			return;
		}
		const url = URL.createObjectURL(resultBlob);
		setResultUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [resultBlob]);

	const outputName = file ? `${file.name.replace(/\.[^/.]+$/, '')}-compressed.mp4` : 'compressed.mp4';

	// Fires the download automatically once per finished result, if enabled.
	useEffect(() => {
		if (!autoDownload || !resultUrl || phase !== 'done') return;
		if (autoDownloadedUrlRef.current === resultUrl) return;
		autoDownloadedUrlRef.current = resultUrl;
		const a = document.createElement('a');
		a.href = resultUrl;
		a.download = outputName;
		a.click();
	}, [autoDownload, resultUrl, phase, outputName]);

	const resetResult = useCallback(() => {
		setResultBlob(null);
		setResultDuration(null);
		setErrorMessage(null);
		setSizeWarning(false);
		setPhase('idle');
		setStage('Not loaded');
		setProgress(0);
		setEngineMode('unknown');
		setEngineHistory([]);
	}, []);

	const dismissResult = useCallback(() => {
		setFile(null);
		resetResult();
	}, [resetResult]);

	const handleFile = useCallback(
		(nextFile: File) => {
			if (!looksLikeVideoFile(nextFile)) {
				setErrorMessage('That doesn’t look like a video file.');
				return;
			}
			setFile(nextFile);
			resetResult();
		},
		[resetResult]
	);

	const onDrop = useCallback(
		(e: React.DragEvent<HTMLDivElement>) => {
			e.preventDefault();
			setIsDragging(false);
			const dropped = e.dataTransfer.files?.[0];
			if (dropped) handleFile(dropped);
		},
		[handleFile]
	);

	const onLoadUrl = useCallback(async () => {
		if (!urlValue.trim()) return;
		setUrlLoading(true);
		setErrorMessage(null);
		try {
			const res = await fetch(urlValue.trim());
			if (!res.ok) throw new Error(`Server responded with ${res.status}`);
			const blob = await res.blob();
			const name = urlValue.split('/').pop()?.split('?')[0] || 'video.mp4';
			handleFile(new File([blob], name, { type: blob.type || 'video/mp4' }));
			setShowUrlInput(false);
			setUrlValue('');
		} catch (err) {
			setErrorMessage(
				`Couldn’t load that URL (${err instanceof Error ? err.message : 'unknown error'}). ` +
					'The host may not allow cross-origin downloads.'
			);
		} finally {
			setUrlLoading(false);
		}
	}, [urlValue, handleFile]);

	const targetSizeMB = sizePreset === 'custom' ? Number(customSizeMB) : Number(sizePreset);
	const isValidTargetSize = Number.isFinite(targetSizeMB) && targetSizeMB > 0;
	const isProcessing = phase === 'working';

	const handleCompress = useCallback(async () => {
		if (!file || !isValidTargetSize) return;

		setErrorMessage(null);
		setSizeWarning(false);
		setResultBlob(null);
		setResultDuration(null);
		setProgress(0);
		// Fresh log per run, but keep the pre-flight probe's explanation (if
		// any) instead of wiping it — it's the only place that says why this
		// run isn't using WebCodecs at all, and it happened before this log
		// was cleared, so it'd otherwise vanish without the user ever seeing it.
		setLogLines(webCodecsSkipReason ? [webCodecsSkipReason] : []);
		setPhase('working');
		setStage('Starting…');
		setEngineMode('unknown');
		setEngineHistory([]);
		autoDownloadedUrlRef.current = null;

		try {
			const options: CompressOptions = {
				targetSizeMB,
				resolution,
				muteAudio,
				extraQuality,
				trimStartSec: trimEnabled ? Number(trimStart) || 0 : 0,
				trimEndSec: trimEnabled ? Number(trimEnd) || 0 : 0,
			};

			const result = await compressVideo(
				file,
				options,
				{
					onLog: appendLog,
					onEngineReady: handleEngineReady,
					onPhase: (p) => {
						setStage(STAGE_LABEL[p]);
						setProgress(0);
					},
					onProgress: setProgress,
				},
				// Already confirmed this file can't be decoded via WebCodecs —
				// skip the doomed attempt instead of failing into the fallback every time.
				{ skipWebCodecs: fileDecodeSupport === 'unsupported' }
			);

			setResultBlob(result.blob);
			setResultDuration(result.durationSeconds);
			// The actual outcome the user cares about, not just the engine's own
			// "I had to floor the bitrate" signal — a run that exhausts its
			// size-fitting retries without ever hitting that floor should still
			// warn, not silently hand back an oversized file.
			setSizeWarning(result.sizeBytes > targetSizeMB * 1024 * 1024);
			setPhase('done');
			setStage('Ready');
			if (playSound) playCompletionSound();
		} catch (err) {
			setErrorMessage(err instanceof Error ? err.message : 'Something went wrong while compressing.');
			setPhase('error');
			setStage('Idle');
		}
	}, [
		file,
		isValidTargetSize,
		targetSizeMB,
		resolution,
		muteAudio,
		extraQuality,
		trimEnabled,
		trimStart,
		trimEnd,
		playSound,
		appendLog,
		handleEngineReady,
		fileDecodeSupport,
		webCodecsSkipReason,
	]);

	const showPercent = stage.startsWith('Encoding');
	const reductionPct = file && resultBlob ? Math.max(0, Math.round((1 - resultBlob.size / file.size) * 100)) : null;
	const showResult = phase === 'done' && !!resultBlob && !!resultUrl;
	// Once the pre-flight probe has ruled WebCodecs out for this specific
	// file, treat it the same as the browser not supporting it at all.
	const effectiveWebCodecsCapable = webCodecsCapable && fileDecodeSupport !== 'unsupported';

	// The engine ladder shown in Engine Status: which engines exist, which
	// one is planned/active/done, and which ones were tried and fell back
	// this run — computed fresh every render so it animates in step with
	// engineHistory as attempts actually happen, not just the final result.
	const plannedEngine: EngineUsed = effectiveWebCodecsCapable ? 'webcodecs' : multiThreadCapable ? 'multi' : 'single';
	const engineChips: EngineChip[] = ENGINE_ORDER.map((id) => {
		const info = ENGINE_INFO[id];
		const historyIndex = engineHistory.indexOf(id);
		const isMostRecent = historyIndex !== -1 && historyIndex === engineHistory.length - 1;
		const unavailable =
			(id === 'webcodecs' && (!webCodecsCapable || (!!file && fileDecodeSupport === 'unsupported'))) ||
			(id === 'multi' && !multiThreadCapable);

		let state: EngineChipState;
		let tooltip = info.tooltip;

		if (historyIndex !== -1) {
			if (isMostRecent && phase === 'working') state = 'active';
			else if (isMostRecent && phase === 'done') state = 'done';
			else if (isMostRecent) state = 'neutral';
			else {
				state = 'fellback';
				tooltip += ' Fell back this run — the job switched to another engine partway through.';
			}
		} else if (unavailable) {
			state = 'unavailable';
			tooltip +=
				id === 'webcodecs' && file && fileDecodeSupport === 'unsupported'
					? " This file's video couldn't be decoded this way, so it's sitting this run out."
					: ' Not available in this browser or device.';
		} else if (id === 'webcodecs' && !!file && fileDecodeSupport === 'checking') {
			state = 'checking';
			tooltip += ' Checking whether this file can be decoded this way…';
		} else if (phase !== 'working' && phase !== 'done' && id === plannedEngine) {
			state = 'planned';
		} else {
			state = 'neutral';
		}

		return { id, label: info.label, tooltip, state };
	});

	return (
		<div className="w-full max-w-6xl mx-auto flex-1 flex flex-col">
			{/* Hero: the portfolio's eyebrow, giant uppercase display headline and intro */}
			<div className="mb-10 md:mb-14">
				<p className="mono !text-ink flex items-center gap-2.5 animate-rise">
					<span className="eyebrow-dot" aria-hidden="true" />
					Runs entirely in your browser
				</p>
				<h1
					className="mt-5 font-display font-black uppercase leading-[0.84] tracking-[-0.01em] text-ink text-[clamp(56px,10vw,150px)] animate-rise"
					style={{ '--d': '80ms' } as React.CSSProperties}
				>
					Shrink your <em className="not-italic text-accent">videos.</em>
				</h1>
				<p
					className="mt-5 max-w-[46ch] text-ink-2 text-[clamp(17px,1.45vw,20px)] leading-[1.45] animate-rise"
					style={{ '--d': '160ms' } as React.CSSProperties}
				>
					Got a video that&rsquo;s too big to send? Drop it in, tell it how small it needs to be, and it&rsquo;ll shrink
					itself right here &mdash; nothing gets uploaded anywhere.
				</p>
				<button
					type="button"
					onClick={() => setHowItWorksOpen(true)}
					className="link mt-4 text-[15px] animate-rise"
					style={{ '--d': '220ms' } as React.CSSProperties}
				>
					How does this work?
				</button>
			</div>

			{/* One unified panel: video + engine status on the left, settings on the right,
			    divided by hairlines instead of separate floating cards — the two sides
			    are always the same height since they're one grid row. */}
			<div
				className="rounded-md border border-faint bg-bg-2 overflow-hidden animate-rise"
				style={{ '--d': '300ms' } as React.CSSProperties}
			>
				<div className="grid md:grid-cols-[1.4fr_1fr]">
					{/* left: your video + engine status */}
					<div className="flex flex-col border-b md:border-b-0 md:border-r border-faint">
						<div className="p-5 md:p-7 border-b border-faint">
							<SectionLabel index="01" title="Your video" />

							<div
								onDragOver={(e) => {
									e.preventDefault();
									setIsDragging(true);
								}}
								onDragLeave={() => setIsDragging(false)}
								onDrop={onDrop}
								className={`rounded-md border border-dashed px-6 py-8 text-center transition-colors duration-300 ${
									isDragging ? 'border-accent bg-accent/5' : 'border-faint hover:border-dim'
								}`}
							>
								{showResult ? (
									<div key="result" className="animate-fade-in">
										{reductionPct !== null && (
											<p className="font-display font-black uppercase leading-[0.86] text-[clamp(48px,6vw,80px)] text-ink">
												<span className="text-accent">{reductionPct}%</span> smaller
											</p>
										)}
										<p className="mono mt-3">
											{formatBytes(resultBlob!.size)} &middot; was {file ? formatBytes(file.size) : '?'}
											{resultDuration != null ? ` · ${formatDuration(resultDuration)}` : ''}
										</p>
										{sizeWarning && (
											<p className="mt-3 text-sm text-accent-2 max-w-xs mx-auto">
												This came out larger than your target &mdash; the target was too small for this video even after
												repeatedly reducing quality to try to fit it.
											</p>
										)}
										<div className="mt-6 flex items-center justify-center gap-2.5 flex-wrap">
											<a href={resultUrl!} download={outputName} className="btn btn-primary">
												Download <span className="arrow">&darr;</span>
											</a>
											<button type="button" onClick={dismissResult} className="btn">
												Compress another
											</button>
										</div>
									</div>
								) : (
									<>
										{file ? (
											<div key="file" className="animate-fade-in">
												<CheckCircleIcon className="h-7 w-7 mx-auto mb-3 text-accent" />
												<p className="font-medium break-all text-ink">{file.name}</p>
												<p className="mono mt-1.5">{formatBytes(file.size)}</p>
											</div>
										) : (
											<>
												<UploadIcon className="h-7 w-7 mx-auto mb-3 text-dim" />
												<p className="font-display text-[34px] font-extrabold uppercase leading-none tracking-[0.01em] text-ink">
													Drop a video here
												</p>
												<p className="text-sm text-dim mt-2">or choose a file below</p>
											</>
										)}

										<div className="mt-5 flex items-center justify-center gap-4 flex-wrap">
											<input
												ref={fileInputRef}
												type="file"
												accept={VIDEO_ACCEPT}
												className="hidden"
												onChange={(e) => {
													const picked = e.target.files?.[0];
													if (picked) handleFile(picked);
													e.target.value = '';
												}}
											/>
											<button type="button" onClick={() => fileInputRef.current?.click()} className="btn">
												Browse files
											</button>
											<button type="button" onClick={() => setShowUrlInput((v) => !v)} className="link text-sm">
												or paste a URL
											</button>
										</div>

										{showUrlInput && (
											<div className="flex gap-2 mt-5 animate-fade-in">
												<input
													type="url"
													value={urlValue}
													onChange={(e) => setUrlValue(e.target.value)}
													placeholder="https://example.com/video.mp4"
													className="field flex-1 min-w-0 px-3 py-2"
												/>
												<button
													type="button"
													onClick={onLoadUrl}
													disabled={urlLoading || !urlValue.trim()}
													className="btn !py-2 !px-4 text-sm"
												>
													{urlLoading ? 'Loading…' : 'Load'}
												</button>
											</div>
										)}
									</>
								)}
							</div>
						</div>

						<div className="p-5 md:p-7 flex-1 flex flex-col">
							<EngineStatus
								statusText={
									phase === 'working' ? stage : phase === 'done' ? 'Ready' : phase === 'error' ? 'Idle' : 'Not loaded'
								}
								chips={engineChips}
								logLines={logLines}
								onDiagnose={() => setDiagnosticsOpen(true)}
							/>
						</div>
					</div>

					{/* right: settings */}
					<div className="p-5 md:p-7 flex flex-col">
						<SectionLabel index="02" title="Settings" />

						<div>
							<p className="mono mb-3">Target size</p>
							<div className="flex flex-wrap gap-2">
								{PRESETS.map((preset) => (
									<button
										key={preset.value}
										type="button"
										onClick={() => setSizePreset(preset.value)}
										aria-pressed={sizePreset === preset.value}
										className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors duration-300 ${
											sizePreset === preset.value
												? 'bg-accent border-accent text-on-accent'
												: 'border-faint text-ink hover:border-ink'
										}`}
									>
										{preset.label}
									</button>
								))}
								{/* Custom is an inline pill-shaped input, not a toggle that reveals a
								    separate field below — typing (or focusing) it just selects it. */}
								<label
									className={`flex items-center gap-1 rounded-full border pl-4 pr-3 transition-colors duration-300 ${
										sizePreset === 'custom'
											? 'bg-accent border-accent text-on-accent'
											: 'border-faint text-ink hover:border-ink'
									}`}
								>
									<input
										type="number"
										min="0"
										step="0.1"
										value={customSizeMB}
										onFocus={() => setSizePreset('custom')}
										onChange={(e) => {
											setSizePreset('custom');
											setCustomSizeMB(e.target.value);
										}}
										placeholder="Custom"
										className={`w-20 bg-transparent py-2 text-sm font-medium focus:outline-none focus-visible:!outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
											sizePreset === 'custom' ? 'placeholder:text-on-accent/60' : 'placeholder:text-ink'
										}`}
									/>
									<span className="text-xs opacity-70">MB</span>
								</label>
							</div>
						</div>

						<div className="mt-6 pt-5 border-t border-faint space-y-4">
							<p className="mono">Options</p>

							<Switch checked={muteAudio} onChange={setMuteAudio} label="Remove all sound" description="Mutes the output entirely" />

							<Switch
								checked={extraQuality}
								onChange={setExtraQuality}
								label="Extra quality"
								description="Slower 2-pass encode, lands closer to your target size"
							/>

							<div>
								<Switch
									checked={trimEnabled}
									onChange={setTrimEnabled}
									label="Trim the clip"
									description="Cut time off the start and/or end"
								/>
								{trimEnabled && (
									<div className="flex items-center gap-2 flex-wrap text-sm text-dim mt-3 animate-fade-in">
										<span>Skip first</span>
										<input
											type="number"
											min="0"
											value={trimStart}
											onChange={(e) => setTrimStart(e.target.value)}
											className="field w-16 px-2 py-1"
										/>
										<span>sec &middot; last</span>
										<input
											type="number"
											min="0"
											value={trimEnd}
											onChange={(e) => setTrimEnd(e.target.value)}
											className="field w-16 px-2 py-1"
										/>
										<span>sec</span>
									</div>
								)}
							</div>

							<Switch checked={playSound} onChange={setPlaySound} label="Play a sound when done" />
							<Switch checked={autoDownload} onChange={setAutoDownload} label="Auto download when done" />

							<div className="flex items-center justify-between gap-4">
								<label htmlFor="resolution" className="text-[15px] text-ink">
									Resolution
								</label>
								<select
									id="resolution"
									value={resolution}
									onChange={(e) => setResolution(e.target.value as Resolution)}
									className="field px-2 py-1.5"
								>
									<option value="original">Original</option>
									<option value="1080">1080p</option>
									<option value="720">720p</option>
									<option value="480">480p</option>
									<option value="360">360p</option>
								</select>
							</div>
						</div>

						<div className="mt-auto pt-6">
							<div className="border-t border-faint pt-5">
								<button
									type="button"
									onClick={handleCompress}
									disabled={!file || !isValidTargetSize || isProcessing || fileDecodeSupport === 'checking' || phase === 'done'}
									className="btn btn-primary w-full !py-4 !text-base !font-semibold"
								>
									{isProcessing ? (
										`${stage}${showPercent ? ` ${Math.round(progress * 100)}%` : ''}`
									) : phase === 'done' ? (
										'Compressed ✓'
									) : fileDecodeSupport === 'checking' ? (
										'Checking video…'
									) : (
										<>
											Compress <span className="arrow">&rarr;</span>
										</>
									)}
								</button>

								{/* the portfolio's scroll-progress bar, as the encode's progress */}
								{isProcessing && (
									<div className="mt-4 h-0.5 w-full bg-faint overflow-hidden">
										<div
											className="h-full bg-accent origin-left transition-transform duration-200"
											style={{ transform: `scaleX(${progress})` }}
										/>
									</div>
								)}

								{errorMessage && <p className="mt-4 text-sm text-danger text-center animate-fade-in">{errorMessage}</p>}
							</div>
						</div>
					</div>
				</div>
			</div>

			<DiagnosticsPanel
				open={diagnosticsOpen}
				onClose={() => setDiagnosticsOpen(false)}
				decodeProbe={decodeProbeResult}
				fileDecodeSupport={fileDecodeSupport}
			/>

			<Modal open={howItWorksOpen} onClose={() => setHowItWorksOpen(false)} title="How this works">
				<p>
					Everything happens right here in your browser &mdash; your video is never uploaded to a server. There&rsquo;s
					nothing to wait on and nothing to trust with your files.
				</p>
				<div>
					<p className="mono !text-ink mb-2">Two engines</p>
					<p>
						When your browser supports it, compression runs through{' '}
						<a
							href="https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API"
							target="_blank"
							rel="noopener noreferrer"
							className="link"
						>
							WebCodecs
						</a>
						, a browser API that taps into your device&rsquo;s actual hardware video encoder &mdash; dedicated silicon
						built for exactly this, giving you the same kind of speed you&rsquo;d get from a native app. Getting there
						relies on{' '}
						<a href="https://github.com/Vanilagy/mediabunny" target="_blank" rel="noopener noreferrer" className="link">
							mediabunny
						</a>{' '}
						to handle the demuxing/muxing around it.
					</p>
					<p className="mt-2">
						If that&rsquo;s not available (or it can&rsquo;t decode/encode this particular video), it falls back to a
						WebAssembly build of{' '}
						<a href="https://ffmpeg.org/" target="_blank" rel="noopener noreferrer" className="link">
							ffmpeg
						</a>{' '}
						doing all the video math in JavaScript on your CPU instead. It works in almost any browser, but with no
						dedicated hardware to lean on, it&rsquo;s a lot slower &mdash; think several times to tens of times slower,
						depending on the video.
					</p>
				</div>
				<div>
					<p className="mono !text-ink mb-2">Speed depends on your device</p>
					<p>
						Since software encoding runs on your CPU with no hardware to lean on, it scales directly with how strong
						your device is &mdash; a fast desktop chews through a video in seconds, while an older or weaker machine
						can take noticeably longer.
					</p>
					<p className="mt-2">
						Mobile is the toughest case. Hardware encoding sessions are more resource-constrained on phones, so
						there&rsquo;s a higher chance it falls back to software &mdash; and that software fallback runs
						single-core on mobile on purpose, since the faster multi-core version has crashed on real phones during
						testing. Desktops get the full multi-core fallback <em>and</em> more reliable hardware access, so for the
						fastest, most consistent results, use this on a desktop or laptop rather than your phone.
					</p>
				</div>
			</Modal>

			{/* Footer: the portfolio's slim bar */}
			<footer className="mt-auto pt-16">
				<div className="flex flex-wrap items-center justify-between gap-3 border-t border-faint py-5">
					<p className="mono">
						Built by{' '}
						<a href="https://jeydinpham.com" target="_blank" rel="noopener noreferrer" className="link !text-ink">
							Jeydin Pham
						</a>
					</p>
					<a
						href="https://github.com/jeydinpham/shrink-engine"
						target="_blank"
						rel="noopener noreferrer"
						className="mono link !text-dim hover:!text-accent"
					>
						Source on GitHub &rarr;
					</a>
				</div>
			</footer>
		</div>
	);
}

/** A panel section header: a mono index and title, like the portfolio's section labels. */
function SectionLabel({ index, title }: { index: string; title: string }) {
	return (
		<p className="mono mb-5 flex items-center gap-3">
			<span className="text-accent">{index}</span>
			<span className="h-px w-6 bg-faint" aria-hidden="true" />
			<span className="text-ink">{title}</span>
		</p>
	);
}
