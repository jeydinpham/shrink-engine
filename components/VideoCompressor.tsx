import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Disclosure } from './Disclosure';
import { formatBytes, formatDuration } from '@/lib/format';
import { looksLikeVideoFile, VIDEO_ACCEPT } from '@/lib/fileTypes';
import { playCompletionSound } from '@/lib/sound';
import { CompressOptions, Resolution } from '@/lib/compress';
import { compressVideo, CompressionPhase } from '@/lib/runCompression';
import { canUseMultiThreaded } from '@/lib/ffmpeg';

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
	const [engineMode, setEngineMode] = useState<'unknown' | 'single' | 'multi'>('unknown');

	const fileInputRef = useRef<HTMLInputElement>(null);
	const logEndRef = useRef<HTMLDivElement>(null);
	const autoDownloadedUrlRef = useRef<string | null>(null);

	useEffect(() => {
		setMultiThreadCapable(canUseMultiThreaded());
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
		setStage('Loading engine (first time only, ~30MB)…');
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
				onEngineReady: (multiThreaded) => setEngineMode(multiThreaded ? 'multi' : 'single'),
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

	return (
		<div className="w-full max-w-2xl mx-auto">
			<div className="text-center mb-8">
				<h1 className="text-4xl md:text-5xl font-extrabold mb-3">
					video<span className="text-green-400">compressor</span>
				</h1>
				<p className="text-gray-400">Shrink a video to a target file size, entirely in your browser.</p>
			</div>

			<div
				onDragOver={(e) => {
					e.preventDefault();
					setIsDragging(true);
				}}
				onDragLeave={() => setIsDragging(false)}
				onDrop={onDrop}
				className={`rounded-xl border-2 border-dashed p-6 md:p-8 transition-colors ${
					isDragging ? 'border-green-400 bg-green-950/20' : 'border-green-700/70'
				}`}
			>
				<div className="text-center mb-6">
					{file ? (
						<>
							<p className="font-medium break-all">{file.name}</p>
							<p className="text-sm text-gray-400">{formatBytes(file.size)}</p>
						</>
					) : (
						<>
							<p className="text-lg">Drag &amp; Drop Here</p>
							<p className="text-gray-400">or click the browse button.</p>
						</>
					)}
				</div>

				<div className="flex items-center justify-center gap-4 mb-6 flex-wrap">
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
						className="px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 font-medium"
					>
						Browse…
					</button>
					<button
						type="button"
						onClick={() => setShowUrlInput((v) => !v)}
						className="text-green-400 underline underline-offset-2 hover:text-green-300"
					>
						or enter URL
					</button>
				</div>

				{showUrlInput && (
					<div className="flex gap-2 mb-6">
						<input
							type="url"
							value={urlValue}
							onChange={(e) => setUrlValue(e.target.value)}
							placeholder="https://example.com/video.mp4"
							className="flex-1 min-w-0 rounded-md bg-gray-900 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-green-500"
						/>
						<button
							type="button"
							onClick={onLoadUrl}
							disabled={urlLoading || !urlValue.trim()}
							className="px-3 py-2 rounded-md bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-sm font-medium"
						>
							{urlLoading ? 'Loading…' : 'Load'}
						</button>
					</div>
				)}

				<div className="flex items-center justify-center gap-x-6 gap-y-2 flex-wrap mb-3">
					{PRESETS.map((preset) => (
						<label key={preset.value} className="flex items-center gap-2 cursor-pointer">
							<input
								type="radio"
								name="size-preset"
								checked={sizePreset === preset.value}
								onChange={() => setSizePreset(preset.value)}
								className="accent-green-500"
							/>
							{preset.label}
						</label>
					))}
				</div>
				<div className="flex items-center justify-center gap-2 mb-6">
					<label className="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							name="size-preset"
							checked={sizePreset === 'custom'}
							onChange={() => setSizePreset('custom')}
							className="accent-green-500"
						/>
						Custom:
					</label>
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
						className="w-24 rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-sm focus:outline-none focus:border-green-500"
					/>
					<span className="text-gray-400 text-sm">MB</span>
				</div>

				<div className="mb-6">
					<Disclosure title="Options">
						<div className="space-y-3 pt-2">
							<label className="flex items-center gap-3 cursor-pointer">
								<input
									type="checkbox"
									checked={muteAudio}
									onChange={(e) => setMuteAudio(e.target.checked)}
									className="accent-green-500 w-4 h-4 shrink-0"
								/>
								<span className="text-sm text-gray-200">Remove all sound (mute)</span>
							</label>

							<label className="flex items-center gap-3 cursor-pointer">
								<input
									type="checkbox"
									checked={extraQuality}
									onChange={(e) => setExtraQuality(e.target.checked)}
									className="accent-green-500 w-4 h-4 shrink-0"
								/>
								<span className="text-sm text-gray-200">
									Extra quality (slower)
									<span className="block text-xs text-gray-500">Also lands closer to your target size (2-pass encoding)</span>
								</span>
							</label>

							<div className="flex items-center gap-3 flex-wrap">
								<label className="flex items-center gap-3 cursor-pointer">
									<input
										type="checkbox"
										checked={trimEnabled}
										onChange={(e) => setTrimEnabled(e.target.checked)}
										className="accent-green-500 w-4 h-4 shrink-0"
									/>
								</label>
								<div
									className={`flex items-center gap-2 flex-wrap text-sm ${
										trimEnabled ? 'text-gray-200' : 'text-gray-500'
									}`}
								>
									<span>Skip the first</span>
									<input
										type="number"
										min="0"
										disabled={!trimEnabled}
										value={trimStart}
										onChange={(e) => setTrimStart(e.target.value)}
										className="w-16 rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-sm focus:outline-none focus:border-green-500 disabled:opacity-50"
									/>
									<span>seconds / the last</span>
									<input
										type="number"
										min="0"
										disabled={!trimEnabled}
										value={trimEnd}
										onChange={(e) => setTrimEnd(e.target.value)}
										className="w-16 rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-sm focus:outline-none focus:border-green-500 disabled:opacity-50"
									/>
									<span>seconds</span>
								</div>
							</div>

							<label className="flex items-center gap-3 cursor-pointer">
								<input
									type="checkbox"
									checked={playSound}
									onChange={(e) => setPlaySound(e.target.checked)}
									className="accent-green-500 w-4 h-4 shrink-0"
								/>
								<span className="text-sm text-gray-200">Play a sound when done</span>
							</label>

							<label className="flex items-center gap-3 cursor-pointer">
								<input
									type="checkbox"
									checked={autoDownload}
									onChange={(e) => setAutoDownload(e.target.checked)}
									className="accent-green-500 w-4 h-4 shrink-0"
								/>
								<span className="text-sm text-gray-200">Auto download when done</span>
							</label>

							<div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-800">
								<label htmlFor="resolution" className="text-sm text-gray-300">
									Resolution
								</label>
								<select
									id="resolution"
									value={resolution}
									onChange={(e) => setResolution(e.target.value as Resolution)}
									className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-sm focus:outline-none focus:border-green-500"
								>
									<option value="original">Original</option>
									<option value="1080">1080p</option>
									<option value="720">720p</option>
									<option value="480">480p</option>
									<option value="360">360p</option>
								</select>
							</div>
						</div>
					</Disclosure>
				</div>

				<button
					type="button"
					onClick={handleCompress}
					disabled={!file || !isValidTargetSize || isProcessing}
					className="w-full py-3 rounded-md bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-lg transition-colors"
				>
					{isProcessing ? `${stage}${showPercent ? ` ${Math.round(progress * 100)}%` : ''}` : 'Compress'}
				</button>

				{isProcessing && (
					<div className="mt-3 h-2 w-full rounded-full bg-gray-800 overflow-hidden">
						<div
							className="h-full bg-green-500 transition-all duration-200"
							style={{ width: `${Math.round(progress * 100)}%` }}
						/>
					</div>
				)}

				{errorMessage && <p className="mt-4 text-sm text-red-400 text-center">{errorMessage}</p>}

				{phase === 'done' && resultBlob && resultUrl && (
					<div className="mt-6 rounded-lg border border-green-700/60 bg-green-950/20 p-4 text-center">
						<p className="font-semibold">
							{formatBytes(resultBlob.size)}{' '}
							<span className="text-gray-400 font-normal">
								(was {file ? formatBytes(file.size) : '?'}
								{resultDuration != null ? `, ${formatDuration(resultDuration)}` : ''})
							</span>
						</p>
						{sizeWarning && (
							<p className="mt-1 text-xs text-yellow-400">
								This target was very small for the video length &mdash; quality had to be reduced heavily to get close.
							</p>
						)}
						<a
							href={resultUrl}
							download={outputName}
							className="mt-3 inline-block px-5 py-2 rounded-md bg-green-600 hover:bg-green-500 font-semibold"
						>
							Download
						</a>
						<button
							type="button"
							onClick={() => {
								setFile(null);
								resetResult();
							}}
							className="mt-3 ml-3 inline-block px-5 py-2 rounded-md bg-gray-700 hover:bg-gray-600 font-semibold"
						>
							Compress another
						</button>
					</div>
				)}
			</div>

			<div className="mt-4">
				<Disclosure title="Engine Status">
					<div className="space-y-2 pt-2">
						<p className="text-sm">
							<span className="text-gray-400">Status: </span>
							{phase === 'working' ? stage : phase === 'done' ? 'Ready' : phase === 'error' ? 'Idle' : 'Not loaded'}
						</p>
						<p className="text-sm">
							<span className="text-gray-400">Engine: </span>
							{engineMode === 'multi'
								? 'multi-threaded (using multiple CPU cores)'
								: engineMode === 'single'
									? 'single-threaded'
									: multiThreadCapable
										? 'multi-threaded available, loads on first compress'
										: 'single-threaded (multi-core unavailable in this context)'}
						</p>
						<div className="h-32 overflow-y-auto rounded-md bg-black/60 border border-gray-800 p-2 font-mono text-[11px] text-gray-400 leading-relaxed">
							{logLines.length === 0 ? (
								<p className="text-gray-600">No activity yet.</p>
							) : (
								logLines.map((line, i) => <div key={i}>{line}</div>)
							)}
							<div ref={logEndRef} />
						</div>
					</div>
				</Disclosure>
			</div>
		</div>
	);
}
