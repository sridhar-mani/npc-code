import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const packageDir = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const extensionSource = fs.readFileSync(path.join(packageDir, 'src', 'extension.ts'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(packageDir, 'src', 'backend-bridge.ts'), 'utf8');
const toolsSource = fs.readFileSync(path.join(packageDir, 'src', 'tools', 'vscode-tools.ts'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(packageDir, 'src', 'sidebar', 'sidebarView.ts'), 'utf8');
const webviewHtmlSource = fs.readFileSync(path.join(packageDir, 'src', 'sidebar', 'webviewHtml.ts'), 'utf8');
const webviewStylesSource = fs.readFileSync(path.join(packageDir, 'src', 'sidebar', 'webviewStyles.ts'), 'utf8');
const appSource = fs.readFileSync(path.join(packageDir, 'src', 'webview', 'App.tsx'), 'utf8');
const markdownSource = fs.readFileSync(path.join(packageDir, 'src', 'webview', 'components', 'MarkdownView.tsx'), 'utf8');
const messageListSource = fs.readFileSync(path.join(packageDir, 'src', 'webview', 'components', 'MessageList.tsx'), 'utf8');
const sharedSessionCoreSource = fs.readFileSync(path.join(packageDir, '..', 'core', 'src', 'shared-session.ts'), 'utf8');

test('Pi command contract is wired from manifest to runtime registration', () => {
	const commands = manifest.contributes?.commands ?? [];
	const commandIds = commands.map((command) => command.command);

	for (const commandId of [
		'pi.openChat',
		'pi.addCustomModel',
		'pi.selectActiveModel',
		'pi.syncOllamaModels',
		'pi.openTerminalAgent',
	]) {
		assert.ok(commandIds.includes(commandId), `manifest must contribute ${commandId}`);
		assert.ok(
			extensionSource.includes('registerBackendBridge(context)') &&
				bridgeSource.includes(`registerPiCommand("${commandId}"`),
			`runtime must register ${commandId}`,
		);
		assert.ok(
			(manifest.activationEvents ?? []).includes(`onCommand:${commandId}`),
			`manifest must explicitly activate for ${commandId}`,
		);
	}
});

test('Pi extension points at the bundle produced by the current esbuild entrypoint', () => {
	assert.equal(manifest.main, './dist/extension.js');
	assert.ok(fs.existsSync(path.join(packageDir, '.esbuild.ts')));
});

test('React webview is the shipped sidebar client', () => {
	assert.ok(fs.existsSync(path.join(packageDir, 'src', 'webview', 'index.tsx')));
	assert.ok(appSource.includes("window.addEventListener('message'"));
	assert.ok(appSource.includes("vscode.postMessage({ command: 'ready' })"));
	assert.ok(appSource.includes('}, []);'), 'webview message listener must not restart for every streamed token');
	assert.ok(webviewHtmlSource.includes('<div id="root"></div>'));
	assert.ok(fs.readFileSync(path.join(packageDir, '.esbuild.ts'), 'utf8').includes('./src/webview/index.tsx'));
});

test('Markdown rendering uses block-level Markdown/GFM parsing rather than the legacy regex renderer', () => {
	assert.ok(markdownSource.includes("from 'marked'"));
	assert.ok(markdownSource.includes('gfm: true'));
	assert.ok(markdownSource.includes('renderer.html'));
	assert.ok(markdownSource.includes('data-ziq-code-action'));
	assert.ok(!markdownSource.includes('function renderInlineMarkdown('));
	assert.ok(webviewStylesSource.includes('.markdown-body table'));
	assert.ok(webviewStylesSource.includes('.markdown-body h1'));
});

test('shipped entrypoint uses the Pi backend and exposes VS Code tools', () => {
	assert.ok(extensionSource.includes("from './backend-bridge'"));
	assert.ok(extensionSource.includes('registerBackendBridge(context)'));
	assert.ok(bridgeSource.includes('createVsCodeTools()'));
	for (const tool of [
		'vscode_get_active_editor',
		'vscode_get_diagnostics',
		'vscode_search_workspace',
		'vscode_read_file',
		'vscode_open_file',
		'vscode_save_file',
		'vscode_apply_workspace_edit',
		'vscode_get_hover',
		'vscode_get_definitions',
		'vscode_get_references',
		'vscode_list_language_model_tools',
		'vscode_invoke_language_model_tool',
	]) {
		assert.ok(toolsSource.includes(`name: '${tool}'`), `VS Code bridge must expose ${tool}`);
	}
	assert.ok(bridgeSource.includes('getAutomaticVsCodeContext()'));
	assert.ok(appSource.includes('streamSnapshot'), 'React webview must support batched streaming snapshots');
	assert.ok(appSource.includes("command: 'compact'"), 'React webview must expose Pi-native compaction');
	assert.ok(messageListSource.includes('MarkdownView'), 'message list must render through the Markdown component');
});

test('VS Code model UI is wired to the active backend bridge', () => {
	const manifestViews = manifest.contributes?.views?.['pi-assistant-container'] ?? [];
	assert.ok(manifestViews.some((view) => view.id === 'pi-assistant-welcome'), 'manifest must contribute the active tree view');
	assert.ok(bridgeSource.includes('registerTreeDataProvider("pi-assistant-welcome"'), 'bridge must register the contributed tree view');
	assert.ok(bridgeSource.includes('registerPiCommand("pi.addCustomModel"'), 'custom model command must be registered');
});

test('VS Code tools support content search and URL inspection', () => {
	assert.ok(toolsSource.includes("name: 'vscode_search_text'"), 'VS Code bridge must expose content search');
	assert.ok(toolsSource.includes("name: 'vscode_fetch_url'"), 'VS Code bridge must expose URL inspection');
});

test('VS Code and terminal use the same Pi core shared-session policy', () => {
	assert.ok(sharedSessionCoreSource.includes('SessionManager.continueRecent(cwd, sessionDir)'));
	assert.ok(sidebarSource.includes('createSharedSessionManager(sessionCwd)'));
	assert.ok(sidebarSource.includes('SessionManager.create(sessionCwd)'));
	const terminalMain = fs.readFileSync(path.join(packageDir, '..', 'terminal-ui', 'src', 'main.ts'), 'utf8');
	assert.ok(terminalMain.includes('createSharedSessionManager(cwd, sessionDir)'));
	assert.ok(!bridgeSource.includes('SessionManager.continueRecent('));
	assert.ok(!sidebarSource.includes('createSidebarSessionManager('));
	assert.ok(!sidebarSource.includes('saveSidebarSessionFile('));
	assert.ok(!sidebarSource.includes('getSidebarSessionFile('));
});

test('modern sidebar uses the VS Code webview surface', () => {
	assert.ok(manifest.contributes?.views?.['pi-assistant-container']?.some((view) => view.type === 'webview' && view.id === 'pi-assistant-sidebar'));
	assert.ok(webviewHtmlSource.includes('<div id="root"></div>'));
	assert.ok(webviewStylesSource.includes('--vscode-chat-requestBackground'));
	assert.ok(webviewStylesSource.includes('prefers-reduced-motion'));
});
