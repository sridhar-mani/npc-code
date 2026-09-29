export interface PiModelCapabilities {
	reasoning: boolean;
	vision: boolean;
	toolCalling: boolean;
}

export interface PiModel {
	id: string;
	name: string;
	modelName?: string;
	providerId: string;
	capabilities: PiModelCapabilities;
	contextWindow: number;
	baseUrl?: string;
}

export interface CustomModelConfig {
	id: string;
	name: string;
	modelName?: string;
	baseUrl: string;
	providerId: string;
	capabilities?: Partial<PiModelCapabilities>;
	contextWindow?: number;
}

