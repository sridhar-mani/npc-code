/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export {
	CopilotChatAttr,
	GenAiAttr,
	GenAiOperationName,
	GenAiProviderName,
	GenAiTokenType,
	GenAiToolType,
	StdAttr,
} from "./genAiAttributes";
export { emitAgentTurnEvent, emitInferenceDetailsEvent, emitSessionStartEvent, emitToolCallEvent } from "./genAiEvents";
export { GenAiMetrics } from "./genAiMetrics";
export {
	toInputMessages,
	toOutputMessages,
	toSystemInstructions,
	toToolDefinitions,
	truncateForOTel,
} from "./messageFormatters";
export { NoopOTelService } from "./noopOtelService";
export { DEFAULT_OTLP_ENDPOINT, type OTelConfig, type OTelConfigInput, resolveOTelConfig } from "./otelConfig";
export {
	type ICompletedSpanData,
	IOTelService,
	type ISpanEventData,
	type ISpanEventRecord,
	type ISpanHandle,
	type OTelModelOptions,
	SpanKind,
	type SpanOptions,
	SpanStatusCode,
	type TraceContext,
} from "./otelService";
export {
	resolveWorkspaceOTelMetadata,
	type WorkspaceOTelMetadata,
	workspaceMetadataToOTelAttributes,
} from "./workspaceOTelMetadata";
