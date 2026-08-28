import type { FFmpeg } from '@ffmpeg/ffmpeg';

export interface LoadedEngine {
	ffmpeg: FFmpeg;
	multiThreaded: boolean;
}

let mtEnginePromise: Promise<LoadedEngine> | null = null;
let stEnginePromise: Promise<LoadedEngine> | null = null;
// Once the mt core stalls once, it reliably stalls again on the same
// machine/video shape — so stop paying the 15s watchdog tax on every
// subsequent compression this session and go straight to single-threaded.
let mtDisabledForSession = false;

// Mobile browsers — iOS Safari in particular — have much tighter WASM
// memory ceilings than desktop, and the multi-threaded core reserves a
// larger fixed memory footprint upfront (its SharedArrayBuffer-backed heap
// can't grow as flexibly as the single-threaded core's). Confirmed in the
// wild: a ~23MB video on mobile Safari aborted the mt core with "Aborted
// (OOM)". Skipping mt on mobile avoids that failure mode instead of just
// recovering from it after the fact.
function isLikelyMobile(): boolean {
	return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
}

/** Multi-threading needs SharedArrayBuffer, which requires COOP/COEP headers (see next.config.js) — and isn't attempted on mobile (see isLikelyMobile). */
export function canUseMultiThreaded(): boolean {
	return typeof window !== 'undefined' && window.crossOriginIsolated === true && !isLikelyMobile();
}

async function loadSingleThreaded(): Promise<LoadedEngine> {
	const { FFmpeg } = await import('@ffmpeg/ffmpeg');
	const { toBlobURL } = await import('@ffmpeg/util');
	const ffmpeg = new FFmpeg();
	await ffmpeg.load({
		coreURL: await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
		wasmURL: await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
	});
	return { ffmpeg, multiThreaded: false };
}

function getSingleThreaded(): Promise<LoadedEngine> {
	if (!stEnginePromise) {
		stEnginePromise = loadSingleThreaded().catch((err) => {
			stEnginePromise = null;
			throw err;
		});
	}
	return stEnginePromise;
}

async function loadMultiThreaded(): Promise<LoadedEngine> {
	const { FFmpeg } = await import('@ffmpeg/ffmpeg');
	const { toBlobURL } = await import('@ffmpeg/util');
	const ffmpeg = new FFmpeg();
	await ffmpeg.load({
		coreURL: await toBlobURL('/ffmpeg-mt/ffmpeg-core.js', 'text/javascript'),
		wasmURL: await toBlobURL('/ffmpeg-mt/ffmpeg-core.wasm', 'application/wasm'),
		workerURL: await toBlobURL('/ffmpeg-mt/ffmpeg-core.worker.js', 'text/javascript'),
	});
	return { ffmpeg, multiThreaded: true };
}

/**
 * Returns a shared FFmpeg instance, loading it if needed. Core files are
 * served from /public/ffmpeg or /public/ffmpeg-mt (see
 * scripts/copy-ffmpeg-core.js) so no CDN is required at runtime.
 *
 * The multi-threaded core has a reproducible hang the moment libx264
 * actually starts encoding frames, at anything past a tiny resolution — it
 * gets through the ffmpeg banner and stream mapping and then never emits a
 * single "frame=" progress line. It can also hit a hard OOM abort on memory-
 * constrained devices (seen on mobile Safari with a real ~23MB video).
 * runCompression.ts guards every encode with a stall watchdog and treats any
 * multi-threaded failure — stall, crash, or otherwise — as reason to call
 * terminateMultiThreaded() and retry on the single-threaded core, so a
 * failure self-heals instead of surfacing straight to the user. Mobile skips
 * the multi-threaded attempt entirely (see isLikelyMobile) rather than
 * relying on that recovery every time.
 *
 * Callers are responsible for attaching/detaching their own
 * "log"/"progress" listeners around each operation (via ffmpeg.on/off) so
 * listeners don't pile up across compressions.
 */
export async function getFFmpeg(opts: { requireSingleThreaded?: boolean } = {}): Promise<LoadedEngine> {
	if (opts.requireSingleThreaded || mtDisabledForSession || !canUseMultiThreaded()) {
		return getSingleThreaded();
	}

	if (!mtEnginePromise) {
		mtEnginePromise = loadMultiThreaded().catch(() => {
			mtEnginePromise = null;
			// Fall back to the single-threaded core if the mt core fails to load for any reason.
			return getSingleThreaded();
		});
	}
	return mtEnginePromise;
}

/**
 * Hard-kills the cached multi-threaded engine (if any) and evicts it from
 * the cache, so the next getFFmpeg() call loads a fresh instance. Used when
 * a stall watchdog trips: Worker.terminate() is enforced by the browser
 * itself, so it reliably kills a hung wasm pthread pool even though the
 * library's own cooperative exec() timeout can't (it needs the encode loop
 * to notice the timeout, which never happens if it's truly stuck).
 */
export async function terminateMultiThreaded(): Promise<void> {
	mtDisabledForSession = true;
	const promise = mtEnginePromise;
	mtEnginePromise = null;
	if (!promise) return;
	try {
		const { ffmpeg } = await promise;
		ffmpeg.terminate();
	} catch {
		// Already failed to load or already terminated — nothing to clean up.
	}
}
