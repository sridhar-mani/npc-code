import * as esbuild from 'esbuild';

const isDev = process.argv.includes('--dev');

async function build() {
	const extensionConfig: esbuild.BuildOptions = {
		entryPoints: ['./src/extension.ts'],
		bundle: true,
		outfile: './dist/extension.js',
		format: 'cjs',
		platform: 'node',
		target: 'node22',
		external: ['vscode'],
		sourcemap: isDev ? 'inline' : false,
		minify: !isDev,
		logLevel: 'info',
	};

	const terminalClientConfig: esbuild.BuildOptions = {
		entryPoints: ['./src/terminal/runtimeClient.ts'],
		bundle: true,
		outfile: './dist/terminal-client.cjs',
		format: 'cjs',
		platform: 'node',
		target: 'node22',
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
		const terminalCtx = await esbuild.context(terminalClientConfig);
		const webCtx = await esbuild.context(webviewConfig);
		await Promise.all([extCtx.watch(), terminalCtx.watch(), webCtx.watch()]);
		console.log('Watching packages/vscode-ui extension, terminal client, and webview for changes...');
	} else {
		await Promise.all([
			esbuild.build(extensionConfig),
			esbuild.build(terminalClientConfig),
			esbuild.build(webviewConfig),
		]);
		console.log('Successfully bundled Pi VS Code extension and React webview!');
	}
}

build().catch(err => {
	console.error('Build failed:', err);
	process.exit(1);
});
