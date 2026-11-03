import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { withTelemetry } from "@earendil-works/chord/context";
import { InMemoryTelemetryContext } from "@earendil-works/pi-telemetry";
import { describe, expect, it } from "vitest";
import { completeSimpleWithRetries } from "../../src/harness/compaction/compaction.ts";
import { BACKGROUND_CONTEXT, type Context, withTelemetryContext } from "../../src/harness/context.ts";
import { streamHarnessAssistant } from "../../src/harness/execution/assistant.ts";

function setup() {
	const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
	faux.setResponses([fauxAssistantMessage("hello")]);
	const models = createModels();
	models.setProvider(faux.provider);
	return { models, model: faux.getModel() };
}

async function generate(context: Context) {
	const { models, model } = setup();
	return streamHarnessAssistant(
		[{ role: "user", content: "hello", timestamp: 1 }],
		{
			model,
			systemPrompt: "",
			thinkingLevel: "off",
			streamOptions: {},
			toProviderMessages: (messages) => messages.filter((m) => m.role === "user"),
			request: (input, options) => models.streamSimple(model, input, options),
			observer: { start() {}, update() {}, end() {} },
		},
		context,
	);
}

describe("model request telemetry", () => {
	it("records Models spans and metrics from a recorder through stream completion", async () => {
		const recorder = new InMemoryTelemetryContext();
		expect((await generate(withTelemetryContext(recorder, BACKGROUND_CONTEXT))).stopReason).toBe("stop");
		const spans = recorder.getSpans();
		expect(spans.some((span) => span.name === "pi.ai.request")).toBe(true);
		expect(spans.every((span) => span.settled)).toBe(true);
		expect(recorder.getMetrics().some((metric) => metric.name === "pi.ai.request.duration")).toBe(true);
	});

	it("keeps the recorder parent open while a provider is producing its response", async () => {
		const recorder = new InMemoryTelemetryContext();
		const models = createModels();
		const faux = fauxProvider();
		faux.setResponses([
			() => {
				expect(recorder.getSpans().find((span) => span.name === "pi.harness.model_request")?.settled).toBe(false);
				return fauxAssistantMessage("hello");
			},
		]);
		models.setProvider(faux.provider);
		await completeSimpleWithRetries(
			models,
			faux.getModel(),
			{ messages: [] },
			{},
			undefined,
			undefined,
			withTelemetryContext(recorder, BACKGROUND_CONTEXT),
		);
		expect(recorder.getSpans().every((span) => span.settled)).toBe(true);
	});

	it("preserves a chord-native request parent", async () => {
		const recorder = new InMemoryTelemetryContext();
		await recorder.startSpan({ name: "caller" }, (span) => generate(withTelemetry(span, BACKGROUND_CONTEXT)));
		const spans = recorder.getSpans();
		expect(spans.find((span) => span.name === "pi.ai.request")?.parentId).toBe(spans[0]?.id);
	});

	it("records standalone summary requests from a recorder", async () => {
		const recorder = new InMemoryTelemetryContext();
		const { models, model } = setup();
		await completeSimpleWithRetries(
			models,
			model,
			{ messages: [] },
			{},
			undefined,
			undefined,
			withTelemetryContext(recorder, BACKGROUND_CONTEXT),
		);
		expect(recorder.getSpans().some((span) => span.name === "pi.ai.request")).toBe(true);
		expect(recorder.getSpans().every((span) => span.settled)).toBe(true);
	});
});
