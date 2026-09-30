#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createRemoteServiceBinding, defineService, type Context, type ReplicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Client, createClientServiceTransport } from "@earendil-works/pi-client";
import { createUnixTransportFactory } from "@earendil-works/pi-client/unix";
import {
	AgentController,
	SessionDirectory,
	SessionManagement,
	Transcript,
	type AgentPromptRequest,
	type AgentOperationResponse,
	type AgentQueueResponse,
	type SessionSummary,
} from "../runtime/runtimeServices";

function readArg(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArg(name: string): string {
	const value = readArg(name);
	if (!value) throw new Error(`Missing required argument: ${name}`);
	return value;
}

async function waitForAttachment(client: Client, sessionId: string): Promise<void> {
	if (client.attachment?.sessionId === sessionId) return;
	await new Promise<void>((resolve) => {
		const remove = client.onAttachmentChange((attachment) => {
			if (attachment?.sessionId === sessionId) {
				remove();
				resolve();
			}
		});
	});
}

async function main(): Promise<void> {
	const serverId = requiredArg("--server-id");
	const socketPath = requiredArg("--socket");
	const requestedSessionId = readArg("--session-id");

	const client = await Client.connect({
		serverId,
		transportFactory: createUnixTransportFactory({ path: socketPath }),
	});

	const serverTransport = createClientServiceTransport(client, () => ({ serverId: client.serverId }));
	const serverBinding = createRemoteServiceBinding({
		services: [SessionDirectory, SessionManagement],
		transport: serverTransport,
		bound: true,
		assertAccess() {},
		onError: (error) => process.stderr.write(`[Pi] server service error: ${error.message}\n`),
	});
	await serverBinding.ready(BACKGROUND_CONTEXT);
	const management = serverBinding.use(SessionManagement);

	const summary: SessionSummary = requestedSessionId
		? { serverId, sessionId: requestedSessionId, name: "New Session", createdAt: Date.now() }
		: await management.create({}, BACKGROUND_CONTEXT);
	await management.attach(summary.sessionId, BACKGROUND_CONTEXT);
	await waitForAttachment(client, summary.sessionId);

	const sessionTransport = createClientServiceTransport(client, () => client.attachment);
	const sessionBinding = createRemoteServiceBinding({
		services: [AgentController, Transcript],
		transport: sessionTransport,
		bound: true,
		assertAccess() {
			if (!client.attachment) throw new Error("Pi runtime session is not attached");
		},
		onError: (error) => process.stderr.write(`[Pi] session service error: ${error.message}\n`),
	});
	await sessionBinding.ready(BACKGROUND_CONTEXT);

	const controller = sessionBinding.use(AgentController);
	const transcript = sessionBinding.use(Transcript);


	const directory = serverBinding.use(SessionDirectory);
	let displayedSessionName = directory.state.value?.sessions.find((entry) => entry.sessionId === summary.sessionId)?.name ?? summary.name;
	const updateSessionName = (state: { sessions: SessionSummary[] }) => {
		const current = state.sessions.find((entry) => entry.sessionId === summary.sessionId);
		if (!current || current.name === displayedSessionName) return;
		displayedSessionName = current.name;
		process.stdout.write(`\nSession: ${displayedSessionName}\n> `);
	};
	const unsubscribeDirectory = directory.state.subscribe(updateSessionName);

	let activeOperationId: string | undefined;
	let lastPrintedEvent: any;
	const unsubscribe = transcript.state.subscribe((state) => {
		const event = state.event;
		if (!event || event === lastPrintedEvent) return;
		lastPrintedEvent = event;
		if (event.type === "message_update" && event.frame?.type === "text_delta") {
			process.stdout.write(event.frame.delta);
		} else if (event.type === "tool_start") {
			process.stdout.write(`\n[tool] ${event.toolName}\n`);
		} else if (event.type === "tool_end") {
			process.stdout.write(`[tool done] ${event.toolName}\n`);
		} else if (event.type === "run_end") {
			activeOperationId = undefined;
			process.stdout.write("\n> ");
		}
	});

	process.stdout.write(`Session: ${summary.name}\nAttached to Ziq runtime ${summary.sessionId}\n> `);
	const rl = createInterface({ input, output, terminal: true });

	const submit = async (message: string): Promise<void> => {
		const request: AgentPromptRequest = { message };
		let result: AgentOperationResponse | AgentQueueResponse;
		if (activeOperationId) {
			result = await controller.steer(request, BACKGROUND_CONTEXT);
		} else {
			result = await controller.prompt(request, BACKGROUND_CONTEXT);
		}
		if (!result.accepted) {
			process.stderr.write(`[Pi] ${result.error.message}\n`);
			return;
		}
		if ("operationId" in result) activeOperationId = result.operationId;
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
		}
	} finally {
		try { rl.close(); } catch {}
		unsubscribe();
		unsubscribeDirectory();
		await sessionBinding.dispose(BACKGROUND_CONTEXT);
		await serverBinding.dispose(BACKGROUND_CONTEXT);
		await client.dispose();
	}
}

main().catch((error) => {
	process.stderr.write(`[Pi] terminal client failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
	process.exitCode = 1;
});
