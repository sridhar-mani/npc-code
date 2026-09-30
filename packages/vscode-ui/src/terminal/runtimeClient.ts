#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
	createRemoteServiceBinding,
	defineService,
	type Context,
	type ReplicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Client } from "@earendil-works/pi-client";
import { createUnixTransportFactory } from "@earendil-works/pi-client/unix";
import type { AgentPromptRequest, AgentQueueResponse, AgentOperationResponse } from "./runtimeClientTypes";

interface SessionSummary {
	serverId: string;
	sessionId: string;
	createdAt: number;
}

interface SessionDirectory {
	readonly state: ReplicatedState<{ revision: number; sessions: SessionSummary[] }>;
}

interface SessionManagement {
	create(options: { id?: string }, context: Context): Promise<SessionSummary>;
	attach(sessionId: string, context: Context): Promise<void>;
	detach(context: Context): Promise<void>;
}

interface AgentController {
	prompt(request: AgentPromptRequest, context: Context): Promise<AgentOperationResponse>;
	steer(request: AgentPromptRequest, context: Context): Promise<AgentQueueResponse>;
	followUp(request: AgentPromptRequest, context: Context): Promise<AgentQueueResponse>;
	requestAbort(operationId: string, context: Context): Promise<void>;
}

interface Transcript {
	readonly state: ReplicatedState<{
		snapshot: unknown;
		event: any;
	}>;
}

const SessionDirectory = defineService<SessionDirectory>("pi.session-directory");
const SessionManagement = defineService<SessionManagement>("pi.session-management");
const AgentController = defineService<AgentController>("pi.agent-controller");
const Transcript = defineService<Transcript>("pi.transcript");

function readArg(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArg(name: string): string {
	const value = readArg(name);
	if (!value) throw new Error(`Missing required argument: ${name}`);
	return value;
}

async function main(): Promise<void> {
	const serverId = requiredArg("--server-id");
	const socketPath = requiredArg("--socket");
	const requestedSessionId = readArg("--session-id");

	const client = await Client.connect({
		serverId,
		transportFactory: createUnixTransportFactory({ path: socketPath }),
	});

	const serverTransport = client.serviceTransport({ serverId: client.serverId });
	const serverBinding = createRemoteServiceBinding({
		services: [SessionDirectory, SessionManagement],
		transport: serverTransport,
		bound: true,
		assertAccess() {},
		onError: (error) => process.stderr.write(`[Pi] server service error: ${error.message}\\n`),
	});
	await serverBinding.ready(BACKGROUND_CONTEXT);
	const management = serverBinding.use(SessionManagement);

	const summary = requestedSessionId
		? { serverId, sessionId: requestedSessionId, createdAt: Date.now() }
		: await management.create({}, BACKGROUND_CONTEXT);
	if (requestedSessionId) await management.attach(requestedSessionId, BACKGROUND_CONTEXT);

	const sessionTransport = client.serviceTransport(() => client.attachment);
	const sessionBinding = createRemoteServiceBinding({
		services: [AgentController, Transcript],
		transport: sessionTransport,
		bound: true,
		assertAccess() {
			if (!client.attachment) throw new Error("Pi runtime session is not attached");
		},
		onError: (error) => process.stderr.write(`[Pi] session service error: ${error.message}\\n`),
	});
	await sessionBinding.ready(BACKGROUND_CONTEXT);

	const controller = sessionBinding.use(AgentController);
	const transcript = sessionBinding.use(Transcript);

	let activeOperationId: string | undefined;
	let lastPrintedEventId = "";
	const unsubscribe = transcript.state.subscribe((state) => {
		const event = state.event;
		if (!event || event === lastPrintedEventId) return;
		lastPrintedEventId = event;
		if (event.type === "message_update" && event.frame?.type === "text_delta") {
			process.stdout.write(event.frame.delta);
		} else if (event.type === "tool_start") {
			process.stdout.write(`\\n[tool] ${event.toolName}\\n`);
		} else if (event.type === "tool_end") {
			process.stdout.write(`[tool done] ${event.toolName}\\n`);
		} else if (event.type === "run_end") {
			activeOperationId = undefined;
			process.stdout.write("\\n");
		}
	});

	process.stdout.write(`Attached to Ziq Pi session ${summary.sessionId}\\n> `);
	const rl = createInterface({ input, output, terminal: true });

	const submit = async (message: string): Promise<void> => {
		const request: AgentPromptRequest = { message, images: null };
		let result: AgentOperationResponse | AgentQueueResponse;
		if (activeOperationId) {
			result = await controller.steer(request, BACKGROUND_CONTEXT);
		} else {
			result = await controller.prompt(request, BACKGROUND_CONTEXT);
		}
		if (result.accepted) {
			if ("operationId" in result && result.operationId) activeOperationId = result.operationId;
			process.stdout.write("");
		} else {
			process.stderr.write(`[Pi] ${result.error.message}\\n`);
		}
	};

	try {
		for await (const line of rl) {
			const message = line.trim();
			if (!message) {
				process.stdout.write("> ");
				continue;
			}
			if (message === "/exit" || message === "/quit") break;
			if (message === "/abort" && activeOperationId) {
				await controller.requestAbort(activeOperationId, BACKGROUND_CONTEXT);
				continue;
			}
			await submit(message);
			if (!activeOperationId) process.stdout.write("> ");
		}
	} finally {
		rL:
		try { rl.close(); } catch {}
		unsubscribe();
		await sessionBinding.dispose(BACKGROUND_CONTEXT);
		await serverBinding.dispose(BACKGROUND_CONTEXT);
		await client.dispose();
	}
}

main().catch((error) => {
	process.stderr.write(`[Pi] terminal client failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\\n`);
	process.exitCode = 1;
});
