# @taco-ai/pi-harness

English | [简体中文](./README.zh-CN.md)

The experimental **AgentHarness** that Pi 1.0 deleted from `@earendil-works/pi-agent-core`,
extracted into its own package so consumers can keep the 0.99.2 harness and JSONL session
line while running on the **latest** pi base packages.

> **This is not an official Earendil Works package.**

## Why this package exists

Pi 1.0 deleted the harness and replaced it with `@earendil-works/pi-durable`. But `pi-durable`
is still marked unstable — its API can and does change between releases. So an application
that wants to leave the 0.99.2 harness line has nothing stable to move to *yet*.

This package is the bridge for that gap. It keeps the old surface running on **current** base
packages, so migrating to `pi-durable` is a step you schedule, not a step you are forced into
by an upstream deletion. Until `pi-durable` drops its unstable marker and becomes a stable API,
this package is maintained: broken builds against new base packages get fixed, and the session
format stays byte-compatible so nothing on disk has to be rewritten.

**This package is expected to be retired once `pi-durable` is stable.** It is a compatibility
line with a sunset condition, not a long-term fork. When `pi-durable` settles, consumers should
move to it, and this package should stop taking new work.

## Quick start

Requires Node.js **22.19+**. The package is ESM-only, and the pi base packages are peers, so
your application must provide them. Once the first release is published:

```bash
pnpm add @taco-ai/pi-harness
```

Until then, build it from a checkout and consume it as a workspace or path dependency:

```bash
pnpm install
pnpm build
```

Switching over is an import rewrite. The harness takes a pi-ai `Models` instance and a model:

```ts
import { createModels } from "@earendil-works/pi-ai"; // register your provider(s) here
import { AgentHarness, BACKGROUND_CONTEXT } from "@taco-ai/pi-harness";
import { NodeExecutionEnv } from "@taco-ai/pi-harness/harness/env/nodejs";
import { JsonlSessionRepo } from "@taco-ai/pi-harness/harness/session";

const models = createModels(); // your app's configured Models instance
const model = models.getModel("anthropic", "claude-opus-4-7");
if (!model) throw new Error("configure a provider and model first");

const fileSystem = new NodeExecutionEnv({ cwd: process.cwd() });
const repo = new JsonlSessionRepo({ fileSystem, sessionsRoot: ".sessions" });
const session = await repo.create({ cwd: process.cwd() }, BACKGROUND_CONTEXT);

const { harness } = await AgentHarness.create({ session, models, model }, BACKGROUND_CONTEXT);
const lane = await harness.lane("main", BACKGROUND_CONTEXT);
await lane.prompt("Hello", undefined, BACKGROUND_CONTEXT);
```

## Provenance

Extracted from [`earendil-works/pi`](https://github.com/earendil-works/pi) at **tag `v0.99.2`**,
package `@earendil-works/pi-agent-core` (`packages/agent`). Upstream is MIT, © Mario Zechner —
see `LICENSE.upstream`. The vendored shims are marked in `src/shims/`.

Pi 1.0 removed `AgentHarness`, the session/storage layer, compaction, skills, prompt templates
and the whole `./harness/*` surface from `pi-agent-core`, replacing them with `pi-durable`.
This package keeps the old surface alive without depending on a dead version.

## What is in scope

| Content | In this package |
|---|---|
| `AgentHarness`, agent loop, lanes, hooks | yes |
| `JsonlSessionRepo` and the session/storage layer | yes |
| Compaction, branch summarization | yes |
| Skills, prompt templates, tools (`read`/`write`/`edit`) | yes |
| Telemetry spans and schemas — see [`docs/telemetry-schema.md`](./docs/telemetry-schema.md) | yes |
| `NodeExecutionEnv` and the other execution envs | yes |
| pico3 (the experimental harness) | yes |
| Your own session/permission/protocol layer | no — keep it in your app |

The export map mirrors the old `pi-agent-core` subpaths one-for-one (`.`, `./node`,
`./harness/context`, `./harness/session`, `./harness/env/nodejs`,
`./harness/runtime/reducer`, `./harness/session/testing`, `./experimental/pico3`) so switching
over is an import rewrite, not a redesign.

## Dependencies

The pi base packages are **peer** dependencies, pinned to the exact tested set:

```jsonc
"peerDependencies": {
  "@earendil-works/pi-ai": "1.5.2",
  "@earendil-works/chord": "1.5.2",
  "@earendil-works/pi-telemetry": "1.5.2"
}
```

There is deliberately **no** dependency on `@earendil-works/pi-agent-core` (any version — 1.x
has no harness) and none on `@earendil-works/pi-durable` (a separate migration track).

What is frozen here is the **harness/session API and the JSONL format**. The **model stack
tracks upstream through tested harness releases**. Upgrade this package together with the Pi
peer versions it declares to receive model, auth and provider fixes. Other versions, including
newer patches such as 1.5.3, do not satisfy the exact peer requirements; npm can reject their
installation with `ERESOLVE`. This deliberately blocks unverified upstream API changes.

Version 0.2.0 requires pi-ai, chord and pi-telemetry 1.5.2. Keep the three peers on the tested 1.5.2 set.
`withTelemetryContext()` still accepts a recorder or an active span. Active spans interoperate
with chord's `withTelemetry()`; recorder-backed model calls create a scoped
`pi.harness.model_request` parent that remains open through response consumption.
Custom implementations of chord `Context` must now expose `telemetry`. In experimental pico3,
persisted system-message tool parameters must be JSON objects; `Stored<T>` still uses chord's
`JsonRepresentation<T>` without redefining its projection rules. Existing JSONL files need no migration. The experimental `experimental/pico3` Chord view bridge now accepts a host-owned synchronous publisher; it no longer exposes Chord v1 `ReplicatedState` types.

## Experimental Pico3 view migration

Chord 1.5.1 removed its v1 `replicatedState()` API. `attachChordView()` still accepts a
factory, but its result now implements the exported `ConversationViewPublisher` contract:
`value` is the current `PublishedConversationView`, and `change(context, mutate)` atomically
publishes one synchronous `Draft<PublishedConversationView>` mutation. The publisher must
preserve previous snapshots and discard a mutation whose callback throws.

The bridge retains the factory result's concrete type, including host-specific subscription
methods. `createPicoConversationService()` likewise retains the supplied view type. Explicit
`ChordViewBridge` / `PicoConversationService` annotations expose only the minimal view contract;
pass the publisher type as their generic argument when consumers need its observation methods.
Closing the bridge stops its Pico watch; the host still owns the publisher's lifetime.

This is a migration of the experimental publication boundary, not a built-in Chord v2 host
adapter. Use the built-in atomic publisher with the existing factory argument:

```ts
import { attachChordView, createConversationViewPublisher } from "@taco-ai/pi-harness/experimental/pico3";

const bridge = await attachChordView(conversation, createConversationViewPublisher, context);
const unsubscribe = bridge.view.subscribe((view, context, delivery) => {
  // Observe future revisions; the current snapshot is bridge.view.value.
});
```

`createConversationViewPublisher()` rolls back failed mutations and keeps earlier snapshots
intact. Subscriptions observe future updates in sequence; callbacks start synchronously,
async results are not awaited, and listener failures go to the optional `onError` callback.
The bridge trusts custom publishers to meet the same mutation contract: a publisher that
leaves partial state after throwing can leave an inconsistent view when the bridge closes.

A default-typed `PicoConversationService.view.value` is now
`PublishedConversationView | undefined`; check it before accessing entries, or retain the
concrete publisher type through inference or the generic parameter. See the
[0.2.0 release notes](./docs/releases/0.2.0.md). The main `AgentHarness` and existing JSONL
files need no API or format migration.

## Vendored shims

Two upstream APIs this harness needs were removed from the base packages. Both are vendored
under `src/shims/` — verbatim except for their imports — rather than pinning the package to an
old base version:

| Shim | Removed from | Why it is safe to vendor |
|---|---|---|
| `assistant-message-frame.ts` | `pi-ai@1.3.0` | `AssistantMessageFrame`, `AssistantMessageFrameEncoder` and `reduceAssistantMessageFrames` were removed as "unused" *because* the harness was being deleted. The frames are part of the on-disk session format, so reimplementing them would break session compatibility. Frozen on purpose. |
| `define-service.ts` | `chord@1.x` | Chord dropped the whole facet/service subsystem. `defineService` was a frozen identity descriptor (`Object.freeze({ id, local })`) with no runtime coupling to the chord kernel, and nothing in this package hands a descriptor to a chord host. The new `Service` in `chord/object` is a different concept and is not a drop-in replacement. |

Both shims are marked with the upstream version they came from and a note not to "fix them up".

## Session compatibility

The JSONL session format is **byte-compatible with 0.99.2**. Existing session directories open
and continue without migration. `test/harness/memory-conformance.test.ts` is the conformance
gate; run it with:

```bash
pnpm run test:session:conformance
```

## Maintenance rules

- **Fix breakage, do not chase features.** Compile and runtime fixes against new base-package
  versions are in scope. Porting harness features from `pi-durable` is not.
- **Do not unfreeze the shims.** Session compatibility depends on them.
- **Sunset condition:** maintain until `@earendil-works/pi-durable` removes its unstable marker
  and becomes a stable API. After that this line takes no new work — the migration target has
  arrived and consumers should be on it.

## Development

```bash
pnpm install
pnpm build                              # tsc -p tsconfig.build.json
pnpm test                               # full suite (900 passed, 1 skipped)
pnpm test:harness                       # harness suite (810 passed, 1 skipped)
pnpm run test:session:conformance       # JSONL conformance gate
pnpm docs:telemetry                     # regenerate docs/telemetry-schema.md
pnpm docs:telemetry:check               # fail if the generated doc is stale
pnpm check:package                      # pack and consume every public export
```

`pnpm check:package` first rebuilds `dist/`, then installs the tarball into an isolated consumer and checks all public
entry points with `skipLibCheck: false`, then runs a faux-model request. The strict fixture
also installs `@modelcontextprotocol/sdk@1.30.0` and includes TypeScript's `DOM` library:
`pi-ai`'s upstream `@google/genai` declarations reference that optional SDK and browser
types unconditionally. Consumers checking dependency declarations need those type prerequisites;
a Node-only type environment with only the documented Pi peers still encounters upstream
GenAI declaration errors. The fixture supplies a type-checking environment, not an additional
runtime requirement of this harness.

Tests resolve `@earendil-works/pi-ai`, `chord` and `pi-telemetry` from `node_modules` — the
published 1.x builds, not sibling monorepo source. That is the point of the package: the suite
is the evidence that the frozen harness runs against the latest base packages.

`docs/telemetry-schema.md` is generated from the exported telemetry schemas. Regenerate it with
`pnpm docs:telemetry` instead of editing it by hand; `docs:telemetry:check` verifies that the
checked-in copy is current. `docs/` ships in the published tarball.

## License

MIT. See `LICENSE` (this package) and `LICENSE.upstream` (the original Earendil Works terms).

[`earendil-works/pi`](https://github.com/earendil-works/pi) is MIT © Mario Zechner.

## Contributing

Security-sensitive reports are best sent privately to `niuma1024@outlook.com`. Everything
else — bugs, ideas, questions — is welcome as a GitHub issue.
