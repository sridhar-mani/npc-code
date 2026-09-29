import type { BugReportBundle } from "./bug-report.ts";
interface UploadBugReportOptions {
	token?: string;
	signal?: AbortSignal;
	gatewayUrl?: string;
}
/** Upload a report as multipart form data, anonymously or attributed to a Radius account. */
export declare function uploadBugReport(
	bundle: BugReportBundle,
	options?: UploadBugReportOptions,
): Promise<{
	id: string;
}>;
//# sourceMappingURL=bug-report-upload.d.ts.map
