import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { normalizeContext } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { expect, it } from "vitest";

it("sends TypeBox parameters through pi-ai's strict provider request path", async () => {
	const model: Model<"openai-completions"> = {
		id: "test",
		name: "Test",
		api: "openai-completions",
		provider: "openai",
		baseUrl: "https://example.invalid/v1",
		compat: { supportsStrictMode: true },
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 4096,
		maxTokens: 128,
	};
	let payload: unknown;
	const stream = streamSimple(
		model,
		normalizeContext({
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
			tools: [
				{
					name: "lookup",
					description: "Lookup",
					parameters: Type.Object({ query: Type.String() }),
					constrainedSampling: { type: "json_schema", strict: "require" },
				},
			],
		}),
		{
			apiKey: "test",
			maxRetries: 0,
			fetch: async (_input, init) => {
				payload = JSON.parse(String(init?.body));
				return new Response(
					'data: {"id":"response","object":"chat.completion.chunk","created":0,"model":"test","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
					{
						status: 200,
						headers: { "content-type": "text/event-stream" },
					},
				);
			},
		},
	);
	for await (const _event of stream) {
		/* Consume the provider stream before inspecting its result. */
	}
	expect((await stream.result()).stopReason).toBe("stop");
	expect(payload).toMatchObject({
		tools: [
			{
				type: "function",
				function: {
					name: "lookup",
					strict: true,
					parameters: {
						type: "object",
						properties: { query: { type: "string" } },
						required: ["query"],
						additionalProperties: false,
					},
				},
			},
		],
	});
});
