# @taco-ai/pi-harness

[English](./README.md) | 简体中文

把 Pi 1.0 从 `@earendil-works/pi-agent-core` 中删除的实验性 **AgentHarness** 抽取为独立包，
让使用方在运行 **最新版** pi 基础包的同时，保留 0.99.2 的 harness 与 JSONL 会话线。

> **本包不是 Earendil Works 官方包。**

## 为什么需要这个包

Pi 1.0 删掉了 harness，改由 `@earendil-works/pi-durable` 取代。但 `pi-durable` 目前仍标记为
不稳定 —— 它的 API 会在版本之间发生变动。想要离开 0.99.2 harness 线的应用，眼下**没有**
一个稳定的目标可以迁移过去。

本包就是为这段空窗期准备的过渡层：让旧接口继续跑在**当前**基础包上，使迁移到
`pi-durable` 成为一件你可以排期去做的事，而不是被上游删除逼着立刻做的事。在
`pi-durable` 去掉不稳定标记、转为稳定 API 之前，本包会持续维护：针对新基础包的构建失败
会被修复，会话格式保持逐字节兼容，磁盘上的会话不需要重写。

**预期在 `pi-durable` 稳定之后本包即行退出。** 这是一条带退出条件的兼容性线，而不是一个
长期 fork。当 `pi-durable` 稳定下来，使用方应当迁移过去，本包也应停止接受新工作。

## 快速开始

需要 Node.js **22.19+**。本包仅支持 ESM；pi 基础包是 peer 依赖，需要由你的应用提供。
首个版本发布后可直接安装：

```bash
pnpm add @taco-ai/pi-harness
```

在此之前，请在本地检出并构建，再以 workspace 或 path 依赖的方式引入：

```bash
pnpm install
pnpm build
```

切换过来本质上只是改 import。harness 接收 pi-ai `Models` 实例和模型：

```ts
import { createModels } from "@earendil-works/pi-ai"; // 在这里注册你的 provider
import { AgentHarness, BACKGROUND_CONTEXT } from "@taco-ai/pi-harness";
import { NodeExecutionEnv } from "@taco-ai/pi-harness/harness/env/nodejs";
import { JsonlSessionRepo } from "@taco-ai/pi-harness/harness/session";

const models = createModels(); // 你应用里已配置好的 Models 实例
const model = models.getModel("anthropic", "claude-opus-4-7");
if (!model) throw new Error("请先配置 provider 与模型");

const fileSystem = new NodeExecutionEnv({ cwd: process.cwd() });
const repo = new JsonlSessionRepo({ fileSystem, sessionsRoot: ".sessions" });
const session = await repo.create({ cwd: process.cwd() }, BACKGROUND_CONTEXT);

const { harness } = await AgentHarness.create({ session, models, model }, BACKGROUND_CONTEXT);
const lane = await harness.lane("main", BACKGROUND_CONTEXT);
await lane.prompt("Hello", undefined, BACKGROUND_CONTEXT);
```

## 来源

抽取自 [`earendil-works/pi`](https://github.com/earendil-works/pi) 的 **`v0.99.2`** 标签，
对应包为 `@earendil-works/pi-agent-core`（`packages/agent`）。上游为 MIT，© Mario Zechner ——
见 `LICENSE.upstream`。内置的 shim 在 `src/shims/` 中有标注。

Pi 1.0 从 `pi-agent-core` 中移除了 `AgentHarness`、session/storage 层、compaction、skills、
prompt templates 以及整个 `./harness/*` 接口，改由 `pi-durable` 取代。本包在不依赖已停更
版本的前提下，让旧接口继续可用。

## 收录范围

| 内容 | 是否在本包中 |
|---|---|
| `AgentHarness`、agent loop、lanes、hooks | 是 |
| `JsonlSessionRepo` 及 session/storage 层 | 是 |
| Compaction、branch summarization | 是 |
| Skills、prompt templates、工具（`read`/`write`/`edit`） | 是 |
| Telemetry span 与 schema —— 见 [`docs/telemetry-schema.md`](./docs/telemetry-schema.md) | 是 |
| `NodeExecutionEnv` 及其他 execution env | 是 |
| pico3（实验性 harness） | 是 |
| 你自己的 session/permission/protocol 层 | 否 —— 留在你的应用里 |

导出映射与旧 `pi-agent-core` 的子路径一一对应（`.`、`./node`、`./harness/context`、
`./harness/session`、`./harness/env/nodejs`、`./harness/runtime/reducer`、
`./harness/session/testing`、`./experimental/pico3`），因此切换过来只是改 import，
不需要重新设计。

## 依赖

pi 基础包是 **peer** 依赖，固定在最新版本线上：

```jsonc
"peerDependencies": {
  "@earendil-works/pi-ai": "^1.3.0",
  "@earendil-works/chord": "^1.3.0",
  "@earendil-works/pi-telemetry": "^1.3.0"
}
```

刻意**不**依赖 `@earendil-works/pi-agent-core`（任何版本都不依赖 —— 1.x 已无 harness），
也**不**依赖 `@earendil-works/pi-durable`（那是另一条迁移路线）。

这里冻结的是 **harness/session API 与 JSONL 格式**。**模型栈跟随上游**，所以新模型、
鉴权修复和 provider 修复通过升级 peer 即可获得。

## 内置 shim

harness 需要的两个上游 API 已从基础包中移除。两者都内置在 `src/shims/` 下 —— 除 import
外保持原样 —— 而不是把整个包固定在旧的基础包版本上：

| Shim | 移除自 | 为什么内置是安全的 |
|---|---|---|
| `assistant-message-frame.ts` | `pi-ai@1.3.0` | `AssistantMessageFrame`、`AssistantMessageFrameEncoder` 和 `reduceAssistantMessageFrames` 被以「未使用」为由移除 —— 原因正是 harness 正在被删除。这些 frame 是磁盘会话格式的一部分，重新实现会破坏会话兼容性。属于有意冻结。 |
| `define-service.ts` | `chord@1.x` | Chord 整个丢弃了 facet/service 子系统。`defineService` 原是一个冻结的身份描述符（`Object.freeze({ id, local })`），与 chord 内核没有运行时耦合，本包也没有任何地方把描述符交给 chord host。`chord/object` 中的新 `Service` 是另一个概念，不能作为直接替代。 |

两个 shim 都标注了它们来自哪个上游版本，并注明不要「顺手修好」它们。

## 会话兼容性

JSONL 会话格式与 0.99.2 **逐字节兼容**。既有会话目录可直接打开并继续使用，无需迁移。
`test/harness/memory-conformance.test.ts` 是一致性校验，运行方式：

```bash
pnpm run test:session:conformance
```

## 维护规则

- **只修破坏性问题，不追新功能。** 针对新基础包版本的编译与运行时修复在范围内；
  从 `pi-durable` 移植 harness 功能不在范围内。
- **不要解冻 shim。** 会话兼容性依赖它们。
- **退出条件：** 维护到 `@earendil-works/pi-durable` 去掉不稳定标记、API 转为稳定为止。
  之后这条线不再接受新工作 —— 迁移目标已经就位，使用方应当迁移过去。

## 开发

```bash
pnpm install
pnpm build                              # tsc -p tsconfig.build.json
pnpm test                               # 全量测试（878 个）
pnpm test:harness                       # harness 测试（788 个）
pnpm run test:session:conformance       # JSONL 一致性校验
pnpm docs:telemetry                     # 重新生成 docs/telemetry-schema.md
pnpm docs:telemetry:check               # 检查生成文档是否已过期
```

测试从 `node_modules` 解析 `@earendil-works/pi-ai`、`chord` 和 `pi-telemetry` ——
用的是已发布的 1.x 构建，而不是同仓库 monorepo 的源码。这正是本包的要点：
测试套件就是「冻结的 harness 能跑在最新基础包上」的证据。

`docs/telemetry-schema.md` 由导出的 telemetry schema 生成，请用 `pnpm docs:telemetry`
重新生成，不要手工编辑；`docs:telemetry:check` 会校验仓库内的副本是否最新。`docs/` 会随
npm 包一起分发。

## 许可证

MIT。见 `LICENSE`（本包）与 `LICENSE.upstream`（Earendil Works 原始条款）。

[`earendil-works/pi`](https://github.com/earendil-works/pi) 为 MIT © Mario Zechner。

## 参与贡献

安全相关的报告，建议私下发送至 `niuma1024@outlook.com`。其余问题 —— bug、想法、
疑问 —— 欢迎提 GitHub issue。
