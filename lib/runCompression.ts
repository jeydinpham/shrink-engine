import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { getFFmpeg, terminateMultiThreaded, LoadedEngine } from './ffmpeg';
import { CompressOptions, EngineUsed, MIN_VIDEO_BITRATE_KBPS, buildScaleFilter, getFileExtension, planBitrate } from './compress';
import { probeVideo } from './probe';

export interface CompressionResult {
	blob: Blob;
	sizeBytes: number;
	/** True when the target was unreachable even at the minimum viable bitrate — nothing more retrying can do. */
	belowMinimum: boolean;
	durationSeconds: number;
	/** The video bitrate actually used to produce this result — lets a caller compute a smaller one for a retry. Not set by the WebCodecs path, which has no equivalent retry loop. */
	videoBitrateKbps?: number;
}

export type CompressionPhase = 'probing' | 'encoding' | 'pass1' | 'pass2';

export interface CompressionCallbacks {
	onLog?: (message: string) => void;
	onPhase?: (phase: CompressionPhase) => void;
	/** progress in [0, 1] across the whole job */
	onProgress?: (progress: number) => void;
	/** Fires whenever an encode attempt starts, including the retry after a stall. */
	onEngineReady?: (engine: EngineUsed) => void;
}

// Last-resort safety net in case a command hangs for a reason the stall
// watchdog below doesn't catch — surfaces an error instead of spinning
// forever.
const EXEC_TIMEOUT_MS = 5 * 60 * 1000;

// The multi-threaded core has a reproducible hang the instant libx264
// starts encoding frames at real-world resolutions: it never emits a single
// "frame=" progress update. 15s of total silence (reset on every progress
// event, so a merely slow-but-alive job never trips it) is long enough to
// tell a stall apart from real work.
const STALL_WATCHDOG_MS = 15_000;

class StallError extends Error {}

/** A failure that's about the user's input, not the engine — retrying on a different engine wouldn't help. */
class InputError extends Error {}

function withProgress(ffmpeg: FFmpeg, map: (progress: number) => void) {
	const handler = ({ progress }: { progress: number }) => map(Math.min(Math.max(progress, 0), 1));
	ffmpeg.on('progress', handler);
	return () => ffmpeg.off('progress', handler);
}

/** Runs one ffmpeg command, optionally tripping a StallError if no progress event arrives within watchdogMs. */
function run(ffmpeg: FFmpeg, args: string[], step: string, watchdogMs: number | null): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const clearWatchdog = () => {
			if (timer) clearTimeout(timer);
		};
		const armWatchdog = () => {
			if (!watchdogMs) return;
			clearWatchdog();
			timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				ffmpeg.off('progress', progressHandler);
				reject(new StallError(`No encoding progress for ${watchdogMs}ms during ${step}`));
			}, watchdogMs);
		};
		const progressHandler = () => armWatchdog();

		ffmpeg.on('progress', progressHandler);
		armWatchdog();

		ffmpeg
			.exec(args, EXEC_TIMEOUT_MS)
			.then((ret) => {
				if (settled) return;
				settled = true;
				clearWatchdog();
				ffmpeg.off('progress', progressHandler);
				if (ret !== 0) {
					reject(new Error(`Encoding failed during ${step} (ffmpeg exit code ${ret}). Check Engine Status for details.`));
				} else {
					resolve();
				}
			})
			.catch((err) => {
				if (settled) return;
				settled = true;
				clearWatchdog();
				ffmpeg.off('progress', progressHandler);
				reject(err);
			});
	});
}

async function runPipeline(
	engine: LoadedEngine,
	file: File,
	options: CompressOptions,
	callbacks: CompressionCallbacks,
	watchdogMs: number | null,
	/** Overrides planBitrate's own number — used by compressWithFfmpeg's size-retry loop to re-encode at a lower bitrate. */
	videoBitrateOverrideKbps?: number
): Promise<CompressionResult> {
	const { ffmpeg } = engine;
	callbacks.onEngineReady?.(engine.multiThreaded ? 'multi' : 'single');

	const logHandler = callbacks.onLog ? ({ message }: { message: string }) => callbacks.onLog!(message) : null;
	if (logHandler) ffmpeg.on('log', logHandler);

	try {
		const inputName = `input${getFileExtension(file.name)}`;
		const outputName = 'output.mp4';

		const { fetchFile } = await import('@ffmpeg/util');
		await ffmpeg.writeFile(inputName, await fetchFile(file));

		callbacks.onPhase?.('probing');
		const { durationSeconds: totalDuration, height } = await probeVideo(ffmpeg, inputName);

		const trimStart = Math.max(0, options.trimStartSec || 0);
		const trimEnd = Math.max(0, options.trimEndSec || 0);
		const effectiveDuration = totalDuration - trimStart - trimEnd;
		if (effectiveDuration <= 0.5) {
			throw new InputError('That trim range leaves little or no video to compress.');
		}

		const planned = planBitrate(effectiveDuration, options);
		const videoBitrateKbps = Math.max(videoBitrateOverrideKbps ?? planned.videoBitrateKbps, MIN_VIDEO_BITRATE_KBPS);
		const audioBitrateKbps = planned.audioBitrateKbps;
		// Recomputed rather than trusting planBitrate's own flag, since an
		// override from the retry loop below is a different number than what
		// planBitrate would have picked — floored means "this is as low as it
		// can go," regardless of which path landed there.
		const belowMinimum = videoBitrateKbps <= MIN_VIDEO_BITRATE_KBPS;
		const scaleFilter = buildScaleFilter(options.resolution, height);
		const vf = scaleFilter ? ['-vf', scaleFilter] : [];
		const audioArgs = options.muteAudio ? ['-an'] : ['-c:a', 'aac', '-b:a', `${audioBitrateKbps}k`];
		const trimArgs = [
			...(trimStart > 0 ? ['-ss', trimStart.toString()] : []),
			...(trimEnd > 0 ? ['-t', effectiveDuration.toString()] : []),
		];

		if (options.extraQuality) {
			// Two-pass lands much closer to the target size. Both passes
			// must use the *same* preset: x264 pins several ratecontrol
			// parameters (mbtree, weighted prediction, ...) to whatever the
			// preset picked, and pass 2 will refuse to read pass 1's stats
			// if those don't match — so pass 1 can't be sped up with a
			// cheaper preset the way its unused (-f null) output might
			// suggest. 'faster' is a middle ground between the fast default
			// and the slowest/best-quality preset.
			const preset = 'faster';

			callbacks.onPhase?.('pass1');
			let off = withProgress(ffmpeg, (p) => callbacks.onProgress?.(p * 0.5));
			await run(
				ffmpeg,
				[
					...trimArgs,
					'-i', inputName,
					...vf,
					'-c:v', 'libx264', '-preset', preset, '-b:v', `${videoBitrateKbps}k`,
					'-pass', '1', '-an', '-f', 'null', 'pass1.out',
				],
				'pass 1',
				watchdogMs
			);
			off();

			callbacks.onPhase?.('pass2');
			off = withProgress(ffmpeg, (p) => callbacks.onProgress?.(0.5 + p * 0.5));
			await run(
				ffmpeg,
				[
					...trimArgs,
					'-i', inputName,
					...vf,
					'-c:v', 'libx264', '-preset', preset, '-b:v', `${videoBitrateKbps}k`,
					'-pass', '2', ...audioArgs,
					'-movflags', '+faststart', '-pix_fmt', 'yuv420p',
					outputName,
				],
				'pass 2',
				watchdogMs
			);
			off();
		} else {
			// Single pass with VBV constraints: roughly half the work of
			// two-pass, and close enough to the target size for most clips.
			callbacks.onPhase?.('encoding');
			const off = withProgress(ffmpeg, (p) => callbacks.onProgress?.(p));
			await run(
				ffmpeg,
				[
					...trimArgs,
					'-i', inputName,
					...vf,
					'-c:v', 'libx264', '-preset', 'superfast',
					'-b:v', `${videoBitrateKbps}k`,
					'-maxrate', `${Math.round(videoBitrateKbps * 1.5)}k`,
					'-bufsize', `${Math.round(videoBitrateKbps * 2)}k`,
					...audioArgs,
					'-movflags', '+faststart', '-pix_fmt', 'yuv420p',
					outputName,
				],
				'encoding',
				watchdogMs
			);
			off();
		}

		const data = await ffmpeg.readFile(outputName);
		const blob = new Blob([data as Uint8Array], { type: 'video/mp4' });
		if (blob.size === 0) {
			throw new Error('Encoding produced an empty file. Try a different target size or check Engine Status for details.');
		}

		await Promise.all(
			[inputName, outputName, 'pass1.out', 'ffmpeg2pass-0.log', 'ffmpeg2pass-0.log.mbtree'].map((name) =>
				ffmpeg.deleteFile(name).catch(() => {})
			)
		);

		return { blob, sizeBytes: blob.size, belowMinimum, durationSeconds: effectiveDuration, videoBitrateKbps };
	} finally {
		if (logHandler) ffmpeg.off('log', logHandler);
	}
}

async function runAttempt(
	file: File,
	options: CompressOptions,
	callbacks: CompressionCallbacks,
	videoBitrateOverrideKbps: number | undefined
): Promise<CompressionResult> {
	const engine = await getFFmpeg();

	try {
		return await runPipeline(engine, file, options, callbacks, engine.multiThreaded ? STALL_WATCHDOG_MS : null, videoBitrateOverrideKbps);
	} catch (err) {
		// Only worth retrying on the reliable single-threaded engine if we
		// were on multi-threaded AND the failure looks like an engine
		// problem — a stall, a crash, an out-of-memory abort (confirmed in
		// the wild on mobile Safari with a real ~23MB video) — rather than
		// bad input, which would just fail identically on any engine.
		if (!engine.multiThreaded || err instanceof InputError) throw err;

		const reason =
			err instanceof StallError ? err.message : `multi-threaded engine failed (${err instanceof Error ? err.message : 'unknown error'})`;
		callbacks.onLog?.(`[app] ${reason} — switching to the single-threaded engine and retrying…`);
		await terminateMultiThreaded();
		const fallbackEngine = await getFFmpeg({ requireSingleThreaded: true });
		return runPipeline(fallbackEngine, file, options, callbacks, null, videoBitrateOverrideKbps);
	}
}

// x264's single-pass rate control lands close to its target bitrate but
// isn't exact, and "close" still isn't "at or under" — which is the whole
// point of an app whose one job is hitting a target file size. Re-encoding
// at a proportionally lower bitrate converges fast for real content (output
// size scales close to linearly with bitrate), so a couple of retries
// reliably lands at or under target without making every job pay the cost.
const MAX_SIZE_RETRIES = 2;
// Extra margin beyond the exact ratio the previous attempt implies, so a
// retry doesn't just land back on the edge of the target after normal
// encoder/rounding variance.
const SIZE_RETRY_SAFETY = 0.95;

/**
 * The ffmpeg.wasm pipeline: multi-threaded first (with a stall watchdog),
 * falling back to single-threaded. Also verifies the actual output size
 * against the target and re-encodes at a lower bitrate if it's still over —
 * see MAX_SIZE_RETRIES above.
 */
export async function compressWithFfmpeg(
	file: File,
	options: CompressOptions,
	callbacks: CompressionCallbacks = {}
): Promise<CompressionResult> {
	const targetBytes = options.targetSizeMB * 1024 * 1024;
	let bitrateOverrideKbps: number | undefined;
	let result: CompressionResult | null = null;

	for (let attempt = 0; attempt <= MAX_SIZE_RETRIES; attempt++) {
		result = await runAttempt(file, options, callbacks, bitrateOverrideKbps);

		if (result.sizeBytes <= targetBytes || result.belowMinimum || attempt === MAX_SIZE_RETRIES) {
			return result;
		}

		// runAttempt always resolves via runPipeline (this module), which always sets this field.
		const nextBitrateKbps = Math.max(
			MIN_VIDEO_BITRATE_KBPS,
			Math.floor(result.videoBitrateKbps! * (targetBytes / result.sizeBytes) * SIZE_RETRY_SAFETY)
		);
		if (bitrateOverrideKbps !== undefined && nextBitrateKbps >= bitrateOverrideKbps) {
			// Already retried at this bitrate (or lower) with no improvement — a further attempt wouldn't help either.
			return result;
		}

		callbacks.onLog?.(
			`[app] Output was ${(result.sizeBytes / 1024 / 1024).toFixed(1)}MB, over the ${options.targetSizeMB}MB target — re-encoding at a lower bitrate (~${nextBitrateKbps}kbps) to fit (attempt ${attempt + 2}/${MAX_SIZE_RETRIES + 1})…`
		);
		bitrateOverrideKbps = nextBitrateKbps;
	}

	return result!;
}
