import * as esbuild from 'esbuild';

const isDev = process.argv.includes('--dev');

async function build() {
	const extensionConfig: esbuild.BuildOptions = {
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
	};

	const webviewConfig: esbuild.BuildOptions = {
		entryPoints: ['./src/webview/index.tsx'],
		bundle: true,
		outfile: './dist/webview.js',
		format: 'iife',
		platform: 'browser',
		target: 'es2022',
		jsx: 'automatic',
		define: {
			'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
		},
		sourcemap: isDev ? 'inline' : false,
		minify: !isDev,
		logLevel: 'info',
	};

	if (isDev) {
		const extCtx = await esbuild.context(extensionConfig);
		const webCtx = await esbuild.context(webviewConfig);
		await Promise.all([extCtx.watch(), webCtx.watch()]);
		console.log('Watching packages/vscode-ui extension and webview for changes...');
	} else {
		await Promise.all([
			esbuild.build(extensionConfig),
			esbuild.build(webviewConfig),
		]);
		console.log('Successfully bundled Pi VS Code extension and React webview!');
	}
}

build().catch(err => {
	console.error('Build failed:', err);
	process.exit(1);
});
