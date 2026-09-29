import * as esbuild from 'esbuild';
import * as path from 'path';

const isDev = process.argv.includes('--dev');

async function build() {
	await esbuild.build({
		entryPoints: ['./src/extension.ts'],
		bundle: true,
		outfile: './dist/extension.js',
		format: 'cjs',
		platform: 'node',
		target: 'node20',
		external: ['vscode'],
		sourcemap: isDev ? 'inline' : false,
		minify: !isDev,
		logLevel: 'info',
	});
	console.log('✓ Successfully bundled Pi VS Code extension to dist/extension.js');
}

build().catch(err => {
	console.error('Build failed:', err);
	process.exit(1);
});
