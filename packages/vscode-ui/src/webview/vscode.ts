// Wrapper for acquireVsCodeApi in webview
export interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
	if (!api) {
		if (typeof acquireVsCodeApi === 'function') {
			api = acquireVsCodeApi();
		} else {
			api = {
				postMessage: (msg: unknown) => console.log('[mock-vscode] postMessage:', msg),
				getState: () => ({}),
				setState: () => {},
			};
		}
	}
	return api;
}
