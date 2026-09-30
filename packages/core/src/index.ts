/**
 * Core runtime, session management, compaction, tools, and extensions.
 */

export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type ModelCycleResult,
	type ParsedSkillBlock,
	type PromptDisposition,
	type PromptOptions,
	parseSkillBlock,
	type QueuedInputDisposition,
	type SessionStats,
} from "./agent-session.ts";
export {
	AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	type CreateAgentSessionRuntimeResult,
	createAgentSessionRuntime,
	SessionImportFileNotFoundError,
} from "./agent-session-runtime.ts";
export {
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionServicesOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./agent-session-services.ts";
export { formatNoModelsAvailableMessage } from "./auth-guidance.ts";
export { AuthStorage, ReadOnlyAuthStorage, readStoredCredential } from "./auth-storage.ts";
export { PiAgentBackend, type PiAgentBackendOptions } from "./backend-impl.ts";
export { type BashExecutorOptions, type BashResult, executeBashWithOperations } from "./bash-executor.ts";
export {
	BUG_REPORT_CUSTOM_ENTRY_TYPE,
	type BugReportBundle,
	type BugReportSessionEntryData,
	bugReportArchiveFileName,
	collectBugReportDiagnostics,
	collectBugReportMetadata,
	writeBugReportArchive,
} from "./bug-report.ts";
export { uploadBugReport } from "./bug-report-upload.ts";
export {
	CACHE_TTL_MS,
	type CacheMiss,
	collectCacheMisses,
	computeCacheWaste,
	detectCacheMiss,
} from "./cache-stats.ts";
export {
	type CacheWarmingDecision,
	type CacheWarmingStatus,
	formatCacheWarmingStatus,
	formatCacheWarmingUsage,
} from "./cache-warmer.ts";
// Compaction
export {
	type BranchPreparation,
	type BranchSummaryResult,
	type CollectEntriesResult,
	type CompactionPreparation,
	type CompactionResult,
	type CutPointResult,
	calculateContextTokens,
	collectEntriesForBranchSummary,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens,
	type FileOperations,
	findCutPoint,
	findTurnStartIndex,
	type GenerateBranchSummaryOptions,
	generateBranchSummary,
	generateSummary,
	generateSummaryWithUsage,
	getLastAssistantUsage,
	prepareBranchEntries,
	prepareCompaction,
	serializeConversation,
	shouldCompact,
} from "./compaction/index.ts";
export {
	clearCrashLog,
	findExtensionStackMatches,
	readCrashLog,
	recordCrash,
	takeUnnotifiedCrash,
} from "./crash-log.ts";
export {
	DEFAULT_THINKING_LEVEL,
	THINKING_LEVEL_OPTIONS,
} from "./defaults.ts";
export { createEventBus, type EventBus, type EventBusController } from "./event-bus.ts";
export { areExperimentalFeaturesEnabled } from "./experimental.ts";
export { exportFromFile, exportSessionToHtml } from "./export-html/index.ts";
export * from "./extensions/index.ts";
export { FooterDataProvider, type ReadonlyFooterDataProvider } from "./footer-data-provider.ts";
export {
	applyHttpProxySettings,
	configureHttpDispatcher,
	DEFAULT_HTTP_IDLE_TIMEOUT_MS,
	formatHttpIdleTimeoutMs,
	HTTP_IDLE_TIMEOUT_CHOICES,
	parseHttpIdleTimeoutMs,
} from "./http-dispatcher.ts";
export type {
	AgentBackend,
	BackendPromptOptions,
	SessionSummary,
} from "./interface.ts";
export {
	type AppKeybinding,
	type AppKeybindings,
	KeybindingsManager,
	migrateKeybindingsConfig,
} from "./keybindings.ts";
export {
	type BranchSummaryMessage,
	type CompactionSummaryMessage,
	type CustomMessage,
	convertToLlm,
	createCompactionSummaryMessage,
	createCustomMessage,
} from "./messages.ts";
export { ModelRegistry } from "./model-registry.ts";
export {
	defaultModelPerProvider,
	findExactModelReferenceMatch,
	findInitialModel,
	type ModelScopeDiagnostic,
	type ResolveCliModelResult,
	type ResolveModelScopeResult,
	resolveCliModel,
	resolveModelScope,
	resolveModelScopeFromModels,
	resolveModelScopeWithDiagnostics,
	type ScopedModel,
} from "./model-resolver.ts";
export {
	type CreateModelRuntimeOptions,
	CredentialSynchronizationError,
	type CredentialSynchronizationOperation,
	ModelRuntime,
	type ModelRuntimeAuthOverrides,
} from "./model-runtime.ts";
export { InMemoryCodingAgentModelsStore } from "./models-store.ts";
export {
	flushRawStdout,
	isStdoutTakenOver,
	restoreStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "./output-guard.ts";
export type {
	PackageManager,
	PathMetadata,
	ProgressCallback,
	ProgressEvent,
	ResolvedPaths,
	ResolvedResource,
} from "./package-manager.ts";
export { DefaultPackageManager } from "./package-manager.ts";
export {
	type AppMode,
	type ResolveProjectTrustedOptions,
	resolveProjectTrusted,
} from "./project-trust.ts";
export {
	type BackendOptions,
	mergeProviderAttributionHeaders,
} from "./provider-attribution.ts";
export type {
	ProviderChatModelConfig,
	ProviderConfigInput,
	ProviderModelConfig,
} from "./provider-composer.ts";
export {
	ENV_RADIUS_GATEWAY,
	getRadiusGatewayUrl,
	RADIUS_PROVIDER_ID,
} from "./radius.ts";
export type { ResourceCollision, ResourceDiagnostic, ResourceLoader } from "./resource-loader.ts";
export { DefaultResourceLoader, loadProjectContextFiles } from "./resource-loader.ts";
// SDK for programmatic usage
export {
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
	createAgentSession,
	createBashTool,
	createCodingTools,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createPowerShellTool,
	createReadOnlyTools,
	createReadTool,
	createWriteTool,
	type PromptTemplate,
} from "./sdk.ts";
export {
	formatMissingSessionCwdPrompt,
	getMissingSessionCwdIssue,
	MissingSessionCwdError,
	type SessionCwdIssue,
} from "./session-cwd.ts";
export { exportSessionToJsonl, serializeSessionBranch } from "./session-export.ts";
export { createSharedSessionManager } from "./shared-session.ts";
export {
	assertValidSessionId,
	type BranchSummaryEntry,
	buildContextEntries,
	buildSessionContext,
	buildSessionProjection,
	type CompactionEntry,
	type ContextEditableContent,
	type ContextEditEntry,
	CURRENT_SESSION_VERSION,
	type CustomEntry,
	type CustomMessageEntry,
	type FileEntry,
	getLatestCompactionEntry,
	type ModelChangeEntry,
	migrateSessionEntries,
	type NewSessionOptions,
	type ProjectedSessionEntry,
	parseSessionEntries,
	type SessionContext,
	type SessionEntry,
	type SessionEntryBase,
	type SessionHeader,
	type SessionInfo,
	type SessionInfoEntry,
	type SessionListProgress,
	SessionManager,
	type SessionMessageEntry,
	type SessionProjection,
	type SessionTreeNode,
	sessionEntryToContextMessages,
	type ThinkingLevelChangeEntry,
	type UsageEntry,
} from "./session-manager.ts";
export {
	collectSettingsDiagnostics,
	deduplicateDiagnostics,
} from "./settings-diagnostics.ts";
export {
	CACHE_WARMING_MODES,
	type CacheWarmingMode,
	type CompactionModelOverride,
	type CompactionSettings,
	type DefaultProjectTrust,
	type FullscreenExitOutput,
	type ImageSettings,
	type MermaidRenderingMode,
	type PackageSource,
	type RetrySettings,
	SettingsManager,
	type SettingsManagerCreateOptions,
	type TuiMode,
	type WarningSettings,
} from "./settings-manager.ts";
// Skills
export {
	formatSkillsForPrompt,
	type LoadSkillsFromDirOptions,
	type LoadSkillsResult,
	loadSkills,
	loadSkillsFromDir,
	type Skill,
	type SkillFrontmatter,
} from "./skills.ts";
export { BUILTIN_SLASH_COMMANDS, type BuiltinSlashCommand } from "./slash-commands.ts";
export { createSyntheticSourceInfo } from "./source-info.ts";
export { isInstallTelemetryEnabled } from "./telemetry.ts";
export {
	getResolvedThemeColors,
	getThemeByName,
	getThemeExportColors,
	loadThemeFromPath,
	setThemeResolver,
	type Theme,
	theme,
} from "./theme.ts";
export { printTimings, resetTimings, time } from "./timings.ts";
export {
	computeEditsDiff,
	type Edit,
	type EditDiffError,
	type EditDiffResult,
	generateDiffString,
	generateUnifiedPatch,
} from "./tools/edit-diff.ts";
// Tools
export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLocalBashOperations,
	createLocalPowerShellOperations,
	createLsToolDefinition,
	createPowerShellToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
	formatSize,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
	type PowerShellOperations,
	type PowerShellSpawnContext,
	type PowerShellSpawnHook,
	type PowerShellToolDetails,
	type PowerShellToolInput,
	type PowerShellToolOptions,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
	type ToolName,
	type ToolsOptions,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
	withFileMutationQueue,
} from "./tools/index.ts";
export { resolveReadPath, resolveReadPathAsync, resolveToCwd } from "./tools/path-utils.ts";
export {
	getProjectTrustOptions,
	hasTrustRequiringProjectResources,
	type ProjectTrustDecision,
	type ProjectTrustOption,
	ProjectTrustStore,
	type ProjectTrustStoreEntry,
	type ProjectTrustUpdate,
} from "./trust-manager.ts";
export {
	addUsageToTotals,
	createUsageTotals,
	getUsageCostBreakdown,
	type UsageCostBreakdownEntry,
	type UsageTotals,
} from "./usage-totals.ts";
export {
	type ModelRoute,
	type ModelRouteReason,
	type ModelRouteRequest,
	VIRTUAL_MODEL_STATE_ENTRY,
	type VirtualModelDefinition,
	type VirtualModelStateData,
} from "./virtual-models.ts";
