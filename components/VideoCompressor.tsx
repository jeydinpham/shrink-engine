import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Disclosure } from './Disclosure';
import { Switch } from './Switch';
import { formatBytes, formatDuration } from '@/lib/format';
import { looksLikeVideoFile, VIDEO_ACCEPT } from '@/lib/fileTypes';
import { playCompletionSound } from '@/lib/sound';
import { CompressOptions, EngineUsed, Resolution } from '@/lib/compress';
import { compressVideo, CompressionPhase } from '@/lib/compressVideo';
import { canUseMultiThreaded } from '@/lib/ffmpeg';
import { canUseWebCodecs } from '@/lib/webCodecsCompress';

type SizePreset = '8' | '25' | '50' | '100' | 'custom';

type Phase = 'idle' | 'working' | 'done' | 'error';

const PRESETS: { value: SizePreset; label: string }[] = [
	{ value: '8', label: '8MB' },
	{ value: '25', label: '25MB' },
	{ value: '50', label: '50MB' },
	{ value: '100', label: '100MB' },
];

const STAGE_LABEL: Record<CompressionPhase, string> = {
	probing: 'Reading video…',
	encoding: 'Encoding…',
	pass1: 'Encoding (pass 1 of 2)…',
	pass2: 'Encoding (pass 2 of 2)…',
};

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

	const [showUrlInput, setShowUrlInput] = useState(false);
	const [urlValue, setUrlValue] = useState('');
	const [urlLoading, setUrlLoading] = useState(false);

	const [sizePreset, setSizePreset] = useState<SizePreset>('8');
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

	const fileInputRef = useRef<HTMLInputElement>(null);
	const logEndRef = useRef<HTMLDivElement>(null);
	const autoDownloadedUrlRef = useRef<string | null>(null);

	useEffect(() => {
		setMultiThreadCapable(canUseMultiThreaded());
		setWebCodecsCapable(canUseWebCodecs());
	}, []);

	useEffect(() => {
		if (!resultBlob) {
			setResultUrl(null);
			return;
		}
		const url = URL.createObjectURL(resultBlob);
		setResultUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [resultBlob]);

	useEffect(() => {
		logEndRef.current?.scrollIntoView({ block: 'nearest' });
	}, [logLines]);

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

	const appendLog = useCallback((message: string) => {
		setLogLines((prev) => (prev.length > 200 ? [...prev.slice(-200), message] : [...prev, message]));
	}, []);

	const resetResult = useCallback(() => {
		setResultBlob(null);
		setResultDuration(null);
		setErrorMessage(null);
		setSizeWarning(false);
		setPhase('idle');
		setStage('Not loaded');
		setProgress(0);
	}, []);

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
		setLogLines([]);
		setPhase('working');
		setStage('Starting…');
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

			const result = await compressVideo(file, options, {
				onLog: appendLog,
				onEngineReady: setEngineMode,
				onPhase: (p) => {
					setStage(STAGE_LABEL[p]);
					setProgress(0);
				},
				onProgress: setProgress,
			});

			setResultBlob(result.blob);
			setResultDuration(result.durationSeconds);
			setSizeWarning(result.belowMinimum);
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
	]);

	const showPercent = stage.startsWith('Encoding');
	const reductionPct = file && resultBlob ? Math.max(0, Math.round((1 - resultBlob.size / file.size) * 100)) : null;

	return (
		<div className="w-full max-w-5xl mx-auto">
			{/* Hero */}
			<div className="mb-10 max-w-2xl">
				<p className="font-mono text-xs uppercase tracking-[0.2em] text-primary mb-3">a tool by jeydin</p>
				<h1 className="font-display text-4xl md:text-6xl font-semibold tracking-tight text-foreground mb-4">
					shrink your videos.
				</h1>
				<p className="text-muted-foreground">
					Drop in a video, pick a target size, and it compresses right in your browser &mdash; no upload, no server.
				</p>
			</div>

			<div className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:grid-rows-[auto_auto] items-start">
				{/* 01 — your video */}
				<div className="md:col-start-1 md:row-start-1 rounded-2xl border border-border bg-card shadow-xl shadow-black/20 p-6 md:p-8">
					<p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground mb-5">01 — your video</p>

					<div
						onDragOver={(e) => {
							e.preventDefault();
							setIsDragging(true);
						}}
						onDragLeave={() => setIsDragging(false)}
						onDrop={onDrop}
						className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
							isDragging ? 'border-primary bg-primary/5' : 'border-border'
						}`}
					>
						{file ? (
							<>
								<CheckCircleIcon className="h-8 w-8 mx-auto mb-3 text-secondary-foreground" />
								<p className="font-medium break-all text-foreground">{file.name}</p>
								<p className="text-sm text-muted-foreground">{formatBytes(file.size)}</p>
							</>
						) : (
							<>
								<UploadIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
								<p className="font-medium text-foreground">Drag &amp; drop a video</p>
								<p className="text-sm text-muted-foreground">or choose a file below</p>
							</>
						)}

						<div className="mt-5 flex items-center justify-center gap-3 flex-wrap">
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
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								className="px-4 py-2 rounded-full bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
							>
								Browse files
							</button>
							<button
								type="button"
								onClick={() => setShowUrlInput((v) => !v)}
								className="text-sm text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary"
							>
								or paste a URL
							</button>
						</div>

						{showUrlInput && (
							<div className="flex gap-2 mt-4">
								<input
									type="url"
									value={urlValue}
									onChange={(e) => setUrlValue(e.target.value)}
									placeholder="https://example.com/video.mp4"
									className="flex-1 min-w-0 rounded-lg bg-background border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
								/>
								<button
									type="button"
									onClick={onLoadUrl}
									disabled={urlLoading || !urlValue.trim()}
									className="px-3 py-2 rounded-lg bg-secondary text-secondary-foreground disabled:opacity-50 text-sm font-medium"
								>
									{urlLoading ? 'Loading…' : 'Load'}
								</button>
							</div>
						)}
					</div>
				</div>

				{/* 02 — settings (spans both rows, sticks alongside on desktop) */}
				<div className="md:col-start-2 md:row-start-1 md:row-span-2 md:sticky md:top-6 rounded-2xl border border-border bg-card shadow-xl shadow-black/20 p-6 md:p-8 space-y-6">
					<p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">02 — settings</p>

					<div>
						<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Target size</p>
						<div className="flex flex-wrap gap-2">
							{PRESETS.map((preset) => (
								<button
									key={preset.value}
									type="button"
									onClick={() => setSizePreset(preset.value)}
									className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
										sizePreset === preset.value
											? 'bg-primary text-primary-foreground'
											: 'bg-muted text-foreground hover:bg-accent'
									}`}
								>
									{preset.label}
								</button>
							))}
							<button
								type="button"
								onClick={() => setSizePreset('custom')}
								className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
									sizePreset === 'custom' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent'
								}`}
							>
								Custom
							</button>
						</div>
						{sizePreset === 'custom' && (
							<div className="flex items-center gap-2 mt-3">
								<input
									type="number"
									min="0"
									step="0.1"
									autoFocus
									value={customSizeMB}
									onChange={(e) => setCustomSizeMB(e.target.value)}
									placeholder="e.g. 15"
									className="w-24 rounded-lg bg-background border border-border px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
								/>
								<span className="text-sm text-muted-foreground">MB</span>
							</div>
						)}
					</div>

					<div className="space-y-4 pt-2 border-t border-border">
						<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-4">Options</p>

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
								<div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground mt-3 pl-1">
									<span>Skip first</span>
									<input
										type="number"
										min="0"
										value={trimStart}
										onChange={(e) => setTrimStart(e.target.value)}
										className="w-16 rounded-lg bg-background border border-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
									/>
									<span>sec &middot; last</span>
									<input
										type="number"
										min="0"
										value={trimEnd}
										onChange={(e) => setTrimEnd(e.target.value)}
										className="w-16 rounded-lg bg-background border border-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
									/>
									<span>sec</span>
								</div>
							)}
						</div>

						<Switch checked={playSound} onChange={setPlaySound} label="Play a sound when done" />
						<Switch checked={autoDownload} onChange={setAutoDownload} label="Auto download when done" />

						<div className="flex items-center justify-between gap-4">
							<label htmlFor="resolution" className="text-sm text-foreground">
								Resolution
							</label>
							<select
								id="resolution"
								value={resolution}
								onChange={(e) => setResolution(e.target.value as Resolution)}
								className="rounded-lg bg-background border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
							>
								<option value="original">Original</option>
								<option value="1080">1080p</option>
								<option value="720">720p</option>
								<option value="480">480p</option>
								<option value="360">360p</option>
							</select>
						</div>
					</div>

					<div className="pt-2 border-t border-border">
						<button
							type="button"
							onClick={handleCompress}
							disabled={!file || !isValidTargetSize || isProcessing}
							className="mt-4 w-full py-3.5 rounded-full bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-lg hover:opacity-90 transition-opacity"
						>
							{isProcessing ? `${stage}${showPercent ? ` ${Math.round(progress * 100)}%` : ''}` : 'Compress'}
						</button>

						{isProcessing && (
							<div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
								<div
									className="h-full bg-primary transition-all duration-200"
									style={{ width: `${Math.round(progress * 100)}%` }}
								/>
							</div>
						)}

						{errorMessage && <p className="mt-4 text-sm text-red-400 text-center">{errorMessage}</p>}
					</div>
				</div>

				{/* Result + diagnostics */}
				<div className="md:col-start-1 md:row-start-2 space-y-4">
					{phase === 'done' && resultBlob && resultUrl && (
						<div className="rounded-2xl border border-secondary/50 bg-secondary/10 p-6 text-center">
							{reductionPct !== null && (
								<p className="font-display text-3xl font-semibold text-secondary-foreground">{reductionPct}% smaller</p>
							)}
							<p className="text-sm text-muted-foreground mt-1">
								{formatBytes(resultBlob.size)} (was {file ? formatBytes(file.size) : '?'}
								{resultDuration != null ? `, ${formatDuration(resultDuration)}` : ''})
							</p>
							{sizeWarning && (
								<p className="mt-2 text-xs text-yellow-500">
									This target was very small for the video length &mdash; quality had to be reduced heavily to get close.
								</p>
							)}
							<div className="mt-4 flex items-center justify-center gap-3">
								<a
									href={resultUrl}
									download={outputName}
									className="px-5 py-2 rounded-full bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
								>
									Download
								</a>
								<button
									type="button"
									onClick={() => {
										setFile(null);
										resetResult();
									}}
									className="px-5 py-2 rounded-full bg-muted text-foreground font-semibold hover:bg-accent transition-colors"
								>
									Compress another
								</button>
							</div>
						</div>
					)}

					<Disclosure title="Engine status">
						<div className="space-y-2 pt-2">
							<p className="text-sm text-foreground">
								<span className="text-muted-foreground">Status: </span>
								{phase === 'working' ? stage : phase === 'done' ? 'Ready' : phase === 'error' ? 'Idle' : 'Not loaded'}
							</p>
							<p className="text-sm text-foreground">
								<span className="text-muted-foreground">Engine: </span>
								{engineMode === 'webcodecs'
									? 'hardware-accelerated (WebCodecs)'
									: engineMode === 'multi'
										? 'multi-threaded (software, using multiple CPU cores)'
										: engineMode === 'single'
											? 'single-threaded (software)'
											: webCodecsCapable
												? 'hardware-accelerated available, used first on compress'
												: multiThreadCapable
													? 'multi-threaded software engine available, loads on first compress'
													: 'single-threaded software engine (multi-core unavailable in this context)'}
							</p>
							<div className="h-32 overflow-y-auto rounded-lg bg-background border border-border p-2 font-mono text-[11px] text-muted-foreground leading-relaxed">
								{logLines.length === 0 ? (
									<p className="text-muted-foreground/60">No activity yet.</p>
								) : (
									logLines.map((line, i) => <div key={i}>{line}</div>)
								)}
								<div ref={logEndRef} />
							</div>
						</div>
					</Disclosure>
				</div>
			</div>

			{/* Footer */}
			<p className="mt-8 text-center text-xs font-mono text-muted-foreground">
				built by{' '}
				<a
					href="https://jeydinpham.com"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary hover:underline underline-offset-4"
				>
					Jeydin Pham
				</a>{' '}
				&middot; runs entirely in your browser
			</p>
		</div>
	);
}
