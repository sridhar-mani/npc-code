import * as esbuild from 'esbuild';
import * as path from 'path';

const isDev = process.argv.includes('--dev');

async function build() {
	if (isDev) {
		const ctx = await esbuild.context({
			entryPoints: ['./src/extension.ts'],
			bundle: true,
			outfile: './dist/extension.js',
			format: 'cjs',
			platform: 'node',
			target: 'node20',
			external: ['vscode'],
			sourcemap: 'inline',
			minify: false,
			logLevel: 'info',
		});
		await ctx.watch();
		console.log('Watching packages/vscode-ui for changes...');
	} else {
		await esbuild.build({
			entryPoints: ['./src/extension.ts'],
			bundle: true,
			outfile: './dist/extension.js',
			format: 'cjs',
			platform: 'node',
			target: 'node20',
			external: ['vscode'],
			sourcemap: false,
			minify: true,
			logLevel: 'info',
		});
		console.log('Successfully bundled Pi VS Code extension to dist/extension.js');
	}
}

build().catch(err => {
	console.error('Build failed:', err);
	process.exit(1);
});
