import type { Context } from "../context.ts";
import { getTelemetryContext, withTelemetryContext } from "../context.ts";

/** Keep recorder-owned request parents alive until the response stream has been consumed. */
export async function withModelTelemetry<T>(
	context: Context,
	callback: (context: Context) => T | Promise<T>,
): Promise<T> {
	const parent = getTelemetryContext(context);
	if (parent === context.telemetry) return callback(context);
	return parent.startSpan({ name: "pi.harness.model_request" }, (span) =>
		callback(withTelemetryContext(span, context)),
	);
}
