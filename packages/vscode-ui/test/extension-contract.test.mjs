import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const packageDir = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const extensionSource = fs.readFileSync(path.join(packageDir, 'src', 'extension.ts'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(packageDir, 'src', 'backend-bridge.ts'), 'utf8');
const toolsSource = fs.readFileSync(path.join(packageDir, 'src', 'tools', 'vscode-tools.ts'), 'utf8');
const sidebarSource = fs.existsSync(path.join(packageDir, 'src', 'sidebar', 'webviewClientScript.ts'))
	? fs.readFileSync(path.join(packageDir, 'src', 'sidebar', 'webviewClientScript.ts'), 'utf8')
	: fs.readFileSync(path.join(packageDir, 'src', 'sidebar', 'sidebarView.ts'), 'utf8');

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


test('sidebar markdown parser uses template-safe escapes', () => {
	assert.ok(sidebarSource.includes('x60'), 'inline-code parser should use a hex escape for backticks');
	assert.ok(sidebarSource.includes('codeBlockRegex'), 'markdown parser should keep a code-block regex');
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
	assert.ok(clientSource.includes("streamSnapshot"), 'webview must support batched streaming snapshots');
	assert.ok(clientSource.includes("send('compact'"), 'webview must expose Pi-native compaction');
	assert.ok(htmlSource.includes('data-command="/compact"'), 'composer must expose compact action');
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


test('modern sidebar uses the VS Code webview surface and preserves message contracts', () => {
	const htmlSource = fs.readFileSync(path.join(packageDir, 'src', 'sidebar', 'webviewHtml.ts'), 'utf8');
	const stylesSource = fs.readFileSync(path.join(packageDir, 'src', 'sidebar', 'webviewStyles.ts'), 'utf8');
	const clientSource = fs.readFileSync(path.join(packageDir, 'src', 'sidebar', 'webviewClientScript.ts'), 'utf8');

	assert.ok(manifest.contributes?.views?.['pi-assistant-container']?.some((view) => view.type === 'webview' && view.id === 'pi-assistant-sidebar'));
	assert.ok(htmlSource.includes('modelPickerTrigger'));
	assert.ok(htmlSource.includes('composer'));
	assert.ok(htmlSource.includes('welcomeGrid'));
	assert.ok(stylesSource.includes('--vscode-chat-requestBackground'));
	assert.ok(stylesSource.includes('prefers-reduced-motion'));
	for (const command of ['addModel', 'switchModel', 'sendMessage', 'syncOllama', 'openTerminal']) {
		assert.ok(clientSource.includes(`send('${command}'`), `webview must preserve ${command} message contract`);
	}
});
