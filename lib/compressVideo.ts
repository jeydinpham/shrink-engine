import { CompressOptions } from './compress';
import { CompressionCallbacks, CompressionResult, compressWithFfmpeg } from './runCompression';
import { canUseWebCodecs, compressWithWebCodecs } from './webCodecsCompress';

export type { CompressionResult } from './runCompression';
export type { CompressionCallbacks, CompressionPhase } from './runCompression';

/**
 * Tries the hardware-accelerated WebCodecs path first (fast, no wasm
 * download, uses the browser's native encoder) and falls back to the
 * ffmpeg.wasm pipeline — which already has its own multi-threaded → stall
 * watchdog → single-threaded fallback chain — for anything WebCodecs can't
 * handle (unsupported browser, unsupported codec/container, or any error).
 */
export async function compressVideo(
	file: File,
	options: CompressOptions,
	callbacks: CompressionCallbacks = {}
): Promise<CompressionResult> {
	if (canUseWebCodecs()) {
		try {
			callbacks.onPhase?.('encoding');
			const result = await compressWithWebCodecs(file, options, { onProgress: callbacks.onProgress });
			callbacks.onEngineReady?.('webcodecs');
			return result;
		} catch (err) {
			callbacks.onLog?.(
				`[app] Hardware encoding unavailable or failed (${
					err instanceof Error ? err.message : 'unknown error'
				}) — falling back to the software engine…`
			);
		}
	}

	return compressWithFfmpeg(file, options, callbacks);
}
