import type { Context } from "@earendil-works/chord/context";
import { type Draft, type Op, type Path, type Seg, track } from "@earendil-works/chord/delta";
import { defineService } from "../../shims/define-service.ts";
import type { ConversationHandle, Harness } from "./harness.ts";
import type {
	ConversationSpec,
	ConversationView,
	Entry,
	EntryScan,
	Envelope,
	Id,
	JsonObject,
	NewEntry,
	SendInput,
	ViewEvent,
} from "./types.ts";
import { WATCH_CAPACITY, type Watch } from "./view.ts";

export type PublishedConversationView = ConversationView & {
	commit: { events: ViewEvent[] };
};

/** Readable host-owned publication; observation methods belong to the supplied adapter. */
export interface ConversationViewSource {
	readonly value: PublishedConversationView | undefined;
}

/**
 * A host-owned publisher. change must synchronously commit the entire mutation atomically,
 * retain previous snapshots, and discard the mutation if its callback throws.
 */
export interface ConversationViewPublisher extends ConversationViewSource {
	readonly value: PublishedConversationView;
	change(context: Context, mutate: (draft: Draft<PublishedConversationView>) => void): void;
}

export interface ConversationViewDelivery {
	readonly kind: "update";
	readonly sequence: number;
}

export type ConversationViewListener = (
	value: PublishedConversationView,
	context: Context,
	delivery: ConversationViewDelivery,
) => void | Promise<void>;

export interface ObservableConversationViewPublisher extends ConversationViewPublisher {
	/** Observe future revisions; the initial snapshot is available through value. Async listeners are not awaited. */
	subscribe(listener: ConversationViewListener): () => void;
}

/** Atomic local publication over Chord's delta tracker; subscriber failures cannot roll back a committed revision. */
export function createConversationViewPublisher(
	initial: PublishedConversationView,
	options: { onError?: (error: unknown) => void } = {},
): ObservableConversationViewPublisher {
	const tracker = track(structuredClone(initial));
	const listeners = new Set<ConversationViewListener>();
	const queue: {
		value: PublishedConversationView;
		context: Context;
		delivery: ConversationViewDelivery;
		listeners: ConversationViewListener[];
	}[] = [];
	let sequence = 0;
	let mutating = false;
	let delivering = false;
	const report = (error: unknown) => {
		try { options.onError?.(error); } catch {}
	};
	return {
		get value() { return tracker.value; },
		subscribe(listener) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		change(context, mutate) {
			if (mutating) throw new Error("Cannot publish during a view mutation");
			const change = tracker.beginChange();
			mutating = true;
			try {
				mutate(change.state);
				tracker.adopt(change.prepare());
			} catch (error) {
				change.abort();
				throw error;
			} finally {
				mutating = false;
			}
			queue.push({ value: tracker.value, context, delivery: { kind: "update", sequence: ++sequence }, listeners: [...listeners] });
			if (delivering) return;
			delivering = true;
			try {
				while (queue.length > 0) {
					const frame = queue.shift()!;
					for (const listener of frame.listeners) {
						if (!listeners.has(listener)) continue;
						try {
							const result = listener(frame.value, frame.context, frame.delivery);
							if (result) void Promise.resolve(result).catch(report);
						} catch (error) { report(error); }
					}
				}
			} finally {
				delivering = false;
			}
		},
	};
}

export interface PicoConversationService<TView extends ConversationViewSource = ConversationViewSource> {
	readonly view: TView;
	send(input: SendInput, ctx: Context): Promise<Id>;
	write(entry: NewEntry, ctx: Context): Promise<Id>;
	inputAbort(id: Id, ctx: Context): Promise<"aborted" | "already_placed" | "not_found">;
	configSet(patch: JsonObject, ctx: Context): Promise<void>;
	abort(ctx: Context): Promise<void>;
	reset(handoff: string | null, ctx: Context): Promise<void>;
	collapse(instructions: string | null, ctx: Context): Promise<Id>;
	fork(at: Id | "start", spec: Omit<ConversationSpec, "parent">, ctx: Context): Promise<Id>;
	entries(scan: EntryScan, ctx: Context): Promise<Entry[]>;
}

/** Local registration/control plane and remote keyed conversation contract used by Chord facets. */
export const PicoHarnessService = defineService<Harness>("pi.harness", { local: true });
export const PicoConversationService = defineService<PicoConversationService>("pi.conversation");

export function createPicoConversationService<
	Cfg extends object,
	TView extends ConversationViewSource = ConversationViewSource,
>(
	harness: Pick<Harness, "abortInput" | "entries">,
	conversation: ConversationHandle<Cfg>,
	view: TView,
): PicoConversationService<TView> {
	return {
		view,
		send: (input, ctx) => conversation.send(input, ctx).then((handle) => handle.id),
		write: (entry, ctx) => conversation.write(entry, ctx),
		inputAbort: (id, ctx) => harness.abortInput(id, ctx, conversation.id),
		configSet: (patch, ctx) => conversation.config.set(patch as never, ctx),
		abort: (ctx) => conversation.abort(ctx),
		reset: (handoff, ctx) => conversation.reset(handoff ?? undefined, ctx),
		collapse: (instructions, ctx) => conversation.collapse(instructions ?? undefined, ctx),
		fork: (at, spec, ctx) => conversation.fork(at, spec, ctx).then((child) => child.id),
		entries: (scan, ctx) => harness.entries({ ...scan, conversationId: conversation.id }, ctx),
	};
}

export interface ChordViewBridge<TView extends ConversationViewPublisher = ConversationViewPublisher> {
	readonly view: TView;
	readonly closed: boolean;
	close(): void;
}

export interface ChordViewBridgeOptions {
	capacity?: number;
	/** Called after the raw watch is closed. The owner should close and respawn its keyed service instance. */
	onFailure?: (error: Error) => void;
}

/**
 * Adapt Pico's commit-granular envelopes to one Chord publication per commit.
 * The raw listener only enqueues. Applying ops and publishing happen together,
 * off the Session line, with no await between them.
 */
export async function attachChordView<TView extends ConversationViewPublisher>(
	conversation: Pick<ConversationHandle, "watch">,
	createState: (initial: PublishedConversationView) => TView,
	ctx: Context,
	opts: ChordViewBridgeOptions = {},
): Promise<ChordViewBridge<TView>> {
	const watch = await conversation.watch(ctx);
	const view = createState({ ...structuredClone(watch.view), commit: { events: [] } });
	return bridgeWatch(watch, view, ctx, opts);
}

function bridgeWatch<TView extends ConversationViewPublisher>(
	watch: Watch,
	view: TView,
	ctx: Context,
	opts: ChordViewBridgeOptions,
): ChordViewBridge<TView> {
	const capacity = opts.capacity ?? WATCH_CAPACITY;
	if (!Number.isSafeInteger(capacity) || capacity < 1)
		throw new RangeError("Chord view queue capacity must be positive");
	const queue: Envelope[] = [];
	let scheduled = false;
	let closed = false;
	const fail = (cause: unknown) => {
		if (closed) return;
		closed = true;
		queue.length = 0;
		watch.stop();
		try {
			opts.onFailure?.(cause instanceof Error ? cause : new Error(String(cause)));
		} catch {}
	};
	const drain = () => {
		scheduled = false;
		while (!closed && queue.length > 0) {
			const envelope = queue.shift()!;
			try {
				view.change(ctx, (draft) => {
					applyTracked(draft, envelope.ops);
					draft.commit.events = envelope.events as Draft<ViewEvent[]>;
				});
			} catch (error) {
				fail(error);
			}
		}
	};
	watch.start((envelope) => {
		if (closed) return;
		if (queue.length >= capacity) {
			fail(new Error(`Pico-to-Chord view queue exceeded ${capacity} envelopes`));
			return;
		}
		queue.push(envelope);
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(drain);
	});
	return {
		view,
		get closed() {
			return closed;
		},
		close() {
			if (closed) return;
			closed = true;
			queue.length = 0;
			watch.stop();
		},
	};
}

function applyTracked(root: Draft<PublishedConversationView>, ops: readonly Op[]): void {
	for (const op of ops) {
		if (op[0] === "r") throw new Error("live Pico envelope unexpectedly replaced the view root");
		const path = op[1];
		if (op[0] === "p") {
			const target = resolve(root, path);
			if (!Array.isArray(target)) throw new Error(`Pico splice path is not an array: ${path.join(".")}`);
			(target as unknown[]).splice(op[2], op[3], ...op[4]);
			continue;
		}
		if (op[0] === "m") {
			const target = resolve(root, path);
			if (!Array.isArray(target) || target.length !== op[2].length) {
				throw new Error(`Pico permutation path is not a matching array: ${path.join(".")}`);
			}
			const array = target as unknown[];
			const previous = array.slice();
			const rank = new Map<unknown, number>();
			for (let index = 0; index < op[2].length; index++) {
				const value = previous[op[2][index]!]!;
				if (!rank.has(value)) rank.set(value, index);
			}
			array.sort((left, right) => rank.get(left)! - rank.get(right)!);
			continue;
		}
		const parent = resolve(root, path.slice(0, -1));
		if (parent === null || typeof parent !== "object")
			throw new Error(`Pico operation parent is not an object: ${path.join(".")}`);
		const key = path[path.length - 1]!;
		if (op[0] === "d") {
			if (Array.isArray(parent)) parent.splice(key as number, 1);
			else delete (parent as Record<PropertyKey, unknown>)[key];
			continue;
		}
		const record = parent as Record<PropertyKey, unknown>;
		if (op[0] === "s") record[key] = op[2];
		else if (op[0] === "a") record[key] = `${String(record[key])}${op[2]}`;
		else record[key] = String(record[key]).slice(op[2]);
	}
}

function resolve(root: unknown, path: Path): unknown {
	let value = root;
	for (const segment of path) {
		if (value === null || typeof value !== "object") return undefined;
		value = (value as Record<Seg, unknown>)[segment];
	}
	return value;
}
