import type { Context, ContextKey } from "@earendil-works/chord/context";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	createContextKey,
	TODO_CONTEXT,
	withAbortSignal,
	withCancel,
	withContextValue,
	withTelemetry,
	withoutAbortSignal,
} from "@earendil-works/chord/context";
import { NOOP_TELEMETRY_CONTEXT, type TelemetryContext, type TelemetrySpan } from "@earendil-works/pi-telemetry";

export {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	type Context,
	type ContextKey,
	createContextKey,
	TODO_CONTEXT,
	withAbortSignal,
	withCancel,
	withContextValue,
	withoutAbortSignal,
};

const TELEMETRY_CONTEXT_KEY = createContextKey<{ parent: TelemetryContext; native: TelemetrySpan }>(
	"pi.telemetryContext",
);

function isTelemetrySpan(parent: TelemetryContext): parent is TelemetrySpan {
	return "addEvent" in parent && "setAttributes" in parent && "setStatus" in parent && "addLink" in parent;
}

/**
 * Return the telemetry parent attached to a context: the recorder or span
 * installed by {@link withTelemetryContext}, or the context's own telemetry span.
 */
export function getTelemetryContext(context: Context): TelemetryContext {
	const attached = context.value(TELEMETRY_CONTEXT_KEY);
	// A later chord withTelemetry() takes precedence over the recorder inherited through values.
	return attached !== undefined && context.telemetry === attached.native ? attached.parent : context.telemetry;
}

/** Derive a context whose telemetry children use the supplied parent or active span. */
export function withTelemetryContext(telemetryContext: TelemetryContext, context: Context): Context {
	// A distinct no-op span lets a later explicit chord no-op override suppress the recorder.
	const native = isTelemetrySpan(telemetryContext) ? telemetryContext : Object.freeze({ ...NOOP_TELEMETRY_CONTEXT });
	return withContextValue(TELEMETRY_CONTEXT_KEY, { parent: telemetryContext, native }, withTelemetry(native, context));
}
