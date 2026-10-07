import * as esbuild from 'esbuild';
import fs from 'node:fs';
import JavaScriptObfuscator from 'javascript-obfuscator';

const isDev = process.argv.includes('--dev');
const isProtect = process.argv.includes('--protect') || (!isDev && process.env.NODE_ENV === 'production');

function obfuscateFile(filePath: string, isNode = true) {
	if (!fs.existsSync(filePath)) return;
	const original = fs.readFileSync(filePath, 'utf-8');
	const result = JavaScriptObfuscator.obfuscate(original, {
		compact: true,
		controlFlowFlattening: true,
		controlFlowFlatteningThreshold: 0.75,
		deadCodeInjection: false,
		identifierNamesGenerator: 'hexadecimal',
		renameGlobals: false,
		rotateStringArray: true,
		shuffleStringArray: true,
		splitStrings: true,
		splitStringsChunkLength: 10,
		stringArray: true,
		stringArrayEncoding: ['rc4'],
		stringArrayThreshold: 0.85,
		target: isNode ? 'node' : 'browser',
		sourceMap: false,
	});
	fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf-8');
	console.log(`[ENCRYPT] Obfuscated: ${filePath}`);
}

async function build() {
	const extensionConfig: esbuild.BuildOptions = {
		entryPoints: ['./src/extension.ts'],
		bundle: true,
		outfile: './dist/extension.js',
		format: 'cjs',
		platform: 'node',
		target: 'es2021',
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
		target: 'es2021',
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
		console.log('Watching packages/vscode extension, terminal client, and webview for changes...');
	} else {
		await Promise.all([
			esbuild.build(extensionConfig),
			esbuild.build(terminalClientConfig),
			esbuild.build(webviewConfig),
		]);
		console.log('Successfully bundled NPC VS Code extension and React webview.');

		if (isProtect) {
			console.log('Applying build-time encryption & obfuscation...');
			obfuscateFile('./dist/extension.js', true);
			obfuscateFile('./dist/terminal-client.cjs', true);
			obfuscateFile('./dist/webview.js', false);
			console.log('Build-time encryption complete for NPC VS Code extension.');
		}
	}
}

build().catch(err => {
	console.error('Build failed:', err);
	process.exit(1);
});
