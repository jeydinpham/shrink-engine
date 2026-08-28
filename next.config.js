/** @type {import('next').NextConfig} */
const nextConfig = {
	// Cross-origin isolation is required for SharedArrayBuffer, which the
	// multi-threaded ffmpeg.wasm core needs (lib/ffmpeg.ts falls back to the
	// single-threaded core when these headers aren't present).
	async headers() {
		return [
			{
				source: '/:path*',
				headers: [
					{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
					{ key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
				],
			},
		];
	},
};

module.exports = nextConfig;
