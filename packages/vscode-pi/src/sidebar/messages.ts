export type SidebarMessage =
	| { type: 'ready' }
	| { type: 'sendMessage'; text: string; history?: any[] }
	| { type: 'compact'; history?: any[] }
	| { type: 'stopGeneration' }
	| { type: 'switchModel'; modelId: string }
	| { type: 'openChat' }
	| { type: 'addCustomModel' }
	| { type: 'selectActiveModel' }
	| { type: 'syncOllama' }
	| { type: 'openTerminal' }
	| { type: 'openSettings' }
	| { type: 'getEditorContext' }
	| { type: 'insertCode'; code: string }
	| { type: 'copyCode'; code: string };
