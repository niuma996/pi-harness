import { describe, expect, it } from "vitest";
import { withTelemetry } from "@earendil-works/chord/context";
import {
	BACKGROUND_CONTEXT,
	createContextKey,
	getTelemetryContext,
	TODO_CONTEXT,
	withAbortSignal,
	withContextValue,
	withTelemetryContext,
} from "../../src/harness/context.ts";
import { InMemoryTelemetryContext, NOOP_TELEMETRY_CONTEXT } from "../../src/index.ts";

describe("harness Context telemetry", () => {
	it("uses no-op telemetry when none is attached", () => {
		expect(getTelemetryContext(BACKGROUND_CONTEXT)).toBe(NOOP_TELEMETRY_CONTEXT);
		expect(getTelemetryContext(TODO_CONTEXT)).toBe(NOOP_TELEMETRY_CONTEXT);
	});

	it("carries telemetry as an ordinary context value", async () => {
		const telemetry = new InMemoryTelemetryContext();
		const context = withTelemetryContext(telemetry, BACKGROUND_CONTEXT);

		await getTelemetryContext(context).startSpan({ name: "parent" }, async (span) => {
			const childContext = withTelemetryContext(span, context);
			await getTelemetryContext(childContext).startSpan({ name: "child" }, () => undefined);
		});

		const spans = telemetry.getSpans();
		expect(spans.map((span) => span.name)).toEqual(["parent", "child"]);
		expect(spans[1]?.parentId).toBe(spans[0]?.id);
	});

	it("uses a chord-native parent, including one derived from a recorder context", async () => {
		const recorder = new InMemoryTelemetryContext();
		await recorder.startSpan({ name: "native" }, async (span) => {
			const context = withTelemetry(span, withTelemetryContext(recorder, BACKGROUND_CONTEXT));
			expect(getTelemetryContext(context)).toBe(span);
			await getTelemetryContext(context).startSpan({ name: "child" }, () => undefined);
		});
		expect(recorder.getSpans()[1]?.parentId).toBe(recorder.getSpans()[0]?.id);
	});

	it("exposes harness spans to chord", async () => {
		const recorder = new InMemoryTelemetryContext();
		await recorder.startSpan({ name: "parent" }, (span) => {
			const context = withTelemetryContext(span, BACKGROUND_CONTEXT);
			expect(context.telemetry).toBe(span);
		});
	});

	it("lets an explicit recorder replace an inherited native span", async () => {
		const first = new InMemoryTelemetryContext();
		const second = new InMemoryTelemetryContext();
		await first.startSpan({ name: "parent" }, (span) => {
			const context = withTelemetryContext(second, withTelemetry(span, BACKGROUND_CONTEXT));
			expect(getTelemetryContext(context)).toBe(second);
		});
	});

	it("preserves values and cancellation while changing telemetry parents", async () => {
		const recorder = new InMemoryTelemetryContext();
		const key = createContextKey<string>("caller");
		const controller = new AbortController();
		const base = withAbortSignal(controller.signal, withContextValue(key, "value", BACKGROUND_CONTEXT));
		await recorder.startSpan({ name: "parent" }, (span) => {
			const context = withTelemetryContext(span, withTelemetryContext(recorder, base));
			expect(context.value(key)).toBe("value");
			expect(context.abortSignal).toBe(controller.signal);
			expect(context.telemetry.metrics).toBe(recorder.metrics);
			controller.abort();
			expect(context.abortSignal?.aborted).toBe(true);
		});
	});

	it("honors chord's explicit no-op override of an inherited recorder", async () => {
		const recorder = new InMemoryTelemetryContext();
		const context = withTelemetry(NOOP_TELEMETRY_CONTEXT, withTelemetryContext(recorder, BACKGROUND_CONTEXT));
		expect(getTelemetryContext(context)).toBe(NOOP_TELEMETRY_CONTEXT);
		await getTelemetryContext(context).startSpan({ name: "disabled" }, () => undefined);
		expect(recorder.getSpans()).toHaveLength(0);
	});
});
