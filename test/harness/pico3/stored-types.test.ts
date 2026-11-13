import type { JsonRepresentation } from "@earendil-works/chord/json";
import { expectTypeOf, it } from "vitest";
import type { JsonValue, QueuedInput, Stored, StoredMessage } from "../../../src/harness/pico3/types.ts";

it("keeps chord projection semantics and durable messages assignable to JSON", () => {
	expectTypeOf<Stored<{ value?: string; list: readonly number[] }>>().toEqualTypeOf<
		JsonRepresentation<{ value?: string; list: readonly number[] }>
	>();
	expectTypeOf<Stored<{}>>().toEqualTypeOf<JsonRepresentation<{}>>();
	expectTypeOf<Stored<() => void>>().toEqualTypeOf<JsonRepresentation<() => void>>();
	expectTypeOf<StoredMessage>().toExtend<JsonValue>();
	expectTypeOf<QueuedInput[]>().toExtend<JsonValue>();
});
