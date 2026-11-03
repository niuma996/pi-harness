import { traceIn } from "@earendil-works/chord/context";
import {
	createAssistantMessageEventStream,
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { InMemoryTelemetryContext, type TelemetrySpan } from "@earendil-works/pi-telemetry";
import { describe, expect, it, vi } from "vitest";
import { AgentHarness } from "../../src/harness/agent-harness.ts";
import { BACKGROUND_CONTEXT, withAbortSignal, withTelemetryContext } from "../../src/harness/context.ts";
import { streamHarnessAssistant } from "../../src/harness/execution/assistant.ts";
import { Lane } from "../../src/harness/runtime/lane.ts";
import { MemoryStorage } from "../../src/harness/session/memory.ts";
import { StorageBackedSession } from "../../src/harness/session/session.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

// A producer that acknowledges cancellation before releasing its terminal result.
function controlledProducer() {
	const aborted = deferred();
	const release = deferred();
	let signal: AbortSignal | undefined;
	const stream = (_model: unknown, _input: unknown, options?: SimpleStreamOptions) => {
		signal = options?.signal;
		const output = createAssistantMessageEventStream();
		queueMicrotask(async () => {
			const partial = fauxAssistantMessage("partial");
			output.push({ type: "start", partial });
			output.push({ type: "text_delta", contentIndex: 0, delta: "partial", partial });
			if (!signal?.aborted) await new Promise<void>((done) => signal?.addEventListener("abort", () => done(), { once: true }));
			aborted.resolve();
			await release.promise;
			await options?.telemetry?.startSpan({ name: "producer_cleanup" }, () => undefined);
			const result = fauxAssistantMessage([], { stopReason: "aborted", errorMessage: "producer aborted" });
			output.push({ type: "error", reason: "aborted", error: result });
			output.end(result);
		});
		return output;
	};
	return { stream, aborted, release, get signal() { return signal; } };
}

describe("request observer failure cleanup", () => {
	it.each(["start", "update"] as const)("aborts and settles the producer before closing telemetry after %s fails", async (phase) => {
		const producer = controlledProducer();
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider({ ...faux.provider, streamSimple: producer.stream });
		const recorder = new InMemoryTelemetryContext();
		const caller = new AbortController();
		const failure = new Error(`${phase} failed`);
		let finished = false;
		const request = streamHarnessAssistant([], {
			model: faux.getModel(), systemPrompt: "", thinkingLevel: "off", streamOptions: {},
			toProviderMessages: () => [],
			request: (input, options) => models.streamSimple(faux.getModel(), input, options),
			observer: {
				start() { if (phase === "start") throw failure; },
				async update() { if (phase === "update") throw failure; },
				end() { throw new Error("must not deliver end after observer failure"); },
			},
		}, withTelemetryContext(recorder, withAbortSignal(caller.signal, BACKGROUND_CONTEXT)));
		const outcome = request.catch((error: unknown) => error).finally(() => { finished = true; });
		try {
			await expect.poll(() => producer.signal?.aborted).toBe(true);
			await producer.aborted.promise;
			expect(producer.signal?.reason).toBe(failure);
			expect(caller.signal.aborted).toBe(false);
			expect(finished).toBe(false);
			expect(recorder.getSpans().every((span) => !span.settled)).toBe(true);
		} finally {
			// Release the pre-fix producer as well, so a failing test leaves no work behind.
			caller.abort();
			producer.release.resolve();
		}
		expect(await outcome).toBe(failure);
		const spans = recorder.getSpans();
		expect(spans.every((span) => span.settled)).toBe(true);
		expect(spans.some((span) => span.name === "producer_cleanup")).toBe(true);
		expect(spans.find((span) => span.name === "pi.ai.request")?.endSequence).toBeLessThan(
			spans.find((span) => span.name === "pi.harness.model_request")!.endSequence!,
		);
	});
});

async function deferredFixture() {
	const session = new StorageBackedSession({ id: "callback-context", createdAt: 1, storageVersion: 1 }, new MemoryStorage());
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const { harness } = await AgentHarness.create({ session, models, model: faux.getModel(), streamOptions: { deferred: true } }, BACKGROUND_CONTEXT);
	const lane = await harness.lane("main", BACKGROUND_CONTEXT);
	if (!(lane instanceof Lane)) throw new Error("Expected runtime lane");
	faux.setResponses([fauxAssistantMessage("answer")]);
	const submitted = await lane.prompt("defer", undefined, BACKGROUND_CONTEXT);
	if (!submitted.ok || submitted.value.status !== "suspended") throw new Error("Expected suspension");
	return { session, faux, models, harness, lane };
}

describe("deferred request callback context", () => {
	it("parents payload/response hooks and stream observers under the scoped request span", async () => {
		const { session, faux, models, harness, lane } = await deferredFixture();
		const recorder = new InMemoryTelemetryContext();
		let requestParent: TelemetrySpan | undefined;
		const seen: TelemetrySpan[] = [];
		const fetch = faux.provider.fetchDeferred!.bind(faux.provider);
		models.setProvider({ ...faux.provider, fetchDeferred: (model, handle, options) => {
			requestParent = options?.telemetry;
			const output = createAssistantMessageEventStream();
			void (async () => {
				await options?.onPayload?.({}, model);
				const source = fetch(model, handle, options);
				for await (const event of source) output.push(event);
				output.end(await source.result());
			})();
			return output;
		} });
		for (const name of ["before_payload", "after_response"] as const) {
			harness.hooks.on(name, async (_event, context) => {
				seen.push(context.telemetry);
				await traceIn({ name }, () => undefined, context);
				return undefined;
			});
		}
		const emit = lane.emitBatch;
		vi.spyOn(lane, "emitBatch").mockImplementation(async (events, context) => {
			for (const event of events) {
				if (["message_start", "message_update", "message_end"].includes(event.type)) {
					seen.push(context.telemetry);
					await traceIn({ name: event.type }, () => undefined, context);
				}
			}
			await emit(events, context);
		});
		try {
			expect(await lane.resume(withTelemetryContext(recorder, BACKGROUND_CONTEXT))).toMatchObject({ ok: true, value: { status: "completed" } });
			expect(seen.length).toBeGreaterThanOrEqual(5);
			expect(seen.every((parent) => parent === requestParent)).toBe(true);
			const spans = recorder.getSpans();
			const root = spans.find((span) => span.name === "pi.harness.model_request")!;
			for (const name of ["before_payload", "after_response", "message_start", "message_update", "message_end"]) {
				expect(spans.find((span) => span.name === name)?.parentId).toBe(root.id);
			}
		} finally {
			vi.restoreAllMocks();
			await harness.close(BACKGROUND_CONTEXT);
			await session.close(BACKGROUND_CONTEXT);
		}
	});
});
