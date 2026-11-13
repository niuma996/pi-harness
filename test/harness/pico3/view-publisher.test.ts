import assert from "node:assert/strict";
import { onTestFinished, test } from "vitest";
import { createConversationViewPublisher } from "../../../src/harness/pico3/chord.ts";
import { ctx, open } from "./helpers.ts";

async function publisher() {
	const env = await open({});
	onTestFinished(() => env.close());
	const watch = await env.root.watch(ctx);
	watch.stop();
	return createConversationViewPublisher({ ...structuredClone(watch.view), commit: { events: [] } });
}

test("publisher discards partial mutations, retains old snapshots and remains usable", async () => {
	const view = await publisher();
	const before = view.value;
	let deliveries = 0;
	const stop = view.subscribe(() => { deliveries++; });
	assert.throws(() => view.change(ctx, (draft) => {
		draft.config.threshold = 999;
		throw new Error("mutation failed");
	}), /mutation failed/);
	assert.equal(view.value, before);
	assert.equal(deliveries, 0);
	view.change(ctx, (draft) => { draft.config.threshold = 1; });
	assert.notEqual(view.value, before);
	assert.equal(deliveries, 1);
	assert.deepEqual(before.commit.events, []);
	stop();
	view.change(ctx, (draft) => { draft.config.threshold = 2; });
	assert.equal(deliveries, 1);
});

test("publisher delivers nested publications in sequence with their own snapshots", async () => {
	const view = await publisher();
	const seen: number[] = [];
	view.subscribe((_value, context, delivery) => {
		if (delivery.sequence === 1) view.change(context, (draft) => { draft.config.threshold = 2; });
	});
	const snapshots: unknown[] = [];
	view.subscribe((value, _context, delivery) => {
		seen.push(delivery.sequence);
		snapshots.push(value);
	});
	view.change(ctx, (draft) => { draft.config.threshold = 1; });
	assert.deepEqual(seen, [1, 2]);
	assert.notEqual(snapshots[0], snapshots[1]);
	assert.equal(snapshots[1], view.value);
});


test("subscriber failures cannot roll back a committed view or prevent other subscribers", async () => {
	const view = await publisher();
	view.subscribe(() => { throw new Error("subscriber failed"); });
	let delivered = false;
	view.subscribe(() => { delivered = true; });
	assert.doesNotThrow(() => view.change(ctx, (draft) => { draft.config.threshold = 1; }));
	assert.equal(view.value.config.threshold, 1);
	assert.equal(delivered, true);
});

test("a nested mutation is rejected without changing the committed snapshot", async () => {
	const view = await publisher();
	const before = view.value;
	assert.throws(() => view.change(ctx, (draft) => {
		draft.config.threshold = 1;
		view.change(ctx, (nested) => { nested.config.threshold = 2; });
	}), /during a view mutation/);
	assert.equal(view.value, before);
});
