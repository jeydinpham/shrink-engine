const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function copyCore(pkgName, destDirName, files) {
	const src = path.join(root, 'node_modules', '@ffmpeg', pkgName, 'dist', 'umd');
	if (!fs.existsSync(src)) {
		console.warn(`[copy-ffmpeg-core] @ffmpeg/${pkgName} not found, skipping.`);
		return;
	}

	const dest = path.join(root, 'public', destDirName);
	fs.mkdirSync(dest, { recursive: true });

	for (const file of files) {
		fs.copyFileSync(path.join(src, file), path.join(dest, file));
	}

	console.log(`[copy-ffmpeg-core] Copied @ffmpeg/${pkgName} to public/${destDirName}/`);
}

// Single-threaded core: works everywhere, no special headers required.
copyCore('core', 'ffmpeg', ['ffmpeg-core.js', 'ffmpeg-core.wasm']);

// Multi-threaded core: used when the page is cross-origin isolated (see
// next.config.js), falls back to the single-threaded core otherwise.
copyCore('core-mt', 'ffmpeg-mt', ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js']);
