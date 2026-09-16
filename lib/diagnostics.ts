export interface GpuInfo {
	vendor: string | null;
	renderer: string | null;
}

/**
 * Best-effort GPU identification via the WEBGL_debug_renderer_info
 * extension. This is the same rendering GPU/driver Chromium's own
 * chrome://gpu page reports on, though WebGL and WebCodecs don't
 * necessarily share a code path — it's a strong proxy, not a guarantee
 * that video decode/encode uses the same hardware.
 */
export function getGpuInfo(): GpuInfo {
	try {
		const canvas = document.createElement('canvas');
		const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
		if (!gl) return { vendor: null, renderer: null };
		const ext = gl.getExtension('WEBGL_debug_renderer_info');
		if (!ext) return { vendor: null, renderer: null };
		return {
			vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)),
			renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)),
		};
	} catch {
		return { vendor: null, renderer: null };
	}
}

export interface EnvironmentInfo {
	userAgent: string;
	platform: string;
	cores: number | null;
}

export function getEnvironmentInfo(): EnvironmentInfo {
	return {
		userAgent: navigator.userAgent,
		platform: navigator.platform || 'unknown',
		cores: navigator.hardwareConcurrency ?? null,
	};
}

export interface BrowserInfo {
	name: string;
	engine: 'chromium' | 'firefox' | 'webkit' | 'unknown';
	/** iOS forces every browser (Chrome, Firefox, Edge included) onto Apple's WebKit engine, so brand-specific internals pages don't exist there regardless of what the UA claims to be. */
	isIOS: boolean;
	/** The browser's own internal GPU/hardware-status page, if it has one the user can open. */
	gpuPageUrl: string | null;
	/** Where to find the hardware-acceleration toggle, in plain language — phrased as a fallback explanation when there's no page to link to. */
	accelerationSettingHint: string;
}

/**
 * chrome://gpu and "Use graphics acceleration when available" are
 * Chromium-specific — Firefox exposes similar info under a different name
 * and path, and Safari/iOS expose none of this to the user at all. Without
 * this, the diagnostics panel's advice is actively wrong for a large share
 * of visitors (Firefox and Safari included).
 */
export function detectBrowser(): BrowserInfo {
	const ua = navigator.userAgent;
	const isIOS =
		/iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ||
		(/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);

	// Order matters: Edge/Opera/Brave/Vivaldi/mobile Chrome all carry a
	// "Chrome/" (and often "Safari/") token for site-compatibility reasons,
	// so the most specific tokens must be checked first.
	if ('brave' in navigator) {
		return {
			name: 'Brave',
			engine: 'chromium',
			isIOS,
			gpuPageUrl: isIOS ? null : 'brave://gpu',
			accelerationSettingHint: isIOS
				? 'Not exposed on iOS — hardware decode there is controlled by iOS/WebKit, not Brave.'
				: 'brave://settings/system → "Use graphics acceleration when available"',
		};
	}
	if (/Edg(iOS|A)?\//.test(ua)) {
		return {
			name: isIOS ? 'Edge (iOS)' : 'Edge',
			engine: isIOS ? 'webkit' : 'chromium',
			isIOS,
			gpuPageUrl: isIOS ? null : 'edge://gpu',
			accelerationSettingHint: isIOS
				? 'Not exposed on iOS — Apple requires all browsers there to use its WebKit engine, so hardware decode is controlled by iOS, not Edge.'
				: 'edge://settings/system → "Use graphics acceleration when available"',
		};
	}
	if (/OPiOS|OPR\//.test(ua)) {
		return {
			name: isIOS ? 'Opera (iOS)' : 'Opera',
			engine: isIOS ? 'webkit' : 'chromium',
			isIOS,
			gpuPageUrl: isIOS ? null : 'opera://gpu',
			accelerationSettingHint: isIOS
				? 'Not exposed on iOS — Apple requires all browsers there to use its WebKit engine, so hardware decode is controlled by iOS, not Opera.'
				: 'opera://settings, under the System section',
		};
	}
	if (/Vivaldi/.test(ua)) {
		return {
			name: 'Vivaldi',
			engine: 'chromium',
			isIOS,
			gpuPageUrl: 'vivaldi://gpu',
			accelerationSettingHint: 'vivaldi://settings/webpages → "Use graphics acceleration when available"',
		};
	}
	if (/FxiOS|Firefox\//.test(ua) && !/Seamonkey/.test(ua)) {
		return {
			name: isIOS ? 'Firefox (iOS)' : 'Firefox',
			engine: isIOS ? 'webkit' : 'firefox',
			isIOS,
			gpuPageUrl: isIOS ? null : 'about:support',
			accelerationSettingHint: isIOS
				? "Not exposed on iOS — Firefox there runs on Apple's WebKit engine, not Firefox's own, so hardware decode is controlled by iOS."
				: 'about:preferences#general → Performance → uncheck "Use recommended performance settings" → "Use hardware acceleration when available". The Graphics section of about:support also shows current decode/compositing status.',
		};
	}
	if (/CriOS/.test(ua)) {
		return {
			name: 'Chrome (iOS)',
			engine: 'webkit',
			isIOS: true,
			gpuPageUrl: null,
			accelerationSettingHint:
				"Not exposed — Apple requires all iOS browsers, Chrome included, to use its WebKit engine, so Chrome's own chrome://gpu internals aren't available there. Hardware decode is controlled by iOS itself.",
		};
	}
	if (/Chrome\/|Chromium\//.test(ua)) {
		return {
			name: 'Chrome',
			engine: 'chromium',
			isIOS,
			gpuPageUrl: 'chrome://gpu',
			accelerationSettingHint: 'chrome://settings/system → "Use graphics acceleration when available"',
		};
	}
	if (/Safari\//.test(ua)) {
		return {
			name: 'Safari',
			engine: 'webkit',
			isIOS,
			gpuPageUrl: null,
			accelerationSettingHint:
				'Safari has no user-facing GPU status page or hardware-acceleration toggle — decode is automatic and managed by macOS/iOS. If it seems to be falling back to software, check for pending macOS/iOS updates.',
		};
	}
	return {
		name: 'Unknown browser',
		engine: 'unknown',
		isIOS,
		gpuPageUrl: null,
		accelerationSettingHint: "Couldn't identify a browser-specific diagnostics page for this browser.",
	};
}
