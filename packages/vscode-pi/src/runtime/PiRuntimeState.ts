import { PiModel } from '../models/types';

export interface PiRuntimeState {
	initialized: boolean;
	activeModel?: PiModel;
	models: readonly PiModel[];
	ollama: {
		connected: boolean;
		modelCount: number;
	};
	runtimeStatus: 'starting' | 'ready' | 'error';
	error?: string;
}
