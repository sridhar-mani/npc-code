import * as vscode from 'vscode';
import { ModelManager } from '../runtime/modelManager';
import { TerminalAgentService } from '../terminal/terminalAgent';
import { PiSidebarViewProvider } from '../sidebar/sidebarView';
import { getZiqRuntimeHost } from '../runtime/runtimeHost';

export function registerPiCommands(
	context: vscode.ExtensionContext,
	modelManager: ModelManager,
	sidebarProvider: PiSidebarViewProvider
): void {
	// 1. Open Pi Chat
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.openChat', async (queryArg?: unknown) => {
			const userPrompt =
				typeof queryArg === 'string'
					? queryArg
					: queryArg && typeof queryArg === 'object' && 'query' in queryArg
						? String((queryArg as { query: unknown }).query)
						: undefined;

			const query = userPrompt ? `@pi ${userPrompt}` : '@pi ';
			const openOptions = { query, isPartialQuery: !userPrompt };

			for (const cmd of [
				'workbench.action.chat.open',
				'workbench.action.openChat',
				'workbench.action.chat.newChat',
				'workbench.panel.chat.view.copilot.focus',
				'workbench.action.chat.toggle',
			]) {
				try {
					if (cmd.endsWith('newChat') || cmd.endsWith('focus') || cmd.endsWith('toggle')) {
						await vscode.commands.executeCommand(cmd, cmd.includes('chat.open') ? openOptions : undefined);
					} else {
						await vscode.commands.executeCommand(cmd, openOptions);
					}
					return;
				} catch {
					// Fall through to next command variant
				}
			}

			// If chat view command cannot be executed, reveal the sidebar
			await vscode.commands.executeCommand('workbench.view.extension.pi-assistant-container');
		})
	);

	// 2. Add Custom Model
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.addCustomModel', async () => {
			await modelManager.promptAddModel();
		})
	);

	// 3. Select Active Model
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.selectActiveModel', async () => {
			await modelManager.promptSelectModel();
		})
	);

	// 4. Sync Ollama Models
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.syncOllamaModels', async () => {
			await modelManager.syncOllama(true);
		})
	);

	// 5. Configure Switchyard Models from the current active provider
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.configureSwitchyardModels', async () => {
			try {
				const host = await getZiqRuntimeHost();
				const catalog = host.getCurrentProviderModelChoices();
				if (!catalog.provider || catalog.models.length === 0) {
					vscode.window.showWarningMessage('Ziq: No models are available for the current provider.');
					return;
				}

				const pick = async (label: string, optional = false): Promise<string | undefined> => {
					const items = catalog.models.map((model) => ({
						label: model.name,
						description: `${model.provider}/${model.id}`,
						detail: model.reasoning ? 'Reasoning capable' : undefined,
						value: `${model.provider}/${model.id}`,
					}));
					if (optional) items.unshift({ label: '$(circle-slash) None', description: 'Disable evaluator model', detail: undefined, value: '' });
					const selected = await vscode.window.showQuickPick(items, {
						placeHolder: `${label} — ${catalog.provider}`,
						ignoreFocusOut: true,
					});
					return selected?.value;
				};

				const efficient = await pick('Select efficient Switchyard model');
				if (!efficient) return;
				const capable = await pick('Select capable Switchyard model');
				if (!capable) return;
				const evaluator = await pick('Select evaluator model (optional)', true);
				const config = vscode.workspace.getConfiguration('pi');
				const target = vscode.ConfigurationTarget.Global;
				await config.update('agentFeatures.switchyard.efficientModel', efficient, target);
				await config.update('agentFeatures.switchyard.capableModel', capable, target);
				await config.update('agentFeatures.switchyard.evaluatorModel', evaluator ?? '', target);
				await config.update('agentFeatures.switchyard.enabled', true, target);
				vscode.window.showInformationMessage(`Ziq: Switchyard configured for provider ${catalog.provider}.`);
			} catch (error) {
				vscode.window.showErrorMessage(`Ziq: Failed to configure Switchyard: ${error instanceof Error ? error.message : String(error)}`);
			}
		})
	);

	// 6. Manage Agent Skills
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.manageSkills', async () => {
			try {
				const host = await getZiqRuntimeHost();
				const skills = host.getSkillSummaries();
				if (skills.length === 0) {
					vscode.window.showInformationMessage('Ziq: No Agent Skills were discovered.');
					return;
				}
				const selected = await vscode.window.showQuickPick(
					skills.map((skill) => ({
						label: skill.name,
						description: skill.description,
						detail: skill.path,
						value: skill.path,
					})),
					{ placeHolder: 'Open an installed Agent Skill', matchOnDescription: true, matchOnDetail: true },
				);
				if (selected) {
					const document = await vscode.workspace.openTextDocument(selected.value);
					await vscode.window.showTextDocument(document, { preview: false });
				}
			} catch (error) {
				vscode.window.showErrorMessage('Ziq: Failed to open Agent Skills: ' + (error instanceof Error ? error.message : String(error)));
			}
		})
	);

	// 7. Manage persistent Ziq sessions
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.manageSessions', async () => {
			try {
				const host = await getZiqRuntimeHost();
				const sessions = await host.listSessions();
				if (sessions.length === 0) {
					vscode.window.showInformationMessage('Ziq: No saved sessions yet.');
					return;
				}
				const items = sessions.map((session) => ({
					label: session.name,
					description: new Date(session.modifiedAt).toLocaleString(),
					detail: session.firstMessage ? session.firstMessage.slice(0, 180) : session.path,
					value: session.path,
				}));
				const selected = await vscode.window.showQuickPick(items, {
					placeHolder: 'Select a Ziq session',
					matchOnDescription: true,
					matchOnDetail: true,
				});
				if (!selected) return;
				const current = host.describeSession();
				if (selected.value !== current.path) {
					await host.switchSession(selected.value);
					await vscode.commands.executeCommand('pi.refreshSidebar');
				}
			} catch (error) {
				vscode.window.showErrorMessage('Ziq: Failed to switch session: ' + (error instanceof Error ? error.message : String(error)));
			}
		})
	);

	// 8. Launch Terminal Agent
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.openTerminalAgent', () => {
			TerminalAgentService.launchTerminalAgent();
		})
	);

	// 9. Refresh Sidebar
	context.subscriptions.push(
		vscode.commands.registerCommand('pi.refreshSidebar', () => {
			sidebarProvider.refresh();
		})
	);
}
