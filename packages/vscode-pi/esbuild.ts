import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');

async function run() {
	const ctx = await esbuild.context({
		entryPoints: [path.join(__dirname, 'src/extension.ts')],
		bundle: true,
		outfile: path.join(__dirname, 'dist/extension.js'),
		external: ['vscode'],
		format: 'cjs',
		platform: 'node',
		target: 'node18',
		sourcemap: isDev ? 'inline' : true,
		minify: false,
		logLevel: 'info',
	});

	if (isDev) {
		await ctx.watch();
		console.log('[esbuild] Watching for changes...');
	} else {
		await ctx.rebuild();
		await ctx.dispose();
		console.log('[esbuild] Build complete.');
	}
}

run().catch(err => {
	console.error('[esbuild] Build failed:', err);
	process.exit(1);
});
