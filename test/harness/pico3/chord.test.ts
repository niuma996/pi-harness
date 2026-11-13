import assert from "node:assert/strict";
import { onTestFinished, test } from "vitest";
import {
	attachChordView,
	createPicoConversationService,
	createConversationViewPublisher,
	type PublishedConversationView,
} from "../../../src/harness/pico3/chord.ts";
import type { Envelope, JsonObject } from "../../../src/harness/pico3/types.ts";
import { ctx, open, sleep } from "./helpers.ts";

test("conversation observation reports loaded and newly committed conversations off the Session line", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	const ids: number[] = [];
	const stop = env.h.onConversation((conversation) => ids.push(conversation.id));
	onTestFinished(stop);
	assert.deepEqual(ids, [env.root.id]);
	const child = await env.h.createConversation({}, ctx);
	assert.deepEqual(ids, [env.root.id, child.id]);
	stop();
	await env.h.createConversation({}, ctx);
	assert.deepEqual(ids, [env.root.id, child.id]);
});

test("Chord bridge publishes exactly once per Pico envelope and converges to a fresh snapshot", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	const raw = await env.root.watch(ctx);
	const envelopes: Envelope[] = [];
	raw.start((envelope) => envelopes.push(envelope));
	const bridge = await attachChordView(env.root, createConversationViewPublisher, ctx);
	onTestFinished(() => bridge.close());
	const service = createPicoConversationService(env.h, env.root, bridge.view);
	const initial = bridge.view.value;
	const deliveries: { sequence: number; events: PublishedConversationView["commit"]["events"] }[] = [];
	const unsubscribe = bridge.view.subscribe((value, _context, delivery) => {
		if (delivery.kind === "update") deliveries.push({ sequence: delivery.sequence, events: value.commit.events });
	});
	onTestFinished(unsubscribe);

	await (await env.root.send({ content: "hello" }, ctx)).wait(ctx);
	await env.root.waitForIdle(ctx);
	await sleep(0);
	assert.equal(deliveries.length, envelopes.length);
	assert.equal(initial.entries.length, 0);
	assert.deepEqual(
		deliveries.map((delivery) => delivery.sequence),
		deliveries.map((_, index) => index + 1),
	);
	assert.deepEqual(
		deliveries.map((delivery) => delivery.events),
		envelopes.map((envelope) => envelope.events),
	);
	const invalidPatches: JsonObject[] = [
		{ threshold: "not-a-number" },
		{ selectedTools: "not-an-array" },
		{ retry: 5 },
		{ model: null },
		{ steeringMode: "sometimes" },
	];
	for (const patch of invalidPatches) await assert.rejects(service.configSet(patch, ctx), /invalid config value/);
	await assert.rejects(
		service.fork("start", { rewindable: { threshold: "not-a-number" } } as never, ctx),
		/invalid rewindable config value/,
	);
	await service.configSet({ threshold: 123, selectedTools: ["bash"], steeringMode: "all" }, ctx);
	assert.equal((await env.root.config.get(ctx)).threshold, 123);
	const foreign = await env.h.createConversation({}, ctx);
	const foreignInput = await foreign.send({ content: "foreign" }, ctx);
	await assert.rejects(service.inputAbort(foreignInput.id, ctx), /outside conversation/);
	await foreignInput.wait(ctx);
	const fresh = await env.root.watch(ctx);
	fresh.stop();
	const { commit: _commit, ...published } = bridge.view.value;
	assert.deepEqual(published, fresh.view);
	raw.stop();
});

test("Chord publication failure closes only the bridge and never rejects the persisted writer", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	let reported: Error | undefined;
	const bridge = await attachChordView(
		env.root,
		(initial) => {
			const state = createConversationViewPublisher(initial);
			return {
				get value() { return state.value; },
				subscribe: state.subscribe,
				change() {
					throw new Error("publish failed");
				},
			};
		},
		ctx,
		{
			onFailure: (error) => {
				reported = error;
			},
		},
	);
	onTestFinished(() => bridge.close());
	const input = await env.root.send({ content: "persist anyway" }, ctx);
	assert.equal((await input.wait(ctx)).status, "done");
	await sleep(0);
	assert.equal(bridge.closed, true);
	assert.match(reported?.message ?? "", /publish failed/);
});

test("closing the bridge stops publication while persisted writes continue", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	const bridge = await attachChordView(env.root, createConversationViewPublisher, ctx);
	let deliveries = 0;
	bridge.view.subscribe(() => {
		deliveries++;
	});
	bridge.close();
	bridge.close();
	const initial = bridge.view.value;
	assert.equal((await (await env.root.send({ content: "after close" }, ctx)).wait(ctx)).status, "done");
	await sleep(0);
	assert.equal(bridge.closed, true);
	assert.equal(deliveries, 0);
	assert.equal(bridge.view.value, initial);
});

test("overflow discards queued envelopes and closes the source watch", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	const raw = await env.root.watch(ctx);
	let reported: Error | undefined;
	const bridge = await attachChordView(
		{ watch: async () => ({
			get view() { return raw.view; },
			get revision() { return raw.revision; },
			get closed() { return raw.closed; },
			stop: () => raw.stop(),
			start(listener) {
				listener({ revision: 1, ops: [], events: [] });
				listener({ revision: 2, ops: [], events: [] });
			},
		}) },
		createConversationViewPublisher, ctx, { capacity: 1, onFailure: (error) => { reported = error; } },
	);
	let deliveries = 0;
	bridge.view.subscribe(() => {
		deliveries++;
	});
	await sleep(0);
	assert.equal(bridge.closed, true);
	assert.equal(raw.closed, true);
	assert.equal(deliveries, 0);
	assert.match(reported?.message ?? "", /queue exceeded 1 envelopes/);
});
