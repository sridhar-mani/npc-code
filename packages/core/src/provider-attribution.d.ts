import type { Api, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import type { SettingsManager } from "./settings-manager.ts";
export interface BackendOptions {
    enableAttributionHeaders?: boolean;
}
export declare function mergeProviderAttributionHeaders(model: Model<Api>, settingsManager: SettingsManager, sessionId: string | undefined, options?: BackendOptions, ...headerSources: Array<ProviderHeaders | undefined>): ProviderHeaders | undefined;
//# sourceMappingURL=provider-attribution.d.ts.map