import * as vscode from 'vscode';
import { PiConfiguration } from '../configuration/configuration';
import { PiSecretStorage } from '../configuration/secrets';
import { OllamaService } from '../models/OllamaService';
import { ProviderService } from '../models/ProviderService';
import { ModelRegistry } from '../models/ModelRegistry';
import { ModelService } from './ModelService';
import { SessionService, ChatMessage, StreamCallbacks } from './SessionService';
import { PiCliLocator } from '../terminal/PiCliLocator';
import { PiTerminalService } from '../terminal/PiTerminalService';
import { PiRuntimeState } from './PiRuntimeState';
import { PiModel } from '../models/types';
import { PiLogger } from '../logging/logger';

export interface PiRuntimeOptions {
	context: vscode.ExtensionContext;
	logger: PiLogger;
}

export class PiRuntimeService implements vscode.Disposable {
	private readonly _context: vscode.ExtensionContext;
	private readonly _logger: PiLogger;
	private readonly _config: PiConfiguration;
	private readonly _secrets: PiSecretStorage;
	private readonly _ollamaService: OllamaService;
	private readonly _providerService: ProviderService;
	private readonly _modelRegistry: ModelRegistry;
	private readonly _modelService: ModelService;
	private readonly _sessionService: SessionService;
	private readonly _cliLocator: PiCliLocator;
	private readonly _terminalService: PiTerminalService;

	private _isInitialized: boolean = false;
	private _runtimeStatus: 'starting' | 'ready' | 'error' = 'starting';
	private readonly _onDidChangeState = new vscode.EventEmitter<PiRuntimeState>();
	public readonly onDidChangeState: vscode.Event<PiRuntimeState> = this._onDidChangeState.event;

	constructor(options: PiRuntimeOptions) {
		this._context = options.context;
		this._logger = options.logger;

		this._config = new PiConfiguration(this._context);
		this._secrets = new PiSecretStorage(this._context.secrets);
		this._ollamaService = new OllamaService(this._config.ollamaUrl, this._config.timeout, this._logger);
		this._providerService = new ProviderService(this._config, this._secrets, this._logger);
		this._modelRegistry = new ModelRegistry(this._config, this._ollamaService, this._providerService, this._logger);
		this._modelService = new ModelService(this._modelRegistry, this._providerService, this._logger);
		this._sessionService = new SessionService(this._providerService, this._logger);
		this._cliLocator = new PiCliLocator(this._context, this._logger);
		this._terminalService = new PiTerminalService(this._cliLocator, this._logger);

		this._modelRegistry.onDidChange(() => {
			this._onDidChangeState.fire(this.getState());
		});
	}

	public async initialize(): Promise<void> {
		if (this._isInitialized) return;

		this._logger.info('runtime', 'Lazy-initializing Pi runtime service...');
		this._runtimeStatus = 'starting';

		try {
			this._modelRegistry.refreshCustomModels();
			if (this._config.autoSyncOllama) {
				// Non-blocking sync on activation
				this._modelRegistry.syncOllama(false).catch(err => {
					this._logger.warn('runtime', `Initial Ollama sync skipped: ${err?.message || err}`);
				});
			}

			this._isInitialized = true;
			this._runtimeStatus = 'ready';
			this._logger.info('runtime', 'Pi runtime service initialized successfully');
		} catch (err: any) {
			this._runtimeStatus = 'error';
			this._logger.error('runtime', `Failed to initialize runtime: ${err?.message || err}`);
		}

		this._onDidChangeState.fire(this.getState());
	}

	public getState(): PiRuntimeState {
		const activeModel = this._modelRegistry.getActiveModel();
		const models = this._modelRegistry.models;
		const ollamaCount = models.filter(m => m.providerId === 'ollama').length;

		return {
			initialized: this._isInitialized,
			activeModel,
			models,
			ollama: {
				connected: this._modelRegistry.isOllamaOnline,
				modelCount: ollamaCount,
			},
			runtimeStatus: this._runtimeStatus,
		};
	}

	public get modelService(): ModelService {
		return this._modelService;
	}

	public get modelRegistry(): ModelRegistry {
		return this._modelRegistry;
	}

	public get terminalService(): PiTerminalService {
		return this._terminalService;
	}

	public async streamChat(
		prompt: string,
		history: ChatMessage[],
		callbacks: StreamCallbacks,
		signal: AbortSignal,
		systemInstructions?: string
	): Promise<string> {
		await this.initialize();
		const activeModel = this._modelRegistry.getActiveModel();
		if (!activeModel) {
			throw new Error('No active model selected. Please select a model first.');
		}
		return this._sessionService.streamChat(activeModel, prompt, history, callbacks, signal, systemInstructions);
	}

	public async compactHistory(history: ChatMessage[], signal: AbortSignal): Promise<string> {
		await this.initialize();
		const activeModel = this._modelRegistry.getActiveModel();
		if (!activeModel) {
			throw new Error('No active model selected. Please select a model first.');
		}
		return this._sessionService.compactHistory(activeModel, history, signal);
	}

	public dispose(): void {
		this._modelRegistry.dispose();
		this._onDidChangeState.fire(this.getState());
		this._onDidChangeState.dispose();
	}
}
