import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const packageDir = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const extensionSource = fs.readFileSync(path.join(packageDir, 'src', 'commands', 'index.ts'), 'utf8');

test('Pi command contract is wired from manifest to runtime registration', () => {
	const commands = manifest.contributes?.commands ?? [];
	const commandIds = commands.map((command) => command.command);

	for (const commandId of [
		'pi.openChat',
		'pi.addCustomModel',
		'pi.selectActiveModel',
		'pi.syncOllamaModels',
		'pi.openTerminalAgent',
		'pi.refreshSidebar',
	]) {
		assert.ok(commandIds.includes(commandId), \`manifest must contribute \${commandId}\`);
		const escaped = commandId.replace('.', '\\\\.');
		assert.match(
			extensionSource,
			new RegExp(\`registerCommand\\\\(['"]\${escaped}['"]\`),
			\`runtime must register \${commandId}\`,
		);
		assert.ok(
			(manifest.activationEvents ?? []).includes(\`onCommand:\${commandId}\`),
			\`manifest must explicitly activate for \${commandId}\`,
		);
	}
});

test('Pi extension points at the bundle produced by the current esbuild entrypoint', () => {
	assert.equal(manifest.main, './dist/extension.js');
	assert.ok(fs.existsSync(path.join(packageDir, '.esbuild.ts')));
});
