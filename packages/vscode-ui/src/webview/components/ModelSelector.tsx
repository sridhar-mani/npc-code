import React from 'react';
import type { ModelEntry } from '../types';

interface ModelSelectorProps {
	models: ModelEntry[];
	activeModelId: string;
	isOllamaOnline: boolean;
	onSelectModel: (modelId: string) => void;
	onAddModel: () => void;
	onSyncOllama: () => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
	models,
	activeModelId,
	isOllamaOnline,
	onSelectModel,
	onAddModel,
	onSyncOllama,
}) => {
	const activeModel = models.find((m) => m.id === activeModelId);
	const ollamaCount = models.filter((m) => m.provider === 'ollama').length;

	const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const val = e.target.value;
		if (val === '__add_model__') {
			onAddModel();
			return;
		}
		if (val) {
			onSelectModel(val);
		}
	};

	let statusText = 'Ollama Offline — Click to configure';
	let statusClass = 'dot-offline';
	if (isOllamaOnline && ollamaCount > 0) {
		statusText = `Ollama (${ollamaCount} models)`;
		statusClass = 'dot-online';
	} else if (models.length > 0) {
		statusText = `Active: ${activeModel?.name || 'Configured'}`;
		statusClass = 'dot-online';
	}

	return (
		<div className="model-selector-container">
			<div className="model-picker">
				<div className="model-picker-leading">
					<i className="codicon codicon-sparkle" />
				</div>
				<select
					className="model-dropdown"
					value={activeModelId || (models.length > 0 ? models[0].id : '')}
					onChange={handleChange}
					aria-label="Select model"
				>
					{models.length === 0 ? (
						<option value="">No models available</option>
					) : (
						models.map((m) => (
							<option key={m.id} value={m.id}>
								{m.provider === 'ollama' ? '[Ollama] ' : '[Custom] '}
								{m.name}
							</option>
						))
					)}
					<option value="__add_model__">+ Add Custom Provider / Model (BYOM)…</option>
				</select>
				<div className="model-picker-trailing">
					<i className="codicon codicon-chevron-down" />
				</div>
			</div>
			<div className="status-row">
				<div
					className="status-text"
					onClick={() => {
						if (!isOllamaOnline && models.length === 0) onAddModel();
					}}
					style={{ cursor: !isOllamaOnline && models.length === 0 ? 'pointer' : 'default' }}
				>
					<span className={`status-dot ${statusClass}`} />
					<span>{statusText}</span>
				</div>
				<button
					type="button"
					className="quiet-button"
					onClick={onSyncOllama}
					title="Refresh local models"
					aria-label="Refresh local models"
				>
					<i className="codicon codicon-refresh" />
				</button>
			</div>
		</div>
	);
};
